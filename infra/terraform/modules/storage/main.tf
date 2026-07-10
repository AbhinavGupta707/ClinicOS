terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  suffix = var.is_replica ? "dr" : "primary"
  buckets = {
    media = {
      name           = "${var.name_prefix}-${var.account_id}-${local.suffix}-media"
      object_lock    = true
      retention_mode = "GOVERNANCE"
      retention_days = var.media_retention_days
      classification = "phi"
    }
    audit = {
      name           = "${var.name_prefix}-${var.account_id}-${local.suffix}-audit"
      object_lock    = true
      retention_mode = var.audit_lock_mode
      retention_days = var.audit_retention_days
      classification = "audit"
    }
  }
}

resource "aws_s3_bucket" "protected" {
  for_each = local.buckets

  bucket              = each.value.name
  object_lock_enabled = each.value.object_lock
  force_destroy       = false

  tags = merge(var.tags, {
    Name               = each.value.name
    DataClassification = each.value.classification
    ReplicationRole    = local.suffix
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "protected" {
  for_each = aws_s3_bucket.protected

  bucket = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "protected" {
  for_each = aws_s3_bucket.protected

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "protected" {
  for_each = aws_s3_bucket.protected

  bucket = each.value.id
  versioning_configuration {
    status     = "Enabled"
    mfa_delete = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "protected" {
  for_each = aws_s3_bucket.protected

  bucket = each.value.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.data_kms_key_arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "protected" {
  for_each = local.buckets

  bucket              = aws_s3_bucket.protected[each.key].id
  object_lock_enabled = "Enabled"

  rule {
    default_retention {
      mode = each.value.retention_mode
      days = each.value.retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.protected]
}

resource "aws_s3_bucket_lifecycle_configuration" "protected" {
  for_each = aws_s3_bucket.protected

  bucket = each.value.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER_IR"
    }
  }

  depends_on = [aws_s3_bucket_versioning.protected]
}

resource "aws_s3_bucket_logging" "protected" {
  for_each = aws_s3_bucket.protected

  bucket        = each.value.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "s3-access/${each.key}/"

  depends_on = [aws_s3_bucket_policy.access_logs]
}

resource "aws_s3_bucket_policy" "protected" {
  for_each = aws_s3_bucket.protected

  bucket = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [each.value.arn, "${each.value.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyUnencryptedObjectWrites"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${each.value.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "aws:kms"
          }
        }
      },
      {
        Sid       = "DenyWrongKmsKey"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${each.value.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption-aws-kms-key-id" = var.data_kms_key_arn
          }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.protected]
}

# This is the terminal S3/ALB access-log destination; logging it to itself would recurse.
#trivy:ignore:AWS-0089
resource "aws_s3_bucket" "access_logs" {
  bucket        = "${var.name_prefix}-${var.account_id}-${local.suffix}-access-logs"
  force_destroy = false

  tags = merge(var.tags, {
    Name               = "${var.name_prefix}-${local.suffix}-access-logs"
    DataClassification = "diagnostic-no-phi"
    ReplicationRole    = local.suffix
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ALB access logging supports Amazon S3-managed encryption, not a customer KMS key.
# Application/media/audit data never uses this bucket and must never be placed in URLs.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.access_log_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.access_logs.arn, "${aws_s3_bucket.access_logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "AllowAlbLogDelivery"
        Effect    = "Allow"
        Principal = { Service = "logdelivery.elasticloadbalancing.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.access_logs.arn}/AWSLogs/${var.account_id}/*"
      },
      {
        Sid       = "AllowS3ServerAccessLogging"
        Effect    = "Allow"
        Principal = { Service = "logging.s3.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.access_logs.arn}/s3-access/*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = var.account_id }
          ArnLike      = { "aws:SourceArn" = [for bucket in values(aws_s3_bucket.protected) : bucket.arn] }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.access_logs]
}
