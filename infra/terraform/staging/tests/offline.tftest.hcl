mock_provider "aws" {}
mock_provider "aws" { alias = "dr" }
mock_provider "random" {}

variables {
  aws_account_id              = "000000000000"
  terraform_state_bucket      = "offline-state-bucket"
  terraform_lock_table        = "offline-lock-table"
  terraform_state_kms_key_arn = "arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-0000-0000-000000000000"
  github_repository           = "OWNER/REPOSITORY"
  github_subject_claims       = ["repo:OWNER/REPOSITORY:environment:staging"]
  github_oidc_provider_arn    = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
  permissions_boundary_arn    = "arn:aws:iam::000000000000:policy/clinicos/baseline/clinicos-terraform-ci-boundary"
}

run "foundation_plan" {
  command = plan

  assert {
    condition = (
      output.activation.phase == "foundation" &&
      output.activation.nat_gateway_count == 0 &&
      output.activation.interface_endpoint_count == 0 &&
      output.activation.rds_instance_count == 0 &&
      output.activation.cache_cluster_node_count == 0
    )
    error_message = "The default foundation plan must exclude the recurring-cost data plane."
  }
  assert {
    condition = (
      output.policy_assertions.ci.managed_read_only_attached == false &&
      output.policy_assertions.ci.permissions_boundary_mandatory &&
      output.policy_assertions.ci.discovery_reads_s3_objects == false &&
      output.policy_assertions.ci.discovery_reads_secret_values == false
    )
    error_message = "CI policy must have no managed ReadOnlyAccess, broad sensitive reads, or unconditioned root resource star."
  }
  assert {
    condition     = output.readiness_claim.evidence_tier == "E0-E1" && !output.edge.applied_tls_verified
    error_message = "An offline plan must never claim applied evidence."
  }
}

run "data_plane_shape" {
  command = plan
  variables { activation_phase = "data-plane" }

  assert {
    condition = (
      output.activation.recurring_data_plane &&
      output.activation.nat_gateway_count == 1 &&
      output.activation.interface_endpoint_count == 7 &&
      output.activation.rds_instance_count == 1 &&
      output.activation.cache_cluster_node_count == 2
    )
    error_message = "The data-plane phase must explicitly disclose every major fixed-cost service."
  }
  assert {
    condition = (
      output.policy_assertions.endpoint.source_is_security_group &&
      output.policy_assertions.endpoint.s3_resource_mode == "declared-bucket-arns" &&
      output.policy_assertions.endpoint.s3_action_mode == "enumerated-object-actions" &&
      output.policy_assertions.endpoint.secrets_resource_mode == "declared-secret-arns"
    )
    error_message = "Endpoint policies must use exact resources and workload-SG-only source access."
  }
  assert {
    condition = (
      output.policy_assertions.enhanced_monitoring.interval_seconds == 60 &&
      output.policy_assertions.enhanced_monitoring.policy_scoped
    )
    error_message = "RDS Enhanced Monitoring must be enabled at 60 seconds with a scoped role."
  }
}

run "full_runtime_and_edge_shape" {
  command = plan
  variables {
    activation_phase                      = "edge"
    certificate_arn                       = "arn:aws:acm:ap-south-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
    web_hostname                          = "app.example.invalid"
    api_hostname                          = "api.example.invalid"
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
    condition     = output.edge.enabled && output.edge.tls_inputs_complete && !output.edge.applied_tls_verified
    error_message = "The edge plan must distinguish complete inputs from unverified applied TLS."
  }
  assert {
    condition     = output.activation.interface_endpoint_count == 8
    error_message = "Runtime media must add the exact Lambda interface endpoint."
  }
  assert {
    condition = (
      output.identity_contract.keycloak_admin_enabled &&
      !output.identity_contract.keycloak_admin_public &&
      output.identity_contract.admin_and_auth_hosts_separate &&
      output.identity_contract.keycloak_cluster_self_ports == [7800, 57800] &&
      !output.identity_contract.private_admin_applied_verified
    )
    error_message = "Runtime must define a distinct unverified internal admin path and both Keycloak cluster ports."
  }
  assert {
    condition = alltrue([
      for hardening in values(output.policy_assertions.task_hardening) :
      hardening.numeric_non_root_user && hardening.readonly_root_filesystem && !hardening.privileged && hardening.capability_drop_all && !hardening.execute_command_enabled
    ])
    error_message = "Every task must be non-root, read-only, unprivileged, capability-dropped, and non-exec."
  }
}
