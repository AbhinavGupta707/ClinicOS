output "account_posture" {
  value = {
    organization_mode             = "standalone-account"
    organizations_resources       = false
    cloudtrail_multi_region       = var.activation.cloudtrail
    s3_data_event_audit           = module.singleton.s3_data_event_audit
    config_regions                = var.activation.config ? [var.primary_region, var.dr_region] : []
    guardduty_regions             = var.activation.guardduty ? [var.primary_region, var.dr_region] : []
    security_hub_regions          = var.activation.security_hub ? [var.primary_region, var.dr_region] : []
    security_hub_aggregation      = var.activation.security_hub ? "ALL_REGIONS" : "disabled"
    ci_permissions_boundary_arn   = module.singleton.ci_permissions_boundary_arn
    excludes_sensitive_data_reads = module.singleton.ci_boundary_excludes_sensitive_reads
    evidence_tier                 = "E0-E1"
    applied                       = false
  }
}
