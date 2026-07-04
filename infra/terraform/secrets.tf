locals {
  secret_names = toset([
    "mongodb-uri",
    "jwt-access-secret",
    "jwt-refresh-secret",
    "seed-admin-password",
    "smtp-user",
    "smtp-pass",
    "mail-from",
    "gemini-api-key",
    "groq-api-key",
    "resend-api-key",
  ])
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.secret_names

  name = "${local.name_prefix}/${each.key}"
  tags = local.common_tags
}

# Map Terraform secret keys to App Runner env var names.
locals {
  secret_env_map = {
    "mongodb-uri"         = "MONGODB_URI"
    "jwt-access-secret"   = "JWT_ACCESS_SECRET"
    "jwt-refresh-secret"  = "JWT_REFRESH_SECRET"
    "seed-admin-password" = "SEED_ADMIN_PASSWORD"
    "smtp-user"           = "SMTP_USER"
    "smtp-pass"           = "SMTP_PASS"
    "mail-from"           = "MAIL_FROM"
    "gemini-api-key"      = "GEMINI_API_KEY"
    "groq-api-key"        = "GROQ_API_KEY"
    "resend-api-key"      = "RESEND_API_KEY"
  }
}
