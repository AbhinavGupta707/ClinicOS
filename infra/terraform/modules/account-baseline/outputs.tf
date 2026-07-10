output "log_bucket_name" { value = try(aws_s3_bucket.audit[0].id, null) }
output "log_bucket_arn" { value = try(aws_s3_bucket.audit[0].arn, null) }
output "audit_kms_key_arn" { value = try(aws_kms_key.audit[0].arn, null) }
output "cloudtrail_arn" { value = try(aws_cloudtrail.account[0].arn, null) }
output "ci_permissions_boundary_arn" { value = try(aws_iam_policy.ci_boundary[0].arn, null) }
output "s3_data_event_audit" {
  value = {
    enabled              = var.enable_cloudtrail_s3_data_events
    declared_object_arns = sort(tolist(var.cloudtrail_s3_object_arns))
    wildcard_bucket      = anytrue([for arn in var.cloudtrail_s3_object_arns : startswith(arn, "arn:aws:s3:::*/")])
  }
}
output "ci_boundary_excludes_sensitive_reads" {
  value = (
    !strcontains(jsonencode(local.ci_boundary_policy), "s3:GetObjectVersion") &&
    !strcontains(jsonencode(local.ci_boundary_policy), "secretsmanager:GetSecretValue")
  )
}
