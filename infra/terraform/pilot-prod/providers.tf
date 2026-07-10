provider "aws" {
  region = var.primary_region

  access_key = var.offline_validation_mode ? "offline_access_key" : null
  secret_key = var.offline_validation_mode ? "offline_secret_key" : null

  allowed_account_ids         = var.offline_validation_mode ? null : [var.aws_account_id]
  skip_credentials_validation = var.offline_validation_mode
  skip_metadata_api_check     = var.offline_validation_mode
  skip_region_validation      = var.offline_validation_mode
  skip_requesting_account_id  = var.offline_validation_mode

  default_tags {
    tags = {
      Project     = "ClinicOS"
      Environment = "pilot-prod"
      ManagedBy   = "Terraform"
    }
  }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region

  access_key = var.offline_validation_mode ? "offline_access_key" : null
  secret_key = var.offline_validation_mode ? "offline_secret_key" : null

  allowed_account_ids         = var.offline_validation_mode ? null : [var.aws_account_id]
  skip_credentials_validation = var.offline_validation_mode
  skip_metadata_api_check     = var.offline_validation_mode
  skip_region_validation      = var.offline_validation_mode
  skip_requesting_account_id  = var.offline_validation_mode

  default_tags {
    tags = {
      Project     = "ClinicOS"
      Environment = "pilot-prod"
      ManagedBy   = "Terraform"
    }
  }
}
