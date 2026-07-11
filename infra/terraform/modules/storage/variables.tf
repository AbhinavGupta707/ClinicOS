variable "name_prefix" {
  type        = string
  description = "Environment-qualified lowercase bucket prefix."
}

variable "account_id" {
  type        = string
  description = "Owning AWS account ID, used to make bucket names deterministic and unique."
}

variable "data_kms_key_arn" {
  type        = string
  description = "KMS key used for media and audit object encryption."
}

variable "is_replica" {
  type        = bool
  description = "Whether these buckets are passive DR replicas."
  default     = false
}

variable "media_retention_days" {
  type        = number
  description = "Default governance retention for clinical media objects."
  default     = 30
}

variable "audit_retention_days" {
  type        = number
  description = "Default retention for immutable audit export objects."
  default     = 2555
}

variable "audit_lock_mode" {
  type        = string
  description = "S3 Object Lock mode for audit exports. COMPLIANCE is irreversible for retained versions."
  default     = "GOVERNANCE"

  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.audit_lock_mode)
    error_message = "audit_lock_mode must be GOVERNANCE or COMPLIANCE."
  }
}

variable "audit_compliance_authorized_by" {
  type        = string
  default     = null
  nullable    = true
  description = "Named authority required before irreversible COMPLIANCE retention can be planned."
}

variable "access_log_retention_days" {
  type        = number
  description = "Retention for ALB access logs."
  default     = 90
}

variable "media_malware_protection_role_arn" {
  type        = string
  default     = null
  nullable    = true
  description = "Exact GuardDuty Malware Protection role allowed to create its validation object and managed result tag."

  validation {
    condition = var.media_malware_protection_role_arn == null ? true : can(regex(
      "^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$",
      var.media_malware_protection_role_arn
    ))
    error_message = "media_malware_protection_role_arn must be an exact IAM role ARN."
  }
}

variable "media_quarantine_prefixes" {
  type        = list(string)
  default     = []
  description = "Exact GuardDuty-managed media prefixes; empty disables scan-tag bucket-policy controls."

  validation {
    condition = (
      length(var.media_quarantine_prefixes) <= 5 &&
      length(distinct(var.media_quarantine_prefixes)) == length(var.media_quarantine_prefixes) &&
      alltrue([for prefix in var.media_quarantine_prefixes : can(regex("^[a-z0-9][A-Za-z0-9._/-]{0,200}/tenants/$", prefix))])
    )
    error_message = "media_quarantine_prefixes must contain at most five unique prefixes ending in /tenants/."
  }
}

variable "tags" {
  type        = map(string)
  description = "Additional tags."
  default     = {}
}
