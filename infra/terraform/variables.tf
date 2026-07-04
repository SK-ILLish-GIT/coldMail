variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Prefix for resource names"
  type        = string
  default     = "coldmail"
}

variable "github_org" {
  description = "GitHub org or user that owns the repo (for OIDC trust)"
  type        = string
  default     = "SK-ILLish-GIT"
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

variable "instance_type" {
  description = "EC2 instance type (t3.micro is free-tier eligible)"
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "Existing EC2 key pair name for SSH access"
  type        = string
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH (port 22) — use your public IP/32"
  type        = string
  default     = "0.0.0.0/0"
}

variable "app_allowed_cidr" {
  description = "CIDR allowed to reach the app (port 4000)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "allocate_eip" {
  description = "Attach an Elastic IP so the public address survives reboots"
  type        = bool
  default     = true
}

variable "seed_admin_email" {
  type    = string
  default = "sksahilparvez2000@gmail.com"
}

variable "seed_admin_name" {
  type    = string
  default = "Sahil"
}

variable "tags" {
  type    = map(string)
  default = {}
}
