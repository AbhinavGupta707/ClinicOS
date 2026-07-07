import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug, UUID } from "@clinic-os/domain";
import {
  acceptTreatmentPlan,
  createEncounter,
  createEncounterProcedurePerformed,
  createInvoice,
  createInvoiceReceipt,
  createPatientInstruction,
  createPatientTreatmentPlan,
  getInvoice,
  getPatientDentalChart,
  InMemoryAuditSink,
  listPricebookProcedures,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const tenantId = CHECKPOINT1_SEED_IDS.tenantId;
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

test("CP5 billing flow derives invoice and receipt evidence from accepted completed procedures", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const doctor = await operationsContext("seed-doctor");
  const accountant = await operationsContext("seed-accountant");

  const pricebook = await listPricebookProcedures(accountant, dependencies);
  assert.equal(pricebook.status, 200);
  assert.ok(pricebook.body.procedures.length >= 1);
  const procedure = pricebook.body.procedures.find((item) => item.code === "SCALING");
  assert.ok(procedure);

  const encounter = await createEncounter(assistant, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP5 billing evidence flow"
  });

  const plan = await createPatientTreatmentPlan(assistant, dependencies, patientId, {
    encounterId: encounter.body.encounter.id,
    title: "Periodontal therapy plan",
    clinicalSummary: "Chairside periodontal treatment recommendation.",
    status: "presented",
    phases: [
      {
        title: "Initial therapy",
        items: [
          {
            pricebookProcedureId: procedure.id,
            quantity: 1,
            unitPriceMinor: 150000,
            discountMinor: 10000,
            taxRateBasisPoints: 0,
            estimatedVisits: 1,
            priority: "routine",
            notes: "Discussed estimate with patient."
          }
        ]
      }
    ]
  });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.treatmentPlan.totalMinor, 140000);

  const accepted = await acceptTreatmentPlan(doctor, dependencies, plan.body.treatmentPlan.id, {
    acceptedByName: "Rhea Synthetic",
    acceptanceEvidence: { channel: "chairside_signature", capturedBy: "doctor" }
  });
  assert.equal(accepted.body.treatmentPlan.status, "accepted");
  const estimateItem = accepted.body.treatmentPlan.phases[0].estimateItems[0];
  assert.equal(estimateItem.status, "accepted");

  const performed = await createEncounterProcedurePerformed(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {
      treatmentPlanId: accepted.body.treatmentPlan.id,
      treatmentPlanEstimateItemId: estimateItem.id,
      outcome: "Scaling completed.",
      provenance: { source: "chairside_completion" }
    }
  );
  assert.equal(performed.status, 201);
  assert.equal(performed.body.procedure.invoiceId, null);

  await assert.rejects(
    () =>
      createInvoice(accountant, dependencies, {
        patientId,
        items: [{ description: "Arbitrary line item", totalMinor: 1 }]
      }),
    /Invoice line items must be derived/
  );

  const invoice = await createInvoice(accountant, dependencies, {
    treatmentPlanId: accepted.body.treatmentPlan.id
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.invoice.items.length, 1);
  assert.equal(invoice.body.invoice.totalMinor, 140000);
  assert.equal(invoice.body.invoice.balanceMinor, 140000);
  assert.equal(invoice.body.invoice.items[0].procedurePerformedId, performed.body.procedure.id);
  assert.equal(invoice.body.invoice.items[0].description, procedure.displayName);
  assert.doesNotMatch(JSON.stringify(invoice.body.invoice), /Rhea Synthetic|\+919876543210|clinicalSummary|provenance/);

  await assert.rejects(
    () =>
      createInvoice(accountant, dependencies, {
        treatmentPlanId: accepted.body.treatmentPlan.id
      }),
    (error) => error instanceof Error && "status" in error && error.status === 409
  );

  const payment = await repository.recordPaymentTransaction(
    {
      tenantId,
      clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.accountant
    },
    {
      invoiceId: invoice.body.invoice.id,
      provider: "manual",
      amountMinor: invoice.body.invoice.totalMinor,
      currency: "INR",
      method: "cash",
      status: "manually_recorded",
      verificationStatus: "not_required_manual",
      idempotencyKey: "cp5-manual-cash"
    }
  );
  assert.ok(payment);

  const receipt = await createInvoiceReceipt(accountant, dependencies, invoice.body.invoice.id, {
    paymentTransactionIds: [payment.id]
  });
  assert.equal(receipt.status, 201);
  assert.equal(receipt.body.receipt.amountMinor, invoice.body.invoice.totalMinor);
  assert.equal(receipt.body.invoice.paymentStatus, "paid");
  assert.equal(receipt.body.invoice.balanceMinor, 0);
  assert.equal(receipt.body.invoice.receipts.length, 1);

  const accountantInvoiceRead = await getInvoice(accountant, dependencies, invoice.body.invoice.id);
  assert.equal(accountantInvoiceRead.status, 200);
  assert.equal(accountantInvoiceRead.body.invoice.paymentStatus, "paid");
  assert.doesNotMatch(
    JSON.stringify(accountantInvoiceRead.body.invoice),
    /Rhea Synthetic|\+919876543210|clinicalSummary|provenance/
  );

  for (const eventType of [
    "treatment_plan.created",
    "treatment_plan.accepted",
    "procedure.completed",
    "invoice.created",
    "receipt.generated"
  ]) {
    assert.ok(repository.outboxEvents.some((event) => event.eventType === eventType), eventType);
  }

  for (const itemType of [
    "treatment_plan_created",
    "treatment_plan_accepted",
    "procedure_completed",
    "invoice_created",
    "payment_recorded",
    "receipt_generated"
  ]) {
    assert.ok(repository.timelineItems.some((item) => item.itemType === itemType), itemType);
  }

  assert.ok(auditSink.events.some((event) => event.action === "pricebook.procedure_catalog.viewed"));
  assert.ok(auditSink.events.some((event) => event.action === "invoice.created"));
  assert.ok(auditSink.events.some((event) => event.action === "invoice.viewed"));
  assert.ok(auditSink.events.some((event) => event.action === "receipt.generated"));
});

