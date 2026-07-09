import type { AppointmentRecord, AppointmentStatus, QueueEntryRecord } from "./appointment.ts";
import type {
  BillingCurrency,
  InvoicePaymentStatus,
  InvoiceStatus,
  PaymentTransactionStatus,
  TreatmentPlanStatus
} from "./billing.ts";
import type { EncounterStatus } from "./clinical.ts";
import type { UUID } from "./ids.ts";
import type { LeadRecord, LeadSource } from "./lead.ts";
import type { PatientSource } from "./patient.ts";
import type { TaskRecord, TaskStatus, TaskType } from "./continuity.ts";

export interface MorningDashboardReadModel {
  date: string;
  appointmentCounts: Record<AppointmentStatus, number>;
  totalAppointments: number;
  unconfirmedAppointments: AppointmentRecord[];
  todaysAppointments: AppointmentRecord[];
  openLeads: LeadRecord[];
  openTasks: TaskRecord[];
  queue: QueueEntryRecord[];
  newPatientAppointmentIds: UUID[];
  returningPatientAppointmentIds: UUID[];
}

export function buildMorningDashboard(input: {
  date: string;
  appointments: readonly AppointmentRecord[];
  leads: readonly LeadRecord[];
  tasks: readonly TaskRecord[];
  queue: readonly QueueEntryRecord[];
  returningPatientIds: ReadonlySet<UUID>;
}): MorningDashboardReadModel {
  const appointmentCounts = {
    requested: 0,
    booked: 0,
    confirmed: 0,
    checked_in: 0,
    in_consult: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0
  } satisfies Record<AppointmentStatus, number>;

  const newPatientAppointmentIds: UUID[] = [];
  const returningPatientAppointmentIds: UUID[] = [];

  for (const appointment of input.appointments) {
    appointmentCounts[appointment.status] += 1;

    if (input.returningPatientIds.has(appointment.patientId)) {
      returningPatientAppointmentIds.push(appointment.id);
    } else {
      newPatientAppointmentIds.push(appointment.id);
    }
  }

  return {
    date: input.date,
    appointmentCounts,
    totalAppointments: input.appointments.length,
    unconfirmedAppointments: input.appointments.filter((appointment) =>
      ["requested", "booked"].includes(appointment.status)
    ),
    todaysAppointments: [...input.appointments],
    openLeads: [...input.leads],
    openTasks: [...input.tasks],
    queue: [...input.queue],
    newPatientAppointmentIds,
    returningPatientAppointmentIds
  };
}

export type OwnerDashboardSourceKey = PatientSource | "unknown";
export type OwnerDashboardTaskType =
  | TaskType
  | "post_op_follow_up"
  | "procurement"
  | "inventory_check"
  | "incident_follow_up"
  | "capa";
export type OwnerDashboardDataSourceStatus =
  | "ready"
  | "local_fixture"
  | "schema_dependency"
  | "empty";

export interface OwnerDashboardDataSource {
  key: string;
  label: string;
  status: OwnerDashboardDataSourceStatus;
  recordCount: number;
  provenance: string[];
  notes?: string | null;
}

export interface OwnerDashboardPatientSourceRecord {
  id: UUID;
  source: PatientSource;
  createdAt: string;
}

export interface OwnerDashboardLeadSourceRecord {
  id: UUID;
  patientId: UUID | null;
  source: LeadSource;
  status: LeadRecord["status"];
  firstSeenAt: string;
}

export interface OwnerDashboardAppointmentSourceRecord {
  id: UUID;
  patientId: UUID;
  leadId: UUID | null;
  status: AppointmentStatus;
  source: LeadSource;
  startAt: string;
}

export interface OwnerDashboardEncounterSourceRecord {
  id: UUID;
  patientId: UUID;
  appointmentId: UUID | null;
  status: EncounterStatus;
  createdAt: string;
}

export interface OwnerDashboardAttributionSourceRecord {
  id: UUID;
  patientId: UUID | null;
  leadId: UUID | null;
  appointmentId: UUID | null;
  invoiceId: UUID | null;
  source: LeadSource;
  touchType: "first_touch" | "booking_touch" | "revenue_touch" | "recall_touch";
  occurredAt: string;
}

