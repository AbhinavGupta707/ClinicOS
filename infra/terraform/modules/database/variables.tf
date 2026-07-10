variable "name_prefix" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "application_security_group_id" { type = string }
variable "data_kms_key_arn" { type = string }
variable "secrets_kms_key_arn" { type = string }
variable "logs_kms_key_arn" { type = string }
variable "engine_version" { type = string }
variable "parameter_group_family" { type = string }
variable "instance_class" { type = string }
variable "allocated_storage_gib" { type = number }
variable "max_allocated_storage_gib" { type = number }
variable "multi_az" { type = bool }
variable "backup_retention_days" { type = number }
variable "log_retention_days" { type = number }
variable "performance_insights_retention_days" { type = number }
variable "enhanced_monitoring_interval_seconds" {
  type        = number
  default     = 60
  description = "Production-equivalent RDS Enhanced Monitoring interval."
  validation {
    condition     = contains([1, 5, 10, 15, 30, 60], var.enhanced_monitoring_interval_seconds) && var.enhanced_monitoring_interval_seconds > 0
    error_message = "Enhanced Monitoring must be enabled with an AWS-supported nonzero interval."
  }
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
