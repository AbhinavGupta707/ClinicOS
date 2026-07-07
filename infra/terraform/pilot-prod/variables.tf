variable "environment" {
  description = "ClinicOS environment profile represented by this validation artifact."
  type        = string
  default     = "pilot-prod"

  validation {
    condition     = var.environment == "pilot-prod"
    error_message = "This profile is only for pilot-prod posture validation."
  }
}

variable "aws_account_id" {
  description = "AWS account id used for the pilot-prod plan context."
  type        = string

  validation {
    condition     = length(regexall("^[0-9]{12}$", var.aws_account_id)) == 1
    error_message = "aws_account_id must be a 12 digit AWS account id."
  }
}

variable "primary_region" {
  description = "Primary AWS region. ClinicOS pilot-prod uses Mumbai."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = var.primary_region == "ap-south-1"
    error_message = "Pilot-prod primary region must be ap-south-1."
  }
}

variable "dr_region" {
  description = "Disaster recovery / warm-standby AWS region. ClinicOS uses Hyderabad."
  type        = string
  default     = "ap-south-2"

  validation {
    condition     = var.dr_region == "ap-south-2"
    error_message = "Pilot-prod DR region must be ap-south-2."
  }
}

variable "terraform_state_bucket" {
  description = "Existing encrypted Terraform state bucket name. This profile does not create it."
  type        = string

  validation {
    condition     = length(trimspace(var.terraform_state_bucket)) > 0
    error_message = "terraform_state_bucket is required."
  }
}

variable "terraform_lock_table" {
  description = "Existing Terraform lock table name. This profile does not create it."
  type        = string

  validation {
    condition     = length(trimspace(var.terraform_lock_table)) > 0
    error_message = "terraform_lock_table is required."
  }
}

variable "kms_key_alias" {
  description = "KMS alias expected for pilot-prod data stores and backups."
  type        = string

  validation {
    condition     = startswith(var.kms_key_alias, "alias/")
    error_message = "kms_key_alias must be an alias name such as alias/clinic-os-pilot-prod."
  }
}

variable "allow_resource_creation" {
  description = "Hard stop: this CP9 lane profile is validate/plan-only and must not create resources."
  type        = bool
  default     = false

  validation {
    condition     = var.allow_resource_creation == false
    error_message = "CP9 Infrastructure/Ops lane must not create live AWS resources."
  }
}

variable "database_publicly_accessible" {
  description = "RDS/Aurora PostgreSQL must remain private."
  type        = bool
  default     = false

  validation {
    condition     = var.database_publicly_accessible == false
    error_message = "Pilot-prod databases must not be public."
  }
}

variable "database_storage_encrypted" {
  description = "RDS/Aurora PostgreSQL storage encryption control."
  type        = bool
  default     = true

  validation {
    condition     = var.database_storage_encrypted == true
    error_message = "Pilot-prod database storage must be encrypted."
  }
}

variable "database_multi_az_enabled" {
  description = "Pilot-prod database high-availability posture."
  type        = bool
  default     = true

  validation {
    condition     = var.database_multi_az_enabled == true
    error_message = "Pilot-prod database must be Multi-AZ or equivalent."
  }
}

variable "database_pitr_enabled" {
  description = "Point-in-time recovery requirement for pilot-prod database backups."
  type        = bool
  default     = true

  validation {
    condition     = var.database_pitr_enabled == true
    error_message = "Pilot-prod database PITR must be enabled."
  }
}

variable "database_backup_retention_days" {
  description = "Pilot-prod automated database backup retention."
  type        = number
  default     = 14

  validation {
    condition     = var.database_backup_retention_days >= 7
    error_message = "Pilot-prod database backup retention must be at least 7 days."
  }
}

variable "object_storage_encrypted" {
  description = "S3/object storage default encryption control."
  type        = bool
  default     = true

  validation {
    condition     = var.object_storage_encrypted == true
    error_message = "Pilot-prod object storage must use default encryption."
  }
}

variable "object_storage_block_public_access" {
  description = "S3 public access block control for media/backups."
  type        = bool
  default     = true

  validation {
    condition     = var.object_storage_block_public_access == true
    error_message = "Pilot-prod object storage must block public access."
  }
}

variable "cross_region_backup_replication_enabled" {
  description = "Cross-region backup/object replication posture from ap-south-1 to ap-south-2."
  type        = bool
  default     = true

  validation {
    condition     = var.cross_region_backup_replication_enabled == true
    error_message = "Pilot-prod backups must be prepared for ap-south-2 replication."
  }
}

variable "secrets_manager_enabled" {
  description = "Provider credentials must be stored in Secrets Manager or equivalent secret store."
  type        = bool
  default     = true

  validation {
    condition     = var.secrets_manager_enabled == true
    error_message = "Pilot-prod provider credentials must use managed secrets."
  }
}

variable "waf_enabled" {
  description = "Public ingress must be fronted by WAF or equivalent reverse-proxy protection."
  type        = bool
  default     = true

  validation {
    condition     = var.waf_enabled == true
    error_message = "Pilot-prod public ingress must have WAF or equivalent protection."
  }
}

variable "centralized_logs_enabled" {
  description = "API, worker, provider, and infrastructure logs must be centralized with redaction controls."
  type        = bool
  default     = true

  validation {
    condition     = var.centralized_logs_enabled == true
    error_message = "Pilot-prod centralized logging must be enabled."
  }
}

variable "cloudwatch_log_retention_days" {
  description = "Minimum CloudWatch/log retention for pilot-prod operational evidence."
  type        = number
  default     = 90

  validation {
    condition     = var.cloudwatch_log_retention_days >= 30
    error_message = "Pilot-prod log retention must be at least 30 days."
  }
}

variable "provider_health_alerts_enabled" {
  description = "Provider-health alerting should consume the CP7 provider health posture."
  type        = bool
  default     = true

  validation {
    condition     = var.provider_health_alerts_enabled == true
    error_message = "Pilot-prod provider-health alerting must be enabled."
  }
}

variable "backup_failure_alerts_enabled" {
  description = "Backup failure alerts must be routed to the configured alert destination."
  type        = bool
  default     = true

  validation {
    condition     = var.backup_failure_alerts_enabled == true
    error_message = "Pilot-prod backup failure alerting must be enabled."
  }
}

variable "rpo_minutes" {
  description = "Pilot-prod recovery point objective in minutes."
  type        = number
  default     = 60

  validation {
    condition     = var.rpo_minutes > 0 && var.rpo_minutes <= 240
    error_message = "Pilot-prod RPO must be between 1 and 240 minutes."
  }
}

variable "rto_minutes" {
  description = "Pilot-prod recovery time objective in minutes."
  type        = number
  default     = 240

  validation {
    condition     = var.rto_minutes > 0 && var.rto_minutes <= 480
    error_message = "Pilot-prod RTO must be between 1 and 480 minutes."
  }
}
