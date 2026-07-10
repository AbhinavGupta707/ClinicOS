# Security Package

Audit, encryption, PHI redaction, retention, and security policy helpers.

## Checkpoint 1 Scope

- Audit action classification for authentication/session, patient PHI access, clinical signing, media access, billing, integration credentials, and break-glass actions.
- Audit event factory that requires `patientId` for PHI-sensitive access/change events.
- Recursive PHI redaction helper for logs, errors, and telemetry payloads.

The redaction helper masks common identifiers in free text and fully replaces known sensitive fields such as patient name, phone, email, ABHA, clinical notes, transcripts, diagnoses, prescriptions, and allergy fields.

## Checkpoint 3 Security/Compliance Scope

- Audit classifications cover intake, consent, encounter, clinical note draft/sign/amend, prescription draft/sign, and patient timeline views.
- CP3 PHI redaction covers intake responses, consent signatures, clinical observations, treatment plans, prescription payloads, transcripts, and raw audio references.

## Checkpoint 12 Boundary Contracts

The package now exposes framework-neutral contracts for the later modular API consumer:

- validated request/correlation IDs with explicit generated versus client-supplied provenance and safe audit metadata that excludes raw URLs, queries, headers, and bodies;
- strict runtime-validator adapters and unknown-field/prototype-pollution rejection for body, path, query, and response boundaries;
- stable error serialization for `400`, `401`, `403`, `404`, `409`, `413`, `422`, `429`, `500`, and `503`, including `Retry-After` for `429`, `no-store`, request IDs, generic internal failures, and PHI/secret redaction;
- body byte counters, query cardinality/byte limits, pagination ceilings, HMAC-derived abuse keys, and atomic-store contracts for rate and expensive-operation budgets;
- a deny-by-default route-policy registry contract with exact registration coverage, verified-identity authority, explicit public-health and signed-webhook exceptions, strict runtime validation, and no-store responses.

The source package intentionally does not ship an in-memory production rate limiter. A later API integration must supply a distributed atomic budget store and register every route before startup. Missing policy coverage is a startup/configuration failure, not a permissive fallback.
