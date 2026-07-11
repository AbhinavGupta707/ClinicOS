variable "name_prefix" { type = string }
variable "source_bucket_arns" { type = map(string) }
variable "source_bucket_ids" { type = map(string) }
variable "destination_bucket_arns" { type = map(string) }
variable "destination_kms_key_arn" { type = string }
variable "source_kms_key_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
