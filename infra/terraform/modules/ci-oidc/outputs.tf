output "plan_role_arn" { value = aws_iam_role.plan.arn }
output "publish_role_arn" { value = aws_iam_role.publish.arn }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "oidc_provider_arn" { value = local.provider_arn }
output "policy_assertions" {
  value = {
    managed_read_only_attached     = false
    permissions_boundary_mandatory = var.permissions_boundary_arn != null
    discovery_reads_s3_objects     = contains(var.read_actions, "s3:GetObject") || contains(var.read_actions, "s3:*")
    discovery_reads_secret_values  = contains(var.read_actions, "secretsmanager:GetSecretValue") || contains(var.read_actions, "secretsmanager:BatchGetSecretValue")
    state_kms_key_scoped           = var.state_kms_key_arn
  }
}
