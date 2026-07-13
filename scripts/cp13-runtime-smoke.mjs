#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { runCp11RuntimeSmoke } from "./cp11-runtime-smoke.mjs";

const baseUrl = process.env.CLINICOS_CP13_API_BASE_URL ?? process.argv[2] ?? "";
const authMode = process.env.CLINICOS_CP13_AUTH_MODE ?? "local-dev-subject";
assert.ok(baseUrl, "CLINICOS_CP13_API_BASE_URL or a base URL argument is required.");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for durable evidence checks.");

const first = await runCp11RuntimeSmoke({ baseUrl, authMode });
const second = await runCp11RuntimeSmoke({ baseUrl, authMode });
assert.notEqual(first.runtimeIds.patientId, second.runtimeIds.patientId);
assert.notEqual(first.runtimeIds.appointmentId, second.runtimeIds.appointmentId);

const smoke = createRuntimeClient(new URL(baseUrl), authMode);
const identities = {
  accountant: await smoke.identity("accountant"),
  assistant: await smoke.identity("assistant"),
  doctor: await smoke.identity("doctor"),
  owner: await smoke.identity("owner"),
  receptionist: await smoke.identity("receptionist")
};
smoke.setIdentities(identities);
const runId = randomUUID();
const key = (suffix) => `cp13-e3-${runId}-${suffix}`;
const clinic = identities.assistant.clinics[0];
assert.ok(clinic?.id && clinic.timezone);
const clinicDate = clinicLocalDate(new Date(), clinic.timezone);
const { patientId, encounterId } = first.runtimeIds;

const formTemplate = await smoke.request("owner", "POST", "/v1/form-templates", {
  expectedStatus: 201,
  idempotencyKey: key("form-template"),
  body: {
    code: `cp13-${runId.slice(0, 8)}`,
    displayName: "CP13 synthetic intake",
    formType: "patient_intake",
    version: 1,
    schema: { fields: [{ key: "synthetic", type: "boolean" }] },
    active: true
  }
});
await smoke.request("assistant", "POST", `/v1/patients/${patientId}/form-responses`, {
  expectedStatus: 201,
  idempotencyKey: key("intake"),
  body: {
    templateId: formTemplate.body.template.id,
    source: "assistant_paper_card",
    responses: { synthetic: true },
    medicalHistorySnapshot: { syntheticOnly: true },
    provenance: { source: "manual_entry", evidence: "cp13_e3" }
  }
});

const accountantClinicalDenial = await smoke.request(
  "accountant",
  "GET",
  `/v1/patients/${patientId}/dental-chart`,
  { expectedStatus: 403 }
);
assert.equal(accountantClinicalDenial.body.error.code, "PERMISSION_DENIED");
const finding = await smoke.request("doctor", "POST", `/v1/patients/${patientId}/dental-findings`, {
  expectedStatus: 201,
  idempotencyKey: key("finding"),
  body: {
    encounterId,
    toothNumber: "16",
    surface: "occlusal",
    findingType: "watch_item",
    source: "manual",
    reviewStatus: "reviewed",
    notes: "Synthetic CP13 durable finding"
  }
});
assert.equal(finding.body.finding.reviewStatus, "reviewed");
const prescription = await smoke.request(
  "doctor",
  "POST",
  `/v1/encounters/${encounterId}/prescriptions`,
  {
    expectedStatus: 201,
    idempotencyKey: key("prescription"),
    body: {
      medications: [{ name: "Synthetic ibuprofen", frequency: "TDS", duration: "3 days" }],
      notes: "Synthetic CP13 prescription evidence only"
    }
  }
);
const prescriptionId = prescription.body.prescription.id;
await smoke.request("assistant", "POST", `/v1/prescriptions/${prescriptionId}/sign`, {
  expectedStatus: 403,
  idempotencyKey: key("prescription-sign-denied")
});
const signedPrescription = await smoke.request(
  "doctor",
  "POST",
  `/v1/prescriptions/${prescriptionId}/sign`,
  { expectedStatus: 200, idempotencyKey: key("prescription-sign") }
);
assert.equal(signedPrescription.body.prescription.status, "signed");

