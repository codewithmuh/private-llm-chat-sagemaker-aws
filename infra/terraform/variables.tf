# Inputs for the whole stack. Set them in terraform.tfvars
# (copy terraform.tfvars.example). Only a few have no default; everything else
# works out of the box.

# ============================================================== basics ======

variable "project" {
  description = "Short name used as the prefix of every resource name (with environment: \"llmchat-dev-...\")."
  type        = string
  default     = "llmchat"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.project))
    error_message = "project must be 2-20 characters: lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = <<-EOT
    Environment name, e.g. "dev" or "prod". "prod" switches on the safety nets
    that make a stack hard to delete by accident: RDS deletion protection and a
    final snapshot, ALB deletion protection, non-empty S3/ECR refuse to be
    destroyed, and ECS Exec is off.
  EOT
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z0-9]{1,10}$", var.environment))
    error_message = "environment must be 1-10 lowercase letters or digits."
  }

  # Load balancer and target group names are limited to 32 characters and get a
  # 4-character suffix ("-alb", "-api"), so "<project>-<environment>" must stay
  # short. (A validation that reads another variable needs Terraform >= 1.9.)
  validation {
    condition     = length("${var.project}-${var.environment}") <= 24
    error_message = "\"<project>-<environment>\" must be at most 24 characters (AWS name limits)."
  }
}

variable "aws_region" {
  description = <<-EOT
    Region for everything except the CloudFront certificate. Pick a region where
    your account has SageMaker GPU quota: Service Quotas -> Amazon SageMaker ->
    "ml.g6e.xlarge for endpoint usage" (or the instance type you use). New
    accounts usually start at 0 and must request an increase.
  EOT
  type        = string
  default     = "us-east-1"
}

# ============================================================ network =======

variable "vpc_cidr" {
  description = "IP range of the VPC. Only change it if it clashes with a network you peer with."
  type        = string
  default     = "10.20.0.0/16"
}

variable "enable_nat_gateway" {
  description = <<-EOT
    false (default, cheaper): the ECS tasks run in PUBLIC subnets with a public
    IP, so they can reach AWS APIs and the internet without a NAT gateway. They
    are still not reachable from the internet: their security group only
    accepts traffic from the load balancer.
    true: the tasks run in PRIVATE subnets and go out through one NAT gateway
    (~$33/month plus $0.045 per GB). Choose this if your security policy says
    application servers must not have public IPs.
  EOT
  type        = bool
  default     = false
}

# ============================================================= domain =======

variable "domain_name" {
  description = <<-EOT
    Optional custom domain for the app, e.g. "chat.example.com". Requires
    route53_zone_id. Without it the app is served at https://<id>.cloudfront.net.
  EOT
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = <<-EOT
    Route 53 hosted zone that contains domain_name (and/or ses_domain).
    Terraform creates the certificate validation, the alias records and the
    DKIM records in it.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null || var.route53_zone_id != null
    error_message = "domain_name needs route53_zone_id: Terraform validates the certificate and points the domain at CloudFront through Route 53."
  }
}

