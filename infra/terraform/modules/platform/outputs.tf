output "environment" { value = var.environment }
output "regions" { value = { primary = var.primary_region, dr = var.dr_region } }
output "vpc_ids" { value = { primary = module.network_primary.vpc_id, dr = module.network_dr.vpc_id } }
output "ecr_repository_urls" { value = { primary = module.ecr_primary.repository_urls, dr = module.ecr_dr.repository_urls } }
output "media_bucket_ids" { value = { primary = module.storage_primary.bucket_ids.media, dr = module.storage_dr.bucket_ids.media } }
output "audit_bucket_ids" { value = { primary = module.storage_primary.bucket_ids.audit, dr = module.storage_dr.bucket_ids.audit } }
output "database_endpoint" {
  value     = "${module.database.address}:${module.database.port}"
  sensitive = true
}
output "cache_endpoint" {
  value     = "${module.cache.primary_endpoint}:${module.cache.port}"
  sensitive = true
}
output "runtime_secret_arns" {
  value     = module.secrets.secret_arns
  sensitive = true
}
output "cache_auth_secret_arn" {
  value     = module.cache.auth_secret_arn
  sensitive = true
}
output "ecs_cluster_arn" { value = module.compute.cluster_arn }
output "service_names" { value = module.compute.service_names }
output "temporal_schema_task_definition_arn" { value = try(module.compute.task_definition_arns["temporal-schema"], null) }
output "keycloak_bootstrap_task_definition_arn" { value = try(module.compute.task_definition_arns["keycloak-bootstrap"], null) }
output "edge" {
  value = {
    enabled              = var.ingress.enabled
    alb_dns_name         = module.edge.alb_dns_name
    waf_arn              = module.edge.waf_arn
    tls_inputs_complete  = module.edge.tls_inputs_complete
    applied_tls_verified = false
  }
}
output "alerting" {
  value = {
    alarm_topic_arn                = module.observability.alarm_topic_arn
    external_alarm_action_supplied = module.observability.external_alarm_action_supplied
    delivery_verified              = false
  }
}
output "backup" {
  value = {
    primary_vault_arn = module.backup_primary.vault_arn
    dr_vault_arn      = module.backup_dr.vault_arn
    plan_id           = module.backup_primary.plan_id
    restore_verified  = false
  }
}
output "ci_role_arns" {
  value = {
    plan    = module.ci_oidc.plan_role_arn
    publish = module.ci_oidc.publish_role_arn
    deploy  = module.ci_oidc.deploy_role_arn
  }
}
output "readiness_claim" {
  description = "Static Terraform truth. It deliberately cannot claim E4/E5 without apply and operational evidence."
  value = {
    terraform_definitions_present = true
    apply_evidence_claimed        = false
    staging_or_pilot_ready        = false
    evidence_tier                 = "E0-E1"
  }
}
