terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  replicated = {
    for name in ["media", "audit"] : name => {
      source_id       = var.source_bucket_ids[name]
      source_arn      = var.source_bucket_arns[name]
      destination_arn = var.destination_bucket_arns[name]
    }
  }
}

resource "aws_iam_role" "replication" {
  name_prefix = "${var.name_prefix}-s3-replication-"
  path        = "/clinicos/${var.name_prefix}/"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  name = "replicate-encrypted-object-versions"
  role = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectRetention",
          "s3:GetObjectVersion",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionTagging",
          "s3:ListBucket",
        ]
        Resource = flatten([for item in values(local.replicated) : [item.source_arn, "${item.source_arn}/*"]])
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ObjectOwnerOverrideToBucketOwner",
          "s3:ReplicateDelete",
          "s3:ReplicateObject",
          "s3:ReplicateTags",
        ]
        Resource = [for item in values(local.replicated) : "${item.destination_arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = var.source_kms_key_arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"]
        Resource = var.destination_kms_key_arn
      },
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "this" {
  for_each = local.replicated

  bucket = each.value.source_id
  role   = aws_iam_role.replication.arn

  rule {
    id       = "replicate-${each.key}-to-dr"
    status   = "Enabled"
    priority = 10

    filter {}

    delete_marker_replication {
      status = "Disabled"
    }

    destination {
      bucket        = each.value.destination_arn
      storage_class = "STANDARD_IA"

      encryption_configuration {
        replica_kms_key_id = var.destination_kms_key_arn
      }
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
      replica_modifications {
        status = "Enabled"
      }
    }
  }
}
