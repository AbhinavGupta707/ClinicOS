# Checkpoint 10 Evidence Matrix

> **Historical evidence notice (2026-07-09):** This matrix records CP10 E1/E2 package, fixture, dry-run and browser evidence at the time it ran. It does not establish current E3+ durability, pilot readiness or production readiness. The independent audit later reproduced failing date-dependent tests, an unapplied local schema and a live smoke tenant-ID failure. Current truth is `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md` and `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`.

Date: 2026-07-07

Status: Historical CP10 verification; superseded for readiness claims

Scope: CP10 release-candidate and pilot-readiness gates.

## Repository And Build Gates

| Gate                   | Command/evidence           | Status              | Owner notes                                                                                                                |
| ---------------------- | -------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Whitespace/diff safety | `git diff --check`         | Pass                | Clean after merge reconciliation and final formatting.                                                                     |
| Workspace check        | `npm run check`            | Pass                | Workspace structure, env/template validation, and Prettier checks passed.                                                  |
| Typecheck              | `npm run typecheck`        | Pass                | All workspaces passed after the final ABDM fixture patch.                                                                  |
| Lint                   | `npm run lint`             | Pass                | All workspaces passed after the final ABDM fixture patch.                                                                  |
| Test                   | `npm run test`             | Pass                | Full workspace suite passed. In-sandbox socket skips were covered by outside-sandbox API smoke.                            |
| Build                  | `npm run build`            | Pass                | API checks, Expo web export, Next.js build, worker, FHIR, integrations, config, observability, and workflow builds passed. |
| Secret scan            | `npm run security:secrets` | Pass                | Tracked-file secret scan passed.                                                                                           |
| External npm audit     | Not run                    | Accepted limitation | `npm run security:audit` requires external dependency-inventory disclosure and was not run without explicit approval.      |

## CP10 Product Regression Gates

| Area                        | Evidence                                                                                                                             | Status                     | Notes                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full clinic-day flow        | `fixtures/synthetic/cp10/clinic_day_regression_flow.json`, `node scripts/cp10-contract-smoke.mjs --dry-run`, assistant browser smoke | Pass                       | Lead -> patient -> appointment -> intake -> encounter -> dental chart/media -> treatment plan -> invoice/payment -> prescription/instruction -> continuity -> owner dashboard. |
| Canonical routes            | CP10 dry-run script, acceptance contract, API route tests                                                                            | Pass                       | CP10 uses canonical CP2-CP9 route families and read-only `GET /v1/pilot-readiness`.                                                                                            |
| Role matrix                 | `node --test tests/acceptance/cp10-fixture-contract.test.mjs` and browser owner/assistant/accountant/platform smokes                 | Pass                       | Owner, doctor, assistant, receptionist, accountant, auditor/support, platform/admin boundaries are covered.                                                                    |
| Tenant isolation            | CP10 acceptance contract                                                                                                             | Pass                       | Wrong-tenant patient, note, media, invoice, and owner-dashboard assertions deny cross-tenant access.                                                                           |
| Provider unavailable/no-key | CP10 dry-run, owner/readiness browser smoke, release notes/risk register                                                             | Pass                       | Simulator/no-key evidence is never presented as live provider readiness.                                                                                                       |
| Migration/import dry-run    | CP10 acceptance contract references CP7 row-based migration and CP9 restore dry-run                                                  | Pass                       | No silent overwrite or live import claim.                                                                                                                                      |
| Backup/restore              | CP9 synthetic restore dry-run reference in CP10 fixture and release docs                                                             | Pass as synthetic evidence | Live restore remains external.                                                                                                                                                 |
| ABDM boundary               | CP9 FHIR/ABDM fixture plus CP10 owner readiness smoke                                                                                | Pass as deferred evidence  | Final closeout patched the web CP10 fixture so ABDM appears as an explicit external gate.                                                                                      |

## Browser And Manual Smoke Gates

| Smoke                  | Evidence                                                 | Status | Notes                                                                                          |
| ---------------------- | -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Desktop web            | Playwright CP10 assistant/owner/platform/accountant runs | Pass   | Implemented and registered-unavailable surfaces render without fake completion claims.         |
| Mobile web 390px       | Assistant checkout/operations and owner settings smoke   | Pass   | No horizontal overflow; key controls and state indicators are reachable.                       |
| Owner smoke            | Owner dashboard, pilot readiness, compliance shell       | Pass   | Pilot readiness shows blocked go-live and ABDM/live external gaps.                             |
| Doctor boundary        | API/domain role tests plus CP10 role matrix              | Pass   | No new CP10 doctor-only UI workflow was added; doctor signing/review boundaries remain tested. |
| Assistant smoke        | Assistant clinic-day browser run                         | Pass   | Traverses CP2-CP8 implemented fixture surfaces safely.                                         |
| Receptionist boundary  | CP10 role matrix and CP5 billing/instruction tests       | Pass   | Checkout/instruction evidence remains no-fake-delivery/no-fake-payment.                        |
| Accountant smoke       | Direct clinical route role-boundary browser run          | Pass   | No clinical PHI or clinical workflow controls render for accountant role.                      |
| Platform support smoke | Platform-support registered-unavailable browser run      | Pass   | No fake break-glass approval, tenant export, or provider success claim.                        |

## Live Verification Gaps To Carry Forward Unless Closed

| Gap                                | Expected CP10 status           | Closeout rule                                                                                                      |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| WhatsApp live webhook/send         | Blocked external gate          | Close only with signed callback and official provider send/status evidence.                                        |
| Razorpay webhook registration      | Blocked external gate          | Close only with hosted HTTPS callback, raw-body signature proof, and dashboard evidence.                           |
| Telephony live missed-call capture | Deferred external gate         | Close only with official API/callback evidence.                                                                    |
| ABDM live exchange                 | Deferred external gate         | Close only with credentials, consent, HFR/HPR/facility activation, sandbox/live evidence, and compliance sign-off. |
| AWS pilot-prod apply/restore       | Blocked/deferred external gate | Close only with approved cloud apply, backup, and live restore evidence.                                           |
| Physical-device mobile smoke       | Deferred external gate         | Close only with device screenshots/logs and distribution posture.                                                  |
| GitHub push/Actions                | Deferred external gate         | Close only with push/CI evidence.                                                                                  |
| Final visual design                | Deferred whole workflow        | CP10 verifies safety/responsiveness only; final design replacement remains separate.                               |
