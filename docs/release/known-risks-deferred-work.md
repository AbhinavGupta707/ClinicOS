# Known Risks and Deferred Work

**Date:** 2026-07-09
**Status:** Current release summary
**Decision:** **NO-GO** for pilot, production PHI and production provider traffic

The authoritative item-level register is `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`. This document is the release-facing summary; it must never diverge from that register.

## 1. Hard Production Blockers

| Area                     | Current truth                                                                                                                                                              | Owning checkpoint |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Verification integrity   | Current test suite has date/clock failures; CP10 live smoke mixes fixture/runtime clinic IDs; some TypeScript “typechecks” are syntax-only.                                | CP11              |
| Durable data             | Ten migrations exist but are not wired into startup/deploy; audited local Postgres had zero public tables; durable RLS/outbox behavior is not end-to-end evidenced.        | CP11/CP13         |
| Readiness                | `/health/ready` reports configuration without probing required dependencies.                                                                                               | CP11              |
| API boundary             | Large hand-routed API and handwritten contract notes make validation/auth/idempotency drift difficult to prove.                                                            | CP12              |
| Durable clinic day       | Browser workflow evidence is fixture-based; canonical full workflow is not proven against Postgres/Keycloak/Temporal/outbox.                                               | CP13              |
| Cloud                    | Pilot-prod Terraform is posture-only and intentionally declares no providers/resources.                                                                                    | CP14              |
| Media                    | Runtime supports only a local simulator, which production-like config forbids.                                                                                             | CP14              |
| Auth/security operations | No deployed Keycloak/session/MFA/revocation, edge security headers, comprehensive abuse controls, security toolchain, immutable audit operation or key lifecycle evidence. | CP14              |
| Observability/resilience | Telemetry defaults to console; no deployed backend, paging, SLO, live restore/failover, capacity or fault evidence.                                                        | CP14              |
| Providers                | Meta inbound and telephony callbacks are absent; Razorpay public URL/registration is absent; official retry/reconciliation evidence is absent.                             | CP15              |
| Native mobile            | Camera/audio are unavailable, capture cache is memory-only, and no physical-device signed distribution evidence exists.                                                    | CP16              |
| AI/interoperability      | AI/STT lacks an approved live data path/evals; FHIR is a projection foundation; ABDM is unactivated. Must stay disabled unless completed.                                  | CP16              |
| Human/clinic governance  | No real-data authorization, configured clinic sign-off, training completion, production support exercise or cross-functional go-live approval.                             | CP17              |

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
4. CP14 cloud/security/media/observability/recovery.
5. CP15 official provider integrations.
6. CP16 native mobile and selected AI/interoperability.
7. CP17 controlled clinic validation.
8. CP18 repeatable multi-clinic production.

See `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` for detailed deliverables and dependency gates.

## 5. Maintenance

- Update this summary only from the authoritative remediation register.
- Closing an item requires implementation plus evidence at the tier defined in `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`.
- Record revision, environment, timestamp, result and reviewer.
- Preserve historical evidence; add a superseding record instead of rewriting history.
