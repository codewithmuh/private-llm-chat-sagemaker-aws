variable "name" {
  description = "Prefix for repository names (\"<name>/api\")."
  type        = string
}

variable "repositories" {
  description = "Short names of the repositories to create."
  type        = list(string)
}

variable "keep_images" {
  description = "How many images to keep per repository."
  type        = number
  default     = 20
}

variable "force_delete" {
  description = "Allow destroying a repository that still contains images."
  type        = bool
}

variable "immutable_tags" {
  description = "Forbid overwriting an existing tag."
  type        = bool
}
