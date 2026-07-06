# Domain Package

Shared domain types, state transitions, invariants, and policy helpers.

## Checkpoint 1 Scope

- Canonical UUID, tenant, clinic, user, membership, role, permission, audit, and patient PHI types.
- Default production role matrix for owner/admin, doctor, assistant, receptionist, accountant, auditor, and platform admin.
- Permission helpers used by `@clinic-os/auth` to enforce clinic-scoped access.

Clinical access defaults intentionally keep accountant users away from patient PHI, clinical notes, and media. Assistants can draft clinical context but cannot sign notes or prescriptions.