await smoke.request("assistant", "POST", `/v1/patients/${patientId}/consents`, {
  expectedStatus: 201,
  idempotencyKey: key("photo-consent"),
  body: {
    purpose: "photo_capture",
    templateCode: "cp13-photo-capture-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff",
    grantedByName: "CP13 Synthetic Patient",
    relationshipToPatient: "self",
    evidence: { kind: "synthetic_runtime_smoke" },
    provenance: { kind: "manual_entry", evidence: "cp13_e3" }
  }
});
const mediaBytes = Buffer.from("CP13 synthetic intraoral image bytes", "utf8");
const mediaDigest = createHash("sha256").update(mediaBytes).digest("hex");
const mediaReservation = await smoke.request("assistant", "POST", "/v1/media/upload-urls", {
  expectedStatus: 201,
  idempotencyKey: key("media-reserve"),
  body: {
    patientId,
    encounterId,
    dentalFindingId: finding.body.finding.id,
    toothNumber: "16",
    mediaType: "intraoral_photo",
    originalFilename: "cp13-synthetic.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: mediaBytes.byteLength,
    sha256Digest: mediaDigest,
    tags: ["cp13-e3"],
    provenance: { source: "automated_test", evidence: "cp13_e3" }
  }
});
const mediaUploadId = mediaReservation.body.upload.id;
assert.equal(mediaReservation.body.upload.originalFilename, `clinical-media-${mediaUploadId}.jpg`);
assert.doesNotMatch(JSON.stringify(mediaReservation.body), /objectKey|private-test-object/u);
await smoke.binaryRequest(
  "assistant",
  "PUT",
  mediaReservation.body.uploadTarget.uploadUrl,
  mediaBytes,
  { expectedStatus: 200, idempotencyKey: key("media-content") }
);
const mediaCompletion = await smoke.request(
  "assistant",
  "POST",
  `/v1/media/uploads/${mediaUploadId}/complete`,
  {
    expectedStatus: 201,
    idempotencyKey: key("media-complete"),
    body: {
      patientId,
      encounterId,
      contentLength: mediaBytes.byteLength,
      sha256Digest: mediaDigest,
      mimeType: "image/jpeg"
    }
  }
);
assert.equal(mediaCompletion.body.mediaAsset.scanStatus, "pending");
assert.doesNotMatch(JSON.stringify(mediaCompletion.body), /objectKey|storagePath|bucket/u);

