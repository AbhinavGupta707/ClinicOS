# 09 - API Contracts and Event Taxonomy

**Date:** 2026-07-06

## 1. API style

Use REST + OpenAPI for the first production release. GraphQL can be considered later for complex UI aggregation, but REST is simpler for integrations, audits, and AI coding agents.

All endpoints:

- Require authentication unless public webhook/form endpoint.
- Enforce tenant/clinic permissions.
- Return structured error codes.
- Support idempotency keys for mutating external-facing operations.
- Create audit events for sensitive operations.

## 2. URL conventions

```text
/v1/tenants/{tenantId}/clinics/{clinicId}/...
/v1/patients/{patientId}/...
/v1/webhooks/{provider}/...
```

In implementation, tenant can be inferred from authenticated session, but explicit path or header is useful for service boundaries.

## 3. Core endpoints

### Auth/users

```http
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/me
GET  /v1/users
POST /v1/users
PATCH /v1/users/{userId}
POST /v1/users/{userId}/roles
```

### Patients

```http
GET  /v1/patients?query=&phone=&source=
POST /v1/patients
GET  /v1/patients/{patientId}
PATCH /v1/patients/{patientId}
GET  /v1/patients/{patientId}/timeline
POST /v1/patients/{patientId}/merge
GET  /v1/patients/{patientId}/export
```

### Appointments and queue

```http
GET  /v1/appointments?date=&providerId=&status=
POST /v1/appointments
PATCH /v1/appointments/{appointmentId}
POST /v1/appointments/{appointmentId}/confirm
POST /v1/appointments/{appointmentId}/check-in
POST /v1/appointments/{appointmentId}/mark-no-show
GET  /v1/queue?date=
PATCH /v1/queue/{queueEntryId}
```

### Communication

```http
GET  /v1/conversations
GET  /v1/conversations/{threadId}
POST /v1/conversations/{threadId}/messages
POST /v1/messages/send-template
POST /v1/campaigns
GET  /v1/message-templates
POST /v1/message-templates
```

### Forms/consent

```http
GET  /v1/form-templates
POST /v1/form-templates
POST /v1/patients/{patientId}/form-responses
GET  /v1/patients/{patientId}/consents
POST /v1/patients/{patientId}/consents
POST /v1/patients/{patientId}/consents/{consentId}/revoke
```

### Encounters

```http
POST /v1/encounters
GET  /v1/encounters/{encounterId}
PATCH /v1/encounters/{encounterId}
POST /v1/encounters/{encounterId}/start
POST /v1/encounters/{encounterId}/sign-note
POST /v1/encounters/{encounterId}/amend-note
POST /v1/encounters/{encounterId}/prescriptions
POST /v1/prescriptions/{prescriptionId}/sign
```

### Dental

```http
GET  /v1/patients/{patientId}/dental-chart
POST /v1/patients/{patientId}/dental-findings
PATCH /v1/dental-findings/{findingId}
POST /v1/encounters/{encounterId}/dental-chart-patches/{patchId}/accept
POST /v1/treatment-plans
GET  /v1/treatment-plans/{planId}
PATCH /v1/treatment-plans/{planId}
POST /v1/treatment-plans/{planId}/accept
POST /v1/lab-cases
PATCH /v1/lab-cases/{labCaseId}
```

### Media/documents

```http
POST /v1/media/upload-url
POST /v1/media/complete-upload
GET  /v1/patients/{patientId}/media
PATCH /v1/media/{mediaId}/tags
GET  /v1/media/{mediaId}/signed-url
POST /v1/documents/{documentId}/ocr
```

### Billing/payments

```http
GET  /v1/pricebook
POST /v1/pricebook
POST /v1/invoices
GET  /v1/invoices/{invoiceId}
POST /v1/invoices/{invoiceId}/payment-link
POST /v1/payments/manual
GET  /v1/payments?invoiceId=
```

### Tasks/recalls/SOPs

```http
GET  /v1/tasks?assigneeId=&status=&dueBefore=
POST /v1/tasks
PATCH /v1/tasks/{taskId}
GET  /v1/recalls/due
POST /v1/recalls/{recallId}/send
GET  /v1/sop-runs
POST /v1/sop-runs/{runId}/complete
POST /v1/incidents
PATCH /v1/incidents/{incidentId}
```

### AI

