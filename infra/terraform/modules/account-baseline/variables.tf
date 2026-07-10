variable "account_id" { type = string }
variable "region" { type = string }
variable "name_prefix" {
  type    = string
  default = "clinicos-account"
}
variable "enable_cloudtrail" {
  type    = bool
  default = false
}
variable "enable_cloudtrail_s3_data_events" {
  type        = bool
  default     = false
  description = "Cost-explicit opt-in for declared ClinicOS S3 object data events."
}
variable "cloudtrail_s3_object_arns" {
  type        = set(string)
  default     = []
  description = "Exact bucket object scopes such as arn:aws:s3:::bucket-name/*; never arn:aws:s3:::*."

  validation {
    condition = length(var.cloudtrail_s3_object_arns) <= 16 && alltrue([
      for arn in var.cloudtrail_s3_object_arns : can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/\\*$", arn))
    ])
    error_message = "Supply at most 16 exact S3 bucket object ARNs ending /*; wildcard bucket selectors are forbidden."
  }
}
variable "enable_config_delivery" {
  type    = bool
  default = false
}
variable "create_ci_permissions_boundary" {
  type    = bool
  default = false
}
variable "log_bucket_name" { type = string }
variable "state_bucket_name" { type = string }
variable "state_lock_table_name" { type = string }
variable "state_kms_key_arn" { type = string }
variable "log_retention_days" {
  type    = number
  default = 365
  validation {
    condition     = var.log_retention_days >= 365
    error_message = "Account security logs require at least 365 days of retention."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
