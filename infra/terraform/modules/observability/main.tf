terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_sns_topic" "alarms" {
  name              = "${var.name_prefix}-alarms"
  kms_master_key_id = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_sns_topic_policy" "alarms" {
  arn = aws_sns_topic.alarms.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TopicOwner"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "SNS:*"
        Resource  = aws_sns_topic.alarms.arn
      },
      {
        Sid       = "CloudWatchAndBackupPublish"
        Effect    = "Allow"
        Principal = { Service = ["cloudwatch.amazonaws.com", "events.amazonaws.com", "backup.amazonaws.com"] }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alarms.arn
      },
    ]
  })
}

locals {
  alarm_actions = concat([aws_sns_topic.alarms.arn], var.additional_alarm_action_arns)
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  for_each = var.ecs_service_names

  alarm_name          = "${var.name_prefix}-${each.key}-cpu-high"
  alarm_description   = "ClinicOS ECS service CPU exceeds 80 percent"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  for_each = var.ecs_service_names

  alarm_name          = "${var.name_prefix}-${each.key}-memory-high"
  alarm_description   = "ClinicOS ECS service memory exceeds 85 percent"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.name_prefix}-database-cpu-high"
  alarm_description   = "PostgreSQL CPU exceeds 80 percent"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${var.name_prefix}-database-storage-low"
  alarm_description   = "PostgreSQL free storage is below 10 GiB"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 10737418240
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "cache_cpu" {
  alarm_name          = "${var.name_prefix}-cache-cpu-high"
  alarm_description   = "Cache engine CPU exceeds 75 percent"
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 75
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { ReplicationGroupId = var.cache_replication_group_id }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "cache_evictions" {
  alarm_name          = "${var.name_prefix}-cache-evictions"
  alarm_description   = "Cache evictions indicate memory pressure or unsafe budget loss"
  namespace           = "AWS/ElastiCache"
  metric_name         = "Evictions"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { ReplicationGroupId = var.cache_replication_group_id }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count = var.edge_enabled ? 1 : 0

  alarm_name          = "${var.name_prefix}-alb-5xx"
  alarm_description   = "Public edge generated five or more load-balancer 5xx responses"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "waf_blocks" {
  count = var.edge_enabled ? 1 : 0

  alarm_name          = "${var.name_prefix}-waf-block-spike"
  alarm_description   = "WAF blocked request volume exceeded the initial abuse threshold"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 1
  threshold           = 100
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions = {
    WebACL = var.waf_name
    Region = var.region
    Rule   = "ALL"
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  for_each = toset(["clinic_day", "health", "identity", "media", "operations", "provider_callback"])

  alarm_name          = "${var.name_prefix}-api-${replace(each.key, "_", "-")}-5xx"
  alarm_description   = "ClinicOS API route family emitted a server-error response"
  namespace           = var.metric_namespace
  metric_name         = "clinic_os.http.requests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions = {
    "service.name" = "clinic-os-api"
    routeFamily    = each.key
    status         = "5xx"
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "identity_4xx" {
  alarm_name          = "${var.name_prefix}-identity-4xx-spike"
  alarm_description   = "ClinicOS identity boundary emitted repeated client or authorization failures"
  namespace           = var.metric_namespace
  metric_name         = "clinic_os.http.requests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 10
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions = {
    "service.name" = "clinic-os-api"
    routeFamily    = "identity"
    status         = "4xx"
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "worker_backpressure" {
  alarm_name          = "${var.name_prefix}-worker-backpressure-not-ready"
  alarm_description   = "ClinicOS worker backpressure reached the not-ready state"
  namespace           = var.metric_namespace
  metric_name         = "clinic_os.backpressure.state"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { "service.name" = "clinic-os-worker" }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "outbox_oldest_age" {
  alarm_name          = "${var.name_prefix}-outbox-oldest-age"
  alarm_description   = "ClinicOS outbox oldest pending event exceeded five minutes"
  namespace           = var.metric_namespace
  metric_name         = "clinic_os.outbox.oldest_age_seconds"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { "service.name" = "clinic-os-worker" }
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "outbox_dead_lettered" {
  alarm_name          = "${var.name_prefix}-outbox-dead-lettered"
  alarm_description   = "ClinicOS has one or more unresolved durable outbox dead letters"
  namespace           = var.metric_namespace
  metric_name         = "clinic_os.outbox.dead_lettered"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  dimensions          = { "service.name" = "clinic-os-worker" }
  tags                = var.tags
}

resource "aws_cloudwatch_event_rule" "backup_failure" {
  name        = "${var.name_prefix}-backup-failure"
  description = "AWS Backup jobs that did not complete"
  event_pattern = jsonencode({
    source      = ["aws.backup"]
    detail-type = ["Backup Job State Change", "Copy Job State Change", "Restore Job State Change"]
    detail      = { state = ["ABORTED", "EXPIRED", "FAILED"] }
  })
  tags = var.tags
}

resource "aws_cloudwatch_event_target" "backup_failure" {
  rule = aws_cloudwatch_event_rule.backup_failure.name
  arn  = aws_sns_topic.alarms.arn
}

resource "aws_xray_sampling_rule" "this" {
  rule_name      = "${var.name_prefix}-baseline"
  priority       = 1000
  version        = 1
  reservoir_size = 1
  fixed_rate     = 0.05
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  resource_arn   = "*"
  attributes     = {}
  tags           = var.tags
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name_prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "Database and cache CPU"
          view   = "timeSeries"
          region = split(":", aws_sns_topic.alarms.arn)[3]
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_identifier],
            ["AWS/ElastiCache", "EngineCPUUtilization", "ReplicationGroupId", var.cache_replication_group_id],
          ]
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "ECS CPU and memory"
          view   = "timeSeries"
          region = split(":", aws_sns_topic.alarms.arn)[3]
          metrics = flatten([
            for service in values(var.ecs_service_names) : [
              ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", service],
              ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", service],
            ]
          ])
        }
      },
      {
        type   = "metric"
        width  = 24
        height = 6
        properties = {
          title  = "ClinicOS application readiness, outbox and backpressure"
          view   = "timeSeries"
          region = var.region
          metrics = [
            [var.metric_namespace, "clinic_os.outbox.oldest_age_seconds", "service.name", "clinic-os-worker"],
            [var.metric_namespace, "clinic_os.outbox.dead_lettered", "service.name", "clinic-os-worker"],
            [var.metric_namespace, "clinic_os.backpressure.state", "service.name", "clinic-os-worker"],
          ]
        }
      },
    ]
  })
}
