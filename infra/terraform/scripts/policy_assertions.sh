#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "policy assertion failed: $1" >&2
  exit 1
}

require() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  rg -q "$pattern" "$file" || fail "$message"
}

reject() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  if rg -q "$pattern" "$file"; then
    fail "$message"
  fi
}

ci="$root_dir/modules/ci-oidc/main.tf"
platform="$root_dir/modules/platform/main.tf"
endpoints="$root_dir/modules/vpc-endpoints/main.tf"
database="$root_dir/modules/database/main.tf"
compute="$root_dir/modules/compute/main.tf"
pilot="$root_dir/pilot-prod/main.tf"
baseline="$root_dir/modules/account-baseline/main.tf"
admin_ingress="$root_dir/modules/admin-ingress/main.tf"

reject 'ReadOnlyAccess' "$ci" "GitHub OIDC roles must not attach AWS managed ReadOnlyAccess"
require 'sensitive_read_exclusion' "$ci" "CI discovery policy must assert sensitive read exclusions"
require 'mandatory_permissions_boundary' "$ci" "CI roles must require the account permissions boundary"
require 'state_kms_key_arn' "$ci" "CI state access must be scoped to the dedicated state CMK"

lifecycle_policy="$(sed -n '/Sid    = "PlatformResourceLifecycle"/,/Sid    = "DenyUntaggedPlatformCreates"/p' "$platform")"
if rg -q 'Resource[[:space:]]*=[[:space:]]*"\*"' <<<"$lifecycle_policy"; then
  fail "environment platform lifecycle permissions must use scoped ARNs, not root Resource=star"
fi
require 'StringEqualsIfExists' "$platform" "platform lifecycle policy must carry request/resource tag scoping"
require 'DenyUntaggedPlatformCreates' "$platform" "tag-capable creates must fail without ClinicOS request tags"
require 'DenyCrossEnvironmentTaggedMutations' "$platform" "tag-capable mutations must deny cross-environment resources"
require 'MandatoryBoundaryCreateApis' "$platform" "unscopable create APIs must be isolated behind the mandatory boundary and request tags"
read_policy="$(sed -n '/read_policy = jsonencode/,/deploy_policy = jsonencode/p' "$platform")"
if rg -q '"s3:GetObject"' <<<"$read_policy"; then
  fail "general Terraform discovery must not read object bodies"
fi
if rg -q '"secretsmanager:GetSecretValue"' <<<"$read_policy"; then
  fail "general Terraform discovery must not read secret values"
fi

require 'policy[[:space:]]*=[[:space:]]*local.s3_policy' "$endpoints" "S3 endpoint must have an explicit policy"
require 'policy[[:space:]]*=[[:space:]]*each.value' "$endpoints" "every interface endpoint must have an explicit policy"
require 'referenced_security_group_id[[:space:]]*=[[:space:]]*var.source_security_group_id' "$endpoints" "endpoint ingress must reference the workload security group"
reject '"s3:\*"' "$endpoints" "S3 endpoint policy must enumerate actions"
reject 'secret:\*' "$endpoints" "Secrets Manager endpoint policy must enumerate declared secret ARNs"

require 'monitoring_interval[[:space:]]*=[[:space:]]*var.enhanced_monitoring_interval_seconds' "$database" "RDS Enhanced Monitoring must not be disabled"
require 'monitoring_role_arn[[:space:]]*=[[:space:]]*aws_iam_role.enhanced_monitoring.arn' "$database" "RDS must use the scoped monitoring role"
reject 'monitoring_interval[[:space:]]*=[[:space:]]*0' "$database" "RDS Enhanced Monitoring interval cannot be zero"

