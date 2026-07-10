variable "aws_account_id" {
  type        = string
  description = "AWS account for the isolated staging environment."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "primary_region" {
  type        = string
  default     = "ap-south-1"
  description = "Mumbai primary region."
  validation {
    condition     = var.primary_region == "ap-south-1"
    error_message = "ClinicOS staging primary_region must remain ap-south-1."
  }
}

variable "dr_region" {
  type        = string
  default     = "ap-south-2"
  description = "Hyderabad recovery region."
  validation {
    condition     = var.dr_region == "ap-south-2"
    error_message = "ClinicOS staging dr_region must remain ap-south-2."
  }
}

variable "offline_validation_mode" {
  type        = bool
  default     = true
  description = "Uses non-secret mock provider credentials and disables AWS account calls for deterministic local plans. Must be false for any authorized apply."
}

variable "terraform_state_bucket" { type = string }
variable "terraform_lock_table" { type = string }
variable "github_repository" { type = string }
variable "github_subject_claims" { type = list(string) }
variable "create_github_oidc_provider" {
  type    = bool
  default = false
}
variable "github_oidc_provider_arn" {
  type     = string
  default  = null
  nullable = true
}
variable "github_oidc_thumbprints" {
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  description = "Reconfirm through GitHub/AWS official activation docs immediately before apply."
}
variable "permissions_boundary_arn" {
  type     = string
  default  = null
  nullable = true
}

variable "enable_runtime" {
  type        = bool
  default     = false
  description = "Creates ECS services only after all image_uris are signed digest references and runtime secrets are populated."
}
variable "image_uris" {
  type        = map(string)
  default     = {}
  description = "Immutable image URIs keyed by adot, api, keycloak, temporal, web, and worker."
}

variable "enable_public_ingress" {
  type        = bool
  default     = false
  description = "Creates ALB/WAF only when the explicit TLS inputs are complete."
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
variable "hosted_zone_id" {
  type     = string
  default  = null
  nullable = true
}
variable "manage_dns" {
  type    = bool
  default = false
}
variable "web_hostname" {
  type     = string
  default  = null
  nullable = true
}
variable "api_hostname" {
  type     = string
  default  = null
  nullable = true
}
variable "auth_hostname" {
  type     = string
  default  = null
  nullable = true
}
variable "allowed_ingress_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "additional_alarm_action_arns" {
  type        = list(string)
  default     = []
  description = "Confirmed paging integrations only; an empty list keeps delivery truth false."
}
variable "enable_backup_vault_lock" {
  type        = bool
  default     = false
  description = "Irreversible after the change window; requires an explicitly authorized apply decision."
}
variable "postgres_engine_version" {
  type    = string
  default = "16.14"
}
variable "cache_engine_version" {
  type    = string
  default = "7.1"
}
variable "cost_center" {
  type    = string
  default = "platform-staging"
}
variable "owner" {
  type    = string
  default = "platform"
}
