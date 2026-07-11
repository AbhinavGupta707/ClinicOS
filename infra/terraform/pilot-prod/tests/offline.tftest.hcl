mock_provider "aws" {}
mock_provider "aws" { alias = "dr" }
mock_provider "random" {}

variables {
  aws_account_id              = "000000000000"
  terraform_state_bucket      = "offline-state-bucket"
  terraform_lock_table        = "offline-lock-table"
  terraform_state_kms_key_arn = "arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-0000-0000-000000000000"
  github_repository           = "OWNER/REPOSITORY"
  github_subject_claims       = ["repo:OWNER/REPOSITORY:environment:pilot-prod"]
  github_oidc_provider_arn    = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
  permissions_boundary_arn    = "arn:aws:iam::000000000000:policy/clinicos/baseline/clinicos-terraform-ci-boundary"
}

run "foundation_is_reversible_and_low_cost" {
  command = plan
  assert {
    condition = (
      output.activation.phase == "foundation" &&
      output.activation.nat_gateway_count == 0 &&
      output.activation.rds_instance_count == 0 &&
      output.activation.cache_cluster_node_count == 0
    )
    error_message = "Pilot foundation must not silently create the recurring-cost data plane."
  }
  assert {
    condition     = output.readiness_claim.evidence_tier == "E0-E1" && !output.backup.restore_verified && !output.alerting.delivery_verified
    error_message = "Offline definitions cannot claim restore, alert-delivery, or apply evidence."
  }
}

run "reject_runtime_without_private_admin" {
  command = plan
  variables {
    activation_phase                      = "runtime"
    auth_hostname                         = "auth.example.invalid"
    enable_malware_scanner                = true
    malware_scanner_authorized_by         = "ClinicOS Security Owner"
    malware_scanner_spend_acknowledgement = "I_ACKNOWLEDGE_GUARDDUTY_S3_AND_TAGGING_COSTS"
    image_uris = {
      adot          = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/adot@sha256:1111111111111111111111111111111111111111111111111111111111111111"
      api           = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      keycloak      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/keycloak@sha256:3333333333333333333333333333333333333333333333333333333333333333"
      media-scanner = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/media-scanner@sha256:7777777777777777777777777777777777777777777777777777777777777777"
      temporal      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/temporal@sha256:4444444444444444444444444444444444444444444444444444444444444444"
      web           = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/web@sha256:5555555555555555555555555555555555555555555555555555555555555555"
      worker        = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/worker@sha256:6666666666666666666666666666666666666666666666666666666666666666"
    }
    image_users = { adot = "10001", api = "10001", keycloak = "1000", temporal = "1000", web = "10001", worker = "10001" }
  }
  expect_failures = [check.runtime_admin_ingress]
}

run "pilot_runtime_keycloak_and_hardening" {
  command = plan
  variables {
    activation_phase                      = "runtime"
    auth_hostname                         = "auth.example.invalid"
    keycloak_admin_hostname               = "keycloak-admin.ops.example.invalid"
    keycloak_admin_private_zone_id        = "Z00000000000000000000"
    keycloak_admin_certificate_arn        = "arn:aws:acm:ap-south-1:000000000000:certificate/11111111-1111-1111-1111-111111111111"
    keycloak_admin_allowed_operator_cidrs = ["10.200.0.0/16"]
    enable_malware_scanner                = true
    malware_scanner_authorized_by         = "ClinicOS Security Owner"
    malware_scanner_spend_acknowledgement = "I_ACKNOWLEDGE_GUARDDUTY_S3_AND_TAGGING_COSTS"
    image_uris = {
      adot          = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/adot@sha256:1111111111111111111111111111111111111111111111111111111111111111"
      api           = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      keycloak      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/keycloak@sha256:3333333333333333333333333333333333333333333333333333333333333333"
      media-scanner = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/media-scanner@sha256:7777777777777777777777777777777777777777777777777777777777777777"
      temporal      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/temporal@sha256:4444444444444444444444444444444444444444444444444444444444444444"
      web           = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/web@sha256:5555555555555555555555555555555555555555555555555555555555555555"
      worker        = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/worker@sha256:6666666666666666666666666666666666666666666666666666666666666666"
    }
    image_users = { adot = "10001", api = "10001", keycloak = "1000", temporal = "1000", web = "10001", worker = "10001" }
  }
  assert {
    condition     = output.activation.runtime && !output.activation.edge && output.activation.keycloak_minimum_count >= 3
    error_message = "Runtime activation must include data dependencies, keep edge disabled, and enforce three Keycloak replicas."
  }
  assert {
    condition     = output.identity_contract.keycloak_admin_enabled && !output.identity_contract.keycloak_admin_public && output.identity_contract.pilot_minimum_replicas == 3
    error_message = "Pilot runtime must include the private admin topology without enabling public auth ingress."
  }
  assert {
    condition     = output.policy_assertions.task_hardening.keycloak.numeric_non_root_user && output.policy_assertions.task_hardening.keycloak.capability_drop_all
    error_message = "Pilot Keycloak must use the explicit non-root/capability-drop contract."
  }
}

run "reject_compliance_without_named_authority" {
  command = plan
  variables { enable_audit_compliance_lock = true }
  expect_failures = [check.audit_compliance_authorization]
}

run "authorized_compliance_shape" {
  command = plan
  variables {
    enable_audit_compliance_lock   = true
    audit_compliance_authorized_by = "ClinicOS accountable officer"
  }
  assert {
    condition     = output.activation.phase == "foundation"
    error_message = "COMPLIANCE authorization must not implicitly activate the data plane."
  }
}
