# Security Package

Audit, encryption, PHI redaction, retention, and security policy helpers.

## Checkpoint 1 Scope

- Audit action classification for authentication/session, patient PHI access, clinical signing, media access, billing, integration credentials, and break-glass actions.
- Audit event factory that requires `patientId` for PHI-sensitive access/change events.
- Recursive PHI redaction helper for logs, errors, and telemetry payloads.

The redaction helper masks common identifiers in free text and fully replaces known sensitive fields such as patient name, phone, email, ABHA, clinical notes, transcripts, diagnoses, prescriptions, and allergy fields.