const pricebook = await smoke.request("accountant", "GET", "/v1/pricebook/procedures", {
  expectedStatus: 200
});
const procedureCatalog = pricebook.body.procedures.find((entry) => entry.status === "active");
assert.ok(procedureCatalog, "The clean local seed did not expose an active pricebook item.");
const planCreated = await smoke.request(
  "doctor",
  "POST",
  `/v1/patients/${patientId}/treatment-plans`,
  {
    expectedStatus: 201,
    idempotencyKey: key("plan"),
    body: {
      encounterId,
      title: "CP13 synthetic treatment plan",
      clinicalSummary: "Synthetic durable verification only",
      phases: [
        {
          title: "Synthetic phase",
          items: [{ pricebookProcedureId: procedureCatalog.id, toothNumber: "16" }]
        }
      ]
    }
  }
);
const planId = planCreated.body.treatmentPlan.id;
const estimateItemId = planCreated.body.treatmentPlan.phases[0].estimateItems[0].id;
const procedurePerformedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
const planPresented = await smoke.request("doctor", "PATCH", `/v1/treatment-plans/${planId}`, {
  expectedStatus: 200,
  idempotencyKey: key("plan-presented"),
  ifMatch: planCreated.response.headers.get("etag"),
  body: { status: "presented" }
});
await smoke.request("doctor", "POST", `/v1/treatment-plans/${planId}/accept`, {
  expectedStatus: 200,
  idempotencyKey: key("plan-accept"),
  body: { acceptedByName: "CP13 Synthetic Patient", acceptanceEvidence: { source: "paper" } }
});
const performed = await smoke.request(
  "doctor",
  "POST",
  `/v1/encounters/${encounterId}/procedures`,
  {
    expectedStatus: 201,
    idempotencyKey: key("procedure"),
    body: {
      treatmentPlanId: planId,
      treatmentPlanEstimateItemId: estimateItemId,
      performedAt: procedurePerformedAt,
      notes: "Synthetic completion evidence",
      provenance: { source: "manual_entry", evidence: "cp13_e3" }
    }
  }
);
const invoiceCreated = await smoke.request("accountant", "POST", "/v1/invoices", {
  expectedStatus: 201,
  idempotencyKey: key("invoice"),
  body: { treatmentPlanId: planId, procedurePerformedIds: [performed.body.procedure.id] }
});
const invoiceId = invoiceCreated.body.invoice.id;
const paymentIntent = await smoke.request(
  "accountant",
  "POST",
  `/v1/invoices/${invoiceId}/payment-requests`,
  {
    expectedStatus: 202,
    idempotencyKey: key("payment-intent"),
    body: { requestType: "payment_link", amountMinor: 1000, metadata: { evidence: "cp13_e3" } }
  }
);
assert.equal(paymentIntent.body.paymentIntent.status, "pending_provider_request");
const recoveredPaymentRequest = await waitForProviderPaymentRequest(smoke, invoiceId);
assert.equal(recoveredPaymentRequest.provider, "simulator");
assert.equal(recoveredPaymentRequest.status, "provider_created");
// CP15 superseded the CP13 simulator callback with a registration-scoped official provider
// boundary. Keep this older runtime smoke focused on its durable outbound recovery and prove
// that the unsafe global callback alias cannot be revived accidentally. CP15 owns the signed
// inbound, replay and reconciliation evidence on the canonical callback family.
const legacyGlobalCallback = await fetch(new URL("/v1/payment-webhooks/razorpay", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ event: "synthetic_legacy_callback_must_not_route" })
});
assert.equal(legacyGlobalCallback.status, 404);
await smoke.request("assistant", "POST", "/v1/recall-rules", {
  expectedStatus: 201,
  idempotencyKey: key("recall-rule"),
  body: {
    code: `cp13-${runId.slice(0, 8)}`,
    title: "CP13 synthetic procedure recall",
    anchor: "procedure_completed",
    offsetDays: 1,
    pricebookProcedureId: procedureCatalog.id,
    defaultTaskTitle: "CP13 synthetic recall follow-up",
    defaultTaskPriority: "normal"
  }
});
await smoke.request("assistant", "POST", "/v1/recall-rules", {
  expectedStatus: 201,
  idempotencyKey: key("recall-rule-second"),
  body: {
    code: `cp13-b-${runId.slice(0, 8)}`,
    title: "CP13 synthetic secondary procedure recall",
    anchor: "procedure_completed",
    offsetDays: 1,
    pricebookProcedureId: procedureCatalog.id,
    defaultTaskTitle: "CP13 synthetic secondary recall",
    defaultTaskPriority: "normal"
  }
});
const continuityAsOf = new Date().toISOString();
const generatedContinuity = await smoke.request("assistant", "POST", "/v1/tasks/generate-due", {
  expectedStatus: 202,
  idempotencyKey: key("continuity-generate"),
  body: { asOf: continuityAsOf, batchSize: 1 }
});
assert.equal(generatedContinuity.body.complete, false);
assert.ok(generatedContinuity.body.nextCursor);
assert.equal(generatedContinuity.body.processedCount, 1);
assert.equal(
  generatedContinuity.body.recallsCreated.length,
  generatedContinuity.body.recallTasksCreated.length
);
assert.equal(
  generatedContinuity.body.recallsCreated.length +
    generatedContinuity.body.skippedExistingKeys.length,
  1
);
const dueRecalls = await waitForDueRecalls(smoke, 2, performed.body.procedure.id);
const recallId = dueRecalls[0].id;
const completedRecall = await smoke.request(
  "receptionist",
  "POST",
  `/v1/recalls/${recallId}/actions`,
  {
    expectedStatus: 200,
    idempotencyKey: key("recall-complete"),
    body: {
      actionType: "completed",
      method: "phone",
      evidence: {
        method: "manual",
        contactedAt: new Date().toISOString(),
        source: "cp13_synthetic_runtime_smoke"
      },
      notes: "Synthetic CP13 recall completion evidence"
    }
  }
);
assert.equal(completedRecall.body.recall.status, "completed");
await smoke.request("assistant", "POST", `/v1/patients/${patientId}/instructions`, {
  expectedStatus: 201,
  idempotencyKey: key("instructions"),
  body: {
    channel: "print",
    templateId: "cp13-synthetic-post-care",
    title: "Synthetic post-care",
    body: "Synthetic instructions only."
  }
});

