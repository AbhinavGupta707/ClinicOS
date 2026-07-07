# Checkpoint 10 Evidence Matrix

Date: 2026-07-07

Status: Draft evidence ledger for master integration

Scope: CP10 release-candidate and pilot-readiness gates

The Operations/Docs lane does not fill verification results. Master should fill
this matrix after Pilot Configuration, UX Polish, End-To-End QA, and
Operations/Docs are merged on the CP10 integration branch.

## Repository And Build Gates

| Gate                   | Command/evidence           | Status         | Owner notes                                                 |
| ---------------------- | -------------------------- | -------------- | ----------------------------------------------------------- |
| Whitespace/diff safety | `git diff --check`         | Pending master | Run after all CP10 merges and docs formatting.              |
| Workspace check        | `npm run check`            | Pending master | Includes env/template and formatting gates.                 |
| Typecheck              | `npm run typecheck`        | Pending master | Required if any code changed.                               |
| Lint                   | `npm run lint`             | Pending master | Required if any code changed.                               |
| Test                   | `npm run test`             | Pending master | Required before release-candidate claim.                    |
| Build                  | `npm run build`            | Pending master | Required before pilot release candidate.                    |
| Secret scan            | `npm run security:secrets` | Pending master | Must pass before any real data or provider credential work. |

## CP10 Product Regression Gates

| Area                        | Evidence required                                                                                                                                                                              | Status          | Notes                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| Full clinic-day flow        | Lead -> patient -> appointment -> intake -> encounter -> dental chart/media -> treatment plan -> invoice/payment -> prescription/instruction -> recall/lab/inventory/event -> owner dashboard. | Pending QA lane | Evidence must state fixture/local/live boundary for each step. |
| Canonical routes            | CP10 scripts/web loaders use merged API route families.                                                                                                                                        | Pending master  | Resolve fixture/live drift before closeout.                    |
| Role matrix                 | Owner, doctor, assistant, receptionist, accountant, auditor/support, and platform/admin boundaries pass.                                                                                       | Pending QA lane | Include denial assertions, not only happy paths.               |
| Tenant isolation            | Cross-tenant reads/writes denied for CP10-relevant workflows.                                                                                                                                  | Pending QA lane | Required for any workflow added or touched.                    |
| Provider unavailable/no-key | Provider-health and UI/API states are honest and action-oriented.                                                                                                                              | Pending QA lane | Do not claim live provider readiness from simulator.           |
| Migration/import dry-run    | No silent overwrite of verified ClinicOS records; rollback posture documented.                                                                                                                 | Pending QA lane | Required if CP10 adds fixture/import/config changes.           |
| Backup/restore              | Synthetic restore evidence remains current.                                                                                                                                                    | Pending master  | Use CP9 runbook unless CP10 adds new restore evidence.         |

## Browser And Manual Smoke Gates

| Smoke                     | Evidence required                                                      | Status         | Notes                                              |
| ------------------------- | ---------------------------------------------------------------------- | -------------- | -------------------------------------------------- |
| Desktop web               | Screenshot/spec evidence for implemented CP10 surfaces.                | Pending master | Must show honest loading/error/unavailable states. |
| Mobile web 390px          | No horizontal overflow, reachable controls, safe text.                 | Pending master | Required for touched web surfaces.                 |
| Owner manual smoke        | Owner can review dashboard/readiness and go/no-go posture.             | Pending master | Use synthetic data unless real data approved.      |
| Doctor manual smoke       | Doctor can complete clinical/dental tasks in scope.                    | Pending master | Must preserve consent and sign-off boundaries.     |
| Assistant manual smoke    | Assistant can complete front-desk and continuity tasks in scope.       | Pending master | Must preserve source attribution.                  |
| Receptionist manual smoke | Receptionist can complete checkout/instruction workflow in scope.      | Pending master | No fake provider delivery/payment success.         |
| Accountant manual smoke   | Accountant can review payment evidence without clinical PHI overreach. | Pending master | Role denial evidence required.                     |

## Live Verification Gaps To Carry Forward Unless Closed

| Gap                                | Expected CP10 status                            | Closeout rule                                                                                |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| WhatsApp live webhook/send         | Gap unless official evidence recorded.          | Close only with signed callback and provider evidence.                                       |
| Razorpay webhook registration      | Gap unless official evidence recorded.          | Close only with raw-body signature verification and dashboard evidence.                      |
| Telephony live missed-call capture | Gap unless official provider evidence recorded. | Close only with official API/callback evidence.                                              |
| ABDM live exchange                 | Gap.                                            | Close only with credentials, consent, facility/provider activation, and compliance sign-off. |
| AWS pilot-prod apply/restore       | Gap unless explicitly approved and executed.    | Close only with cloud apply/restore evidence and approvals.                                  |
| Physical-device mobile smoke       | Gap unless separately executed.                 | Close only with device screenshots/logs and distribution posture.                            |
| GitHub push/Actions                | Gap unless master performs it.                  | Close only with push/CI evidence.                                                            |
