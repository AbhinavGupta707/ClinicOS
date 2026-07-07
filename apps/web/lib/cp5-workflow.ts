import type { ClinicRole } from "./roles";

export type Cp5WorkflowSource = "api" | "cp5_fixture";

export type TreatmentPlanStatus = "draft" | "accepted";
export type TreatmentPhaseStatus = "planned" | "ready" | "completed";
export type ProcedurePerformedStatus = "completed";
export type InvoiceState =
  | "draft"
  | "payment_requested"
  | "partially_paid"
  | "manually_recorded"
  | "paid"
  | "reconciliation_required";
export type PaymentRequestState =
  | "created"
  | "pending_provider_confirmation"
  | "provider_unavailable"
  | "no_key"
  | "webhook_not_configured"
  | "failed";
export type ManualPaymentMethod = "bank_transfer" | "card" | "cash" | "upi";
export type ReceiptState = "generated" | "print_ready" | "send_requested";
export type PrescriptionState = "draft" | "signed";
export type InstructionState = "draft" | "print_ready" | "send_requested" | "provider_unavailable";

export interface Cp5Patient {
  accountLabel: string;
  displayName: string;
  id: string;
  kind: "new" | "returning";
  visitReason: string;
}

export interface Cp5Encounter {
  chair: string;
  id: string;
  patientId: string;
  providerName: string;
  startedAt: string;
  status: "encounter_started" | "ready_for_checkout";
}

export interface PricebookProcedure {
  category: string;
  code: string;
  defaultAmountCents: number;
  id: string;
  name: string;
  taxable: boolean;
}

export interface TreatmentPlanItem {
  amountCents: number;
  id: string;
  phaseId: string;
  procedureId: string;
  procedureName: string;
  quantity: number;
  toothNumber?: string;
}

export interface TreatmentPhase {
  id: string;
  items: TreatmentPlanItem[];
  name: string;
  sequence: number;
  status: TreatmentPhaseStatus;
}

export interface TreatmentPlan {
  acceptedAt?: string;
  acceptedBy?: string;
  acceptanceMethod?: "chairside_confirmation" | "signed_estimate";
  createdAt: string;
  encounterId: string;
  id: string;
  patientId: string;
  phases: TreatmentPhase[];
  status: TreatmentPlanStatus;
  title: string;
}

export interface ProcedurePerformed {
  amountCents: number;
  completedAt: string;
  encounterId: string;
  id: string;
  patientId: string;
  procedureName: string;
  sourcePlanItemId: string;
  status: ProcedurePerformedStatus;
}

export interface InvoiceItem {
  amountCents: number;
  id: string;
  procedurePerformedId: string;
  quantity: number;
  title: string;
}

export interface PaymentRequest {
  amountCents: number;
  channel: "dynamic_qr" | "payment_link";
  createdAt: string;
  expiresAt?: string;
  id: string;
  invoiceId: string;
  provider: "razorpay" | "simulator";
  providerReference?: string;
  state: PaymentRequestState;
  statusDetail: string;
}

export interface ManualPayment {
  actorName: string;
  amountCents: number;
  auditStatus: "required_fields_recorded";
  createdAt: string;
  id: string;
  invoiceId: string;
  method: ManualPaymentMethod;
  reason: string;
  reference: string;
}

export interface Receipt {
  amountCents: number;
  generatedAt: string;
  generatedBy: string;
  id: string;
  invoiceId: string;
  state: ReceiptState;
}

export interface Invoice {
  createdAt: string;
  id: string;
  invoiceNumber: string;
  items: InvoiceItem[];
  lastReadAt?: string;
  patientId: string;
  paymentRequests: PaymentRequest[];
  payments: ManualPayment[];
  receipts: Receipt[];
  state: InvoiceState;
  totalAmountCents: number;
  treatmentPlanId: string;
}

export interface PrescriptionOutput {
  encounterId: string;
  id: string;
  items: Array<{
    dosage: string;
    duration: string;
    medication: string;
  }>;
  signedAt?: string;
  signedBy?: string;
  state: PrescriptionState;
}

export interface InstructionTemplate {
  id: string;
  title: string;
  type: "post_op" | "product" | "recall";
}

export interface InstructionRecord {
  channel: "print" | "whatsapp";
  createdAt: string;
  id: string;
  patientId: string;
  state: InstructionState;
  templateId: string;
  title: string;
}

export interface Cp5TimelineItem {
  at: string;
  detail: string;
  id: string;
  kind:
    | "treatment_plan.created"
    | "treatment_plan.accepted"
    | "procedure.completed"
    | "invoice.created"
    | "invoice.read"
    | "payment.requested"
    | "payment.manually_recorded"
    | "receipt.generated"
    | "prescription.signed"
    | "instruction.generated";
  title: string;
}

