import type {
  CreateCorrectiveActionInput,
  CreateIncidentInput,
  CreateInventoryCategoryInput,
  CreateInventoryCheckRunInput,
  CreateInventoryCheckTemplateInput,
  CreateInventoryItemInput,
  CreateLabCaseInput,
  CreateLabReconciliationInput,
  CreateLabVendorInput,
  CreateStockLedgerEntryInput,
  InventoryExceptionFilter,
  LabCaseSearchFilter,
  UpdateCorrectiveActionInput,
  UpdateInventoryCheckRunInput,
  UpdateLabCaseStatusInput
} from "@clinic-os/db";
import {
  assertLabCaseTransition,
  type CorrectiveActionStatus,
  type IncidentCategory,
  type IncidentSeverity,
  type InventoryCategoryKind,
  type InventoryCheckRunStatus,
  type LabCaseStatus,
  type StockLedgerMovementType,
  type UUID
} from "@clinic-os/domain";
import {
  assertCorrectiveActionTransition,
  assertNoProviderOrProcurementCompletionClaim,
  assertNonEmptyEvidence
} from "../../../../../packages/domain/src/cp13/continuity-operations/index.ts";
import {
  appendEvidence,
  applyLimit,
  arrayValue,
  conflict,
  created,
  domainValidation,
  jsonObject,
  notFound,
  numberValue,
  ok,
  optionalBooleanValue,
  optionalNumberValue,
  optionalStringValue,
  optionalUuidValue,
  pageLimit,
  publicCorrectiveAction,
  recordValue,
  requestBody,
  requestPath,
  requestQuery,
  stringValue,
  uuidValue,
  validation,
  type ContinuityOperationsHandler
} from "./shared.ts";

export const listLabVendorsHandler: ContinuityOperationsHandler = async (request, context) => {
  const vendors = await context.repositories.clinicOperations.listLabVendors();
  return ok({
    labVendors: applyLimit(vendors, pageLimit(requestQuery(request))).map(stripScope)
  });
};

export const createLabVendorHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const input: CreateLabVendorInput = {
    displayName: stringValue(body.displayName, "displayName"),
    phone: optionalStringValue(body.phone),
    email: optionalStringValue(body.email),
    address: recordValue(body.address),
    taxRegistrationNumber: optionalStringValue(body.taxRegistrationNumber),
    paymentTermsDays: optionalNumberValue(body.paymentTermsDays) ?? undefined
  };
  const vendor = await context.repositories.clinicOperations.createLabVendor(input);
  await appendEvidence(request, context, {
    action: "lab_vendor.created",
    eventType: "lab_vendor.created",
    aggregateType: "lab_vendor",
    aggregateId: vendor.id,
    payload: { vendorId: vendor.id, directoryEntryCreated: true }
  });
  return created({ labVendor: stripScope(vendor) });
};

export const listLabCasesHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const filter: LabCaseSearchFilter = {
    status: optionalStringValue(query.status) as LabCaseStatus | null | undefined,
    dueBefore: optionalStringValue(query.dueBefore),
    vendorId: optionalUuidValue(query.vendorId)
  };
  const cases = await context.repositories.clinicOperations.listLabCases(filter);
  return ok({
    labCases: applyLimit(cases, pageLimit(query)).map(publicLabCaseDetail)
  });
};

