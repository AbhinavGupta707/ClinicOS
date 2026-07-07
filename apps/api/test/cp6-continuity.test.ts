import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { UUID } from "@clinic-os/domain";
import {
  acceptTreatmentPlan,
  createEncounter,
  createEncounterProcedurePerformed,
  createInvoice,
  createPatientTreatmentPlan,
  createRecallRule,
  createSopSchedule,
  createSopTemplate,
  createTask,
  generateDueContinuityTasks,
  generateDueSopRuns,
  InMemoryAuditSink,
  listRecalls,
  listTasks,
  listSopRuns,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  recordRecallAction,
  updateSopRun,
  updateTask,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

test("CP6 tasks can be created assigned progressed completed and audited", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");

  const created = await createTask(assistant, dependencies, {
    patientId,
    taskType: "manual",
    sourceWorkflow: "manual",
    title: "Call patient about reports",
    priority: "high",
    dueAt: "2026-07-07T12:00:00.000Z",
    assignedToUserId: CHECKPOINT1_SEED_IDS.users.assistant
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.task.status, "open");
  assert.equal(created.body.task.priority, "high");

  const listed = await listTasks(assistant, dependencies, new URLSearchParams("status=open"));
  assert.equal(listed.body.tasks.length, 1);

  const progressed = await updateTask(assistant, dependencies, created.body.task.id, {
    status: "in_progress"
  });
  assert.equal(progressed.body.task.status, "in_progress");

  const completed = await updateTask(assistant, dependencies, created.body.task.id, {
    status: "done",
    completionEvidence: {
      method: "phone",
      summary: "Patient confirmed they will collect reports at 5 PM."
    }
  });
  assert.equal(completed.body.task.status, "done");
  assert.equal(completed.body.task.completionEvidence.method, "phone");
  assert.ok(auditSink.events.some((event) => event.action === "task.created"));
  assert.ok(auditSink.events.some((event) => event.action === "task.completed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "task.completed"));
  assert.ok(repository.timelineItems.some((item) => item.itemType === "task_completed"));

  await assert.rejects(
    () =>
      createTask(accountant, dependencies, {
        patientId,
        taskType: "manual",
        title: "Forbidden task"
      }),
    /missing_permission/
  );
});

test("CP6 continuity generation creates due recall post-op and payment follow-up tasks idempotently", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");
  const receptionist = await operationsContext("seed-receptionist");

  const prepared = await prepareCompletedProcedureAndInvoice(repository, dependencies, assistant, accountant);
  const recallRule = await createRecallRule(assistant, dependencies, {
    code: "six-month-procedure-recall",
    title: "Six-month procedure recall",
    offsetDays: 183,
    defaultTaskTitle: "Contact patient for six-month recall",
    defaultTaskPriority: "normal"
  });
  assert.equal(recallRule.status, 201);

  const generated = await generateDueContinuityTasks(assistant, dependencies, {
    asOf: "2027-01-15T09:00:00.000Z"
  });
  assert.equal(generated.status, 202);
  assert.equal(generated.body.recallsCreated.length, 1);
  assert.equal(generated.body.recallTasksCreated.length, 1);
  assert.equal(generated.body.followUpTasksCreated.length, 2);
  assert.ok(
    generated.body.followUpTasksCreated.some((task) => task.sourceWorkflow === "post_op_follow_up")
  );
  assert.ok(
    generated.body.followUpTasksCreated.some((task) => task.sourceWorkflow === "payment_follow_up")
  );

  const repeated = await generateDueContinuityTasks(assistant, dependencies, {
    asOf: "2027-01-15T09:00:00.000Z"
  });
  assert.equal(repeated.body.recallsCreated.length, 0);
  assert.equal(repeated.body.recallTasksCreated.length, 0);
  assert.equal(repeated.body.followUpTasksCreated.length, 0);
  assert.ok(repeated.body.skippedExistingKeys.length >= 3);

  const recalls = await listRecalls(assistant, dependencies, new URLSearchParams("status=due"));
  assert.equal(recalls.body.recalls.length, 1);
  assert.equal(recalls.body.recalls[0].sourceProcedurePerformedId, prepared.procedureId);

  const contacted = await recordRecallAction(receptionist, dependencies, recalls.body.recalls[0].id, {
    actionType: "manual_contacted",
    method: "phone",
    notes: "Patient asked for a Saturday slot.",
    evidence: { callOutcome: "interested", providerConfirmationReceived: false }
  });
  assert.equal(contacted.body.recall.status, "contacted");
  assert.equal(contacted.body.recall.actionEvidence.providerConfirmationReceived, false);
  assert.ok(auditSink.events.some((event) => event.action === "recall.sent"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "recall.due"));
  assert.equal(repository.tasks.filter((task) => task.invoiceId === prepared.invoiceId).length, 1);
});

test("CP6 SOP schedules generate retry-safe runs and complete checklist evidence", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");

  const template = await createSopTemplate(assistant, dependencies, {
    code: "weekly-switch-check",
    title: "Weekly switch check",
    items: [
      {
        title: "Check operatory switches",
        instructions: "Walk all operatories.",
        evidenceRequired: true
      },
      {
        title: "Record exceptions",
        evidenceRequired: false
      }
    ]
  });
  assert.equal(template.status, 201);
  assert.equal(template.body.sopTemplate.items.length, 2);

  const schedule = await createSopSchedule(assistant, dependencies, {
    templateId: template.body.sopTemplate.id,
    title: "Tuesday switch check",
    recurrenceType: "daily",
    dueTime: "09:00:00",
    startsOn: "2026-07-01",
    assignedToUserId: CHECKPOINT1_SEED_IDS.users.assistant
  });
  assert.equal(schedule.status, 201);

  const generated = await generateDueSopRuns(assistant, dependencies, {
    asOf: "2026-07-07T09:30:00.000Z"
  });
  assert.equal(generated.status, 202);
  assert.equal(generated.body.sopRunsCreated.length, 1);
  const run = generated.body.sopRunsCreated[0];
  assert.equal(run.items.length, 2);
  assert.ok(run.taskId);

  const repeated = await generateDueSopRuns(assistant, dependencies, {
    asOf: "2026-07-07T09:30:00.000Z"
  });
  assert.equal(repeated.body.sopRunsCreated.length, 0);
  assert.equal(repeated.body.skippedExistingKeys.length, 1);

  const completed = await updateSopRun(assistant, dependencies, run.id, {
    status: "completed",
    completionEvidence: { summary: "All switches checked." },
    items: run.items.map((item) => ({
      itemId: item.id,
      status: "done",
      evidence: item.evidenceRequired ? { checkedBy: "assistant", result: "ok" } : {}
    }))
  });
  assert.equal(completed.body.sopRun.status, "completed");
  assert.equal(completed.body.sopRun.items.every((item) => item.status === "done"), true);
  const listed = await listSopRuns(assistant, dependencies, new URLSearchParams("date=2026-07-07"));
  assert.equal(listed.body.sopRuns.length, 1);
  assert.ok(auditSink.events.some((event) => event.action === "sop_run.completed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "sop_run.completed"));

  await assert.rejects(
    () =>
      createSopTemplate(accountant, dependencies, {
        code: "forbidden-sop",
        title: "Forbidden SOP",
        items: [{ title: "Nope" }]
      }),
    /missing_permission/
  );
});

async function prepareCompletedProcedureAndInvoice(
  repository: LocalFixtureClinicOperationsRepository,
  dependencies: OperationsDependencies,
  assistant: OperationsRequestContext,
  accountant: OperationsRequestContext
) {
  const encounter = await createEncounter(assistant, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP6 continuity generation fixture"
  });
  const pricebookProcedure = repository.pricebookProcedures.find((item) => item.code === "SCALING");
  assert.ok(pricebookProcedure);
  const plan = await createPatientTreatmentPlan(assistant, dependencies, patientId, {
    encounterId: encounter.body.encounter.id,
    title: "Continuity generation plan",
    phases: [
      {
        title: "Procedure",
        items: [{ pricebookProcedureId: pricebookProcedure.id }]
      }
    ]
  });
  const accepted = await acceptTreatmentPlan(assistant, dependencies, plan.body.treatmentPlan.id, {});
  const estimateItem = accepted.body.treatmentPlan.phases[0].estimateItems[0];
  const performed = await createEncounterProcedurePerformed(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {
      treatmentPlanId: accepted.body.treatmentPlan.id,
      treatmentPlanEstimateItemId: estimateItem.id,
      performedAt: "2026-07-07T08:00:00.000Z"
    }
  );
  const invoice = await createInvoice(accountant, dependencies, {
    treatmentPlanId: accepted.body.treatmentPlan.id,
    dueAt: "2026-07-08T09:00:00.000Z"
  });
  return {
    procedureId: performed.body.procedure.id,
    invoiceId: invoice.body.invoice.id
  };
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
