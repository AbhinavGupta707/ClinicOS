# FHIR R4 interoperability

This package contains the ClinicOS core FHIR R4 clinical-summary document boundary. It also retains the earlier CP9 projection/readiness helpers for their existing consumers.

## Supported CP16 slice

Capability version `1.0.0` supports FHIR `4.0.1` JSON document Bundles. The first entry is exactly one `Composition`; the closed graph contains exactly one `Patient`, `Encounter`, `Practitioner`, `Consent`, `DocumentReference` and `Provenance`, exactly two `Organization` resources (clinic and tenant), and zero or more `MedicationRequest` resources. Each resource declares its official FHIR R4 core profile. `clinicOsFhirR4CapabilityStatement()` publishes the producer/consumer and resource list.

The export is built from one server-loaded, versioned ClinicOS snapshot. Tenant, clinic, patient, encounter, practitioner, signed-note and signed-prescription relationships must all agree. Consent must be active, purpose-specific, correctly scoped, effective, unexpired and unrevoked at the action timestamp. The server supplies actor, timestamps, source identifiers, provenance, integrity metadata and deterministic UUIDs. Canonical key-sorted ClinicOS JSON plus SHA-256 makes local retries deterministic; this digest format is deliberately not represented as an HL7 signature canonicalization standard.

The import accepts only this bounded closed-document shape. It rejects unknown resources or nested fields, malformed nested shapes, extensions, contained resources, external/versioned/conditional references, arbitrary URI surfaces, invalid profiles/codes/cardinalities, duplicate resources and unresolved or cross-bound graph relationships. Defaults are 2 MiB, 256 entries, depth 24, 20,000 object keys, 10,000 strings and 20,000 characters per string. The minimized reconciliation payload includes only composition metadata, the exact encounter identifier/version, medication text/dosage metadata, exact patient identifiers and source document-reference IDs. Only that minimized payload crosses the durable staging port; the raw Bundle is neither applied nor handed to persistence.

Patient and encounter matching both require exactly one authorized identifier match inside the authenticated tenant/clinic/patient scope. Missing, ambiguous, wrong-target or version-conflicting matches are quarantined and never create, merge or relink identity. A matched document is only `pending_review`. Acceptance rechecks consent and both identities/versions. A durable adapter may report `applied` only when one transaction conditionally applies the minimized allowlist to the existing patient/encounter state, advances protected versions, appends audit and appends outbox; otherwise it remains `accepted_pending_apply`. Rejection and pending acceptance remain durable, audited states.

The namespaced API contracts are transport-neutral. Registered adapters must provide authenticated capabilities, authoritative action-time consent, scoped source reads, atomic idempotency claims, durable reconciliation, failure evidence and retry classification. Mutation boundaries use canonical strong ETags (`"rv-N"`), `If-Match`, `Idempotency-Key` and `idempotency-replayed`. The API package dependency, route registration, shared consent/audit adapters, durable schema and outbox implementation are master-integration work.

## Validation and ABDM status

Run the deterministic local suite with:

```sh
npm --workspace @clinic-os/fhir run typecheck
npm --workspace @clinic-os/fhir test
```

`officialFhirR4ValidatorCommand()` returns the command contract for the official HL7 Validator CLI with `hl7.fhir.r4.core#4.0.1`. `officialAbdmValidatorCommand()` separately adds `ndhm.in#6.5.0`. These command contracts are marked `E4_pending`: no official validator runtime/evidence exists in this worktree, so local validation is not official conformance evidence.

The current published ABDM FHIR IG target is pinned to `ndhm.in#6.5.0`; the visible 7.0.0 preview/local-development build is not an activation target. ABDM remains unregistered and unavailable unless exact official package validation plus official sandbox registration evidence is supplied through the typed activation boundary. Credentials or feature flags alone never activate it, and production ABDM exchange is not implemented.

## Retained CP9 scope

The CP9 helpers project patient/encounter/note evidence and expose a local ABDM readiness posture. The canonical CP9 sample remains `fixtures/synthetic/cp9/fhir_abdm_readiness_fixture.json`. These helpers do not prove CP16 or ABDM conformance.
