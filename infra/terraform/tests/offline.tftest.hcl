# Offline tests for the wiring of this stack.
#
#   terraform -chdir=infra/terraform init -backend=false
#   terraform -chdir=infra/terraform test
#
# Every provider is MOCKED: no AWS account, no credentials, nothing is created
# and nothing is billed. The "apply" below only runs against fake providers
# that invent ids and ARNs. What it checks is our own logic: the environment
# the containers get, the LLM_MODELS JSON, SageMaker names and the
# preconditions.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b", "us-east-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { domain_name = "d1234abcdef.cloudfront.net", hosted_zone_id = "Z2FDTNDATAQYW2" }
  }
  mock_resource "aws_db_instance" {
    defaults = { address = "llmchat-dev-db.abc123.us-east-1.rds.amazonaws.com", port = 5432 }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com/llmchat-dev/repo" }
  }
  mock_resource "aws_secretsmanager_secret_version" {
    defaults = { secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:llmchat-dev/x-AbCdEf" }
  }
  # The provider still validates ARN arguments, so fake ARNs must look real.
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:llmchat-dev/x-AbCdEf" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/mock/0123456789abcdef", dns_name = "mock-alb-123.us-east-1.elb.amazonaws.com" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::llmchat-dev-uploads-123456789012" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/llmchat-dev" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:123456789012:log-group:mock" }
  }
  mock_resource "aws_sagemaker_model" {
    defaults = { arn = "arn:aws:sagemaker:us-east-1:123456789012:model/mock" }
  }
  mock_resource "aws_sagemaker_endpoint_configuration" {
    defaults = { arn = "arn:aws:sagemaker:us-east-1:123456789012:endpoint-config/mock" }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
}

# ------------------------------------------------------------- defaults ----

run "defaults" {
  command = apply

  assert {
    condition     = local.django_environment["ALLOWED_HOSTS"] == "d1234abcdef.cloudfront.net"
    error_message = "ALLOWED_HOSTS should be the CloudFront domain when no custom domain is set."
  }

  assert {
    condition     = local.django_environment["PUBLIC_URL"] == "https://d1234abcdef.cloudfront.net"
    error_message = "PUBLIC_URL should be https://<cloudfront domain>."
  }

  assert {
    condition     = local.django_environment["EMAIL_PROVIDER"] == "console"
    error_message = "Without an SES identity the email provider must be console."
  }

  assert {
    condition     = local.django_environment["DJANGO_SETTINGS_MODULE"] == "config.settings.production" && local.django_environment["PROXY_SSL_HEADER"] == "HTTP_CLOUDFRONT_FORWARDED_PROTO"
    error_message = "Production settings and the CloudFront proto header must be set."
  }

  assert {
    condition     = jsondecode(local.django_environment["LLM_MODELS"])[0].model_id == "Qwen/Qwen3-VL-8B-Instruct-FP8"
    error_message = "LLM_MODELS[0].model_id should be the Hugging Face id."
  }

  assert {
    condition     = output.llm_models[0].endpoint_name == "llmchat-dev-qwen3-vl-8b" && output.llm_models[0].provider == "sagemaker"
    error_message = "Endpoint name should be <project>-<env>-<slug>."
  }

  assert {
    condition     = can(regex("^llmchat-dev-qwen3-vl-8b-[0-9a-f]{8}$", output.llm_models[0].endpoint_config_name))
    error_message = "Endpoint configuration names should be content-addressed: <endpoint name>-<8 hex>."
  }

  assert {
    condition     = output.llm_models[0].context_window == 32768 && output.llm_models[0].sort == 10 && output.llm_models[0].default
    error_message = "context_window/sort/default not mapped as documented."
  }

  assert {
    condition     = local.django_secrets["DB_PASSWORD"] == "arn:aws:secretsmanager:us-east-1:123456789012:secret:llmchat-dev/x-AbCdEf:password::"
    error_message = "DB_PASSWORD must reference the JSON key \"password\" of the database secret."
  }
}

# ------------------------------------- token, SES, extra (mixed) providers --

run "extras" {
  command = apply

  variables {
    image_tag      = "abc123def456"
    hf_token       = "hf_not_a_real_token"
    ses_from_email = "no-reply@example.com"
    admin_emails   = ["ada@example.com", "alan@example.com"]
    # Entries with different fields: must not fail type unification.
    extra_llm_models = [
      { id = "gpt-4o-mini", name = "GPT-4o mini", provider = "openai", model_id = "gpt-4o-mini", base_url = "https://api.openai.com/v1", api_key = "sk-test" },
      { id = "local", provider = "openai", model_id = "llama3", base_url = "http://ollama:11434/v1", sort = 99 },
    ]
  }

  assert {
    condition     = length(output.llm_models) == 3 && output.llm_models[1].id == "gpt-4o-mini"
    error_message = "extra_llm_models should be appended after the SageMaker models."
  }

  assert {
    condition     = !contains(keys(output.llm_models[1]), "api_key")
    error_message = "The llm_models output must not print api keys."
  }

  assert {
    condition     = local.django_environment["EMAIL_PROVIDER"] == "ses" && local.django_environment["DEFAULT_FROM_EMAIL"] == "Private LLM Chat <no-reply@example.com>"
    error_message = "With ses_from_email the provider is ses and the From header uses the app name."
  }

  assert {
    condition     = local.django_environment["ADMIN_EMAILS"] == "ada@example.com,alan@example.com"
    error_message = "ADMIN_EMAILS should be comma-separated."
  }
}

# --------------------------------------------------------- preconditions ----

run "isolated_needs_s3_weights" {
  command = plan

  variables {
    sagemaker_vpc_isolated = true
  }

  expect_failures = [var.sagemaker_vpc_isolated]
}

run "slug_too_long" {
  command = plan

  variables {
    models = {
      "a-model-slug-that-is-far-too-long-for-sagemaker-names" = {
        name        = "Too long"
        hf_model_id = "Qwen/Qwen3-VL-8B-Instruct-FP8"
      }
    }
  }

  expect_failures = [var.models]
}

run "isolated_with_s3_weights" {
  command = apply

  variables {
    sagemaker_vpc_isolated        = true
    sagemaker_interface_endpoints = ["ecr.api", "ecr.dkr", "logs"]
    models = {
      "qwen3-vl-8b" = {
        name           = "Qwen3-VL 8B"
        hf_model_id    = "Qwen/Qwen3-VL-8B-Instruct-FP8"
        vision         = true
        weights_s3_uri = "s3://my-weights-bucket/qwen3-vl-8b/"
      }
    }
  }

  assert {
    condition     = output.llm_models[0].model_id == "Qwen/Qwen3-VL-8B-Instruct-FP8"
    error_message = "The served model name stays the Hugging Face id when weights come from S3."
  }
}
