output "policy_assertions" {
  value = {
    source_is_security_group = true
    s3_resource_mode         = "declared-bucket-arns"
    s3_action_mode           = "enumerated-object-actions"
    secrets_resource_mode    = "declared-secret-arns"
    lambda_endpoint_enabled  = length(var.lambda_function_arns) > 0
    lambda_resource_mode     = length(var.lambda_function_arns) > 0 ? "declared-alias-arns" : "omitted"
  }
}
