resource "aws_apprunner_service" "app" {
  service_name = "${local.name_prefix}-api"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    auto_deployments_enabled = true

    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:latest"
      image_repository_type = "ECR"

      image_configuration {
        port = "4000"

        runtime_environment_variables = {
          NODE_ENV                    = "production"
          PORT                        = "4000"
          MONGODB_DB                  = "coldmail"
          CORS_ORIGIN                 = var.cors_origin != "" ? var.cors_origin : "https://placeholder.update-after-deploy"
          S3_BUCKET                   = aws_s3_bucket.resumes.bucket
          S3_REGION                   = var.aws_region
          JWT_ACCESS_TTL              = "15m"
          JWT_REFRESH_TTL             = "30d"
          AUTH_RATE_LIMIT_MAX         = "20"
          GEMINI_MODEL                = "gemini-2.5-flash"
          GROQ_MODEL                  = "llama-3.3-70b-versatile"
          AI_PROVIDER                 = "gemini"
          ENRICH_CONFIDENCE_THRESHOLD = "0.5"
          RATE_LIMIT_WINDOW_MIN       = "1"
          RATE_LIMIT_MAX              = "30"
          BULK_SEND_DELAY_MS          = "250"
          DRAFT_ATTACHMENT_FILENAME   = "Sk_Sahil_Parvez_CV"
          SMTP_HOST                   = "smtp.gmail.com"
          SMTP_PORT                   = "587"
          SMTP_SECURE                 = "false"
          IMAP_HOST                   = "imap.gmail.com"
          IMAP_PORT                   = "993"
          SEED_ADMIN_EMAIL            = "sksahilparvez2000@gmail.com"
          SEED_ADMIN_NAME             = "Sahil"
        }

        runtime_environment_secrets = {
          for key, env_name in local.secret_env_map :
          env_name => aws_secretsmanager_secret.app[key].arn
        }
      }
    }
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = local.common_tags
}

# Optional custom domain (App Runner provisions TLS; add DNS validation records it returns).
resource "aws_apprunner_custom_domain_association" "app" {
  count = var.domain_name != "" ? 1 : 0

  domain_name          = var.domain_name
  service_arn          = aws_apprunner_service.app.arn
  enable_www_subdomain = false
}

resource "aws_route53_record" "app" {
  count = var.domain_name != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_custom_domain_association.app[0].dns_target]
}
