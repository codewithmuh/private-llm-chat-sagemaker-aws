variable "name" {
  description = "Prefix for resource names; also the cluster name."
  type        = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "partition" {
  type = string
}

# ---------------------------------------------------------------- network ---

variable "subnet_ids" {
  description = "Subnets for the tasks (public without NAT, private with NAT)."
  type        = list(string)
}

variable "assign_public_ip" {
  description = "Give each task a public IP (needed in public subnets without NAT)."
  type        = bool
}

variable "security_group_id" {
  description = "Security group of the tasks (ingress only from the ALB)."
  type        = string
}

variable "api_target_group_arn" {
  type = string
}

variable "web_target_group_arn" {
  type = string
}

variable "api_port" {
  type = number
}

variable "web_port" {
  type = number
}

# ---------------------------------------------------------------- images ----

variable "api_image" {
  description = "Full image URI of the Django image (api and gpu-controller)."
  type        = string
}

variable "web_image" {
  description = "Full image URI of the Next.js image."
  type        = string
}

variable "run_tasks" {
  description = "false = create the services with zero tasks (no image pushed yet)."
  type        = bool
}

# ----------------------------------------------------------- app settings ---

variable "django_environment" {
  description = "Environment variables for the api and gpu-controller containers."
  type        = map(string)
}

variable "django_secrets" {
  description = "Secrets injected by ECS: env var name => Secrets Manager valueFrom."
  type        = map(string)
}

variable "secret_arns" {
  description = "ARNs of the secrets referenced in django_secrets (for the execution role)."
  type        = list(string)
}

# ------------------------------------------------------ what the app uses ---

variable "uploads_bucket_arn" {
  type = string
}

variable "uploads_prefix" {
  type = string
}

variable "ses_enabled" {
  description = "Allow the api to send email through SES."
  type        = bool
}

variable "sagemaker_endpoint_arn_pattern" {
  description = "arn:...:endpoint/<name>-*"
  type        = string
}

variable "sagemaker_endpoint_config_arn_pattern" {
  description = "arn:...:endpoint-config/<name>-*"
  type        = string
}

# ----------------------------------------------------------------- sizing ---
# Fargate only accepts certain CPU/memory pairs, e.g. 256 CPU with 512-2048 MiB,
# 512 CPU with 1024-4096 MiB, 1024 CPU with 2048-8192 MiB.

variable "api_cpu" {
  type = number
}

variable "api_memory" {
  type = number
}

variable "api_desired_count" {
  type = number
}

variable "web_cpu" {
  type = number
}

variable "web_memory" {
  type = number
}

variable "web_desired_count" {
  type = number
}

variable "gpu_controller_cpu" {
  type = number
}

variable "gpu_controller_memory" {
  type = number
}

# --------------------------------------------------------------- operations -

variable "log_retention_days" {
  type = number
}

variable "enable_execute_command" {
  description = "Allow ECS Exec (a shell inside the api and gpu-controller containers)."
  type        = bool
}
