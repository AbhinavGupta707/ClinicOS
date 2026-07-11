terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  s3_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DeclaredBucketMetadata"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource  = tolist(var.s3_bucket_arns)
        Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } }
      },
      {
        Sid       = "DeclaredBucketObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:AbortMultipartUpload", "s3:GetObject", "s3:GetObjectAttributes", "s3:GetObjectTagging", "s3:PutObject", "s3:PutObjectTagging"]
        Resource  = [for arn in var.s3_bucket_arns : "${arn}/*"]
        Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } }
      },
    ]
  })
  interface_policies = merge({
    "ecr.api" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        { Effect = "Allow", Principal = "*", Action = "ecr:GetAuthorizationToken", Resource = "*", Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } },
        { Effect = "Allow", Principal = "*", Action = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = tolist(var.ecr_repository_arns), Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } },
      ]
    })
    "ecr.dkr" = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = tolist(var.ecr_repository_arns), Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } }]
    })
    kms = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey*", "kms:Verify"], Resource = tolist(var.kms_key_arns), Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } }]
    })
    logs = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = [for arn in var.log_group_arns : "${arn}:*"], Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } }]
    })
    secretsmanager = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"], Resource = tolist(var.secret_arns), Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } }]
    })
    monitoring = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = "cloudwatch:PutMetricData", Resource = "*", Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id, "cloudwatch:namespace" = var.metric_namespace } } }]
    })
    xray = jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Effect = "Allow", Principal = "*", Action = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"], Resource = "*", Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } } }]
    })
    },
    length(var.lambda_function_arns) > 0 ? {
      lambda = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect    = "Allow"
          Principal = "*"
          Action    = "lambda:InvokeFunction"
          Resource  = tolist(var.lambda_function_arns)
          Condition = { StringEquals = { "aws:PrincipalAccount" = var.account_id } }
        }]
      })
    } : {}
  )
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.route_table_ids
  policy            = local.s3_policy
  tags              = merge(var.tags, { Name = "${var.name_prefix}-s3-endpoint" })
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-endpoints-"
  description = "TLS only from the ClinicOS workload security group"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-endpoints" })
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id            = aws_security_group.this.id
  description                  = "TLS from ClinicOS workloads"
  referenced_security_group_id = var.source_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_policies

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = [aws_security_group.this.id]
  policy              = each.value
  tags                = merge(var.tags, { Name = "${var.name_prefix}-${replace(each.key, ".", "-")}-endpoint" })
}
