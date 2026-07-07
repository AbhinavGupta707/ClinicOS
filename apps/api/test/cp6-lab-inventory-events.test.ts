import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug, UUID } from "@clinic-os/domain";
import {
  createCorrectiveAction,
  createIncident,
  createInventoryCheckRun,
  createLabCase,
  createLabReconciliation,
  InMemoryAuditSink,
  listCorrectiveActions,
  listInventoryCheckTemplates,
  listInventoryExceptions,
  listInventoryItems,
  listLabCases,
  listLabVendors,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  updateCorrectiveAction,
  updateInventoryCheckRun,
  updateLabCase,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const tenantId = CHECKPOINT1_SEED_IDS.tenantId;
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

test("CP6 lab workflow creates slip evidence, transitions status, and reconciles vendor invoice", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");

  const vendors = await listLabVendors(assistant, dependencies);
  assert.equal(vendors.status, 200);
  assert.equal(vendors.body.labVendors.length, 1);
  const vendor = vendors.body.labVendors[0];

  const created = await createLabCase(assistant, dependencies, {
    vendorId: vendor.id,
    patientId,
    title: "Zirconia crown for 46",
    priority: "urgent",
    dueAt: "2026-07-10T09:00:00.000Z",
    clinicalNotes: "Prepare margin scan attached in clinic record.",
    internalNotes: "Call patient before fitting slot confirmation.",
    expectedCostMinor: 125000,
    slipMetadata: { generatedBy: "chairside_lab_slip" },
    items: [
      {
        itemType: "crown",
        toothNumber: "46",
        material: "zirconia",
        shade: "A2",
        quantity: 1,
        notes: "High translucency requested."
      }
    ]
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.labCase.labCase.status, "draft");
  assert.match(created.body.labCase.labCase.slipNumber, /^LAB-20260707-/);
  assert.equal(created.body.labCase.items[0].toothNumber, "46");
  assert.equal(created.body.labCase.statusHistory.length, 1);
  assert.doesNotMatch(JSON.stringify(created.body), /Rhea Synthetic|\+919876543210/);

  const labCaseId = created.body.labCase.labCase.id;
  const sent = await updateLabCase(assistant, dependencies, labCaseId, {
    status: "sent_to_lab",
    reason: "Courier pickup recorded",
    evidence: { courierDocket: "SYN-LAB-001" }
  });
  assert.equal(sent.body.labCase.labCase.status, "sent_to_lab");

  await updateLabCase(assistant, dependencies, labCaseId, {
    status: "received_by_lab",
    reason: "Vendor acknowledged receipt",
    evidence: { acknowledgedBy: "Synthetic Crown Lab" }
  });
  await updateLabCase(assistant, dependencies, labCaseId, {
    status: "returned",
    reason: "Restoration received at front desk",
    evidence: { packageSealIntact: true }
  });
  const completed = await updateLabCase(assistant, dependencies, labCaseId, {
    status: "completed",
    reason: "Fitted and accepted chairside",
    evidence: { fittedBy: "seed-doctor" }
  });
  assert.equal(completed.body.labCase.labCase.status, "completed");
  assert.equal(completed.body.labCase.statusHistory.length, 5);

  const listed = await listLabCases(assistant, dependencies, { status: "completed" });
  assert.equal(listed.body.labCases.length, 1);

  const reconciled = await createLabReconciliation(assistant, dependencies, {
    vendorId: vendor.id,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    invoiceReference: "LAB-JUL-SYN-01",
    invoiceAmountMinor: 125000,
    evidence: { uploadedInvoiceKey: "tenant/clinic/lab/lab-jul-syn-01.pdf" },
    entries: [{ labCaseId, invoiceAmountMinor: 125000 }]
  });
  assert.equal(reconciled.status, 201);
  assert.equal(reconciled.body.labReconciliation.reconciliation.status, "matched");
  assert.equal(reconciled.body.labReconciliation.entries[0].status, "matched");

  await assert.rejects(() => listLabVendors(accountant, dependencies), /missing_permission/);
  await assert.rejects(
    () =>
      updateLabCase(wrongTenantDoctorContext(), dependencies, labCaseId, {
        status: "sent_to_lab",
        reason: "Wrong tenant must not see case"
      }),
    (error) => error instanceof Error && "status" in error && error.status === 404
  );

  for (const action of [
    "lab_case.created",
    "lab_slip.generated",
    "lab_case.sent",
    "lab_case.received",
    "lab_case.returned",
    "lab_case.completed",
    "lab_reconciliation.created"
  ]) {
    assert.ok(auditSink.events.some((event) => event.action === action), `${action} audit missing`);
  }
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "lab_case.completed"));
  assert.ok(repository.timelineItems.some((item) => item.itemType === "lab_case_completed"));
});

