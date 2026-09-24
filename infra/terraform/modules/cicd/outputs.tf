output "role_arn" {
  description = "Store as the AWS_DEPLOY_ROLE_ARN secret in the GitHub repository."
  value       = aws_iam_role.deploy.arn
}
