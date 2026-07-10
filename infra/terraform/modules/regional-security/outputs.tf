output "config_recorder_name" { value = try(aws_config_configuration_recorder.this[0].name, null) }
output "guardduty_detector_id" { value = try(aws_guardduty_detector.this[0].id, null) }
output "security_hub_enabled" { value = length(aws_securityhub_account.this) == 1 }