variable "cloudfront_price_class" {
  description = "PriceClass_100 (North America + Europe edges, cheapest), PriceClass_200 or PriceClass_All."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

# ======================================================= application ========

variable "app_name" {
  description = "Shown in the UI, in emails and in authenticator apps (APP_NAME)."
  type        = string
  default     = "Private LLM Chat"
}

variable "admin_emails" {
  description = <<-EOT
    Users who become staff + superuser when they log in with one of these
    VERIFIED email addresses (ADMIN_EMAILS). The simplest way to get into
    /admin/ on a fresh deployment: put your own address here.
  EOT
  type        = list(string)
  default     = []
}

variable "signup_enabled" {
  description = "false = invite-only: new users can only be created in /admin/ (SIGNUP_ENABLED)."
  type        = bool
  default     = true
}

variable "email_verification" {
  description = <<-EOT
    "mandatory", "optional" or "none" (EMAIL_VERIFICATION). With the default
    "mandatory" and no SES identity configured, the verification codes are only
    printed to the api's CloudWatch logs.
  EOT
  type        = string
  default     = "mandatory"

  validation {
    condition     = contains(["mandatory", "optional", "none"], var.email_verification)
    error_message = "email_verification must be mandatory, optional or none."
  }
}

variable "google_client_id" {
  description = <<-EOT
    Google OAuth "Web application" client id (GOOGLE_CLIENT_ID). Empty hides
    "Sign in with Google". Its "Authorized JavaScript origins" must contain the
    app_url output (see docs/deploy-aws.md).
  EOT
  type        = string
  default     = ""
}

variable "enable_admin" {
  description = "Serve the Django admin at /admin/ (ENABLE_ADMIN). Only staff users can log in to it."
  type        = bool
  default     = true
}

variable "extra_environment" {
  description = <<-EOT
    Extra environment variables for the api and gpu-controller containers, for
    settings Terraform does not set itself, e.g.
      { LOG_LEVEL = "DEBUG", MAX_UPLOAD_MB = "50", OCR_ENGINE = "tesseract" }
    See docs/configuration.md. A key that Terraform already sets is overridden.
    Do not put secrets here: environment variables are visible in the ECS console.
  EOT
  type        = map(string)
  default     = {}
}

# =========================================================== email ==========

variable "ses_from_email" {
  description = <<-EOT
    Send email (verification and login codes) with Amazon SES from this
    address. AWS emails it a verification link on the first apply: click it.
    If ses_domain is also set, this address must belong to that domain.
    Leave both empty to use the console backend (codes appear in CloudWatch logs).
  EOT
  type        = string
  default     = null
}

variable "ses_domain" {
  description = <<-EOT
    Verify a whole domain with SES (DKIM) instead of one address. With
    route53_zone_id the DKIM records are created for you; otherwise they are
    printed in the ses_dns_records output for you to add at your DNS provider.
  EOT
  type        = string
  default     = null
}

# ========================================================== containers ======

variable "image_tag" {
  description = <<-EOT
    Tag of the api and web images in ECR, normally the git commit SHA. You do
    not set this by hand: scripts/deploy.sh builds and pushes the images, then
    runs `terraform apply -var image_tag=<sha>` and records the tag in
    image.auto.tfvars so later applies keep it.
    null (the default) = no images yet: the ECS services are created with zero
    running tasks, so a first `terraform apply` succeeds before anything is built.
  EOT
  type        = string
  default     = null
}

variable "api_cpu" {
  description = "api task CPU units (1024 = 1 vCPU). Fargate needs valid CPU/memory pairs."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "api task memory in MiB."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Number of api tasks. 1 is enough to start; use 2 for zero-downtime restarts across AZs."
  type        = number
  default     = 1
}

variable "web_cpu" {
  description = "web (Next.js) task CPU units."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "web task memory in MiB."
  type        = number
  default     = 512
}

variable "web_desired_count" {
  description = "Number of web tasks."
  type        = number
  default     = 1
}

variable "gpu_controller_cpu" {
  description = "gpu-controller task CPU units. It is a small loop; 256 is plenty."
  type        = number
  default     = 256
}

variable "gpu_controller_memory" {
  description = "gpu-controller task memory in MiB."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps container and endpoint logs."
  type        = number
  default     = 30
}

# ============================================================ database ======

variable "db_instance_class" {
  description = "RDS instance size. db.t4g.micro (2 vCPU burst, 1 GiB) is fine for a demo or a small team."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial database storage in GiB (grows automatically up to 5x this)."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Keep a standby database in a second AZ (doubles the RDS cost). Recommended for prod."
  type        = bool
  default     = false
}

# ============================================================= storage ======

variable "uploads_prefix" {
  description = "Key prefix for uploaded files inside the bucket (S3_PREFIX)."
  type        = string
  default     = "uploads/"

  validation {
    condition     = var.uploads_prefix == "" || endswith(var.uploads_prefix, "/")
    error_message = "uploads_prefix must be empty or end with \"/\"."
  }
}

variable "uploads_expiration_days" {
  description = "Delete uploaded files automatically after this many days. 0 = keep them until the user deletes them."
  type        = number
  default     = 0
}

# ============================================================== models ======

variable "models" {
  description = <<-EOT
    The LLMs to host on SageMaker, keyed by a short slug (the model id the API
    and UI use). For each one Terraform creates a SageMaker model and endpoint
    configuration; the app's GPU controller creates and deletes the endpoint
    itself according to `scaling`. See terraform.tfvars.example for every field.
  EOT
  type = map(object({
    name        = string
    description = optional(string, "")
    # Hugging Face repo id. Also the model name the backend sends ("model": ...).
    hf_model_id = string

    instance_type          = optional(string, "ml.g6e.xlarge")
    max_model_len          = optional(number, 32768)
    gpu_memory_utilization = optional(number, 0.90)
    tensor_parallel_size   = optional(number, 1)
    # vision models accept images; ocr marks the preferred model for the OCR tool.
    vision                = optional(bool, false)
    ocr                   = optional(bool, false)
    max_images_per_prompt = optional(number, 4)
    max_output_tokens     = optional(number, 4096)
    temperature           = optional(number)

    # on_demand | always_on | off | manual (see docs/configuration.md)
    scaling         = optional(string, "on_demand")
    idle_minutes    = optional(number, 30)
    hourly_cost_usd = optional(number, 0)

    default = optional(bool, false)
    sort    = optional(number)
    enabled = optional(bool, true)

    # "dlc" = AWS's vLLM container (nothing to build); "router" = our own image
    # from ml/vllm-router (needs enable_vllm_router_repo and a pushed image).
    container = optional(string, "dlc")
    # s3://bucket/prefix/ with pre-downloaded weights (scripts/stage-weights.sh),
    # instead of downloading from Hugging Face at every cold start.
    weights_s3_uri = optional(string)
    # Extra container environment. For the DLC, SM_VLLM_<FLAG>=<value> becomes
    # `vllm serve --<flag> <value>` (e.g. SM_VLLM_MAX_NUM_SEQS = "16").
    extra_env = optional(map(string), {})

    # SageMaker host image. The default one has NVIDIA driver 580 / CUDA 13.0,
    # which the cu130 vLLM container needs. null = SageMaker's default (older driver).
    inference_ami_version = optional(string, "al2023-ami-sagemaker-inference-gpu-4-1")
    # How long SageMaker waits for weights to download / the container to pass /ping.
    download_timeout_seconds = optional(number, 1800)
    startup_timeout_seconds  = optional(number, 1800)
  }))

  default = {
    "qwen3-vl-8b" = {
      name                   = "Qwen3-VL 8B"
      description            = "Chat, vision and OCR on one GPU"
      hf_model_id            = "Qwen/Qwen3-VL-8B-Instruct-FP8"
      instance_type          = "ml.g6e.xlarge"
      max_model_len          = 32768
      gpu_memory_utilization = 0.90
      vision                 = true
      ocr                    = true
      scaling                = "on_demand"
      idle_minutes           = 30
      hourly_cost_usd        = 2.61
      default                = true
    }
  }

  validation {
    # The slug ends up in the SageMaker endpoint name, which allows letters,
    # digits and hyphens. Lowercase keeps the IAM ARN patterns simple.
    condition     = alltrue([for slug in keys(var.models) : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", slug))])
    error_message = "Model slugs (the map keys) must be lowercase letters, digits and hyphens, e.g. \"qwen3-vl-8b\"."
  }

  validation {
    # SageMaker names are limited to 63 characters, and the endpoint
    # configuration is named "<project>-<environment>-<slug>-<8 hex>".
    condition     = alltrue([for slug in keys(var.models) : length("${var.project}-${var.environment}-${slug}-12345678") <= 63])
    error_message = "A model slug is too long: \"<project>-<environment>-<slug>\" must stay under 55 characters (SageMaker's 63-character name limit)."
  }

  validation {
    condition     = alltrue([for m in values(var.models) : contains(["on_demand", "always_on", "off", "manual"], m.scaling)])
    error_message = "scaling must be one of on_demand, always_on, off, manual."
  }

  validation {
    condition     = alltrue([for m in values(var.models) : contains(["dlc", "router"], m.container)])
    error_message = "container must be \"dlc\" or \"router\"."
  }

  validation {
    condition     = alltrue([for m in values(var.models) : m.weights_s3_uri == null || can(regex("^s3://[a-z0-9.-]+/.*/$", m.weights_s3_uri))])
    error_message = "weights_s3_uri must look like s3://bucket/prefix/ (with the trailing slash)."
  }

  validation {
    condition     = alltrue([for m in values(var.models) : m.gpu_memory_utilization > 0.1 && m.gpu_memory_utilization < 1])
    error_message = "gpu_memory_utilization must be between 0.1 and 1 (0.90 is typical)."
  }

  validation {
    condition     = length([for m in values(var.models) : m if m.default]) <= 1
    error_message = "At most one model can have default = true."
  }
}

variable "extra_llm_models" {
  description = <<-EOT
    More entries for LLM_MODELS that are NOT hosted on SageMaker by this stack,
    e.g. an OpenAI-compatible server:
      [{ id = "gpt-4o-mini", name = "GPT-4o mini", provider = "openai",
         model_id = "gpt-4o-mini", base_url = "https://api.openai.com/v1",
         api_key = "sk-..." }]
    Same fields as docs/configuration.md. Warning: everything here, including
    api_key, is stored in plain text in the ECS task definition.
  EOT
  # `any` rather than list(any): list(any) forces every entry to have exactly
  # the same fields, which is not true for a mix of providers.
  type    = any
  default = []

  validation {
    condition     = can([for m in var.extra_llm_models : m.id])
    error_message = "extra_llm_models must be a list of objects, each with at least an \"id\"."
  }
}

variable "vllm_dlc_image" {
  description = <<-EOT
    The AWS vLLM Deep Learning Container used by models with container = "dlc".
    null = 763104351884.dkr.ecr.<aws_region>.amazonaws.com/vllm:0.30-gpu-py312-cu130-ubuntu24.04-sagemaker
    (a moving tag that gets patch releases; pin e.g.
    "...:0.30.0-gpu-py312-cu130-ubuntu24.04-sagemaker-v1.1" for repeatable
    builds). A few opt-in regions host the DLCs in a different AWS account: check
    AWS's "available_images" list for your region.
  EOT
  type        = string
  default     = null
}

variable "hf_token" {
  description = <<-EOT
    Hugging Face access token, only needed for GATED models (the ones where you
    must accept a license on huggingface.co first). It is passed to the
    SageMaker container as HF_TOKEN and is visible in the SageMaker console
    (model -> container environment). Use a read-only token.
  EOT
  type        = string
  default     = ""
  sensitive   = true
  nullable    = false
}

variable "sagemaker_vpc_isolated" {
  description = <<-EOT
    Advanced. Attach the SageMaker endpoints to the private subnets with a
    security group that only allows HTTPS to S3 (the weights) and the VPC.
    The model container then has no internet access at all. Every model needs
    weights_s3_uri, because Hugging Face is unreachable.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = !var.sagemaker_vpc_isolated || alltrue([for m in values(var.models) : m.weights_s3_uri != null])
    error_message = "sagemaker_vpc_isolated = true needs weights_s3_uri on every model: an isolated endpoint cannot download from Hugging Face. Stage the weights with scripts/stage-weights.sh."
  }
}

variable "sagemaker_interface_endpoints" {
  description = <<-EOT
    Only with sagemaker_vpc_isolated: extra interface VPC endpoints to create in
    the private subnets, e.g. ["ecr.api", "ecr.dkr", "logs"]. AWS's guide for
    VPC-attached endpoints asks only for the S3 gateway endpoint (always
    created); add these if an isolated endpoint fails to pull its image or
    write logs. Each costs about $0.01/hour per AZ.
  EOT
  type        = list(string)
  default     = []
}

variable "enable_vllm_router_repo" {
  description = "Create the vllm-router ECR repository (needed for models with container = \"router\")."
  type        = bool
  default     = false
}

variable "vllm_router_image_tag" {
  description = "Tag of the vllm-router image (pushed by .github/workflows/build-vllm-router.yml)."
  type        = string
  default     = "latest"
}

# ============================================================== CI/CD =======

variable "enable_github_oidc" {
  description = "Create an IAM role that GitHub Actions can assume (OIDC, no stored AWS keys) to deploy."
  type        = bool
  default     = false
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    An AWS account can register the GitHub OIDC provider only once. Set false if
    it already exists (IAM -> Identity providers -> token.actions.githubusercontent.com).
  EOT
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "\"owner/repo\" that may assume the deploy role, e.g. \"your-name/private-llm-chat-sagemaker-aws\"."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_github_oidc || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "enable_github_oidc needs github_repository = \"owner/repo\"."
  }
}

variable "github_oidc_subjects" {
  description = <<-EOT
    Which workflow runs of that repository may assume the role, appended to
    "repo:<owner>/<repo>:". The default allows only runs on the main branch
    (push and workflow_dispatch). ["*"] would allow any branch.
  EOT
  type        = list(string)
  default     = ["ref:refs/heads/main"]
}

variable "github_terraform_apply" {
  description = <<-EOT
    Also give the deploy role the permissions `terraform apply` needs, so the
    workflow can apply infrastructure changes (requires an S3 state backend).
    That is close to admin rights on this account: anyone who can push to main
    can change your infrastructure. false = the role can only push images and
    update ECS services.
  EOT
  type        = bool
  default     = false
}
