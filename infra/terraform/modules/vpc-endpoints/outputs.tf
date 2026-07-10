output "policy_assertions" {
  value = {
    source_is_security_group = true
    s3_resource_mode         = "declared-bucket-arns"
    s3_action_mode           = "enumerated-object-actions"
    secrets_resource_mode    = "declared-secret-arns"
  }
}
