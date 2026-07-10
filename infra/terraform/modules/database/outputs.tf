output "address" { value = aws_db_instance.this.address }
output "port" { value = aws_db_instance.this.port }
output "identifier" { value = aws_db_instance.this.identifier }
output "arn" { value = aws_db_instance.this.arn }
output "security_group_id" { value = aws_security_group.database.id }
output "master_secret_arn" {
  value     = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
  sensitive = true
}
