variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "account_id" {
  description = "AWS account id, to make the bucket name globally unique."
  type        = string
}

variable "uploads_prefix" {
  description = "Key prefix the app writes under (S3_PREFIX)."
  type        = string
}

variable "expiration_days" {
  description = "Delete uploads after this many days; 0 = never."
  type        = number
}

variable "force_destroy" {
  description = "Allow `terraform destroy` to delete a bucket that still holds files."
  type        = bool
}
