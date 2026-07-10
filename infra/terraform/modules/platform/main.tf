terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.dr]
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

locals {
  name_prefix = "clinicos-${var.environment}"
  tags = merge(var.additional_tags, {
    Project       = "ClinicOS"
    Environment   = var.environment
    ManagedBy     = "Terraform"
    CostCenter    = var.cost_center
    Owner         = var.owner
    DataResidency = "India"
  })
  ingress_domains = compact([
    try(var.ingress.web_hostname, null),
    try(var.ingress.api_hostname, null),
    try(var.ingress.auth_hostname, null),
  ])
  required_images = toset(["adot", "api", "keycloak", "temporal", "web", "worker"])
  phase_index     = index(["foundation", "data-plane", "runtime", "edge"], var.activation_phase)
  data_enabled    = local.phase_index >= 1
  runtime_enabled = local.phase_index >= 2
  edge_enabled    = local.phase_index >= 3
  admin_ingress_inputs_complete = (
    try(var.ingress.auth_hostname, null) != null &&
    try(var.admin_ingress.hostname, null) != null &&
    try(var.admin_ingress.private_zone_id, null) != null &&
    try(var.admin_ingress.certificate_arn, null) != null &&
    length(var.admin_ingress.allowed_operator_cidrs) > 0
  )
  required_capacity = toset([
    "api", "keycloak", "temporal-frontend", "temporal-history", "temporal-matching",
    "temporal-worker", "web", "worker",
  ])
  repository_names = toset(["adot", "api", "keycloak", "temporal", "web", "worker"])
}

check "network_cardinality" {
  assert {
    condition = alltrue([
      length(var.primary_network.availability_zones) == length(var.primary_network.public_subnet_cidrs),
      length(var.primary_network.availability_zones) == length(var.primary_network.private_subnet_cidrs),
      length(var.primary_network.availability_zones) == length(var.primary_network.data_subnet_cidrs),
      length(var.dr_network.availability_zones) == length(var.dr_network.public_subnet_cidrs),
      length(var.dr_network.availability_zones) == length(var.dr_network.private_subnet_cidrs),
      length(var.dr_network.availability_zones) == length(var.dr_network.data_subnet_cidrs),
    ])
    error_message = "Every network must provide one public, private, and data subnet CIDR per AZ."
  }
}

check "production_safety_baseline" {
  assert {
    condition = (
      var.database.multi_az &&
      var.database.backup_retention_days >= 14 &&
      var.database.max_allocated_storage_gib >= var.database.allocated_storage_gib &&
      var.cache.node_count >= 2 &&
      var.cache.snapshot_retention_days >= 7 &&
      var.retention.log_days >= 90 &&
      var.retention.secret_recovery_days == 30 &&
      var.backup.daily_retention_days >= 35 &&
      var.backup.monthly_retention_days >= 365
    )
    error_message = "Environment inputs cannot weaken the Multi-AZ, backup, cache HA, log, or secret-deletion safety baseline."
  }
}

check "runtime_inputs" {
  assert {
    condition = !local.runtime_enabled || (
      var.runtime.temporal_mode == "self-hosted-ecs" &&
      length(setsubtract(local.required_images, toset(keys(var.runtime.images)))) == 0 &&
      length(setsubtract(local.required_images, toset(keys(var.runtime.image_users)))) == 0 &&
      length(setsubtract(local.required_capacity, toset(keys(var.runtime.capacity)))) == 0 &&
      alltrue([for key in local.required_images : can(regex("@sha256:[a-f0-9]{64}$", var.runtime.images[key]))]) &&
      alltrue([for key in local.required_images : can(regex("^[1-9][0-9]{0,9}$", var.runtime.image_users[key]))]) &&
      alltrue([
        for capacity in values(var.runtime.capacity) :
        capacity.minimum_count >= 1 &&
        capacity.desired_count >= capacity.minimum_count &&
        capacity.maximum_count >= capacity.desired_count
      ])
    )
    error_message = "Runtime activation requires self-hosted ECS Temporal, every capacity key, immutable digest-pinned images, and explicit image-owned numeric non-root UIDs."
  }
}

check "phase_contract" {
  assert {
    condition = (
      var.runtime.enabled == local.runtime_enabled &&
      var.ingress.enabled == local.edge_enabled &&
      var.admin_ingress.enabled == local.runtime_enabled
    )
    error_message = "runtime, internal admin ingress, and public ingress must be derived from activation_phase; partial combinations are rejected."
  }
}

check "pilot_keycloak_topology" {
  assert {
    condition = !local.runtime_enabled || var.environment != "pilot-prod" || (
      length(var.primary_network.availability_zones) >= 3 &&
      var.runtime.capacity.keycloak.minimum_count >= 3 &&
      var.runtime.capacity.keycloak.desired_count >= 3
    )
    error_message = "pilot-prod Keycloak requires at least three replicas across a three-AZ network."
  }
}

check "audit_compliance_authorization" {
  assert {
    condition = var.retention.audit_lock_mode != "COMPLIANCE" || (
      var.audit_compliance_authorized_by != null && length(trimspace(var.audit_compliance_authorized_by)) >= 3
    )
    error_message = "Irreversible S3 COMPLIANCE retention requires a named audit_compliance_authorized_by."
  }
}

check "ingress_inputs" {
  assert {
    condition = !var.ingress.enabled || (
      local.runtime_enabled &&
      length(local.ingress_domains) == 3 &&
      length(distinct(local.ingress_domains)) == 3
    )
    error_message = "Enabled ingress requires distinct web, API, and auth hostnames."
  }
}

module "kms_primary" {
  source = "../kms"

  name_prefix             = local.name_prefix
  account_id              = var.account_id
  region                  = var.primary_region
  deletion_window_in_days = 30
  tags                    = local.tags
}

module "kms_dr" {
  source    = "../kms"
  providers = { aws = aws.dr }

  name_prefix             = "${local.name_prefix}-dr"
  account_id              = var.account_id
  region                  = var.dr_region
  deletion_window_in_days = 30
  tags                    = local.tags
}

module "network_primary" {
  source = "../network"

  name_prefix          = local.name_prefix
  region               = var.primary_region
  vpc_cidr             = var.primary_network.vpc_cidr
  availability_zones   = var.primary_network.availability_zones
  public_subnet_cidrs  = var.primary_network.public_subnet_cidrs
  private_subnet_cidrs = var.primary_network.private_subnet_cidrs
  data_subnet_cidrs    = var.primary_network.data_subnet_cidrs
  nat_gateway_count    = local.data_enabled ? var.primary_network.nat_gateway_count : 0
  logs_kms_key_arn     = module.kms_primary.key_arns.logs
  log_retention_days   = var.retention.log_days
  tags                 = local.tags
}

module "network_dr" {
  source    = "../network"
  providers = { aws = aws.dr }

  name_prefix          = "${local.name_prefix}-dr"
  region               = var.dr_region
  vpc_cidr             = var.dr_network.vpc_cidr
  availability_zones   = var.dr_network.availability_zones
  public_subnet_cidrs  = var.dr_network.public_subnet_cidrs
  private_subnet_cidrs = var.dr_network.private_subnet_cidrs
  data_subnet_cidrs    = var.dr_network.data_subnet_cidrs
  nat_gateway_count    = 0
  logs_kms_key_arn     = module.kms_dr.key_arns.logs
  log_retention_days   = var.retention.log_days
  tags                 = local.tags
}

