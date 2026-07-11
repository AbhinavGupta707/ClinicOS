variable "aws_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit account ID."
  }
}
variable "primary_region" {
  type    = string
  default = "ap-south-1"
}
variable "dr_region" {
  type    = string
  default = "ap-south-2"
}
variable "offline_validation_mode" {
  type    = bool
  default = true
}
variable "security_log_bucket_name" { type = string }
variable "terraform_state_bucket" { type = string }
variable "terraform_lock_table" { type = string }
variable "terraform_state_kms_key_arn" { type = string }
variable "activation" {
  type = object({
    cloudtrail                = bool
    cloudtrail_s3_data_events = optional(bool, false)
    config                    = bool
    guardduty                 = bool
    security_hub              = bool
    ci_permissions_boundary   = bool
  })
  default = {
    cloudtrail = false, config = false, guardduty = false, security_hub = false, ci_permissions_boundary = false
  }
}
variable "activation_authorized_by" {
  type     = string
  default  = null
  nullable = true
}
variable "cloudtrail_s3_object_arns" {
  type        = set(string)
  default     = []
  description = "Manually reviewed exact media/audit bucket object ARNs from environment outputs."

  validation {
    condition = length(var.cloudtrail_s3_object_arns) <= 16 && alltrue([
      for arn in var.cloudtrail_s3_object_arns : can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/\\*$", arn))
    ])
    error_message = "Supply at most 16 exact bucket object ARNs ending /*; wildcard bucket selectors are forbidden."
  }
}
