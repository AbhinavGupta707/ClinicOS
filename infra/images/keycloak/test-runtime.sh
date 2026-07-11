#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "${1}" ]]; then
  printf 'Usage: %s <keycloak-image-ref>\n' "$0" >&2
  exit 64
fi

for executable in curl docker node; do
  if ! command -v "${executable}" >/dev/null 2>&1; then
    printf '%s is required for the Keycloak runtime smoke\n' "${executable}" >&2
    exit 69
  fi
done

root_dir="$(cd -- "$(dirname -- "$0")/../../.." && pwd)"
image_ref="$1"
postgres_image="${KEYCLOAK_SMOKE_POSTGRES_IMAGE:-postgres:16-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50}"
suffix="${GITHUB_RUN_ID:-local}-$$-${RANDOM}"
network="clinicos-keycloak-smoke-${suffix}"
postgres_container="clinicos-keycloak-postgres-${suffix}"
keycloak_container="clinicos-keycloak-runtime-${suffix}"
realm="clinic-os-staging"
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/clinicos-keycloak-runtime.XXXXXX")"
realm_path="${temporary_directory}/realm.json"
database_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
admin_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
completed=false

cleanup() {
  if [[ "${completed}" != true ]] && docker container inspect "${keycloak_container}" >/dev/null 2>&1; then
    docker logs "${keycloak_container}" >&2 || true
  fi
  docker rm -f "${keycloak_container}" "${postgres_container}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

version="$(docker run --rm "${image_ref}" --version)"
if [[ "${version}" != *"26.7.0"* ]]; then
  printf 'Unexpected Keycloak version: %s\n' "${version}" >&2
  exit 1
fi

docker run --rm --entrypoint /bin/sh "${image_ref}" -c \
  'echo "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3  /opt/clinicos/trust/aws-rds-global-bundle.pem" | sha256sum -c -' >/dev/null

set +e
bootstrap_output="$(docker run --rm "${image_ref}" /opt/clinicos/bin/bootstrap-keycloak 2>&1)"
bootstrap_status=$?
set -e
if [[ ${bootstrap_status} -ne 64 || "${bootstrap_output}" != *"KC_DB_URL is required"* ]]; then
  printf 'Keycloak bootstrap did not fail closed when required bindings were absent\n' >&2
  exit 1
fi

node "${root_dir}/infra/docker/keycloak/promotion/bind-realm.mjs" \
  --template "${root_dir}/infra/docker/keycloak/production/clinic-os-realm.template.json" \
  --binding "${root_dir}/infra/docker/keycloak/promotion/runtime-binding.example.json" \
  --out "${realm_path}"
chmod 0755 "${temporary_directory}"
chmod 0444 "${realm_path}"

docker network create "${network}" >/dev/null
docker run --detach \
  --name "${postgres_container}" \
  --network "${network}" \
  --env POSTGRES_DB=keycloak \
  --env POSTGRES_USER=keycloak \
  --env "POSTGRES_PASSWORD=${database_password}" \
  "${postgres_image}" >/dev/null

for _attempt in {1..60}; do
  if docker exec "${postgres_container}" pg_isready --quiet --username keycloak --dbname keycloak; then
    break
  fi
  sleep 1
done
docker exec "${postgres_container}" pg_isready --quiet --username keycloak --dbname keycloak

docker run --detach \
  --name "${keycloak_container}" \
  --network "${network}" \
  --volume "${realm_path}:/opt/keycloak/data/import/realm.json:ro" \
  --env KC_DB=postgres \
  --env "KC_DB_URL=jdbc:postgresql://${postgres_container}:5432/keycloak" \
  --env KC_DB_USERNAME=keycloak \
  --env "KC_DB_PASSWORD=${database_password}" \
  --env KC_HEALTH_ENABLED=true \
  --env KC_METRICS_ENABLED=true \
  --env KC_BOOTSTRAP_ADMIN_USERNAME=smoke-admin \
  --env "KC_BOOTSTRAP_ADMIN_PASSWORD=${admin_password}" \
  "${image_ref}" \
  start --optimized --import-realm --http-enabled=true \
  --hostname="http://${keycloak_container}:8080" >/dev/null

for _attempt in {1..120}; do
  if docker exec "${keycloak_container}" \
    curl --fail --silent --show-error http://127.0.0.1:9000/health/ready >/dev/null 2>&1; then
    break
  fi
  if [[ "$(docker inspect "${keycloak_container}" --format '{{.State.Running}}')" != true ]]; then
    printf 'Keycloak exited before readiness\n' >&2
    exit 1
  fi
  sleep 1
done
readiness="$(docker exec "${keycloak_container}" \
  curl --fail --silent --show-error http://127.0.0.1:9000/health/ready)"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (value.status !== "UP" || !value.checks?.every((check) => check.status === "UP")) process.exit(1);
' "${readiness}"

discovery="$(docker exec "${keycloak_container}" curl --fail --silent --show-error \
  "http://${keycloak_container}:8080/realms/${realm}/.well-known/openid-configuration")"
node -e '
  const value = JSON.parse(process.argv[1]);
  if (value.issuer !== process.argv[2]) process.exit(1);
' "${discovery}" "http://${keycloak_container}:8080/realms/${realm}"

admin_token_response="$(docker exec "${keycloak_container}" curl --fail --silent --show-error \
  --request POST \
  --data-urlencode client_id=admin-cli \
  --data-urlencode username=smoke-admin \
  --data-urlencode "password=${admin_password}" \
  --data-urlencode grant_type=password \
  "http://${keycloak_container}:8080/realms/master/protocol/openid-connect/token")"
admin_token="$(node -e '
  const value = JSON.parse(process.argv[1]);
  if (typeof value.access_token !== "string" || value.access_token.length < 100) process.exit(1);
  process.stdout.write(value.access_token);
' "${admin_token_response}")"

clients="$(docker exec "${keycloak_container}" curl --fail --silent --show-error \
  --header "Authorization: Bearer ${admin_token}" \
  "http://${keycloak_container}:8080/admin/realms/${realm}/clients?max=100")"
worker_uuid="$(node -e '
  const clients = JSON.parse(process.argv[1]);
  const expected = ["clinic-os-api", "clinic-os-mobile", "clinic-os-temporal-worker", "clinic-os-web-bff"];
  const actual = clients.map(({clientId}) => clientId).filter((id) => id.startsWith("clinic-os-")).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
  const worker = clients.find(({clientId}) => clientId === "clinic-os-temporal-worker");
  if (!worker?.id) process.exit(1);
  process.stdout.write(worker.id);
' "${clients}")"

worker_secret_response="$(docker exec "${keycloak_container}" curl --fail --silent --show-error \
  --header "Authorization: Bearer ${admin_token}" \
  "http://${keycloak_container}:8080/admin/realms/${realm}/clients/${worker_uuid}/client-secret")"
worker_secret="$(node -e '
  const value = JSON.parse(process.argv[1]);
  if (typeof value.value !== "string" || value.value.length < 16) process.exit(1);
  process.stdout.write(value.value);
' "${worker_secret_response}")"

worker_token_response="$(docker exec "${keycloak_container}" curl --fail --silent --show-error \
  --request POST \
  --data-urlencode grant_type=client_credentials \
  --data-urlencode client_id=clinic-os-temporal-worker \
  --data-urlencode "client_secret=${worker_secret}" \
  "http://${keycloak_container}:8080/realms/${realm}/protocol/openid-connect/token")"
node -e '
  const response = JSON.parse(process.argv[1]);
  const part = response.access_token?.split(".")[1];
  if (!part) process.exit(1);
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes("clinic-os-temporal")) process.exit(1);
  if (JSON.stringify(claims.permissions) !== JSON.stringify(["default:worker", "default:write"])) process.exit(1);
  if (claims.azp !== "clinic-os-temporal-worker") process.exit(1);
' "${worker_token_response}"

completed=true
printf 'Keycloak runtime smoke passed: hardened image, import, readiness, discovery, clients and worker claims\n'
