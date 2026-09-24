# The LLMs: one SageMaker "model" and one "endpoint configuration" per entry in
# var.models. This is the heart of the project.
#
# The three SageMaker objects, and who owns each:
#
#   model                   WHAT to run: container image + environment (which
#                           Hugging Face model, context length...) + IAM role.
#                           Terraform.
#   endpoint configuration  ON WHAT: instance type and count, timeouts.
#                           Terraform.
#   endpoint                The running GPU machine with an HTTPS API. It is
#                           what costs money (ml.g6e.xlarge: ~$2.61/hour, about
#                           $1,900 a month if forgotten).
#                           The app's GPU CONTROLLER, not Terraform.
#
# Why the controller owns the endpoint: with scaling = "on_demand" the
# controller creates the endpoint when someone chats with the model and deletes
# it after idle_minutes without use. If Terraform also managed the endpoint,
# every `terraform apply` would re-create an endpoint the controller had just
# stopped to save money. So Terraform gives the controller everything it needs
# (the endpoint NAME and the endpoint CONFIGURATION name, via LLM_MODELS) and
# never creates the endpoint itself. `terraform destroy` therefore cannot delete
# a running endpoint either: stop it first (scripts/gpu.sh stop).
#
# DATA CAPTURE IS DELIBERATELY ABSENT. SageMaker can copy every request and
# response of an endpoint to S3 (data_capture_config). That would store every
# prompt, every uploaded document and every answer: the opposite of a private
# chat. Do not add it.

