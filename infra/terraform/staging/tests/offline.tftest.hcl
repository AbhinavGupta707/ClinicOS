mock_provider "aws" {}

mock_provider "aws" {
  alias = "dr"
}

mock_provider "random" {}

run "offline_plan" {
  command = plan

  variables {
    aws_account_id           = "000000000000"
    terraform_state_bucket   = "offline-state-bucket"
    terraform_lock_table     = "offline-lock-table"
    github_repository        = "OWNER/REPOSITORY"
    github_subject_claims    = ["repo:OWNER/REPOSITORY:environment:staging"]
    github_oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
  }

  assert {
    condition     = output.readiness_claim.evidence_tier == "E0-E1"
    error_message = "An offline plan must never claim deployed evidence."
  }

  assert {
    condition     = output.edge.enabled == false && output.edge.applied_tls_verified == false
    error_message = "Public/TLS readiness must remain false without explicit inputs."
  }
}

run "full_runtime_and_edge_shape_plan" {
  command = plan

  variables {
    aws_account_id           = "000000000000"
    terraform_state_bucket   = "offline-state-bucket"
    terraform_lock_table     = "offline-lock-table"
    github_repository        = "OWNER/REPOSITORY"
    github_subject_claims    = ["repo:OWNER/REPOSITORY:environment:staging"]
    github_oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"

    enable_runtime        = true
    enable_public_ingress = true
    certificate_arn       = "arn:aws:acm:ap-south-1:000000000000:certificate/00000000-0000-0000-0000-000000000000"
    web_hostname          = "app.example.invalid"
    api_hostname          = "api.example.invalid"
    auth_hostname         = "auth.example.invalid"
    image_uris = {
      adot     = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/adot@sha256:1111111111111111111111111111111111111111111111111111111111111111"
      api      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      keycloak = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/keycloak@sha256:3333333333333333333333333333333333333333333333333333333333333333"
      temporal = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/temporal@sha256:4444444444444444444444444444444444444444444444444444444444444444"
      web      = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/web@sha256:5555555555555555555555555555555555555555555555555555555555555555"
      worker   = "000000000000.dkr.ecr.ap-south-1.amazonaws.com/worker@sha256:6666666666666666666666666666666666666666666666666666666666666666"
    }
  }

  assert {
    condition     = output.edge.enabled && output.edge.tls_inputs_complete && !output.edge.applied_tls_verified
    error_message = "The full-shape plan must distinguish complete TLS inputs from unverified applied TLS."
  }

  assert {
    condition     = output.readiness_claim.staging_or_pilot_ready == false
    error_message = "Even a full-shape mock plan cannot claim staging readiness."
  }
}
