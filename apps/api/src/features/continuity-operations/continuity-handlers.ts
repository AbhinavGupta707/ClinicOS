import type {
  CreateRecallRuleInput,
  CreateSopScheduleInput,
  CreateSopTemplateInput,
  CreateTaskInput,
  RecordRecallActionInput,
  SopRunSearchFilter,
  TaskSearchFilter,
  UpdateSopRunInput,
  UpdateTaskInput
} from "@clinic-os/db";
import {
  assertTaskTransition,
  type RecallActionType,
  type SopRecurrenceType,
  type SopRunItemStatus,
  type SopRunStatus,
  type TaskPriority,
  type TaskSourceWorkflow,
  type TaskStatus,
  type TaskType
} from "@clinic-os/domain";
import {
  assertNoProviderOrProcurementCompletionClaim,
  assertNonEmptyEvidence
} from "../../../../../packages/domain/src/cp13/continuity-operations/index.ts";
import type { ClinicFeatureOperationRequest } from "../contracts.ts";
import {
  accepted,
  appendEvidence,
  arrayValue,
  conflict,
  created,
  domainValidation,
  jsonObject,
  ok,
  optionalBooleanValue,
  optionalNumberValue,
  optionalStringValue,
  optionalUuidValue,
  pageLimit,
  publicRecall,
  publicSopRun,
  publicTask,
  recallEvidencePayload,
  recordValue,
  requestBody,
  requestPath,
  requestQuery,
  sopEvidencePayload,
  stringValue,
  taskEvidencePayload,
  uuidValue,
  validation,
  type ContinuityOperationsHandler
} from "./shared.ts";

export const listTasksHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const filter: TaskSearchFilter = {
    status: optionalStringValue(query.status) as TaskStatus | null | undefined,
    dueDate: optionalStringValue(query.dueDate),
    dueBefore: optionalStringValue(query.dueBefore),
    assignedToUserId: optionalUuidValue(query.assignedToUserId),
    patientId: optionalUuidValue(query.patientId),
    sourceWorkflow: optionalStringValue(query.sourceWorkflow) as
      TaskSourceWorkflow | null | undefined,
    limit: pageLimit(query)
  };
  const tasks = await context.repositories.continuity.listTasks(filter);
  return ok({ tasks: tasks.map(publicTask) });
};

export const createTaskHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const status = (optionalStringValue(body.status) ?? "open") as TaskStatus;
  if (status === "done" || status === "cancelled") {
    validation("Tasks must be created in an actionable state and transitioned with evidence.", {
      status
    });
  }
  const input: CreateTaskInput = {
    patientId: optionalUuidValue(body.patientId),
    leadId: optionalUuidValue(body.leadId),
    appointmentId: optionalUuidValue(body.appointmentId),
    invoiceId: optionalUuidValue(body.invoiceId),
    encounterId: optionalUuidValue(body.encounterId),
    treatmentPlanId: optionalUuidValue(body.treatmentPlanId),
    procedurePerformedId: optionalUuidValue(body.procedurePerformedId),
    taskType: (optionalStringValue(body.taskType) ?? "manual") as TaskType,
    sourceWorkflow: (optionalStringValue(body.sourceWorkflow) ?? "manual") as TaskSourceWorkflow,
    sourceRecordType: optionalStringValue(body.sourceRecordType),
    sourceRecordId: optionalUuidValue(body.sourceRecordId),
    title: stringValue(body.title, "title"),
    description: optionalStringValue(body.description),
    priority: (optionalStringValue(body.priority) ?? "normal") as TaskPriority,
    status,
    dueAt: optionalStringValue(body.dueAt),
    assignedToUserId: optionalUuidValue(body.assignedToUserId),
    idempotencyKey: requestIdempotencyKey(request)
  };
  const task = await context.repositories.continuity.createTask(input);
  await appendEvidence(request, context, {
    action: "task.created",
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    patientId: task.patientId,
    payload: taskEvidencePayload(task)
  });
  return created({ task: publicTask(task) });
};

