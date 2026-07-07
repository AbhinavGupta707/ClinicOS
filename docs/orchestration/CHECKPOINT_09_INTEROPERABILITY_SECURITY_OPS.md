# Checkpoint 9 - Interoperability, Security, Privacy, And Operations Hardening

- Launch date: 2026-07-07
- Launch base: `0dc9f91`
- Source plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md` section 17
- Integration branch: `codex/integration/checkpoint-9`

## Outcome

ClinicOS has production-grade compliance, interoperability, and operations-hardening foundations: FHIR-ready exports, ABDM readiness without making ABDM a day-one dependency, patient record export, audit/privacy workflows, retention/deletion jobs, backup/restore runbooks, alerting checks, and performance/tenant-isolation regression evidence.

## Credential And Input Preflight

`.secrets/orchestration.env` is present and ignored by Git. Values must not be printed or committed.

- AWS local profile, primary region, DR region, Terraform state bucket, and lock table variable names are present. Infrastructure work may create plan/runbook artifacts, but must not apply production infrastructure without explicit approval.
- ABDM variable names are present but currently empty. ABDM must remain feature-gated and simulator/fixture-only; do not call live ABDM endpoints or present ABDM exchange as active.
- Pilot export path variables are present and `PILOT_SYNTHETIC_DATA_ONLY` is configured. Use synthetic or explicitly approved test exports only.
- Provider/live credential posture from prior checkpoints still applies: official APIs, signed webhooks, authorized exports/imports, or clinic-approved manual workflows only.

## Lane Ownership

| Lane | Ownership | Forbidden/shared policy | Required verification |
| --- | --- | --- | --- |
| Security/Privacy | CP9 migration ownership for audit review, data export, retention/deletion, break-glass request/review, privacy events, permissions, API operations/routes, security redaction tests, minimal audit/export web surface if needed | Own the only CP9 migration unless master explicitly reconciles another lane proposal. May edit `packages/domain/**`, `packages/db/**`, `packages/security/**`, `apps/api/**`, and narrow `apps/web/**` for audit/export/break-glass surfaces. Do not weaken existing role permissions, PHI redaction, audit immutability, or consent enforcement. | `npm --workspace @clinic-os/domain test`, `npm --workspace @clinic-os/security test`, `npm --workspace @clinic-os/db test`, `npm --workspace @clinic-os/api test`, relevant web tests if edited, retention/export/break-glass unit tests |
| FHIR/ABDM | FHIR R4 projection package, patient/encounter/document bundles, synthetic FHIR fixtures, ABDM readiness model, ABHA/care-context/consent fields behind feature flags, API/export contract tests | May add `packages/fhir/**`, FHIR fixtures, API/domain projection helpers, docs. Do not make ABDM required for clinic workflows. Do not edit CP9 migration directly unless coordinated; propose required fields in handoff for Security/Privacy/master reconciliation. No live ABDM calls. | FHIR projection tests, sample bundle validation against local structural rules/fixtures, ABDM no-credentials feature-gate tests, `npm run build:shared` if package metadata changes |
| Infrastructure/Ops | Terraform pilot-prod profile hardening, backup/restore drill artifacts, alerting/provider-health monitoring runbooks, DR notes, restore smoke script using synthetic data | May edit `infra/**`, `.env.example`, `packages/config/**`, `packages/observability/**`, scripts/docs for backup/restore and alert drills. Do not apply Terraform or print secrets. Do not create live cloud resources. | `npm run check`, config/env tests, Terraform formatting/validation where tooling is available, restore-drill script dry-run with synthetic data, runbook checks |
| Performance/QA | Load smoke, clinic-hours concurrency checks, tenant isolation regression suite, CP9 fixture validation, E2E regression harness, performance threshold docs | May edit `fixtures/synthetic/cp9/**`, `scripts/*cp9*`, `tests/acceptance/**`, `tests/e2e/**`, QA docs. Coordinate route names with Security/Privacy and FHIR/ABDM. Do not lower product safety checks to meet performance thresholds. | CP9 fixture validator, CP9 contract smoke dry-run, tenant isolation regression, load smoke with explicit threshold, browser smoke for implemented CP9 web surfaces and 390px reachability if UI is added |

## Visible Worktree Lanes

| Lane | Pending Worktree ID | Thread ID | Worktree |
| --- | --- | --- | --- |
| Security/Privacy | `local:8e4b76f0-2035-4afa-8a47-d65138239c7a` | `019f3cec-36fc-7390-a841-bf11cb1a669c` | `/Users/abhinavgupta/.codex/worktrees/6d89/ClinicOS` |
| FHIR/ABDM | `local:980187fa-bbd5-4364-86b2-511e38068b73` | `019f3cec-83b6-7383-81f5-e14f267d2392` | `/Users/abhinavgupta/.codex/worktrees/1238/ClinicOS` |
| Infrastructure/Ops | `local:7bab86b2-b4af-4585-91bd-187a2939d141` | `019f3cec-d3a3-7a71-ba13-ab7ceaf09f69` | `/Users/abhinavgupta/.codex/worktrees/7e8c/ClinicOS` |
| Performance/QA | `local:2aea50c5-e05d-4e0b-a16d-5f5ec6852393` | `019f3ced-1911-78e1-9301-ce5df9e8e934` | `/Users/abhinavgupta/.codex/worktrees/1091/ClinicOS` |

All four worktrees resolved at base commit `6697df4`.

## Shared-File Policy

- Security/Privacy owns the canonical CP9 migration and permission/audit taxonomy updates.
- FHIR/ABDM may add package manifests; master reconciles any root lockfile changes after package manifests stabilize.
- Infrastructure/Ops may update env schema/examples only for CP9 operational configuration; it must not add real secrets.
- Performance/QA owns fixture and smoke harnesses, but live route assumptions must be reconciled with implementation lanes before closeout.
- Browser/mobile smoke remains required for any implemented web/mobile surface, but final visual polish is deferred unless safety, reachability, overflow, or honest-state invariants fail.

## Expected Product Behaviors

- Patient record export includes configured patient records, selected clinical/billing/media references, and export audit trail without leaking raw storage paths or unrelated tenant data.
- Audit review supports authorized users reviewing sensitive actions, export/deletion requests, AI processing, media access, provider events, and break-glass access evidence.
- Break-glass access requires reason, scope, expiry, prominent audit evidence, and owner/admin review; it must not silently grant permanent access.
- Retention/deletion jobs are auditable, conservative, tenant-scoped, and never delete protected clinical/audit records outside configured policy.
- FHIR exports project existing ClinicOS domain records into FHIR R4-shaped bundles for patient/encounter/document evidence while preserving ClinicOS as the system of record.
- ABDM/ABHA fields and care-context/consent logs stay optional and feature-gated until sandbox credentials and compliance decisions exist.
- Backup/restore and DR evidence uses synthetic data and dry-run/plan artifacts unless the user explicitly approves live infrastructure actions.
- Performance/load smokes document thresholds, concurrency shape, and tenant isolation; they must fail honestly when the environment cannot support a live run.

## Accepted Non-Goals

- No live ABDM sandbox/API calls until credentials and legal/compliance activation decisions exist.
- No Terraform apply, production resource creation, or cloud mutation without explicit user approval.
- No production PHI in local/dev/staging fixtures, load tests, backups, or screenshots.
- No final UI design pass beyond safety, responsive reachability, and honest unavailable/error states.
- No deletion of immutable audit logs or legally required clinical records; retention jobs may mark requests, redact eligible transient payloads, or prepare execution evidence according to policy.

## Merge Order

Security/Privacy -> FHIR/ABDM -> Infrastructure/Ops -> Performance/QA -> master integration patch.
