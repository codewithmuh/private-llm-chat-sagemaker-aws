output "enabled" {
  description = "true when an SES identity is configured."
  value       = local.enabled
}

output "provider" {
  description = "EMAIL_PROVIDER for the app: \"ses\" or \"console\"."
  value       = local.enabled ? "ses" : "console"
}

output "default_from_email" {
  description = "DEFAULT_FROM_EMAIL, e.g. \"Private LLM Chat <no-reply@example.com>\"."
  value       = "${var.from_name} <${local.from_address}>"
}

output "dkim_records" {
  description = "DKIM CNAME records to add by hand when the domain is not in Route 53."
  value = local.use_domain && var.route53_zone_id == null ? [
    for token in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : {
      name  = "${token}._domainkey.${var.domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ] : []
}
