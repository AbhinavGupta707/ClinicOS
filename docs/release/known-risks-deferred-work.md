# Known Risks and Deferred Work

**Date:** 2026-07-11
**Status:** Current release summary
**Decision:** **NO-GO** for pilot, production PHI and production provider traffic

**Execution mode:** The owner deferred all AWS/DNS activation on 2026-07-11. The CP14 E3
implementation baseline may be promoted and CP15/selected CP16 implementation may continue, but
none of the cloud/provider/device/operational hard gates below is waived. See
`docs/orchestration/CHECKPOINT_14_CLOUD_DEFERRAL_DECISION.md`.

The authoritative item-level register is `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`. This document is the release-facing summary; it must never diverge from that register.

## 1. Hard Production Blockers

| Area                     | Current truth                                                                                                                                                            | Owning checkpoint |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Verification integrity   | CP11-CP13 deterministic/type/durable-local gates pass; exact CP14 cloud revision still lacks applied E4/E5 and independent operational review.                           | CP14/CP17         |
| Durable data             | Nineteen migrations, forced RLS, transaction-bound audit/outbox and durable clinic-day recovery pass at E3; staging migration/restore and live failover remain unproven. | CP14              |
| Readiness                | Local Postgres/Keycloak/Redis/worker readiness and recovery pass; deployed ALB/ECS dependency-removal and paging evidence do not exist.                                  | CP14              |
| API boundary             | The strict 128-operation contract/policy pipeline, durable idempotency and conditional versions pass E3; deployed WAF/load/abuse evidence remains open.                  | CP14              |
| Durable clinic day       | Canonical runtime-ID clinic day and browser workflows pass twice at E3; the same revision has not run against applied staging infrastructure.                            | CP14              |
| Cloud                    | Deployable version-pinned Terraform validates/mock-plans cleanly, but no backend migration, saved live plan, apply, drift inventory or cloud environment exists.         | CP14              |
| Media                    | Private S3/KMS/quarantine/lifecycle adapters and durable tests pass locally; no approved production malware scanner or deployed tenant/quarantine evidence exists.       | CP14              |
| Auth/security operations | Hardened Keycloak/Temporal images and BFF/session/revocation contracts pass local runtime/scan gates; no deployed HA/MFA/rotation/admin-boundary evidence exists.        | CP14              |
| Observability/resilience | OTel/backpressure/SLO/alarm/backup definitions and synthetic harnesses exist; no real paging, load, restore, failover/failback or deployed trace evidence exists.        | CP14              |
| Providers                | Provider contracts exist, but no live public callbacks/registrations, approved credentials or official retry/reconciliation evidence exist.                              | CP15              |
| Native mobile            | Camera/audio are unavailable, capture cache is memory-only, and no physical-device signed distribution evidence exists.                                                  | CP16              |
| AI/interoperability      | AI/STT lacks an approved live data path/evals; FHIR is a projection foundation; ABDM is unactivated. Must stay disabled unless completed.                                | CP16              |
| Human/clinic governance  | No real-data authorization, configured clinic sign-off, training completion, production support exercise or cross-functional go-live approval.                           | CP17              |

## 2. Optional Workflows That May Remain Deferred Whole

Deferral is allowed only when the route, worker, provider registration, navigation and production configuration are absent/disabled and the remaining clinic workflow is complete and honest.

| Workflow                                           | Safe posture while deferred                                                | Forbidden partial behavior                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| External imaging/DICOM ingest beyond private media | Existing approved imaging software/manual reference outside ClinicOS.      | Raw external URLs, scraping, unscanned uploads or false DICOM conformance. |
| Bulk dental chart mutation                         | Complete one-finding-per-row create/update/history/snapshot workflow.      | Weak bulk endpoint without per-item validation/provenance/concurrency.     |
| Accounting integration/export                      | Manual accountant review and approved bounded export when implemented.     | Scraping or unverified automatic ledger sync.                              |
| Google/Practo write-back                           | Source attribution plus official API/export/import/manual clinic workflow. | Brittle browser automation or implied provider partnership.                |
| AI clinical application                            | AI/scribe controls absent; clinicians use normal manual authoring/signing. | Auto-signing or AI mutation of chart, prescription, billing or messages.   |
| Live FHIR/ABDM                                     | Feature unregistered/unavailable; approved manual export where governed.   | Claiming national-profile/API readiness from package fixtures.             |
| Telephony provider                                 | Manual missed-call/source entry.                                           | Invented callbacks or “delivered/captured” provider state.                 |
| Audio recording                                    | Disabled native control and normal manual notes.                           | Recording before consent/provider/device/security completion.              |

Messaging and payment may be removed from an early controlled scope only if the clinic retains a complete approved manual process and ClinicOS does not invent provider-confirmed state. They remain blue-sky production requirements for the intended full product.

## 3. Evidence and Governance Risks

- CP10 reports are historical E1/E2 evidence. They do not authorize E3+ claims.
- A configured credential is not a registered or verified integration.
- A dry-run restore is not a restore test.
- A browser fixture smoke is not a durable API/repository test.
- An unavailable shell is honest UX, not implemented functionality.
- A provider simulator is a test double, not a production fallback.
- A hard gate cannot be waived as an “accepted gap.” Remove a whole optional workflow or delay launch.
- Real PHI is forbidden in local fixtures, repository artifacts, screenshots, logs and unapproved test systems.

## 4. Current Execution Order

1. CP11 verification and durable data.
2. CP12 modular validated API/contracts.
3. CP13 durable clinic-day vertical slices.
4. CP14 cloud/security/media/observability/recovery implementation at E3; AWS E4/E5 deferred.
5. CP15 official-provider implementation; public callback registration/E4 deferred with AWS.
6. CP16 selected local native/mobile/AI/interoperability implementation; close only achieved tiers.
7. CP17 controlled clinic validation remains blocked by the deferred environment and external evidence.
8. CP18 repeatable multi-clinic production remains blocked by CP17 observation.

See `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` for detailed deliverables and dependency gates.

## 5. Maintenance

- Update this summary only from the authoritative remediation register.
- Closing an item requires implementation plus evidence at the tier defined in `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`.
- Record revision, environment, timestamp, result and reviewer.
- Preserve historical evidence; add a superseding record instead of rewriting history.
