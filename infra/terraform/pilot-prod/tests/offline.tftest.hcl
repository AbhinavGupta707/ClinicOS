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
    github_subject_claims    = ["repo:OWNER/REPOSITORY:environment:pilot-prod"]
    github_oidc_provider_arn = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
  }

  assert {
    condition     = output.readiness_claim.evidence_tier == "E0-E1"
    error_message = "An offline plan must never claim deployed evidence."
  }

  assert {
    condition     = output.backup.restore_verified == false && output.alerting.delivery_verified == false
    error_message = "Offline plan intent cannot claim restore or alert delivery."
  }
}
