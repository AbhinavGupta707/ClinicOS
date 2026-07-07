# Checkpoint 9 FHIR/ABDM Readiness

## Scope

This lane adds FHIR R4-shaped projection helpers and deterministic sample evidence for the CP9 interoperability slice.

Covered resources:

- `Organization` for the ClinicOS clinic/facility context.
- `Patient` for synthetic patient registry data.
- `Practitioner` for the synthetic doctor author/participant.
- `Encounter` for the visit context.
- `Composition` for signed/amended clinical-note sections.
- `DocumentReference` for mediated clinical document evidence.
- `Provenance` for signed source evidence and authoring.

ClinicOS remains the source of truth. The FHIR bundle is an exchange projection over ClinicOS records, not a direct write model.

## Local Validation

Validation is structural and local-only:

- Bundle/resource IDs and `urn:uuid:` entry URLs.
- Local references such as `Patient/{id}`, `Encounter/{id}`, and `DocumentReference/{id}` resolve inside the bundle.
- Required resource types are present for the CP9 slice.
- `meta.profile` is present as a profile-ish invariant.
- Document references use mediated `urn:clinicos:` URLs.
- Storage internals such as object keys, raw storage paths, S3 URLs, and signed URLs are forbidden.

The validator does not call external FHIR validators and does not claim conformance to national profiles beyond the profile-ish local invariants above.

## ABDM Posture

ABDM is feature-gated and readiness-only in this lane.

- Empty ABDM credentials produce `configurationStatus: not_configured`, `availabilityStatus: unavailable`, `exchangeMode: fixture_only`, and `liveExchangeAllowed: false`.
- ABHA address, care-context linking, and consent exchange readiness remain optional and blocked by credentials, consent, and activation state.
- Log summaries include safe status and missing-key names only; they do not expose credential values.
- No ABDM client or live endpoint call is implemented.

## Fixture

The canonical fixture is `fixtures/synthetic/cp9/fhir_abdm_readiness_fixture.json`. It derives from existing synthetic CP3 patient/encounter/clinical-note evidence and remains local/test-only.

## Schema Proposal For Integration

No migration was added by this lane. If Security/Privacy or master chooses to persist ABDM readiness later, the durable model should remain optional and consent-scoped:

- patient-level optional ABHA link record with verification status, consent id, verified at, revoked at, and audit actor.
- care-context projection table keyed by ClinicOS patient/encounter/document source ids, with ABDM care-context reference nullable until linked.
- consent/data-exchange log table with request id, purpose, status, expiry, source patient id, actor/system id, and no credential values.