const task = await smoke.request("assistant", "POST", "/v1/tasks", {
  expectedStatus: 201,
  idempotencyKey: key("task"),
  body: {
    patientId,
    title: "CP13 synthetic follow-up",
    taskType: "follow_up",
    sourceWorkflow: "manual",
    priority: "normal",
    dueAt: new Date(Date.now() + 86_400_000).toISOString()
  }
});
assert.equal(task.body.task.status, "open");
const sopTemplate = await smoke.request("owner", "POST", "/v1/sop-templates", {
  expectedStatus: 201,
  idempotencyKey: key("sop-template"),
  body: {
    code: `cp13-${runId.slice(0, 8)}`,
    title: "CP13 synthetic opening check",
    items: [{ title: "Confirm synthetic readiness", evidenceRequired: true }]
  }
});
await smoke.request("owner", "POST", "/v1/sop-schedules", {
  expectedStatus: 201,
  idempotencyKey: key("sop-schedule"),
  body: {
    templateId: sopTemplate.body.sopTemplate.id,
    title: "CP13 synthetic daily schedule",
    recurrenceType: "daily",
    dueTime: "00:01",
    timezone: clinic.timezone,
    startsOn: clinicDate,
    assignedToUserId: identities.assistant.user.id,
    defaultTaskPriority: "normal"
  }
});
const generatedSops = await smoke.request("owner", "POST", "/v1/sop-runs/generate-due", {
  expectedStatus: 202,
  idempotencyKey: key("sop-generate"),
  body: { asOf: new Date().toISOString(), batchSize: 25 }
});
assert.equal(generatedSops.body.complete, true);

const labVendor = await smoke.request("owner", "POST", "/v1/lab-vendors", {
  expectedStatus: 201,
  idempotencyKey: key("lab-vendor"),
  body: {
    displayName: `CP13 Synthetic Lab ${runId.slice(0, 8)}`,
    paymentTermsDays: 30
  }
});
const labCase = await smoke.request("assistant", "POST", "/v1/lab-cases", {
  expectedStatus: 201,
  idempotencyKey: key("lab-case"),
  body: {
    vendorId: labVendor.body.labVendor.id,
    patientId,
    encounterId,
    title: "CP13 synthetic lab case",
    priority: "routine",
    dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    expectedCostMinor: 5000,
    slipMetadata: { synthetic: true },
    items: [{ itemType: "synthetic_crown", toothNumber: "16", quantity: 1 }]
  }
});
assert.ok(labCase.body.labCase.labCase?.id ?? labCase.body.labCase.id);

