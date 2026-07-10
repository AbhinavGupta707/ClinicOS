output "primary_endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
output "port" { value = aws_elasticache_replication_group.this.port }
output "replication_group_id" { value = aws_elasticache_replication_group.this.id }
output "arn" { value = aws_elasticache_replication_group.this.arn }
output "auth_secret_arn" {
  value     = aws_secretsmanager_secret.auth.arn
  sensitive = true
}
