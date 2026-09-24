variable "name" {
  description = "Prefix for resource names; endpoints are named \"<name>-<model slug>\"."
  type        = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "partition" {
  description = "\"aws\" (or aws-cn / aws-us-gov), for building ARNs."
  type        = string
}

variable "models" {
  description = "The models to host. Type and defaults are defined on the root variable (../../variables.tf), so they live in one place."
  type        = any
}

variable "hf_token" {
  description = "Hugging Face token for gated models; empty if not needed."
  type        = string
  default     = ""
  sensitive   = true
  nullable    = false
}

variable "dlc_image" {
  description = "Image URI of the AWS vLLM Deep Learning Container."
  type        = string
}

variable "router_image" {
  description = "Image URI of our vllm-router image, or null if its repository is not enabled."
  type        = string
  default     = null
}

variable "log_retention_days" {
  type = number
}

variable "vpc_isolated" {
  description = "Attach the endpoints to the private subnets with S3-only egress."
  type        = bool
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "s3_prefix_list_id" {
  description = "Prefix list of the VPC's S3 gateway endpoint."
  type        = string
}

variable "interface_endpoints" {
  description = "Interface VPC endpoint services to create when isolated, e.g. [\"ecr.api\", \"ecr.dkr\", \"logs\"]."
  type        = list(string)
  default     = []
}