export interface PaymentProviderReadiness {
  dynamicQr: "available" | "missing_key" | "unavailable";
  hostedWebhook: "configured" | "not_configured";
  mode: "live" | "simulator";
  paymentLinks: "available" | "missing_key" | "unavailable";
  provider: "razorpay" | "simulator";
}

export interface Cp5WorkflowData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  encounters: Cp5Encounter[];
  instructionRecords: InstructionRecord[];
  instructionTemplates: InstructionTemplate[];
  invoices: Invoice[];
  patients: Cp5Patient[];
  prescriptions: PrescriptionOutput[];
  pricebook: PricebookProcedure[];
  proceduresPerformed: ProcedurePerformed[];
  providerReadiness: PaymentProviderReadiness;
  source: Cp5WorkflowSource;
  timeline: Cp5TimelineItem[];
  today: string;
  treatmentPlans: TreatmentPlan[];
}

export type Cp5WorkflowProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP5_ENDPOINT_NOT_REGISTERED"
  | "CP5_READ_MODEL_DEFERRED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp5EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp5WorkflowProblem {
  code: Cp5WorkflowProblemCode;
  detail?: string;
  endpoints: Cp5EndpointIssue[];
  message: string;
}

export type Cp5WorkflowLoadState =
  | { data: Cp5WorkflowData; status: "ready" }
  | { problem: Cp5WorkflowProblem; status: "unauthenticated" | "unavailable" };

export interface EstimateItemInput {
  phaseId: string;
  procedureId: string;
  quantity: number;
  toothNumber?: string;
}

export interface TreatmentPlanAcceptInput {
  acceptedBy: string;
  acceptanceMethod: "chairside_confirmation" | "signed_estimate";
  treatmentPlanId: string;
}

export interface ProcedurePerformedInput {
  actorName: string;
  encounterId: string;
  patientId: string;
  treatmentPlanId: string;
  treatmentPlanEstimateItemId: string;
}

export interface InvoiceCreateInput {
  actorName: string;
  patientId: string;
  procedurePerformedIds: string[];
  treatmentPlanId: string;
}

export interface PaymentRequestInput {
  amountCents: number;
  channel: "dynamic_qr" | "payment_link";
  invoiceId: string;
}

export interface ManualPaymentInput {
  actorName: string;
  amountCents: number;
  invoiceId: string;
  method: ManualPaymentMethod;
  reason: string;
  reference: string;
}

export interface ReceiptCreateInput {
  actorName: string;
  invoiceId: string;
}

export interface InstructionCreateInput {
  channel: "print" | "whatsapp";
  patientId: string;
  templateId: string;
}

export interface PrescriptionSignInput {
  actorName: string;
  actorRoles: ClinicRole[];
  prescriptionId: string;
}

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export const CP5_REQUIRED_ENDPOINTS = [
  "GET /v1/pricebook/procedures",
  "POST /v1/patients/{patientId}/treatment-plans",
  "PATCH /v1/treatment-plans/{treatmentPlanId}",
  "POST /v1/treatment-plans/{treatmentPlanId}/accept",
  "POST /v1/encounters/{encounterId}/procedures",
  "POST /v1/invoices",
  "GET /v1/invoices/{invoiceId}",
  "POST /v1/invoices/{invoiceId}/payment-requests",
  "POST /v1/invoices/{invoiceId}/manual-payments",
  "POST /v1/invoices/{invoiceId}/receipts",
  "POST /v1/encounters/{encounterId}/prescriptions",
  "POST /v1/prescriptions/{prescriptionId}/sign",
  "POST /v1/patients/{patientId}/instructions"
] as const;

export const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  draft: "Draft",
  manually_recorded: "Manual payment recorded",
  paid: "Paid by verified provider",
  partially_paid: "Partially paid",
  payment_requested: "Payment requested",
  reconciliation_required: "Reconciliation required"
};

export const PAYMENT_REQUEST_STATE_LABELS: Record<PaymentRequestState, string> = {
  created: "Created",
  failed: "Failed",
  no_key: "No provider key",
  pending_provider_confirmation: "Awaiting verified provider confirmation",
  provider_unavailable: "Provider unavailable",
  webhook_not_configured: "Hosted webhook not configured"
};

export const MANUAL_PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  upi: "UPI"
};

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
let fixtureIdCounter = 0;

export function getTodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp5FixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function canEditTreatmentPlan(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "doctor", "assistant"].includes(role));
}

export function canAcceptTreatmentPlan(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "doctor", "assistant", "receptionist"].includes(role));
}

export function canRecordProcedure(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "doctor", "assistant"].includes(role));
}

export function canManagePayments(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "assistant", "receptionist", "accountant"].includes(role));
}

export function canSignPrescription(roles: ClinicRole[]) {
  return roles.includes("doctor");
}

export function canViewClinicalOutput(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "doctor", "assistant", "receptionist"].includes(role));
}

export function canManageInstructions(roles: ClinicRole[]) {
  return roles.some((role) => ["owner", "doctor", "assistant", "receptionist"].includes(role));
}