locals {
  endpoint_names = { for slug, m in var.models : slug => "${var.name}-${slug}" }

  images = { for slug, m in var.models : slug => (m.container == "router" ? var.router_image : var.dlc_image) }

  # Privacy switches for every container. None of these send prompts, but a
  # private deployment should not phone home at all:
  #   OPT_OUT_TRACKING    AWS Deep Learning Container start-up telemetry
  #   VLLM_NO_USAGE_STATS vLLM's anonymous usage statistics
  #   DO_NOT_TRACK        the same, honoured by several libraries
  privacy_env = {
    OPT_OUT_TRACKING    = "true"
    VLLM_NO_USAGE_STATS = "1"
    DO_NOT_TRACK        = "1"
  }

  # Environment for the AWS vLLM DLC. Its entrypoint turns every variable
  # named SM_VLLM_<FLAG> into a `vllm serve --<flag> <value>` argument
  # (SM_VLLM_MAX_MODEL_LEN=32768 -> --max-model-len 32768) and serves the
  # OpenAI-compatible API on port 8080, including SageMaker's /ping and
  # /invocations routes.
  dlc_env = {
    for slug, m in var.models : slug => merge(
      {
        # Where the weights come from: the Hugging Face hub (downloaded at every
        # cold start), or /opt/ml/model, where SageMaker puts the files from
        # weights_s3_uri before the container starts.
        SM_VLLM_MODEL = m.weights_s3_uri != null ? "/opt/ml/model" : m.hf_model_id
        # The name the backend must send as "model" in each request. Always the
        # Hugging Face id, so it does not change when weights move to S3.
        SM_VLLM_SERVED_MODEL_NAME      = m.hf_model_id
        SM_VLLM_MAX_MODEL_LEN          = tostring(m.max_model_len)
        SM_VLLM_GPU_MEMORY_UTILIZATION = tostring(m.gpu_memory_utilization)
        SM_VLLM_TENSOR_PARALLEL_SIZE   = tostring(m.tensor_parallel_size)
      },
      # How many images one prompt may contain (vision models only).
      m.vision ? { SM_VLLM_LIMIT_MM_PER_PROMPT = jsonencode({ image = m.max_images_per_prompt }) } : {},
    )
  }

  # Environment for our own ml/vllm-router image (see ml/vllm-router/server.py).
  # The router reads MODELS_JSON, a list of
  #   {name, path?, gpu_fraction, args?}
  # and starts one `vllm serve <path> --served-model-name <name>
  # --gpu-memory-utilization <gpu_fraction> <args...>` per entry. The
  # gpu_fraction values must add up to LESS than 1.0.
  # By default it serves just this model; set extra_env.MODELS_JSON to put
  # several models on one GPU (and add the others to extra_llm_models with the
  # same endpoint_name).
  router_env = {
    for slug, m in var.models : slug => {
      MODELS_JSON = jsonencode([merge(
        {
          name         = m.hf_model_id
          gpu_fraction = m.gpu_memory_utilization
          args = concat(
            ["--max-model-len", tostring(m.max_model_len)],
            m.tensor_parallel_size > 1 ? ["--tensor-parallel-size", tostring(m.tensor_parallel_size)] : [],
            m.vision ? ["--limit-mm-per-prompt", jsonencode({ image = m.max_images_per_prompt })] : [],
          )
        },
        # S3 weights land directly in /opt/ml/model.
        m.weights_s3_uri != null ? { path = "/opt/ml/model" } : {},
      )])
      MODEL_DIR = "/opt/ml/model"
    }
  }

  # Everything except the Hugging Face token. This part feeds the resource
  # names below, which must not be derived from a secret (Terraform would then
  # hide them, and everything built from them, as "sensitive").
  public_env = {
    for slug, m in var.models : slug => merge(
      local.privacy_env,
      m.container == "router" ? local.router_env[slug] : local.dlc_env[slug],
      # With S3 weights there is nothing to download from the hub; offline
      # mode also makes a VPC-isolated container fail fast instead of hanging
      # on network timeouts.
      m.weights_s3_uri != null ? { HF_HUB_OFFLINE = "1" } : {},
      m.extra_env,
    )
  }

  # Anything computed from a sensitive value is itself treated as sensitive,
  # even `var.hf_token != ""`. Whether a token is SET is not a secret, so say so
  # explicitly; otherwise the model names, LLM_MODELS and the whole ECS task
  # definition would be hidden in `terraform plan`.
  has_token = nonsensitive(var.hf_token != "")

  # A fingerprint of the token (a hash, not the token) so that changing the
  # token still changes the model name below.
  token_fingerprint = local.has_token ? substr(nonsensitive(sha256(var.hf_token)), 0, 8) : ""

  # The token is only needed to DOWNLOAD a gated model from the hub.
  token_needed = { for slug, m in var.models : slug => local.has_token && m.weights_s3_uri == null }

  container_env = {
    for slug, m in var.models : slug => merge(
      local.public_env[slug],
      local.token_needed[slug] ? { HF_TOKEN = var.hf_token } : {},
    )
  }

  # CONTENT-ADDRESSED NAMES.
  # SageMaker models and endpoint configurations cannot be edited: any change
  # means a new one. With create_before_destroy, Terraform creates the new one
  # BEFORE deleting the old, so LLM_MODELS never names a configuration that
  # does not exist. (A running endpoint is not affected when the configuration
  # it was started from is deleted; it keeps running until the controller
  # re-creates it.) That only works if the new object gets a NEW name
  # ("Cannot create already existing model" otherwise), so the name ends with a
  # short hash of everything that forces a replacement.
  #
  # Name limit is 63 characters: "<project>-<env>-<slug>-<8 hex>".
  model_names = {
    for slug, m in var.models : slug => "${var.name}-${slug}-${substr(sha256(jsonencode({
      image        = local.images[slug]
      env          = local.public_env[slug]
      token        = local.token_needed[slug] ? local.token_fingerprint : ""
      weights      = m.weights_s3_uri
      vpc_isolated = var.vpc_isolated
      role         = aws_iam_role.execution.name
    })), 0, 8)}"
  }

  config_names = {
    for slug, m in var.models : slug => "${var.name}-${slug}-${substr(sha256(jsonencode({
      model            = local.model_names[slug]
      instance_type    = m.instance_type
      ami              = m.inference_ami_version
      download_timeout = m.download_timeout_seconds
      startup_timeout  = m.startup_timeout_seconds
    })), 0, 8)}"
  }

  # Where each model's weights come from in S3 (for the IAM policy).
  weights_locations = {
    for slug, m in var.models : slug => {
      bucket = regex("^s3://([^/]+)/", m.weights_s3_uri)[0]
      prefix = regex("^s3://[^/]+/(.*)$", m.weights_s3_uri)[0]
    } if m.weights_s3_uri != null
  }
}

# ------------------------------------------------------------------- IAM -----
# The role SageMaker itself uses to pull the image, read the weights and write
# logs and metrics. One role for all models.

