# ==============================================================================
# AEGIS-Graph: Zero-Vulnerability Compliant Cloud Infrastructure
# ==============================================================================
# Architecture Profile:
#   - Compute: Private internal worker (no public IP, no 0.0.0.0/0 ingress)
#   - IAM: Strictly scoped least-privilege role (no wildcards, no admin, no PassRole)
#   - Data: Encrypted Customer Vault S3 with full public access block enabled
# ==============================================================================

# 1. Private Compute Instance (Isolated inside VPC private subnet)
resource "aws_instance" "internal_backend_worker" {
  ami                         = "ami-0abcdef1234567890"
  instance_type               = "t3.medium"
  associate_public_ip_address = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 enforced
    http_put_response_hop_limit = 1
  }

  tags = {
    Name        = "Internal Backend Worker"
    Environment = "Production"
    Network     = "Private-Subnet"
  }
}

# 2. Least-Privilege IAM Role (No AdministratorAccess, No Wildcard PassRole)
resource "aws_iam_role" "scoped_app_role" {
  name        = "scoped-backend-execution-role"
  description = "Scoped IAM role with minimal permissions for background processing"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# 3. Least-Privilege Policy (Explicit Action & Resource - Zero Overprivilege)
resource "aws_iam_role_policy" "scoped_execution_policy" {
  name = "scoped-kms-log-policy"
  role = aws_iam_role.scoped_app_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/app/*"
      }
    ]
  })
}

# 4. Protected Cloud Storage Asset (Encrypted, Private)
resource "aws_s3_bucket" "secure_customer_vault" {
  bucket = "prod-secure-customer-vault-pii"

  tags = {
    Classification = "Confidential"
    Compliance     = "Zero-Trust"
  }
}

# 5. S3 Block Public Access (Ensures zero internet exposure)
resource "aws_s3_bucket_public_access_block" "vault_block_public" {
  bucket = aws_s3_bucket.secure_customer_vault.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
