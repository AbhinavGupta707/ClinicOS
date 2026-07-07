output "pilot_prod_profile" {
  description = "Plan-time posture summary for CP9 pilot-prod hardening review."
  value       = local.pilot_prod_profile
  sensitive   = false
}

output "mandatory_controls" {
  description = "Boolean control map used by runbooks and integration review."
  value       = local.mandatory_controls
  sensitive   = false
}