resource "aws_iam_role" "execution" {
  name        = "${var.name}-sagemaker"
  description = "Assumed by SageMaker to run the ${var.name} LLM endpoints"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sagemaker.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "execution" {
  name = "run-endpoints"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          # "*" because the vLLM DLC lives in an AWS-owned account's registry
          # (763104351884), not ours; GetAuthorizationToken is never scoped.
          Sid    = "PullContainerImages"
          Effect = "Allow"
          Action = [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ]
          Resource = "*"
        },
        {
          Sid      = "WriteEndpointLogs"
          Effect   = "Allow"
          Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
          Resource = "arn:${var.partition}:logs:${var.region}:${var.account_id}:log-group:/aws/sagemaker/*"
        },
        {
          # PutMetricData has no resource-level permissions.
          Sid      = "PublishEndpointMetrics"
          Effect   = "Allow"
          Action   = ["cloudwatch:PutMetricData"]
          Resource = "*"
        },
      ],
      length(local.weights_locations) == 0 ? [] : [
        {
          Sid      = "ReadModelWeights"
          Effect   = "Allow"
          Action   = ["s3:GetObject"]
          Resource = distinct([for w in values(local.weights_locations) : "arn:${var.partition}:s3:::${w.bucket}/${w.prefix}*"])
        },
        {
          Sid      = "ListModelWeights"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = distinct([for w in values(local.weights_locations) : "arn:${var.partition}:s3:::${w.bucket}"])
        },
      ],
      # A VPC-attached endpoint gets network interfaces in our subnets, which
      # SageMaker creates with this role.
      !var.vpc_isolated ? [] : [
        {
          Sid    = "VpcNetworkInterfaces"
          Effect = "Allow"
          Action = [
            "ec2:CreateNetworkInterface",
            "ec2:CreateNetworkInterfacePermission",
            "ec2:DeleteNetworkInterface",
            "ec2:DeleteNetworkInterfacePermission",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DescribeVpcs",
            "ec2:DescribeDhcpOptions",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
          ]
          Resource = "*"
        },
      ],
    )
  })
}

# ----------------------------------------------------- VPC isolation (opt) ---
# Off by default: the DLC downloads the weights from Hugging Face at start-up,
# which needs internet access, and SageMaker's default network provides it.
#
# On (sagemaker_vpc_isolated = true): the endpoint's network interfaces live in
# our private subnets and this security group allows HTTPS only to S3 and to
# the VPC itself. Prompts can then not leave the VPC even if the model server
# tried. Weights must come from S3 (weights_s3_uri).

resource "aws_security_group" "endpoint" {
  count = var.vpc_isolated ? 1 : 0

  name        = "${var.name}-sagemaker"
  description = "SageMaker LLM endpoints: HTTPS to S3 and the VPC only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-sagemaker" }
}

# Interface endpoints (if any) are addresses inside the VPC.
resource "aws_vpc_security_group_egress_rule" "endpoint_vpc" {
  count = var.vpc_isolated ? 1 : 0

  security_group_id = aws_security_group.endpoint[0].id
  description       = "HTTPS to interface endpoints inside the VPC"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.vpc_cidr
}

# S3 through the GATEWAY endpoint must be allowed by prefix list, not by CIDR:
# gateway endpoint traffic goes to S3's public address ranges, not to an
# address in the VPC. A rule allowing only the VPC CIDR silently blocks it,
# and SageMaker then reports "Failed to download model data", which sends you
# looking at IAM or routing instead of at this security group.
resource "aws_vpc_security_group_egress_rule" "endpoint_s3" {
  count = var.vpc_isolated ? 1 : 0

  security_group_id = aws_security_group.endpoint[0].id
  description       = "HTTPS to S3 (model weights) via the gateway endpoint"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = var.s3_prefix_list_id
}

resource "aws_security_group" "interface_endpoints" {
  count = var.vpc_isolated && length(var.interface_endpoints) > 0 ? 1 : 0

  name        = "${var.name}-vpce"
  description = "Interface VPC endpoints for the isolated SageMaker endpoints"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-vpce" }
}

