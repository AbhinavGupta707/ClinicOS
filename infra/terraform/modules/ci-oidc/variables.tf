variable "name_prefix" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "github_repository" { type = string }
variable "github_subject_claims" { type = list(string) }
variable "create_oidc_provider" {
  type    = bool
  default = false
}
variable "oidc_provider_arn" {
  type     = string
  default  = null
  nullable = true
}
variable "oidc_thumbprints" {
  type        = list(string)
  description = "GitHub OIDC CA thumbprints. Reconfirm against the official activation flow before apply."
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  validation {
    condition     = length(var.oidc_thumbprints) > 0 && alltrue([for thumbprint in var.oidc_thumbprints : can(regex("^[a-fA-F0-9]{40}$", thumbprint))])
    error_message = "Each OIDC thumbprint must be exactly 40 hexadecimal characters."
  }
}
variable "state_bucket_name" { type = string }
variable "state_lock_table_name" { type = string }
variable "state_key" { type = string }
variable "state_kms_key_arn" {
  type        = string
  description = "Dedicated customer-managed key protecting Terraform state and locks."
}
variable "ecr_repository_arns" { type = map(string) }
variable "read_policy_json" {
  type        = string
  description = "Explicit Terraform discovery policy. It must not grant object-body or secret-value reads."
}
variable "read_actions" {
  type        = set(string)
  description = "Explicit discovery action inventory used for deterministic sensitive-read assertions."
}
variable "deploy_policy_json" { type = string }
variable "permissions_boundary_arn" {
  type        = string
  description = "Mandatory account-baseline boundary for every GitHub OIDC role."

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/clinicos/", var.permissions_boundary_arn))
    error_message = "permissions_boundary_arn must be an account policy under /clinicos/; environment OIDC roles cannot be created without it."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
