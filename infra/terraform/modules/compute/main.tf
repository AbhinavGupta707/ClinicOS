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
        name      = each.key
        image     = each.value.image_uri
        user      = each.value.user
        essential = true
        dependsOn = var.adot_image_uri == null ? [] : [{
          containerName = "aws-otel-collector"
          condition     = "HEALTHY"
        }]
        privileged             = false
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
          CLINIC_OS_RELEASE_VERSION   = split("@sha256:", each.value.image_uri)[1]
          OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
          OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
          OTEL_SERVICE_NAME           = each.key
        }) : { name = name, value = value }]
        secrets = [for name, value_from in each.value.secrets : { name = name, valueFrom = value_from }]
        mountPoints = [{
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }]
        linuxParameters = {
          initProcessEnabled = true
          capabilities = {
            add  = []
            drop = ["ALL"]
          }
        }
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
        user                   = var.adot_user
        essential              = true
        privileged             = false
        readonlyRootFilesystem = true
        command                = ["--config=env:AOT_CONFIG_CONTENT"]
        environment = [
          { name = "AWS_REGION", value = var.region },
          {
            name = "AOT_CONFIG_CONTENT"
            value = yamlencode({
              extensions = {
                health_check = { endpoint = "127.0.0.1:13133" }
              }
              receivers = {
                otlp = {
                  protocols = {
                    grpc = { endpoint = "127.0.0.1:4317" }
                    http = { endpoint = "127.0.0.1:4318" }
                  }
                }
              }
              processors = {
                memory_limiter = {
                  check_interval         = "1s"
                  limit_percentage       = 75
                  spike_limit_percentage = 20
                }
                "batch/traces" = {
                  timeout         = "1s"
                  send_batch_size = 256
                }
                "batch/metrics" = {
                  timeout         = "30s"
                  send_batch_size = 512
                }
              }
              exporters = {
                awsxray = {}
                "awsemf/application" = {
                  namespace                        = var.metric_namespace
                  log_group_name                   = aws_cloudwatch_log_group.service[each.key].name
                  dimension_rollup_option          = "NoDimensionRollup"
                  resource_to_telemetry_conversion = { enabled = true }
                  metric_declarations = [
                    {
                      dimensions = [["service.name"]]
                      metric_name_selectors = [
                        "^clinic_os\\.outbox\\.(depth|oldest_age_seconds|dead_lettered)$",
                        "^clinic_os\\.(backpressure\\.state|readiness)$"
                      ]
                    },
                    {
                      dimensions            = [["service.name", "routeFamily", "status"]]
                      metric_name_selectors = ["^clinic_os\\.http\\.(requests|duration_ms)$"]
                    },
                    {
                      dimensions            = [["service.name", "component", "status"]]
                      metric_name_selectors = ["^clinic_os\\.readiness$"]
                    }
                  ]
                }
              }
              service = {
                extensions = ["health_check"]
                telemetry  = { logs = { level = "warn" } }
                pipelines = {
                  traces = {
                    receivers  = ["otlp"]
                    processors = ["memory_limiter", "batch/traces"]
                    exporters  = ["awsxray"]
                  }
                  "metrics/application" = {
                    receivers  = ["otlp"]
                    processors = ["memory_limiter", "batch/metrics"]
                    exporters  = ["awsemf/application"]
                  }
                }
              }
            })
          },
        ]
        healthCheck = {
          command     = ["CMD", "/healthcheck"]
          interval    = 10
          timeout     = 5
          retries     = 3
          startPeriod = 15
        }
        stopTimeout = 120
        mountPoints = [{
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }]
        linuxParameters = {
          initProcessEnabled = true
          capabilities = {
            add  = []
            drop = ["ALL"]
          }
        }
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
  health_check_grace_period_seconds = length(concat(
    try(each.value.target_group_arn, null) == null ? [] : [each.value.target_group_arn],
    each.value.additional_target_group_arns,
  )) == 0 ? 0 : each.value.health_check_grace_seconds
  enable_execute_command = false
  wait_for_steady_state  = false
  propagate_tags         = "SERVICE"

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
    for_each = toset(concat(
      try(each.value.target_group_arn, null) == null ? [] : [each.value.target_group_arn],
      each.value.additional_target_group_arns,
    ))
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