resource "aws_vpc_security_group_ingress_rule" "interface_endpoints" {
  count = var.vpc_isolated && length(var.interface_endpoints) > 0 ? 1 : 0

  security_group_id = aws_security_group.interface_endpoints[0].id
  description       = "HTTPS from inside the VPC"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_endpoint" "interface" {
  for_each = var.vpc_isolated ? toset(var.interface_endpoints) : toset([])

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = [aws_security_group.interface_endpoints[0].id]
  private_dns_enabled = true
  tags                = { Name = "${var.name}-${each.value}" }
}

# ----------------------------------------------------------------- models ---

resource "aws_sagemaker_model" "this" {
  for_each = var.models

  name               = local.model_names[each.key]
  execution_role_arn = aws_iam_role.execution.arn

  primary_container {
    image       = local.images[each.key]
    environment = local.container_env[each.key]

    # S3 weights: an UNCOMPRESSED prefix, not a model.tar.gz. SageMaker copies
    # the files straight to /opt/ml/model before starting the container. For
    # models of 10+ GB this is much faster than packing and unpacking a tarball.
    dynamic "model_data_source" {
      for_each = each.value.weights_s3_uri != null ? [each.value.weights_s3_uri] : []
      content {
        s3_data_source {
          s3_uri           = model_data_source.value
          s3_data_type     = "S3Prefix"
          compression_type = "None"
        }
      }
    }
  }

  dynamic "vpc_config" {
    for_each = var.vpc_isolated ? [1] : []
    content {
      subnets            = var.private_subnet_ids
      security_group_ids = [aws_security_group.endpoint[0].id]
    }
  }

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = length(local.model_names[each.key]) <= 63
      error_message = "Model slug \"${each.key}\" is too long: SageMaker names are limited to 63 characters and this one becomes \"${local.model_names[each.key]}\". Use a shorter slug."
    }
    precondition {
      condition     = each.value.container != "router" || var.router_image != null
      error_message = "Model \"${each.key}\" uses container = \"router\": set enable_vllm_router_repo = true and push the image (.github/workflows/build-vllm-router.yml)."
    }
    precondition {
      condition     = !var.vpc_isolated || each.value.weights_s3_uri != null
      error_message = "sagemaker_vpc_isolated = true: model \"${each.key}\" needs weights_s3_uri, because an isolated endpoint cannot reach Hugging Face. Stage the weights with scripts/stage-weights.sh."
    }
  }

  # SageMaker checks the role's permissions when the model is created.
  depends_on = [aws_iam_role_policy.execution]
}

# -------------------------------------------------- endpoint configurations --

resource "aws_sagemaker_endpoint_configuration" "this" {
  for_each = var.models

  name = local.config_names[each.key]

  production_variants {
    variant_name           = "AllTraffic"
    model_name             = aws_sagemaker_model.this[each.key].name
    instance_type          = each.value.instance_type
    initial_instance_count = 1
    initial_variant_weight = 1

    # The host machine image. The default vLLM DLC is built for CUDA 13
    # ("cu130") and does not ship CUDA's forward-compatibility libraries, so
    # the host's NVIDIA driver must support CUDA 13 itself. SageMaker's default
    # host image has driver 535 (CUDA 12.2); this one has driver 580 (CUDA 13.0).
    inference_ami_version = each.value.inference_ami_version

    # A cold start = pull a ~10 GB image + download the weights + load them
    # onto the GPU + compile CUDA graphs. 5-15 minutes is normal, so the
    # default limits (which can be as low as a few minutes) are raised.
    model_data_download_timeout_in_seconds            = each.value.download_timeout_seconds
    container_startup_health_check_timeout_in_seconds = each.value.startup_timeout_seconds

    # volume_size_in_gb is not set: GPU instances such as ml.g5/g6/g6e come with
    # local NVMe storage and reject an extra EBS volume.
  }

  # No data_capture_config: see the note at the top of this file.

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = length(local.config_names[each.key]) <= 63
      error_message = "Endpoint configuration name \"${local.config_names[each.key]}\" is longer than 63 characters. Use a shorter model slug."
    }
  }
}

# ------------------------------------------------------------------- logs ----
# SageMaker writes each endpoint's container output here. Created up front so
# it has a retention period (SageMaker's own default is "never expire").
# Look here first when an endpoint fails to start.

resource "aws_cloudwatch_log_group" "endpoint" {
  for_each = local.endpoint_names

  name              = "/aws/sagemaker/Endpoints/${each.value}"
  retention_in_days = var.log_retention_days
}
