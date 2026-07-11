#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: test-runtime.sh IMAGE}"

runtime_args=(
  --rm
  --network none
  --read-only
  --tmpfs /tmp:rw,noexec,nosuid,size=16m
  --entrypoint node
)

valid_output="$(docker run "${runtime_args[@]}" \
  -e AWS_REGION=ap-south-1 \
  -e CLINICOS_GUARDDUTY_BUCKET=clinicos-staging-media \
  -e 'CLINICOS_GUARDDUTY_SUPPORTED_REGIONS=["ap-south-1"]' \
  -e 'CLINICOS_GUARDDUTY_QUARANTINE_PREFIXES=["staging/tenants/"]' \
  -e CLINICOS_GUARDDUTY_OBJECT_KMS_KEY_ID=arn:aws:kms:ap-south-1:000000000000:key/11111111-1111-4111-8111-111111111111 \
  -e CLINICOS_GUARDDUTY_SIGNING_KEY_ID=arn:aws:kms:ap-south-1:000000000000:key/22222222-2222-4222-8222-222222222222 \
  -e CLINICOS_GUARDDUTY_SIGNING_ALGORITHM=RSASSA_PSS_SHA_256 \
  "$image" \
  --input-type=module \
  -e 'const m=await import("./apps/media-scanner/dist/handler.js"); if(typeof m.handler!=="function") throw new Error("missing handler"); console.log("scanner-handler-load-ok")')"
test "$valid_output" = "scanner-handler-load-ok"

if docker run "${runtime_args[@]}" "$image" \
  --input-type=module \
  -e 'await import("./apps/media-scanner/dist/handler.js")' >/dev/null 2>&1; then
  echo "media scanner accepted missing production configuration" >&2
  exit 1
fi

echo "Media scanner image loads its production dependencies and fails closed without authority."
