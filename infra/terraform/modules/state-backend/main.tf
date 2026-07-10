terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  bucket_arn  = "arn:aws:s3:::${var.bucket_name}"
  object_arns = flatten([for key in var.state_keys : ["${local.bucket_arn}/${key}", "${local.bucket_arn}/${key}.tflock"]])
}

resource "aws_kms_key" "state" {
  description             = "ClinicOS Terraform state and lock encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EnableAccountIamPolicies"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
  tags = merge(var.tags, { Name = "clinicos-terraform-state" })

  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "state" {
  name          = "alias/clinicos/terraform-state"
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" {
  bucket        = var.bucket_name
  force_destroy = false
  tags          = merge(var.tags, { Name = "clinicos-terraform-state", DataClassification = "infrastructure-secret" })

  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyUnencryptedStateWrites"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.state.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" } }
      },
      {
        Sid       = "DenyWrongStateKey"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.state.arn}/*"
        Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.state.arn } }
      },
    ]
  })
}

resource "aws_dynamodb_table" "locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.state.arn
  }

  point_in_time_recovery { enabled = true }
  tags = merge(var.tags, { Name = var.lock_table_name, DataClassification = "infrastructure-secret" })

  lifecycle { prevent_destroy = true }
}

resource "aws_iam_policy" "state_access" {
  name        = "clinicos-terraform-state-access"
  path        = "/clinicos/baseline/"
  description = "Maximum state access; environment roles remain restricted to one key."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ListDeclaredStateKeys"
        Effect    = "Allow"
        Action    = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource  = aws_s3_bucket.state.arn
        Condition = { StringLike = { "s3:prefix" = flatten([for key in var.state_keys : [key, "${key}.tflock"]]) } }
      },
      {
        Sid      = "ReadWriteDeclaredStateObjects"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = local.object_arns
      },
      {
        Sid      = "LockDeclaredState"
        Effect   = "Allow"
        Action   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.locks.arn
      },
      {
        Sid       = "UseDedicatedStateKey"
        Effect    = "Allow"
        Action    = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource  = aws_kms_key.state.arn
        Condition = { StringEquals = { "kms:ViaService" = ["s3.${var.region}.amazonaws.com", "dynamodb.${var.region}.amazonaws.com"] } }
      },
    ]
  })
  tags = var.tags
}
