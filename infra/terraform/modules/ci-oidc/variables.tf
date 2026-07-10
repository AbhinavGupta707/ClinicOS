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
variable "ecr_repository_arns" { type = map(string) }
variable "deploy_policy_json" { type = string }
variable "permissions_boundary_arn" {
  type     = string
  default  = null
  nullable = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
