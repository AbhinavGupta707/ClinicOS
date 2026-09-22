#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <server-image> <worker-image>" >&2; exit 64; }
# This runner owns new, randomly named resources. It never uses the compose stack.
root_dir="$(cd -- "$(dirname -- "$0")/../../.." && pwd)"
suffix="${GITHUB_RUN_ID:-local}-$$-${RANDOM}"
network="clinicos-temporal-acceptance-${suffix}"
postgres="clinicos-temporal-db-${suffix}"
server="clinicos-temporal-server-${suffix}"
probe="clinicos-temporal-sdk-${suffix}"
directory="$(mktemp -d "${TMPDIR:-/tmp}/clinicos-temporal-acceptance.XXXXXX")"
password="$(openssl rand -hex 24)"
completed=false
cleanup() {
  if [[ "${completed}" != true ]]; then docker logs "${server}" >&2 2>/dev/null || true; fi
  docker rm -fv "${probe}" "${server}" "${postgres}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${directory}"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=${postgres}" \
  -addext "subjectAltName=DNS:${postgres}" -addext "basicConstraints=critical,CA:TRUE" \
  -keyout "${directory}/server.key" -out "${directory}/server.crt" >/dev/null 2>&1
chmod 0755 "${directory}"
chmod 0444 "${directory}/server.crt"
chmod 0600 "${directory}/server.key"
docker network create --internal "${network}" >/dev/null
docker run --detach --name "${postgres}" --network "${network}" \
  --volume "${directory}:/certs:ro" --env POSTGRES_USER=smoke_admin \
  --env "POSTGRES_PASSWORD=${password}" --entrypoint /bin/sh \
  postgres:16-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50 \
  -c 'cp /certs/server.key /tmp/server.key; chown postgres /tmp/server.key; chmod 0600 /tmp/server.key; exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/tmp/server.key' >/dev/null
for _attempt in {1..60}; do
  if docker exec "${postgres}" pg_isready -q -U smoke_admin; then break; fi
  sleep 1
done
docker exec "${postgres}" pg_isready -q -U smoke_admin

database_environment=(
  --network "${network}"
  --volume "${directory}/server.crt:/etc/ssl/certs/aws-rds-global-bundle.pem:ro"
  --env DB=postgres12 --env "POSTGRES_SEEDS=${postgres}" --env DB_PORT=5432
  --env DBNAME=temporal --env VISIBILITY_DBNAME=temporal_visibility
  --env SQL_TLS_ENABLED=true --env SQL_HOST_VERIFICATION=true
  --env "SQL_HOST_NAME=${postgres}" --env SQL_CA=/etc/ssl/certs/aws-rds-global-bundle.pem
)
for _pass in 1 2; do
  docker run --rm "${database_environment[@]}" \
    --env MASTER_POSTGRES_USER=smoke_admin --env "MASTER_POSTGRES_PWD=${password}" \
    --env TEMPORAL_POSTGRES_USER=temporal --env "TEMPORAL_POSTGRES_PWD=${password}" \
    "$1" /opt/clinicos/bin/migrate-temporal
done
for database in temporal temporal_visibility; do
  version="$(docker exec "${postgres}" psql -U smoke_admin -d "${database}" -Atc 'select curr_version from schema_version')"
  [[ -n "${version}" ]] || { echo "Missing ${database} schema version" >&2; exit 1; }
  printf 'Verified %s schema version %s after two migration passes\n' "${database}" "${version}"
done

docker run --detach --name "${server}" "${database_environment[@]}" \
  --env POSTGRES_USER=temporal --env "POSTGRES_PWD=${password}" \
  --env TEMPORAL_SERVER_CONFIG_FILE_PATH=/etc/temporal/config/production.yaml \
  --env DYNAMIC_CONFIG_FILE_PATH=/etc/temporal/dynamicconfig/production.yaml \
  --entrypoint /bin/sh "$1" \
  -c 'export TEMPORAL_BROADCAST_ADDRESS="$(hostname -i)"; exec /opt/clinicos/bin/start-temporal' >/dev/null

# The private-network SDK smoke uses synthetic activities; no clinic/provider calls.
docker run --rm --name "${probe}" --network "${network}" \
  --volume "${root_dir}/infra/images/temporal/test-sdk.mjs:/workspace/apps/worker/test-sdk.mjs:ro" \
  --volume "${root_dir}/infra/images/temporal/test-workflows.cjs:/workspace/apps/worker/test-workflows.cjs:ro" \
  --entrypoint /nodejs/bin/node "$2" /workspace/apps/worker/test-sdk.mjs "${server}:7233"
completed=true
printf 'Temporal integration passed: verified PostgreSQL TLS, both schemas migrated twice, SDK workflow/activity execution and replay\n'
