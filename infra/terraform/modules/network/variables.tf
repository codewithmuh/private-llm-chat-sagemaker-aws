variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "region" {
  description = "AWS region (for the S3 endpoint service name)."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC IP range. Must be at least a /20 so the /24 subnets fit."
  type        = string
}

variable "enable_nat_gateway" {
  description = "Run the ECS tasks in private subnets behind one NAT gateway (true), or in public subnets with public IPs (false)."
  type        = bool
}

variable "api_port" {
  description = "Port the api container listens on."
  type        = number
}

variable "web_port" {
  description = "Port the web container listens on."
  type        = number
}
