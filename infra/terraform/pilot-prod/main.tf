check "audit_compliance_authorization" {
  assert {
    condition = !var.enable_audit_compliance_lock || (
      var.audit_compliance_authorized_by != null && length(trimspace(var.audit_compliance_authorized_by)) >= 3
    )
    error_message = "Pilot COMPLIANCE Object Lock requires the explicit opt-in and a named authority."
  }
}

check "runtime_admin_ingress" {
  assert {
    condition = !contains(["runtime", "edge"], var.activation_phase) || (
      var.auth_hostname != null &&
      var.keycloak_admin_hostname != null &&
      var.keycloak_admin_private_zone_id != null &&
      var.keycloak_admin_certificate_arn != null &&
      length(var.keycloak_admin_allowed_operator_cidrs) > 0 &&
      var.auth_hostname != var.keycloak_admin_hostname &&
      can(regex("^[A-Z0-9]+$", var.keycloak_admin_private_zone_id))
    )
    error_message = "Runtime requires a distinct TLS Keycloak admin hostname, private zone, certificate, and private/VPN/JIT operator CIDRs."
  }
}

module "platform" {
  source = "../modules/platform"
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }

  environment                    = "pilot-prod"
  account_id                     = var.aws_account_id
  primary_region                 = var.primary_region
  dr_region                      = var.dr_region
  cost_center                    = var.cost_center
  owner                          = var.owner
  activation_phase               = var.activation_phase
  audit_compliance_authorized_by = var.audit_compliance_authorized_by
  malware_scanner = {
    enabled                  = var.enable_malware_scanner
    activation_authorized_by = var.malware_scanner_authorized_by
    spend_acknowledgement    = var.malware_scanner_spend_acknowledgement
  }

  primary_network = {
    vpc_cidr             = "10.30.0.0/16"
    availability_zones   = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
    public_subnet_cidrs  = ["10.30.0.0/24", "10.30.1.0/24", "10.30.2.0/24"]
    private_subnet_cidrs = ["10.30.16.0/20", "10.30.32.0/20", "10.30.48.0/20"]
    data_subnet_cidrs    = ["10.30.64.0/20", "10.30.80.0/20", "10.30.96.0/20"]
    nat_gateway_count    = 3
  }
  dr_network = {
    vpc_cidr             = "10.130.0.0/16"
    availability_zones   = ["ap-south-2a", "ap-south-2b", "ap-south-2c"]
    public_subnet_cidrs  = ["10.130.0.0/24", "10.130.1.0/24", "10.130.2.0/24"]
    private_subnet_cidrs = ["10.130.16.0/20", "10.130.32.0/20", "10.130.48.0/20"]
    data_subnet_cidrs    = ["10.130.64.0/20", "10.130.80.0/20", "10.130.96.0/20"]
    nat_gateway_count    = 0
    interface_endpoints  = false
  }

  database = {
    engine_version                      = var.postgres_engine_version
    parameter_group_family              = "postgres16"
    instance_class                      = "db.t4g.medium"
    allocated_storage_gib               = 100
    max_allocated_storage_gib           = 1000
    multi_az                            = true
    backup_retention_days               = 35
    performance_insights_retention_days = 731
  }
  cache = {
    engine_version          = var.cache_engine_version
    node_type               = "cache.t4g.small"
    node_count              = 2
    snapshot_retention_days = 14
  }
  retention = {
    log_days        = 365
    media_lock_days = 90
    audit_lock_days = 2555
    audit_lock_mode = (
      var.enable_audit_compliance_lock && var.audit_compliance_authorized_by != null
      ? "COMPLIANCE"
      : "GOVERNANCE"
    )
    access_log_days      = 365
    secret_recovery_days = 30
  }
  ingress = {
    enabled            = var.activation_phase == "edge"
    allowed_ipv4_cidrs = var.allowed_ingress_cidrs
    certificate_arn    = var.certificate_arn
    create_certificate = var.create_certificate
    hosted_zone_id     = var.hosted_zone_id
    manage_dns         = var.manage_dns
    web_hostname       = var.web_hostname
    api_hostname       = var.api_hostname
    auth_hostname      = var.auth_hostname
    waf_rate_limit     = 2000
  }
  admin_ingress = {
    enabled                = contains(["runtime", "edge"], var.activation_phase)
    hostname               = var.keycloak_admin_hostname
    private_zone_id        = var.keycloak_admin_private_zone_id
    certificate_arn        = var.keycloak_admin_certificate_arn
    allowed_operator_cidrs = var.keycloak_admin_allowed_operator_cidrs
  }
  runtime = {
    enabled       = contains(["runtime", "edge"], var.activation_phase)
    temporal_mode = "self-hosted-ecs"
    images        = var.image_uris
    image_users   = var.image_users
    capacity = {
      api                        = { cpu = 1024, memory = 2048, desired_count = 2, minimum_count = 2, maximum_count = 6, use_fargate_spot = false }
      web                        = { cpu = 512, memory = 1024, desired_count = 2, minimum_count = 2, maximum_count = 6, use_fargate_spot = false }
      worker                     = { cpu = 1024, memory = 2048, desired_count = 2, minimum_count = 2, maximum_count = 6, use_fargate_spot = false }
      keycloak                   = { cpu = 1024, memory = 2048, desired_count = 3, minimum_count = 3, maximum_count = 6, use_fargate_spot = false }
      temporal-frontend          = { cpu = 1024, memory = 2048, desired_count = 2, minimum_count = 2, maximum_count = 4, use_fargate_spot = false }
      temporal-internal-frontend = { cpu = 1024, memory = 2048, desired_count = 2, minimum_count = 2, maximum_count = 4, use_fargate_spot = false }
      temporal-history           = { cpu = 2048, memory = 4096, desired_count = 2, minimum_count = 2, maximum_count = 6, use_fargate_spot = false }
      temporal-matching          = { cpu = 1024, memory = 2048, desired_count = 2, minimum_count = 2, maximum_count = 4, use_fargate_spot = false }
      temporal-worker            = { cpu = 1024, memory = 2048, desired_count = 1, minimum_count = 1, maximum_count = 3, use_fargate_spot = false }
    }
  }
  backup = {
    daily_retention_days       = 35
    monthly_retention_days     = 2555
    primary_vault_lock_enabled = var.enable_backup_vault_lock
    dr_vault_lock_enabled      = var.enable_backup_vault_lock
    vault_lock_changeable_days = 7
  }
  github = {
    repository               = var.github_repository
    subject_claims           = var.github_subject_claims
    create_oidc_provider     = var.create_github_oidc_provider
    oidc_provider_arn        = var.github_oidc_provider_arn
    oidc_thumbprints         = var.github_oidc_thumbprints
    permissions_boundary_arn = var.permissions_boundary_arn
  }
  state_backend = {
    bucket_name = var.terraform_state_bucket
    lock_table  = var.terraform_lock_table
    state_key   = "clinicos/pilot-prod/terraform.tfstate"
    kms_key_arn = var.terraform_state_kms_key_arn
  }
  additional_alarm_action_arns = var.additional_alarm_action_arns
}