```http
POST /v1/encounters/{encounterId}/ai-sessions
POST /v1/ai-sessions/{sessionId}/audio-chunk
POST /v1/ai-sessions/{sessionId}/complete
GET  /v1/ai-jobs/{jobId}
POST /v1/ai-outputs/{outputId}/review
```

### Webhooks

```http
POST /v1/webhooks/whatsapp/{accountId}
POST /v1/webhooks/razorpay/{accountId}
POST /v1/webhooks/exotel/{accountId}
POST /v1/webhooks/google/{accountId}
```

## 4. Event envelope

All domain events should use a common envelope:

```json
{
  "event_id": "evt_uuid",
  "event_type": "appointment.created",
  "schema_version": "1.0",
  "tenant_id": "uuid",
  "clinic_id": "uuid",
  "actor": {
    "type": "user|system|integration|ai",
    "id": "uuid-or-external"
  },
  "occurred_at": "2026-07-06T10:00:00+05:30",
  "idempotency_key": "optional-key",
  "correlation_id": "trace-or-workflow-id",
  "payload": {}
}
```

## 5. Core event taxonomy

### Patient and appointment

- `patient.created`
- `patient.updated`
- `patient.duplicate_detected`
- `appointment.requested`
- `appointment.created`
- `appointment.confirmed`
- `appointment.rescheduled`
- `appointment.cancelled`
- `appointment.no_show`
- `patient.checked_in`
- `queue.entry_created`
- `queue.entry_called`

### Communication

- `message.received`
- `message.classified`
- `message.draft_created`
- `message.sent`
- `message.delivery_failed`
- `call.incoming`
- `call.missed`
- `call.completed`

### Clinical

- `encounter.created`
- `encounter.started`
- `encounter.completed`
- `clinical_note.draft_created`
- `clinical_note.signed`
- `clinical_note.amended`
- `prescription.draft_created`
- `prescription.signed`
- `procedure.completed`

### Dental

- `dental.finding.created`
- `dental.chart_patch.created`
- `dental.chart_patch.accepted`
- `treatment_plan.created`
- `treatment_plan.accepted`
- `treatment_plan.declined`
- `lab_case.created`
- `lab_case.status_changed`

### Billing/payment

- `invoice.created`
- `payment_link.created`
- `payment.succeeded`
- `payment.failed`
- `payment.refunded`
- `dues.followup_due`

### Inventory/SOP/quality

- `stock_movement.created`
- `inventory.low_stock_detected`
- `inventory.expiry_detected`
- `sop.run_due`
- `sop.run_completed`
- `incident.created`
- `incident.closed`

### AI

- `ai.session.started`
- `ai.transcript.segment_created`
- `ai.output.created`
- `ai.output.reviewed`
- `ai.output.rejected`

### Compliance

- `consent.created`
- `consent.revoked`
- `record.export_requested`
- `record.export_completed`
- `audit.security_event_detected`

## 6. Example payloads

### `message.received`

```json
{
  "provider": "whatsapp_bsp",
  "external_message_id": "wamid.xxx",
  "thread_id": "uuid",
  "patient_id": "uuid-or-null",
  "from_phone": "+91...",
  "body": "Can I get an appointment tomorrow?",
  "media": [],
  "received_at": "2026-07-06T09:01:00+05:30"
}
```

### `appointment.created`

```json
{
  "appointment_id": "uuid",
  "patient_id": "uuid",
  "provider_user_id": "uuid",
  "appointment_type_id": "uuid",
  "start_at": "2026-07-06T17:00:00+05:30",
  "end_at": "2026-07-06T17:30:00+05:30",
  "source": "whatsapp",
  "status": "booked"
}
```

### `ai.output.created`

```json
{
  "ai_job_id": "uuid",
  "encounter_id": "uuid",
  "output_type": "dental_chart_patch",
  "status": "draft",
  "confidence": 0.82,
  "requires_review": true,
  "source_transcript_segment_ids": ["seg_1", "seg_2"]
}
```

### `payment.succeeded`

```json
{
  "provider": "razorpay",
  "invoice_id": "uuid",
  "payment_id": "uuid",
  "external_payment_id": "pay_xxx",
  "external_payment_link_id": "plink_xxx",
  "amount": 250000,
  "currency": "INR",
  "verified_signature": true,
  "paid_at": "2026-07-06T18:10:00+05:30"
}
```

