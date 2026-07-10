output "backend" {
  value = var.authorize_backend_creation ? {
    bucket_name             = module.state_backend[0].bucket_name
    lock_table_name         = module.state_backend[0].lock_table_name
    kms_key_arn             = module.state_backend[0].kms_key_arn
    state_access_policy_arn = module.state_backend[0].state_access_policy_arn
  } : null
}
output "readiness_claim" {
  value = { evidence_tier = "E0-E1", resources_applied = false, migration_performed = false }
}