test("CP6 inventory check records stock variance and suggests procurement without fake purchase execution", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const receptionist = await operationsContext("seed-receptionist");
  const accountant = await operationsContext("seed-accountant");

  const templates = await listInventoryCheckTemplates(receptionist, dependencies);
  assert.equal(templates.status, 200);
  assert.equal(templates.body.templates.length, 1);
  const template = templates.body.templates[0];

  const started = await createInventoryCheckRun(receptionist, dependencies, {
    templateId: template.id,
    notes: "Monthly drawer count before opening."
  });
  assert.equal(started.status, 201);
  assert.equal(started.body.checkRun.run.status, "in_progress");
  const line = started.body.checkRun.lines[0];

  const completed = await updateInventoryCheckRun(
    receptionist,
    dependencies,
    started.body.checkRun.run.id,
    {
      status: "completed",
      notes: "Composite stock below par level.",
      lines: [
        {
          lineId: line.id,
          countedQuantity: 2,
          exceptionNotes: "Only two sealed syringes were present in Drawer A."
        }
      ]
    }
  );

  assert.equal(completed.status, 200);
  assert.equal(completed.body.checkRun.run.status, "completed");
  assert.equal(completed.body.checkRun.lines[0].varianceQuantity, -6);
  assert.equal(completed.body.checkRun.lines[0].exceptionType, "low_stock");
  assert.equal(completed.body.checkRun.procurementSuggestions.length, 1);
  assert.equal(completed.body.checkRun.procurementSuggestions[0].taskId, null);
  assert.equal(repository.tasks.length, 0);

  const exceptions = await listInventoryExceptions(receptionist, dependencies, {
    checkRunId: completed.body.checkRun.run.id
  });
  assert.equal(exceptions.body.exceptions.length, 1);
  assert.equal(exceptions.body.exceptions[0].suggestedTask.status, "suggested_not_created");
  assert.equal(exceptions.body.exceptions[0].procurementSuggestion?.taskId, null);

  const items = await listInventoryItems(receptionist, dependencies);
  assert.equal(items.body.items[0].currentQuantity, 2);

  await assert.rejects(
    () => listInventoryCheckTemplates(accountant, dependencies),
    /missing_permission/
  );
  assert.ok(auditSink.events.some((event) => event.action === "inventory_check.completed"));
  assert.ok(auditSink.events.some((event) => event.action === "inventory.low_stock_detected"));
  assert.ok(auditSink.events.some((event) => event.action === "inventory.procurement_suggested"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "inventory_check.completed"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "inventory.low_stock_detected")
  );
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "inventory.procurement_suggested")
  );
});

