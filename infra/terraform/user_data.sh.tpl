#!/bin/bash
set -euxo pipefail

REGION="${region}"
ACCOUNT_ID="${account_id}"
ECR_HOST="${ecr_host}"
IMAGE="${image}"
S3_BUCKET="${s3_bucket}"

dnf update -y
dnf install -y docker awscli
systemctl enable docker
systemctl start docker

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_HOST"

get_secret() {
  aws secretsmanager get-secret-value \
    --secret-id "$1" \
    --region "$REGION" \
    --query SecretString \
    --output text
}

MONGODB_URI="$(get_secret ${project_name}/mongodb-uri)"
JWT_ACCESS_SECRET="$(get_secret ${project_name}/jwt-access-secret)"
JWT_REFRESH_SECRET="$(get_secret ${project_name}/jwt-refresh-secret)"
SMTP_USER="$(get_secret ${project_name}/smtp-user)"
SMTP_PASS="$(get_secret ${project_name}/smtp-pass)"
MAIL_FROM="$(get_secret ${project_name}/mail-from)"

PUBLIC_IP="$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
CORS_ORIGIN="http://$${PUBLIC_IP}:4000"

docker pull "$IMAGE"
docker rm -f coldmail 2>/dev/null || true

docker run -d --name coldmail --restart unless-stopped -p 4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e MONGODB_URI="$MONGODB_URI" \
  -e MONGODB_DB=coldmail \
  -e JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" \
  -e JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
  -e JWT_ACCESS_TTL=15m \
  -e JWT_REFRESH_TTL=30d \
  -e AUTH_RATE_LIMIT_MAX=20 \
  -e CORS_ORIGIN="$CORS_ORIGIN" \
  -e S3_BUCKET="$S3_BUCKET" \
  -e S3_REGION="$REGION" \
  -e GEMINI_MODEL=gemini-2.5-flash \
  -e GROQ_MODEL=llama-3.3-70b-versatile \
  -e AI_PROVIDER=gemini \
  -e ENRICH_CONFIDENCE_THRESHOLD=0.5 \
  -e RATE_LIMIT_WINDOW_MIN=1 \
  -e RATE_LIMIT_MAX=30 \
  -e BULK_SEND_DELAY_MS=250 \
  -e DRAFT_ATTACHMENT_FILENAME=Sk_Sahil_Parvez_CV \
  -e SMTP_HOST=smtp.gmail.com \
  -e SMTP_PORT=587 \
  -e SMTP_SECURE=false \
  -e SMTP_USER="$SMTP_USER" \
  -e SMTP_PASS="$SMTP_PASS" \
  -e MAIL_FROM="$MAIL_FROM" \
  -e IMAP_HOST=imap.gmail.com \
  -e IMAP_PORT=993 \
  -e SEED_ADMIN_EMAIL="${seed_admin_email}" \
  -e SEED_ADMIN_NAME="${seed_admin_name}" \
  "$IMAGE"
