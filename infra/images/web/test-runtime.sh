#!/usr/bin/env bash
set -euo pipefail

# This starts only the candidate web image in a disposable CI job, without a
# network, host mounts, provider credentials, database or identity activation.
test "${GITHUB_ACTIONS:-}" = true
image="${1:?usage: test-runtime.sh IMAGE}"
container="clinicos-web-smoke-${GITHUB_RUN_ID}-$$-${RANDOM}"
cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run --detach --name "${container}" --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --env CLINICOS_STAFF_SIGN_IN_ENABLED=false "${image}" >/dev/null
docker exec "${container}" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { setTimeout as delay } from "node:timers/promises";
  let response;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { response = await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(1000) }); }
    catch { await delay(500); continue; }
    break;
  }
  assert.equal(response?.status, 200, "Packaged web entrypoint must serve generated output.");
  assert.match(await response.text(), /ClinicOS/);
  const health = await fetch("http://127.0.0.1:3000/auth/health");
  assert.equal(health.status, 503);
  assert.equal((await health.json()).error.code, "IDENTITY_UNAVAILABLE");
  assert.match(health.headers.get("cache-control"), /no-store/);
  console.log("Packaged web serves generated output and keeps unconfigured identity unavailable.");
'
docker stop --time 40 "${container}" >/dev/null
test "$(docker inspect "${container}" --format '{{.State.ExitCode}}')" = 0
