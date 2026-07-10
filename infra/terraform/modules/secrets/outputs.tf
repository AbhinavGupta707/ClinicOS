output "secret_arns" {
  description = "Secret containers only. Values must be populated through an authorized workflow."
  value       = { for name, secret in aws_secretsmanager_secret.this : name => secret.arn }
}
