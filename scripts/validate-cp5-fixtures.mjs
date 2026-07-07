#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP5_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp5",
  "treatment_checkout_payments_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91995000\d{4}$/;
const REQUIRED_EVENTS = [
  "treatment_plan.created",
  "treatment_plan.accepted",
  "procedure.completed",
  "invoice.created",
  "payment.requested",
  "payment.webhook.rejected",
  "payment.partial_received",
  "payment.transaction_recorded",
  "payment.webhook.replayed",
  "payment.manual_recorded",
  "invoice.paid",
  "receipt.generated",
  "prescription.draft_created",
  "prescription.signed",
  "instruction.generated",
  "instruction.print_requested",
  "instruction.send_requested",
  "outbox.message_queued"
];
const REQUIRED_STEPS = [
  "read-pricebook-procedures",
  "create-treatment-plan-as-doctor",
  "update-treatment-plan-estimate",
  "accept-treatment-plan",
  "record-completed-procedure",
  "create-invoice-from-procedure",
  "read-invoice-before-payment",
  "create-payment-request",
  "reject-bad-signature-webhook",
  "apply-partial-provider-webhook",
  "replay-partial-provider-webhook",
  "record-manual-balance-payment",
  "generate-receipt",
  "create-prescription-draft",
  "sign-prescription-as-doctor",
  "request-instruction-print",
  "request-instruction-send"
];
const CANONICAL_FLOW_ROUTES = [
  "GET /v1/pricebook/procedures",
  "POST /v1/patients/50000000-0000-4000-8000-000000002001/treatment-plans",
  "PATCH /v1/treatment-plans/50000000-0000-4000-8000-000000006001",
  "POST /v1/treatment-plans/50000000-0000-4000-8000-000000006001/accept",
  "POST /v1/encounters/50000000-0000-4000-8000-000000004001/procedures",
  "POST /v1/invoices",
  "GET /v1/invoices/50000000-0000-4000-8000-000000008001",
  "POST /v1/invoices/50000000-0000-4000-8000-000000008001/payment-requests",
  "POST /v1/payment-webhooks/razorpay",
  "POST /v1/payment-webhooks/razorpay",
  "POST /v1/payment-webhooks/razorpay",
  "POST /v1/invoices/50000000-0000-4000-8000-000000008001/manual-payments",
  "POST /v1/invoices/50000000-0000-4000-8000-000000008001/receipts",
  "POST /v1/encounters/50000000-0000-4000-8000-000000004001/prescriptions",
  "POST /v1/prescriptions/50000000-0000-4000-8000-000000013001/sign",
  "POST /v1/patients/50000000-0000-4000-8000-000000002001/instructions",
  "POST /v1/patients/50000000-0000-4000-8000-000000002001/instructions"
];

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    `${label} must include a timezone offset`
  );
}

function assertUniqueEntityId(ids, value, label) {
  assertUuid(value, label);
  assert.ok(!ids.has(value), `${label} duplicates entity id ${value}`);
  ids.add(value);
}

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(keys, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string key`);
  assert.ok(keys.has(value), `${label} references unknown key ${value}`);
}

function byKey(collection, key, label) {
  const match = collection.find((item) => item.key === key);
  assert.ok(match, `Unknown ${label} key: ${key}`);
  return match;
}

function normalizeStatusList(status) {
  return Array.isArray(status) ? status : [status];
}

function assertPositivePaise(value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be integer paise`);
  assert.ok(value > 0, `${label} must be positive`);
}

function flattenEventNames(scenario) {
  const names = new Set();

  for (const step of scenario.flow.steps) {
    for (const eventName of step.expectedEvents ?? []) names.add(eventName);
  }

  return names;
}

function flattenTimelineEntries(scenario) {
  const entries = new Set();

  for (const patient of scenario.patients) {
    for (const entry of patient.timelineSeed ?? []) entries.add(entry.type);
  }

  for (const step of scenario.flow.steps) {
    for (const expectation of step.timelineExpectations ?? []) {
      entries.add(expectation.entryType);
    }
  }

  return entries;
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true, "fixture must be marked local-only");
  assert.equal(scenario.fixtureUse.syntheticOnly, true, "fixture must be marked synthetic-only");
  assert.equal(
    scenario.fixtureUse.productionUseDenied,
    true,
    "fixture must explicitly deny production use"
  );
  assert.deepEqual(
    scenario.fixtureUse.allowedEnvironments,
    ["local", "development", "test", "ci"],
    "fixture environments must be constrained to local/dev/test/ci"
  );

  const serialized = JSON.stringify(scenario);
  const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, TEST_EMAIL_PATTERN, `${email} must use .example.test`);
  }

  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /razorpay_live/i,
    /rzp_live/i,
    /sk_live/i,
    /whatsapp_access_token/i,
    /abha[_-]?(address|number)/i,
    /aadhaar/i,
    /pan[_-]?card/i,
    /upi:\/\/pay/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(serialized),
      false,
      `fixture contains forbidden live-data pattern ${pattern}`
    );
  }
}