test("CP5 accountant billing access excludes clinical PHI workflows and wrong tenant invoices", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = {
    repository,
    auditSink: new InMemoryAuditSink()
  };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");

  const invoice = await prepareIssuedInvoice(repository, dependencies, assistant);

  await assert.rejects(
    () =>
      createPatientTreatmentPlan(accountant, dependencies, patientId, {
        title: "Unauthorized treatment plan",
        phases: [
          {
            title: "Phase",
            items: [{ pricebookProcedureId: repository.pricebookProcedures[0].id }]
          }
        ]
      }),
    /missing_permission/
  );
  await assert.rejects(
    () => getPatientDentalChart(accountant, dependencies, patientId),
    /missing_permission/
  );

  const accountantRead = await getInvoice(accountant, dependencies, invoice.body.invoice.id);
  assert.equal(accountantRead.status, 200);
  assert.equal(accountantRead.body.invoice.items.length, 1);

  await assert.rejects(
    () => getInvoice(wrongTenantAccountantContext(), dependencies, invoice.body.invoice.id),
    (error) => error instanceof Error && "status" in error && error.status === 404
  );
});

test("CP5 patient instructions create print/send-request evidence without fake delivery", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const receptionist = await operationsContext("seed-receptionist");
  const accountant = await operationsContext("seed-accountant");

  const printInstruction = await createPatientInstruction(assistant, dependencies, patientId, {
    channel: "print",
    templateId: "post-restoration-care",
    title: "Post restoration care",
    body: "Clinic-approved post restoration instructions."
  });
  assert.equal(printInstruction.status, 201);
  assert.equal(printInstruction.body.instruction.status, "ready_for_print");
  assert.ok(printInstruction.body.instruction.printJobId);
  assert.equal(printInstruction.body.instruction.outboxEventId, null);
  assert.equal(printInstruction.body.instruction.providerConfirmationReceived, false);
  assert.equal(printInstruction.body.instruction.deliveredAt, null);
  assert.equal(printInstruction.body.instruction.readAt, null);

  const whatsappInstruction = await createPatientInstruction(receptionist, dependencies, patientId, {
    channel: "whatsapp",
    templateId: "six-month-recall"
  });
  assert.equal(whatsappInstruction.status, 202);
  assert.equal(whatsappInstruction.body.instruction.status, "send_requested");
  assert.equal(whatsappInstruction.body.instruction.printJobId, null);
  assert.ok(whatsappInstruction.body.instruction.outboxEventId);
  assert.equal(whatsappInstruction.body.instruction.providerConfirmationReceived, false);
  assert.equal(whatsappInstruction.body.instruction.deliveredAt, null);
  assert.equal(whatsappInstruction.body.instruction.readAt, null);

  await assert.rejects(
    () =>
      createPatientInstruction(accountant, dependencies, patientId, {
        channel: "print",
        templateId: "accountant-forbidden"
      }),
    /missing_permission/
  );
  await assert.rejects(
    () =>
      createPatientInstruction(wrongTenantAccountantContext(), dependencies, patientId, {
        channel: "print",
        templateId: "wrong-tenant"
      }),
    /missing_permission/
  );

  assert.ok(
    repository.timelineItems.some((item) => item.itemType === "instruction_print_requested")
  );
  assert.ok(repository.timelineItems.some((item) => item.itemType === "instruction_send_requested"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "instruction.print_requested")
  );
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "instruction.send_requested")
  );
  assert.ok(auditSink.events.some((event) => event.action === "instruction.print_requested"));
  assert.ok(auditSink.events.some((event) => event.action === "instruction.send_requested"));
});

