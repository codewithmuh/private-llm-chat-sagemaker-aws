variable "name" {
  description = "Prefix for resource names (max 28 characters: ALB names are limited to 32)."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Public subnets in at least two AZs."
  type        = list(string)
}

variable "security_group_id" {
  description = "ALB security group (HTTP from CloudFront only)."
  type        = string
}

variable "api_port" {
  type = number
}

variable "web_port" {
  type = number
}

variable "deletion_protection" {
  description = "Block deleting the ALB (prod)."
  type        = bool
}