export async function loadCp5Scenario(scenarioPath = CP5_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp5Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp5.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);

  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

  const entityIds = new Set();
  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();
  const knownAppointmentIds = new Set();
  const knownEncounterIds = new Set();
  const knownProcedureIds = new Set();
  const knownTreatmentPlanIds = new Set();
  const knownTreatmentPlanPhaseIds = new Set();
  const knownTreatmentPlanItemIds = new Set();
  const knownProcedurePerformedIds = new Set();
  const knownInvoiceIds = new Set();
  const knownInvoiceItemIds = new Set();
  const knownPaymentRequestIds = new Set();
  const knownWebhookEventIds = new Set();
  const knownPaymentTransactionIds = new Set();
  const knownReceiptIds = new Set();
  const knownPrescriptionIds = new Set();
  const knownInstructionTemplateIds = new Set();
  const knownInstructionRequestIds = new Set();

  for (const tenant of scenario.tenants) {
    assertUniqueEntityId(entityIds, tenant.id, `tenant ${tenant.key}.id`);
    knownTenantIds.add(tenant.id);
  }

  for (const clinic of scenario.clinics) {
    assertUniqueEntityId(entityIds, clinic.id, `clinic ${clinic.key}.id`);
    assertKnownReference(knownTenantIds, clinic.tenantId, `clinic ${clinic.key}.tenantId`);
    knownClinicIds.add(clinic.id);
  }

  for (const actor of scenario.actors) {
    assertUniqueEntityId(entityIds, actor.id, `actor ${actor.key}.id`);
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email must be synthetic`);
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    knownActorKeys.add(actor.key);
  }

  for (const patient of scenario.patients) {
    assertUniqueEntityId(entityIds, patient.id, `patient ${patient.key}.id`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.match(
      patient.phone,
      TEST_PHONE_PATTERN,
      `patient ${patient.key}.phone must use reserved CP5 fixture range`
    );
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    knownPatientIds.add(patient.id);

    for (const entry of patient.timelineSeed ?? []) {
      assertIsoWithOffset(entry.occurredAt, `patient ${patient.key}.timelineSeed.occurredAt`);
    }
  }

  for (const appointment of scenario.appointments) {
    assertUniqueEntityId(entityIds, appointment.id, `appointment ${appointment.key}.id`);
    assertKnownReference(
      knownTenantIds,
      appointment.tenantId,
      `appointment ${appointment.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      appointment.clinicId,
      `appointment ${appointment.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      appointment.patientId,
      `appointment ${appointment.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      appointment.providerActorKey,
      `appointment ${appointment.key}.providerActorKey`
    );
    assertIsoWithOffset(
      appointment.scheduledStart,
      `appointment ${appointment.key}.scheduledStart`
    );
    assertIsoWithOffset(appointment.scheduledEnd, `appointment ${appointment.key}.scheduledEnd`);
    assert.ok(
      appointment.statusSequence.includes("encounter_started"),
      `appointment ${appointment.key} must reach encounter_started`
    );
    knownAppointmentIds.add(appointment.id);
  }

  for (const encounter of scenario.encounters) {
    assertUniqueEntityId(entityIds, encounter.id, `encounter ${encounter.key}.id`);
    assertKnownReference(knownTenantIds, encounter.tenantId, `encounter ${encounter.key}.tenantId`);
    assertKnownReference(knownClinicIds, encounter.clinicId, `encounter ${encounter.key}.clinicId`);
    assertKnownReference(
      knownPatientIds,
      encounter.patientId,
      `encounter ${encounter.key}.patientId`
    );
    assertKnownReference(
      knownAppointmentIds,
      encounter.appointmentId,
      `encounter ${encounter.key}.appointmentId`
    );
    assertKnownKey(
      knownActorKeys,
      encounter.providerActorKey,
      `encounter ${encounter.key}.providerActorKey`
    );
    assertIsoWithOffset(encounter.startedAt, `encounter ${encounter.key}.startedAt`);
    assert.ok(
      encounter.lifecycle.includes("checkout"),
      `encounter ${encounter.key} must include checkout`
    );
    knownEncounterIds.add(encounter.id);
  }

  for (const procedure of scenario.pricebookProcedures) {
    assertUniqueEntityId(entityIds, procedure.id, `pricebookProcedure ${procedure.key}.id`);
    assert.match(procedure.code, /^DENT-/, `pricebookProcedure ${procedure.key} needs dental code`);
    assert.equal(procedure.currency, "INR", `pricebookProcedure ${procedure.key} currency`);
    assertPositivePaise(procedure.amountPaise, `pricebookProcedure ${procedure.key}.amountPaise`);
    assert.equal(procedure.active, true, `pricebookProcedure ${procedure.key} must be active`);
    knownProcedureIds.add(procedure.id);
  }

  for (const treatmentPlan of scenario.treatmentPlans) {
    assertUniqueEntityId(entityIds, treatmentPlan.id, `treatmentPlan ${treatmentPlan.key}.id`);
    assertKnownReference(
      knownTenantIds,
      treatmentPlan.tenantId,
      `treatmentPlan ${treatmentPlan.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      treatmentPlan.clinicId,
      `treatmentPlan ${treatmentPlan.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      treatmentPlan.patientId,
      `treatmentPlan ${treatmentPlan.key}.patientId`
    );
    assertKnownReference(
      knownEncounterIds,
      treatmentPlan.encounterId,
      `treatmentPlan ${treatmentPlan.key}.encounterId`
    );
    assertKnownKey(
      knownActorKeys,
      treatmentPlan.createdByActorKey,
      `treatmentPlan ${treatmentPlan.key}.createdByActorKey`
    );
    assertKnownKey(
      knownActorKeys,
      treatmentPlan.acceptedByActorKey,
      `treatmentPlan ${treatmentPlan.key}.acceptedByActorKey`
    );
    assertIsoWithOffset(treatmentPlan.createdAt, `treatmentPlan ${treatmentPlan.key}.createdAt`);
    assertIsoWithOffset(treatmentPlan.acceptedAt, `treatmentPlan ${treatmentPlan.key}.acceptedAt`);
    assert.equal(treatmentPlan.status, "accepted", `treatmentPlan ${treatmentPlan.key}`);
    assertPositivePaise(treatmentPlan.totalEstimatePaise, `treatmentPlan ${treatmentPlan.key}`);
    knownTreatmentPlanIds.add(treatmentPlan.id);
  }

  for (const phase of scenario.treatmentPlanPhases) {
    assertUniqueEntityId(entityIds, phase.id, `treatmentPlanPhase ${phase.key}.id`);
    assertKnownReference(
      knownTreatmentPlanIds,
      phase.treatmentPlanId,
      `treatmentPlanPhase ${phase.key}.treatmentPlanId`
    );
    assert.equal(Number.isInteger(phase.sequence), true, `phase ${phase.key} sequence`);
    assertPositivePaise(phase.estimateTotalPaise, `phase ${phase.key}.estimateTotalPaise`);
    knownTreatmentPlanPhaseIds.add(phase.id);
  }

  for (const item of scenario.treatmentPlanItems) {
    assertUniqueEntityId(entityIds, item.id, `treatmentPlanItem ${item.key}.id`);
    assertKnownReference(
      knownTreatmentPlanIds,
      item.treatmentPlanId,
      `treatmentPlanItem ${item.key}.treatmentPlanId`
    );
    assertKnownReference(
      knownTreatmentPlanPhaseIds,
      item.phaseId,
      `treatmentPlanItem ${item.key}.phaseId`
    );
    assertKnownReference(
      knownProcedureIds,
      item.procedureId,
      `treatmentPlanItem ${item.key}.procedureId`
    );
    assert.equal(Number.isInteger(item.quantity), true, `item ${item.key}.quantity`);
    assert.ok(item.quantity > 0, `item ${item.key}.quantity must be positive`);
    assertPositivePaise(item.unitAmountPaise, `item ${item.key}.unitAmountPaise`);
    assert.equal(
      item.totalAmountPaise,
      item.unitAmountPaise * item.quantity,
      `item ${item.key} total must equal unit * quantity`
    );
    knownTreatmentPlanItemIds.add(item.id);
  }

  for (const plan of scenario.treatmentPlans) {
    const itemTotal = scenario.treatmentPlanItems
      .filter((item) => item.treatmentPlanId === plan.id)
      .reduce((sum, item) => sum + item.totalAmountPaise, 0);
    assert.equal(plan.totalEstimatePaise, itemTotal, `treatmentPlan ${plan.key} estimate total`);
  }

  for (const procedure of scenario.proceduresPerformed) {
    assertUniqueEntityId(entityIds, procedure.id, `procedurePerformed ${procedure.key}.id`);
    assertKnownReference(
      knownTenantIds,
      procedure.tenantId,
      `procedurePerformed ${procedure.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      procedure.clinicId,
      `procedurePerformed ${procedure.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      procedure.patientId,
      `procedurePerformed ${procedure.key}.patientId`
    );
    assertKnownReference(
      knownEncounterIds,
      procedure.encounterId,
      `procedurePerformed ${procedure.key}.encounterId`
    );
    assertKnownReference(
      knownTreatmentPlanIds,
      procedure.treatmentPlanId,
      `procedurePerformed ${procedure.key}.treatmentPlanId`
    );
    assertKnownReference(
      knownTreatmentPlanItemIds,
      procedure.treatmentPlanItemId,
      `procedurePerformed ${procedure.key}.treatmentPlanItemId`
    );
    assertKnownReference(
      knownProcedureIds,
      procedure.procedureId,
      `procedurePerformed ${procedure.key}.procedureId`
    );
    assertKnownKey(
      knownActorKeys,
      procedure.performedByActorKey,
      `procedurePerformed ${procedure.key}.performedByActorKey`
    );
    assertIsoWithOffset(procedure.completedAt, `procedurePerformed ${procedure.key}.completedAt`);
    assertPositivePaise(procedure.billableAmountPaise, `procedurePerformed ${procedure.key}`);
    assert.equal(procedure.status, "completed", `procedurePerformed ${procedure.key}`);
    knownProcedurePerformedIds.add(procedure.id);
  }

  for (const invoice of scenario.invoices) {
    assertUniqueEntityId(entityIds, invoice.id, `invoice ${invoice.key}.id`);
    assertKnownReference(knownTenantIds, invoice.tenantId, `invoice ${invoice.key}.tenantId`);
    assertKnownReference(knownClinicIds, invoice.clinicId, `invoice ${invoice.key}.clinicId`);
    assertKnownReference(knownPatientIds, invoice.patientId, `invoice ${invoice.key}.patientId`);
    assertKnownKey(
      knownActorKeys,
      invoice.createdByActorKey,
      `invoice ${invoice.key}.createdByActorKey`
    );
    assertIsoWithOffset(invoice.createdAt, `invoice ${invoice.key}.createdAt`);
    assert.equal(invoice.currency, "INR", `invoice ${invoice.key}.currency`);
    assertPositivePaise(invoice.totalAmountPaise, `invoice ${invoice.key}.totalAmountPaise`);
    assert.equal(
      invoice.totalAmountPaise,
      invoice.subtotalPaise + invoice.taxPaise,
      `invoice ${invoice.key} total`
    );
    for (const procedureId of invoice.sourceProcedureIds) {
      assertKnownReference(knownProcedurePerformedIds, procedureId, `invoice ${invoice.key}`);
    }
    for (const history of invoice.stateHistory) {
      assertIsoWithOffset(history.occurredAt, `invoice ${invoice.key}.stateHistory.occurredAt`);
    }
    assert.ok(
      invoice.stateHistory.some((history) => history.state === "partially_paid"),
      `invoice ${invoice.key} must include partial state`
    );
    assert.ok(
      invoice.stateHistory.some((history) => history.state === "paid"),
      `invoice ${invoice.key} must include paid state`
    );
    knownInvoiceIds.add(invoice.id);
  }

  for (const item of scenario.invoiceItems) {
    assertUniqueEntityId(entityIds, item.id, `invoiceItem ${item.key}.id`);
    assertKnownReference(knownInvoiceIds, item.invoiceId, `invoiceItem ${item.key}.invoiceId`);
    assertKnownReference(
      knownProcedurePerformedIds,
      item.procedurePerformedId,
      `invoiceItem ${item.key}.procedurePerformedId`
    );
    assert.equal(
      item.totalAmountPaise,
      item.unitAmountPaise * item.quantity,
      `invoiceItem ${item.key} total must equal unit * quantity`
    );
    knownInvoiceItemIds.add(item.id);
  }

  assert.ok(knownInvoiceItemIds.size > 0, "fixture must include invoice items");

  for (const invoice of scenario.invoices) {
    const itemTotal = scenario.invoiceItems
      .filter((item) => item.invoiceId === invoice.id)
      .reduce((sum, item) => sum + item.totalAmountPaise, 0);
    assert.equal(invoice.totalAmountPaise, itemTotal, `invoice ${invoice.key} item total`);
  }

  for (const request of scenario.paymentRequests) {
    assertUniqueEntityId(entityIds, request.id, `paymentRequest ${request.key}.id`);
    assertKnownReference(
      knownInvoiceIds,
      request.invoiceId,
      `paymentRequest ${request.key}.invoiceId`
    );
    assertKnownReference(knownTenantIds, request.tenantId, `paymentRequest ${request.key}`);
    assertKnownReference(knownClinicIds, request.clinicId, `paymentRequest ${request.key}`);
    assertKnownReference(knownPatientIds, request.patientId, `paymentRequest ${request.key}`);
    assertKnownKey(
      knownActorKeys,
      request.requestedByActorKey,
      `paymentRequest ${request.key}.requestedByActorKey`
    );
    assert.equal(request.provider, "razorpay", `paymentRequest ${request.key}.provider`);
    assert.equal(request.mode, "payment_link_qr", `paymentRequest ${request.key}.mode`);
    assert.equal(request.providerVerificationRequired, true);
    assert.match(
      request.patientVisibleUrlSynthetic,
      /^https:\/\/payments\.example\.test\//,
      `paymentRequest ${request.key} must use synthetic payment URL`
    );
    assertIsoWithOffset(request.requestedAt, `paymentRequest ${request.key}.requestedAt`);
    knownPaymentRequestIds.add(request.id);
  }

  for (const webhook of scenario.paymentWebhookEvents) {
    assertUniqueEntityId(entityIds, webhook.id, `paymentWebhookEvent ${webhook.key}.id`);
    assertKnownReference(
      knownPaymentRequestIds,
      webhook.paymentRequestId,
      `paymentWebhookEvent ${webhook.key}.paymentRequestId`
    );
    assertKnownReference(
      knownInvoiceIds,
      webhook.invoiceId,
      `paymentWebhookEvent ${webhook.key}.invoiceId`
    );
    assertIsoWithOffset(webhook.receivedAt, `paymentWebhookEvent ${webhook.key}.receivedAt`);
    assert.match(webhook.rawPayloadHash, /^sha256:/, `webhook ${webhook.key} raw hash`);

    if (webhook.signatureVerified === false) {
      assert.equal(webhook.accepted, false, `unverified webhook ${webhook.key} cannot be accepted`);
      assert.equal(
        webhook.createdTransactionId,
        null,
        `unverified webhook ${webhook.key} cannot create a transaction`
      );
      assert.notEqual(
        webhook.invoiceStateAfterEvent,
        "paid",
        `unverified webhook ${webhook.key} cannot mark paid`
      );
    }

    if (webhook.replayOfWebhookEventId) {
      assertKnownReference(
        knownWebhookEventIds,
        webhook.replayOfWebhookEventId,
        `paymentWebhookEvent ${webhook.key}.replayOfWebhookEventId`
      );
      assert.equal(webhook.duplicateIgnored, true, `replay ${webhook.key} must be ignored`);
      assert.equal(
        webhook.createdTransactionId,
        null,
        `replay ${webhook.key} cannot create a second transaction`
      );
    }

    knownWebhookEventIds.add(webhook.id);
  }

  for (const transaction of scenario.paymentTransactions) {
    assertUniqueEntityId(entityIds, transaction.id, `paymentTransaction ${transaction.key}.id`);
    assertKnownReference(
      knownInvoiceIds,
      transaction.invoiceId,
      `paymentTransaction ${transaction.key}.invoiceId`
    );
    assertPositivePaise(transaction.amountPaise, `paymentTransaction ${transaction.key}.amount`);
    assert.equal(transaction.currency, "INR", `paymentTransaction ${transaction.key}.currency`);
    assertIsoWithOffset(transaction.recordedAt, `paymentTransaction ${transaction.key}.recordedAt`);

    if (transaction.source === "provider_webhook") {
      assertKnownReference(
        knownPaymentRequestIds,
        transaction.paymentRequestId,
        `paymentTransaction ${transaction.key}.paymentRequestId`
      );
      assert.equal(transaction.provider, "razorpay", `paymentTransaction ${transaction.key}`);
      assert.equal(transaction.signatureVerified, true, `provider transaction ${transaction.key}`);
      assert.ok(transaction.providerEventId, `provider transaction ${transaction.key}`);
    }

    if (transaction.source === "manual") {
      assert.equal(transaction.provider, "manual", `manual transaction ${transaction.key}`);
      assertKnownKey(
        knownActorKeys,
        transaction.capturedByActorKey,
        `manual transaction ${transaction.key}.capturedByActorKey`
      );
      assert.ok(transaction.method, `manual transaction ${transaction.key} needs method`);
      assert.ok(transaction.reference, `manual transaction ${transaction.key} needs reference`);
      assert.ok(transaction.reason, `manual transaction ${transaction.key} needs reason`);
    }

    knownPaymentTransactionIds.add(transaction.id);
  }

  for (const receipt of scenario.receipts) {
    assertUniqueEntityId(entityIds, receipt.id, `receipt ${receipt.key}.id`);
    assertKnownReference(knownInvoiceIds, receipt.invoiceId, `receipt ${receipt.key}.invoiceId`);
    assertKnownReference(knownPatientIds, receipt.patientId, `receipt ${receipt.key}.patientId`);
    assertKnownKey(
      knownActorKeys,
      receipt.generatedByActorKey,
      `receipt ${receipt.key}.generatedByActorKey`
    );
    assertIsoWithOffset(receipt.generatedAt, `receipt ${receipt.key}.generatedAt`);
    for (const transactionId of receipt.paymentTransactionIds) {
      assertKnownReference(
        knownPaymentTransactionIds,
        transactionId,
        `receipt ${receipt.key}.paymentTransactionIds`
      );
    }
    const receiptTotal = scenario.paymentTransactions
      .filter((transaction) => receipt.paymentTransactionIds.includes(transaction.id))
      .reduce((sum, transaction) => sum + transaction.amountPaise, 0);
    assert.equal(receipt.totalPaidPaise, receiptTotal, `receipt ${receipt.key} total`);
    knownReceiptIds.add(receipt.id);
  }

  for (const prescription of scenario.prescriptions) {
    assertUniqueEntityId(entityIds, prescription.id, `prescription ${prescription.key}.id`);
    assertKnownReference(
      knownTenantIds,
      prescription.tenantId,
      `prescription ${prescription.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      prescription.clinicId,
      `prescription ${prescription.key}.clinicId`
    );
    assertKnownReference(
      knownEncounterIds,
      prescription.encounterId,
      `prescription ${prescription.key}.encounterId`
    );
    assertKnownReference(
      knownPatientIds,
      prescription.patientId,
      `prescription ${prescription.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      prescription.createdByActorKey,
      `prescription ${prescription.key}.createdByActorKey`
    );
    assertIsoWithOffset(prescription.createdAt, `prescription ${prescription.key}.createdAt`);
    assert.ok(prescription.items.length > 0, `prescription ${prescription.key} needs items`);

    if (prescription.status === "signed") {
      assertKnownKey(
        knownActorKeys,
        prescription.signedByActorKey,
        `prescription ${prescription.key}.signedByActorKey`
      );
      assertIsoWithOffset(prescription.signedAt, `prescription ${prescription.key}.signedAt`);
      assert.match(prescription.signedHash, /^sha256:/, "signed prescription needs hash");
    }

    knownPrescriptionIds.add(prescription.id);
  }

  for (const template of scenario.instructionTemplates) {
    assertUniqueEntityId(entityIds, template.id, `instructionTemplate ${template.key}.id`);
    assertKnownKey(
      knownActorKeys,
      template.approvedByActorKey,
      `instructionTemplate ${template.key}.approvedByActorKey`
    );
    assertIsoWithOffset(template.approvedAt, `instructionTemplate ${template.key}.approvedAt`);
    assert.equal(
      template.requiresProviderConfirmationForDeliveredStatus,
      true,
      `template ${template.key} must require provider confirmation`
    );
    knownInstructionTemplateIds.add(template.id);
  }

  for (const request of scenario.instructionRequests) {
    assertUniqueEntityId(entityIds, request.id, `instructionRequest ${request.key}.id`);
    assertKnownReference(
      knownPatientIds,
      request.patientId,
      `instructionRequest ${request.key}.patientId`
    );
    assertKnownReference(
      knownInstructionTemplateIds,
      request.templateId,
      `instructionRequest ${request.key}.templateId`
    );
    assertKnownReference(
      knownPrescriptionIds,
      request.prescriptionId,
      `instructionRequest ${request.key}.prescriptionId`
    );
    assertKnownReference(knownReceiptIds, request.receiptId, `instructionRequest ${request.key}`);
    assertKnownKey(
      knownActorKeys,
      request.requestedByActorKey,
      `instructionRequest ${request.key}.requestedByActorKey`
    );
    assertIsoWithOffset(request.requestedAt, `instructionRequest ${request.key}.requestedAt`);

    if (request.channel === "print") {
      assert.ok(request.printJobId, `print instruction ${request.key} needs printJobId`);
      assertIsoWithOffset(request.renderedAt, `print instruction ${request.key}.renderedAt`);
      assert.equal(request.status, "ready_for_print", `print instruction ${request.key}`);
    }

    if (request.channel === "whatsapp") {
      assert.equal(
        request.providerConfirmationReceived,
        false,
        `send request ${request.key} must not have provider confirmation`
      );
      assert.equal(request.deliveryClaimed, false, `send request ${request.key} cannot claim sent`);
      assert.equal(
        request.patientVisibleDeliveryStatus,
        "requested",
        `send request ${request.key} must be request-only`
      );
      assert.equal(
        request.outboxEventType,
        "instruction.send_requested",
        `send request ${request.key} must use send-request outbox evidence`
      );
      assert.ok(
        !["sent", "delivered", "read"].includes(request.status),
        `send request ${request.key} cannot claim provider delivery`
      );
    }

    knownInstructionRequestIds.add(request.id);
  }

  assert.ok(knownInstructionRequestIds.size >= 2, "fixture must include print and send requests");

  const successfulPaymentTotal = scenario.paymentTransactions
    .filter((transaction) => transaction.status === "succeeded")
    .reduce((sum, transaction) => sum + transaction.amountPaise, 0);
  const invoice = byKey(scenario.invoices, "rctInvoice", "invoice");
  assert.equal(invoice.paidAmountPaise, successfulPaymentTotal, "invoice paid amount");
  assert.equal(
    invoice.outstandingAmountPaise,
    invoice.totalAmountPaise - successfulPaymentTotal,
    "invoice outstanding amount"
  );

  assert.deepEqual(
    scenario.flow.steps.map((step) => step.key),
    REQUIRED_STEPS,
    "CP5 flow step order changed unexpectedly"
  );
  assert.deepEqual(
    scenario.flow.steps.map((step) => `${step.method} ${step.path}`),
    CANONICAL_FLOW_ROUTES,
    "CP5 flow routes must match the launch-packet route family"
  );
  assert.deepEqual(
    scenario.flow.actorSequence,
    scenario.flow.steps.map((step) => step.actorKey),
    "actorSequence must mirror step actor keys"
  );

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `flow step ${step.key}.actorKey`);
    assert.ok(step.method && step.path, `flow step ${step.key} must declare method/path`);
    assert.ok(step.idempotencyKey, `flow step ${step.key} must declare idempotencyKey`);
    assert.ok(
      normalizeStatusList(step.expectedStatus).every((status) => Number.isInteger(status)),
      `flow step ${step.key} must declare integer expectedStatus`
    );
    assert.ok(
      Array.isArray(step.expectedEvents),
      `flow step ${step.key} must declare expectedEvents`
    );
    assert.ok(
      Array.isArray(step.expectedAudit),
      `flow step ${step.key} must declare expectedAudit`
    );
    if (step.method !== "GET") {
      assert.ok(step.requestBody, `flow step ${step.key} must declare requestBody`);
    }
    if (step.providerWebhook === true) {
      assert.equal(step.path, "/v1/payment-webhooks/razorpay");
      assert.ok(
        step.requestHeaders?.["X-Razorpay-Signature"],
        `provider webhook step ${step.key} needs signature header fixture`
      );
    }

    for (const event of step.expectedAudit) {
      assert.ok(event.action, `flow step ${step.key} audit event needs action`);
      assert.ok(event.resourceType, `flow step ${step.key} audit event needs resourceType`);
      assert.ok(
        Array.isArray(event.phiFields),
        `flow step ${step.key} audit event needs phiFields`
      );
      if (UUID_PATTERN.test(event.resourceId)) {
        assertUuid(event.resourceId, `flow step ${step.key} audit resourceId`);
      }
    }

    for (const expectation of step.timelineExpectations) {
      assertKnownReference(
        knownPatientIds,
        expectation.patientId,
        `flow step ${step.key}.timeline.patientId`
      );
      assert.ok(expectation.entryType, `flow step ${step.key}.timeline entryType`);
    }
  }

  const eventNames = flattenEventNames(scenario);
  for (const eventName of REQUIRED_EVENTS) {
    assert.ok(eventNames.has(eventName), `fixture must expect ${eventName}`);
  }
  assert.equal(eventNames.has("instruction.sent"), false, "fixture must not fake sent status");

  const timelineEntries = flattenTimelineEntries(scenario);
  for (const entryType of scenario.responseAssertions.timeline.checkoutPatientMustInclude) {
    assert.ok(timelineEntries.has(entryType), `fixture must require ${entryType} timeline entry`);
  }

  for (const expectation of scenario.roleTenantExpectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `role expectation ${expectation.key}`);
    assertKnownReference(
      knownTenantIds,
      expectation.targetTenantId,
      `role expectation ${expectation.key}.targetTenantId`
    );
    assertKnownReference(
      knownClinicIds,
      expectation.targetClinicId,
      `role expectation ${expectation.key}.targetClinicId`
    );
    assert.ok(
      expectation.requiredPermissions.length > 0,
      `role expectation ${expectation.key} needs permissions`
    );
    assert.ok(
      ["allow", "deny"].includes(expectation.expected),
      `role expectation ${expectation.key} expected must be allow/deny`
    );
    if (expectation.expected === "deny") {
      assert.ok(expectation.expectedReason, `denial ${expectation.key} needs expectedReason`);
      assert.ok(expectation.method && expectation.path, `denial ${expectation.key} needs request`);
      assert.ok(
        normalizeStatusList(expectation.expectedStatus).length > 0,
        `denial ${expectation.key} needs expectedStatus`
      );
    }
  }

  for (const [key, reason] of [
    ["assistant-cannot-sign-prescription", "missing_permission"],
    ["receptionist-cannot-sign-prescription", "missing_permission"],
    ["accountant-cannot-read-treatment-plan-clinical-detail", "missing_permission"],
    ["accountant-cannot-request-instructions", "missing_permission"],
    ["wrong-tenant-assistant-cannot-read-treatment-plan", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-read-invoice", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-create-payment-request", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-create-receipt", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-request-instruction", "tenant_mismatch"]
  ]) {
    assert.equal(
      byKey(scenario.roleTenantExpectations, key, "roleTenantExpectation").expectedReason,
      reason
    );
  }

  assertPaymentIntegrity(scenario);
  assertInstructionDelivery(scenario);

  assert.ok(
    scenario.e2eSelectorContract.requiredTestIds.length >= 30,
    "E2E selector contract must name expected checkout browser workflow selectors"
  );

  return true;
}

