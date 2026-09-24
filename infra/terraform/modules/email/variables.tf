variable "from_name" {
  description = "Display name in the From header (the app name)."
  type        = string
}

variable "from_email" {
  description = "Address to send from. Verified as a single identity unless domain is set."
  type        = string
  default     = null
}

variable "domain" {
  description = "Domain to verify with DKIM."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Hosted zone of the domain, for the DKIM records."
  type        = string
  default     = null
}