export interface OwnerDashboardTreatmentPlanSourceRecord {
  id: UUID;
  patientId: UUID;
  status: TreatmentPlanStatus;
  totalMinor: number;
  presentedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface OwnerDashboardProcedureSourceRecord {
  id: UUID;
  patientId: UUID;
  encounterId: UUID;
  treatmentPlanId: UUID;
  invoiceId: UUID | null;
  status: "completed" | "entered_in_error";
  totalMinor: number;
  performedAt: string;
}

export interface OwnerDashboardInvoiceSourceRecord {
  id: UUID;
  patientId: UUID;
  treatmentPlanId: UUID | null;
  status: InvoiceStatus;
  paymentStatus: InvoicePaymentStatus;
  currency: BillingCurrency;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  issuedAt: string;
  dueAt: string | null;
}

export interface OwnerDashboardPaymentSourceRecord {
  id: UUID;
  invoiceId: UUID;
  status: PaymentTransactionStatus;
  amountMinor: number;
  receivedAt: string;
}

export type OwnerDashboardRecallStatus =
  | "due"
  | "contacted"
  | "booked"
  | "completed"
  | "cancelled";

export interface OwnerDashboardRecallSourceRecord {
  id: UUID;
  patientId: UUID | null;
  source: LeadSource | null;
  status: OwnerDashboardRecallStatus;
  dueAt: string;
  completedAt: string | null;
  bookedAppointmentId: UUID | null;
}

export interface OwnerDashboardTaskSourceRecord {
  id: UUID;
  patientId: UUID | null;
  taskType: OwnerDashboardTaskType;
  status: TaskStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OwnerDashboardSopRunStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled";

export interface OwnerDashboardSopRunSourceRecord {
  id: UUID;
  templateKey: string;
  status: OwnerDashboardSopRunStatus;
  scheduledFor: string;
  completedAt: string | null;
}

export type OwnerDashboardLabCaseStatus =
  | "draft"
  | "ready_for_pickup"
  | "sent_to_lab"
  | "received_by_lab"
  | "due"
  | "returned"
  | "fitted"
  | "completed"
  | "cancelled"
  | "rework_required";

export interface OwnerDashboardLabCaseSourceRecord {
  id: UUID;
  patientId: UUID | null;
  status: OwnerDashboardLabCaseStatus;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  reconciliationStatus: "not_required" | "pending" | "matched" | "variance";
  expectedAmountMinor: number;
  invoiceAmountMinor: number | null;
}

export interface OwnerDashboardInventoryExceptionSourceRecord {
  id: UUID;
  itemKey: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "procurement_requested" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
  procurementTaskId: UUID | null;
}

export interface OwnerDashboardIncidentSourceRecord {
  id: UUID;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "closed" | "cancelled";
  occurredAt: string;
}

export interface OwnerDashboardCorrectiveActionSourceRecord {
  id: UUID;
  incidentId: UUID;
  status: "assigned" | "in_progress" | "completed" | "cancelled";
  dueAt: string | null;
  assignedAt: string;
  completedAt: string | null;
}

export interface OwnerDashboardProjectionData {
  patients: readonly OwnerDashboardPatientSourceRecord[];
  leads: readonly OwnerDashboardLeadSourceRecord[];
  appointments: readonly OwnerDashboardAppointmentSourceRecord[];
  encounters: readonly OwnerDashboardEncounterSourceRecord[];
  attributionTouches: readonly OwnerDashboardAttributionSourceRecord[];
  treatmentPlans: readonly OwnerDashboardTreatmentPlanSourceRecord[];
  procedures: readonly OwnerDashboardProcedureSourceRecord[];
  invoices: readonly OwnerDashboardInvoiceSourceRecord[];
  payments: readonly OwnerDashboardPaymentSourceRecord[];
  recalls: readonly OwnerDashboardRecallSourceRecord[];
  tasks: readonly OwnerDashboardTaskSourceRecord[];
  sopRuns: readonly OwnerDashboardSopRunSourceRecord[];
  labCases: readonly OwnerDashboardLabCaseSourceRecord[];
  inventoryExceptions: readonly OwnerDashboardInventoryExceptionSourceRecord[];
  incidents: readonly OwnerDashboardIncidentSourceRecord[];
  correctiveActions: readonly OwnerDashboardCorrectiveActionSourceRecord[];
  dataSources: readonly OwnerDashboardDataSource[];
}

export interface OwnerDashboardMetricBySource {
  source: OwnerDashboardSourceKey;
  appointmentCount: number;
  noShowCount: number;
  newPatientCount: number;
  invoiceCount: number;
  invoicedMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  revenueTouchCount: number;
}

export interface OwnerDashboardReadModel {
  generatedAt: string;
  from: string;
  to: string;
  currency: BillingCurrency;
  dataSources: OwnerDashboardDataSource[];
  appointments: {
    scheduled: number;
    completed: number;
    noShow: number;
    noShowRateBasisPoints: number;
  };
  revenue: {
    invoicedMinor: number;
    collectedMinor: number;
    outstandingMinor: number;
    bySource: OwnerDashboardMetricBySource[];
    attributionCompleteness: {
      invoiceCount: number;
      invoiceWithRevenueTouchCount: number;
      invoiceWithAppointmentSourceCount: number;
      unresolvedInvoiceCount: number;
    };
  };
  recalls: {
    due: number;
    contacted: number;
    booked: number;
    completed: number;
    overdue: number;
    completedRateBasisPoints: number;
    bySource: { source: OwnerDashboardSourceKey; due: number; completed: number }[];
  };
  tasks: {
    open: number;
    overdue: number;
    completed: number;
    byType: { taskType: OwnerDashboardTaskType; open: number; overdue: number; completed: number }[];
  };
  sops: {
    due: number;
    completed: number;
    overdue: number;
    completionRateBasisPoints: number;
  };
  labs: {
    activeCases: number;
    overdueCases: number;
    reworkRequired: number;
    pendingReconciliation: number;
    reconciliationVarianceMinor: number;
  };
  inventory: {
    openExceptions: number;
    criticalExceptions: number;
    procurementRequests: number;
    resolvedExceptions: number;
  };
  treatmentAndPayments: {
    presentedPlanCount: number;
    acceptedPlanCount: number;
    acceptanceRateBasisPoints: number;
    proposedMinor: number;
    acceptedMinor: number;
    unacceptedMinor: number;
    completedProcedureMinor: number;
    completedButUninvoicedMinor: number;
    invoicedButUnpaidMinor: number;
    overdueInvoiceMinor: number;
  };
  incidents: {
    opened: number;
    open: number;
    highSeverityOpen: number;
    correctiveActionsAssigned: number;
    correctiveActionsCompleted: number;
    correctiveActionsOverdue: number;
  };
}

export function buildOwnerDashboardProjection(input: {
  from: string;
  to: string;
  generatedAt: string;
  currency?: BillingCurrency;
  data: OwnerDashboardProjectionData;
}): OwnerDashboardReadModel {
  const fromMs = parseInstant(input.from, "from");
  const toMs = parseInstant(input.to, "to");
  const generatedAtMs = parseInstant(input.generatedAt, "generatedAt");
  if (fromMs > toMs) throw new Error("Owner dashboard range starts after it ends.");

  const patients = new Map(input.data.patients.map((patient) => [patient.id, patient]));
  const appointments = input.data.appointments.filter((appointment) =>
    withinRange(appointment.startAt, fromMs, toMs)
  );
  const encountersById = new Map(input.data.encounters.map((encounter) => [encounter.id, encounter]));
  const appointmentsById = new Map(input.data.appointments.map((appointment) => [appointment.id, appointment]));
  const leadsById = new Map(input.data.leads.map((lead) => [lead.id, lead]));
  const invoicesById = new Map(input.data.invoices.map((invoice) => [invoice.id, invoice]));
  const proceduresByInvoiceId = groupBy(
    input.data.procedures.filter((procedure) => procedure.invoiceId),
    (procedure) => procedure.invoiceId ?? "unknown"
  );
  const touchesByInvoiceId = groupBy(
    input.data.attributionTouches.filter((touch) => touch.invoiceId),
    (touch) => touch.invoiceId ?? "unknown"
  );

  const bySource = new Map<OwnerDashboardSourceKey, OwnerDashboardMetricBySource>();
  const sourceMetric = (source: OwnerDashboardSourceKey): OwnerDashboardMetricBySource => {
    const existing = bySource.get(source);
    if (existing) return existing;
    const created = {
      source,
      appointmentCount: 0,
      noShowCount: 0,
      newPatientCount: 0,
      invoiceCount: 0,
      invoicedMinor: 0,
      collectedMinor: 0,
      outstandingMinor: 0,
      revenueTouchCount: 0
    };
    bySource.set(source, created);
    return created;
  };

  for (const patient of input.data.patients) {
    if (withinRange(patient.createdAt, fromMs, toMs)) {
      sourceMetric(normalizeDashboardSource(patient.source)).newPatientCount += 1;
    }
  }

  for (const appointment of appointments) {
    const metric = sourceMetric(normalizeDashboardSource(appointment.source));
    metric.appointmentCount += 1;
    if (appointment.status === "no_show") metric.noShowCount += 1;
  }

  const invoices = input.data.invoices.filter((invoice) =>
    withinRange(invoice.issuedAt, fromMs, toMs)
  );
  let invoiceWithRevenueTouchCount = 0;
  let invoiceWithAppointmentSourceCount = 0;
  let unresolvedInvoiceCount = 0;

  for (const invoice of invoices) {
    const resolution = resolveInvoiceSource({
      invoice,
      patients,
      procedures: proceduresByInvoiceId.get(invoice.id) ?? [],
      touches: touchesByInvoiceId.get(invoice.id) ?? [],
      encountersById,
      appointmentsById,
      leadsById
    });
    const metric = sourceMetric(resolution.source);
    metric.invoiceCount += 1;
    metric.invoicedMinor += invoice.totalMinor;
    metric.outstandingMinor += invoice.balanceMinor;
    metric.revenueTouchCount += resolution.revenueTouchCount;

    if (resolution.kind === "revenue_touch") invoiceWithRevenueTouchCount += 1;
    if (resolution.kind === "appointment") invoiceWithAppointmentSourceCount += 1;
    if (resolution.source === "unknown") unresolvedInvoiceCount += 1;
  }

  for (const payment of input.data.payments.filter((candidate) =>
    withinRange(candidate.receivedAt, fromMs, toMs)
  )) {
    if (!isCollectedPaymentStatus(payment.status)) continue;
    const invoice = invoicesById.get(payment.invoiceId);
    if (!invoice) continue;
    const resolution = resolveInvoiceSource({
      invoice,
      patients,
      procedures: proceduresByInvoiceId.get(invoice.id) ?? [],
      touches: touchesByInvoiceId.get(invoice.id) ?? [],
      encountersById,
      appointmentsById,
      leadsById
    });
    sourceMetric(resolution.source).collectedMinor += payment.amountMinor;
  }

  const recallRows = input.data.recalls.filter((recall) => withinRange(recall.dueAt, fromMs, toMs));
  const recallBySource = new Map<OwnerDashboardSourceKey, { source: OwnerDashboardSourceKey; due: number; completed: number }>();
  const recallSourceMetric = (
    source: OwnerDashboardSourceKey
  ): { source: OwnerDashboardSourceKey; due: number; completed: number } => {
    const existing = recallBySource.get(source);
    if (existing) return existing;
    const created = { source, due: 0, completed: 0 };
    recallBySource.set(source, created);
    return created;
  };
  let recallDue = 0;
  let recallContacted = 0;
  let recallBooked = 0;
  let recallCompleted = 0;
  let recallOverdue = 0;
  for (const recall of recallRows) {
    const source = normalizeDashboardSource(
      recall.source ?? (recall.patientId ? patients.get(recall.patientId)?.source : undefined)
    );
    const metric = recallSourceMetric(source);
    recallDue += 1;
    metric.due += 1;
    if (recall.status === "contacted") recallContacted += 1;
    if (recall.status === "booked") recallBooked += 1;
    if (recall.status === "completed") {
      recallCompleted += 1;
      metric.completed += 1;
    }
    if (!["completed", "cancelled"].includes(recall.status) && parseInstant(recall.dueAt, "recall.dueAt") < generatedAtMs) {
      recallOverdue += 1;
    }
  }

  const taskRows = input.data.tasks.filter((task) =>
    (task.dueAt ? parseInstant(task.dueAt, "task.dueAt") <= toMs : false) ||
    withinRange(task.createdAt, fromMs, toMs) ||
    withinRange(task.updatedAt, fromMs, toMs)
  );
  const taskTypeMetrics = new Map<
    OwnerDashboardTaskType,
    { taskType: OwnerDashboardTaskType; open: number; overdue: number; completed: number }
  >();
  const taskTypeMetric = (
    taskType: OwnerDashboardTaskType
  ): { taskType: OwnerDashboardTaskType; open: number; overdue: number; completed: number } => {
    const existing = taskTypeMetrics.get(taskType);
    if (existing) return existing;
    const created = { taskType, open: 0, overdue: 0, completed: 0 };
    taskTypeMetrics.set(taskType, created);
    return created;
  };
  let openTasks = 0;
  let overdueTasks = 0;
  let completedTasks = 0;
  for (const task of taskRows) {
    const metric = taskTypeMetric(task.taskType);
    if (task.status === "done" && withinRange(task.updatedAt, fromMs, toMs)) {
      completedTasks += 1;
      metric.completed += 1;
      continue;
    }
    if (["open", "in_progress"].includes(task.status)) {
      openTasks += 1;
      metric.open += 1;
      if (task.dueAt && parseInstant(task.dueAt, "task.dueAt") < generatedAtMs) {
        overdueTasks += 1;
        metric.overdue += 1;
      }
    }
  }

  const sopRows = input.data.sopRuns.filter((sop) =>
    withinRange(sop.scheduledFor, fromMs, toMs)
  );
  const sopDue = sopRows.length;
  const sopCompleted = sopRows.filter((sop) => sop.status === "completed").length;
  const sopOverdue = sopRows.filter(
    (sop) => !["completed", "cancelled"].includes(sop.status) && parseInstant(sop.scheduledFor, "sop.scheduledFor") < generatedAtMs
  ).length;

  const labRows = input.data.labCases.filter((labCase) =>
    withinRange(labCase.createdAt, fromMs, toMs) ||
    (labCase.dueAt ? withinRange(labCase.dueAt, fromMs, toMs) : false) ||
    (labCase.completedAt ? withinRange(labCase.completedAt, fromMs, toMs) : false)
  );
  const activeLabCases = labRows.filter(
    (labCase) => !["completed", "cancelled"].includes(labCase.status)
  );
  const pendingReconciliation = labRows.filter(
    (labCase) =>
      labCase.status === "completed" &&
      ["pending", "variance"].includes(labCase.reconciliationStatus)
  );

  const inventoryRows = input.data.inventoryExceptions.filter((exception) =>
    withinRange(exception.detectedAt, fromMs, toMs) ||
    (exception.resolvedAt ? withinRange(exception.resolvedAt, fromMs, toMs) : false)
  );
  const incidentRows = input.data.incidents.filter((incident) =>
    withinRange(incident.occurredAt, fromMs, toMs)
  );
  const correctiveActionRows = input.data.correctiveActions.filter((action) =>
    withinRange(action.assignedAt, fromMs, toMs) ||
    (action.completedAt ? withinRange(action.completedAt, fromMs, toMs) : false) ||
    (action.dueAt ? withinRange(action.dueAt, fromMs, toMs) : false)
  );
  const treatmentPlans = input.data.treatmentPlans.filter((plan) =>
    withinRange(plan.createdAt, fromMs, toMs) ||
    (plan.presentedAt ? withinRange(plan.presentedAt, fromMs, toMs) : false) ||
    (plan.acceptedAt ? withinRange(plan.acceptedAt, fromMs, toMs) : false)
  );
  const presentedPlans = treatmentPlans.filter((plan) => plan.status !== "draft");
  const acceptedPlans = treatmentPlans.filter((plan) => plan.status === "accepted");
  const completedProcedures = input.data.procedures.filter(
    (procedure) =>
      procedure.status === "completed" && withinRange(procedure.performedAt, fromMs, toMs)
  );

  const revenueBySource = [...bySource.values()].sort((left, right) =>
    left.source.localeCompare(right.source)
  );
  const recallBySourceRows = [...recallBySource.values()].sort((left, right) =>
    left.source.localeCompare(right.source)
  );

  return {
    generatedAt: input.generatedAt,
    from: input.from,
    to: input.to,
    currency: input.currency ?? "INR",
    dataSources: [...input.data.dataSources],
    appointments: {
      scheduled: appointments.length,
      completed: appointments.filter((appointment) => appointment.status === "completed").length,
      noShow: appointments.filter((appointment) => appointment.status === "no_show").length,
      noShowRateBasisPoints: rateBasisPoints(
        appointments.filter((appointment) => appointment.status === "no_show").length,
        appointments.length
      )
    },
    revenue: {
      invoicedMinor: invoices.reduce((total, invoice) => total + invoice.totalMinor, 0),
      collectedMinor: revenueBySource.reduce((total, metric) => total + metric.collectedMinor, 0),
      outstandingMinor: invoices.reduce((total, invoice) => total + invoice.balanceMinor, 0),
      bySource: revenueBySource,
      attributionCompleteness: {
        invoiceCount: invoices.length,
        invoiceWithRevenueTouchCount,
        invoiceWithAppointmentSourceCount,
        unresolvedInvoiceCount
      }
    },
    recalls: {
      due: recallDue,
      contacted: recallContacted,
      booked: recallBooked,
      completed: recallCompleted,
      overdue: recallOverdue,
      completedRateBasisPoints: rateBasisPoints(recallCompleted, recallDue),
      bySource: recallBySourceRows
    },
    tasks: {
      open: openTasks,
      overdue: overdueTasks,
      completed: completedTasks,
      byType: [...taskTypeMetrics.values()].sort((left, right) =>
        left.taskType.localeCompare(right.taskType)
      )
    },
    sops: {
      due: sopDue,
      completed: sopCompleted,
      overdue: sopOverdue,
      completionRateBasisPoints: rateBasisPoints(sopCompleted, sopDue)
    },
    labs: {
      activeCases: activeLabCases.length,
      overdueCases: activeLabCases.filter(
        (labCase) => labCase.dueAt && parseInstant(labCase.dueAt, "labCase.dueAt") < generatedAtMs
      ).length,
      reworkRequired: labRows.filter((labCase) => labCase.status === "rework_required").length,
      pendingReconciliation: pendingReconciliation.length,
      reconciliationVarianceMinor: pendingReconciliation.reduce(
        (total, labCase) => total + ((labCase.invoiceAmountMinor ?? labCase.expectedAmountMinor) - labCase.expectedAmountMinor),
        0
      )
    },
    inventory: {
      openExceptions: inventoryRows.filter((exception) => exception.status !== "resolved").length,
      criticalExceptions: inventoryRows.filter(
        (exception) => exception.status !== "resolved" && exception.severity === "critical"
      ).length,
      procurementRequests: inventoryRows.filter(
        (exception) => exception.status === "procurement_requested" || exception.procurementTaskId
      ).length,
      resolvedExceptions: inventoryRows.filter((exception) => exception.status === "resolved").length
    },
    treatmentAndPayments: {
      presentedPlanCount: presentedPlans.length,
      acceptedPlanCount: acceptedPlans.length,
      acceptanceRateBasisPoints: rateBasisPoints(acceptedPlans.length, presentedPlans.length),
      proposedMinor: treatmentPlans.reduce((total, plan) => total + plan.totalMinor, 0),
      acceptedMinor: acceptedPlans.reduce((total, plan) => total + plan.totalMinor, 0),
      unacceptedMinor: treatmentPlans
        .filter((plan) => plan.status !== "accepted")
        .reduce((total, plan) => total + plan.totalMinor, 0),
      completedProcedureMinor: completedProcedures.reduce((total, procedure) => total + procedure.totalMinor, 0),
      completedButUninvoicedMinor: completedProcedures
        .filter((procedure) => !procedure.invoiceId)
        .reduce((total, procedure) => total + procedure.totalMinor, 0),
      invoicedButUnpaidMinor: invoices.reduce((total, invoice) => total + invoice.balanceMinor, 0),
      overdueInvoiceMinor: invoices
        .filter(
          (invoice) =>
            invoice.balanceMinor > 0 &&
            invoice.dueAt !== null &&
            parseInstant(invoice.dueAt, "invoice.dueAt") < generatedAtMs
        )
        .reduce((total, invoice) => total + invoice.balanceMinor, 0)
    },
    incidents: {
      opened: incidentRows.length,
      open: incidentRows.filter((incident) => incident.status === "open").length,
      highSeverityOpen: incidentRows.filter(
        (incident) =>
          incident.status === "open" && ["high", "critical"].includes(incident.severity)
      ).length,
      correctiveActionsAssigned: correctiveActionRows.filter((action) =>
        ["assigned", "in_progress"].includes(action.status)
      ).length,
      correctiveActionsCompleted: correctiveActionRows.filter((action) => action.status === "completed").length,
      correctiveActionsOverdue: correctiveActionRows.filter(
        (action) =>
          ["assigned", "in_progress"].includes(action.status) &&
          action.dueAt !== null &&
          parseInstant(action.dueAt, "correctiveAction.dueAt") < generatedAtMs
      ).length
    }
  };
}

function resolveInvoiceSource(input: {
  invoice: OwnerDashboardInvoiceSourceRecord;
  patients: ReadonlyMap<UUID, OwnerDashboardPatientSourceRecord>;
  procedures: readonly OwnerDashboardProcedureSourceRecord[];
  touches: readonly OwnerDashboardAttributionSourceRecord[];
  encountersById: ReadonlyMap<UUID, OwnerDashboardEncounterSourceRecord>;
  appointmentsById: ReadonlyMap<UUID, OwnerDashboardAppointmentSourceRecord>;
  leadsById: ReadonlyMap<UUID, OwnerDashboardLeadSourceRecord>;
}): {
  source: OwnerDashboardSourceKey;
  kind: "revenue_touch" | "appointment" | "lead" | "patient" | "unknown";
  revenueTouchCount: number;
} {
  const revenueTouches = input.touches.filter((touch) => touch.touchType === "revenue_touch");
  if (revenueTouches.length > 0) {
    return {
      source: normalizeDashboardSource(
        revenueTouches.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0].source
      ),
      kind: "revenue_touch",
      revenueTouchCount: revenueTouches.length
    };
  }

