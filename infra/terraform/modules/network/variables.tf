variable "name_prefix" {
  type        = string
  description = "Environment-qualified resource prefix."
}

variable "region" {
  type        = string
  description = "AWS region for VPC endpoint service names."
}

variable "vpc_cidr" {
  type        = string
  description = "VPC IPv4 CIDR."

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR."
  }
}

variable "availability_zones" {
  type        = list(string)
  description = "Explicit AZ names; no account lookup is used during offline plans."

  validation {
    condition     = length(var.availability_zones) >= 2 && length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "At least two distinct availability zones are required."
  }
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Public subnet CIDRs, one per availability zone."
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Private application subnet CIDRs, one per availability zone."
}

variable "data_subnet_cidrs" {
  type        = list(string)
  description = "Isolated data subnet CIDRs, one per availability zone."
}

variable "nat_gateway_count" {
  type        = number
  description = "Number of NAT gateways. Zero is valid only for an inactive DR network."
  default     = 1

  validation {
    condition     = var.nat_gateway_count >= 0 && var.nat_gateway_count <= length(var.availability_zones)
    error_message = "nat_gateway_count must be between zero and the AZ count."
  }
}

variable "interface_endpoint_services" {
  type        = set(string)
  description = "Interface endpoint service suffixes."
  default     = ["ecr.api", "ecr.dkr", "kms", "logs", "secretsmanager", "ssm", "ssmmessages"]
}

variable "create_interface_endpoints" {
  type        = bool
  description = "Whether to create billable interface endpoints. Disable for dormant DR."
  default     = true
}

variable "logs_kms_key_arn" {
  type        = string
  description = "KMS key for VPC flow logs."
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch flow-log retention."
}

variable "tags" {
  type        = map(string)
  description = "Additional tags."
  default     = {}
}