export function getOutstandingAmountCents(invoice: Invoice) {
  const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);

  return Math.max(invoice.totalAmountCents - paid, 0);
}

export function getPlanTotalCents(plan: TreatmentPlan) {
  return plan.phases.reduce(
    (phaseTotal, phase) =>
      phaseTotal +
      phase.items.reduce((itemTotal, item) => itemTotal + item.amountCents * item.quantity, 0),
    0
  );
}

export function getInvoicePaidAmountCents(invoice: Invoice) {
  return invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

export function createFixtureCp5WorkflowData(today = getTodayInputValue()): Cp5WorkflowData {
  const patientId = "cp5SyntheticPatient";
  const encounterId = "cp5SyntheticEncounter";
  const treatmentPlanId = "cp5TreatmentPlanAccepted";
  const phaseOneId = "cp5PhaseDiagnostics";
  const phaseTwoId = "cp5PhaseRestoration";
  const createdAt = `${today}T05:15:00.000Z`;
  const acceptedAt = `${today}T05:23:00.000Z`;

  const pricebook: PricebookProcedure[] = [
    {
      category: "Diagnostics",
      code: "CONSULT-001",
      defaultAmountCents: 50000,
      id: "cp5ProcConsult",
      name: "Consultation and treatment planning",
      taxable: false
    },
    {
      category: "Restorative",
      code: "REST-FILL-001",
      defaultAmountCents: 220000,
      id: "cp5ProcRestoration",
      name: "Composite restoration",
      taxable: false
    },
    {
      category: "Preventive",
      code: "SCALING-001",
      defaultAmountCents: 180000,
      id: "cp5ProcScaling",
      name: "Scaling and polishing",
      taxable: false
    }
  ];

  const consultItem: TreatmentPlanItem = {
    amountCents: 50000,
    id: "cp5PlanItemConsult",
    phaseId: phaseOneId,
    procedureId: "cp5ProcConsult",
    procedureName: "Consultation and treatment planning",
    quantity: 1
  };
  const restorationItem: TreatmentPlanItem = {
    amountCents: 220000,
    id: "cp5PlanItemRestoration36",
    phaseId: phaseTwoId,
    procedureId: "cp5ProcRestoration",
    procedureName: "Composite restoration",
    quantity: 1,
    toothNumber: "36"
  };

  return {
    api: {
      environment: "local synthetic CP5 fixture",
      requestIds: ["fixture-cp5-workflow"]
    },
    encounters: [
      {
        chair: "Chair 1",
        id: encounterId,
        patientId,
        providerName: "Dr Synthetic Rao",
        startedAt: `${today}T04:45:00.000Z`,
        status: "ready_for_checkout"
      }
    ],
    instructionRecords: [],
    instructionTemplates: [
      {
        id: "cp5InstructionPostRestoration",
        title: "Composite restoration post-care",
        type: "post_op"
      },
      {
        id: "cp5InstructionRecall",
        title: "Six-month recall and hygiene guidance",
        type: "recall"
      }
    ],
    invoices: [],
    patients: [
      {
        accountLabel: "CP5 account SYN-001",
        displayName: "Synthetic checkout patient",
        id: patientId,
        kind: "returning",
        visitReason: "CP5 treatment checkout verification"
      }
    ],
    prescriptions: [
      {
        encounterId,
        id: "cp5PrescriptionDraft",
        items: [
          {
            dosage: "After food",
            duration: "3 days",
            medication: "Synthetic analgesic entry"
          }
        ],
        state: "draft"
      }
    ],
    pricebook,
    proceduresPerformed: [],
    providerReadiness: {
      dynamicQr: "missing_key",
      hostedWebhook: "not_configured",
      mode: "simulator",
      paymentLinks: "missing_key",
      provider: "razorpay"
    },
    source: "cp5_fixture",
    timeline: [
      timelineItem(
        "treatment_plan.accepted",
        "Treatment plan accepted",
        "Synthetic patient acceptance captured for the estimate.",
        acceptedAt
      ),
      timelineItem(
        "treatment_plan.created",
        "Treatment plan created",
        "Phased synthetic treatment plan created from chart intent.",
        createdAt
      )
    ],
    today,
    treatmentPlans: [
      {
        acceptedAt,
        acceptedBy: "doctor fixture user",
        acceptanceMethod: "chairside_confirmation",
        createdAt,
        encounterId,
        id: treatmentPlanId,
        patientId,
        phases: [
          {
            id: phaseOneId,
            items: [consultItem],
            name: "Phase 1 - diagnosis",
            sequence: 1,
            status: "ready"
          },
          {
            id: phaseTwoId,
            items: [restorationItem],
            name: "Phase 2 - restoration",
            sequence: 2,
            status: "planned"
          }
        ],
        status: "accepted",
        title: "Synthetic phased restoration plan"
      }
    ]
  };
}

export async function loadCp5Workflow(
  signal?: AbortSignal,
  today = getTodayInputValue()
): Promise<Cp5WorkflowLoadState> {
  if (isCp5FixtureAllowed()) {
    return {
      data: createFixtureCp5WorkflowData(today),
      status: "ready"
    };
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return {
    problem: {
      code: "CP5_READ_MODEL_DEFERRED",
      endpoints: CP5_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "Granular CP5 write/read endpoint in the live route family."
      })),
      message:
        "The live CP5 aggregate read model is deferred; enable the local fixture for the temporary checkout surface or use the granular CP5 API routes."
    },
    status: "unavailable"
  };
}