export const updateTaskHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const taskId = uuidValue(requestPath(request).taskId, "taskId");
  const before = await context.repositories.continuity.findTaskById(taskId);
  if (!before)
    return conflict("Task was not found in the active clinic scope.", { task_id: taskId });
  const status = optionalStringValue(body.status) as TaskStatus | undefined;
  if (status) domainValidation(() => assertTaskTransition(before.status, status));
  const completionEvidence =
    body.completionEvidence === undefined ? undefined : recordValue(body.completionEvidence);
  if (status === "done") {
    domainValidation(() => assertNonEmptyEvidence(completionEvidence, "Task completion"));
    if (completionEvidence) {
      domainValidation(() => assertNoProviderOrProcurementCompletionClaim(completionEvidence));
    }
  }
  const cancelledReason = optionalStringValue(body.cancelledReason);
  if (status === "cancelled" && !cancelledReason) {
    validation("Cancelled tasks require an attributable reason.", { field: "cancelledReason" });
  }
  const input: UpdateTaskInput = {
    status,
    assignedToUserId: optionalUuidValue(body.assignedToUserId),
    priority: optionalStringValue(body.priority) as TaskPriority | undefined,
    dueAt: optionalStringValue(body.dueAt),
    title: optionalStringValue(body.title) ?? undefined,
    description: optionalStringValue(body.description),
    completionEvidence,
    cancelledReason
  };
  const task = await context.repositories.continuity.updateTask(taskId, input);
  if (!task)
    return conflict("Task could not be transitioned from its current durable state.", {
      task_id: taskId
    });
  const completed = task.status === "done";
  await appendEvidence(request, context, {
    action: completed ? "task.completed" : "task.status_changed",
    eventType: completed ? "task.completed" : "task.status_changed",
    aggregateType: "task",
    aggregateId: task.id,
    patientId: task.patientId,
    payload: taskEvidencePayload(task)
  });
  return ok({ task: publicTask(task) });
};

export const generateDueContinuityTasksHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const now = context.clock.now();
  const asOf = optionalStringValue(body.asOf) ?? now.toISOString();
  const result = await context.repositories.continuity.generateDueContinuityTasks({ asOf });
  let ordinal = 0;
  for (const recall of result.recallsCreated) {
    await appendEvidence(request, context, {
      action: "recall.due",
      eventType: "recall.due",
      aggregateType: "recall",
      aggregateId: recall.id,
      patientId: recall.patientId,
      payload: recallEvidencePayload(recall),
      ordinal: ordinal++
    });
  }
  for (const task of [...result.recallTasksCreated, ...result.followUpTasksCreated]) {
    await appendEvidence(request, context, {
      action: "task.due",
      eventType: "task.due",
      aggregateType: "task",
      aggregateId: task.id,
      patientId: task.patientId,
      payload: taskEvidencePayload(task),
      ordinal: ordinal++
    });
  }
  return accepted({
    recallTasksCreated: result.recallTasksCreated.map(publicTask),
    followUpTasksCreated: result.followUpTasksCreated.map(publicTask),
    recallsCreated: result.recallsCreated.map(publicRecall),
    skippedExistingKeys: result.skippedExistingKeys
  });
};

export const createRecallRuleHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const input: CreateRecallRuleInput = {
    code: stringValue(body.code, "code"),
    title: stringValue(body.title, "title"),
    anchor: (optionalStringValue(body.anchor) ??
      "procedure_completed") as CreateRecallRuleInput["anchor"],
    offsetDays: optionalNumberValue(body.offsetDays) ?? 180,
    procedureCategory: optionalStringValue(body.procedureCategory),
    pricebookProcedureId: optionalUuidValue(body.pricebookProcedureId),
    defaultTaskTitle: optionalStringValue(body.defaultTaskTitle),
    defaultTaskPriority: (optionalStringValue(body.defaultTaskPriority) ?? "normal") as TaskPriority
  };
  const rule = await context.repositories.continuity.createRecallRule(input);
  const payload = {
    code: rule.code,
    anchor: rule.anchor,
    offsetDays: rule.offsetDays,
    procedureCategory: rule.procedureCategory,
    pricebookProcedureId: rule.pricebookProcedureId
  };
  await appendEvidence(request, context, {
    action: "recall.rule_created",
    eventType: "recall.rule_created",
    aggregateType: "recall_rule",
    aggregateId: rule.id,
    payload
  });
  const { tenantId: _tenant, clinicId: _clinic, ...publicRule } = rule;
  return created({ recallRule: publicRule });
};