export const createLabCaseHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const items = arrayValue(body.items, "items").map((candidate) => {
    const item = jsonObject(candidate, "items[]");
    return {
      itemType: stringValue(item.itemType, "items[].itemType"),
      toothNumber: optionalStringValue(item.toothNumber),
      material: optionalStringValue(item.material),
      shade: optionalStringValue(item.shade),
      quantity: optionalNumberValue(item.quantity) ?? 1,
      notes: optionalStringValue(item.notes)
    };
  });
  const input: CreateLabCaseInput = {
    vendorId: uuidValue(body.vendorId, "vendorId"),
    patientId: uuidValue(body.patientId, "patientId"),
    encounterId: optionalUuidValue(body.encounterId),
    treatmentPlanId: optionalUuidValue(body.treatmentPlanId),
    treatmentPlanEstimateItemId: optionalUuidValue(body.treatmentPlanEstimateItemId),
    procedurePerformedId: optionalUuidValue(body.procedurePerformedId),
    title: stringValue(body.title, "title"),
    priority: (optionalStringValue(body.priority) ?? "routine") as "routine" | "urgent",
    dueAt: stringValue(body.dueAt, "dueAt"),
    clinicalNotes: optionalStringValue(body.clinicalNotes),
    internalNotes: optionalStringValue(body.internalNotes),
    expectedCostMinor: optionalNumberValue(body.expectedCostMinor),
    slipMetadata: recordValue(body.slipMetadata),
    items
  };
  const detail = await context.repositories.clinicOperations.createLabCase(input);
  if (!detail)
    return notFound("Lab vendor, patient, or clinical linkage was not found.", {
      vendor_id: input.vendorId,
      patient_id: input.patientId
    });
  await appendEvidence(request, context, {
    action: "lab_case.created",
    eventType: "lab_case.created",
    aggregateType: "lab_case",
    aggregateId: detail.labCase.id,
    patientId: detail.labCase.patientId,
    payload: {
      labCaseId: detail.labCase.id,
      vendorId: detail.labCase.vendorId,
      dueAt: detail.labCase.dueAt,
      slipNumber: detail.labCase.slipNumber
    },
    ordinal: 0
  });
  await appendEvidence(request, context, {
    action: "lab_slip.generated",
    eventType: "lab_slip.generated",
    aggregateType: "lab_slip",
    aggregateId: detail.labCase.id,
    patientId: detail.labCase.patientId,
    payload: {
      labCaseId: detail.labCase.id,
      slipNumber: detail.labCase.slipNumber,
      slipVersion: detail.labCase.slipVersion
    },
    ordinal: 1
  });
  return created({ labCase: publicLabCaseDetail(detail) });
};

export const updateLabCaseHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const labCaseId = uuidValue(requestPath(request).labCaseId, "labCaseId");
  const before = await context.repositories.clinicOperations.findLabCaseById(labCaseId);
  if (!before) return notFound("Lab case was not found.", { lab_case_id: labCaseId });
  const status = stringValue(body.status, "status") as LabCaseStatus;
  domainValidation(() => assertLabCaseTransition(before.labCase.status, status));
  const evidence = recordValue(body.evidence);
  if (status !== before.labCase.status && status !== "draft") {
    domainValidation(() => assertNonEmptyEvidence(evidence, "Lab case transition"));
    domainValidation(() => assertNoProviderOrProcurementCompletionClaim(evidence));
  }
  const input: UpdateLabCaseStatusInput = {
    status,
    reason: optionalStringValue(body.reason),
    evidence
  };
  const detail = await context.repositories.clinicOperations.updateLabCaseStatus(labCaseId, input);
  if (!detail)
    return conflict("Lab case transition was rejected by durable state.", {
      lab_case_id: labCaseId,
      to_status: status
    });
  const eventType = labEventType(status);
  await appendEvidence(request, context, {
    action: eventType,
    eventType,
    aggregateType: "lab_case",
    aggregateId: detail.labCase.id,
    patientId: detail.labCase.patientId,
    payload: {
      labCaseId: detail.labCase.id,
      fromStatus: before.labCase.status,
      toStatus: detail.labCase.status
    }
  });
  return ok({ labCase: publicLabCaseDetail(detail) });
};

