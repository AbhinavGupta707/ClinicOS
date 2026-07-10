terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

check "provider_source" {
  assert {
    condition     = var.create_oidc_provider != (var.oidc_provider_arn != null)
    error_message = "Select exactly one GitHub OIDC source: create_oidc_provider=true or an existing oidc_provider_arn."
  }
}

check "github_subject_scope" {
  assert {
    condition = length(var.github_subject_claims) > 0 && alltrue([
      for subject in var.github_subject_claims : startswith(subject, "repo:${var.github_repository}:")
    ])
    error_message = "Every GitHub OIDC subject must be explicitly scoped to github_repository."
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.oidc_thumbprints
  tags            = var.tags
}

locals {
  provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.oidc_provider_arn
  trust_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = var.github_subject_claims
        }
      }
    }]
  })
  state_plan_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.state_bucket_name}"
        Condition = {
          StringLike = { "s3:prefix" = [var.state_key, "${var.state_key}.tflock"] }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${var.state_bucket_name}/${var.state_key}"
      },
      {
        Effect = "Allow"
        Action = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = [
          "arn:aws:s3:::${var.state_bucket_name}/${var.state_key}.tflock",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.state_lock_table_name}"
      },
    ]
  })
  state_apply_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = "arn:aws:s3:::${var.state_bucket_name}"
        Condition = {
          StringLike = { "s3:prefix" = [var.state_key, "${var.state_key}.tflock"] }
        }
      },
      {
        Effect = "Allow"
        Action = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = [
          "arn:aws:s3:::${var.state_bucket_name}/${var.state_key}",
          "arn:aws:s3:::${var.state_bucket_name}/${var.state_key}.tflock",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${var.state_lock_table_name}"
      },
    ]
  })
}

resource "aws_iam_role" "plan" {
  name                 = "${var.name_prefix}-terraform-plan"
  path                 = "/clinicos/${var.name_prefix}/ci/"
  assume_role_policy   = local.trust_policy
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "terraform-state-read-lock-only"
  role   = aws_iam_role.plan.id
  policy = local.state_plan_policy
}

resource "aws_iam_role" "publish" {
  name                 = "${var.name_prefix}-artifact-publish"
  path                 = "/clinicos/${var.name_prefix}/ci/"
  assume_role_policy   = local.trust_policy
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy" "publish" {
  name = "push-immutable-images"
  role = aws_iam_role.publish.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = values(var.ecr_repository_arns)
      },
    ]
  })
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name_prefix}-terraform-apply"
  path                 = "/clinicos/${var.name_prefix}/ci/"
  assume_role_policy   = local.trust_policy
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy" "deploy_state" {
  name   = "terraform-state-read-write-lock"
  role   = aws_iam_role.deploy.id
  policy = local.state_apply_policy
}

resource "aws_iam_role_policy_attachment" "deploy_read_only" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "deploy" {
  name   = "environment-scoped-platform-deploy"
  role   = aws_iam_role.deploy.id
  policy = var.deploy_policy_json
}
