variable "name_prefix" { type = string }
variable "kms_key_arn" { type = string }
variable "secret_names" { type = map(string) }
variable "recovery_window_days" { type = number }
variable "tags" {
  type    = map(string)
  default = {}
}
