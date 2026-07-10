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

variable "access_log_retention_days" {
  type        = number
  description = "Retention for ALB access logs."
  default     = 90
}

variable "tags" {
  type        = map(string)
  description = "Additional tags."
  default     = {}
}
