variable "name_prefix" { type = string }
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
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
