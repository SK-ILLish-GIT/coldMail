variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix for resource names"
  type        = string
  default     = "coldmail"
}

variable "github_org" {
  description = "GitHub org or user that owns the repo (for OIDC trust)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "coldMail"
}

variable "github_branch" {
  description = "Branch that may assume the deploy role"
  type        = string
  default     = "aws-migration"
}

variable "apprunner_cpu" {
  type    = string
  default = "1024"
}

variable "apprunner_memory" {
  type    = string
  default = "2048"
}

variable "cors_origin" {
  description = "CORS_ORIGIN for the App Runner URL or custom domain"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Optional custom domain (leave empty to skip Route53/ACM)"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for domain_name (required if domain_name set)"
  type        = string
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
