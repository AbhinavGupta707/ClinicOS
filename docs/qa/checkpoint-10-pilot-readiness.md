# Checkpoint 10 Pilot Readiness QA Notes

> **Historical CP10 model (superseded 2026-07-09):** This document is E1/E2 fixture/readiness-status evidence, not current pilot readiness. Current go/no-go truth is the production remediation register and active pilot-production checklist; the decision remains **NO-GO**.

Date: 2026-07-07

## Scope

This lane adds the CP10 pilot configuration readiness contract and owner-facing readiness surface.

Implemented evidence:

- Synthetic pilot configuration fixture: `fixtures/synthetic/cp10/pilot_readiness_configuration.json`.
- Domain contract: `buildCp10PilotReadinessPlan` returns `ready`, `unavailable`, `deferred`, and `blocked` states with route contracts and activation paths.
- API contract: `GET /v1/pilot-readiness`, owner/admin scoped through `clinic.manage`, read-only, no persistence.
- Web consumer: owner-only `Pilot readiness` surface with local fixture fallback gated by `NEXT_PUBLIC_CLINIC_OS_USE_CP10_PILOT_FIXTURE=true` in local/dev/test only.

## Honest Readiness Rules

- Local release-candidate configuration may be `ready` with synthetic fixtures.
- Pilot go-live remains `blocked` until signed provider callbacks, AWS apply evidence, alert routing, GitHub remote checks, live restore, ABDM activation, and physical-device smoke are verified.
- Simulator and local fixture evidence are not production provider readiness.
- No real PHI, provider secret values, cloud mutations, live provider sends, ABDM calls, GitHub push, or physical-device flows are performed by this lane.

## External Live Verification Gaps

- WhatsApp: official Meta/BSP activation and signed hosted webhook registration.
- Razorpay: signed HTTPS callback registration and live/sandbox reconciliation smoke.
- Telephony: official provider onboarding and signed callback registration.
- AI/transcription: provider approval, no-training/no-retention posture, and data-residency approval.
- AWS: pilot-prod Terraform apply and live restore/failover evidence.
- GitHub: push/remote CI evidence.
- Mobile: physical-device capture smoke.
- ABDM: sandbox/live exchange activation after compliance approval.

## Verification Targets

- `npm --workspace @clinic-os/domain test`
- `npm --workspace @clinic-os/api test`
- `npm --workspace @clinic-os/api run typecheck`
- `npm --workspace @clinic-os/web test -- cp10-pilot-readiness.test.ts navigation.test.ts`
- `npm --workspace @clinic-os/web run typecheck`
- `git diff --check`
