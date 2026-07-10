output "security_group_id" { value = aws_security_group.this.id }
output "target_group_arn" { value = aws_lb_target_group.keycloak.arn }
output "hostname" { value = var.hostname }
output "alb_dns_name" { value = aws_lb.this.dns_name }
output "private_zone_id" { value = var.private_zone_id }
