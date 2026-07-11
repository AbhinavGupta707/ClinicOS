variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "application_security_group_id" { type = string }
variable "data_kms_key_arn" { type = string }
variable "secrets_kms_key_arn" { type = string }
variable "node_type" { type = string }
variable "engine_version" { type = string }
variable "node_count" { type = number }
variable "snapshot_retention_days" { type = number }
variable "secret_recovery_window_days" { type = number }
variable "tags" {
  type    = map(string)
  default = {}
}