function toApiTreatmentPlanPhase(phase: {
  items: Array<{
    amountCents: number;
    procedureId: string;
    quantity: number;
    toothNumber?: string;
  }>;
  name: string;
}) {
  return {
    items: phase.items.map((item) => ({
      pricebookProcedureId: item.procedureId,
      quantity: item.quantity,
      toothNumber: item.toothNumber ?? null,
      unitPriceMinor: item.amountCents
    })),
    title: phase.name
  };
}

export async function createLiveTreatmentPlan(
  patientId: string,
  input: {
    encounterId: string;
    phases: Array<{
      items: Array<{
        amountCents: number;
        procedureId: string;
        quantity: number;
        toothNumber?: string;
      }>;
      name: string;
      sequence: number;
    }>;
    title: string;
  },
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/patients/${encodeURIComponent(patientId)}/treatment-plans`,
    {
      encounterId: input.encounterId,
      phases: input.phases.map(toApiTreatmentPlanPhase),
      status: "presented",
      title: input.title
    },
    signal
  );
}

export async function updateLiveTreatmentPlan(
  treatmentPlanId: string,
  input: {
    phases: TreatmentPlan["phases"];
    title: string;
  },
  signal?: AbortSignal
) {
  return patchEndpoint(
    `/v1/treatment-plans/${encodeURIComponent(treatmentPlanId)}`,
    {
      phases: input.phases.map(toApiTreatmentPlanPhase),
      title: input.title
    },
    signal
  );
}

export async function acceptLiveTreatmentPlan(
  input: TreatmentPlanAcceptInput,
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/treatment-plans/${encodeURIComponent(input.treatmentPlanId)}/accept`,
    {
      acceptedByName: input.acceptedBy,
      acceptanceEvidence: {
        acceptanceMethod: input.acceptanceMethod,
        capturedBy: input.acceptedBy
      }
    },
    signal
  );
}

export async function recordLiveProcedure(input: ProcedurePerformedInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/encounters/${encodeURIComponent(input.encounterId)}/procedures`,
    {
      provenance: {
        actorName: input.actorName,
        patientId: input.patientId,
        source: "checkout_surface"
      },
      treatmentPlanEstimateItemId: input.treatmentPlanEstimateItemId,
      treatmentPlanId: input.treatmentPlanId
    },
    signal
  );
}

export async function createLiveInvoice(input: InvoiceCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    "/v1/invoices",
    {
      actorName: input.actorName,
      patientId: input.patientId,
      procedurePerformedIds: input.procedurePerformedIds,
      treatmentPlanId: input.treatmentPlanId
    },
    signal
  );
}

export async function readLiveInvoice(invoiceId: string, signal?: AbortSignal) {
  return fetchEndpoint(`/v1/invoices/${encodeURIComponent(invoiceId)}`, {}, signal);
}

export async function createLivePaymentRequest(input: PaymentRequestInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/invoices/${encodeURIComponent(input.invoiceId)}/payment-requests`,
    {
      amountMinor: input.amountCents,
      requestType: input.channel === "dynamic_qr" ? "invoice_qr" : "payment_link"
    },
    signal
  );
}

export async function recordLiveManualPayment(input: ManualPaymentInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/invoices/${encodeURIComponent(input.invoiceId)}/manual-payments`,
    {
      amountMinor: input.amountCents,
      currency: "INR",
      evidence: {
        actorName: input.actorName,
        source: "checkout_surface"
      },
      method: input.method,
      reason: input.reason,
      reference: input.reference
    },
    signal
  );
}

export async function createLiveReceipt(input: ReceiptCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/invoices/${encodeURIComponent(input.invoiceId)}/receipts`,
    {
      paymentTransactionIds: []
    },
    signal
  );
}

export async function createLiveInstruction(input: InstructionCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/patients/${encodeURIComponent(input.patientId)}/instructions`,
    {
      channel: input.channel,
      templateId: input.templateId
    },
    signal
  );
}

export async function signLivePrescription(input: PrescriptionSignInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/prescriptions/${encodeURIComponent(input.prescriptionId)}/sign`,
    {
      actorName: input.actorName
    },
    signal
  );
}