module "storage_primary" {
  source = "../storage"

  name_prefix                    = local.name_prefix
  account_id                     = var.account_id
  data_kms_key_arn               = module.kms_primary.key_arns.data
  is_replica                     = false
  media_retention_days           = var.retention.media_lock_days
  audit_retention_days           = var.retention.audit_lock_days
  audit_lock_mode                = var.retention.audit_lock_mode
  audit_compliance_authorized_by = var.audit_compliance_authorized_by
  access_log_retention_days      = var.retention.access_log_days
  tags                           = local.tags
}

module "storage_dr" {
  source    = "../storage"
  providers = { aws = aws.dr }

  name_prefix                    = local.name_prefix
  account_id                     = var.account_id
  data_kms_key_arn               = module.kms_dr.key_arns.data
  is_replica                     = true
  media_retention_days           = var.retention.media_lock_days
  audit_retention_days           = var.retention.audit_lock_days
  audit_lock_mode                = var.retention.audit_lock_mode
  audit_compliance_authorized_by = var.audit_compliance_authorized_by
  access_log_retention_days      = var.retention.access_log_days
  tags                           = local.tags
}

module "storage_replication" {
  source = "../s3-replication"

  name_prefix             = local.name_prefix
  source_bucket_arns      = module.storage_primary.bucket_arns
  source_bucket_ids       = module.storage_primary.bucket_ids
  destination_bucket_arns = module.storage_dr.bucket_arns
  source_kms_key_arn      = module.kms_primary.key_arns.data
  destination_kms_key_arn = module.kms_dr.key_arns.data
  tags                    = local.tags
}

module "ecr_primary" {
  source = "../ecr"

  name_prefix      = local.name_prefix
  repository_names = local.repository_names
  kms_key_arn      = module.kms_primary.key_arns.data
  tags             = local.tags
}

module "ecr_dr" {
  source    = "../ecr"
  providers = { aws = aws.dr }

  name_prefix      = local.name_prefix
  repository_names = local.repository_names
  kms_key_arn      = module.kms_dr.key_arns.data
  tags             = local.tags
}

module "edge" {
  source = "../edge"

  enabled                         = var.ingress.enabled
  name_prefix                     = local.name_prefix
  vpc_id                          = module.network_primary.vpc_id
  vpc_cidr                        = module.network_primary.vpc_cidr
  public_subnet_ids               = module.network_primary.public_subnet_ids
  access_log_bucket_id            = module.storage_primary.bucket_ids.access_logs
  logs_kms_key_arn                = module.kms_primary.key_arns.logs
  log_retention_days              = var.retention.log_days
  allowed_ipv4_cidrs              = var.ingress.allowed_ipv4_cidrs
  certificate_arn                 = try(var.ingress.certificate_arn, null)
  create_certificate              = var.ingress.create_certificate
  domain_names                    = local.ingress_domains
  hosted_zone_id                  = try(var.ingress.hosted_zone_id, null)
  manage_dns                      = var.ingress.manage_dns
  waf_rate_limit_per_five_minutes = var.ingress.waf_rate_limit
  target_groups = {
    api = {
      port          = 4100
      health_path   = "/health/ready"
      host_headers  = compact([try(var.ingress.api_hostname, null)])
      path_patterns = ["/*"]
      priority      = 10
    }
    auth = {
      port          = 8080
      health_path   = "/realms/master"
      host_headers  = compact([try(var.ingress.auth_hostname, null)])
      path_patterns = ["/*"]
      priority      = 20
    }
    web = {
      port          = 3000
      health_path   = "/"
      host_headers  = compact([try(var.ingress.web_hostname, null)])
      path_patterns = ["/*"]
      priority      = 30
    }
  }
  tags = local.tags
}

module "admin_ingress" {
  count  = local.runtime_enabled && local.admin_ingress_inputs_complete ? 1 : 0
  source = "../admin-ingress"

  name_prefix            = local.name_prefix
  region                 = var.primary_region
  vpc_id                 = module.network_primary.vpc_id
  vpc_cidr               = module.network_primary.vpc_cidr
  private_subnet_ids     = module.network_primary.private_subnet_ids
  access_log_bucket_id   = module.storage_primary.bucket_ids.access_logs
  hostname               = var.admin_ingress.hostname
  private_zone_id        = var.admin_ingress.private_zone_id
  certificate_arn        = var.admin_ingress.certificate_arn
  allowed_operator_cidrs = var.admin_ingress.allowed_operator_cidrs
  tags                   = local.tags
}

module "workload_security" {
  source = "../workload-security"

  name_prefix                 = local.name_prefix
  vpc_id                      = module.network_primary.vpc_id
  vpc_cidr                    = module.network_primary.vpc_cidr
  service_ports               = [3000, 4100, 57800, 7233, 7234, 7235, 7239, 7800, 8080]
  alb_enabled                 = var.ingress.enabled
  alb_security_group_id       = module.edge.alb_security_group_id
  alb_target_ports            = [3000, 4100, 8080]
  admin_alb_enabled           = local.runtime_enabled && local.admin_ingress_inputs_complete
  admin_alb_security_group_id = try(module.admin_ingress[0].security_group_id, null)
  tags                        = local.tags
}

module "database" {
  count  = local.data_enabled ? 1 : 0
  source = "../database"

  name_prefix                          = local.name_prefix
  account_id                           = var.account_id
  region                               = var.primary_region
  vpc_id                               = module.network_primary.vpc_id
  data_subnet_ids                      = module.network_primary.data_subnet_ids
  application_security_group_id        = module.workload_security.security_group_id
  data_kms_key_arn                     = module.kms_primary.key_arns.data
  secrets_kms_key_arn                  = module.kms_primary.key_arns.secrets
  logs_kms_key_arn                     = module.kms_primary.key_arns.logs
  engine_version                       = var.database.engine_version
  parameter_group_family               = var.database.parameter_group_family
  instance_class                       = var.database.instance_class
  allocated_storage_gib                = var.database.allocated_storage_gib
  max_allocated_storage_gib            = var.database.max_allocated_storage_gib
  multi_az                             = var.database.multi_az
  backup_retention_days                = var.database.backup_retention_days
  log_retention_days                   = var.retention.log_days
  performance_insights_retention_days  = var.database.performance_insights_retention_days
  enhanced_monitoring_interval_seconds = 60
  deletion_protection                  = true
  tags                                 = local.tags
}

module "cache" {
  count  = local.data_enabled ? 1 : 0
  source = "../cache"

  name_prefix                   = local.name_prefix
  vpc_id                        = module.network_primary.vpc_id
  data_subnet_ids               = module.network_primary.data_subnet_ids
  application_security_group_id = module.workload_security.security_group_id
  data_kms_key_arn              = module.kms_primary.key_arns.data
  secrets_kms_key_arn           = module.kms_primary.key_arns.secrets
  node_type                     = var.cache.node_type
  engine_version                = var.cache.engine_version
  node_count                    = var.cache.node_count
  snapshot_retention_days       = var.cache.snapshot_retention_days
  secret_recovery_window_days   = var.retention.secret_recovery_days
  tags                          = local.tags
}

module "secrets" {
  count  = local.data_enabled ? 1 : 0
  source = "../secrets"

