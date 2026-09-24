output "repository_urls" {
  description = "Map of short name => repository URL (<account>.dkr.ecr.<region>.amazonaws.com/<name>/<repo>)."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "repository_arns" {
  value = { for k, r in aws_ecr_repository.this : k => r.arn }
}
