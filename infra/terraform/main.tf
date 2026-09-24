# Private LLM Chat on AWS: the whole stack in one place.
#
#   browser --HTTPS--> CloudFront --HTTP + secret header--> ALB
#                                                     |-- /api/*, /admin/*, /django-static/* --> ECS "api" (Django)
#                                                     '-- everything else ---------------------> ECS "web" (Next.js)
#   api --> RDS PostgreSQL, S3 (uploads), SES (email), SageMaker endpoints (the LLMs)
#   ECS "gpu-controller" (same image as api) --> creates/deletes the SageMaker endpoints
#
# Read this file top to bottom: each block is one building block, and the
# comments say why it is there. The modules/ folder holds the details.

locals {
  name    = "${var.project}-${var.environment}"
  is_prod = var.environment == "prod"

  default_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Container ports. They must match the Dockerfiles (docs/configuration.md).
  api_port = 8000
  web_port = 3000
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# ============================================================== network ======
# VPC, subnets, routing, and the security groups (who may talk to whom).

module "network" {
  source = "./modules/network"

  name               = local.name
  region             = var.aws_region
  vpc_cidr           = var.vpc_cidr
  enable_nat_gateway = var.enable_nat_gateway
  api_port           = local.api_port
  web_port           = local.web_port
}

# ============================================================= database ======

module "database" {
  source = "./modules/database"

  name              = local.name
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.db_security_group_id
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  multi_az          = var.db_multi_az
  is_prod           = local.is_prod
}

# ============================================================== storage ======
# Files users attach to chats. Private: the browser uploads through the API,
# never directly to S3.

module "storage" {
  source = "./modules/storage"

  name            = local.name
  account_id      = data.aws_caller_identity.current.account_id
  uploads_prefix  = var.uploads_prefix
  expiration_days = var.uploads_expiration_days
  force_destroy   = !local.is_prod
}

# ================================================================== ecr ======
# Private registries for the images we build. The vLLM container for the
# default "dlc" models is AWS's own image and needs no repository here.

module "ecr" {
  source = "./modules/ecr"

  name           = local.name
  repositories   = concat(["api", "web"], var.enable_vllm_router_repo ? ["vllm-router"] : [])
  force_delete   = !local.is_prod
  immutable_tags = local.is_prod
}

# ================================================================== alb ======
# The load balancer. Only CloudFront can reach it, and only requests carrying
# CloudFront's secret header are forwarded to the app.

module "alb" {
  source = "./modules/alb"

  name                = local.name
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  security_group_id   = module.network.alb_security_group_id
  api_port            = local.api_port
  web_port            = local.web_port
  deletion_protection = local.is_prod
}

# ================================================================== cdn ======
# CloudFront: HTTPS for users, one domain for web + api, caching of static files.

module "cdn" {
  source = "./modules/cdn"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                 = local.name
  alb_dns_name         = module.alb.dns_name
  origin_verify_secret = module.alb.origin_verify_secret
  domain_name          = var.domain_name
  route53_zone_id      = var.route53_zone_id
  price_class          = var.cloudfront_price_class
}

# ================================================================ email ======

module "email" {
  source = "./modules/email"

  from_name       = var.app_name
  from_email      = var.ses_from_email
  domain          = var.ses_domain
  route53_zone_id = var.route53_zone_id
}

# ============================================================ sagemaker ======
# One SageMaker model + endpoint configuration per entry in var.models.
# The endpoints themselves are created on demand by the gpu-controller.

module "sagemaker" {
  source = "./modules/sagemaker"

  name       = local.name
  region     = var.aws_region
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  models     = var.models
  hf_token   = var.hf_token

  dlc_image          = coalesce(var.vllm_dlc_image, "763104351884.dkr.ecr.${var.aws_region}.amazonaws.com/vllm:0.30-gpu-py312-cu130-ubuntu24.04-sagemaker")
  router_image       = var.enable_vllm_router_repo ? "${module.ecr.repository_urls["vllm-router"]}:${var.vllm_router_image_tag}" : null
  log_retention_days = var.log_retention_days

  vpc_isolated        = var.sagemaker_vpc_isolated
  vpc_id              = module.network.vpc_id
  vpc_cidr            = module.network.vpc_cidr
  private_subnet_ids  = module.network.private_subnet_ids
  s3_prefix_list_id   = module.network.s3_prefix_list_id
  interface_endpoints = var.sagemaker_interface_endpoints
}

# ======================================================== django secret ======
# DJANGO_SECRET_KEY signs sessions and password-reset links. Generated once and
# kept in Secrets Manager; ECS injects it into the containers at start-up, so
# it never appears in the task definition.

resource "random_password" "django_secret_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name}/app"
  description = "Django secret key for ${local.name}"
  # 0 = delete immediately on destroy. With the default 30-day recovery window,
  # re-creating the stack under the same name fails for a month with
  # "a secret with this name is already scheduled for deletion".
  recovery_window_in_days = local.is_prod ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ DJANGO_SECRET_KEY = random_password.django_secret_key.result })
}

# ========================================================== app settings =====
# Exactly what the Django containers (api and gpu-controller) receive.
# docs/configuration.md documents each variable.