## 7. Webhook processing pseudo-code

```ts
async function handleWebhook(provider, accountId, headers, rawBody) {
  const raw = await rawWebhookEvents.insert({ provider, accountId, headers, rawBody });

  const account = await integrationAccounts.find(accountId);
  const verified = await providers[provider].verifySignature(headers, rawBody, account);
  if (!verified) {
    await rawWebhookEvents.markRejected(raw.id, 'invalid_signature');
    return { status: 401 };
  }

  const normalized = providers[provider].normalize(rawBody);
  const idempotencyKey = normalized.idempotencyKey;

  if (await normalizedEvents.exists(idempotencyKey)) {
    return { status: 200, duplicate: true };
  }

  await db.transaction(async tx => {
    await normalizedEvents.insert(normalized, tx);
    await outbox.insert({ event_type: normalized.eventType, payload: normalized.payload }, tx);
  });

  return { status: 200 };
}
```

## 8. API error format

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to sign prescriptions.",
    "details": {
      "required_permission": "prescription.sign"
    },
    "request_id": "req_..."
  }
}
```

## 9. Idempotency rules

Use idempotency for:

- Appointment creation from external channels.
- Payment link creation.
- Payment webhook processing.
- Message sending.
- AI job submission.
- Data imports.

## 10. Versioning

- API version in URL: `/v1`.
- Event schema version in event envelope.
- AI prompt/schema version stored with outputs.
- Consent template version stored with signed consent.
- Clinical note amendments versioned after sign-off.


## 12. v0.2 API/event additions

### 12.1 External systems

```http
POST /external-systems/accounts
GET /external-systems/accounts
GET /external-systems/accounts/{id}/health
PATCH /external-systems/accounts/{id}/source-of-truth-policy
DELETE /external-systems/accounts/{id}
```

Example source-of-truth policy payload:

```json
{
  "appointments": "clinic_os_primary",
  "historical_records": "archive_only",
  "billing": "clinic_os_primary",
  "practo_leads": "external_primary_readonly"
}
```

### 12.2 Lead inbox

```http
POST /leads
GET /leads?source=practo&status=new
POST /leads/{id}/match-patient
POST /leads/{id}/convert-to-appointment
PATCH /leads/{id}/status
```

Example create lead:

```json
{
  "source": "practo",
  "primaryContact": "+919999999999",
  "intent": "appointment_request",
  "sourceDetail": {
    "externalRef": "optional-practo-booking-id-or-manual-ref",
    "doctorName": "Dr Example",
    "rawNotificationText": "optional"
  }
}
```

### 12.3 Migration

```http
POST /migration-batches
GET /migration-batches/{id}
GET /migration-batches/{id}/rows?matchStatus=conflict
POST /migration-batches/{id}/rows/{rowId}/resolve
POST /migration-batches/{id}/commit
POST /migration-batches/{id}/rollback
```

### 12.4 Workflow definitions and runs

```http
POST /workflow-definitions
GET /workflow-definitions
PATCH /workflow-definitions/{id}
POST /workflow-definitions/{id}/test
GET /workflow-runs?status=waiting_approval
```

### 12.5 Action proposals

```http
GET /action-proposals?status=proposed
POST /action-proposals/{id}/approve
POST /action-proposals/{id}/reject
POST /action-proposals/{id}/edit-and-approve
GET /action-proposals/{id}/audit
```

### 12.6 New canonical events

```text
external.lead.received
external.lead.matched
external.appointment.received
external.import.started
external.import.completed
external.import.conflict_detected
lead.converted_to_appointment
attribution.touch.created
source_of_truth_policy.updated
workflow.definition.created
workflow.run.started
workflow.run.waiting_approval
action.proposal.created
action.proposal.approved
action.proposal.rejected
action.executed
action.execution_failed
```

### 12.7 Event envelope addition

Every event should include source/provenance fields:

```json
{
  "eventId": "uuid",
  "eventType": "external.lead.received",
  "clinicId": "uuid",
  "tenantId": "uuid",
  "occurredAt": "2026-07-06T10:00:00Z",
  "source": {
    "kind": "external_system",
    "providerKey": "practo",
    "externalRef": "optional",
    "rawEventId": "uuid"
  },
  "actor": {
    "type": "system"
  },
  "payload": {}
}
```
