variable "name_prefix" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "route_table_ids" { type = list(string) }
variable "source_security_group_id" {
  type        = string
  description = "Only this workload security group may open TLS sessions to interface endpoints."
}
variable "s3_bucket_arns" { type = set(string) }
variable "ecr_repository_arns" { type = set(string) }
variable "secret_arns" { type = set(string) }
variable "kms_key_arns" { type = set(string) }
variable "log_group_arns" { type = set(string) }
variable "metric_namespace" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