locals {
  # With a custom domain the app lives there; otherwise at the CloudFront name.
  # Note the order of creation this implies: ALB -> CloudFront -> this value ->
  # ECS task definitions. Nothing in the ALB or CloudFront depends on ECS, so
  # there is no cycle.
  app_host   = coalesce(var.domain_name, module.cdn.cloudfront_domain_name)
  public_url = "https://${local.app_host}"

  # SageMaker models from this stack first, then any extra providers.
  llm_models = concat(module.sagemaker.llm_models, var.extra_llm_models)

  django_environment = merge(
    {
      DJANGO_SETTINGS_MODULE = "config.settings.production"
      PUBLIC_URL             = local.public_url
      ALLOWED_HOSTS          = local.app_host
      # CloudFront talks to the ALB over plain HTTP, so X-Forwarded-Proto says
      # "http". CloudFront-Forwarded-Proto carries what the BROWSER used.
      PROXY_SSL_HEADER = "HTTP_CLOUDFRONT_FORWARDED_PROTO"

      DB_HOST    = module.database.address
      DB_PORT    = tostring(module.database.port)
      DB_NAME    = module.database.db_name
      DB_USER    = module.database.username
      DB_SSLMODE = "require"

      STORAGE_BACKEND = "s3"
      S3_BUCKET       = module.storage.bucket_name
      S3_PREFIX       = var.uploads_prefix
      AWS_REGION      = var.aws_region

      EMAIL_PROVIDER     = module.email.provider
      DEFAULT_FROM_EMAIL = module.email.default_from_email

      APP_NAME           = var.app_name
      GOOGLE_CLIENT_ID   = var.google_client_id
      ADMIN_EMAILS       = join(",", var.admin_emails)
      SIGNUP_ENABLED     = tostring(var.signup_enabled)
      EMAIL_VERIFICATION = var.email_verification
      ENABLE_ADMIN       = tostring(var.enable_admin)

      LLM_MODELS = jsonencode(local.llm_models)
    },
    var.extra_environment,
  )

  # Secrets are injected by ECS from Secrets Manager at container start.
  # Format: "<secret arn>:<json key>::" picks one key of a JSON secret.
  django_secrets = {
    DJANGO_SECRET_KEY = "${aws_secretsmanager_secret_version.app.secret_arn}:DJANGO_SECRET_KEY::"
    DB_PASSWORD       = "${module.database.password_secret_arn}:password::"
  }
}

# ================================================================== ecs ======

module "ecs" {
  source = "./modules/ecs"

  name       = local.name
  region     = var.aws_region
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  subnet_ids        = module.network.app_subnet_ids
  assign_public_ip  = module.network.app_subnets_are_public
  security_group_id = module.network.app_security_group_id

  api_target_group_arn = module.alb.api_target_group_arn
  web_target_group_arn = module.alb.web_target_group_arn
  api_port             = local.api_port
  web_port             = local.web_port

  # Until the first images are pushed (image_tag = null) the services run zero
  # tasks, so a first `terraform apply` does not start containers that cannot
  # be pulled.
  api_image = "${module.ecr.repository_urls["api"]}:${coalesce(var.image_tag, "not-built-yet")}"
  web_image = "${module.ecr.repository_urls["web"]}:${coalesce(var.image_tag, "not-built-yet")}"
  run_tasks = var.image_tag != null

  django_environment = local.django_environment
  django_secrets     = local.django_secrets
  secret_arns        = [aws_secretsmanager_secret.app.arn, module.database.password_secret_arn]

  uploads_bucket_arn = module.storage.bucket_arn
  uploads_prefix     = var.uploads_prefix
  ses_enabled        = module.email.enabled

  sagemaker_endpoint_arn_pattern        = module.sagemaker.endpoint_arn_pattern
  sagemaker_endpoint_config_arn_pattern = module.sagemaker.endpoint_config_arn_pattern

  api_cpu               = var.api_cpu
  api_memory            = var.api_memory
  api_desired_count     = var.api_desired_count
  web_cpu               = var.web_cpu
  web_memory            = var.web_memory
  web_desired_count     = var.web_desired_count
  gpu_controller_cpu    = var.gpu_controller_cpu
  gpu_controller_memory = var.gpu_controller_memory

  log_retention_days     = var.log_retention_days
  enable_execute_command = !local.is_prod

  # ECS refuses to create a service whose target group is not yet attached to a
  # load balancer listener ("target group does not have an associated load
  # balancer"). Waiting for the whole ALB module guarantees the listener rules
  # exist first.
  depends_on = [module.alb]
}

# ================================================================= cicd ======
# Optional: lets GitHub Actions deploy without any AWS keys stored in GitHub.

module "cicd" {
  source = "./modules/cicd"
  count  = var.enable_github_oidc ? 1 : 0

  name       = local.name
  region     = var.aws_region
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  github_repository    = var.github_repository
  oidc_subjects        = var.github_oidc_subjects
  create_oidc_provider = var.create_github_oidc_provider

  ecr_repository_arns = values(module.ecr.repository_arns)
  ecs_cluster_name    = module.ecs.cluster_name
  pass_role_arns      = module.ecs.role_arns
  allow_terraform     = var.github_terraform_apply
}
