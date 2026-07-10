variable "enabled" { type = bool }
variable "name_prefix" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "access_log_bucket_id" { type = string }
variable "logs_kms_key_arn" { type = string }
variable "log_retention_days" { type = number }
variable "allowed_ipv4_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]

  validation {
    condition     = length(var.allowed_ipv4_cidrs) > 0 && alltrue([for cidr in var.allowed_ipv4_cidrs : can(cidrnetmask(cidr))])
    error_message = "allowed_ipv4_cidrs must contain valid IPv4 CIDRs."
  }
}
variable "certificate_arn" {
  type     = string
  default  = null
  nullable = true
}
variable "create_certificate" {
  type    = bool
  default = false
}
variable "domain_names" {
  type    = list(string)
  default = []
}
variable "hosted_zone_id" {
  type     = string
  default  = null
  nullable = true
}
variable "manage_dns" {
  type    = bool
  default = false
}
variable "waf_rate_limit_per_five_minutes" {
  type    = number
  default = 2000
}
variable "target_groups" {
  type = map(object({
    port          = number
    health_path   = string
    host_headers  = list(string)
    path_patterns = list(string)
    priority      = number
  }))
  default = {}
}
variable "tags" {
  type    = map(string)
  default = {}
}