export const createLabReconciliationHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const evidence = recordValue(body.evidence);
  domainValidation(() => assertNonEmptyEvidence(evidence, "Lab reconciliation"));
  domainValidation(() => assertNoProviderOrProcurementCompletionClaim(evidence));
  const entries = arrayValue(body.entries, "entries").map((candidate) => {
    const entry = jsonObject(candidate, "entries[]");
    return {
      labCaseId: uuidValue(entry.labCaseId, "entries[].labCaseId"),
      status: optionalStringValue(
        entry.status
      ) as CreateLabReconciliationInput["entries"][number]["status"],
      invoiceAmountMinor: optionalNumberValue(entry.invoiceAmountMinor),
      notes: optionalStringValue(entry.notes)
    };
  });
  if (new Set(entries.map((entry) => entry.labCaseId)).size !== entries.length) {
    validation("A lab case may appear only once in a reconciliation.", { field: "entries" });
  }
  const periodStart = stringValue(body.periodStart, "periodStart");
  const periodEnd = stringValue(body.periodEnd, "periodEnd");
  if (periodStart > periodEnd) {
    validation("Lab reconciliation periodStart must be on or before periodEnd.");
  }
  const status = optionalStringValue(body.status) as CreateLabReconciliationInput["status"];
  const invoiceReference = optionalStringValue(body.invoiceReference);
  if (status === "approved" && !invoiceReference) {
    validation("Approved reconciliation evidence requires an invoice reference.", {
      field: "invoiceReference"
    });
  }
  const input: CreateLabReconciliationInput = {
    vendorId: uuidValue(body.vendorId, "vendorId"),
    periodStart,
    periodEnd,
    status,
    invoiceReference,
    invoiceAmountMinor: optionalNumberValue(body.invoiceAmountMinor),
    evidence,
    entries
  };
  const detail = await context.repositories.clinicOperations.createLabReconciliation(input);
  if (!detail)
    return notFound("Lab vendor or case was not found for reconciliation.", {
      vendor_id: input.vendorId
    });
  const payload = {
    reconciliationId: detail.reconciliation.id,
    vendorId: detail.reconciliation.vendorId,
    periodStart: detail.reconciliation.periodStart,
    periodEnd: detail.reconciliation.periodEnd,
    entryCount: detail.entries.length,
    varianceAmountMinor: detail.reconciliation.varianceAmountMinor,
    paymentExecuted: false
  };
  await appendEvidence(request, context, {
    action: "lab_reconciliation.created",
    eventType: "lab_reconciliation.created",
    aggregateType: "lab_reconciliation",
    aggregateId: detail.reconciliation.id,
    payload
  });
  return created({ labReconciliation: publicLabReconciliation(detail) });
};

export const listInventoryCategoriesHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const rows = await context.repositories.clinicOperations.listInventoryCategories();
  return ok({ categories: applyLimit(rows, pageLimit(requestQuery(request))).map(stripScope) });
};

export const createInventoryCategoryHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const input: CreateInventoryCategoryInput = {
    code: stringValue(body.code, "code"),
    displayName: stringValue(body.displayName, "displayName"),
    kind: stringValue(body.kind, "kind") as InventoryCategoryKind,
    active: optionalBooleanValue(body.active)
  };
  const category = await context.repositories.clinicOperations.createInventoryCategory(input);
  await appendEvidence(request, context, {
    action: "inventory_category.created",
    eventType: "inventory_category.created",
    aggregateType: "inventory_category",
    aggregateId: category.id,
    payload: { categoryId: category.id, kind: category.kind }
  });
  return created({ category: stripScope(category) });
};

export const listInventoryItemsHandler: ContinuityOperationsHandler = async (request, context) => {
  const rows = await context.repositories.clinicOperations.listInventoryItems();
  return ok({ items: applyLimit(rows, pageLimit(requestQuery(request))).map(stripScope) });
};

export const createInventoryItemHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const input: CreateInventoryItemInput = {
    categoryId: uuidValue(body.categoryId, "categoryId"),
    sku: stringValue(body.sku, "sku"),
    displayName: stringValue(body.displayName, "displayName"),
    unitOfMeasure: stringValue(body.unitOfMeasure, "unitOfMeasure"),
    storageLocation: stringValue(body.storageLocation, "storageLocation"),
    trackQuantity: optionalBooleanValue(body.trackQuantity),
    minimumQuantity: optionalNumberValue(body.minimumQuantity) ?? undefined,
    reorderQuantity: optionalNumberValue(body.reorderQuantity) ?? undefined,
    openingQuantity: optionalNumberValue(body.openingQuantity) ?? undefined
  };
  const item = await context.repositories.clinicOperations.createInventoryItem(input);
  if (!item)
    return notFound("Inventory category was not found.", {
      category_id: input.categoryId
    });
  await appendEvidence(request, context, {
    action: "inventory_item.created",
    eventType: "inventory_item.created",
    aggregateType: "inventory_item",
    aggregateId: item.id,
    payload: { itemId: item.id, sku: item.sku, openingQuantity: input.openingQuantity ?? 0 }
  });
  return created({ item: stripScope(item) });
};

