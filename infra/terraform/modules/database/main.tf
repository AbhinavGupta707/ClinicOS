terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name_prefix}-postgres-"
  description = "PostgreSQL only from ClinicOS ECS tasks"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-postgres" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from application tasks"
  referenced_security_group_id = var.application_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_subnet_group" "this" {
  name_prefix = "${var.name_prefix}-"
  subnet_ids  = var.data_subnet_ids
  description = "ClinicOS isolated data subnets"
  tags        = merge(var.tags, { Name = "${var.name_prefix}-postgres" })
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name_prefix}-postgres-"
  family      = var.parameter_group_family
  description = "ClinicOS PostgreSQL security and diagnostic baseline"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  parameter {
    name  = "log_lock_waits"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${var.name_prefix}-postgres/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  skip_destroy      = true
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "upgrade" {
  name              = "/aws/rds/instance/${var.name_prefix}-postgres/upgrade"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  skip_destroy      = true
  tags              = var.tags
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine                        = "postgres"
  engine_version                = var.engine_version
  instance_class                = var.instance_class
  db_name                       = "clinicos"
  username                      = "clinicos_migrator"
  port                          = 5432
  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.secrets_kms_key_arn

  allocated_storage     = var.allocated_storage_gib
  max_allocated_storage = var.max_allocated_storage_gib
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.data_kms_key_arn

  multi_az                            = var.multi_az
  publicly_accessible                 = false
  iam_database_authentication_enabled = true
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.database.id]
  parameter_group_name                = aws_db_parameter_group.this.name

  backup_retention_period   = var.backup_retention_days
  backup_window             = "18:00-19:00"
  maintenance_window        = "sun:19:30-sun:20:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-final-snapshot"

  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.data_kms_key_arn
  performance_insights_retention_period = var.performance_insights_retention_days
  monitoring_interval                   = 0

  auto_minor_version_upgrade = false
  apply_immediately          = false

  tags = merge(var.tags, {
    Name   = "${var.name_prefix}-postgres"
    Backup = "required"
  })

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [aws_cloudwatch_log_group.postgresql, aws_cloudwatch_log_group.upgrade]
}
