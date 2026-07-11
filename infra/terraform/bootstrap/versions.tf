terraform {
  required_version = "= 1.15.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.53.0"
    }
  }

  # Deliberately local until the newly created backend exists. Migration is a
  # separate, master-authorized `terraform init -migrate-state` operation.
  backend "local" {}
}