  name_prefix          = local.name_prefix
  kms_key_arn          = module.kms_primary.key_arns.secrets
  recovery_window_days = var.retention.secret_recovery_days
  secret_names = {
    application-database = "Runtime PostgreSQL URL for the RLS-restricted application role"
    keycloak-bootstrap   = "Keycloak bootstrap administration material; removed after realm bootstrap"
    keycloak-database    = "Keycloak-only PostgreSQL credentials"
    provider-credentials = "Official provider credentials populated only after registration and activation"
    runtime-session      = "Web BFF session and CSRF key material"
    temporal-database    = "Temporal schema-specific PostgreSQL credentials"
  }
  tags = local.tags
}

module "vpc_endpoints" {
  count  = local.data_enabled ? 1 : 0
  source = "../vpc-endpoints"

  name_prefix              = local.name_prefix
  account_id               = var.account_id
  region                   = var.primary_region
  vpc_id                   = module.network_primary.vpc_id
  private_subnet_ids       = module.network_primary.private_subnet_ids
  route_table_ids          = concat(module.network_primary.private_route_table_ids, module.network_primary.data_route_table_ids)
  source_security_group_id = module.workload_security.security_group_id
  s3_bucket_arns           = toset(values(module.storage_primary.bucket_arns))
  ecr_repository_arns      = toset(values(module.ecr_primary.repository_arns))
  secret_arns = toset(compact(concat(
    values(module.secrets[0].secret_arns),
    [nonsensitive(module.cache[0].auth_secret_arn), nonsensitive(module.database[0].master_secret_arn)],
  )))
  kms_key_arns = toset(values(module.kms_primary.key_arns))
  log_group_arns = toset([
    module.network_primary.flow_log_group_arn,
    "arn:aws:logs:${var.primary_region}:${var.account_id}:log-group:/aws/ecs/${local.name_prefix}/*",
    "arn:aws:logs:${var.primary_region}:${var.account_id}:log-group:/aws/rds/instance/${local.name_prefix}-postgres/*",
  ])
  metric_namespace = "ClinicOS/${var.environment}"
  tags             = local.tags
}

