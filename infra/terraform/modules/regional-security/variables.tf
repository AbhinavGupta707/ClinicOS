variable "account_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "config_bucket_name" { type = string }
variable "config_bucket_arn" { type = string }
variable "enable_config" {
  type    = bool
  default = false
}
variable "enable_guardduty" {
  type    = bool
  default = false
}
variable "enable_security_hub" {
  type    = bool
  default = false
}
variable "security_hub_standard_arns" {
  type    = set(string)
  default = []
}
variable "tags" {
  type    = map(string)
  default = {}
}