async function prepareIssuedInvoice(
  repository: LocalFixtureClinicOperationsRepository,
  dependencies: OperationsDependencies,
  assistant: OperationsRequestContext
) {
  const encounter = await createEncounter(assistant, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP5 accountant access fixture"
  });
  const procedure = repository.pricebookProcedures.find((item) => item.code === "RESTORE-COMP");
  assert.ok(procedure);
  const plan = await createPatientTreatmentPlan(assistant, dependencies, patientId, {
    encounterId: encounter.body.encounter.id,
    title: "Restorative treatment plan",
    phases: [
      {
        title: "Restorative",
        items: [{ pricebookProcedureId: procedure.id, toothNumber: "46" }]
      }
    ]
  });
  const accepted = await acceptTreatmentPlan(assistant, dependencies, plan.body.treatmentPlan.id, {});
  const estimateItem = accepted.body.treatmentPlan.phases[0].estimateItems[0];
  await createEncounterProcedurePerformed(assistant, dependencies, encounter.body.encounter.id, {
    treatmentPlanId: accepted.body.treatmentPlan.id,
    treatmentPlanEstimateItemId: estimateItem.id
  });

  return createInvoice(await operationsContext("seed-accountant"), dependencies, {
    treatmentPlanId: accepted.body.treatmentPlan.id
  });
}

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

function wrongTenantAccountantContext(): OperationsRequestContext {
  const wrongTenantId = "20000000-0000-4000-8000-000000000001" as UUID;
  const wrongClinicId = "20000000-0000-4000-8000-000000000101" as UUID;
  const userId = "20000000-0000-4000-8000-000000001005" as UUID;
  const roleSlug: ClinicRoleSlug = "accountant";
  const principal = principalFromVerifiedKeycloakClaims(createClaims("wrong-tenant-accountant"), {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });

  return {
    requestId: "req_wrong_tenant_accountant",
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
        displayName: "Wrong Tenant Accountant",
        email: "wrong-accounting@example.test",
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
