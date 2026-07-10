output "bucket_ids" {
  value = merge(
    { for name, bucket in aws_s3_bucket.protected : name => bucket.id },
    { access_logs = aws_s3_bucket.access_logs.id },
  )
}

output "bucket_arns" {
  value = merge(
    { for name, bucket in aws_s3_bucket.protected : name => bucket.arn },
    { access_logs = aws_s3_bucket.access_logs.arn },
  )
}
