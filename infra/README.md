# coldMail AWS infrastructure

Terraform for **EC2 Free Tier** deployment on the `aws-migration` branch. Matches the console setup in [`details.md`](../details.md).

## Architecture

| Component | AWS service |
|-----------|-------------|
| Compute | EC2 t3.micro (Docker container on port 4000) |
| Container image | ECR (`coldmail-app`) |
| Resume PDFs | S3 (opt-in via `S3_BUCKET`) |
| Secrets | Secrets Manager |
| CI/CD (optional) | GitHub Actions → ECR push (OIDC) |
| Database | MongoDB Atlas (unchanged) |

## Prerequisites

- AWS CLI + Terraform >= 1.5
- Docker (build and push image before EC2 can start)
- An EC2 **key pair** in your region (for SSH)

## Fresh deploy (Terraform creates everything)

### 1. Configure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Set key_name, ssh_allowed_cidr (your IP/32), github_org if needed
```

### 2. Phase A — ECR, S3, IAM, secrets, security group (no EC2 yet)

```bash
terraform init
terraform apply \
  -target=aws_ecr_repository.app \
  -target=aws_s3_bucket.resumes \
  -target=aws_s3_bucket_public_access_block.resumes \
  -target=aws_s3_bucket_versioning.resumes \
  -target=aws_s3_bucket_server_side_encryption_configuration.resumes \
  -target=aws_s3_bucket_lifecycle_configuration.resumes \
  -target=aws_iam_role.ec2_instance \
  -target=aws_iam_role_policy.ec2_instance \
  -target=aws_iam_instance_profile.ec2 \
  -target=aws_iam_openid_connect_provider.github \
  -target=aws_iam_role.github_deploy \
  -target=aws_iam_role_policy.github_deploy \
  -target=aws_secretsmanager_secret.app \
  -target=aws_security_group.app
```

### 3. Phase B — push Docker image

```bash
ECR_URL=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin "${ECR_URL%%/*}"

cd ../..   # repo root
docker build -t "$ECR_URL:latest" .
docker push "$ECR_URL:latest"
```

### 4. Populate secrets

```bash
aws secretsmanager put-secret-value --secret-id coldmail/mongodb-uri --secret-string 'mongodb+srv://...'
aws secretsmanager put-secret-value --secret-id coldmail/jwt-access-secret --secret-string '...'
aws secretsmanager put-secret-value --secret-id coldmail/jwt-refresh-secret --secret-string '...'
aws secretsmanager put-secret-value --secret-id coldmail/smtp-user --secret-string '...'
aws secretsmanager put-secret-value --secret-id coldmail/smtp-pass --secret-string '...'
aws secretsmanager put-secret-value --secret-id coldmail/mail-from --secret-string '...'
```

Values are **plaintext only** (no `KEY=value` prefix).

### 5. Phase C — EC2 + Elastic IP

```bash
terraform apply
```

Outputs:

```bash
terraform output app_url
terraform output health_check_url
```

---

## Already built via console? Import instead

If you created resources manually (ECR, S3, secrets, IAM role, EC2), import them before `terraform apply`:

```bash
terraform init

# Examples — replace IDs with yours
terraform import aws_ecr_repository.app coldmail-app
terraform import aws_s3_bucket.resumes coldmail-resumes-972379852789
terraform import aws_iam_role.ec2_instance coldmail-ec2-instance
terraform import aws_security_group.app sg-xxxxxxxx
terraform import aws_instance.app i-xxxxxxxx
terraform import 'aws_secretsmanager_secret.app["mongodb-uri"]' coldmail/mongodb-uri
# ... repeat for each secret key in secrets.tf
```

Then `terraform plan` should show minimal drift. Fix differences in `.tf` files or accept console state.

**Do not** run a full `terraform apply` on a fresh config if console resources already exist with the same names — import first.

---

## GitHub Actions (optional)

After `terraform apply`, add to GitHub **Settings → Secrets → Actions**:

| Secret | Source |
|--------|--------|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_deploy_role_arn` |

Pushes to `aws-migration` build and push `:latest` to ECR. **Redeploy on EC2** manually:

```bash
ssh -i key.pem ec2-user@<ip>
sudo docker pull <ecr-url>:latest
sudo docker rm -f coldmail && sudo /path/to/start-coldmail.sh
```

Or re-run the user-data script from `user_data.sh.tpl`.

---

## Local Docker test

```bash
docker build -t coldmail:local .
docker run --rm -p 4000:4000 --env-file server/.env coldmail:local
curl http://localhost:4000/api/health
```

## S3 resume storage

When `S3_BUCKET` is set (EC2 user data sets this), new uploads go to S3. Inline Mongo PDFs from before migration still work.
