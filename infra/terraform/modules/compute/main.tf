terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  active_services = {
    for name, service in var.services : name => service if service.create_service
  }
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }

  configuration {
    execute_command_configuration {
      logging = "NONE"
    }
  }

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = var.service_discovery_namespace
  description = "ClinicOS private service discovery"
  vpc         = var.vpc_id
  tags        = var.tags
}

resource "aws_service_discovery_service" "this" {
  for_each = local.active_services

  name = each.key

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {}

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = var.services

  name              = "/aws/ecs/${var.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_iam_role" "execution" {
  for_each = var.services

  name_prefix = substr("${var.name_prefix}-${each.key}-exec-", 0, 38)
  path        = "/clinicos/${var.name_prefix}/"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "execution" {
  for_each = var.services

  name = "pull-image-write-logs-read-declared-secrets"
  role = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect   = "Allow"
          Action   = ["ecr:GetAuthorizationToken"]
          Resource = "*"
        },
        {
          Effect = "Allow"
          Action = [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:GetDownloadUrlForLayer",
          ]
          Resource = values(var.ecr_repository_arns)
        },
        {
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.service[each.key].arn}:*"
        },
      ],
      length(each.value.execution_secret_arns) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = tolist(each.value.execution_secret_arns)
      }],
      length(each.value.execution_secret_arns) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arns
        Condition = {
          StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" }
        }
      }],
    )
  })
}

resource "aws_iam_role" "task" {
  for_each = var.services

  name_prefix = substr("${var.name_prefix}-${each.key}-task-", 0, 38)
  path        = "/clinicos/${var.name_prefix}/"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "task" {
  for_each = var.services

  name   = "service-runtime"
  role   = aws_iam_role.task[each.key].id
  policy = each.value.task_policy_json
}

resource "aws_ecs_task_definition" "this" {
  for_each = var.services

  family                   = "${var.name_prefix}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(each.value.cpu)
  memory                   = tostring(each.value.memory)
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode(concat(
    [
      {
        name                   = each.key
        image                  = each.value.image_uri
        essential              = true
        readonlyRootFilesystem = true
        command                = length(each.value.command) == 0 ? null : each.value.command
        portMappings = each.value.container_port > 0 ? [{
          name          = each.key
          containerPort = each.value.container_port
          hostPort      = each.value.container_port
          protocol      = "tcp"
          appProtocol   = each.value.app_protocol
        }] : []
        environment = [for name, value in merge(each.value.environment, {
          AWS_REGION                  = var.region
          OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4317"
          OTEL_EXPORTER_OTLP_PROTOCOL = "grpc"
          OTEL_SERVICE_NAME           = each.key
        }) : { name = name, value = value }]
        secrets = [for name, value_from in each.value.secrets : { name = name, valueFrom = value_from }]
        mountPoints = [{
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }]
        linuxParameters = { initProcessEnabled = true }
        healthCheck = length(each.value.health_check_command) == 0 ? null : {
          command     = each.value.health_check_command
          interval    = 30
          timeout     = 5
          retries     = 3
          startPeriod = 60
        }
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
            awslogs-region        = var.region
            awslogs-stream-prefix = each.key
          }
        }
      },
    ],
    var.adot_image_uri == null ? [] : [
      {
        name                   = "aws-otel-collector"
        image                  = var.adot_image_uri
        essential              = false
        readonlyRootFilesystem = true
        command                = ["--config=/etc/ecs/ecs-default-config.yaml"]
        environment            = [{ name = "AWS_REGION", value = var.region }]
        mountPoints = [{
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
            awslogs-region        = var.region
            awslogs-stream-prefix = "otel"
          }
        }
      },
    ],
  ))

  tags = var.tags
}

resource "aws_ecs_service" "this" {
  for_each = local.active_services

  name            = each.key
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this[each.key].arn
  desired_count   = each.value.desired_count

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = try(each.value.target_group_arn, null) == null ? 0 : each.value.health_check_grace_seconds
  enable_execute_command             = false
  wait_for_steady_state              = false
  propagate_tags                     = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = each.value.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = false
    subnets          = var.private_subnet_ids
    security_groups  = [var.security_group_id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.this[each.key].arn
  }

  dynamic "load_balancer" {
    for_each = try(each.value.target_group_arn, null) == null ? [] : [each.value.target_group_arn]
    content {
      target_group_arn = load_balancer.value
      container_name   = each.key
      container_port   = each.value.container_port
    }
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_ecs_cluster_capacity_providers.this]

  tags = var.tags
}

resource "aws_appautoscaling_target" "this" {
  for_each = local.active_services

  max_capacity       = each.value.maximum_count
  min_capacity       = each.value.minimum_count
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each = local.active_services

  name               = "${var.name_prefix}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.this[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "memory" {
  for_each = local.active_services

  name               = "${var.name_prefix}-${each.key}-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.this[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}