export function applyFixtureAddEstimateItem(
  data: Cp5WorkflowData,
  treatmentPlanId: string,
  input: EstimateItemInput
) {
  const procedure = data.pricebook.find((item) => item.id === input.procedureId);

  if (!procedure) {
    throw new Error("Select a valid procedure before adding an estimate item.");
  }

  const quantity = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 1;
  const item: TreatmentPlanItem = {
    amountCents: procedure.defaultAmountCents,
    id: nextFixtureId("cp5-plan-item"),
    phaseId: input.phaseId,
    procedureId: procedure.id,
    procedureName: procedure.name,
    quantity,
    toothNumber: input.toothNumber?.trim() || undefined
  };

  return {
    ...data,
    treatmentPlans: data.treatmentPlans.map((plan) =>
      plan.id === treatmentPlanId
        ? {
            ...plan,
            phases: plan.phases.map((phase) =>
              phase.id === input.phaseId
                ? {
                    ...phase,
                    items: [...phase.items, item]
                  }
                : phase
            ),
            status: "draft" as const
          }
        : plan
    )
  };
}

export function applyFixtureAcceptTreatmentPlan(
  data: Cp5WorkflowData,
  input: TreatmentPlanAcceptInput
) {
  const acceptedAt = new Date().toISOString();

  return {
    ...data,
    timeline: prependTimeline(
      data.timeline,
      "treatment_plan.accepted",
      "Treatment plan accepted",
      "Patient acceptance captured in local synthetic CP5 fixture mode.",
      acceptedAt
    ),
    treatmentPlans: data.treatmentPlans.map((plan) =>
      plan.id === input.treatmentPlanId
        ? {
            ...plan,
            acceptedAt,
            acceptedBy: input.acceptedBy,
            acceptanceMethod: input.acceptanceMethod,
            status: "accepted" as const
          }
        : plan
    )
  };
}

export function applyFixtureRecordProcedure(data: Cp5WorkflowData, input: ProcedurePerformedInput) {
  const plan = data.treatmentPlans.find((item) => item.id === input.treatmentPlanId);

  if (!plan || plan.status !== "accepted") {
    throw new Error("Accept the treatment plan before recording completed procedures.");
  }

  const existingSourceIds = new Set(data.proceduresPerformed.map((item) => item.sourcePlanItemId));
  const candidateItems = plan.phases.flatMap((phase) => phase.items);
  const nextItem = candidateItems.find((item) => !existingSourceIds.has(item.id));

  if (!nextItem) {
    throw new Error("All accepted estimate items are already recorded as completed procedures.");
  }

  const completedAt = new Date().toISOString();
  const procedure: ProcedurePerformed = {
    amountCents: nextItem.amountCents * nextItem.quantity,
    completedAt,
    encounterId: input.encounterId,
    id: nextFixtureId("cp5-procedure"),
    patientId: input.patientId,
    procedureName: nextItem.procedureName,
    sourcePlanItemId: nextItem.id,
    status: "completed"
  };

  return {
    ...data,
    proceduresPerformed: [procedure, ...data.proceduresPerformed],
    timeline: prependTimeline(
      data.timeline,
      "procedure.completed",
      "Procedure completed",
      `${procedure.procedureName} recorded from accepted plan evidence.`,
      completedAt
    )
  };
}

export function applyFixtureCreateInvoice(data: Cp5WorkflowData, input: InvoiceCreateInput) {
  const performed = input.procedurePerformedIds
    .map((id) => data.proceduresPerformed.find((item) => item.id === id))
    .filter((item): item is ProcedurePerformed => Boolean(item));

  if (performed.length === 0) {
    throw new Error("Record at least one completed procedure before creating an invoice.");
  }

  const createdAt = new Date().toISOString();
  const invoiceId = nextFixtureId("cp5-invoice");
  const items: InvoiceItem[] = performed.map((procedure) => ({
    amountCents: procedure.amountCents,
    id: nextFixtureId("cp5-invoice-item"),
    procedurePerformedId: procedure.id,
    quantity: 1,
    title: procedure.procedureName
  }));
  const totalAmountCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const invoice: Invoice = {
    createdAt,
    id: invoiceId,
    invoiceNumber: `SYN-${String(fixtureIdCounter).padStart(4, "0")}`,
    items,
    patientId: input.patientId,
    paymentRequests: [],
    payments: [],
    receipts: [],
    state: "draft",
    totalAmountCents,
    treatmentPlanId: input.treatmentPlanId
  };

  return {
    ...data,
    invoices: [invoice, ...data.invoices],
    timeline: prependTimeline(
      data.timeline,
      "invoice.created",
      "Invoice created",
      "Invoice generated from completed procedure evidence.",
      createdAt
    )
  };
}

export function applyFixtureReadInvoice(data: Cp5WorkflowData, invoiceId: string) {
  const readAt = new Date().toISOString();

  return {
    ...data,
    invoices: data.invoices.map((invoice) =>
      invoice.id === invoiceId
        ? {
            ...invoice,
            lastReadAt: readAt
          }
        : invoice
    ),
    timeline: prependTimeline(
      data.timeline,
      "invoice.read",
      "Invoice read",
      "Invoice read model opened in local fixture mode.",
      readAt
    )
  };
}

