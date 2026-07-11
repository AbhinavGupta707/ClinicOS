terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-services-"
  description = "ClinicOS private ECS workloads"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${var.name_prefix}-services" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "service_mesh" {
  for_each = { for port in var.service_ports : tostring(port) => port }

  security_group_id            = aws_security_group.this.id
  description                  = "Private service-to-service port ${each.value}"
  referenced_security_group_id = aws_security_group.this.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = var.alb_enabled ? { for port in var.alb_target_ports : tostring(port) => port } : {}

  security_group_id            = aws_security_group.this.id
  description                  = "ALB to service port ${each.value}"
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_ingress_rule" "admin_alb" {
  count = var.admin_alb_enabled ? 1 : 0

  security_group_id            = aws_security_group.this.id
  description                  = "Internal admin ALB to Keycloak"
  referenced_security_group_id = var.admin_alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.this.id
  description       = "TLS to AWS endpoints and approved providers through controlled egress"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  # Official provider APIs use changing public address ranges. Egress is limited to TLS, private
  # tasks have no public IP, and traffic crosses the environment NAT where flow logs and alarms
  # apply. Application/provider adapters still enforce exact HTTPS host allowlists.
  #trivy:ignore:AWS-0104
  cidr_ipv4 = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "private_tcp" {
  security_group_id = aws_security_group.this.id
  description       = "Private VPC database, cache, workflow, and service traffic"
  ip_protocol       = "tcp"
  from_port         = 1
  to_port           = 65535
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "dns_udp" {
  security_group_id = aws_security_group.this.id
  description       = "VPC DNS over UDP"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "dns_tcp" {
  security_group_id = aws_security_group.this.id
  description       = "VPC DNS over TCP"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}
