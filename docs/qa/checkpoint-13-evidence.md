# Checkpoint 13 E3 Evidence — Durable Clinic Day

## Decision

- Result: **PASS at E3 durable-local scope**.
- Launch base: `c3802b73e135246d56d12efc9ab399ecd6f47fde` (verified CP12 `main`).
- Verified integration candidate: `b2283ee459998f1d353e56d786d8b58adf0c8aaf`.
- Promotion merge: `aa2a12e16ccbf4e1afabd96b8e7c6acbce368010` on `main`.
- Post-promotion: exact integration/main tree equivalence, `npm run check`, `git diff --check`, and
  durable `db:verify` all pass.
- Release decision: **NO-GO** for pilot/production. CP14-CP18 cloud, production session, official
  provider, media, device, restore/failover, security-operations, and real-clinic gates remain open.

All runtime data was deterministic synthetic data. No real PHI, production account, provider
credential, cloud mutation, or remote push was used.

## E3 runtime evidence

| Evidence ID | Proof | Result |
| --- | --- | --- |
| CP13-E3-BASE-001 | `main`/launch-base and clean integration-branch verification | Pass at `c3802b73` |
| CP13-E3-MIGRATE-002 | Empty `clinic_os` database; canonical Flyway options; migrations 001-017 | Pass; 17/17 applied from zero |
| CP13-E3-RLS-003 | `node scripts/db-local-lifecycle.mjs verify` before and after runtime smokes | Pass; 100/100 tenant tables forced RLS, no-context rows 0, cross-tenant isolation pass |
| CP13-E3-ROLES-004 | Migrator/runtime/worker role and privilege matrix | Pass; worker activity grants least-privilege; patient and API idempotency access denied |
| CP13-E3-MIGRATION-005 | Concurrent Flyway runners, checksum drift rejection, failed-migration rollback | Pass using approved local Flyway 12.11 fallback because Docker storage was unhealthy |
| CP13-E3-SMOKE-A-006 | Full `cp13:smoke:api` on clean-origin Postgres/Redis/Temporal | Pass; runtime IDs; fixture fallback false |
| CP13-E3-SMOKE-B-007 | Same full smoke repeated against the same durable state | Pass with independent runtime IDs and repeat-safe fixtures |
| CP13-E3-RECOVERY-008 | `cp13:test:workflow-recovery` | Pass: crash-after-commit, stale lease, duplicate delivery, worker restart, Temporal replay |
| CP13-E3-RECONCILE-009 | Direct database evidence in both smokes | Pass: media receipt, payment reconciliation/audit/outbox, prescription outbox, payment and continuity recovery each present exactly for the run |
| CP13-E3-FLYWAY-010 | Final `validate`, `info`, and second `migrate` | Pass; schema 017 and no migration necessary |
| CP13-E3-NO-OVERLAP-011 | API run with pg deprecation tracing after transaction-port serialization | Pass; repeated smoke emitted no overlapping `client.query` warning |

Each full CP13 smoke also runs the CP11 clinic-day chain twice and proves independent lead,
patient, appointment, encounter, treatment, invoice, and provider-state IDs. The CP13 portion adds
intake, reviewed dental finding, doctor prescription signature, mediated media receipt with honest
`pending` inspection, accepted-plan invoice creation, durable payment-request recovery, signed
simulator webhook replay/overpayment reconciliation, recall generation/action, SOP, lab,
inventory, incident/CAPA, consent revocation, PHI-safe owner analytics, and the accountant/assistant
clinical negative matrix.

The Temporal recovery result created exactly one payment request and reported
`crashAfterCommit`, `staleLeaseRecovered`, `duplicateDeliveryProcessed`, `workerRestarted`, and
`replayHistoryPassed` as true. Observational outbox events remained unclaimed.

## Deterministic and rendered gates

| Gate | Result |
| --- | --- |
| `npm run check` | Pass; 15 production TypeScript workspaces, 17 contiguous migrations |
| Clock guard | Pass; 37 explicitly owned current-time call sites |
| Root typecheck | Pass |
| Root lint | Pass |
| Root test | Pass across every workspace, zero skips |
| API | 123/123 pass, zero skips |
| Database | 93/93 pass, zero skips |
| Web | 86/86 pass, zero skips |
| Worker | 16/16 pass, zero skips |
| Workflow | 10/10 pass, zero skips, including deterministic Temporal bundle |
| Contracts/client | 27/27 and 7/7 pass |
| Root build | Pass, including Expo web export and Next production build |
| OpenAPI/client drift | Pass; 128 registered routes covered |
| Native route inventory | Pass; 128 operations match |
| Enabled Playwright | 4/4 pass, zero skips |
| `git diff --check` | Pass |
| Release-scope secret scan | Pass; user research excluded and untouched |
| CycloneDX SBOM | Pass; 1.5, root `ClinicOS`, 756 production components |

The in-app Browser was unavailable with `no Codex IAB backends discovered`; the executed
Playwright fallback is documented in `docs/qa/cp13-lanes/web-runtime.md`.

## Security and supply-chain truth

- The lockfile is unchanged. The user-provided registry-audit transcript for that lockfile reports
  21 moderate advisories and zero high/critical advisories. No `--force` remediation was run.
- A fresh registry audit from this managed execution environment was rejected because it would
  disclose dependency inventory externally. The rejection is recorded; no workaround was used.
- Secret scan, strict request/response contracts, mass-assignment corpus, tenant/role/consent
  negatives, provider signature/replay checks, private-media-field filtering, and SBOM generation
  passed locally.

## Accepted limitations, not CP13 failures

- Local pending media inspection never claims content is clean. Production object storage and
  scanner/quarantine activation remain PRR-009/CP14.
- The web token provider is registration-only and fail-closed. Production BFF/session, MFA,
  revocation, and key rotation remain PRR-016/CP14.
- Provider evidence is signed local simulator E3, not official Razorpay/WhatsApp sandbox or
  production activation; CP15 owns that evidence.
- Docker Desktop's data disk was unhealthy, so the approved Homebrew PostgreSQL/Redis/Temporal and
  official Flyway binaries provided isolated local E3. This does not substitute for CP14 cloud,
  container, staging, restore, or failover evidence.
