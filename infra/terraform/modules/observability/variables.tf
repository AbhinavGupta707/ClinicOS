variable "name_prefix" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "edge_enabled" { type = bool }
variable "logs_kms_key_arn" { type = string }
variable "ecs_cluster_name" { type = string }
variable "ecs_service_names" { type = map(string) }
variable "db_identifier" { type = string }
variable "cache_replication_group_id" { type = string }
variable "alb_arn_suffix" {
  type     = string
  default  = null
  nullable = true
}
variable "waf_name" {
  type     = string
  default  = null
  nullable = true
}
variable "additional_alarm_action_arns" {
  type    = list(string)
  default = []
}
variable "tags" {
  type    = map(string)
  default = {}
}