export function applyFixtureCreatePaymentRequest(
  data: Cp5WorkflowData,
  input: PaymentRequestInput
) {
  const createdAt = new Date().toISOString();
  const invoice = data.invoices.find((item) => item.id === input.invoiceId);

  if (!invoice) {
    throw new Error("Create or select an invoice before requesting payment.");
  }

  const state = paymentRequestStateForProvider(data.providerReadiness, input.channel);
  const request: PaymentRequest = {
    amountCents: input.amountCents,
    channel: input.channel,
    createdAt,
    id: nextFixtureId("cp5-payment-request"),
    invoiceId: input.invoiceId,
    provider: data.providerReadiness.provider,
    providerReference:
      state === "pending_provider_confirmation" ? nextFixtureId("cp5-provider-ref") : undefined,
    state,
    statusDetail: paymentRequestDetailForState(state)
  };

  return {
    ...data,
    invoices: data.invoices.map((item) =>
      item.id === input.invoiceId
        ? {
            ...item,
            paymentRequests: [request, ...item.paymentRequests],
            state: "payment_requested" as const
          }
        : item
    ),
    timeline: prependTimeline(
      data.timeline,
      "payment.requested",
      "Payment requested",
      `${input.channel === "dynamic_qr" ? "Dynamic QR" : "Payment link"} request recorded without marking payment as paid.`,
      createdAt
    )
  };
}

export function applyFixtureRecordManualPayment(data: Cp5WorkflowData, input: ManualPaymentInput) {
  const invoice = data.invoices.find((item) => item.id === input.invoiceId);

  if (!invoice) {
    throw new Error("Select an invoice before recording manual payment.");
  }

  validateManualPaymentInput(input, invoice);

  const createdAt = new Date().toISOString();
  const payment: ManualPayment = {
    actorName: input.actorName,
    amountCents: input.amountCents,
    auditStatus: "required_fields_recorded",
    createdAt,
    id: nextFixtureId("cp5-manual-payment"),
    invoiceId: input.invoiceId,
    method: input.method,
    reason: input.reason.trim(),
    reference: input.reference.trim()
  };

  return {
    ...data,
    invoices: data.invoices.map((item) => {
      if (item.id !== input.invoiceId) {
        return item;
      }

      const payments = [payment, ...item.payments];
      const paidAmount = payments.reduce((sum, current) => sum + current.amountCents, 0);

      return {
        ...item,
        payments,
        state:
          paidAmount >= item.totalAmountCents
            ? ("manually_recorded" as const)
            : ("partially_paid" as const)
      };
    }),
    timeline: prependTimeline(
      data.timeline,
      "payment.manually_recorded",
      "Manual payment recorded",
      "Manual payment evidence captured with actor, method, reference, amount, and reason.",
      createdAt
    )
  };
}

export function applyFixtureGenerateReceipt(data: Cp5WorkflowData, input: ReceiptCreateInput) {
  const invoice = data.invoices.find((item) => item.id === input.invoiceId);

  if (!invoice) {
    throw new Error("Select an invoice before generating a receipt.");
  }

  const paidAmount = getInvoicePaidAmountCents(invoice);

  if (paidAmount <= 0) {
    throw new Error("Payment evidence is required before receipt generation.");
  }

  const generatedAt = new Date().toISOString();
  const receipt: Receipt = {
    amountCents: paidAmount,
    generatedAt,
    generatedBy: input.actorName,
    id: nextFixtureId("cp5-receipt"),
    invoiceId: input.invoiceId,
    state: "print_ready"
  };

  return {
    ...data,
    invoices: data.invoices.map((item) =>
      item.id === input.invoiceId
        ? {
            ...item,
            receipts: [receipt, ...item.receipts]
          }
        : item
    ),
    timeline: prependTimeline(
      data.timeline,
      "receipt.generated",
      "Receipt generated",
      "Receipt generated from recorded payment evidence.",
      generatedAt
    )
  };
}

export function applyFixtureSignPrescription(data: Cp5WorkflowData, input: PrescriptionSignInput) {
  if (!canSignPrescription(input.actorRoles)) {
    throw new Error("Prescription signing requires a doctor role and backend authorization.");
  }

  const signedAt = new Date().toISOString();

  return {
    ...data,
    prescriptions: data.prescriptions.map((prescription) =>
      prescription.id === input.prescriptionId
        ? {
            ...prescription,
            signedAt,
            signedBy: input.actorName,
            state: "signed" as const
          }
        : prescription
    ),
    timeline: prependTimeline(
      data.timeline,
      "prescription.signed",
      "Prescription signed",
      "Doctor signed the prescription output.",
      signedAt
    )
  };
}

