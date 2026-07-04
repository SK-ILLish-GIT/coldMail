terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment after creating the state bucket (see infra/README.md).
  # backend "s3" {
  #   bucket         = "coldmail-terraform-state"
  #   key            = "coldmail/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "coldmail-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = var.project_name
  common_tags = merge(var.tags, {
    Project = var.project_name
    Managed = "terraform"
  })
}