export const createStockLedgerEntryHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const evidence = recordValue(body.evidence);
  domainValidation(() => assertNonEmptyEvidence(evidence, "Stock ledger movement"));
  domainValidation(() => assertNoProviderOrProcurementCompletionClaim(evidence));
  const movementType = stringValue(body.movementType, "movementType") as StockLedgerMovementType;
  const quantityDelta = numberValue(body.quantityDelta, "quantityDelta");
  if (movementType === "procurement_received" && quantityDelta <= 0) {
    validation("Procurement receipt evidence must increase stock quantity.", {
      field: "quantityDelta"
    });
  }
  const input: CreateStockLedgerEntryInput = {
    itemId: uuidValue(body.itemId, "itemId"),
    movementType,
    quantityDelta,
    unitCostMinor: optionalNumberValue(body.unitCostMinor),
    currency: optionalStringValue(body.currency) as "INR" | null | undefined,
    sourceTable: optionalStringValue(body.sourceTable),
    sourceId: optionalUuidValue(body.sourceId),
    reason: stringValue(body.reason, "reason"),
    evidence
  };
  const entry = await context.repositories.clinicOperations.createStockLedgerEntry(input);
  if (!entry)
    return conflict("Stock movement was rejected for this item or balance.", {
      item_id: input.itemId
    });
  const payload = {
    itemId: entry.itemId,
    movementType: entry.movementType,
    quantityDelta: entry.quantityDelta,
    quantityAfter: entry.quantityAfter,
    procurementExecuted: false
  };
  await appendEvidence(request, context, {
    action: "inventory_stock.adjusted",
    eventType: "inventory_stock.adjusted",
    aggregateType: "stock_ledger_entry",
    aggregateId: entry.id,
    payload
  });
  return created({ stockLedgerEntry: stripScope(entry) });
};

export const listInventoryCheckTemplatesHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const rows = await context.repositories.clinicOperations.listInventoryCheckTemplates();
  return ok({ templates: applyLimit(rows, pageLimit(requestQuery(request))).map(publicTemplate) });
};

export const createInventoryCheckTemplateHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const lines = arrayValue(body.lines, "lines").map((candidate, index) => {
    const line = jsonObject(candidate, "lines[]");
    return {
      itemId: uuidValue(line.itemId, "lines[].itemId"),
      sequence: optionalNumberValue(line.sequence) ?? index + 1,
      drawerLocation: stringValue(line.drawerLocation, "lines[].drawerLocation"),
      expectedQuantity: optionalNumberValue(line.expectedQuantity),
      required: optionalBooleanValue(line.required) ?? true,
      instructions: optionalStringValue(line.instructions)
    };
  });
  const input: CreateInventoryCheckTemplateInput = {
    code: stringValue(body.code, "code"),
    displayName: stringValue(body.displayName, "displayName"),
    cadence: (optionalStringValue(body.cadence) ??
      "monthly") as CreateInventoryCheckTemplateInput["cadence"],
    active: optionalBooleanValue(body.active),
    lines
  };
  const template = await context.repositories.clinicOperations.createInventoryCheckTemplate(input);
  if (!template) return notFound("Inventory item was not found for the check template.");
  await appendEvidence(request, context, {
    action: "inventory_check.created",
    eventType: "inventory_check.created",
    aggregateType: "inventory_check_template",
    aggregateId: template.id,
    payload: {
      entityKind: "inventory_check_template",
      templateId: template.id,
      lineCount: template.lines.length
    }
  });
  return created({ template: publicTemplate(template) });
};

