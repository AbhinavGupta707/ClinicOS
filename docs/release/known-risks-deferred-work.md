# Known Risks And Deferred Work Register

Date: 2026-07-07

Status: CP10 draft register for master evidence review

This register separates release-candidate risks from deferred whole workflows.
Items here must not be quietly converted into partial product behavior to make a
pilot look more complete.

## Live Verification Gaps

| Area                                   | Current evidence posture                                                                                     | Pilot decision                                                         | Evidence needed to remove gap                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| WhatsApp/Meta live send and webhooks   | Provider contracts and health foundations exist; dashboard callback registration is not claimed.             | Keep simulator/manual unless official signed callback evidence exists. | Deployed HTTPS callback, Meta verification challenge, signature/app-secret handling, approved templates, sandbox/live send evidence. |
| Razorpay hosted webhook reconciliation | Payment simulator/manual evidence and provider contracts exist; public callback registration is not claimed. | Keep manual/simulator or explicitly scoped sandbox until verified.     | Deployed raw-body webhook route, Razorpay signature verification, dashboard registration, replay/idempotency evidence.               |
| Telephony/missed-call live capture     | Manual/source attribution foundation exists; live telephony is optional/unavailable unless configured.       | Defer live telephony unless provider owner activates official account. | Provider credentials, callback URL, signed event handling, live missed-call evidence.                                                |
| Google Business Profile live API       | Manual/source attribution exists; no live Google API dependency claimed.                                     | Defer as whole workflow.                                               | OAuth approval, profile access, official API evidence, privacy review.                                                               |
| ABDM live exchange                     | FHIR projection and ABDM readiness states exist; live exchange disabled.                                     | Defer as whole workflow.                                               | ABDM credentials, HPR/HFR/facility details, patient consent, compliance sign-off, sandbox exchange evidence.                         |
| AWS pilot-prod apply                   | Terraform validation-only posture and synthetic restore evidence exist.                                      | Defer cloud mutation unless explicitly approved.                       | Approved apply window, SSO/OIDC identity, managed secrets, backups, alerting, smoke evidence.                                        |
| Physical-device mobile capture         | Expo/local/mobile contract evidence exists from CP8; physical distribution not claimed.                      | Defer device rollout unless separately scoped.                         | iOS/Android device smoke, consent/audio/camera evidence, distribution account evidence.                                              |
| GitHub push/Actions verification       | Not owned by this lane.                                                                                      | Record separately if used for CP10 release.                            | Successful push, CI checks, artifact or release branch evidence.                                                                     |

## Deferred Whole Workflows

| Workflow                                                   | Why deferred                                                                             | Safe current posture                                                 | Do not build as partial                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| External imaging links/DICOM ingest beyond CP4 coexistence | Durable media upload/access exists, but external imaging API/link workflow is not owned. | Keep external imaging reference workflow deferred or manual.         | Do not add ad hoc `/links` or raw URL storage paths.                                  |
| Bulk multi-tooth dental chart patching                     | CP4 supports complete one-finding-per-row workflow.                                      | Use existing finding create/update/history/snapshot workflow.        | Do not hide partial bulk mutation behind weak endpoint.                               |
| CP5 aggregate checkout read model                          | Granular checkout/payment/instruction routes exist; aggregate read model is deferred.    | Use explicit fixture/read-unavailable state where applicable.        | Do not call stale aggregate route or fake summary completion.                         |
| Live accounting export/reconciliation                      | Payment/billing evidence exists; accounting integration is not owned.                    | Manual accountant review and source-attributed export planning only. | Do not scrape accounting tools or emit unverified ledger sync.                        |
| Google/Practo write-back                                   | Official integration and clinic authorization are not present.                           | Manual/source attribution and authorized import/export only.         | Do not depend on dashboard scraping or brittle browser automation.                    |
| AI clinical application automation                         | CP8 records review-only decisions.                                                       | Human review/sign-off remains required.                              | Do not auto-mutate signed notes, chart findings, prescriptions, billing, or messages. |
| Live FHIR API server                                       | CP9 provides package-level FHIR projection helpers and fixture validation.               | Local/synthetic projection evidence only.                            | Do not claim live FHIR API route or national-profile conformance.                     |
| ABDM production flow                                       | Legal/compliance and sandbox activation absent.                                          | Feature-gated readiness with `liveExchangeAllowed: false`.           | Do not attempt live exchange or ABHA linking without consent/activation.              |

## Operational Risks

| Risk                                                                     | Severity if unmitigated | Mitigation before pilot                                                           |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| Staff confuse simulator/unavailable provider states with live readiness. | High                    | Training drill plus provider-health support runbook.                              |
| Manual fallback creates records that are not reconciled into ClinicOS.   | Medium                  | Assign fallback owner and reconciliation SLA in support log.                      |
| Fixture route plans drift from live API route families.                  | High                    | Master reconciles CP10 QA scripts, web loaders, and API routes before closeout.   |
| Real PHI enters local/dev evidence.                                      | High                    | Synthetic-first training, data/privacy review, redacted screenshots, secret scan. |
| Backup/DR posture is assumed from dry-run only.                          | High                    | Keep AWS/live restore marked deferred until approved execution evidence exists.   |
| Role boundaries regress during UX polish.                                | High                    | Role matrix must pass before pilot scope expands.                                 |

## Register Maintenance

- Master updates this file only by adding evidence, closing a risk with a linked
  verification record, or moving a workflow into a future checkpoint owner.
- Closing a gap requires evidence, not intent.
- Deferred whole workflows should remain unavailable/manual in product surfaces
  until a later lane owns the complete implementation.
