output "cloudfront_domain_name" {
  description = "xxxx.cloudfront.net"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  description = "For cache invalidations: aws cloudfront create-invalidation --distribution-id <id> --paths '/*'"
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}
