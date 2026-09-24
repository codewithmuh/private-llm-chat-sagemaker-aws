# Printed after every `terraform apply`; read one later with
#   terraform -chdir=infra/terraform output <name>
# Several are read by scripts/deploy.sh and scripts/gpu.sh.

output "app_url" {
  description = "Open this in your browser."
  value       = local.public_url
}

output "aws_region" {
  value = var.aws_region
}

output "name_prefix" {
  description = "Prefix of every resource name (\"<project>-<environment>\")."
  value       = local.name
}

output "cloudfront_domain_name" {
  value = module.cdn.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "alb_dns_name" {
  description = "The load balancer. Opening it directly returns 403: only CloudFront is let through."
  value       = module.alb.dns_name
}

output "ecr_repository_urls" {
  description = "Where scripts/deploy.sh pushes the images."
  value       = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_names" {
  value = module.ecs.service_names
}

output "ecs_log_groups" {
  description = "CloudWatch log groups of the containers (aws logs tail <group> --follow)."
  value       = module.ecs.log_groups
}

output "sagemaker_endpoints" {
  description = "Per model: endpoint name (it exists only while the GPU runs), configuration, instance, cost."
  value       = module.sagemaker.endpoints
}

output "sagemaker_endpoint_names" {
  value = { for slug, e in module.sagemaker.endpoints : slug => e.endpoint_name }
}

output "sagemaker_endpoint_config_names" {
  value = { for slug, e in module.sagemaker.endpoints : slug => e.endpoint_config_name }
}

output "llm_models" {
  description = "The LLM_MODELS list given to the api (api_key fields removed)."
  value       = [for m in local.llm_models : { for k, v in m : k => v if k != "api_key" }]
}

output "uploads_bucket" {
  value = module.storage.bucket_name
}

output "rds_endpoint" {
  description = "Database host name (private: reachable only from the ECS tasks)."
  value       = module.database.address
}

output "email_provider" {
  description = "\"ses\" or \"console\" (console = codes are only in the api's CloudWatch logs)."
  value       = module.email.provider
}

output "ses_dns_records" {
  description = "DKIM records to add at your DNS provider (only when ses_domain is not in Route 53)."
  value       = module.email.dkim_records
}

output "github_deploy_role_arn" {
  description = "Store as the AWS_DEPLOY_ROLE_ARN secret in GitHub (null when enable_github_oidc = false)."
  value       = one(module.cicd[*].role_arn)
}

output "next_steps" {
  value = <<-EOT

    ${var.image_tag == null ? "1. Build and push the images, then roll them out:\n     ./scripts/deploy.sh\n   (The ECS services exist but run 0 tasks until then.)" : "1. Deployed image tag: ${var.image_tag}. After code changes: ./scripts/deploy.sh"}

    2. Open the app:  ${local.public_url}
       First load after a deploy can take 1-2 minutes while the api migrates.

    3. Become admin: add your email to admin_emails in terraform.tfvars, apply
       again, then sign up and verify that address.${module.email.provider == "console" ? "\n   Email is in CONSOLE mode: codes are NOT emailed. Read them with\n     aws logs tail ${module.ecs.log_groups["api"]} --follow --region ${var.aws_region}" : ""}

    4. The first chat message wakes the GPU: expect a 5-15 minute cold start
       (status "starting"). With scaling = "on_demand" the endpoint is deleted
       after idle_minutes without use. Check what is running (and costing):
         ./scripts/gpu.sh status

    5. Before `terraform destroy`, stop the GPU endpoints Terraform does not own:
         ./scripts/gpu.sh stop
  EOT
}
