variable "name_prefix" {
  description = "Lowercase prefix used for KMS aliases and tags."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]{3,40}$", var.name_prefix))
    error_message = "name_prefix must contain 3-40 lowercase letters, numbers, or hyphens."
  }
}

variable "account_id" {
  description = "AWS account that owns the keys. Used only to construct least-privilege policies."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  description = "AWS region in which the keys are created."
  type        = string
}

variable "deletion_window_in_days" {
  description = "Waiting period before a scheduled KMS deletion can complete."
  type        = number
  default     = 30

  validation {
    condition     = var.deletion_window_in_days >= 14 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 14 and 30 days."
  }
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