export const createInventoryCheckRunHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const input: CreateInventoryCheckRunInput = {
    templateId: uuidValue(body.templateId, "templateId"),
    notes: optionalStringValue(body.notes)
  };
  const detail = await context.repositories.clinicOperations.createInventoryCheckRun(input);
  if (!detail)
    return notFound("Inventory check template was not found.", {
      template_id: input.templateId
    });
  await appendEvidence(request, context, {
    action: "inventory_check.created",
    eventType: "inventory_check.created",
    aggregateType: "inventory_check_run",
    aggregateId: detail.run.id,
    payload: {
      entityKind: "inventory_check_run",
      checkRunId: detail.run.id,
      templateId: detail.run.templateId,
      lineCount: detail.lines.length
    }
  });
  return created({ checkRun: publicCheckRun(detail) });
};

export const updateInventoryCheckRunHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const checkRunId = uuidValue(requestPath(request).checkRunId, "checkRunId");
  const status = stringValue(body.status, "status") as InventoryCheckRunStatus;
  const lines =
    body.lines === undefined
      ? undefined
      : arrayValue(body.lines, "lines").map((candidate) => {
          const line = jsonObject(candidate, "lines[]");
          return {
            lineId: uuidValue(line.lineId, "lines[].lineId"),
            countedQuantity: numberValue(line.countedQuantity, "lines[].countedQuantity"),
            exceptionNotes: optionalStringValue(line.exceptionNotes)
          };
        });
  const input: UpdateInventoryCheckRunInput = {
    status,
    notes: optionalStringValue(body.notes),
    lines
  };
  const detail = await context.repositories.clinicOperations.updateInventoryCheckRun(
    checkRunId,
    input
  );
  if (!detail)
    return conflict("Inventory check update was rejected for its current state.", {
      check_run_id: checkRunId
    });
  if (detail.run.status === "completed") {
    const exceptionLines = detail.lines.filter((line) => line.exceptionType !== null);
    await appendEvidence(request, context, {
      action: "inventory_check.completed",
      eventType: "inventory_check.completed",
      aggregateType: "inventory_check_run",
      aggregateId: detail.run.id,
      payload: {
        checkRunId: detail.run.id,
        exceptionCount: exceptionLines.length,
        procurementSuggestionCount: detail.procurementSuggestions.length
      },
      ordinal: 0
    });
    let ordinal = 1;
    for (const line of exceptionLines) {
      if (line.exceptionType !== "low_stock" && line.exceptionType !== "missing_item") continue;
      await appendEvidence(request, context, {
        action: "inventory.low_stock_detected",
        eventType: "inventory.low_stock_detected",
        aggregateType: "inventory_item",
        aggregateId: line.itemId,
        payload: {
          checkRunId: detail.run.id,
          checkRunLineId: line.id,
          exceptionType: line.exceptionType,
          expectedQuantity: line.expectedQuantity,
          countedQuantity: line.countedQuantity
        },
        ordinal: ordinal++
      });
    }
    for (const suggestion of detail.procurementSuggestions) {
      await appendEvidence(request, context, {
        action: "inventory.procurement_suggested",
        eventType: "inventory.procurement_suggested",
        aggregateType: "procurement_suggestion",
        aggregateId: suggestion.id,
        payload: {
          suggestionId: suggestion.id,
          itemId: suggestion.itemId,
          suggestedQuantity: suggestion.suggestedQuantity,
          taskCreation: "suggested_not_created",
          purchaseExecuted: false
        },
        ordinal: ordinal++
      });
    }
  }
  return ok({ checkRun: publicCheckRun(detail) });
};

export const listInventoryExceptionsHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const query = requestQuery(request);
  const filter: InventoryExceptionFilter = {
    itemId: optionalUuidValue(query.itemId),
    checkRunId: optionalUuidValue(query.checkRunId)
  };
  const rows = await context.repositories.clinicOperations.listInventoryExceptions(filter);
  return ok({ exceptions: applyLimit(rows, pageLimit(query)).map(publicInventoryException) });
};

export const listIncidentsHandler: ContinuityOperationsHandler = async (request, context) => {
  const query = requestQuery(request);
  const rows = await context.repositories.clinicOperations.listIncidents({
    status: optionalStringValue(query.status) as NonNullable<
      Parameters<typeof context.repositories.clinicOperations.listIncidents>[0]
    >["status"],
    severity: optionalStringValue(query.severity) as IncidentSeverity | null | undefined,
    category: optionalStringValue(query.category) as IncidentCategory | null | undefined
  });
  return ok({ incidents: applyLimit(rows, pageLimit(query)).map(stripScope) });
};

