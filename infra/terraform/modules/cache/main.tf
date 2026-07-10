terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "auth" {
  name_prefix             = "${var.name_prefix}/cache-auth-"
  description             = "Rotatable Redis-compatible cache credentials"
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_days
  tags                    = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

# The generated password is sensitive and therefore resides in encrypted remote state as well as
# Secrets Manager. Rotation requires a reviewed two-token application rollout before replacement.
resource "aws_secretsmanager_secret_version" "auth" {
  secret_id = aws_secretsmanager_secret.auth.id
  secret_string = jsonencode({
    username = "default"
    password = random_password.auth.result
    host     = aws_elasticache_replication_group.this.primary_endpoint_address
    port     = 6379
    url      = "rediss://default:${urlencode(random_password.auth.result)}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  })
}

resource "aws_security_group" "cache" {
  name_prefix = "${var.name_prefix}-cache-"
  description = "Redis protocol only from ClinicOS ECS tasks"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-cache" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "cache" {
  security_group_id            = aws_security_group.cache.id
  description                  = "TLS Redis protocol from application tasks"
  referenced_security_group_id = var.application_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-cache"
  subnet_ids = var.data_subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = substr("${var.name_prefix}-cache", 0, 40)
  description          = "ClinicOS abuse budgets and non-authoritative short jobs"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.node_count
  port                 = 6379
  parameter_group_name = "default.redis7"

  automatic_failover_enabled = var.node_count > 1
  multi_az_enabled           = var.node_count > 1
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = var.data_kms_key_arn
  auth_token                 = random_password.auth.result
  auth_token_update_strategy = "ROTATE"

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.cache.id]

  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window            = "17:00-18:00"
  maintenance_window         = "sun:20:30-sun:21:30"
  auto_minor_version_upgrade = false
  apply_immediately          = false

  tags = merge(var.tags, {
    Name   = "${var.name_prefix}-cache"
    Backup = "required"
  })

  lifecycle {
    prevent_destroy = true
  }
}
