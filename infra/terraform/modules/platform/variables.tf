variable "environment" {
  type        = string
  description = "Isolated ClinicOS environment."

  validation {
    condition     = contains(["staging", "pilot-prod"], var.environment)
    error_message = "environment must be staging or pilot-prod."
  }
}

variable "account_id" {
  type        = string
  description = "AWS account ID for this environment. Separate account IDs can be supplied later without changing modules."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "primary_region" { type = string }
variable "dr_region" { type = string }

variable "primary_network" {
  type = object({
    vpc_cidr             = string
    availability_zones   = list(string)
    public_subnet_cidrs  = list(string)
    private_subnet_cidrs = list(string)
    data_subnet_cidrs    = list(string)
    nat_gateway_count    = number
  })
}

variable "dr_network" {
  type = object({
    vpc_cidr             = string
    availability_zones   = list(string)
    public_subnet_cidrs  = list(string)
    private_subnet_cidrs = list(string)
    data_subnet_cidrs    = list(string)
    nat_gateway_count    = number
    interface_endpoints  = bool
  })
}

variable "database" {
  type = object({
    engine_version                      = string
    parameter_group_family              = string
    instance_class                      = string
    allocated_storage_gib               = number
    max_allocated_storage_gib           = number
    multi_az                            = bool
    backup_retention_days               = number
    performance_insights_retention_days = number
  })
}

variable "cache" {
  type = object({
    engine_version          = string
    node_type               = string
    node_count              = number
    snapshot_retention_days = number
  })
}

variable "retention" {
  type = object({
    log_days             = number
    media_lock_days      = number
    audit_lock_days      = number
    audit_lock_mode      = string
    access_log_days      = number
    secret_recovery_days = number
  })
}

variable "ingress" {
  type = object({
    enabled            = bool
    allowed_ipv4_cidrs = list(string)
    certificate_arn    = optional(string)
    create_certificate = bool
    hosted_zone_id     = optional(string)
    manage_dns         = bool
    web_hostname       = optional(string)
    api_hostname       = optional(string)
    auth_hostname      = optional(string)
    waf_rate_limit     = number
  })
}

variable "runtime" {
  type = object({
    enabled       = bool
    temporal_mode = string
    images        = map(string)
    capacity = map(object({
      cpu              = number
      memory           = number
      desired_count    = number
      minimum_count    = number
      maximum_count    = number
      use_fargate_spot = bool
    }))
  })
}

variable "backup" {
  type = object({
    daily_retention_days       = number
    monthly_retention_days     = number
    primary_vault_lock_enabled = bool
    dr_vault_lock_enabled      = bool
    vault_lock_changeable_days = number
  })
}

variable "github" {
  type = object({
    repository               = string
    subject_claims           = list(string)
    create_oidc_provider     = bool
    oidc_provider_arn        = optional(string)
    oidc_thumbprints         = list(string)
    permissions_boundary_arn = optional(string)
  })
}

variable "state_backend" {
  type = object({
    bucket_name = string
    lock_table  = string
    state_key   = string
  })
}

variable "additional_alarm_action_arns" {
  type        = list(string)
  description = "Pre-existing, confirmed paging/integration targets. Empty means alarms exist but delivery is not configured."
  default     = []
}

variable "cost_center" { type = string }
variable "owner" { type = string }
variable "additional_tags" {
  type    = map(string)
  default = {}
}