test("CP6 incident diary assigns CAPA, exposes overdue state, and resolves only with evidence", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");

  const incident = await createIncident(assistant, dependencies, {
    patientId,
    category: "clinical",
    severity: "high",
    occurredAt: "2026-07-07T09:15:00.000Z",
    location: "Operatory 2",
    summary: "Lab crown returned with marginal discrepancy",
    description: "Doctor rejected crown fit and requested documented vendor follow-up.",
    impact: "Patient fitting delayed.",
    immediateAction: "Temporary crown checked and patient informed.",
    evidence: { chairsideReview: "doctor_reviewed" },
    ownerUserId: CHECKPOINT1_SEED_IDS.users.doctor
  });
  assert.equal(incident.status, 201);
  assert.equal(incident.body.incident.status, "open");

  const correctiveAction = await createCorrectiveAction(assistant, dependencies, {
    incidentId: incident.body.incident.id,
    actionType: "corrective",
    title: "Review lab prep and remake protocol",
    description: "Document discrepancy, request remake, and update vendor checklist.",
    ownerUserId: CHECKPOINT1_SEED_IDS.users.assistant,
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    verificationEvidence: { assignedDuringHuddle: true }
  });
  assert.equal(correctiveAction.status, 201);
  assert.equal(correctiveAction.body.correctiveAction.effectiveStatus, "overdue");
  assert.equal(correctiveAction.body.correctiveAction.overdue, true);
  assert.equal(repository.incidents[0].status, "capa_assigned");

  const listed = await listCorrectiveActions(assistant, dependencies);
  assert.equal(listed.body.correctiveActions[0].effectiveStatus, "overdue");

  const completed = await updateCorrectiveAction(
    assistant,
    dependencies,
    correctiveAction.body.correctiveAction.id,
    {
      status: "completed",
      completionEvidence: {
        remakeRequested: true,
        vendorAcknowledgement: "SYN-LAB-REMAKE-001"
      },
      verificationEvidence: { ownerReviewedAt: "2026-07-07T10:00:00.000Z" }
    }
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.body.correctiveAction.status, "completed");
  assert.equal(completed.body.correctiveAction.overdue, false);
  assert.equal(repository.incidents[0].status, "resolved");
  assert.ok(repository.incidents[0].resolvedAt);

  await assert.rejects(
    () =>
      createIncident(accountant, dependencies, {
        category: "billing",
        severity: "low",
        occurredAt: "2026-07-07T09:30:00.000Z",
        summary: "Accountant should not create CP6 incident",
        description: "Permission boundary check."
      }),
    /missing_permission/
  );

  assert.ok(auditSink.events.some((event) => event.action === "incident.created"));
  assert.ok(auditSink.events.some((event) => event.action === "corrective_action.created"));
  assert.ok(auditSink.events.some((event) => event.action === "corrective_action.completed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "incident.created"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "corrective_action.completed")
  );
  assert.ok(repository.timelineItems.some((item) => item.itemType === "incident_created"));
  assert.ok(
    repository.timelineItems.some((item) => item.itemType === "corrective_action_completed")
  );
});

async function operationsContext(subject: string): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const claims = {
    ...createClaims(subject),
    exp: Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000) + 300
  };
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);
  assert.ok(snapshot);

  return {
    requestId: `req_${subject}`,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function wrongTenantDoctorContext(): OperationsRequestContext {
  const wrongTenantId = "20000000-0000-4000-8000-000000000001" as UUID;
  const wrongClinicId = "20000000-0000-4000-8000-000000000101" as UUID;
  const userId = "20000000-0000-4000-8000-000000001002" as UUID;
  const roleSlug: ClinicRoleSlug = "doctor";
  const principal = principalFromVerifiedKeycloakClaims(createClaims("wrong-tenant-doctor"), {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });

  return {
    requestId: "req_wrong_tenant_doctor",
    accessContext: buildAccessContext({
      principal,
      tenant: {
        id: wrongTenantId,
        slug: "wrong-tenant",
        legalName: "Wrong Tenant Dental Private Limited",
        displayName: "Wrong Tenant",
        status: "active"
      },
      user: {
        id: userId,
        displayName: "Wrong Tenant Doctor",
        email: "wrong-doctor@example.test",
        phone: null,
        status: "active"
      },
      memberships: [{ tenantId: wrongTenantId, userId, status: "active" }],
      clinicAssignments: [{ tenantId: wrongTenantId, clinicId: wrongClinicId, userId, status: "active" }],
      roleAssignments: [{ tenantId: wrongTenantId, clinicId: wrongClinicId, userId, roleSlug }]
    }),
    clinicId: wrongClinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function createClaims(subject: string) {
  const issuedAt = Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000);
  return {
    sub: subject,
    iss: expectedIssuer,
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: issuedAt + 300,
    iat: issuedAt
  };
}