const category = await smoke.request("owner", "POST", "/v1/inventory/categories", {
  expectedStatus: 201,
  idempotencyKey: key("inventory-category"),
  body: {
    code: `cp13-${runId.slice(0, 8)}`,
    displayName: "CP13 synthetic materials",
    kind: "material",
    active: true
  }
});
const item = await smoke.request("owner", "POST", "/v1/inventory/items", {
  expectedStatus: 201,
  idempotencyKey: key("inventory-item"),
  body: {
    categoryId: category.body.category.id,
    sku: `CP13-${runId.slice(0, 8)}`,
    displayName: "CP13 synthetic material",
    unitOfMeasure: "unit",
    storageLocation: "Synthetic drawer",
    trackQuantity: true,
    minimumQuantity: 2,
    reorderQuantity: 5,
    openingQuantity: 1
  }
});
assert.equal(item.body.item.currentQuantity, 1);

const incident = await smoke.request("owner", "POST", "/v1/incidents", {
  expectedStatus: 201,
  idempotencyKey: key("incident"),
  body: {
    patientId,
    category: "operational",
    severity: "low",
    occurredAt: new Date().toISOString(),
    summary: "CP13 synthetic incident",
    description: "Synthetic durable quality evidence only.",
    evidence: { synthetic: true },
    ownerUserId: identities.owner.user.id
  }
});
const capa = await smoke.request("owner", "POST", "/v1/corrective-actions", {
  expectedStatus: 201,
  idempotencyKey: key("capa"),
  body: {
    incidentId: incident.body.incident.id,
    actionType: "corrective",
    title: "Review CP13 synthetic incident",
    description: "Synthetic corrective action evidence.",
    ownerUserId: identities.owner.user.id,
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    verificationEvidence: { synthetic: true }
  }
});
assert.equal(capa.body.correctiveAction.status, "open");

const consents = await smoke.request("assistant", "GET", `/v1/patients/${patientId}/consents`, {
  expectedStatus: 200
});
const treatmentConsent = consents.body.consents.find(
  (candidate) => candidate.purpose === "procedure_treatment" && candidate.status === "active"
);
assert.ok(treatmentConsent?.id);
await smoke.request(
  "assistant",
  "POST",
  `/v1/patients/${patientId}/consents/${treatmentConsent.id}/revoke`,
  {
    expectedStatus: 200,
    idempotencyKey: key("treatment-consent-revoke"),
    body: { reason: "Synthetic CP13 revocation evidence" }
  }
);
const revokedConsentDenial = await smoke.request(
  "doctor",
  "POST",
  `/v1/patients/${patientId}/dental-findings`,
  {
    expectedStatus: 409,
    idempotencyKey: key("finding-revoked-denied"),
    body: {
      encounterId,
      toothNumber: "26",
      findingType: "watch_item",
      source: "manual",
      reviewStatus: "reviewed",
      notes: "This write must not persist after revocation"
    }
  }
);
assert.equal(revokedConsentDenial.body.error.code, "CONFLICT");

const ownerDashboard = await smoke.request(
  "owner",
  "GET",
  `/v1/owner-dashboard?from=${clinicDate}&to=${clinicDate}`,
  { expectedStatus: 200 }
);
assert.equal(ownerDashboard.body.dashboard.freshness.status, "fresh");
assert.doesNotMatch(JSON.stringify(ownerDashboard.body.dashboard), new RegExp(patientId, "u"));
const durableEvidence = await readCp13DurableEvidence(process.env.DATABASE_URL, {
  tenantId: identities.owner.tenant.id,
  clinicId: clinic.id,
  actorUserId: identities.owner.user.id,
  continuityAsOf,
  mediaUploadId,
  paymentIntentId: paymentIntent.body.paymentIntent.id,
  paymentRequestId: recoveredPaymentRequest.id,
  prescriptionId
});
assert.deepEqual(durableEvidence, {
  mediaReceiptCount: 1,
  prescriptionOutboxCount: 1,
  paymentRecoveryCount: 1,
  continuityRecoveryCount: 1
});

