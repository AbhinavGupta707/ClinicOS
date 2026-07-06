# 06 - Security, Privacy, and India Compliance Plan

**Date:** 2026-07-06

## 1. Disclaimer

This is a technical compliance design, not legal advice. Before production launch, obtain Indian healthcare/privacy legal review, especially for DPDP implementation, state clinical establishment requirements, telemedicine/e-prescription rules, data retention, cross-border AI processing, and patient record handover obligations.

## 2. Core compliance stance

Build the product as if it handles highly sensitive health information even where legal terminology is broader. The system should be privacy-first by design:

- Purpose limitation.
- Data minimization.
- Clear notices and consent flows.
- Role-based and attribute-based access.
- Audit logs and provenance.
- Encryption in transit and at rest.
- Data export and correction workflows.
- Configurable retention.
- Breach response capability.
- Human sign-off for clinical outputs.

## 3. DPDP product implications

Based on the direction of India’s DPDP framework and current public reporting, design for:

| DPDP principle/obligation | Product implication |
|---|---|
| Clear notice | Show concise patient privacy notice for data collection, communication, AI/audio, photos, ABDM sharing. |
| Purpose limitation | Store processing purpose per consent/data category. |
| Consent/withdrawal | Patient can revoke communication/AI/photo/ABDM consent; system enforces future use restrictions. |
| Data minimization | Collect only needed information; avoid raw audio retention by default. |
| Security safeguards | Encryption, access control, audit, backups, vulnerability management. |
| Breach notification | Incident workflow, affected user list, evidence logs, response runbook. |
| Children’s data | Guardian consent for minors; role/access safeguards. |
| Cross-border processing | Vendor register and patient/clinic notice for external AI/cloud processing. |
| Data principal rights | Export, correction, grievance/contact workflows. |

## 4. Consent architecture

### Consent categories

- General treatment registration consent.
- Privacy notice acknowledgement.
- WhatsApp/SMS communication consent.
- Marketing/recall communication consent.
- AI documentation/audio transcription consent.
- Raw audio retention consent.
- Photo capture consent.
- Photo sharing consent.
- ABDM/ABHA linking and data-sharing consent.
- Procedure/treatment consent.

### Consent enforcement

Every workflow checks consent where required:

- AI scribe cannot start without AI/audio consent.
- Bulk recall/marketing messages require communication consent/opt-in.
- Prescription sharing requires patient contact verification and doctor sign-off.
- Photo sharing/export requires consent and audit.
- ABDM data sharing requires ABDM consent flow.

## 5. Role-based access control

### Default roles

| Role | Access |
|---|---|
| Owner/admin | Full clinic admin, analytics, billing, staff, templates, exports. Sensitive clinical access configurable. |
| Doctor | Patient records for assigned/clinic patients, clinical notes, prescriptions, sign-off. |
| Assistant | Schedule, intake, charting draft, media upload, tasks, lab, inventory, messages. No final diagnosis/prescription sign-off. |
| Receptionist | Appointments, demographics, billing/payment, basic messages. Limited clinical record access. |
| Accountant | Invoices/payments/exports only. No clinical notes/media by default. |
| Lab/vendor portal | Only lab case details explicitly shared. No full patient record. |
| Auditor/compliance | Audit logs and configured reports. |

### ABAC attributes

- Clinic/branch membership.
- Patient assignment.
- Encounter assignment.
- Emergency/break-glass reason.
- Business hours/session risk.
- Media sensitivity flag.
- Consent status.

## 6. Break-glass access

For urgent clinical access outside normal permissions:

1. User requests break-glass.
2. Must enter reason.
3. Access is time-limited.
4. Owner/admin gets notification.
5. Audit event is prominently recorded.

## 7. Audit requirements

Audit all:

- Login/logout and failed login attempts.
- Patient record views.
- Clinical note edits/signatures/amendments.
- Prescription downloads/shares.
- Photo/X-ray/media views/downloads/shares.
- Consent creation/revocation.
- AI processing of patient data.
- Data export/deletion requests.
- Billing/payment changes.
- Role/permission changes.
- Integration credential changes.
- Webhook events changing record state.

Audit logs should be protected from normal deletion and accessible only to authorized roles.

## 8. Security controls

### Application security

- TLS everywhere.
- Secure cookies and CSRF protection where applicable.
- OIDC/OAuth2 sessions.
- MFA for owners/admins/doctors.
- Strong password policy if local auth is used.
- Fine-grained authorization middleware on every endpoint.
- Tenant isolation tests.
- Input validation with schemas.
- Rate limiting for auth and public webhooks.
- File upload validation and malware scanning.
- Signed URLs for private files.

### Data security

- Encrypt database storage.
- Encrypt object storage.
- Encrypt secrets/credentials separately.
- Use envelope encryption/KMS where feasible.
- Hash or tokenize sensitive identifiers where possible.
- Backups encrypted and access-limited.
- Separate dev/staging/prod data; no production PHI in dev.

### Infrastructure security