export const listRecallsHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const recalls = await context.repositories.continuity.listRecalls({
    status: optionalStringValue(query.status) as NonNullable<
      Parameters<typeof context.repositories.continuity.listRecalls>[0]
    >["status"],
    dueBefore: optionalStringValue(query.dueBefore),
    patientId: optionalUuidValue(query.patientId),
    limit: pageLimit(query)
  });
  return ok({ recalls: recalls.map(publicRecall) });
};

export const recordRecallActionHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const recallId = uuidValue(requestPath(request).recallId, "recallId");
  const evidence = recordValue(body.evidence);
  domainValidation(() => assertNonEmptyEvidence(evidence, "Recall action"));
  domainValidation(() => assertNoProviderOrProcurementCompletionClaim(evidence));
  const actionType = stringValue(body.actionType, "actionType") as RecallActionType;
  const appointmentId = optionalUuidValue(body.appointmentId);
  if (actionType === "appointment_booked" && !appointmentId) {
    validation("Booked recall actions require an appointment reference.", {
      field: "appointmentId"
    });
  }
  const input: RecordRecallActionInput = {
    actionType,
    method: optionalStringValue(body.method),
    appointmentId,
    evidence,
    notes: optionalStringValue(body.notes)
  };
  const recall = await context.repositories.continuity.recordRecallAction(recallId, input);
  if (!recall)
    return conflict("Recall action was rejected for the current durable state.", {
      recall_id: recallId
    });
  const eventType =
    recall.status === "completed"
      ? "recall.completed"
      : actionType === "manual_contact_requested" || actionType === "manual_contacted"
        ? "recall.sent"
        : "recall.action_recorded";
  await appendEvidence(request, context, {
    action: eventType,
    eventType,
    aggregateType: "recall",
    aggregateId: recall.id,
    patientId: recall.patientId,
    payload: recallEvidencePayload(recall)
  });
  return ok({ recall: publicRecall(recall) });
};

export const createSopTemplateHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const items = arrayValue(body.items, "items").map((candidate) => {
    const item = jsonObject(candidate, "items[]");
    return {
      title: stringValue(item.title, "items[].title"),
      instructions: optionalStringValue(item.instructions),
      evidenceRequired: optionalBooleanValue(item.evidenceRequired) ?? false
    };
  });
  const input: CreateSopTemplateInput = {
    code: stringValue(body.code, "code"),
    title: stringValue(body.title, "title"),
    description: optionalStringValue(body.description),
    items
  };
  const detail = await context.repositories.continuity.createSopTemplate(input);
  const payload = { code: detail.template.code, itemCount: detail.items.length };
  await appendEvidence(request, context, {
    action: "sop_template.created",
    eventType: "sop_template.created",
    aggregateType: "sop_template",
    aggregateId: detail.template.id,
    payload
  });
  const { tenantId: _tenant, clinicId: _clinic, ...template } = detail.template;
  return created({
    sopTemplate: {
      ...template,
      items: detail.items.map(({ tenantId: _it, clinicId: _ic, ...item }) => item)
    }
  });
};

export const createSopScheduleHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const recurrenceType = stringValue(body.recurrenceType, "recurrenceType") as SopRecurrenceType;
  const input: CreateSopScheduleInput = {
    templateId: uuidValue(body.templateId, "templateId"),
    title: stringValue(body.title, "title"),
    recurrenceType,
    intervalDays: optionalNumberValue(body.intervalDays),
    dayOfWeek: optionalNumberValue(body.dayOfWeek),
    dayOfMonth: optionalNumberValue(body.dayOfMonth),
    dueTime: stringValue(body.dueTime, "dueTime"),
    timezone: optionalStringValue(body.timezone),
    startsOn: stringValue(body.startsOn, "startsOn"),
    endsOn: optionalStringValue(body.endsOn),
    assignedToUserId: optionalUuidValue(body.assignedToUserId),
    defaultTaskPriority: (optionalStringValue(body.defaultTaskPriority) ?? "normal") as TaskPriority
  };
  assertSopScheduleShape(input);
  const schedule = await context.repositories.continuity.createSopSchedule(input);
  if (!schedule)
    return conflict("SOP schedule could not be created for the selected template.", {
      template_id: input.templateId
    });
  const payload = {
    templateId: schedule.templateId,
    recurrenceType: schedule.recurrenceType,
    dueTime: schedule.dueTime,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
    assignedToUserId: schedule.assignedToUserId
  };
  await appendEvidence(request, context, {
    action: "sop_schedule.created",
    eventType: "sop_schedule.created",
    aggregateType: "sop_schedule",
    aggregateId: schedule.id,
    payload
  });
  const { tenantId: _tenant, clinicId: _clinic, ...publicSchedule } = schedule;
  return created({ sopSchedule: publicSchedule });
};

