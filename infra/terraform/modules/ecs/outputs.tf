output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_names" {
  value = {
    api            = aws_ecs_service.api.name
    web            = aws_ecs_service.web.name
    gpu_controller = aws_ecs_service.gpu_controller.name
  }
}

output "log_groups" {
  value = { for k, g in aws_cloudwatch_log_group.this : k => g.name }
}

# The roles a deployer must be allowed to pass (iam:PassRole) when it registers
# a task definition.
output "role_arns" {
  value = [
    aws_iam_role.execution.arn,
    aws_iam_role.api.arn,
    aws_iam_role.web.arn,
    aws_iam_role.gpu_controller.arn,
  ]
}