export const createIncidentHandler: ContinuityOperationsHandler = async (request, context) => {
  const body = requestBody(request);
  const evidence = recordValue(body.evidence);
  domainValidation(() => assertNoProviderOrProcurementCompletionClaim(evidence));
  const input: CreateIncidentInput = {
    patientId: optionalUuidValue(body.patientId),
    appointmentId: optionalUuidValue(body.appointmentId),
    labCaseId: optionalUuidValue(body.labCaseId),
    inventoryItemId: optionalUuidValue(body.inventoryItemId),
    category: stringValue(body.category, "category") as IncidentCategory,
    severity: stringValue(body.severity, "severity") as IncidentSeverity,
    occurredAt: stringValue(body.occurredAt, "occurredAt"),
    location: optionalStringValue(body.location),
    summary: stringValue(body.summary, "summary"),
    description: stringValue(body.description, "description"),
    impact: optionalStringValue(body.impact),
    learning: optionalStringValue(body.learning),
    immediateAction: optionalStringValue(body.immediateAction),
    evidence,
    ownerUserId: optionalUuidValue(body.ownerUserId)
  };
  const incident = await context.repositories.clinicOperations.createIncident(input);
  if (!incident) return notFound("Incident linkage was not found in the active clinic scope.");
  const payload = {
    incidentId: incident.id,
    category: incident.category,
    severity: incident.severity,
    status: incident.status,
    labCaseId: incident.labCaseId,
    inventoryItemId: incident.inventoryItemId
  };
  await appendEvidence(request, context, {
    action: "incident.created",
    eventType: "incident.created",
    aggregateType: "incident",
    aggregateId: incident.id,
    patientId: incident.patientId,
    payload
  });
  return created({ incident: stripScope(incident) });
};

export const listCorrectiveActionsHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const rows = await context.repositories.clinicOperations.listCorrectiveActions();
  const now = context.clock.now();
  return ok({
    correctiveActions: applyLimit(rows, pageLimit(requestQuery(request))).map((row) =>
      publicCorrectiveAction(row, now)
    )
  });
};

export const createCorrectiveActionHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const input: CreateCorrectiveActionInput = {
    incidentId: optionalUuidValue(body.incidentId),
    actionType: (optionalStringValue(body.actionType) ??
      "corrective") as CreateCorrectiveActionInput["actionType"],
    title: stringValue(body.title, "title"),
    description: stringValue(body.description, "description"),
    ownerUserId: uuidValue(body.ownerUserId, "ownerUserId"),
    dueAt: stringValue(body.dueAt, "dueAt"),
    verificationEvidence: recordValue(body.verificationEvidence)
  };
  const action = await context.repositories.clinicOperations.createCorrectiveAction(input);
  if (!action)
    return notFound("Incident was not found for corrective action.", {
      incident_id: input.incidentId ?? null
    });
  const payload = {
    correctiveActionId: action.id,
    incidentId: action.incidentId,
    actionType: action.actionType,
    dueAt: action.dueAt
  };
  await appendEvidence(request, context, {
    action: "corrective_action.created",
    eventType: "corrective_action.created",
    aggregateType: "corrective_action",
    aggregateId: action.id,
    payload
  });
  return created({ correctiveAction: publicCorrectiveAction(action, context.clock.now()) });
};

