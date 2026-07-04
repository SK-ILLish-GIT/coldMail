output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "s3_bucket_name" {
  value = aws_s3_bucket.resumes.bucket
}

output "ec2_instance_id" {
  value = aws_instance.app.id
}

output "ec2_public_ip" {
  value = local.public_ip
}

output "app_url" {
  value = "http://${local.public_ip}:4000"
}

output "health_check_url" {
  value = "http://${local.public_ip}:4000/api/health"
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "ec2_instance_role_arn" {
  value = aws_iam_role.ec2_instance.arn
}

output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}
