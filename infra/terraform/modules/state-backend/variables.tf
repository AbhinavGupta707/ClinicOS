variable "account_id" {
  type        = string
  description = "Standalone AWS account that owns the ClinicOS Terraform backend."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  type        = string
  description = "Region containing the state bucket, KMS key, and lock table."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique dedicated Terraform state bucket name."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be a valid S3 bucket name."
  }
}

variable "lock_table_name" {
  type        = string
  description = "DynamoDB state lock table name."
  default     = "clinicos-terraform-locks"
}

variable "state_keys" {
  type        = set(string)
  description = "Closed list of state objects covered by the generated least-access policy."

  validation {
    condition = length(var.state_keys) >= 3 && alltrue([
      for key in var.state_keys : startswith(key, "clinicos/") && endswith(key, "/terraform.tfstate")
    ])
    error_message = "state_keys must contain at least the baseline and two environment keys under clinicos/*/terraform.tfstate."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