console.log(
  JSON.stringify({
    evidence: "CP13-E3-DURABLE-CLINIC-DAY",
    result: "pass",
    baseRuntimePasses: 2,
    firstRuntimeIds: first.runtimeIds,
    secondRuntimeIds: second.runtimeIds,
    treatmentBilling: {
      planId,
      invoiceId,
      paymentIntentId: paymentIntent.body.paymentIntent.id,
      paymentRequestId: recoveredPaymentRequest.id
    },
    clinicalDental: {
      prescriptionId,
      findingId: finding.body.finding.id,
      mediaAssetId: mediaCompletion.body.mediaAsset.id,
      mediaScanStatus: mediaCompletion.body.mediaAsset.scanStatus
    },
    operations: {
      taskId: task.body.task.id,
      recallId,
      labVendorId: labVendor.body.labVendor.id,
      inventoryItemId: item.body.item.id,
      incidentId: incident.body.incident.id,
      correctiveActionId: capa.body.correctiveAction.id
    },
    negativeMatrix: {
      accountantClinicalDenied: true,
      assistantPrescriptionSignatureDenied: true,
      revokedTreatmentConsentDenied: true
    },
    providerBoundaryTransition: {
      legacyGlobalAliasDenied: true,
      officialInboundEvidenceOwnedBy: "CP15"
    },
    durableEvidence,
    fixtureFallback: false
  })
);

async function waitForProviderPaymentRequest(client, invoiceId) {
  let lastInvoice = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await client.request("accountant", "GET", `/v1/invoices/${invoiceId}`, {
      expectedStatus: 200
    });
    lastInvoice = response.body.invoice;
    const paymentRequest = lastInvoice.paymentRequests.find(
      (candidate) => candidate.provider === "simulator" && candidate.providerReferenceId
    );
    if (paymentRequest) return paymentRequest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Temporal worker did not finalize the durable payment request intent: ${JSON.stringify(lastInvoice)}`
  );
}

async function waitForDueRecalls(client, expectedCount, sourceProcedurePerformedId) {
  let lastRecalls = [];
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await client.request("assistant", "GET", "/v1/recalls?status=due&limit=100", {
      expectedStatus: 200
    });
    lastRecalls = response.body.recalls.filter(
      (candidate) => candidate.sourceProcedurePerformedId === sourceProcedurePerformedId
    );
    if (lastRecalls.length >= expectedCount) return lastRecalls;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Temporal worker did not finish bounded continuity due generation: ${JSON.stringify(lastRecalls)}`
  );
}

async function readCp13DurableEvidence(databaseUrl, input) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [input.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [input.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [input.actorUserId]);
    const result = await client.query(
      `select
         (select count(*)::integer from clinical_media_receipts
           where tenant_id = $1 and clinic_id = $2 and upload_id = $3) as media_receipt_count,
         (select count(*)::integer from outbox_events
           where tenant_id = $1 and clinic_id = $2
             and event_type = 'prescription.signed'
             and aggregate_id = $4) as prescription_outbox_count,
         (select count(*)::integer
            from payment_provider_request_intents intent
            join payment_requests request
              on request.tenant_id = intent.tenant_id
             and request.clinic_id = intent.clinic_id
             and request.id = intent.payment_request_id
           where intent.tenant_id = $1 and intent.clinic_id = $2
             and intent.id = $5 and intent.status = 'completed'
             and request.id = $6
             and exists (
               select 1 from outbox_events event
               where event.tenant_id = intent.tenant_id
                 and event.clinic_id = intent.clinic_id
                 and event.aggregate_id = intent.id
                 and event.event_type = 'workflow.cp13.payment_request_recovery.requested'
                 and event.status = 'processed'
             )) as payment_recovery_count,
         (select count(*)::integer from outbox_events
           where tenant_id = $1 and clinic_id = $2
             and event_type = 'workflow.cp13.continuity_due_generation.requested'
             and status = 'processed'
             and payload ->> 'asOf' = $7) as continuity_recovery_count`,
      [
        input.tenantId,
        input.clinicId,
        input.mediaUploadId,
        input.prescriptionId,
        input.paymentIntentId,
        input.paymentRequestId,
        input.continuityAsOf
      ]
    );
    return {
      mediaReceiptCount: result.rows[0].media_receipt_count,
      prescriptionOutboxCount: result.rows[0].prescription_outbox_count,
      paymentRecoveryCount: result.rows[0].payment_recovery_count,
      continuityRecoveryCount: result.rows[0].continuity_recovery_count
    };
  } finally {
    await client.query("rollback");
    await client.end();
  }
}

