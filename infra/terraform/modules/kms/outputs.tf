output "key_arns" {
  description = "KMS key ARNs keyed by data, logs, secrets, and backup."
  value       = { for name, key in aws_kms_key.this : name => key.arn }
}

output "alias_names" {
  description = "Stable KMS alias names."
  value       = { for name, alias in aws_kms_alias.this : name => alias.name }
}