function assertPaymentIntegrity(scenario) {
  const assertions = scenario.responseAssertions.paymentIntegrity;
  const badWebhook = byKey(
    scenario.paymentWebhookEvents,
    "badSignatureWebhook",
    "paymentWebhookEvent"
  );
  const partialWebhook = byKey(
    scenario.paymentWebhookEvents,
    "partialPaymentWebhook",
    "paymentWebhookEvent"
  );
  const replayWebhook = byKey(
    scenario.paymentWebhookEvents,
    "partialPaymentReplayWebhook",
    "paymentWebhookEvent"
  );
  const providerTransaction = byKey(
    scenario.paymentTransactions,
    "razorpayPartialPayment",
    "paymentTransaction"
  );
  const manualTransaction = byKey(
    scenario.paymentTransactions,
    "manualBalancePayment",
    "paymentTransaction"
  );
  const finalInvoice = byKey(scenario.invoices, "rctInvoice", "invoice");

  assert.equal(badWebhook.signatureVerified, false);
  assert.equal(badWebhook.createdTransactionId, null);
  assert.equal(badWebhook.invoiceStateAfterEvent, "payment_requested");
  assert.equal(
    assertions.unverifiedWebhookCannotMarkPaid.expectedReason,
    badWebhook.rejectedReason
  );
  assert.equal(assertions.unverifiedWebhookCannotMarkPaid.invoicePaidAmountPaiseAfterAttempt, 0);

  assert.equal(partialWebhook.signatureVerified, true);
  assert.equal(partialWebhook.createdTransactionId, providerTransaction.id);
  assert.equal(partialWebhook.invoiceStateAfterEvent, "partially_paid");
  assert.equal(
    partialWebhook.invoicePaidAmountPaiseAfterEvent,
    assertions.partialPaymentKeepsInvoiceAccurate.paidAmountPaise
  );
  assert.equal(
    partialWebhook.invoiceOutstandingAmountPaiseAfterEvent,
    assertions.partialPaymentKeepsInvoiceAccurate.outstandingAmountPaise
  );
  assert.notEqual(partialWebhook.invoiceStateAfterEvent, "paid");

  assert.equal(replayWebhook.duplicateIgnored, true);
  assert.equal(replayWebhook.replayOfWebhookEventId, partialWebhook.id);
  assert.equal(replayWebhook.createdTransactionId, null);
  assert.equal(
    replayWebhook.invoicePaidAmountPaiseAfterEvent,
    assertions.webhookReplayDoesNotDuplicatePayment.invoicePaidAmountPaiseAfterReplay
  );
  assert.equal(assertions.webhookReplayDoesNotDuplicatePayment.transactionCountAfterReplay, 1);

  assert.equal(manualTransaction.source, "manual");
  assert.ok(manualTransaction.method);
  assert.ok(manualTransaction.reference);
  assert.ok(manualTransaction.reason);
  assert.equal(
    assertions.manualPaymentRequiresAuditEvidence.auditAction,
    "payment.manual_recorded"
  );

  assert.deepEqual(assertions.finalInvoiceState, {
    invoiceId: finalInvoice.id,
    state: "paid",
    totalAmountPaise: finalInvoice.totalAmountPaise,
    paidAmountPaise: finalInvoice.paidAmountPaise,
    outstandingAmountPaise: finalInvoice.outstandingAmountPaise
  });
}

