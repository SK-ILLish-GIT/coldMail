output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "s3_bucket_name" {
  value = aws_s3_bucket.resumes.bucket
}

output "apprunner_service_url" {
  value = "https://${aws_apprunner_service.app.service_url}"
}

output "apprunner_service_arn" {
  value = aws_apprunner_service.app.arn
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}