export function applyFixtureCreateInstruction(
  data: Cp5WorkflowData,
  input: InstructionCreateInput
) {
  const template = data.instructionTemplates.find((item) => item.id === input.templateId);

  if (!template) {
    throw new Error("Select an instruction template before generating instructions.");
  }

  const createdAt = new Date().toISOString();
  const record: InstructionRecord = {
    channel: input.channel,
    createdAt,
    id: nextFixtureId("cp5-instruction"),
    patientId: input.patientId,
    state: input.channel === "print" ? "print_ready" : "provider_unavailable",
    templateId: input.templateId,
    title: template.title
  };

  return {
    ...data,
    instructionRecords: [record, ...data.instructionRecords],
    timeline: prependTimeline(
      data.timeline,
      "instruction.generated",
      "Instruction generated",
      input.channel === "print"
        ? "Instruction is ready to print."
        : "WhatsApp send request stayed unavailable because no messaging provider confirmed delivery.",
      createdAt
    )
  };
}

export function classifyCp5EndpointFailures(failures: Cp5EndpointIssue[]): Cp5WorkflowProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP5 checkout."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP5_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message: "One or more CP5 checkout endpoints are not registered in this environment."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load the CP5 checkout workflow."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP5 checkout API returned an unexpected response."
  };
}

function validateManualPaymentInput(input: ManualPaymentInput, invoice: Invoice) {
  if (input.amountCents <= 0 || !Number.isFinite(input.amountCents)) {
    throw new Error("Manual payment amount must be greater than zero.");
  }

  if (input.amountCents > getOutstandingAmountCents(invoice)) {
    throw new Error("Manual payment amount cannot exceed the invoice outstanding amount.");
  }

  if (!input.reference.trim() || !input.reason.trim()) {
    throw new Error("Manual payment requires a reference and audit reason.");
  }
}

function paymentRequestStateForProvider(
  provider: PaymentProviderReadiness,
  channel: PaymentRequestInput["channel"]
): PaymentRequestState {
  const channelState = channel === "dynamic_qr" ? provider.dynamicQr : provider.paymentLinks;

  if (channelState === "missing_key") {
    return "no_key";
  }

  if (channelState === "unavailable") {
    return "provider_unavailable";
  }

  if (provider.hostedWebhook === "not_configured") {
    return "webhook_not_configured";
  }

  return "pending_provider_confirmation";
}

function paymentRequestDetailForState(state: PaymentRequestState) {
  switch (state) {
    case "created":
      return "Provider request created.";
    case "failed":
      return "Provider request failed.";
    case "no_key":
      return "Razorpay keys are missing; payment cannot be requested live.";
    case "pending_provider_confirmation":
      return "Waiting for a verified signed provider webhook before payment state changes.";
    case "provider_unavailable":
      return "Payment provider is unavailable in this environment.";
    case "webhook_not_configured":
      return "Hosted webhook URL is not configured; request is not treated as paid.";
  }
}

export function normalizeCp5WorkflowPayload(
  payload: unknown,
  today: string,
  requestId?: string
): Cp5WorkflowData | Cp5WorkflowProblem {
  if (!isRecord(payload)) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: CP5_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "The endpoint returned a non-object payload."
      })),
      message: "The CP5 checkout endpoint is reachable but does not match the expected contract."
    };
  }

  const patients = Array.isArray(payload.patients) ? payload.patients.filter(isCp5Patient) : null;
  const encounters = Array.isArray(payload.encounters)
    ? payload.encounters.filter(isCp5Encounter)
    : null;
  const pricebook = Array.isArray(payload.pricebook)
    ? payload.pricebook.filter(isPricebookProcedure)
    : null;
  const treatmentPlans = Array.isArray(payload.treatmentPlans)
    ? payload.treatmentPlans.filter(isTreatmentPlan)
    : null;
  const proceduresPerformed = Array.isArray(payload.proceduresPerformed)
    ? payload.proceduresPerformed.filter(isProcedurePerformed)
    : [];
  const invoices = Array.isArray(payload.invoices) ? payload.invoices.filter(isInvoice) : [];
  const prescriptions = Array.isArray(payload.prescriptions)
    ? payload.prescriptions.filter(isPrescription)
    : [];
  const instructionTemplates = Array.isArray(payload.instructionTemplates)
    ? payload.instructionTemplates.filter(isInstructionTemplate)
    : [];
  const instructionRecords = Array.isArray(payload.instructionRecords)
    ? payload.instructionRecords.filter(isInstructionRecord)
    : [];
  const providerReadiness = isProviderReadiness(payload.providerReadiness)
    ? payload.providerReadiness
    : null;
  const timeline = Array.isArray(payload.timeline)
    ? payload.timeline.filter(isCp5TimelineItem)
    : [];

  if (!patients || !encounters || !pricebook || !treatmentPlans || !providerReadiness) {
    return {
      code: "CONTRACT_MISMATCH",
      detail:
        "Expected patients, encounters, pricebook, treatmentPlans, providerReadiness, and timeline fields.",
      endpoints: CP5_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "Contract mismatch"
      })),
      message: "The CP5 checkout endpoint is reachable but missing required workflow data."
    };
  }

  return {
    api: {
      environment: "api",
      requestIds: requestId ? [requestId] : []
    },
    encounters,
    instructionRecords,
    instructionTemplates,
    invoices,
    patients,
    prescriptions,
    pricebook,
    proceduresPerformed,
    providerReadiness,
    source: "api",
    timeline,
    today,
    treatmentPlans
  };
}

function getWorkflowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildWorkflowUrl(path: string, params?: Record<string, string>) {
  const baseUrl = getWorkflowApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`, getBrowserOrigin());

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getBrowserOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

async function fetchEndpoint(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetch(buildWorkflowUrl(path, params), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return {
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("POST", path, body, signal);
}

async function patchEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("PATCH", path, body, signal);
}

async function writeEndpoint(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal
) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-cp5-${crypto.randomUUID()}`
    },
    method,
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return payload;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function endpointFailureFromResponse(
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${response.status === 0 ? "FETCH" : "HTTP"} ${path}`,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = isRecord(payload.error) ? payload.error : null;
    const nested = error
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = isRecord(payload.error) ? payload.error : null;

  return (
    readString(payload, ["message", "detail", "error_description"]) ??
    (error ? readString(error, ["message", "detail", "error_description"]) : null)
  );
}

function timelineItem(
  kind: Cp5TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
): Cp5TimelineItem {
  return {
    at,
    detail,
    id: `${kind}-${at}`,
    kind,
    title
  };
}

function prependTimeline(
  items: Cp5TimelineItem[],
  kind: Cp5TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
) {
  return [timelineItem(kind, title, detail, at), ...items].sort(
    (first, second) => Date.parse(second.at) - Date.parse(first.at)
  );
}

function nextFixtureId(prefix: string) {
  fixtureIdCounter += 1;

  return `${prefix}-${fixtureIdCounter}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function isCp5Patient(value: unknown): value is Cp5Patient {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.accountLabel === "string" &&
    (value.kind === "new" || value.kind === "returning") &&
    typeof value.visitReason === "string"
  );
}

function isCp5Encounter(value: unknown): value is Cp5Encounter {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.providerName === "string" &&
    typeof value.startedAt === "string" &&
    (value.status === "encounter_started" || value.status === "ready_for_checkout")
  );
}

function isPricebookProcedure(value: unknown): value is PricebookProcedure {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.code === "string" &&
    typeof value.category === "string" &&
    typeof value.defaultAmountCents === "number" &&
    typeof value.taxable === "boolean"
  );
}

function isTreatmentPlan(value: unknown): value is TreatmentPlan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.encounterId === "string" &&
    typeof value.title === "string" &&
    (value.status === "draft" || value.status === "accepted") &&
    Array.isArray(value.phases)
  );
}

function isProcedurePerformed(value: unknown): value is ProcedurePerformed {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.encounterId === "string" &&
    typeof value.procedureName === "string" &&
    typeof value.amountCents === "number" &&
    value.status === "completed"
  );
}

function isInvoice(value: unknown): value is Invoice {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.invoiceNumber === "string" &&
    typeof value.patientId === "string" &&
    typeof value.treatmentPlanId === "string" &&
    typeof value.totalAmountCents === "number" &&
    Array.isArray(value.items) &&
    Array.isArray(value.paymentRequests) &&
    Array.isArray(value.payments) &&
    Array.isArray(value.receipts)
  );
}

function isPrescription(value: unknown): value is PrescriptionOutput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.encounterId === "string" &&
    (value.state === "draft" || value.state === "signed") &&
    Array.isArray(value.items)
  );
}

function isInstructionTemplate(value: unknown): value is InstructionTemplate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.type === "post_op" || value.type === "product" || value.type === "recall")
  );
}

function isInstructionRecord(value: unknown): value is InstructionRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.title === "string" &&
    (value.channel === "print" || value.channel === "whatsapp")
  );
}

function isProviderReadiness(value: unknown): value is PaymentProviderReadiness {
  return (
    isRecord(value) &&
    (value.provider === "razorpay" || value.provider === "simulator") &&
    (value.mode === "live" || value.mode === "simulator") &&
    (value.dynamicQr === "available" ||
      value.dynamicQr === "missing_key" ||
      value.dynamicQr === "unavailable") &&
    (value.paymentLinks === "available" ||
      value.paymentLinks === "missing_key" ||
      value.paymentLinks === "unavailable") &&
    (value.hostedWebhook === "configured" || value.hostedWebhook === "not_configured")
  );
}

function isCp5TimelineItem(value: unknown): value is Cp5TimelineItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.at === "string" &&
    typeof value.title === "string" &&
    typeof value.detail === "string" &&
    typeof value.kind === "string"
  );
}
