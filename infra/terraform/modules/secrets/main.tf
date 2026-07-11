terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each = var.secret_names

  name_prefix             = "${var.name_prefix}/${each.key}-"
  description             = each.value
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags

  lifecycle {
    prevent_destroy = true
  }
}
