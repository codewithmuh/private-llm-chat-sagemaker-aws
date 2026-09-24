output "dns_name" {
  description = "The ALB's own DNS name. Opening it directly returns 403 by design."
  value       = aws_lb.this.dns_name
}

output "arn" {
  value = aws_lb.this.arn
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "origin_verify_secret" {
  description = "Value CloudFront must send in the X-Origin-Verify header."
  value       = random_password.origin_verify.result
  sensitive   = true
}
