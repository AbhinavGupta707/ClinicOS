variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "service_ports" { type = set(number) }
variable "alb_security_group_id" {
  type     = string
  default  = null
  nullable = true
}
variable "alb_enabled" {
  type    = bool
  default = false
}
variable "alb_target_ports" {
  type    = set(number)
  default = []
}
variable "admin_alb_enabled" {
  type    = bool
  default = false
}
variable "admin_alb_security_group_id" {
  type     = string
  default  = null
  nullable = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