export const updateCorrectiveActionHandler: ContinuityOperationsHandler = async (
  request,
  context
) => {
  const body = requestBody(request);
  const actionId = uuidValue(requestPath(request).correctiveActionId, "correctiveActionId");
  const actions = await context.repositories.clinicOperations.listCorrectiveActions();
  const before = actions.find((candidate) => candidate.id === actionId);
  if (!before)
    return notFound("Corrective action was not found.", {
      corrective_action_id: actionId
    });
  const status = stringValue(body.status, "status") as CorrectiveActionStatus;
  const completionEvidence = recordValue(body.completionEvidence);
  const verificationEvidence =
    body.verificationEvidence === undefined ? undefined : recordValue(body.verificationEvidence);
  domainValidation(() =>
    assertCorrectiveActionTransition({
      current: before,
      nextStatus: status,
      completionEvidence,
      verificationEvidence
    })
  );
  domainValidation(() => assertNoProviderOrProcurementCompletionClaim(completionEvidence));
  const input: UpdateCorrectiveActionInput = {
    status,
    completionEvidence,
    verificationEvidence
  };
  const action = await context.repositories.clinicOperations.updateCorrectiveAction(
    actionId,
    input
  );
  if (!action)
    return conflict("Corrective action transition was rejected by durable state.", {
      corrective_action_id: actionId
    });
  const completed = action.status === "completed";
  const now = context.clock.now();
  const publicAction = publicCorrectiveAction(action, now);
  const payload = {
    correctiveActionId: action.id,
    incidentId: action.incidentId,
    status: action.status,
    effectiveStatus: publicAction.effectiveStatus
  };
  await appendEvidence(request, context, {
    action: completed ? "corrective_action.completed" : "corrective_action.status_changed",
    eventType: completed ? "corrective_action.completed" : "corrective_action.status_changed",
    aggregateType: "corrective_action",
    aggregateId: action.id,
    payload
  });
  return ok({ correctiveAction: publicAction });
};

function stripScope<T extends { tenantId: UUID; clinicId: UUID }>(record: T) {
  const { tenantId: _tenantId, clinicId: _clinicId, ...publicRecord } = record;
  return publicRecord;
}

function publicLabCaseDetail<
  T extends Awaited<
    ReturnType<import("@clinic-os/db").ClinicOperationsRepositoryPort["listLabCases"]>
  >[number]
>(detail: T) {
  return {
    labCase: stripScope(detail.labCase),
    vendor: stripScope(detail.vendor),
    items: detail.items.map(stripScope),
    statusHistory: detail.statusHistory.map(stripScope)
  };
}

function publicLabReconciliation<
  T extends NonNullable<
    Awaited<
      ReturnType<import("@clinic-os/db").ClinicOperationsRepositoryPort["createLabReconciliation"]>
    >
  >
>(detail: T) {
  return {
    reconciliation: stripScope(detail.reconciliation),
    entries: detail.entries.map(stripScope)
  };
}

function publicTemplate<
  T extends Awaited<
    ReturnType<
      import("@clinic-os/db").ClinicOperationsRepositoryPort["listInventoryCheckTemplates"]
    >
  >[number]
>(template: T) {
  return {
    ...stripScope(template),
    lines: template.lines.map(stripScope)
  };
}

function publicCheckRun<
  T extends NonNullable<
    Awaited<
      ReturnType<import("@clinic-os/db").ClinicOperationsRepositoryPort["createInventoryCheckRun"]>
    >
  >
>(detail: T) {
  return {
    run: stripScope(detail.run),
    template: stripScope(detail.template),
    lines: detail.lines.map(stripScope),
    procurementSuggestions: detail.procurementSuggestions.map(stripScope)
  };
}

function publicInventoryException<
  T extends Awaited<
    ReturnType<import("@clinic-os/db").ClinicOperationsRepositoryPort["listInventoryExceptions"]>
  >[number]
>(exception: T) {
  return {
    ...exception,
    item: stripScope(exception.item),
    checkRunLine: exception.checkRunLine ? stripScope(exception.checkRunLine) : null,
    procurementSuggestion: exception.procurementSuggestion
      ? stripScope(exception.procurementSuggestion)
      : null
  };
}

function labEventType(status: LabCaseStatus) {
  switch (status) {
    case "sent_to_lab":
      return "lab_case.sent" as const;
    case "received_by_lab":
      return "lab_case.received" as const;
    case "returned":
      return "lab_case.returned" as const;
    case "completed":
      return "lab_case.completed" as const;
    case "cancelled":
      return "lab_case.cancelled" as const;
    default:
      return "lab_case.status_changed" as const;
  }
}
