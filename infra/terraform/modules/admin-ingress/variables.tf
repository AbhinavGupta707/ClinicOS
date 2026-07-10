variable "name_prefix" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "access_log_bucket_id" { type = string }
variable "hostname" { type = string }
variable "private_zone_id" {
  type        = string
  description = "Pre-existing private Route53 zone ID supplied by the account/DNS owner."
}
variable "certificate_arn" { type = string }
variable "allowed_operator_cidrs" {
  type        = set(string)
  description = "Private/VPN/JIT operator source CIDRs; the ALB itself is internal."
  validation {
    condition     = length(var.allowed_operator_cidrs) > 0 && alltrue([for cidr in var.allowed_operator_cidrs : can(cidrnetmask(cidr))])
    error_message = "At least one valid private/VPN/JIT operator CIDR is required."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
