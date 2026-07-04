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