function assertInstructionDelivery(scenario) {
  const assertions = scenario.responseAssertions.instructionDelivery;
  const printRequest = byKey(
    scenario.instructionRequests,
    assertions.printRequestKey,
    "instructionRequest"
  );
  const sendRequest = byKey(
    scenario.instructionRequests,
    assertions.sendRequestKey,
    "instructionRequest"
  );

  for (const field of assertions.printEvidenceFields) {
    assert.ok(printRequest[field], `print request must include ${field}`);
  }

  assert.equal(sendRequest.provider, assertions.requestedProvider);
  assert.equal(sendRequest.providerConfirmationReceived, false);
  assert.equal(sendRequest.patientVisibleDeliveryStatus, assertions.patientVisibleDeliveryStatus);
  assert.equal(sendRequest.deliveryClaimed, false);
  assert.equal(assertions.fakeWhatsAppDeliveryAllowed, false);
  assert.equal(assertions.outboxEventTypes.includes(sendRequest.outboxEventType), true);

  for (const forbiddenStatus of assertions.mustNotClaimStatuses) {
    assert.notEqual(sendRequest.status, forbiddenStatus);
    assert.notEqual(sendRequest.patientVisibleDeliveryStatus, forbiddenStatus);
  }
}

export function summarizeCp5Scenario(scenario) {
  return {
    tenants: scenario.tenants.length,
    clinics: scenario.clinics.length,
    actors: scenario.actors.length,
    patients: scenario.patients.length,
    encounters: scenario.encounters.length,
    pricebookProcedures: scenario.pricebookProcedures.length,
    treatmentPlans: scenario.treatmentPlans.length,
    treatmentPlanItems: scenario.treatmentPlanItems.length,
    proceduresPerformed: scenario.proceduresPerformed.length,
    invoices: scenario.invoices.length,
    paymentRequests: scenario.paymentRequests.length,
    paymentWebhookEvents: scenario.paymentWebhookEvents.length,
    paymentTransactions: scenario.paymentTransactions.length,
    receipts: scenario.receipts.length,
    prescriptions: scenario.prescriptions.length,
    instructionRequests: scenario.instructionRequests.length,
    flowSteps: scenario.flow.steps.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length
  };
}

async function main() {
  const scenario = await loadCp5Scenario();
  validateCp5Scenario(scenario);
  const summary = summarizeCp5Scenario(scenario);
  console.log("CP5 fixture validation passed.");
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
