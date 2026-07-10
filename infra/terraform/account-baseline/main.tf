locals {
  any_activation = anytrue(values(var.activation))
  tags           = { CostCenter = "platform-shared", Owner = "platform-security", DataResidency = "India" }
  primary_security_hub_standards = [
    "arn:aws:securityhub:${var.primary_region}::standards/aws-foundational-security-best-practices/v/1.0.0",
    "arn:aws:securityhub:${var.primary_region}::standards/cis-aws-foundations-benchmark/v/1.4.0",
  ]
  dr_security_hub_standards = [
    "arn:aws:securityhub:${var.dr_region}::standards/aws-foundational-security-best-practices/v/1.0.0",
    "arn:aws:securityhub:${var.dr_region}::standards/cis-aws-foundations-benchmark/v/1.4.0",
  ]
  s3_data_event_inputs_valid = (
    var.activation.cloudtrail &&
    length(var.cloudtrail_s3_object_arns) >= 2 &&
    anytrue([for arn in var.cloudtrail_s3_object_arns : can(regex("-media/\\*$", arn))]) &&
    anytrue([for arn in var.cloudtrail_s3_object_arns : can(regex("-audit/\\*$", arn))])
  )
}

check "standalone_account_activation" {
  assert {
    condition = !local.any_activation || (
      var.activation_authorized_by != null && length(trimspace(var.activation_authorized_by)) >= 3
    )
    error_message = "Every cost/control activation requires a named activation_authorized_by; this root never creates or joins AWS Organizations."
  }
}

check "cloudtrail_s3_data_event_scope" {
  assert {
    condition     = !var.activation.cloudtrail_s3_data_events || local.s3_data_event_inputs_valid
    error_message = "CloudTrail S3 data events require CloudTrail plus exact media and audit bucket object ARNs; all-bucket wildcards are forbidden."
  }
}

module "singleton" {
  source = "../modules/account-baseline"

  account_id                       = var.aws_account_id
  region                           = var.primary_region
  enable_cloudtrail                = var.activation.cloudtrail
  enable_cloudtrail_s3_data_events = var.activation.cloudtrail_s3_data_events && local.s3_data_event_inputs_valid
  cloudtrail_s3_object_arns        = var.cloudtrail_s3_object_arns
  enable_config_delivery           = var.activation.config
  create_ci_permissions_boundary   = var.activation.ci_permissions_boundary
  log_bucket_name                  = var.security_log_bucket_name
  state_bucket_name                = var.terraform_state_bucket
  state_lock_table_name            = var.terraform_lock_table
  state_kms_key_arn                = var.terraform_state_kms_key_arn
  tags                             = local.tags
}

module "primary_controls" {
  source = "../modules/regional-security"

  account_id                 = var.aws_account_id
  region                     = var.primary_region
  name_prefix                = "clinicos-account"
  config_bucket_name         = coalesce(module.singleton.log_bucket_name, var.security_log_bucket_name)
  config_bucket_arn          = coalesce(module.singleton.log_bucket_arn, "arn:aws:s3:::${var.security_log_bucket_name}")
  enable_config              = var.activation.config
  enable_guardduty           = var.activation.guardduty
  enable_security_hub        = var.activation.security_hub
  security_hub_standard_arns = local.primary_security_hub_standards
  tags                       = local.tags
}

module "dr_controls" {
  source    = "../modules/regional-security"
  providers = { aws = aws.dr }

  account_id                 = var.aws_account_id
  region                     = var.dr_region
  name_prefix                = "clinicos-account"
  config_bucket_name         = coalesce(module.singleton.log_bucket_name, var.security_log_bucket_name)
  config_bucket_arn          = coalesce(module.singleton.log_bucket_arn, "arn:aws:s3:::${var.security_log_bucket_name}")
  enable_config              = var.activation.config
  enable_guardduty           = var.activation.guardduty
  enable_security_hub        = var.activation.security_hub
  security_hub_standard_arns = local.dr_security_hub_standards
  tags                       = local.tags
}

resource "aws_securityhub_finding_aggregator" "account" {
  count        = var.activation.security_hub ? 1 : 0
  linking_mode = "ALL_REGIONS"

  depends_on = [module.primary_controls, module.dr_controls]
}
