# coldMail AWS infrastructure

Terraform + App Runner deployment for the `aws-migration` branch. `main` stays on Render.

## Architecture

| Component | AWS service |
|-----------|-------------|
| Compute | App Runner (container from ECR) |
| Resume PDFs | S3 (opt-in via `S3_BUCKET`) |
| Secrets | Secrets Manager |
| DNS/TLS (optional) | Route 53 + App Runner custom domain |
| CI/CD | GitHub Actions + OIDC |
| Database | MongoDB Atlas (unchanged) |

## Prerequisites

- AWS CLI configured (`aws configure` or SSO)
- Terraform >= 1.5
- Docker (local build test or first image push)
- GitHub repo: `SK-ILLish-GIT/coldMail`

## 1. Bootstrap Terraform state (optional but recommended)

```bash
aws s3 mb s3://coldmail-terraform-state --region us-east-1
aws dynamodb create-table \
  --table-name coldmail-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Uncomment the `backend "s3"` block in `terraform/versions.tf`, then re-init.

## 2. Configure variables

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit github_org, cors_origin (after first deploy), optional domain_name
```

## 3. Two-phase apply (ECR image must exist before App Runner)

**Phase A** — everything except App Runner:

```bash
terraform init
terraform apply \
  -target=aws_ecr_repository.app \
  -target=aws_s3_bucket.resumes \
  -target=aws_iam_role.apprunner_ecr_access \
  -target=aws_iam_role.apprunner_instance \
  -target=aws_iam_role.github_deploy \
  -target=aws_secretsmanager_secret.app
```

**Phase B** — build and push the first image:

```bash
# From repo root
ECR_URL=$(terraform -chdir=infra/terraform output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin "${ECR_URL%%/*}"
docker build -t "$ECR_URL:latest" .
docker push "$ECR_URL:latest"
```

**Phase C** — full apply (creates App Runner service):

```bash
terraform -chdir=infra/terraform apply
```

Note the `apprunner_service_url` output and set `cors_origin` in `terraform.tfvars`, then `terraform apply` again.

## 4. Populate Secrets Manager

Terraform creates empty secret shells. Set values once (repeat for each key):

```bash
aws secretsmanager put-secret-value \
  --secret-id coldmail/mongodb-uri \
  --secret-string 'mongodb+srv://...'
```

Required secrets: `mongodb-uri`, `jwt-access-secret`, `jwt-refresh-secret`, `smtp-user`, `smtp-pass`, `mail-from`.

Optional: `seed-admin-password`, `gemini-api-key`, `groq-api-key`, `resend-api-key`.

After updating secrets, start a new App Runner deployment (Console or `aws apprunner start-deployment`).

## 5. GitHub Actions OIDC

After `terraform apply`, add these repository secrets (`Settings → Secrets → Actions`):

| Secret | Source |
|--------|--------|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_deploy_role_arn` |
| `APPRUNNER_SERVICE_ARN` | `terraform output apprunner_service_arn` (optional if auto-deploy on) |

Pushes to `aws-migration` build, push `:latest` to ECR, and trigger deployment.

## 6. Local Docker test

```bash
docker build -t coldmail:local .
docker run --rm -p 4000:4000 \
  -e MONGODB_URI='...' \
  -e JWT_ACCESS_SECRET='dev' \
  -e JWT_REFRESH_SECRET='dev' \
  coldmail:local
curl http://localhost:4000/api/health
```

## S3 resume storage

When `S3_BUCKET` is set (App Runner sets this automatically), new resume uploads go to S3. Existing inline resumes in MongoDB still work. Unset `S3_BUCKET` locally to keep dev behavior unchanged.
