check "backend_creation_authorization" {
  assert {
    condition = !var.authorize_backend_creation || (
      var.backend_creation_authorized_by != null &&
      length(trimspace(var.backend_creation_authorized_by)) >= 3
    )
    error_message = "Backend creation requires authorize_backend_creation=true and a named backend_creation_authorized_by."
  }
}

module "state_backend" {
  count  = var.authorize_backend_creation ? 1 : 0
  source = "../modules/state-backend"

  account_id      = var.aws_account_id
  region          = var.region
  bucket_name     = var.backend_bucket_name
  lock_table_name = var.backend_lock_table_name
  state_keys = [
    "clinicos/account-baseline/terraform.tfstate",
    "clinicos/bootstrap/terraform.tfstate",
    "clinicos/pilot-prod/terraform.tfstate",
    "clinicos/staging/terraform.tfstate",
  ]
  tags = { CostCenter = "platform-shared", Owner = "platform-security" }
}
