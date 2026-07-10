terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

check "tls_inputs" {
  assert {
    condition = !var.enabled || (
      (var.certificate_arn != null && !var.create_certificate) ||
      (var.certificate_arn == null && var.create_certificate && length(var.domain_names) > 0 && var.hosted_zone_id != null)
    )
    error_message = "Public ingress requires exactly one TLS path: an existing certificate ARN, or create_certificate with domain_names and hosted_zone_id."
  }
}

check "dns_inputs" {
  assert {
    condition     = !var.manage_dns || (var.enabled && var.hosted_zone_id != null && length(var.domain_names) > 0)
    error_message = "manage_dns requires enabled ingress, a hosted_zone_id, and explicit domain_names."
  }
}

resource "aws_security_group" "alb" {
  count = var.enabled ? 1 : 0

  name_prefix = "${var.name_prefix}-alb-"
  description = "TLS-only public edge for ClinicOS"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-alb" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = var.enabled ? toset(var.allowed_ipv4_cidrs) : []

  security_group_id = aws_security_group.alb[0].id
  description       = "HTTPS ingress"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "http_redirect" {
  for_each = var.enabled ? toset(var.allowed_ipv4_cidrs) : []

  security_group_id = aws_security_group.alb[0].id
  description       = "HTTP redirect to HTTPS"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "targets" {
  count = var.enabled ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  description       = "Only private VPC targets"
  ip_protocol       = "tcp"
  from_port         = 1
  to_port           = 65535
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_lb" "this" {
  count = var.enabled ? 1 : 0

  name = substr("${var.name_prefix}-edge", 0, 32)
  # This is the only intended public resource: TLS-only, WAF-associated, deletion-protected,
  # access-logged, and connected exclusively to private IP target groups.
  #trivy:ignore:AWS-0053
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = var.public_subnet_ids
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "strictest"
  idle_timeout               = 60

  access_logs {
    bucket  = var.access_log_bucket_id
    prefix  = "alb"
    enabled = true
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-edge" })
}

resource "aws_lb_target_group" "this" {
  for_each = var.enabled ? var.target_groups : {}

  name_prefix          = substr(replace(each.key, "_", "-"), 0, 6)
  port                 = each.value.port
  protocol             = "HTTP"
  protocol_version     = "HTTP1"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    path                = each.value.health_path
    protocol            = "HTTP"
    matcher             = "200-399"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "this" {
  count = var.enabled && var.create_certificate ? 1 : 0

  domain_name               = var.domain_names[0]
  subject_alternative_names = slice(var.domain_names, 1, length(var.domain_names))
  validation_method         = "DNS"
  key_algorithm             = "EC_prime256v1"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = var.enabled && var.create_certificate ? {
    for option in aws_acm_certificate.this[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count = var.enabled && var.create_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

locals {
  selected_certificate_arn = var.enabled ? (
    var.create_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : var.certificate_arn
  ) : null
}

resource "aws_lb_listener" "http" {
  count = var.enabled ? 1 : 0

  load_balancer_arn = aws_lb.this[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.enabled ? 1 : 0

  load_balancer_arn = aws_lb.this[0].arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = local.selected_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"route_not_found\"}"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "this" {
  for_each = aws_lb_target_group.this

  listener_arn = aws_lb_listener.https[0].arn
  priority     = var.target_groups[each.key].priority

  action {
    type             = "forward"
    target_group_arn = each.value.arn
  }

  dynamic "condition" {
    for_each = length(var.target_groups[each.key].host_headers) > 0 ? [1] : []
    content {
      host_header { values = var.target_groups[each.key].host_headers }
    }
  }

  dynamic "condition" {
    for_each = length(var.target_groups[each.key].path_patterns) > 0 ? [1] : []
    content {
      path_pattern { values = var.target_groups[each.key].path_patterns }
    }
  }
}

resource "aws_wafv2_web_acl" "this" {
  count = var.enabled ? 1 : 0

  name  = "${var.name_prefix}-edge"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-known-bad"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-sqli"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-sqli"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 40
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "ip-rate-limit"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = var.waf_rate_limit_per_five_minutes
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-edge"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "this" {
  count = var.enabled ? 1 : 0

  resource_arn = aws_lb.this[0].arn
  web_acl_arn  = aws_wafv2_web_acl.this[0].arn
}

resource "aws_cloudwatch_log_group" "waf" {
  count = var.enabled ? 1 : 0

  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count = var.enabled ? 1 : 0

  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]
  resource_arn            = aws_wafv2_web_acl.this[0].arn

  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    single_header { name = "x-csrf-token" }
  }
}

resource "aws_route53_record" "application" {
  for_each = var.enabled && var.manage_dns ? toset(var.domain_names) : []

  zone_id = var.hosted_zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_lb.this[0].dns_name
    zone_id                = aws_lb.this[0].zone_id
    evaluate_target_health = true
  }
}
