variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets (two AZs) for the database."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group of the database (allows 5432 from the ECS tasks)."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "17"
}

variable "instance_class" {
  description = "RDS instance size."
  type        = string
}

variable "allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
}

variable "multi_az" {
  description = "Keep a synchronous standby in a second AZ."
  type        = bool
}

variable "db_name" {
  description = "Name of the database the app uses (DB_NAME)."
  type        = string
  default     = "llmchat"
}

variable "username" {
  description = "Master user the app connects as (DB_USER)."
  type        = string
  default     = "llmchat"
}

variable "is_prod" {
  description = "Turns on deletion protection and the final snapshot."
  type        = bool
}
