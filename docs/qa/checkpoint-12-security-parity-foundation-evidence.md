# CP12 Security Pipeline And Legacy Parity Foundation Evidence

## Evidence metadata

```yaml
evidence_id: CP12-E1-SECURITY-PARITY-FOUNDATION-20260710-001
checkpoint: CP12
lane: security-pipeline-and-legacy-parity-foundation
findings: [PRR-012, PRR-017, PRR-028]
threats: [T01, T02, T06, T21, T24]
base_revision: 1166baa7a816b614d896cf267066f31f40eac142
result_revision: lane commit recorded in worker handoff; self-reference is not possible inside the commit
tier: E1
environment: local-codex-worktree-synthetic-only
data: deterministic-synthetic-no-real-phi
executed_at_utc: 2026-07-10T00:18:36Z
clinic_timezone: Asia/Kolkata
clinic_local_time: 2026-07-10T05:48:36+0530
node: 22.22.2
npm: 10.9.7
operator: CP12 Security Pipeline worker
reviewer: master integration review pending
release_decision: unchanged-NO-GO
skips: 0
valid_until: invalidated-by-auth-security-route-registration-or-native-router-change
```

The worktree did not contain its own installed dependencies. Verification used the existing
read-only dependency installation from the primary ClinicOS checkout through a temporary local
`node_modules` symlink. No install ran, and no manifest or lockfile changed. The symlink is removed
before commit/handoff.

## Result

The lane established and tested framework-neutral security contracts and a complete current-route
inventory. It did not wire them into `apps/api/**` and therefore does not claim CP12 completion,
durable API parity, distributed rate limiting or production readiness.

| Evidence               | Command                                             | Result                        | Skips / limitations                                                               |
| ---------------------- | --------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| CP12-E1-AUTH-001       | `npm --workspace @clinic-os/auth run typecheck`     | PASS: real TypeScript compile | package source only                                                               |
| CP12-E1-AUTH-002       | `npm --workspace @clinic-os/auth test`              | PASS: 10 tests                | deterministic identity snapshots; no live Keycloak/session lifecycle              |
| CP12-E1-SECURITY-003   | `npm --workspace @clinic-os/security run typecheck` | PASS: real TypeScript compile | package source only                                                               |
| CP12-E1-SECURITY-004   | `npm --workspace @clinic-os/security test`          | PASS: 25 tests                | atomic budget store is a deterministic test double behind the production contract |
| CP12-E1-ACCEPTANCE-005 | `node --test tests/acceptance/cp12/*.test.mjs`      | PASS: 10 tests                | static inventory and isolated contract evidence; no API product wiring            |
| CP12-E1-DIFF-006       | `git diff --check`                                  | PASS                          | repeated after final evidence edit before commit                                  |
| CP12-E1-SECRETS-007    | `npm run security:secrets`                          | PASS                          | release-scope tracked/untracked files; user research excluded                     |

## Covered assertions

- active tenant/user/membership/clinic state and verified-user snapshot filtering;
- actor/tenant/clinic derivation from verified identity state rather than request authority fields;
- assistant/accountant/auditor role denial plus cross-tenant and cross-clinic matrices;
- unknown-field, mass-assignment and prototype-pollution corpus;
- malformed JSON, body byte, query cardinality/bytes/duplicates, pagination and cursor limits;
- atomic rate and expensive-operation budgets, opaque HMAC keys, `429` and `Retry-After`;
- validated/generated request IDs with safe provenance and no raw request data in audit metadata;
- stable `400`/`401`/`403`/`409`/`413`/`422`/`429` mappings;
- generic unknown errors and bounded PHI/secret/token/stack/SQL diagnostic redaction;
- exact 128-route inventory and handler-permission-source coverage with all current native routes
  honestly non-compliant;
- a zero-skip parity harness that fails on success/body/status drift and permits only documented
  `400`→`400` code normalization, `400`→`422`, and `400`→`413` hardening transitions.

## Artifacts

- `tests/acceptance/cp12/current-route-control-inventory.mjs`
- `tests/acceptance/cp12/route-inventory.test.mjs`
- `tests/acceptance/cp12/legacy-parity-harness.mjs`
- `tests/acceptance/cp12/legacy-parity-harness.test.mjs`
- `tests/acceptance/cp12/security-foundation.test.mjs`
- `docs/security/checkpoint-12-route-control-inventory.md`
- `docs/security/checkpoint-12-security-foundation-delta.md`

## Open evidence and integration gates

- The API framework/native strangler consumer must register and enforce one route policy per
  inventory key. Until then, all 128 routes remain outside the new pipeline.
- Lane A runtime schemas/generated contracts must be consumed rather than duplicated.
- A production distributed atomic budget store, edge/WAF limits, concurrency limits and abuse/load
  evidence remain open.
- Route-by-route native-versus-modular execution, success body parity, response schemas and live
  API status/error transitions remain for integration.
- CP11 E3 clocks, readiness, RLS, database roles, runtime-ID smoke and atomic unit-of-work gates must
  be rerun after API wiring.
- No E3/E4 Keycloak, provider, cloud, alert, restore, physical-device, real-clinic or real-PHI
  evidence was attempted or claimed.
