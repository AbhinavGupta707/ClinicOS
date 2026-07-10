#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

terraform -chdir="$root_dir" fmt -check -recursive

for environment in staging pilot-prod; do
  terraform -chdir="$root_dir/$environment" init -backend=false -input=false
  terraform -chdir="$root_dir/$environment" validate
  terraform -chdir="$root_dir/$environment" test -test-directory=tests
done

trivy config --skip-check-update --exit-code 1 --severity HIGH,CRITICAL "$root_dir"

for module in "$root_dir"/modules/*; do
  trivy config --skip-check-update --exit-code 1 --severity HIGH,CRITICAL "$module"
done
