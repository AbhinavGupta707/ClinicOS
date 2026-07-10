output "bucket_name" { value = aws_s3_bucket.state.id }
output "bucket_arn" { value = aws_s3_bucket.state.arn }
output "lock_table_name" { value = aws_dynamodb_table.locks.name }
output "lock_table_arn" { value = aws_dynamodb_table.locks.arn }
output "kms_key_arn" { value = aws_kms_key.state.arn }
output "state_access_policy_arn" { value = aws_iam_policy.state_access.arn }
