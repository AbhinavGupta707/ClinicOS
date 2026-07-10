terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_backup_vault" "this" {
  name        = "${var.name_prefix}-vault"
  kms_key_arn = var.vault_kms_key_arn
  tags        = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

# Enabling compliance-mode Vault Lock becomes immutable after changeable_for_days. It is therefore
# opt-in and must be part of an explicitly authorized production apply/recovery decision.
resource "aws_backup_vault_lock_configuration" "this" {
  count = var.vault_lock_enabled ? 1 : 0

  backup_vault_name   = aws_backup_vault.this.name
  changeable_for_days = var.vault_lock_changeable_days
  min_retention_days  = var.daily_retention_days
  max_retention_days  = var.monthly_retention_days * 2
}

resource "aws_iam_role" "backup" {
  count = var.create_plan ? 1 : 0

  name_prefix = "${var.name_prefix}-backup-"
  path        = "/clinicos/${var.name_prefix}/"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  count = var.create_plan ? 1 : 0

  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_plan" "this" {
  count = var.create_plan ? 1 : 0

  name = "${var.name_prefix}-protected-data"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(0 20 ? * * *)"
    start_window      = 60
    completion_window = 360

    lifecycle {
      delete_after = var.daily_retention_days
    }

    dynamic "copy_action" {
      for_each = var.dr_vault_arn == null ? [] : [var.dr_vault_arn]
      content {
        destination_vault_arn = copy_action.value
        lifecycle {
          delete_after = var.monthly_retention_days
        }
      }
    }

    recovery_point_tags = merge(var.tags, { Schedule = "daily" })
  }

  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(0 21 1 * ? *)"
    start_window      = 60
    completion_window = 720

    lifecycle {
      cold_storage_after = 30
      delete_after       = var.monthly_retention_days
    }

    dynamic "copy_action" {
      for_each = var.dr_vault_arn == null ? [] : [var.dr_vault_arn]
      content {
        destination_vault_arn = copy_action.value
        lifecycle {
          cold_storage_after = 30
          delete_after       = var.monthly_retention_days
        }
      }
    }

    recovery_point_tags = merge(var.tags, { Schedule = "monthly" })
  }

  tags = var.tags
}

resource "aws_backup_selection" "tagged" {
  count = var.create_plan ? 1 : 0

  name         = "${var.name_prefix}-backup-required"
  plan_id      = aws_backup_plan.this[0].id
  iam_role_arn = aws_iam_role.backup[0].arn
  resources    = var.resource_arns
}
