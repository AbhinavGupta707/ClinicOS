terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_iam_role" "config" {
  count = var.enable_config ? 1 : 0
  name  = "${var.name_prefix}-${var.region}-config"
  path  = "/clinicos/baseline/"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "config.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

# AWS Config requires broad control-plane discovery to record account resources.
# The official service policy cannot read S3 object bodies or Secrets Manager values.
resource "aws_iam_role_policy_attachment" "config_service" {
  count      = var.enable_config ? 1 : 0
  role       = aws_iam_role.config[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole"
}

resource "aws_iam_role_policy" "config_delivery" {
  count = var.enable_config ? 1 : 0
  name  = "deliver-config-snapshots"
  role  = aws_iam_role.config[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetBucketAcl", "s3:ListBucket"], Resource = var.config_bucket_arn },
      { Effect = "Allow", Action = "s3:PutObject", Resource = "${var.config_bucket_arn}/AWSLogs/${var.account_id}/Config/*" },
    ]
  })
}

resource "aws_config_configuration_recorder" "this" {
  count    = var.enable_config ? 1 : 0
  name     = "${var.name_prefix}-${var.region}"
  role_arn = aws_iam_role.config[0].arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = var.region == "ap-south-1"
  }
}

resource "aws_config_delivery_channel" "this" {
  count          = var.enable_config ? 1 : 0
  name           = "${var.name_prefix}-${var.region}"
  s3_bucket_name = var.config_bucket_name
  s3_key_prefix  = "AWSLogs/${var.account_id}/Config"

  snapshot_delivery_properties { delivery_frequency = "Six_Hours" }
  depends_on = [aws_config_configuration_recorder.this]
}

resource "aws_config_configuration_recorder_status" "this" {
  count      = var.enable_config ? 1 : 0
  name       = aws_config_configuration_recorder.this[0].name
  is_enabled = true
  depends_on = [aws_config_delivery_channel.this]
}

resource "aws_guardduty_detector" "this" {
  count                        = var.enable_guardduty ? 1 : 0
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
  tags                         = var.tags
}

resource "aws_guardduty_detector_feature" "s3_data_events" {
  count       = var.enable_guardduty ? 1 : 0
  detector_id = aws_guardduty_detector.this[0].id
  name        = "S3_DATA_EVENTS"
  status      = "ENABLED"
}

resource "aws_guardduty_detector_feature" "rds_login_events" {
  count       = var.enable_guardduty ? 1 : 0
  detector_id = aws_guardduty_detector.this[0].id
  name        = "RDS_LOGIN_EVENTS"
  status      = "ENABLED"
}

resource "aws_securityhub_account" "this" {
  count                     = var.enable_security_hub ? 1 : 0
  enable_default_standards  = false
  auto_enable_controls      = true
  control_finding_generator = "SECURITY_CONTROL"
}

resource "aws_securityhub_standards_subscription" "this" {
  for_each      = var.enable_security_hub ? var.security_hub_standard_arns : []
  standards_arn = each.value
  depends_on    = [aws_securityhub_account.this]
}
