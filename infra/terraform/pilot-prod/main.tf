locals {
  mandatory_controls = {
    no_resource_creation                  = var.allow_resource_creation == false
    primary_region_mumbai                 = var.primary_region == "ap-south-1"
    dr_region_hyderabad                   = var.dr_region == "ap-south-2"
    database_private                      = var.database_publicly_accessible == false
    database_encrypted                    = var.database_storage_encrypted == true
    database_multi_az                     = var.database_multi_az_enabled == true
    database_pitr                         = var.database_pitr_enabled == true
    database_backup_retention             = var.database_backup_retention_days >= 7
    object_storage_encrypted              = var.object_storage_encrypted == true
    object_storage_blocks_public_access   = var.object_storage_block_public_access == true
    cross_region_backup_replication_ready = var.cross_region_backup_replication_enabled == true
    secrets_manager                       = var.secrets_manager_enabled == true
    waf                                   = var.waf_enabled == true
    centralized_logs                      = var.centralized_logs_enabled == true
    log_retention                         = var.cloudwatch_log_retention_days >= 30
    provider_health_alerts                = var.provider_health_alerts_enabled == true
    backup_failure_alerts                 = var.backup_failure_alerts_enabled == true
    rpo_target                            = var.rpo_minutes > 0 && var.rpo_minutes <= 240
    rto_target                            = var.rto_minutes > 0 && var.rto_minutes <= 480
  }

  pilot_prod_profile = {
    environment              = var.environment
    aws_account_id           = var.aws_account_id
    primary_region           = var.primary_region
    dr_region                = var.dr_region
    terraform_state_bucket   = var.terraform_state_bucket
    terraform_lock_table     = var.terraform_lock_table
    kms_key_alias            = var.kms_key_alias
    rpo_minutes              = var.rpo_minutes
    rto_minutes              = var.rto_minutes
    all_mandatory_controls   = alltrue(values(local.mandatory_controls))
    mandatory_control_states = local.mandatory_controls
  }
}
