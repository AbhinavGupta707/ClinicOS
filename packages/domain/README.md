# Domain Package

Shared domain types, state transitions, invariants, and policy helpers.

## Checkpoint 1 Scope

- Canonical UUID, tenant, clinic, user, membership, role, permission, audit, and patient PHI types.
- Default production role matrix for owner/admin, doctor, assistant, receptionist, accountant, auditor, and platform admin.
- Permission helpers used by `@clinic-os/auth` to enforce clinic-scoped access.

Clinical access defaults intentionally keep accountant users away from patient PHI, clinical notes, and media. Assistants can draft clinical context but cannot sign notes or prescriptions.

## Checkpoint 3 Security/Compliance Scope

- Consent policy helpers evaluate whether future AI/audio processing is allowed, including revocation and raw-audio-retention requirements.
- Clinical artifact guard helpers enforce signed-note immutability, reasoned amendments, and draft-only prescription signing.
- CP3 event taxonomy covers intake responses, consent create/revoke, encounter lifecycle, note draft/sign/amend, prescription draft/sign, and patient timeline projection.
