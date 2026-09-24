variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "partition" {
  type = string
}

variable "github_repository" {
  description = "\"owner/repo\" allowed to assume the role."
  type        = string
}

variable "oidc_subjects" {
  description = "Allowed token subjects after \"repo:<owner>/<repo>:\", e.g. [\"ref:refs/heads/main\"]."
  type        = list(string)
}

variable "create_oidc_provider" {
  description = "Create the account's GitHub OIDC provider (false if it already exists)."
  type        = bool
}

variable "ecr_repository_arns" {
  description = "Repositories the workflow may push to."
  type        = list(string)
}

variable "ecs_cluster_name" {
  description = "Cluster whose services the workflow may update."
  type        = string
}

variable "pass_role_arns" {
  description = "Task and execution roles the workflow may pass to ECS."
  type        = list(string)
}

variable "allow_terraform" {
  description = "Also grant what `terraform apply` of this stack needs (admin-like)."
  type        = bool
}