locals {
  common_task_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["xray:PutTelemetryRecords", "xray:PutTraceSegments"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "ClinicOS/${var.environment}" }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.primary_region}:${var.account_id}:log-group:/aws/ecs/${local.name_prefix}/*:*"
      },
    ]
  })
  media_task_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload", "s3:GetObject", "s3:GetObjectAttributes", "s3:GetObjectTagging",
          "s3:ListBucket", "s3:PutObject", "s3:PutObjectTagging",
        ]
        Resource = [
          module.storage_primary.bucket_arns.media,
          "${module.storage_primary.bucket_arns.media}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey*"]
        Resource = module.kms_primary.key_arns.data
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${var.primary_region}.amazonaws.com" }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData", "xray:PutTelemetryRecords", "xray:PutTraceSegments",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.primary_region}:${var.account_id}:log-group:/aws/ecs/${local.name_prefix}/*:*"
      },
    ]
  })
  application_secret_arn = try(module.secrets[0].secret_arns["application-database"], null)
  keycloak_secret_arn    = try(module.secrets[0].secret_arns["keycloak-database"], null)
  provider_secret_arn    = try(module.secrets[0].secret_arns["provider-credentials"], null)
  session_secret_arn     = try(module.secrets[0].secret_arns["runtime-session"], null)
  temporal_secret_arn    = try(module.secrets[0].secret_arns["temporal-database"], null)
  keycloak_bootstrap_arn = try(module.secrets[0].secret_arns["keycloak-bootstrap"], null)
  runtime_services = local.runtime_enabled ? {
    api = {
      image_uri      = var.runtime.images.api
      user           = var.runtime.image_users.api
      cpu            = var.runtime.capacity.api.cpu
      memory         = var.runtime.capacity.api.memory
      container_port = 4100
      app_protocol   = "http"
      desired_count  = var.runtime.capacity.api.desired_count
      minimum_count  = var.runtime.capacity.api.minimum_count
      maximum_count  = var.runtime.capacity.api.maximum_count
      command        = []
      environment = {
        NODE_ENV                  = "production"
        CLINIC_OS_ENV             = var.environment
        PORT                      = "4100"
        REPOSITORY_MODE           = "postgres"
        AUTH_MODE                 = "keycloak"
        PILOT_SYNTHETIC_DATA_ONLY = "true"
        TEMPORAL_ADDRESS          = "temporal-frontend.${local.name_prefix}.internal:7233"
        KEYCLOAK_BASE_URL         = "https://${var.ingress.auth_hostname}"
        KEYCLOAK_REALM            = "clinic-os"
        KEYCLOAK_CLIENT_ID        = "clinic-os-web-bff"
        S3_REGION                 = var.primary_region
        S3_BUCKET                 = module.storage_primary.bucket_ids.media
        WHATSAPP_PROVIDER         = "unconfigured"
        PAYMENT_PROVIDER          = "unconfigured"
        TELEPHONY_PROVIDER        = "unconfigured"
        LLM_PROVIDER              = "unconfigured"
        TRANSCRIPTION_PROVIDER    = "unconfigured"
        ALERTING_PROVIDER         = "unconfigured"
      }
      secrets = {
        DATABASE_URL                          = "${local.application_secret_arn}:url::"
        REDIS_URL                             = "${module.cache[0].auth_secret_arn}:url::"
        CLINIC_OS_ABUSE_BUDGET_KEY_SECRET     = "${local.session_secret_arn}:abuse_budget_key::"
        CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET = "${local.session_secret_arn}:token_revocation_key::"
      }
      execution_secret_arns        = [local.application_secret_arn, module.cache[0].auth_secret_arn, local.session_secret_arn]
      task_policy_json             = local.media_task_policy
      target_group_arn             = try(module.edge.target_group_arns.api, null)
      additional_target_group_arns = []
      health_check_command         = ["CMD-SHELL", "wget -q -O - http://127.0.0.1:4100/health/ready || exit 1"]
      health_check_grace_seconds   = 120
      create_service               = true
      use_fargate_spot             = var.runtime.capacity.api.use_fargate_spot
    }
    web = {
      image_uri                    = var.runtime.images.web
      user                         = var.runtime.image_users.web
      cpu                          = var.runtime.capacity.web.cpu
      memory                       = var.runtime.capacity.web.memory
      container_port               = 3000
      app_protocol                 = "http"
      desired_count                = var.runtime.capacity.web.desired_count
      minimum_count                = var.runtime.capacity.web.minimum_count
      maximum_count                = var.runtime.capacity.web.maximum_count
      command                      = []
      environment                  = { NODE_ENV = "production" }
      secrets                      = { SESSION_SECRET = "${local.session_secret_arn}:session_secret::" }
      execution_secret_arns        = [local.session_secret_arn]
      task_policy_json             = local.common_task_policy
      target_group_arn             = try(module.edge.target_group_arns.web, null)
      additional_target_group_arns = []
      health_check_command         = ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3000/ || exit 1"]
      health_check_grace_seconds   = 120
      create_service               = true
      use_fargate_spot             = var.runtime.capacity.web.use_fargate_spot
    }
    worker = {
      image_uri      = var.runtime.images.worker
      user           = var.runtime.image_users.worker
      cpu            = var.runtime.capacity.worker.cpu
      memory         = var.runtime.capacity.worker.memory
      container_port = 3001
      app_protocol   = "http"
      desired_count  = var.runtime.capacity.worker.desired_count
      minimum_count  = var.runtime.capacity.worker.minimum_count
      maximum_count  = var.runtime.capacity.worker.maximum_count
      command        = []
      environment = {
        NODE_ENV           = "production"
        CLINIC_OS_ENV      = var.environment
        TEMPORAL_ADDRESS   = "temporal-frontend.${local.name_prefix}.internal:7233"
        WORKER_HEALTH_PORT = "3001"
        PAYMENT_PROVIDER   = "unconfigured"
      }
      secrets = {
        DATABASE_URL                      = "${local.application_secret_arn}:url::"
        WORKER_DATABASE_URL               = "${local.application_secret_arn}:worker_url::"
        CLINIC_OS_ABUSE_BUDGET_KEY_SECRET = "${local.session_secret_arn}:abuse_budget_key::"
      }
      execution_secret_arns        = [local.application_secret_arn, local.session_secret_arn]
      task_policy_json             = local.media_task_policy
      target_group_arn             = null
      additional_target_group_arns = []
      health_check_command         = ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3001/health/ready || exit 1"]
      health_check_grace_seconds   = 0
      create_service               = true
      use_fargate_spot             = var.runtime.capacity.worker.use_fargate_spot
    }
    keycloak = {
      image_uri      = var.runtime.images.keycloak
      user           = var.runtime.image_users.keycloak
      cpu            = var.runtime.capacity.keycloak.cpu
      memory         = var.runtime.capacity.keycloak.memory
      container_port = 8080
      app_protocol   = "http"
      desired_count  = var.runtime.capacity.keycloak.desired_count
      minimum_count  = var.runtime.capacity.keycloak.minimum_count
      maximum_count  = var.runtime.capacity.keycloak.maximum_count
      command        = ["start", "--optimized"]
      environment = {
        KC_CACHE                        = "ispn"
        KC_CACHE_STACK                  = "jdbc-ping"
        KC_DB                           = "postgres"
        KC_HEALTH_ENABLED               = "true"
        KC_HOSTNAME                     = "https://${var.ingress.auth_hostname}"
        KC_HOSTNAME_ADMIN               = "https://${coalesce(var.admin_ingress.hostname, "invalid")}"
        KC_HOSTNAME_BACKCHANNEL_DYNAMIC = "false"
        KC_HOSTNAME_STRICT              = "true"
        KC_HTTP_ENABLED                 = "true"
        KC_METRICS_ENABLED              = "true"
        KC_PROXY_HEADERS                = "xforwarded"
      }
      secrets = {
        KC_DB_URL      = "${local.keycloak_secret_arn}:url::"
        KC_DB_USERNAME = "${local.keycloak_secret_arn}:username::"
        KC_DB_PASSWORD = "${local.keycloak_secret_arn}:password::"
      }
      execution_secret_arns        = [local.keycloak_secret_arn]
      task_policy_json             = local.common_task_policy
      target_group_arn             = try(module.edge.target_group_arns.auth, null)
      additional_target_group_arns = compact([try(module.admin_ingress[0].target_group_arn, null)])
      health_check_command         = ["CMD-SHELL", "curl -fsS http://127.0.0.1:9000/health/ready || exit 1"]
      health_check_grace_seconds   = 180
      create_service               = true
      use_fargate_spot             = var.runtime.capacity.keycloak.use_fargate_spot
    }
    keycloak-bootstrap = {
      image_uri      = var.runtime.images.keycloak
      user           = var.runtime.image_users.keycloak
      cpu            = 512
      memory         = 1024
      container_port = 0
      app_protocol   = "http"
      desired_count  = 0
      minimum_count  = 0
      maximum_count  = 0
      command        = ["/opt/clinicos/bin/bootstrap-keycloak"]
      environment = {
        KC_DB = "postgres"
      }
      secrets = {
        KC_DB_URL                   = "${local.keycloak_secret_arn}:url::"
        KC_DB_USERNAME              = "${local.keycloak_secret_arn}:username::"
        KC_DB_PASSWORD              = "${local.keycloak_secret_arn}:password::"
        KC_BOOTSTRAP_ADMIN_USERNAME = "${local.keycloak_bootstrap_arn}:username::"
        KC_BOOTSTRAP_ADMIN_PASSWORD = "${local.keycloak_bootstrap_arn}:password::"
      }
      execution_secret_arns        = [local.keycloak_secret_arn, local.keycloak_bootstrap_arn]
      task_policy_json             = local.common_task_policy
      target_group_arn             = null
      additional_target_group_arns = []
      health_check_command         = []
      health_check_grace_seconds   = 0
      create_service               = false
      use_fargate_spot             = false
    }
    temporal-frontend = local.temporal_services.frontend
    temporal-history  = local.temporal_services.history
    temporal-matching = local.temporal_services.matching
    temporal-worker   = local.temporal_services.worker
    temporal-schema = {
      image_uri      = var.runtime.images.temporal
      user           = var.runtime.image_users.temporal
      cpu            = 512
      memory         = 1024
      container_port = 0
      app_protocol   = "http"
      desired_count  = 0
      minimum_count  = 0
      maximum_count  = 0
      command        = ["/opt/clinicos/bin/migrate-temporal"]
      environment = {
        DB                = "postgres12"
        POSTGRES_SEEDS    = module.database[0].address
        DB_PORT           = tostring(module.database[0].port)
        DBNAME            = "temporal"
        VISIBILITY_DBNAME = "temporal_visibility"
      }
      secrets = {
        POSTGRES_USER = "${coalesce(local.temporal_secret_arn, "placeholder")}:username::"
        POSTGRES_PWD  = "${coalesce(local.temporal_secret_arn, "placeholder")}:password::"
      }
      execution_secret_arns        = [local.temporal_secret_arn]
      task_policy_json             = local.common_task_policy
      target_group_arn             = null
      additional_target_group_arns = []
      health_check_command         = []
      health_check_grace_seconds   = 0
      create_service               = false
      use_fargate_spot             = false
    }
  } : {}
  temporal_services = {
    for service, port in { frontend = 7233, history = 7234, matching = 7235, worker = 7239 } : service => {
      image_uri                     = try(var.runtime.images.temporal, "")
      user                          = try(var.runtime.image_users.temporal, "1")
      cpu                           = try(var.runtime.capacity["temporal-${service}"].cpu, 512)
      memory                        = try(var.runtime.capacity["temporal-${service}"].memory, 1024)
      container_port                = port
      app_protocol                  = "grpc"
      desired_count                 = try(var.runtime.capacity["temporal-${service}"].desired_count, 0)
      minimum_count                 = try(var.runtime.capacity["temporal-${service}"].minimum_count, 0)
      maximum_count                 = try(var.runtime.capacity["temporal-${service}"].maximum_count, 0)
      command                       = ["temporal-server", "start", "--service=${service}"]
      environment = {
        DB                = "postgres12"
        POSTGRES_SEEDS    = try(module.database[0].address, "")
        DB_PORT           = tostring(try(module.database[0].port, 5432))
        DBNAME            = "temporal"
        VISIBILITY_DBNAME = "temporal_visibility"
      }
      secrets = {
        POSTGRES_USER = "${coalesce(local.temporal_secret_arn, "placeholder")}:username::"
        POSTGRES_PWD  = "${coalesce(local.temporal_secret_arn, "placeholder")}:password::"
      }
      execution_secret_arns        = compact([local.temporal_secret_arn])
      task_policy_json             = local.common_task_policy
      target_group_arn             = null
      additional_target_group_arns = []
      health_check_command         = []
      health_check_grace_seconds   = 0
      create_service               = true
      use_fargate_spot             = try(var.runtime.capacity["temporal-${service}"].use_fargate_spot, false)
    }
  }
}

module "compute" {
  count  = local.runtime_enabled ? 1 : 0
  source = "../compute"

  name_prefix                 = local.name_prefix
  region                      = var.primary_region
  metric_namespace            = "ClinicOS/${var.environment}"
  vpc_id                      = module.network_primary.vpc_id
  vpc_cidr                    = module.network_primary.vpc_cidr
  private_subnet_ids          = module.network_primary.private_subnet_ids
  security_group_id           = module.workload_security.security_group_id
  logs_kms_key_arn            = module.kms_primary.key_arns.logs
  log_retention_days          = var.retention.log_days
  ecr_repository_arns         = module.ecr_primary.repository_arns
  kms_key_arns                = values(module.kms_primary.key_arns)
  adot_image_uri              = try(var.runtime.images.adot, null)
  adot_user                   = try(var.runtime.image_users.adot, null)
  service_discovery_namespace = "${local.name_prefix}.internal"
  services                    = local.runtime_services
  tags                        = local.tags
}

module "backup_dr" {
  count     = local.data_enabled ? 1 : 0
  source    = "../backup"
  providers = { aws = aws.dr }

  name_prefix                = "${local.name_prefix}-dr"
  vault_kms_key_arn          = module.kms_dr.key_arns.backup
  create_plan                = false
  daily_retention_days       = var.backup.daily_retention_days
  monthly_retention_days     = var.backup.monthly_retention_days
  vault_lock_enabled         = var.backup.dr_vault_lock_enabled
  vault_lock_changeable_days = var.backup.vault_lock_changeable_days
  tags                       = local.tags
}

module "backup_primary" {
  count  = local.data_enabled ? 1 : 0
  source = "../backup"

  name_prefix                = local.name_prefix
  vault_kms_key_arn          = module.kms_primary.key_arns.backup
  dr_vault_arn               = module.backup_dr[0].vault_arn
  create_plan                = true
  resource_arns              = [module.database[0].arn, module.cache[0].arn]
  daily_retention_days       = var.backup.daily_retention_days
  monthly_retention_days     = var.backup.monthly_retention_days
  vault_lock_enabled         = var.backup.primary_vault_lock_enabled
  vault_lock_changeable_days = var.backup.vault_lock_changeable_days
  tags                       = local.tags
}

module "observability" {
  count  = local.data_enabled ? 1 : 0
  source = "../observability"

  name_prefix                  = local.name_prefix
  account_id                   = var.account_id
  region                       = var.primary_region
  edge_enabled                 = local.edge_enabled
  metric_namespace             = "ClinicOS/${var.environment}"
  logs_kms_key_arn             = module.kms_primary.key_arns.logs
  ecs_cluster_name             = try(module.compute[0].cluster_name, "")
  ecs_service_names            = try(module.compute[0].service_names, {})
  db_identifier                = module.database[0].identifier
  cache_replication_group_id   = module.cache[0].replication_group_id
  alb_arn_suffix               = module.edge.alb_arn_suffix
  waf_name                     = module.edge.waf_name
  additional_alarm_action_arns = var.additional_alarm_action_arns
  tags                         = local.tags
}

locals {
  environment_resource_arns = compact(concat(
    [
      "arn:aws:acm:*:${var.account_id}:certificate/*",
      "arn:aws:application-autoscaling:*:${var.account_id}:scalable-target/*",
      "arn:aws:application-autoscaling:*:${var.account_id}:scaling-policy/*",
      "arn:aws:cloudwatch:*:${var.account_id}:alarm:${local.name_prefix}-*",
      "arn:aws:cloudwatch::*:dashboard/${local.name_prefix}-*",
      "arn:aws:cloudwatch::*:dashboard/${local.name_prefix}-*",
      "arn:aws:ec2:*:${var.account_id}:*/*",
      "arn:aws:ecr:*:${var.account_id}:repository/${local.name_prefix}-*",
      "arn:aws:ecs:*:${var.account_id}:cluster/${local.name_prefix}",
      "arn:aws:ecs:*:${var.account_id}:service/${local.name_prefix}/*",
      "arn:aws:ecs:*:${var.account_id}:task-definition/${local.name_prefix}-*",
      "arn:aws:elasticache:*:${var.account_id}:*:${local.name_prefix}-*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:loadbalancer/app/${local.name_prefix}-*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:listener/app/${local.name_prefix}-*/*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:listener-rule/app/${local.name_prefix}-*/*/*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:targetgroup/${local.name_prefix}-*/*",
      "arn:aws:events:*:${var.account_id}:rule/${local.name_prefix}-*",
      "arn:aws:kms:*:${var.account_id}:alias/clinicos/${var.environment}/*",
      "arn:aws:kms:*:${var.account_id}:key/*",
      "arn:aws:logs:*:${var.account_id}:log-group:/aws/*/${local.name_prefix}*",
      "arn:aws:rds:*:${var.account_id}:db:${local.name_prefix}-*",
      "arn:aws:rds:*:${var.account_id}:pg:${local.name_prefix}-*",
      "arn:aws:rds:*:${var.account_id}:subgrp:${local.name_prefix}-*",
      "arn:aws:resource-groups:*:${var.account_id}:group/${local.name_prefix}-*",
      "arn:aws:servicediscovery:*:${var.account_id}:namespace/*",
      "arn:aws:servicediscovery:*:${var.account_id}:service/*",
      "arn:aws:secretsmanager:*:${var.account_id}:secret:${local.name_prefix}/*",
      "arn:aws:sns:*:${var.account_id}:${local.name_prefix}-*",
      "arn:aws:wafv2:*:${var.account_id}:regional/webacl/${local.name_prefix}-*/*",
      "arn:aws:xray:*:${var.account_id}:group/${local.name_prefix}-*",
      "arn:aws:xray:*:${var.account_id}:sampling-rule/${local.name_prefix}-*",
    ],
    values(module.storage_primary.bucket_arns),
    [for arn in values(module.storage_primary.bucket_arns) : "${arn}/*"],
    values(module.storage_dr.bucket_arns),
    [for arn in values(module.storage_dr.bucket_arns) : "${arn}/*"],
    try(var.ingress.hosted_zone_id, null) == null ? [] : ["arn:aws:route53:::hostedzone/${var.ingress.hosted_zone_id}"],
    try(var.admin_ingress.private_zone_id, null) == null ? [] : ["arn:aws:route53:::hostedzone/${var.admin_ingress.private_zone_id}"],
  ))
  read_resource_arns = compact(concat(
    [
      "arn:aws:backup:*:${var.account_id}:backup-plan:*",
      "arn:aws:backup:*:${var.account_id}:backup-vault:${local.name_prefix}*",
      "arn:aws:cloudwatch:*:${var.account_id}:alarm:${local.name_prefix}-*",
      "arn:aws:ecs:*:${var.account_id}:cluster/${local.name_prefix}",
      "arn:aws:ecs:*:${var.account_id}:service/${local.name_prefix}/*",
      "arn:aws:ecs:*:${var.account_id}:task-definition/${local.name_prefix}-*",
      "arn:aws:elasticache:*:${var.account_id}:*:${local.name_prefix}-*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:loadbalancer/app/${local.name_prefix}-*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:listener/app/${local.name_prefix}-*/*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:listener-rule/app/${local.name_prefix}-*/*/*/*",
      "arn:aws:elasticloadbalancing:*:${var.account_id}:targetgroup/${local.name_prefix}-*/*",
      "arn:aws:events:*:${var.account_id}:rule/${local.name_prefix}-*",
      "arn:aws:logs:*:${var.account_id}:log-group:/aws/*/${local.name_prefix}*",
      "arn:aws:rds:*:${var.account_id}:db:${local.name_prefix}-*",
      "arn:aws:rds:*:${var.account_id}:pg:${local.name_prefix}-*",
      "arn:aws:rds:*:${var.account_id}:subgrp:${local.name_prefix}-*",
      "arn:aws:resource-groups:*:${var.account_id}:group/${local.name_prefix}-*",
      "arn:aws:secretsmanager:*:${var.account_id}:secret:${local.name_prefix}/*",
      "arn:aws:sns:*:${var.account_id}:${local.name_prefix}-*",
      "arn:aws:wafv2:*:${var.account_id}:regional/webacl/${local.name_prefix}-*/*",
      "arn:aws:xray:*:${var.account_id}:sampling-rule/${local.name_prefix}-*",
      module.edge.certificate_arn,
      try(var.admin_ingress.certificate_arn, null),
      try(module.backup_primary[0].plan_arn, null),
      try(module.backup_primary[0].vault_arn, null),
      try(module.backup_dr[0].vault_arn, null),
    ],
    values(module.kms_primary.key_arns),
    values(module.kms_dr.key_arns),
    values(module.ecr_primary.repository_arns),
    values(module.ecr_dr.repository_arns),
    values(module.storage_primary.bucket_arns),
    values(module.storage_dr.bucket_arns),
    try(var.ingress.hosted_zone_id, null) == null ? [] : ["arn:aws:route53:::hostedzone/${var.ingress.hosted_zone_id}"],
    try(var.admin_ingress.private_zone_id, null) == null ? [] : ["arn:aws:route53:::hostedzone/${var.admin_ingress.private_zone_id}"],
  ))
  metadata_read_actions = [
    "acm:DescribeCertificate", "acm:ListTagsForCertificate",
    "application-autoscaling:DescribeScalableTargets", "application-autoscaling:DescribeScalingPolicies",
    "backup:DescribeBackupVault", "backup:GetBackupPlan", "backup:GetBackupSelection", "backup:GetBackupVaultAccessPolicy", "backup:ListTags",
    "cloudwatch:DescribeAlarms", "cloudwatch:GetDashboard", "cloudwatch:ListTagsForResource",
    "ec2:DescribeAddresses", "ec2:DescribeAvailabilityZones", "ec2:DescribeFlowLogs", "ec2:DescribeInternetGateways", "ec2:DescribeNatGateways", "ec2:DescribeNetworkInterfaces", "ec2:DescribeRouteTables", "ec2:DescribeSecurityGroupRules", "ec2:DescribeSecurityGroups", "ec2:DescribeSubnets", "ec2:DescribeTags", "ec2:DescribeVpcAttribute", "ec2:DescribeVpcEndpoints", "ec2:DescribeVpcs",
    "ecr:DescribeImages", "ecr:DescribeRepositories", "ecr:GetLifecyclePolicy", "ecr:GetRepositoryPolicy", "ecr:ListTagsForResource",
    "ecs:DescribeClusters", "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:ListServices", "ecs:ListTagsForResource", "ecs:ListTaskDefinitions",
    "elasticache:DescribeCacheSubnetGroups", "elasticache:DescribeReplicationGroups", "elasticache:ListTagsForResource",
    "elasticloadbalancing:DescribeListenerAttributes", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeTargetGroupAttributes", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth",
    "events:DescribeRule", "events:ListTagsForResource", "events:ListTargetsByRule",
    "kms:DescribeKey", "kms:GetKeyPolicy", "kms:GetKeyRotationStatus", "kms:ListResourceTags",
    "logs:DescribeLogGroups", "logs:ListTagsForResource", "rds:DescribeDBInstances", "rds:DescribeDBParameterGroups", "rds:DescribeDBParameters", "rds:DescribeDBSubnetGroups", "rds:DescribePendingMaintenanceActions", "rds:ListTagsForResource",
    "resource-groups:GetGroup", "resource-groups:GetGroupQuery", "resource-groups:GetTags",
    "route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:ListTagsForResource", "servicediscovery:GetNamespace", "servicediscovery:GetService", "servicediscovery:ListTagsForResource",
    "secretsmanager:DescribeSecret", "secretsmanager:ListSecretVersionIds", "sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic", "sns:ListTagsForResource",
    "wafv2:GetLoggingConfiguration", "wafv2:GetWebACL", "wafv2:ListTagsForResource", "xray:GetSamplingRules",
  ]
  global_read_actions = [
    "application-autoscaling:DescribeScalableTargets", "application-autoscaling:DescribeScalingPolicies",
    "cloudwatch:DescribeAlarms",
    "ec2:DescribeAddresses", "ec2:DescribeAvailabilityZones", "ec2:DescribeFlowLogs", "ec2:DescribeInternetGateways", "ec2:DescribeNatGateways", "ec2:DescribeNetworkInterfaces", "ec2:DescribeRouteTables", "ec2:DescribeSecurityGroupRules", "ec2:DescribeSecurityGroups", "ec2:DescribeSubnets", "ec2:DescribeTags", "ec2:DescribeVpcAttribute", "ec2:DescribeVpcEndpoints", "ec2:DescribeVpcs",
    "ecr:DescribeRepositories", "ecs:ListServices", "ecs:ListTaskDefinitions",
    "elasticache:DescribeCacheSubnetGroups", "elasticache:DescribeReplicationGroups",
    "elasticloadbalancing:DescribeListenerAttributes", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeTargetGroupAttributes", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth",
    "kms:ListAliases", "logs:DescribeLogGroups",
    "rds:DescribeDBInstances", "rds:DescribeDBParameterGroups", "rds:DescribeDBParameters", "rds:DescribeDBSubnetGroups", "rds:DescribePendingMaintenanceActions",
    "xray:GetSamplingRules",
  ]
  bucket_read_actions = [
    "s3:GetBucketAcl", "s3:GetBucketLocation", "s3:GetBucketLogging", "s3:GetBucketObjectLockConfiguration",
    "s3:GetBucketPolicy", "s3:GetBucketPublicAccessBlock", "s3:GetBucketTagging", "s3:GetBucketVersioning",
    "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket",
  ]
  iam_read_actions = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"]
  all_read_actions = toset(concat(local.metadata_read_actions, local.global_read_actions, local.bucket_read_actions, local.iam_read_actions))
  read_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ControlPlaneMetadataOnly"
        Effect   = "Allow"
        Action   = local.metadata_read_actions
        Resource = local.read_resource_arns
      },
      {
        Sid      = "NonDataGlobalDiscovery"
        Effect   = "Allow"
        Action   = local.global_read_actions
        Resource = "*"
      },
      {
        Sid      = "DeclaredBucketConfigurationOnly"
        Effect   = "Allow"
        Action   = local.bucket_read_actions
        Resource = concat(values(module.storage_primary.bucket_arns), values(module.storage_dr.bucket_arns))
      },
      {
        Sid      = "EnvironmentIamMetadata"
        Effect   = "Allow"
        Action   = local.iam_read_actions
        Resource = "arn:aws:iam::${var.account_id}:role/clinicos/${local.name_prefix}/*"
      },
      {
        Sid      = "TaggedServiceDiscoveryMetadata"
        Effect   = "Allow"
        Action   = ["servicediscovery:GetNamespace", "servicediscovery:GetService", "servicediscovery:ListTagsForResource"]
        Resource = ["arn:aws:servicediscovery:*:${var.account_id}:namespace/*", "arn:aws:servicediscovery:*:${var.account_id}:service/*"]
        Condition = {
          StringEquals = { "aws:ResourceTag/Environment" = var.environment }
        }
      },
    ]
  })
  deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PlatformResourceLifecycle"
        Effect = "Allow"
        Action = [
          "acm:AddTagsToCertificate", "acm:DeleteCertificate", "acm:ImportCertificate", "acm:RemoveTagsFromCertificate", "acm:RequestCertificate",
          "application-autoscaling:DeleteScalingPolicy", "application-autoscaling:DeregisterScalableTarget", "application-autoscaling:PutScalingPolicy", "application-autoscaling:RegisterScalableTarget",
          "backup:CreateBackupPlan", "backup:CreateBackupSelection", "backup:CreateBackupVault", "backup:DeleteBackupPlan", "backup:DeleteBackupSelection", "backup:DeleteBackupVault", "backup:PutBackupVaultLockConfiguration", "backup:TagResource", "backup:UntagResource", "backup:UpdateBackupPlan",
          "cloudwatch:DeleteAlarms", "cloudwatch:DeleteDashboards", "cloudwatch:PutDashboard", "cloudwatch:PutMetricAlarm", "cloudwatch:PutMetricData", "cloudwatch:PutMetricStream", "cloudwatch:TagResource", "cloudwatch:UntagResource",
          "ec2:AllocateAddress", "ec2:AssociateRouteTable", "ec2:AttachInternetGateway", "ec2:CreateFlowLogs", "ec2:CreateInternetGateway", "ec2:CreateNatGateway", "ec2:CreateRoute", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup", "ec2:CreateSubnet", "ec2:CreateTags", "ec2:CreateVpc", "ec2:CreateVpcEndpoint", "ec2:DeleteFlowLogs", "ec2:DeleteInternetGateway", "ec2:DeleteNatGateway", "ec2:DeleteRoute", "ec2:DeleteRouteTable", "ec2:DeleteSecurityGroup", "ec2:DeleteSubnet", "ec2:DeleteVpc", "ec2:DeleteVpcEndpoints", "ec2:DetachInternetGateway", "ec2:DisassociateRouteTable", "ec2:ModifySubnetAttribute", "ec2:ModifyVpcAttribute", "ec2:ReleaseAddress", "ec2:RevokeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:AuthorizeSecurityGroupIngress",
          "ecr:CreateRepository", "ecr:DeleteLifecyclePolicy", "ecr:DeleteRepository", "ecr:PutImageScanningConfiguration", "ecr:PutImageTagMutability", "ecr:PutLifecyclePolicy", "ecr:SetRepositoryPolicy", "ecr:TagResource", "ecr:UntagResource",
          "ecs:CreateCluster", "ecs:CreateService", "ecs:DeleteCluster", "ecs:DeleteService", "ecs:DeregisterTaskDefinition", "ecs:PutClusterCapacityProviders", "ecs:RegisterTaskDefinition", "ecs:TagResource", "ecs:UntagResource", "ecs:UpdateClusterSettings", "ecs:UpdateService",
          "elasticache:CreateCacheSubnetGroup", "elasticache:CreateReplicationGroup", "elasticache:DeleteCacheSubnetGroup", "elasticache:DeleteReplicationGroup", "elasticache:ModifyCacheSubnetGroup", "elasticache:ModifyReplicationGroup", "elasticache:AddTagsToResource", "elasticache:RemoveTagsFromResource",
          "events:DeleteRule", "events:PutRule", "events:PutTargets", "events:RemoveTargets", "events:TagResource", "events:UntagResource",
          "kms:CreateAlias", "kms:CreateGrant", "kms:CreateKey", "kms:DeleteAlias", "kms:DisableKey", "kms:EnableKey", "kms:EnableKeyRotation", "kms:PutKeyPolicy", "kms:ScheduleKeyDeletion", "kms:TagResource", "kms:UntagResource", "kms:UpdateAlias", "kms:UpdateKeyDescription",
          "logs:AssociateKmsKey", "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DeleteRetentionPolicy", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource",
          "rds:AddTagsToResource", "rds:CreateDBInstance", "rds:CreateDBParameterGroup", "rds:CreateDBSubnetGroup", "rds:DeleteDBInstance", "rds:DeleteDBParameterGroup", "rds:DeleteDBSubnetGroup", "rds:ModifyDBInstance", "rds:ModifyDBParameterGroup", "rds:ModifyDBSubnetGroup", "rds:RemoveTagsFromResource",
          "resource-groups:CreateGroup", "resource-groups:DeleteGroup", "resource-groups:Tag", "resource-groups:Untag", "resource-groups:UpdateGroup",
          "route53:ChangeResourceRecordSets", "route53:ChangeTagsForResource",
          "s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketLifecycleConfiguration", "s3:PutBucketLogging", "s3:PutBucketObjectLockConfiguration", "s3:PutBucketOwnershipControls", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock", "s3:PutBucketReplication", "s3:PutBucketTagging", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration",
          "servicediscovery:CreatePrivateDnsNamespace", "servicediscovery:CreateService", "servicediscovery:DeleteNamespace", "servicediscovery:DeleteService", "servicediscovery:TagResource", "servicediscovery:UntagResource", "servicediscovery:UpdateService",
          "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:PutSecretValue", "secretsmanager:RestoreSecret", "secretsmanager:RotateSecret", "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:UpdateSecret",
          "sns:CreateTopic", "sns:DeleteTopic", "sns:SetTopicAttributes", "sns:Subscribe", "sns:TagResource", "sns:Unsubscribe", "sns:UntagResource",
          "wafv2:AssociateWebACL", "wafv2:CreateWebACL", "wafv2:DeleteLoggingConfiguration", "wafv2:DeleteWebACL", "wafv2:DisassociateWebACL", "wafv2:PutLoggingConfiguration", "wafv2:TagResource", "wafv2:UntagResource", "wafv2:UpdateWebACL",
          "xray:CreateSamplingRule", "xray:DeleteSamplingRule", "xray:TagResource", "xray:UntagResource", "xray:UpdateSamplingRule",
          "elasticloadbalancing:AddTags", "elasticloadbalancing:CreateListener", "elasticloadbalancing:CreateLoadBalancer", "elasticloadbalancing:CreateRule", "elasticloadbalancing:CreateTargetGroup", "elasticloadbalancing:DeleteListener", "elasticloadbalancing:DeleteLoadBalancer", "elasticloadbalancing:DeleteRule", "elasticloadbalancing:DeleteTargetGroup", "elasticloadbalancing:ModifyLoadBalancerAttributes", "elasticloadbalancing:ModifyTargetGroup", "elasticloadbalancing:ModifyTargetGroupAttributes", "elasticloadbalancing:RemoveTags", "elasticloadbalancing:SetSecurityGroups", "elasticloadbalancing:SetSubnets",
        ]
        Resource = local.environment_resource_arns
        Condition = {
          StringEqualsIfExists = {
            "aws:RequestTag/Project"      = "ClinicOS"
            "aws:RequestTag/Environment"  = var.environment
            "aws:ResourceTag/Project"     = "ClinicOS"
            "aws:ResourceTag/Environment" = var.environment
          }
        }
      },
      {
        Sid    = "DenyUntaggedPlatformCreates"
        Effect = "Deny"
        Action = [
          "acm:RequestCertificate", "backup:CreateBackupPlan", "backup:CreateBackupVault",
          "ec2:AllocateAddress", "ec2:CreateFlowLogs", "ec2:CreateInternetGateway", "ec2:CreateNatGateway", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup", "ec2:CreateSubnet", "ec2:CreateVpc", "ec2:CreateVpcEndpoint",
          "ecr:CreateRepository", "ecs:CreateCluster", "ecs:CreateService", "ecs:RegisterTaskDefinition",
          "elasticache:CreateCacheSubnetGroup", "elasticache:CreateReplicationGroup",
          "elasticloadbalancing:CreateListener", "elasticloadbalancing:CreateLoadBalancer", "elasticloadbalancing:CreateRule", "elasticloadbalancing:CreateTargetGroup",
          "kms:CreateKey", "logs:CreateLogGroup", "rds:CreateDBInstance", "rds:CreateDBParameterGroup", "rds:CreateDBSubnetGroup",
          "secretsmanager:CreateSecret", "servicediscovery:CreatePrivateDnsNamespace", "servicediscovery:CreateService", "sns:CreateTopic", "wafv2:CreateWebACL",
        ]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:RequestTag/Environment" = var.environment
          }
        }
      },
      {
        Sid    = "MandatoryBoundaryCreateApis"
        Effect = "Allow"
        Action = [
          "acm:RequestCertificate",
          "ecs:RegisterTaskDefinition",
          "kms:CreateKey",
          "servicediscovery:CreatePrivateDnsNamespace",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestTag/Project"     = "ClinicOS"
            "aws:RequestTag/Environment" = var.environment
          }
        }
      },
      {
        Sid    = "DenyCrossEnvironmentTaggedMutations"
        Effect = "Deny"
        Action = [
          "acm:DeleteCertificate", "backup:DeleteBackupPlan", "backup:DeleteBackupVault", "backup:UpdateBackupPlan",
          "ec2:AssociateRouteTable", "ec2:AttachInternetGateway", "ec2:AuthorizeSecurityGroupEgress", "ec2:AuthorizeSecurityGroupIngress", "ec2:CreateRoute", "ec2:DeleteFlowLogs", "ec2:DeleteInternetGateway", "ec2:DeleteNatGateway", "ec2:DeleteRoute", "ec2:DeleteRouteTable", "ec2:DeleteSecurityGroup", "ec2:DeleteSubnet", "ec2:DeleteVpc", "ec2:DeleteVpcEndpoints", "ec2:DetachInternetGateway", "ec2:DisassociateRouteTable", "ec2:ModifySubnetAttribute", "ec2:ModifyVpcAttribute", "ec2:ReleaseAddress", "ec2:RevokeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress",
          "ecr:DeleteRepository", "ecr:PutLifecyclePolicy", "ecr:SetRepositoryPolicy", "ecs:DeleteCluster", "ecs:DeleteService", "ecs:UpdateService",
          "elasticache:DeleteCacheSubnetGroup", "elasticache:DeleteReplicationGroup", "elasticache:ModifyCacheSubnetGroup", "elasticache:ModifyReplicationGroup",
          "elasticloadbalancing:DeleteListener", "elasticloadbalancing:DeleteLoadBalancer", "elasticloadbalancing:DeleteRule", "elasticloadbalancing:DeleteTargetGroup", "elasticloadbalancing:ModifyLoadBalancerAttributes", "elasticloadbalancing:ModifyTargetGroup", "elasticloadbalancing:ModifyTargetGroupAttributes", "elasticloadbalancing:SetSecurityGroups", "elasticloadbalancing:SetSubnets",
          "kms:DisableKey", "kms:EnableKey", "kms:PutKeyPolicy", "kms:ScheduleKeyDeletion", "logs:DeleteLogGroup", "logs:PutRetentionPolicy",
          "rds:DeleteDBInstance", "rds:DeleteDBParameterGroup", "rds:DeleteDBSubnetGroup", "rds:ModifyDBInstance", "rds:ModifyDBParameterGroup", "rds:ModifyDBSubnetGroup",
          "secretsmanager:DeleteSecret", "secretsmanager:RestoreSecret", "secretsmanager:UpdateSecret", "servicediscovery:DeleteNamespace", "servicediscovery:DeleteService", "servicediscovery:UpdateService", "sns:DeleteTopic", "wafv2:DeleteWebACL", "wafv2:UpdateWebACL",
        ]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:ResourceTag/Environment" = var.environment
          }
        }
      },
      {
        Sid    = "EnvironmentIamRoles"
        Effect = "Allow"
        Action = [
          "iam:AttachRolePolicy", "iam:CreateRole", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:DetachRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:PassRole", "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy",
        ]
        Resource = "arn:aws:iam::${var.account_id}:role/clinicos/${local.name_prefix}/*"
      },
      {
        Sid      = "RequiredAwsServiceLinkedRoles"
        Effect   = "Allow"
        Action   = "iam:CreateServiceLinkedRole"
        Resource = "*"
        Condition = {
          StringEquals = {
            "iam:AWSServiceName" = [
              "backup.amazonaws.com",
              "ecs.amazonaws.com",
              "elasticache.amazonaws.com",
              "elasticloadbalancing.amazonaws.com",
              "rds.amazonaws.com",
            ]
          }
        }
      },
    ]
  })
}

module "ci_oidc" {
  source = "../ci-oidc"

  name_prefix              = local.name_prefix
  account_id               = var.account_id
  region                   = var.primary_region
  github_repository        = var.github.repository
  github_subject_claims    = var.github.subject_claims
  create_oidc_provider     = var.github.create_oidc_provider
  oidc_provider_arn        = try(var.github.oidc_provider_arn, null)
  oidc_thumbprints         = var.github.oidc_thumbprints
  state_bucket_name        = var.state_backend.bucket_name
  state_lock_table_name    = var.state_backend.lock_table
  state_key                = var.state_backend.state_key
  state_kms_key_arn        = var.state_backend.kms_key_arn
  ecr_repository_arns      = merge(module.ecr_primary.repository_arns, module.ecr_dr.repository_arns)
  read_policy_json         = local.read_policy
  read_actions             = local.all_read_actions
  deploy_policy_json       = local.deploy_policy
  permissions_boundary_arn = var.github.permissions_boundary_arn
  tags                     = local.tags
}
