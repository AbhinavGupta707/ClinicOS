variable "aws_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit account ID."
  }
}
variable "region" {
  type    = string
  default = "ap-south-1"
}
variable "offline_validation_mode" {
  type    = bool
  default = true
}
variable "backend_bucket_name" { type = string }
variable "backend_lock_table_name" {
  type    = string
  default = "clinicos-terraform-locks"
}
variable "authorize_backend_creation" {
  type        = bool
  default     = false
  description = "Explicitly opts in to creating the singleton backend."
}
variable "backend_creation_authorized_by" {
  type        = string
  default     = null
  nullable    = true
  description = "Named accountable approver; required with authorize_backend_creation."
}
