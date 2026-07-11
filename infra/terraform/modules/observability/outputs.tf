output "alarm_topic_arn" { value = aws_sns_topic.alarms.arn }
output "external_alarm_action_supplied" {
  description = "True only when an external alarm action ARN was supplied; it is not delivery evidence."
  value       = length(var.additional_alarm_action_arns) > 0
}
output "dashboard_name" { value = aws_cloudwatch_dashboard.this.dashboard_name }