export const listSopRunsHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const filter: SopRunSearchFilter = {
    date: optionalStringValue(query.date),
    status: optionalStringValue(query.status) as SopRunStatus | null | undefined,
    dueBefore: optionalStringValue(query.dueBefore),
    limit: pageLimit(query)
  };
  const runs = await context.repositories.continuity.listSopRuns(filter);
  return ok({ sopRuns: runs.map(publicSopRun) });
};

export const generateDueSopRunsHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const now = context.clock.now();
  const asOf = optionalStringValue(body.asOf) ?? now.toISOString();
  const result = await context.repositories.continuity.generateDueSopRuns({ asOf });
  let ordinal = 0;
  for (const detail of result.runsCreated) {
    await appendEvidence(request, context, {
      action: "sop_run.created",
      eventType: "sop_run.created",
      aggregateType: "sop_run",
      aggregateId: detail.run.id,
      payload: sopEvidencePayload(detail),
      ordinal: ordinal++
    });
  }
  return accepted({
    sopRunsCreated: result.runsCreated.map(publicSopRun),
    skippedExistingKeys: result.skippedExistingKeys
  });
};

export const updateSopRunHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const sopRunId = uuidValue(requestPath(request).sopRunId, "sopRunId");
  const completionEvidence =
    body.completionEvidence === undefined ? undefined : recordValue(body.completionEvidence);
  const status = optionalStringValue(body.status) as SopRunStatus | undefined;
  if (status === "completed") {
    domainValidation(() => assertNonEmptyEvidence(completionEvidence, "SOP run completion"));
  }
  const items =
    body.items === undefined
      ? undefined
      : arrayValue(body.items, "items").map((candidate) => {
          const item = jsonObject(candidate, "items[]");
          const evidence = recordValue(item.evidence);
          const itemStatus = stringValue(item.status, "items[].status") as SopRunItemStatus;
          if (itemStatus === "done") {
            domainValidation(() =>
              assertNonEmptyEvidence(evidence, "Completed SOP checklist item")
            );
          }
          return {
            itemId: uuidValue(item.itemId, "items[].itemId"),
            status: itemStatus,
            evidence
          };
        });
  const input: UpdateSopRunInput = { status, completionEvidence, items };
  const detail = await context.repositories.continuity.updateSopRun(sopRunId, input);
  if (!detail)
    return conflict("SOP run update was rejected for its current durable state.", {
      sop_run_id: sopRunId
    });
  const completed = detail.run.status === "completed";
  await appendEvidence(request, context, {
    action: completed ? "sop_run.completed" : "sop_run.updated",
    eventType: completed ? "sop_run.completed" : "sop_run.updated",
    aggregateType: "sop_run",
    aggregateId: detail.run.id,
    payload: sopEvidencePayload(detail)
  });
  return ok({ sopRun: publicSopRun(detail) });
};

function assertSopScheduleShape(input: CreateSopScheduleInput): void {
  const valid =
    (input.recurrenceType === "daily" &&
      input.intervalDays == null &&
      input.dayOfWeek == null &&
      input.dayOfMonth == null) ||
    (input.recurrenceType === "weekly" &&
      input.intervalDays == null &&
      input.dayOfWeek != null &&
      input.dayOfMonth == null) ||
    (input.recurrenceType === "monthly" &&
      input.intervalDays == null &&
      input.dayOfWeek == null &&
      input.dayOfMonth != null) ||
    (input.recurrenceType === "interval_days" &&
      input.intervalDays != null &&
      input.dayOfWeek == null &&
      input.dayOfMonth == null);
  if (!valid) {
    validation("SOP schedule recurrence fields do not match recurrenceType.", {
      recurrenceType: input.recurrenceType
    });
  }
}

function requestIdempotencyKey(request: ClinicFeatureOperationRequest): string | null {
  const headers = jsonObject(request.parsed.headers, "headers");
  return typeof headers["idempotency-key"] === "string" ? headers["idempotency-key"] : null;
}
