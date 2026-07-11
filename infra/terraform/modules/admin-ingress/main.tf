terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-admin-alb-"
  description = "Internal Keycloak admin ALB"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-admin-alb", Exposure = "private-operator" })
  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = var.allowed_operator_cidrs

  security_group_id = aws_security_group.this.id
  description       = "Private/VPN/JIT operator TLS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "keycloak" {
  security_group_id = aws_security_group.this.id
  description       = "Keycloak admin traffic within the environment VPC"
  ip_protocol       = "tcp"
  from_port         = 8080
  to_port           = 8080
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_lb" "this" {
  name                       = substr("${var.name_prefix}-admin", 0, 32)
  internal                   = true
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.this.id]
  subnets                    = var.private_subnet_ids
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  enable_http2               = true
  idle_timeout               = 60

  access_logs {
    bucket  = var.access_log_bucket_id
    prefix  = "alb-admin/${var.name_prefix}"
    enabled = true
  }

  tags = merge(var.tags, { Exposure = "private-operator" })
}

resource "aws_lb_target_group" "keycloak" {
  name        = substr("${var.name_prefix}-kc-admin", 0, 32)
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    path                = "/realms/master"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.keycloak.arn
  }
}

resource "aws_route53_record" "admin" {
  zone_id = var.private_zone_id
  name    = var.hostname
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
