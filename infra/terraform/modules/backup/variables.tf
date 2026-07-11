variable "name_prefix" { type = string }
variable "vault_kms_key_arn" { type = string }
variable "dr_vault_arn" {
  type     = string
  default  = null
  nullable = true
}
variable "create_plan" {
  type    = bool
  default = false
}
variable "resource_arns" {
  type        = list(string)
  description = "Exact environment-owned resources protected by this plan."
  default     = []
}
variable "daily_retention_days" {
  type    = number
  default = 35
}
variable "monthly_retention_days" {
  type    = number
  default = 365
}
variable "vault_lock_enabled" {
  type    = bool
  default = false
}
variable "vault_lock_changeable_days" {
  type    = number
  default = 7
}
variable "tags" {
  type    = map(string)
  default = {}
}
