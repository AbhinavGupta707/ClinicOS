output "alb_arn" { value = try(aws_lb.this[0].arn, null) }
output "alb_arn_suffix" { value = try(aws_lb.this[0].arn_suffix, null) }
output "alb_dns_name" { value = try(aws_lb.this[0].dns_name, null) }
output "alb_security_group_id" { value = try(aws_security_group.alb[0].id, null) }
output "target_group_arns" { value = { for name, target in aws_lb_target_group.this : name => target.arn } }
output "waf_arn" { value = try(aws_wafv2_web_acl.this[0].arn, null) }
output "waf_name" { value = try(aws_wafv2_web_acl.this[0].name, null) }
output "tls_inputs_complete" {
  description = "Input completeness only. Runtime TLS readiness requires applied certificate validation and deployed health evidence."
  value       = var.enabled && (var.certificate_arn != null || var.create_certificate)
}
