variable "name_prefix" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "logs_kms_key_arn" { type = string }
variable "log_retention_days" { type = number }
variable "ecr_repository_arns" { type = map(string) }
variable "kms_key_arns" { type = list(string) }
variable "adot_image_uri" {
  type     = string
  default  = null
  nullable = true
}
variable "service_discovery_namespace" {
  type    = string
  default = "clinicos.internal"
}
variable "services" {
  type = map(object({
    image_uri                  = string
    cpu                        = number
    memory                     = number
    container_port             = number
    app_protocol               = string
    desired_count              = number
    minimum_count              = number
    maximum_count              = number
    command                    = list(string)
    environment                = map(string)
    secrets                    = map(string)
    execution_secret_arns      = set(string)
    task_policy_json           = string
    target_group_arn           = optional(string)
    health_check_command       = list(string)
    health_check_grace_seconds = number
    create_service             = bool
    use_fargate_spot           = bool
  }))
  default = {}

  validation {
    condition = alltrue([
      for service in values(var.services) : can(regex("@sha256:[a-f0-9]{64}$", service.image_uri))
    ])
    error_message = "Every runtime image must be immutable and end with @sha256:<64 lowercase hex characters>."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
