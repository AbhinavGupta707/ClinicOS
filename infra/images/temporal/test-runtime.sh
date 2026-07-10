#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "${1}" ]]; then
  printf 'Usage: %s <temporal-image-ref>\n' "$0" >&2
  exit 64
fi

for executable in docker grep node; do
  if ! command -v "${executable}" >/dev/null 2>&1; then
    printf '%s is required for the Temporal runtime smoke\n' "${executable}" >&2
    exit 69
  fi
done

image_ref="$1"
suffix="${GITHUB_RUN_ID:-local}-$$-${RANDOM}"
probe_container="clinicos-temporal-config-${suffix}"
database_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
runtime_environment=(
  --env DB=postgres12
  --env POSTGRES_SEEDS=postgres.example.invalid
  --env DB_PORT=5432
  --env DBNAME=temporal
  --env VISIBILITY_DBNAME=temporal_visibility
  --env POSTGRES_USER=temporal
  --env "POSTGRES_PWD=${database_password}"
  --env SQL_TLS_ENABLED=true
  --env SQL_CA=/etc/ssl/certs/aws-rds-global-bundle.pem
  --env SQL_HOST_VERIFICATION=true
  --env SQL_HOST_NAME=postgres.example.invalid
  --env TEMPORAL_TLS_REQUIRE_CLIENT_AUTH=true
  --env TEMPORAL_TLS_INTERNODE_SERVER_NAME=temporal.internal
  --env TEMPORAL_TLS_FRONTEND_SERVER_NAME=temporal.internal
  --env TEMPORAL_TLS_INTERNODE_DISABLE_HOST_VERIFICATION=false
  --env TEMPORAL_TLS_FRONTEND_DISABLE_HOST_VERIFICATION=false
  --env USE_INTERNAL_FRONTEND=true
  --env TEMPORAL_AUTH_AUTHORIZER=default
  --env TEMPORAL_AUTH_CLAIM_MAPPER=default
  --env TEMPORAL_JWT_KEY_SOURCE1=https://auth.example.invalid/realms/clinic-os/protocol/openid-connect/certs
  --env TEMPORAL_JWT_KEY_REFRESH=1m
  --env TEMPORAL_JWT_PERMISSIONS_CLAIM=permissions
  --env TEMPORAL_JWT_AUDIENCE=clinic-os-temporal
  --env TEMPORAL_CLUSTER_METADATA_RPC_ADDRESS=temporal-frontend.example.internal:7233
  --env TEMPORAL_CLUSTER_METADATA_HTTP_ADDRESS=temporal-frontend.example.internal:7243
  --env DYNAMIC_CONFIG_FILE_PATH=/etc/temporal/dynamicconfig/production.yaml
)

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  docker rm -f "${probe_container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

server_version="$(docker run --rm "${image_ref}" temporal-server --version)"
sql_tool_version="$(docker run --rm "${image_ref}" temporal-sql-tool --version)"
if [[ "${server_version}" != "temporal version 1.31.2" || "${sql_tool_version}" != "temporal-sql-tool version 1.31.2" ]]; then
  printf 'Temporal image contains unexpected binary versions\n' >&2
  exit 1
fi

docker run --rm "${image_ref}" sh -c \
  'echo "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3  /etc/ssl/certs/aws-rds-global-bundle.pem" | sha256sum -c -' >/dev/null

set +e
migration_output="$(docker run --rm "${image_ref}" /opt/clinicos/bin/migrate-temporal 2>&1)"
migration_status=$?
set -e
if [[ ${migration_status} -ne 64 || "${migration_output}" != *"POSTGRES_SEEDS is required"* ]]; then
  printf 'Temporal schema task did not fail closed without database bindings\n' >&2
  exit 1
fi

docker run --rm "${image_ref}" temporal-server validate-dynamic-config \
  /etc/temporal/dynamicconfig/production.yaml >/dev/null

rendered_config="$(docker run --rm "${runtime_environment[@]}" "${image_ref}" \
  temporal-server -c /etc/temporal/config -e production render-config)"
for expected in \
  'audience: clinic-os-temporal' \
  'authorizer: default' \
  'claimMapper: default' \
  'permissionsClaimName: permissions' \
  'https://auth.example.invalid/realms/clinic-os/protocol/openid-connect/certs' \
  'enableHostVerification: true' \
  'serverName: postgres.example.invalid' \
  'caFile: /etc/ssl/certs/aws-rds-global-bundle.pem' \
  'rpcAddress: temporal-frontend.example.internal:7233'; do
  if ! grep --fixed-strings --quiet "${expected}" <<<"${rendered_config}"; then
    printf 'Rendered Temporal config is missing: %s\n' "${expected}" >&2
    exit 1
  fi
done

start_probe="$(docker run --rm \
  --env TEMPORAL_BROADCAST_ADDRESS=10.123.45.67 \
  "${image_ref}" /opt/clinicos/bin/start-temporal --help)"
if [[ "${start_probe}" != *"Temporal server"* ]]; then
  printf 'Temporal task-address wrapper did not delegate to the server\n' >&2
  exit 1
fi

docker run --detach \
  --name "${probe_container}" \
  --network none \
  "${runtime_environment[@]}" \
  --env TEMPORAL_SERVER_CONFIG_FILE_PATH=/etc/temporal/config/production.yaml \
  --env TEMPORAL_BROADCAST_ADDRESS=10.123.45.67 \
  "${image_ref}" /opt/clinicos/bin/start-temporal --service=frontend >/dev/null
for _attempt in {1..10}; do
  probe_logs="$(docker logs "${probe_container}" 2>&1 || true)"
  if grep --fixed-strings --quiet 'Processing config file as template; filename=production.yaml' <<<"${probe_logs}"; then
    printf 'Temporal runtime smoke passed: binaries, schema guard, config validation, auth/TLS render and ECS start path\n'
    exit 0
  fi
  sleep 1
done

docker logs "${probe_container}" >&2 || true
printf 'Temporal ECS start path did not load the production config template\n' >&2
exit 1
