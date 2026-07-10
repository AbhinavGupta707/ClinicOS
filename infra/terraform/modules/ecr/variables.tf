variable "name_prefix" { type = string }
variable "repository_names" { type = set(string) }
variable "kms_key_arn" { type = string }
variable "retained_image_count" {
  type    = number
  default = 40
}
variable "tags" {
  type    = map(string)
  default = {}
}