- Private network for database/cache.
- Least-privilege IAM.
- Secrets manager.
- Container image scanning.
- Dependency scanning.
- WAF/reverse proxy.
- Centralized logs with PHI redaction.
- Security alerting.
- Pen testing before broader rollout.

## 9. Clinical safety controls

- Doctor sign-off required for clinical note, diagnosis, prescription, treatment plan.
- Assistant can draft/chart but cannot finalize doctor-only actions.
- Signed clinical records are immutable except through amendment workflow.
- AI output marked as draft.
- Medication and allergy warning before prescription sign-off.
- Templates versioned.
- Procedure consent linked to treatment plan/procedure.
- Post-op instructions use approved templates.

## 10. Patient records and exports

Product should support:

- Patient record export by authorized user.
- Visit summary PDF.
- Prescription PDF.
- Invoice/receipt PDF.
- Media export where allowed.
- Audit trail for exports.
- State-specific record handover time targets configurable.
- Correction/amendment request workflow.

## 11. Audio and media policy

### Audio

- Default: process for note generation, delete raw audio after sign-off/short retention window.
- Store transcript only if clinic policy and consent permit.
- Do not expose raw audio to all staff.
- Allow doctor/admin to disable audio scribe at tenant level.

### Photos/X-rays

- Capture through clinic-controlled app or upload process, not staff personal gallery where possible.
- Tag to patient/encounter/tooth/body area.
- Audit views/downloads/shares.
- Require consent for non-treatment sharing/marketing/before-after use.
- Keep original and derived thumbnails separate.

## 12. Incident and breach response

Build an internal incident module for:

- Security incident detection.
- Affected tenants/patients estimate.
- Timeline of events.
- Containment actions.
- Legal/compliance review checklist.
- Notifications required.
- Corrective action tracking.

## 13. Vendor risk

Maintain vendor register:

- WhatsApp/BSP.
- SMS provider.
- Telephony provider.
- Payment gateway.
- Cloud provider.
- AI provider.
- Email provider.
- Analytics/logging provider.

For each vendor:

- Data sent.
- Purpose.
- Region/storage.
- Retention.
- Security terms.
- Breach process.
- Contract/DPA status.

## 14. Compliance configuration by state/clinic

Because clinical establishment and patient-rights enforcement varies by state, product should support configurable:

- Clinic registration details.
- Display of services/fees.
- Grievance officer/contact.
- Patient rights notice.
- Emergency handling notice.
- Record export deadline.
- Itemized billing fields.
- Prescription formatting.
- Local language display templates.

## 15. Production readiness checklist

- [ ] Legal review completed.
- [ ] Privacy notice approved.
- [ ] Consent templates approved.
- [ ] DPDP gap assessment completed.
- [ ] Vendor DPAs/contracts reviewed.
- [ ] Data retention policy configured.
- [ ] Security controls implemented.
- [ ] Audit log tested.
- [ ] Backup restore tested.
- [ ] Incident response drill completed.
- [ ] AI safety eval passed.
- [ ] Tenant isolation tests passed.
- [ ] Payment webhook signature verification tested.
- [ ] WhatsApp opt-in/opt-out tested.
- [ ] Clinical sign-off workflow tested.


## 13. v0.2 security/compliance additions for overlay integrations

The overlay strategy introduces extra compliance obligations because ClinicOS may read from or act across external systems.

### 13.1 External-system legal guardrails

- Do not rely on unauthorized scraping, credential sharing, or terms-violating browser automation.
- Prefer official APIs, OAuth, webhooks, exports, clinic-authorized CSV uploads, and partner agreements.
- Store external credentials only in encrypted secret storage.
- Record which user connected each external account and what scopes/capabilities were granted.
- Provide disconnect/revoke workflows.

### 13.2 Dual-running and source-of-truth risk

When ClinicOS and an external PMS/calendar both exist, the product must prevent unsafe inconsistency.

Required controls:

- Clinic-level source-of-truth policy per domain.
- Sync status on external links.
- Conflict detection.
- Idempotency keys for imports/webhooks.
- Clear UI warnings when data is stale/imported/read-only.
- Audit trail for all migration and merge decisions.

### 13.3 Acquisition-channel privacy

Lead/source attribution must not become an excuse to over-collect. Store only what is operationally useful:

- Source.
- Timestamp.
- External reference.
- Campaign/referral metadata where known.
- Patient contact and booking status.

Avoid storing unnecessary ad-platform identifiers or sensitive clinical information in marketing systems.

### 13.4 Agent action security

Every AI/tool action must be logged with:

- Actor: user, workflow, AI agent.
- Proposed payload.
- Approval decision.
- Executed payload.
- External provider response.
- Patient/clinic entity affected.
- Timestamp and IP/device where relevant.

Sensitive action categories require stricter rules:

- Clinical note/prescription/treatment plan: doctor sign-off.
- Payment/billing: clinic-configured staff permission.
- External communication: consent/opt-in and template policy.
- ABDM/FHIR data exchange: patient consent and data-sharing audit.

### 13.5 Imported data disclaimer

Historical imported data should be clearly marked as imported/unverified until reviewed. Clinical decisions should not rely on unverified imported notes/images without doctor review.