require 'user[[:space:]]*=[[:space:]]*each.value.user' "$compute" "every primary container must use its explicit numeric UID"
require 'privileged[[:space:]]*=[[:space:]]*false' "$compute" "Fargate containers must be explicitly unprivileged"
require 'drop[[:space:]]*=[[:space:]]*\["ALL"\]' "$compute" "Fargate containers must drop all Linux capabilities"
require 'enable_execute_command[[:space:]]*=[[:space:]]*false' "$compute" "ECS Exec must remain disabled"
require 'runtime_admin_ingress' "$root_dir/staging/main.tf" "staging runtime must fail closed without separate Keycloak admin ingress"
require 'runtime_admin_ingress' "$pilot" "pilot runtime must fail closed without separate Keycloak admin ingress"
require 'KC_HOSTNAME_ADMIN' "$platform" "Keycloak must bind a distinct admin hostname"
require 'KC_HOSTNAME_BACKCHANNEL_DYNAMIC' "$platform" "Keycloak backchannel binding must be fail closed"
require 'KC_DB_TLS_MODE[[:space:]]*=[[:space:]]*"verify-server"' "$platform" "Keycloak database connections must verify the RDS server identity"
require '57800.*7800|7800.*57800' "$platform" "Keycloak clustering ports must be self-only workload ports"
require 'CLINIC_OS_ENV[[:space:]]*=[[:space:]]*var.environment' "$platform" "application tasks must receive the real production-like environment"
require 'PORT[[:space:]]*=[[:space:]]*"4100"' "$platform" "API listener must match its ECS target and health-check port"
require 'WORKER_HEALTH_PORT[[:space:]]*=[[:space:]]*"3001"' "$platform" "worker health listener must match its ECS health check port"
require 'CLINIC_OS_ABUSE_BUDGET_KEY_SECRET' "$platform" "API and worker must receive the production abuse/cursor signing key"
require 'CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET' "$platform" "API must receive a distinct token-revocation key"
require 'DYNAMIC_CONFIG_FILE_PATH.*production.yaml' "$platform" "Temporal must use the versioned production dynamic configuration"
require 'TEMPORAL_TLS_REQUIRE_CLIENT_AUTH.*true' "$platform" "Temporal frontend and internode services must require client authentication"
require 'TEMPORAL_TLS_CLIENT_CERT' "$platform" "ClinicOS workers must receive a dedicated Temporal client certificate"
require 'SQL_HOST_VERIFICATION.*true' "$platform" "Temporal PostgreSQL connections must verify the RDS hostname"
require 'SQL_CA.*aws-rds-global-bundle.pem' "$platform" "Temporal must verify PostgreSQL against the pinned AWS RDS CA bundle"
require 'start-temporal' "$platform" "Temporal ECS tasks must derive and advertise their routable task address"
require 'TEMPORAL_CLUSTER_METADATA_RPC_ADDRESS.*temporal-frontend' "$platform" "Temporal cluster metadata must not advertise loopback"
require 'TEMPORAL_TLS_FRONTEND_CERT_DATA' "$platform" "Temporal frontend must receive its TLS server certificate"
require 'TEMPORAL_AUTH_AUTHORIZER.*default' "$platform" "Temporal must use its default authorizer rather than allow-no-auth"
require 'TEMPORAL_AUTH_CLAIM_MAPPER.*default' "$platform" "Temporal must validate JWT permissions through the default claim mapper"
require 'TEMPORAL_JWT_AUDIENCE.*clinic-os-temporal' "$platform" "Temporal must reject tokens without the dedicated audience"
require 'TEMPORAL_AUTH_CLIENT_SECRET' "$platform" "ClinicOS workers must use a dedicated OAuth client credential"
require 'TEMPORAL_AUTH_TOKEN_URL.*var.ingress.auth_hostname' "$platform" "Temporal worker OAuth must use the authentication plane, not the operator-only admin plane"
require 'TEMPORAL_JWT_KEY_SOURCE1.*var.ingress.auth_hostname' "$platform" "Temporal JWKS refresh must use the canonical authentication issuer"
require 'USE_INTERNAL_FRONTEND.*true' "$platform" "Temporal system workers must use the authenticated internal frontend"
reject 'TEMPORAL_ALLOW_NO_AUTH' "$platform" "Production Temporal must never bypass authorization"
require 'internal[[:space:]]*=[[:space:]]*true' "$admin_ingress" "Keycloak admin ALB must be internal"
require 'allowed_operator_cidrs' "$admin_ingress" "Keycloak admin ingress must use explicit operator CIDRs"

require 'keycloak.*desired_count = 3, minimum_count = 3' "$pilot" "pilot Keycloak must start at three replicas"
require 'audit_compliance_authorization' "$pilot" "pilot COMPLIANCE retention must have a named authorization check"

for backend in "$root_dir/staging/backend.hcl.example" "$root_dir/pilot-prod/backend.hcl.example" "$root_dir/account-baseline/backend.hcl.example"; do
  require 'kms_key_id' "$backend" "every remote backend example must require the dedicated CMK"
done

require 'is_multi_region_trail[[:space:]]*=[[:space:]]*true' "$baseline" "account CloudTrail must be multi-region"
require 'enable_log_file_validation[[:space:]]*=[[:space:]]*true' "$baseline" "CloudTrail log validation must be enabled"
require 'AWS::S3::Object' "$baseline" "CloudTrail must support exact S3 object data-event selectors"
require 'cloudtrail_s3_object_arns' "$root_dir/account-baseline/variables.tf" "S3 data-event scopes must be explicit baseline inputs"
require 'default[[:space:]]*=[[:space:]]*\[\]' "$root_dir/account-baseline/variables.tf" "S3 data-event scopes must default empty"
reject 'aws_organizations_' "$root_dir/account-baseline" "standalone account baseline must never create AWS Organizations resources"

echo "Terraform policy assertions passed."
