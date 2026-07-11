mock_provider "aws" {}

run "safe_default_creates_nothing" {
  command = plan
  variables {
    aws_account_id      = "000000000000"
    backend_bucket_name = "clinicos-offline-terraform-state"
  }
  assert {
    condition     = output.backend == null
    error_message = "The bootstrap default must not create a singleton backend."
  }
}

run "authorized_backend_shape" {
  command = plan
  variables {
    aws_account_id                 = "000000000000"
    backend_bucket_name            = "clinicos-offline-terraform-state"
    authorize_backend_creation     = true
    backend_creation_authorized_by = "CP14 master"
  }
  assert {
    condition     = output.backend != null
    error_message = "An explicitly authorized bootstrap must define the dedicated backend."
  }
}

run "reject_unnamed_backend_authorization" {
  command = plan
  variables {
    aws_account_id             = "000000000000"
    backend_bucket_name        = "clinicos-offline-terraform-state"
    authorize_backend_creation = true
  }
  expect_failures = [check.backend_creation_authorization]
}
