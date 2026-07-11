terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  key_definitions = {
    data = {
      description     = "ClinicOS application, database, cache, registry, and object data"
      cloudwatch_logs = false
      services = [
        "ecr.amazonaws.com",
        "elasticache.amazonaws.com",
        "rds.amazonaws.com",
        "s3.amazonaws.com",
      ]
    }
    logs = {
      description     = "ClinicOS diagnostic logs and metrics"
      cloudwatch_logs = true
      services = [
        "sns.amazonaws.com",
      ]
    }
    secrets = {
      description     = "ClinicOS Secrets Manager values and RDS-managed credentials"
      cloudwatch_logs = false
      services = [
        "rds.amazonaws.com",
        "secretsmanager.amazonaws.com",
      ]
    }
    backup = {
      description     = "ClinicOS backup vaults and recovery copies"
      cloudwatch_logs = false
      services = [
        "backup.amazonaws.com",
        "s3.amazonaws.com",
      ]
    }
  }
}

resource "aws_kms_key" "this" {
  for_each = local.key_definitions

  description                        = each.value.description
  enable_key_rotation                = true
  deletion_window_in_days            = var.deletion_window_in_days
  multi_region                       = false
  bypass_policy_lockout_safety_check = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid       = "AccountRootAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "RegionalServiceUse"
        Effect = "Allow"
        Principal = {
          Service = each.value.services
        }
        Action = [
          "kms:CreateGrant",
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = var.account_id
          }
        }
      },
      ],
      each.value.cloudwatch_logs ? [{
        Sid       = "ClinicOsCloudWatchLogsUse"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "kms:CallerAccount" = var.account_id }
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/*/${var.name_prefix}*"
          }
        }
      }] : []
    )
  })

  tags = merge(var.tags, {
    Name               = "${var.name_prefix}-${each.key}"
    DataClassification = each.key == "logs" ? "diagnostic-no-phi" : "sensitive"
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "this" {
  for_each = aws_kms_key.this

  name          = "alias/${var.name_prefix}-${each.key}"
  target_key_id = each.value.key_id
}