function createRuntimeClient(apiBaseUrl, selectedAuthMode) {
  let identityByActor = {};
  return {
    setIdentities(value) {
      identityByActor = value;
    },
    identity(actor) {
      return this.request(actor, "GET", "/v1/me", {
        expectedStatus: 200,
        includeClinic: false
      }).then((response) => response.body);
    },
    async request(actor, method, path, options) {
      const headers = { accept: "application/json", ...authHeaders(actor, selectedAuthMode) };
      if (options.body !== undefined) headers["content-type"] = "application/json";
      if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
      if (options.ifMatch) headers["if-match"] = options.ifMatch;
      if (options.includeClinic !== false) {
        const identity = identityByActor[actor];
        assert.ok(identity?.clinics?.[0]?.id, `Identity for ${actor} is not loaded.`);
        headers["x-clinic-id"] = identity.clinics[0].id;
      }
      const response = await fetch(new URL(path, apiBaseUrl), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const body = await parseBody(response);
      assert.equal(
        response.status,
        options.expectedStatus,
        `${method} ${path} expected ${options.expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`
      );
      return { response, body };
    },
    async binaryRequest(actor, method, path, body, options) {
      const identity = identityByActor[actor];
      assert.ok(identity?.clinics?.[0]?.id, `Identity for ${actor} is not loaded.`);
      const response = await fetch(new URL(path, apiBaseUrl), {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/octet-stream",
          "idempotency-key": options.idempotencyKey,
          "x-clinic-id": identity.clinics[0].id,
          ...authHeaders(actor, selectedAuthMode)
        },
        body
      });
      const parsedBody = await parseBody(response);
      assert.equal(
        response.status,
        options.expectedStatus,
        `${method} ${path} expected ${options.expectedStatus}, got ${response.status}: ${JSON.stringify(parsedBody)}`
      );
      return { response, body: parsedBody };
    }
  };
}

function authHeaders(actor, selectedAuthMode) {
  const subjects = {
    accountant: "seed-accountant",
    assistant: "seed-assistant",
    doctor: "seed-doctor",
    owner: "seed-owner",
    receptionist: "seed-receptionist"
  };
  if (selectedAuthMode === "fixture-headers" || selectedAuthMode === "local-dev-subject") {
    return { "x-clinic-os-dev-subject": subjects[actor] };
  }
  const environmentNames = {
    accountant: "CLINICOS_CP10_ACCOUNTANT_TOKEN",
    assistant: "CLINICOS_CP10_ASSISTANT_TOKEN",
    doctor: "CLINICOS_CP10_DOCTOR_TOKEN",
    owner: "CLINICOS_CP10_OWNER_TOKEN",
    receptionist: "CLINICOS_CP10_RECEPTIONIST_TOKEN"
  };
  const token = process.env[environmentNames[actor]];
  assert.ok(token, `Missing ${environmentNames[actor]} for ${actor}.`);
  return { authorization: `Bearer ${token}` };
}

function clinicLocalDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
