variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the ALB (the origin)."
  type        = string
}

variable "origin_verify_secret" {
  description = "Value of the X-Origin-Verify header the ALB requires."
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Optional custom domain (e.g. chat.example.com)."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Hosted zone of domain_name."
  type        = string
  default     = null
}

variable "price_class" {
  description = "Which CloudFront edge locations to use."
  type        = string
}
