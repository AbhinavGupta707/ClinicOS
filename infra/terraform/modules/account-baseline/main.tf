terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

check "s3_data_event_scope" {
  assert {
    condition = !var.enable_cloudtrail_s3_data_events || (
      var.enable_cloudtrail &&
      length(var.cloudtrail_s3_object_arns) >= 2 &&
      anytrue([for arn in var.cloudtrail_s3_object_arns : can(regex("-media/\\*$", arn))]) &&
      anytrue([for arn in var.cloudtrail_s3_object_arns : can(regex("-audit/\\*$", arn))])
    )
    error_message = "S3 data-event activation requires CloudTrail plus exact media and audit bucket object ARNs."
  }
}

locals {
  create_log_sink = var.enable_cloudtrail || var.enable_config_delivery
  log_bucket_arn  = "arn:aws:s3:::${var.log_bucket_name}"
}

resource "aws_kms_key" "audit" {
  count = local.create_log_sink ? 1 : 0

  description             = "ClinicOS standalone-account audit log encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableAccountIamPolicies"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudTrailEncryption"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = ["kms:DescribeKey", "kms:GenerateDataKey*"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = var.account_id }
          StringLike   = { "kms:EncryptionContext:aws:cloudtrail:arn" = "arn:aws:cloudtrail:*:${var.account_id}:trail/*" }
        }
      },
      {
        Sid       = "AllowCloudWatchLogsEncryption"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"]
        Resource  = "*"
        Condition = { ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/cloudtrail/*" } }
      },
      {
        Sid       = "AllowConfigDeliveryEncryption"
        Effect    = "Allow"
        Principal = { Service = "config.amazonaws.com" }
        Action    = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey*"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
      },
    ]
  })
  tags = merge(var.tags, { Name = "${var.name_prefix}-audit" })
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "audit" {
  count         = local.create_log_sink ? 1 : 0
  name          = "alias/clinicos/account-audit"
  target_key_id = aws_kms_key.audit[0].key_id
}

resource "aws_s3_bucket" "audit" {
  count         = local.create_log_sink ? 1 : 0
  bucket        = var.log_bucket_name
  force_destroy = false
  tags          = merge(var.tags, { Name = var.log_bucket_name, DataClassification = "security-audit" })
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  count                   = local.create_log_sink ? 1 : 0
  bucket                  = aws_s3_bucket.audit[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audit" {
  count  = local.create_log_sink ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "audit" {
  count  = local.create_log_sink ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  count  = local.create_log_sink ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.audit[0].arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  count  = local.create_log_sink ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  rule {
    id     = "retain-account-security-logs"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
    expiration { days = var.log_retention_days }
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  count  = local.create_log_sink ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.audit[0].arn, "${aws_s3_bucket.audit[0].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }],
      var.enable_cloudtrail ? [
        {
          Sid       = "CloudTrailAclCheck"
          Effect    = "Allow"
          Principal = { Service = "cloudtrail.amazonaws.com" }
          Action    = "s3:GetBucketAcl"
          Resource  = aws_s3_bucket.audit[0].arn
          Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
        },
        {
          Sid       = "CloudTrailWrite"
          Effect    = "Allow"
          Principal = { Service = "cloudtrail.amazonaws.com" }
          Action    = "s3:PutObject"
          Resource  = "${aws_s3_bucket.audit[0].arn}/AWSLogs/${var.account_id}/*"
          Condition = { StringEquals = { "aws:SourceAccount" = var.account_id, "s3:x-amz-acl" = "bucket-owner-full-control" } }
        },
      ] : [],
      var.enable_config_delivery ? [{
        Sid       = "ConfigWrite"
        Effect    = "Allow"
        Principal = { Service = "config.amazonaws.com" }
        Action    = ["s3:GetBucketAcl", "s3:ListBucket", "s3:PutObject"]
        Resource  = [aws_s3_bucket.audit[0].arn, "${aws_s3_bucket.audit[0].arn}/AWSLogs/${var.account_id}/Config/*"]
        Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
      }] : [],
    )
  })
}

resource "aws_cloudwatch_log_group" "cloudtrail" {
  count             = var.enable_cloudtrail ? 1 : 0
  name              = "/aws/cloudtrail/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.audit[0].arn
  skip_destroy      = true
  tags              = var.tags
}

resource "aws_iam_role" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0
  name  = "${var.name_prefix}-cloudtrail-logs"
  path  = "/clinicos/baseline/"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "cloudtrail" {
  count = var.enable_cloudtrail ? 1 : 0
  name  = "write-declared-cloudtrail-log-group"
  role  = aws_iam_role.cloudtrail[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.cloudtrail[0].arn}:*"
    }]
  })
}

resource "aws_cloudtrail" "account" {
  count = var.enable_cloudtrail ? 1 : 0

  name                          = "${var.name_prefix}-multi-region"
  s3_bucket_name                = aws_s3_bucket.audit[0].id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  enable_logging                = true
  kms_key_id                    = aws_kms_key.audit[0].arn
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.cloudtrail[0].arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail[0].arn

  event_selector {
    include_management_events = true
    read_write_type           = "All"
  }

  dynamic "event_selector" {
    for_each = var.enable_cloudtrail_s3_data_events ? [1] : []
    content {
      include_management_events = false
      read_write_type           = "All"
      data_resource {
        type   = "AWS::S3::Object"
        values = sort(tolist(var.cloudtrail_s3_object_arns))
      }
    }
  }

  tags       = var.tags
  depends_on = [aws_s3_bucket_policy.audit, aws_iam_role_policy.cloudtrail]
}

locals {
  ci_boundary_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InfrastructureControlPlaneOnly"
        Effect = "Allow"
        Action = [
          "acm:*", "application-autoscaling:*", "backup:*", "cloudwatch:*", "ec2:*", "ecr:*", "ecs:*",
          "elasticache:*", "elasticloadbalancing:*", "events:*", "kms:*", "logs:*", "rds:*", "resource-groups:*",
          "route53:*", "servicediscovery:*", "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret", "secretsmanager:ListSecretVersionIds", "secretsmanager:PutSecretValue",
          "secretsmanager:RestoreSecret", "secretsmanager:TagResource", "secretsmanager:UntagResource",
          "secretsmanager:UpdateSecret", "sns:*", "wafv2:*", "xray:*"
        ]
        Resource = "*"
      },
      {
        Sid      = "ClinicOSIamOnly"
        Effect   = "Allow"
        Action   = ["iam:CreateRole", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:PassRole", "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy"]
        Resource = "arn:aws:iam::${var.account_id}:role/clinicos/*"
      },
      {
        Sid    = "ClinicOSBucketControlPlaneOnly"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:GetBucketAcl", "s3:GetBucketLocation",
          "s3:GetBucketLogging", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketPolicy", "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration",
          "s3:GetReplicationConfiguration", "s3:ListBucket", "s3:PutBucketLifecycleConfiguration", "s3:PutBucketLogging",
          "s3:PutBucketObjectLockConfiguration", "s3:PutBucketOwnershipControls", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketReplication", "s3:PutBucketTagging", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration",
        ]
        Resource = ["arn:aws:s3:::clinicos-*-${var.account_id}-*", "arn:aws:s3:::clinicos-*-${var.account_id}-*/*"]
      },
      {
        Sid      = "DeclaredStateOnly"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.state_bucket_name}"
      },
      {
        Sid      = "DeclaredStateObjectsOnly"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::${var.state_bucket_name}/clinicos/*"
      },
      {
        Sid      = "DeclaredStateLockAndKeyOnly"
        Effect   = "Allow"
        Action   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [var.state_kms_key_arn, "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.state_lock_table_name}"]
      },
    ]
  }
}

resource "aws_iam_policy" "ci_boundary" {
  count       = var.create_ci_permissions_boundary ? 1 : 0
  name        = "clinicos-terraform-ci-boundary"
  path        = "/clinicos/baseline/"
  description = "Mandatory maximum permissions for environment Terraform OIDC roles; excludes unrelated S3 objects and secret values."
  policy      = jsonencode(local.ci_boundary_policy)
  tags        = var.tags
}
