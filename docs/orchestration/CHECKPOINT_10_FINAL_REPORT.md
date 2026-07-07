# Checkpoint 10 Final Report

Date: 2026-07-07

Status: Integration verified on `codex/integration/checkpoint-10`; main
promotion is recorded in `docs/orchestration/CHECKPOINT_LOG.md` after the
post-promotion checks.

Integration branch: `codex/integration/checkpoint-10`

## Decision Summary

| Decision                          | Status                                       | Evidence                                                                    |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| Technical release candidate       | Accepted for local release-candidate package | CP10 lanes merged, full repository gates passed, API/browser smoke passed.  |
| Pilot clinic go-live              | Not approved by this checkpoint              | Requires clinic owner/release lead sign-off and external live evidence.     |
| Live provider activation approved | Not claimed                                  | WhatsApp, Razorpay, telephony, AI/STT, ABDM, AWS, and devices remain gated. |
| Real clinic data approved         | Not approved                                 | CP10 evidence remains synthetic/local-test only.                            |
| Deferred workflows accepted       | Accepted as carry-forward gaps               | See `docs/release/known-risks-deferred-work.md`.                            |

## Merged Lane Summary

| Lane                | Worker commit       | Integration evidence                         | Notes                                                                                                                                                       |
| ------------------- | ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilot Configuration | `148bad5`           | Merge `c158969`; master correction `f6f2716` | Added read-only `GET /v1/pilot-readiness`, owner-only web surface, and synthetic pilot readiness fixture. Master kept `dataResidencyApproved` conservative. |
| UX Polish           | `ecc6e1d`           | Merge `4740a10`                              | Hardened registered-unavailable wording, role-boundary copy, and mobile audio disabled state.                                                               |
| End-To-End QA       | `e0be686`           | Merge `23c628e`                              | Added CP10 clinic-day fixture, dry-run smoke, acceptance contract, and Playwright smoke spec.                                                               |
| Operations/Docs     | `266f7d7`           | Merge `fc3511f`                              | Added release notes, go-live checklist, evidence matrix, support/admin runbook, training flow, risk register, and report shell.                             |
| Master closeout     | This closeout patch | Verified before commit                       | Added ABDM to the web CP10 pilot fixture, updated evidence docs, and reran all gates.                                                                       |

## Release Package

| Artifact                    | Status | Path                                          |
| --------------------------- | ------ | --------------------------------------------- |
| Release notes               | Ready  | `docs/release/checkpoint-10-release-notes.md` |
| Go-live checklist           | Ready  | `docs/release/pilot-go-live-checklist.md`     |
| Training flow               | Ready  | `docs/training/pilot-training-flow.md`        |
| Support/admin runbook       | Ready  | `infra/runbooks/pilot-support-admin.md`       |
| Risk/deferred-work register | Ready  | `docs/release/known-risks-deferred-work.md`   |
| Evidence matrix             | Ready  | `docs/qa/checkpoint-10-evidence-matrix.md`    |

## Verification Results

