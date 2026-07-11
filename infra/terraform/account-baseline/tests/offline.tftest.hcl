mock_provider "aws" {}
mock_provider "aws" { alias = "dr" }

variables {
  aws_account_id              = "000000000000"
  security_log_bucket_name    = "clinicos-offline-security-logs"
  terraform_state_bucket      = "clinicos-offline-terraform-state"
  terraform_lock_table        = "clinicos-offline-locks"
  terraform_state_kms_key_arn = "arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-0000-0000-000000000000"
}

run "safe_opt_in_default" {
  command = plan
  assert {
    condition     = output.account_posture.cloudtrail_multi_region == false && length(output.account_posture.config_regions) == 0
    error_message = "Account services must remain cost-aware opt-in controls."
  }
  assert {
    condition     = !output.account_posture.s3_data_event_audit.enabled && length(output.account_posture.s3_data_event_audit.declared_object_arns) == 0
    error_message = "The baseline must not silently enable chargeable S3 object data events."
  }
}

run "full_standalone_account_shape" {
  command = plan
  variables {
    activation               = { cloudtrail = true, cloudtrail_s3_data_events = true, config = true, guardduty = true, security_hub = true, ci_permissions_boundary = true }
    activation_authorized_by = "CP14 master"
    cloudtrail_s3_object_arns = [
      "arn:aws:s3:::clinicos-staging-000000000000-primary-media/*",
      "arn:aws:s3:::clinicos-staging-000000000000-primary-audit/*",
      "arn:aws:s3:::clinicos-pilot-prod-000000000000-primary-media/*",
      "arn:aws:s3:::clinicos-pilot-prod-000000000000-primary-audit/*",
      "arn:aws:s3:::clinicos-staging-000000000000-primary-media/*",
    ]
  }
  assert {
    condition     = output.account_posture.organization_mode == "standalone-account" && output.account_posture.organizations_resources == false
    error_message = "The baseline must not depend on AWS Organizations."
  }
  assert {
    condition     = output.account_posture.cloudtrail_multi_region && length(output.account_posture.guardduty_regions) == 2 && length(output.account_posture.security_hub_regions) == 2
    error_message = "The singleton state must own the multi-region account security posture."
  }
  assert {
    condition     = output.account_posture.excludes_sensitive_data_reads
    error_message = "The CI boundary must exclude secret-value and unrelated object reads."
  }
  assert {
    condition = (
      output.account_posture.s3_data_event_audit.enabled &&
      length(output.account_posture.s3_data_event_audit.declared_object_arns) == 4 &&
      !output.account_posture.s3_data_event_audit.wildcard_bucket
    )
    error_message = "S3 object audit selectors must be exact, bounded, and deduplicated."
  }
}

run "reject_unbounded_s3_data_event_activation" {
  command = plan
  variables {
    activation               = { cloudtrail = true, cloudtrail_s3_data_events = true, config = false, guardduty = false, security_hub = false, ci_permissions_boundary = false }
    activation_authorized_by = "CP14 master"
  }
  expect_failures = [check.cloudtrail_s3_data_event_scope]
}

run "reject_unnamed_activation" {
  command = plan
  variables {
    activation = { cloudtrail = true, config = false, guardduty = false, security_hub = false, ci_permissions_boundary = false }
  }
  expect_failures = [check.standalone_account_activation]
}