  for (const procedure of input.procedures) {
    const encounter = input.encountersById.get(procedure.encounterId);
    const appointment = encounter?.appointmentId
      ? input.appointmentsById.get(encounter.appointmentId)
      : null;
    if (appointment) {
      return {
        source: normalizeDashboardSource(appointment.source),
        kind: "appointment",
        revenueTouchCount: 0
      };
    }
  }

  const lead = [...input.leadsById.values()].find(
    (candidate) => candidate.patientId === input.invoice.patientId
  );
  if (lead) {
    return {
      source: normalizeDashboardSource(lead.source),
      kind: "lead",
      revenueTouchCount: 0
    };
  }

  const patient = input.patients.get(input.invoice.patientId);
  if (patient) {
    return {
      source: normalizeDashboardSource(patient.source),
      kind: "patient",
      revenueTouchCount: 0
    };
  }

  return { source: "unknown", kind: "unknown", revenueTouchCount: 0 };
}

function isCollectedPaymentStatus(status: PaymentTransactionStatus): boolean {
  return status === "succeeded" || status === "manually_recorded";
}

function normalizeDashboardSource(source: PatientSource | LeadSource | null | undefined): OwnerDashboardSourceKey {
  return source ?? "unknown";
}

function parseInstant(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be an ISO timestamp.`);
  return timestamp;
}

function withinRange(value: string, fromMs: number, toMs: number): boolean {
  const timestamp = parseInstant(value, "timestamp");
  return timestamp >= fromMs && timestamp <= toMs;
}

function rateBasisPoints(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000);
}

function groupBy<T>(
  values: readonly T[],
  keySelector: (value: T) => string
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keySelector(value);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }
  return grouped;
}
