output "vault_arn" { value = aws_backup_vault.this.arn }
output "vault_name" { value = aws_backup_vault.this.name }
output "plan_id" { value = try(aws_backup_plan.this[0].id, null) }
output "plan_arn" { value = try(aws_backup_plan.this[0].arn, null) }
