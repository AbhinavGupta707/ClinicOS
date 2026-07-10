terraform {
  required_version = "= 1.15.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.53.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.7.2"
    }
  }

  backend "s3" {}
}