| Gate                       | Result | Evidence                                                                                                                                                                                                   |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git diff --check`         | Pass   | Ran before final docs patch and again during merge/format checks.                                                                                                                                          |
| `npm run check`            | Pass   | Workspace structure, env/template validation, and formatting passed.                                                                                                                                       |
| `npm run security:secrets` | Pass   | Tracked-file secret scan passed.                                                                                                                                                                           |
| `npm run typecheck`        | Pass   | All workspaces typechecked after the final ABDM fixture patch.                                                                                                                                             |
| `npm run lint`             | Pass   | All workspace lint gates passed after the final ABDM fixture patch.                                                                                                                                        |
| `npm run test`             | Pass   | Full workspace test suite passed; sandbox socket skips were separately covered outside the sandbox.                                                                                                        |
| `npm run build`            | Pass   | API, mobile web export, Next.js web build, worker, FHIR, integrations, config, observability, and workflow builds passed.                                                                                  |
| CP10 fixture validator     | Pass   | `node scripts/validate-cp10-fixtures.mjs`.                                                                                                                                                                 |
| CP10 contract dry-run      | Pass   | `node scripts/cp10-contract-smoke.mjs --dry-run`.                                                                                                                                                          |
| Acceptance contracts       | Pass   | `node --test tests/acceptance/*.test.mjs` passed 53 tests.                                                                                                                                                 |
| CP10 API route smoke       | Pass   | `npm --workspace @clinic-os/api test -- cp10-pilot-readiness.test.ts` was run outside the sandbox; 45 API tests passed with zero skips, including `GET /v1/pilot-readiness` owner-only route registration. |
| Web unit/selector checks   | Pass   | `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/web run typecheck`, and `npm --workspace @clinic-os/web run lint`.                                                                      |

`npm run security:audit` was not run because prior policy review rejected npm
audit escalation: it discloses dependency inventory to the external npm registry
audit service. Do not run it without explicit approval for that disclosure.

## Browser And User Smoke

All web smoke used explicit local fixture flags and role-specific server
processes because `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE` is process-scoped.

| Smoke                                   | Result | Evidence                                                                                                                                                                                                                                      |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant clinic-day desktop            | Pass   | `CLINICOS_CP10_E2E_ENABLED=true ... NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts --grep assistant`; screenshot `/private/tmp/clinicos-cp10-assistant-clinic-day-desktop.png`. |
| Assistant 390px mobile                  | Pass   | Same assistant run; no horizontal overflow; screenshot `/private/tmp/clinicos-cp10-assistant-mobile-390.png`.                                                                                                                                 |
| Owner dashboard/readiness/compliance    | Pass   | Owner run verified owner dashboard, pilot readiness, ABDM external gap visibility, compliance registered-unavailable shell, and no fake completion claims; screenshot `/private/tmp/clinicos-cp10-owner-dashboard-compliance.png`.            |
| Owner settings desktop and 390px mobile | Pass   | `CLINICOS_CP10_UX_E2E_ENABLED=true ... --grep "owner                                                                                                                                                                                          | settings | 390px"`; screenshots `/private/tmp/clinicos-cp10-settings-unavailable-desktop.png`and`/private/tmp/clinicos-cp10-settings-unavailable-mobile-390.png`. |
| Platform-support unavailable shell      | Pass   | Platform-admin run verified no break-glass/tenant-diagnostics fake completion.                                                                                                                                                                |
| Accountant role boundary                | Pass   | Accountant run verified direct clinical route shows role boundary and no clinical workflow controls; screenshot `/private/tmp/clinicos-cp10-accountant-role-boundary.png`.                                                                    |

## Clinic-Day Evidence

| Step                                 | Evidence status | Notes                                                                                                                        |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Lead capture and source attribution  | Pass            | CP10 fixture and dry-run reference CP2 canonical lead/patient/appointment routes.                                            |
| Patient match/create                 | Pass            | CP10 acceptance and API suite preserve CP2 patient matching and tenant scope.                                                |
| Appointment booking and queue        | Pass            | Assistant browser smoke traversed day-start/queue fixture surface.                                                           |
| Intake and consent                   | Pass            | Assistant browser smoke traversed CP3 clinical surface; API suite preserves consent blocking.                                |
| Encounter and clinical note          | Pass            | CP3 API/domain tests and CP10 fixture cover doctor-only sign boundaries.                                                     |
| Dental chart and media               | Pass            | Assistant browser smoke traversed CP4 dental/media surface; CP10 acceptance keeps durable media route assumptions canonical. |
| Treatment plan and invoice           | Pass            | Assistant browser smoke traversed checkout surface; CP5 tests preserve invoice and receipt evidence.                         |
| Payment/manual payment evidence      | Pass            | CP5 API tests preserve no fake provider-paid state and idempotent manual/provider payment evidence.                          |
| Prescription and instruction request | Pass            | CP10 fixture keeps prescription doctor-only and instruction request evidence, without fake provider delivery.                |
| Recall/lab/inventory/SOP/event       | Pass            | Assistant browser smoke traversed CP6 operations surface; CP6 tests preserve continuity evidence.                            |
| Owner dashboard                      | Pass            | Owner browser smoke verified aggregate owner dashboard without PHI overreach.                                                |

## Role And Tenant Safety

| Role/scope             | Result | Evidence                                                                                                           |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Owner                  | Pass   | Browser owner smoke, CP10 pilot readiness API owner-only route, role matrix acceptance tests.                      |
| Doctor                 | Pass   | API/domain role tests and CP10 role matrix preserve clinical signing/review boundaries.                            |
| Assistant              | Pass   | Browser assistant clinic-day smoke and role matrix acceptance tests.                                               |
| Receptionist           | Pass   | CP10 fixture/acceptance covers billing/instruction permissions without PHI overreach.                              |
| Accountant             | Pass   | Browser role-boundary smoke and API/domain tests deny clinical PHI.                                                |
| Auditor/support        | Pass   | CP10 role matrix acceptance tests preserve read/review-only posture.                                               |
| Platform/admin support | Pass   | Browser platform-support unavailable shell denies fake break-glass/tenant diagnostics completion.                  |
| Cross-tenant denial    | Pass   | CP10 acceptance tests assert wrong-tenant denials for patient, note, media, billing, and dashboard route families. |

## Provider And External Boundary Posture

| Boundary                | CP10 closeout status           | Evidence/gap                                                                                      |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| WhatsApp/Meta           | Blocked external gate          | No hosted signed webhook registration or live send/read claim.                                    |
| Razorpay                | Blocked external gate          | No hosted signed HTTPS callback or provider-paid claim.                                           |
| Telephony               | Deferred external gate         | No official telephony provider/callback activation.                                               |
| Google Business Profile | Deferred whole workflow        | Manual/source attribution remains the owned fallback.                                             |
| AI/STT                  | Deferred external gate         | Simulator/review-only evidence only; no live provider, retention, or residency approval.          |
| FHIR                    | Projection package only        | No live FHIR API route is claimed.                                                                |
| ABDM                    | Deferred external gate         | Web and API readiness now both expose ABDM as not activated; no live exchange/ABHA linking claim. |
| AWS pilot-prod          | Blocked/deferred external gate | No Terraform apply, cloud mutation, or live restore claim.                                        |
| GitHub push/remote CI   | Deferred external gate         | Local branch evidence only unless push/CI is explicitly performed.                                |
| Physical mobile devices | Deferred external gate         | Expo/mobile local evidence exists; no device-distribution claim.                                  |

## Accepted Gaps

| Gap                                                         | Accepted by                      | Rationale                                                                                              | Follow-up owner                   |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Live WhatsApp/Razorpay/telephony/AI/STT provider activation | Master closeout as external gap  | Requires official credentials, hosted callbacks, compliance approvals, and provider evidence.          | Pilot release lead/provider owner |
| ABDM live exchange                                          | Master closeout as external gap  | Requires credentials, consent, HFR/HPR/facility activation, sandbox evidence, and compliance sign-off. | Interoperability/compliance owner |
| AWS pilot-prod apply and live restore                       | Master closeout as external gap  | Requires explicit approval window, cloud identity/secrets, apply evidence, and restore proof.          | Infrastructure owner              |
| Physical-device mobile smoke                                | Master closeout as external gap  | Requires device/distribution access beyond local Expo evidence.                                        | Mobile release owner              |
| GitHub push/remote CI                                       | Master closeout as external gap  | Not performed unless explicitly requested.                                                             | Repository owner                  |
| Final visual design pass                                    | Product-design deferred workflow | CP10 verifies safety, reachability, responsiveness, and honest states; final UI design is separate.    | Design owner                      |

## Go/No-Go Record

| Gate                        | Decision                                         | Decision maker     | Date       | Notes                                                                         |
| --------------------------- | ------------------------------------------------ | ------------------ | ---------- | ----------------------------------------------------------------------------- |
| Technical release candidate | Go for local/synthetic release-candidate package | Master integration | 2026-07-07 | Full gates and browser smoke passed.                                          |
| Pilot clinic go-live        | No-go until external gates close                 | Master integration | 2026-07-07 | Requires owner/release lead sign-off and live provider/cloud/device evidence. |
| Real data use               | No-go                                            | Master integration | 2026-07-07 | No real PHI approval or clinic data import performed.                         |
| Live provider activation    | No-go                                            | Master integration | 2026-07-07 | No live providers, ABDM, AWS apply, GitHub push, or device checks claimed.    |

## Master Closeout Notes

- The owner browser smoke caught an integration gap: the domain/API readiness
  builder included ABDM as a deferred external gate, but the web CP10 fixture did
  not. The closeout patch added `provider-abdm` to the web pilot fixture and
  covered it in the CP10 web unit test before rerunning checks.
- The release candidate is a verified local/synthetic package, not approval to
  run a real clinic or activate live external systems.
- All implemented workflows remain production-shaped for their intended scope:
  authorized, audited, tenant-scoped, tested, and honest about unavailable or
  external dependencies.
