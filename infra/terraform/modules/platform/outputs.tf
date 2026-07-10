output "environment" { value = var.environment }
output "regions" { value = { primary = var.primary_region, dr = var.dr_region } }
output "vpc_ids" { value = { primary = module.network_primary.vpc_id, dr = module.network_dr.vpc_id } }
output "ecr_repository_urls" { value = { primary = module.ecr_primary.repository_urls, dr = module.ecr_dr.repository_urls } }
output "media_bucket_ids" { value = { primary = module.storage_primary.bucket_ids.media, dr = module.storage_dr.bucket_ids.media } }
output "audit_bucket_ids" { value = { primary = module.storage_primary.bucket_ids.audit, dr = module.storage_dr.bucket_ids.audit } }
output "cloudtrail_s3_object_event_arns" {
  description = "Exact reviewed candidates for the singleton account-baseline; no remote-state coupling is created."
  value = sort([
    "${module.storage_primary.bucket_arns.media}/*",
    "${module.storage_primary.bucket_arns.audit}/*",
    "${module.storage_dr.bucket_arns.media}/*",
    "${module.storage_dr.bucket_arns.audit}/*",
  ])
}
output "database_endpoint" {
  value     = try("${module.database[0].address}:${module.database[0].port}", null)
  sensitive = true
}
output "cache_endpoint" {
  value     = try("${module.cache[0].primary_endpoint}:${module.cache[0].port}", null)
  sensitive = true
}
output "runtime_secret_arns" {
  value     = try(module.secrets[0].secret_arns, {})
  sensitive = true
}
output "cache_auth_secret_arn" {
  value     = try(module.cache[0].auth_secret_arn, null)
  sensitive = true
}
output "ecs_cluster_arn" { value = try(module.compute[0].cluster_arn, null) }
output "service_names" { value = try(module.compute[0].service_names, {}) }
output "temporal_schema_task_definition_arn" { value = try(module.compute[0].task_definition_arns["temporal-schema"], null) }
output "keycloak_bootstrap_task_definition_arn" { value = try(module.compute[0].task_definition_arns["keycloak-bootstrap"], null) }
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
    alarm_topic_arn                = try(module.observability[0].alarm_topic_arn, null)
    external_alarm_action_supplied = try(module.observability[0].external_alarm_action_supplied, false)
    delivery_verified              = false
  }
}
output "backup" {
  value = {
    primary_vault_arn = try(module.backup_primary[0].vault_arn, null)
    dr_vault_arn      = try(module.backup_dr[0].vault_arn, null)
    plan_id           = try(module.backup_primary[0].plan_id, null)
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
output "activation" {
  value = {
    phase                    = var.activation_phase
    foundation               = true
    recurring_data_plane     = local.data_enabled
    runtime                  = local.runtime_enabled
    edge                     = local.edge_enabled
    nat_gateway_count        = local.data_enabled ? var.primary_network.nat_gateway_count : 0
    interface_endpoint_count = local.data_enabled ? 7 : 0
    rds_instance_count       = local.data_enabled ? 1 : 0
    cache_cluster_node_count = local.data_enabled ? var.cache.node_count : 0
    keycloak_minimum_count   = local.runtime_enabled ? var.runtime.capacity.keycloak.minimum_count : 0
    internal_admin_alb_count = local.runtime_enabled ? 1 : 0
  }
}
output "policy_assertions" {
  value = {
    ci                         = module.ci_oidc.policy_assertions
    endpoint                   = try(module.vpc_endpoints[0].policy_assertions, null)
    deploy_lifecycle_scoped    = !contains(local.environment_resource_arns, "*")
    managed_read_only_attached = false
    enhanced_monitoring = local.data_enabled ? {
      interval_seconds = 60
      policy_scoped    = true
    } : null
    task_hardening = try(module.compute[0].hardening_assertions, {})
  }
}
output "identity_contract" {
  value = {
    keycloak_admin_enabled         = local.runtime_enabled
    keycloak_admin_public          = false
    keycloak_public_auth_enabled   = local.edge_enabled
    admin_and_auth_hosts_separate  = local.runtime_enabled ? var.admin_ingress.hostname != var.ingress.auth_hostname : true
    keycloak_cluster_self_ports    = [7800, 57800]
    pilot_minimum_replicas         = var.environment == "pilot-prod" ? 3 : 1
    private_admin_applied_verified = false
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
