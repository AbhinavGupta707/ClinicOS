"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileCheck2,
  FileSignature,
  Loader2,
  LockKeyhole,
  PlugZap,
  Printer,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Stethoscope
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  INVOICE_STATE_LABELS,
  MANUAL_PAYMENT_METHOD_LABELS,
  PAYMENT_REQUEST_STATE_LABELS,
  applyFixtureAcceptTreatmentPlan,
  applyFixtureAddEstimateItem,
  applyFixtureCreateInstruction,
  applyFixtureCreateInvoice,
  applyFixtureCreatePaymentRequest,
  applyFixtureGenerateReceipt,
  applyFixtureReadInvoice,
  applyFixtureRecordManualPayment,
  applyFixtureRecordProcedure,
  applyFixtureSignPrescription,
  canAcceptTreatmentPlan,
  canEditTreatmentPlan,
  canManageInstructions,
  canManagePayments,
  canRecordProcedure,
  canSignPrescription,
  canViewClinicalOutput,
  createLiveInstruction,
  createLiveInvoice,
  createLivePaymentRequest,
  createLiveReceipt,
  getInvoicePaidAmountCents,
  getOutstandingAmountCents,
  getPlanTotalCents,
  loadCp5Workflow,
  readLiveInvoice,
  recordLiveManualPayment,
  recordLiveProcedure,
  signLivePrescription,
  updateLiveTreatmentPlan,
  acceptLiveTreatmentPlan,
  type Cp5WorkflowData,
  type Cp5WorkflowLoadState,
  type Cp5WorkflowProblem,
  type EstimateItemInput,
  type Invoice,
  type ManualPaymentInput,
  type ManualPaymentMethod,
  type PricebookProcedure,
  type TreatmentPlan
} from "@/lib/cp5-workflow";
import type { MeProfile } from "@/lib/me";

interface CheckoutWorkflowProps {
  profile: MeProfile;
}

type LoadState = Cp5WorkflowLoadState | { status: "loading" };

type ActionMessage = {
  tone: "error" | "info" | "success";
  text: string;
};

type CheckoutMode = "invoice" | "outputs" | "payment" | "plan";

const WORKFLOW_MODES: Array<{
  icon: LucideIcon;
  label: string;
  mode: CheckoutMode;
}> = [
  { icon: ClipboardList, label: "Plan", mode: "plan" },
  { icon: ReceiptText, label: "Invoice", mode: "invoice" },
  { icon: CreditCard, label: "Payment", mode: "payment" },
  { icon: FileSignature, label: "Outputs", mode: "outputs" }
];

const cp5WorkflowSurfaceIds = new Set(["accounting", "checkout"]);

export function isCp5WorkflowSurface(surfaceId: string) {
  return cp5WorkflowSurfaceIds.has(surfaceId);
}

export function CheckoutWorkflow({ profile }: CheckoutWorkflowProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<CheckoutMode>("plan");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [estimateDraft, setEstimateDraft] = useState<EstimateItemInput>({
    phaseId: "",
    procedureId: "",
    quantity: 1,
    toothNumber: "36"
  });
  const [manualDraft, setManualDraft] = useState({
    amount: "",
    method: "upi" as ManualPaymentMethod,
    reason: "Provider unavailable or patient paid at front desk; manual audit required.",
    reference: "UPI-SYNTHETIC-REF"
  });
  const [instructionTemplateId, setInstructionTemplateId] = useState("");

  const data = loadState.status === "ready" ? loadState.data : null;
  const accountingOnly = isAccountingOnly(profile);

  const selectedPatient = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.patients.find((patient) => patient.id === selectedPatientId) ?? data.patients[0]!;
  }, [data, selectedPatientId]);

  const selectedEncounter = useMemo(() => {
    if (!data || !selectedPatient) {
      return null;
    }

    return data.encounters.find((encounter) => encounter.patientId === selectedPatient.id) ?? null;
  }, [data, selectedPatient]);

  const selectedPlan = useMemo(() => {
    if (!data || !selectedPatient) {
      return null;
    }

    return (
      data.treatmentPlans.find((plan) => plan.id === selectedPlanId) ??
      data.treatmentPlans.find((plan) => plan.patientId === selectedPatient.id) ??
      null
    );
  }, [data, selectedPatient, selectedPlanId]);

  const selectedInvoice = useMemo(() => {
    if (!data || !selectedPatient) {
      return null;
    }

    return (
      data.invoices.find((invoice) => invoice.id === selectedInvoiceId) ??
      data.invoices.find((invoice) => invoice.patientId === selectedPatient.id) ??
      null
    );
  }, [data, selectedInvoiceId, selectedPatient]);

  const selectedPrescription = useMemo(() => {
    if (!data || !selectedEncounter) {
      return null;
    }

    return (
      data.prescriptions.find(
        (prescription) => prescription.encounterId === selectedEncounter.id
      ) ?? null
    );
  }, [data, selectedEncounter]);

  const visibleInstructions = data?.instructionRecords.filter((record) =>
    selectedPatient ? record.patientId === selectedPatient.id : false
  );

  const reloadWorkflow = () => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp5Workflow(controller.signal).then(setLoadState);

    return controller;
  };

  useEffect(() => {
    const controller = reloadWorkflow();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedPatientId && selectedPatient) {
      setSelectedPatientId(selectedPatient.id);
    }
  }, [selectedPatient, selectedPatientId]);

  useEffect(() => {
    if (!selectedPlanId && selectedPlan) {
      setSelectedPlanId(selectedPlan.id);
    }
  }, [selectedPlan, selectedPlanId]);

  useEffect(() => {
    if (!selectedInvoiceId && selectedInvoice) {
      setSelectedInvoiceId(selectedInvoice.id);
    }
  }, [selectedInvoice, selectedInvoiceId]);

  useEffect(() => {
    if (selectedPlan && estimateDraft.phaseId === "") {
      setEstimateDraft((current) => ({
        ...current,
        phaseId: selectedPlan.phases[0]?.id ?? ""
      }));
    }
  }, [estimateDraft.phaseId, selectedPlan]);

  useEffect(() => {
    if (data?.pricebook[0] && estimateDraft.procedureId === "") {
      setEstimateDraft((current) => ({
        ...current,
        procedureId: data.pricebook[0]!.id
      }));
    }
  }, [data, estimateDraft.procedureId]);

  useEffect(() => {
    if (data?.instructionTemplates[0] && instructionTemplateId === "") {
      setInstructionTemplateId(data.instructionTemplates[0].id);
    }
  }, [data, instructionTemplateId]);

  useEffect(() => {
    if (selectedInvoice) {
      setManualDraft((current) => ({
        ...current,
        amount: centsToMajorUnit(getOutstandingAmountCents(selectedInvoice))
      }));
    }
  }, [selectedInvoice]);

  const setReadyData = (nextData: Cp5WorkflowData) => {
    setLoadState({ data: nextData, status: "ready" });
  };

  const handleActionError = (error: unknown, fallback: string) => {
    setActionMessage({
      text: error instanceof Error ? error.message : fallback,
      tone: "error"
    });
  };

  const handleAddEstimateItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedPlan) {
      return;
    }

    setActionBusy("add-estimate-item");
    setActionMessage(null);

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureAddEstimateItem(data, selectedPlan.id, estimateDraft));
        setActionMessage({
          text: "Estimate item added in local synthetic CP5 fixture mode.",
          tone: "success"
        });
      } else {
        const procedure = data.pricebook.find((item) => item.id === estimateDraft.procedureId);
        const nextPlan = addEstimateItemToPlan(selectedPlan, estimateDraft, procedure);
        await updateLiveTreatmentPlan(selectedPlan.id, {
          phases: nextPlan.phases,
          title: nextPlan.title
        });
        reloadWorkflow();
        setActionMessage({
          text: "Treatment plan update sent to the CP5 API boundary.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Estimate item could not be added.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAcceptPlan = async () => {
    if (!data || !selectedPlan) {
      return;
    }

    setActionBusy("accept-plan");
    setActionMessage(null);

    try {
      const input = {
        acceptedBy: profile.user.displayName,
        acceptanceMethod: "chairside_confirmation" as const,
        treatmentPlanId: selectedPlan.id
      };

      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureAcceptTreatmentPlan(data, input));
        setActionMessage({
          text: "Patient acceptance state captured in local synthetic fixture mode.",
          tone: "success"
        });
      } else {
        await acceptLiveTreatmentPlan(input);
        reloadWorkflow();
        setActionMessage({ text: "Treatment acceptance sent to CP5 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Treatment plan acceptance failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRecordProcedure = async () => {
    if (!data || !selectedPatient || !selectedEncounter || !selectedPlan) {
      return;
    }

    setActionBusy("record-procedure");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      encounterId: selectedEncounter.id,
      patientId: selectedPatient.id,
      treatmentPlanId: selectedPlan.id
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureRecordProcedure(data, input));
        setActionMessage({
          text: "Completed procedure recorded from accepted plan evidence.",
          tone: "success"
        });
      } else {
        await recordLiveProcedure(input);
        reloadWorkflow();
        setActionMessage({ text: "Procedure completion sent to CP5 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Procedure completion could not be recorded.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateInvoice = async () => {
    if (!data || !selectedPatient || !selectedPlan) {
      return;
    }

    const procedurePerformedIds = data.proceduresPerformed
      .filter((procedure) => procedure.patientId === selectedPatient.id)
      .map((procedure) => procedure.id);

    setActionBusy("create-invoice");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      patientId: selectedPatient.id,
      procedurePerformedIds,
      treatmentPlanId: selectedPlan.id
    };

    try {
      if (data.source === "cp5_fixture") {
        const nextData = applyFixtureCreateInvoice(data, input);
        setReadyData(nextData);
        setSelectedInvoiceId(nextData.invoices[0]?.id ?? null);
        setMode("invoice");
        setActionMessage({
          text: "Invoice created from completed procedure evidence.",
          tone: "success"
        });
      } else {
        await createLiveInvoice(input);
        reloadWorkflow();
        setActionMessage({ text: "Invoice create sent to CP5 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Invoice creation failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleReadInvoice = async () => {
    if (!data || !selectedInvoice) {
      return;
    }

    setActionBusy("read-invoice");
    setActionMessage(null);

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureReadInvoice(data, selectedInvoice.id));
        setActionMessage({
          text: "Invoice read state updated in local fixture mode.",
          tone: "success"
        });
      } else {
        await readLiveInvoice(selectedInvoice.id);
        setActionMessage({ text: "Invoice read request sent to CP5 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Invoice read failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreatePaymentRequest = async () => {
    if (!data || !selectedInvoice) {
      return;
    }

    setActionBusy("request-payment");
    setActionMessage(null);

    const input = {
      amountCents: getOutstandingAmountCents(selectedInvoice),
      channel: "payment_link" as const,
      invoiceId: selectedInvoice.id
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureCreatePaymentRequest(data, input));
        setMode("payment");
        setActionMessage({
          text: "Payment request recorded without marking payment as successful.",
          tone: "success"
        });
      } else {
        await createLivePaymentRequest(input);
        reloadWorkflow();
        setActionMessage({
          text: "Payment request sent; verified webhook is required before paid state.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Payment request failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRecordManualPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedInvoice) {
      return;
    }

    setActionBusy("record-manual-payment");
    setActionMessage(null);

    const input: ManualPaymentInput = {
      actorName: profile.user.displayName,
      amountCents: majorUnitToCents(manualDraft.amount),
      invoiceId: selectedInvoice.id,
      method: manualDraft.method,
      reason: manualDraft.reason,
      reference: manualDraft.reference
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureRecordManualPayment(data, input));
        setActionMessage({
          text: "Manual payment evidence recorded with required audit fields.",
          tone: "success"
        });
      } else {
        await recordLiveManualPayment(input);
        reloadWorkflow();
        setActionMessage({
          text: "Manual payment evidence sent to CP5 API for audit-backed reconciliation.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Manual payment could not be recorded.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleGenerateReceipt = async () => {
    if (!data || !selectedInvoice) {
      return;
    }

    setActionBusy("generate-receipt");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      invoiceId: selectedInvoice.id
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureGenerateReceipt(data, input));
        setActionMessage({
          text: "Receipt generated from recorded payment evidence.",
          tone: "success"
        });
      } else {
        await createLiveReceipt(input);
        reloadWorkflow();
        setActionMessage({ text: "Receipt generation sent to CP5 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Receipt generation failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSignPrescription = async () => {
    if (!data || !selectedPrescription) {
      return;
    }

    setActionBusy("sign-prescription");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      actorRoles: profile.roles,
      prescriptionId: selectedPrescription.id
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureSignPrescription(data, input));
        setActionMessage({ text: "Prescription signed by doctor role.", tone: "success" });
      } else {
        await signLivePrescription(input);
        reloadWorkflow();
        setActionMessage({
          text: "Prescription signing sent to CP3/CP5 clinical output API.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Prescription signing failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateInstruction = async (channel: "print" | "whatsapp") => {
    if (!data || !selectedPatient || !instructionTemplateId) {
      return;
    }

    setActionBusy(`instruction-${channel}`);
    setActionMessage(null);

    const input = {
      channel,
      patientId: selectedPatient.id,
      templateId: instructionTemplateId
    };

    try {
      if (data.source === "cp5_fixture") {
        setReadyData(applyFixtureCreateInstruction(data, input));
        setActionMessage({
          text:
            channel === "print"
              ? "Instruction generated for print."
              : "WhatsApp instruction request stayed unavailable without provider confirmation.",
          tone: "success"
        });
      } else {
        await createLiveInstruction(input);
        reloadWorkflow();
        setActionMessage({
          text: "Instruction request sent to CP5 API.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Instruction generation failed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div data-testid="cp5-checkout-workspace">
      <div className="surface-stack cp5-workflow" data-testid="cp5-workflow">
        <section className="surface-hero surface-hero--checkout" aria-labelledby="cp5-title">
          <div>
            <p className="eyebrow">Treatment checkout</p>
            <h1 id="cp5-title">
              {selectedPatient
                ? patientLabel(selectedPatient, accountingOnly)
                : profile.clinic.name}
            </h1>
            <p className="hero-subline">
              {accountingOnly
                ? "Billing, invoice, payment, and receipt state without default clinical PHI."
                : "Phased estimates, accepted plans, invoices, audited payment collection, receipts, prescriptions, and instructions."}
            </p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp5_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp5_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "ready" && selectedPatient && selectedEncounter && selectedPlan ? (
          <>
            {loadState.data.source === "cp5_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP5 workflow fixture"
                data-testid="cp5-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP5 fixture mode</strong>
                  <span>
                    Non-PHI checkout data is synthetic. Payment requests do not simulate provider
                    success, and manual payments require audit evidence.
                  </span>
                </div>
              </section>
            ) : null}

            {accountingOnly ? (
              <section
                className="inline-alert inline-alert--info"
                data-testid="cp5-accountant-safe-view"
              >
                <LockKeyhole size={18} aria-hidden="true" />
                <div>
                  <strong>Accounting-safe view</strong>
                  <span>
                    Patient identity, prescriptions, instructions, and clinical visit details are
                    hidden for the accountant role by default.
                  </span>
                </div>
              </section>
            ) : null}

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
              >
                {actionMessage.tone === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {actionMessage.tone === "error" ? "Action failed" : "Workflow update"}
                  </strong>
                  <span>{actionMessage.text}</span>
                </div>
              </section>
            ) : null}

            <PatientSwitcher
              accountingOnly={accountingOnly}
              data={loadState.data}
              onSelectPatient={setSelectedPatientId}
              selectedPatientId={selectedPatient.id}
            />

            <ProviderReadinessPanel data={loadState.data} />

            <WorkflowTabs mode={mode} setMode={setMode} />

            {mode === "plan" ? (
              <PlanPanel
                actionBusy={actionBusy}
                accountingOnly={accountingOnly}
                estimateDraft={estimateDraft}
                onAcceptPlan={handleAcceptPlan}
                onAddEstimateItem={handleAddEstimateItem}
                onEstimateDraftChange={setEstimateDraft}
                onRecordProcedure={handleRecordProcedure}
                plan={selectedPlan}
                pricebook={loadState.data.pricebook}
                profile={profile}
                proceduresPerformed={loadState.data.proceduresPerformed}
              />
            ) : null}

            {mode === "invoice" ? (
              <InvoicePanel
                actionBusy={actionBusy}
                invoice={selectedInvoice}
                onCreateInvoice={handleCreateInvoice}
                onReadInvoice={handleReadInvoice}
                plan={selectedPlan}
                profile={profile}
                proceduresPerformed={loadState.data.proceduresPerformed}
                selectedPatientId={selectedPatient.id}
              />
            ) : null}

            {mode === "payment" ? (
              <PaymentPanel
                actionBusy={actionBusy}
                invoice={selectedInvoice}
                manualDraft={manualDraft}
                onCreatePaymentRequest={handleCreatePaymentRequest}
                onGenerateReceipt={handleGenerateReceipt}
                onManualDraftChange={setManualDraft}
                onRecordManualPayment={handleRecordManualPayment}
                profile={profile}
              />
            ) : null}

            {mode === "outputs" ? (
              <OutputsPanel
                actionBusy={actionBusy}
                accountingOnly={accountingOnly}
                data={loadState.data}
                instructionTemplateId={instructionTemplateId}
                instructions={visibleInstructions ?? []}
                onCreateInstruction={handleCreateInstruction}
                onInstructionTemplateChange={setInstructionTemplateId}
                onSignPrescription={handleSignPrescription}
                prescription={selectedPrescription}
                profile={profile}
                selectedPatientId={selectedPatient.id}
              />
            ) : null}

            <TimelinePanel data={loadState.data} />
          </>
        ) : loadState.status === "ready" ? (
          <EmptyState text="No CP5 checkout workflow data is available." />
        ) : (
          <WorkflowUnavailable onRetry={reloadWorkflow} problem={loadState.problem} />
        )}
      </div>
    </div>
  );
}

function PatientSwitcher({
  accountingOnly,
  data,
  onSelectPatient,
  selectedPatientId
}: {
  accountingOnly: boolean;
  data: Cp5WorkflowData;
  onSelectPatient: (patientId: string) => void;
  selectedPatientId: string;
}) {
  return (
    <section className="patient-switcher" aria-label="CP5 account selector">
      {data.patients.map((patient) => {
        const active = patient.id === selectedPatientId;
        const encounter = data.encounters.find((item) => item.patientId === patient.id);

        return (
          <button
            aria-pressed={active}
            className={active ? "patient-switch patient-switch--active" : "patient-switch"}
            data-testid={`cp5-select-patient-${patient.id}`}
            key={patient.id}
            onClick={() => onSelectPatient(patient.id)}
            type="button"
          >
            <strong>{patientLabel(patient, accountingOnly)}</strong>
            <span>
              {accountingOnly
                ? "Billing account"
                : `${patient.kind === "new" ? "New" : "Returning"} - ${encounter?.providerName ?? "No encounter"}`}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function ProviderReadinessPanel({ data }: { data: Cp5WorkflowData }) {
  const readiness = data.providerReadiness;

  return (
    <section
      className="readiness-grid readiness-grid--checkout"
      data-testid="cp5-provider-readiness"
    >
      <StatusMetric
        icon={PlugZap}
        label="Payment provider"
        value={`${readiness.provider} ${readiness.mode}`}
      />
      <StatusMetric
        icon={CreditCard}
        label="QR and payment link"
        value={`QR ${readiness.dynamicQr}; link ${readiness.paymentLinks}`}
      />
      <StatusMetric
        icon={ShieldCheck}
        label="Hosted webhook"
        value={
          readiness.hostedWebhook === "configured"
            ? "Configured"
            : "Not configured; provider requests cannot mark invoices paid"
        }
      />
    </section>
  );
}

function WorkflowTabs({
  mode,
  setMode
}: {
  mode: CheckoutMode;
  setMode: (mode: CheckoutMode) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP5 checkout workflow surfaces">
      {WORKFLOW_MODES.map((item) => {
        const Icon = item.icon;
        const active = mode === item.mode;

        return (
          <button
            aria-selected={active}
            className={active ? "workflow-tab workflow-tab--active" : "workflow-tab"}
            key={item.mode}
            onClick={() => setMode(item.mode)}
            role="tab"
            type="button"
          >
            <Icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PlanPanel({
  actionBusy,
  accountingOnly,
  estimateDraft,
  onAcceptPlan,
  onAddEstimateItem,
  onEstimateDraftChange,
  onRecordProcedure,
  plan,
  pricebook,
  proceduresPerformed,
  profile
}: {
  actionBusy: string | null;
  accountingOnly: boolean;
  estimateDraft: EstimateItemInput;
  onAcceptPlan: () => void;
  onAddEstimateItem: (event: FormEvent<HTMLFormElement>) => void;
  onEstimateDraftChange: (draft: EstimateItemInput) => void;
  onRecordProcedure: () => void;
  plan: TreatmentPlan;
  pricebook: PricebookProcedure[];
  proceduresPerformed: Cp5WorkflowData["proceduresPerformed"];
  profile: MeProfile;
}) {
  const canEdit = canEditTreatmentPlan(profile.roles) && !accountingOnly;
  const canAccept = canAcceptTreatmentPlan(profile.roles) && !accountingOnly;
  const canRecord = canRecordProcedure(profile.roles) && !accountingOnly;
  const completedSourceIds = new Set(
    proceduresPerformed.map((procedure) => procedure.sourcePlanItemId)
  );

  return (
    <div className="workflow-grid workflow-grid--checkout">
      <section
        className="work-panel"
        aria-labelledby="cp5-plan-title"
        data-testid="cp5-plan-builder"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cp5-plan-title">Treatment plan builder</h2>
            <p>Phased estimate items with patient acceptance state.</p>
          </div>
          <span className="state-pill">{plan.status}</span>
        </div>

        <div className="estimate-list" data-testid="cp5-estimate-preview">
          {plan.phases.map((phase) => (
            <div className="estimate-phase" key={phase.id}>
              <div className="estimate-phase__heading">
                <strong>{phase.name}</strong>
                <span>{phase.status}</span>
              </div>
              {phase.items.map((item) => (
                <div className="estimate-row" key={item.id}>
                  <span>
                    {item.procedureName}
                    {item.toothNumber ? ` - tooth ${item.toothNumber}` : ""}
                  </span>
                  <span>Qty {item.quantity}</span>
                  <strong>{formatMoney(item.amountCents * item.quantity)}</strong>
                  <span className="state-pill">
                    {completedSourceIds.has(item.id) ? "completed" : "planned"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="checkout-total">
          <span>Estimate total</span>
          <strong>{formatMoney(getPlanTotalCents(plan))}</strong>
        </div>

        {canEdit ? (
          <form className="clinical-form cp5-estimate-form" onSubmit={onAddEstimateItem}>
            <label className="clinical-field">
              <span>Phase</span>
              <select
                value={estimateDraft.phaseId}
                onChange={(event) =>
                  onEstimateDraftChange({ ...estimateDraft, phaseId: event.target.value })
                }
              >
                {plan.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="clinical-field">
              <span>Procedure</span>
              <select
                data-testid="cp5-procedure-select"
                value={estimateDraft.procedureId}
                onChange={(event) =>
                  onEstimateDraftChange({ ...estimateDraft, procedureId: event.target.value })
                }
              >
                {pricebook.map((procedure) => (
                  <option key={procedure.id} value={procedure.id}>
                    {procedure.name} - {formatMoney(procedure.defaultAmountCents)}
                  </option>
                ))}
              </select>
            </label>
            <label className="clinical-field">
              <span>Qty</span>
              <input
                min={1}
                type="number"
                value={estimateDraft.quantity}
                onChange={(event) =>
                  onEstimateDraftChange({
                    ...estimateDraft,
                    quantity: Number.parseInt(event.target.value, 10) || 1
                  })
                }
              />
            </label>
            <label className="clinical-field">
              <span>Tooth</span>
              <input
                value={estimateDraft.toothNumber ?? ""}
                onChange={(event) =>
                  onEstimateDraftChange({ ...estimateDraft, toothNumber: event.target.value })
                }
              />
            </label>
            <Button
              data-testid="cp5-add-estimate-item"
              disabled={actionBusy === "add-estimate-item"}
              icon={actionBusy === "add-estimate-item" ? <Loader2 size={16} /> : <Save size={16} />}
              type="submit"
            >
              Add estimate item
            </Button>
          </form>
        ) : (
          <RoleNote text="Treatment plan editing is hidden for this role." />
        )}
      </section>

      <section className="work-panel" aria-labelledby="cp5-acceptance-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp5-acceptance-title">Acceptance and procedure evidence</h2>
            <p>Invoices are created only from accepted plans and completed procedure records.</p>
          </div>
        </div>
        <div className="checkout-actions">
          <Button
            data-testid="cp5-accept-plan"
            disabled={!canAccept || plan.status === "accepted" || actionBusy === "accept-plan"}
            icon={<CheckCircle2 size={16} />}
            onClick={onAcceptPlan}
          >
            Capture acceptance
          </Button>
          <Button
            data-testid="cp5-record-procedure"
            disabled={!canRecord || plan.status !== "accepted" || actionBusy === "record-procedure"}
            icon={<Stethoscope size={16} />}
            onClick={onRecordProcedure}
            variant="secondary"
          >
            Record completed procedure
          </Button>
        </div>
        <div className="payment-ledger" data-testid="cp5-procedure-ledger">
          {proceduresPerformed.length > 0 ? (
            proceduresPerformed.map((procedure) => (
              <div className="ledger-row" key={procedure.id}>
                <span>{procedure.procedureName}</span>
                <span>{formatMoney(procedure.amountCents)}</span>
                <strong>{procedure.status}</strong>
              </div>
            ))
          ) : (
            <EmptyState text="No completed procedures have been recorded yet." />
          )}
        </div>
      </section>
    </div>
  );
}

function InvoicePanel({
  actionBusy,
  invoice,
  onCreateInvoice,
  onReadInvoice,
  plan,
  proceduresPerformed,
  profile,
  selectedPatientId
}: {
  actionBusy: string | null;
  invoice: Invoice | null;
  onCreateInvoice: () => void;
  onReadInvoice: () => void;
  plan: TreatmentPlan;
  proceduresPerformed: Cp5WorkflowData["proceduresPerformed"];
  profile: MeProfile;
  selectedPatientId: string;
}) {
  const canCreate = canManagePayments(profile.roles);
  const performedForPatient = proceduresPerformed.filter(
    (procedure) => procedure.patientId === selectedPatientId
  );

  return (
    <div className="workflow-grid workflow-grid--checkout">
      <section
        className="work-panel"
        aria-labelledby="cp5-invoice-title"
        data-testid="cp5-invoice-panel"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cp5-invoice-title">Invoice creation and read model</h2>
            <p>Invoice items are derived from completed procedure records.</p>
          </div>
          {invoice ? (
            <span className="state-pill">{INVOICE_STATE_LABELS[invoice.state]}</span>
          ) : null}
        </div>
        <div className="checkout-actions">
          <Button
            data-testid="cp5-create-invoice"
            disabled={
              !canCreate ||
              plan.status !== "accepted" ||
              performedForPatient.length === 0 ||
              actionBusy === "create-invoice"
            }
            icon={<ReceiptText size={16} />}
            onClick={onCreateInvoice}
          >
            Create invoice
          </Button>
          <Button
            data-testid="cp5-read-invoice"
            disabled={!invoice || actionBusy === "read-invoice"}
            icon={<FileCheck2 size={16} />}
            onClick={onReadInvoice}
            variant="secondary"
          >
            Read invoice
          </Button>
        </div>
        {invoice ? (
          <InvoiceSummary invoice={invoice} />
        ) : (
          <EmptyState text="No invoice created yet." />
        )}
      </section>
    </div>
  );
}

function PaymentPanel({
  actionBusy,
  invoice,
  manualDraft,
  onCreatePaymentRequest,
  onGenerateReceipt,
  onManualDraftChange,
  onRecordManualPayment,
  profile
}: {
  actionBusy: string | null;
  invoice: Invoice | null;
  manualDraft: {
    amount: string;
    method: ManualPaymentMethod;
    reason: string;
    reference: string;
  };
  onCreatePaymentRequest: () => void;
  onGenerateReceipt: () => void;
  onManualDraftChange: (draft: {
    amount: string;
    method: ManualPaymentMethod;
    reason: string;
    reference: string;
  }) => void;
  onRecordManualPayment: (event: FormEvent<HTMLFormElement>) => void;
  profile: MeProfile;
}) {
  const canPay = canManagePayments(profile.roles);

  return (
    <div className="workflow-grid workflow-grid--checkout">
      <section
        className="work-panel"
        aria-labelledby="cp5-payment-title"
        data-testid="cp5-payment-status"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cp5-payment-title">Payment request and status</h2>
            <p>Provider requests wait for verified signed webhooks before paid state.</p>
          </div>
        </div>
        {invoice ? (
          <>
            <div className="checkout-total">
              <span>Outstanding</span>
              <strong>{formatMoney(getOutstandingAmountCents(invoice))}</strong>
            </div>
            <div className="checkout-actions">
              <Button
                data-testid="cp5-request-payment"
                disabled={
                  !canPay ||
                  getOutstandingAmountCents(invoice) <= 0 ||
                  actionBusy === "request-payment"
                }
                icon={<CreditCard size={16} />}
                onClick={onCreatePaymentRequest}
              >
                Request payment link
              </Button>
              <Button
                data-testid="cp5-generate-receipt"
                disabled={
                  !canPay ||
                  getInvoicePaidAmountCents(invoice) <= 0 ||
                  actionBusy === "generate-receipt"
                }
                icon={<Printer size={16} />}
                onClick={onGenerateReceipt}
                variant="secondary"
              >
                Generate receipt
              </Button>
            </div>
            <PaymentRequestList invoice={invoice} />
            <ManualPaymentList invoice={invoice} />
            <ReceiptList invoice={invoice} />
          </>
        ) : (
          <EmptyState text="Create an invoice before requesting or recording payment." />
        )}
      </section>

      <section className="work-panel" aria-labelledby="cp5-manual-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp5-manual-title">Manual payment evidence</h2>
            <p>Manual collection requires actor, amount, method, reference, and audit reason.</p>
          </div>
          <Banknote size={20} aria-hidden="true" />
        </div>
        <form className="clinical-form cp5-manual-form" onSubmit={onRecordManualPayment}>
          <label className="clinical-field">
            <span>Amount</span>
            <input
              data-testid="cp5-manual-amount"
              inputMode="decimal"
              value={manualDraft.amount}
              onChange={(event) =>
                onManualDraftChange({ ...manualDraft, amount: event.target.value })
              }
            />
          </label>
          <label className="clinical-field">
            <span>Method</span>
            <select
              data-testid="cp5-manual-method"
              value={manualDraft.method}
              onChange={(event) =>
                onManualDraftChange({
                  ...manualDraft,
                  method: event.target.value as ManualPaymentMethod
                })
              }
            >
              {Object.entries(MANUAL_PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="clinical-field">
            <span>Reference</span>
            <input
              data-testid="cp5-manual-reference"
              value={manualDraft.reference}
              onChange={(event) =>
                onManualDraftChange({ ...manualDraft, reference: event.target.value })
              }
            />
          </label>
          <label className="clinical-field clinical-field--wide">
            <span>Audit reason</span>
            <textarea
              data-testid="cp5-manual-reason"
              value={manualDraft.reason}
              onChange={(event) =>
                onManualDraftChange({ ...manualDraft, reason: event.target.value })
              }
            />
          </label>
          <Button
            data-testid="cp5-record-manual-payment"
            disabled={!invoice || !canPay || actionBusy === "record-manual-payment"}
            icon={<ShieldCheck size={16} />}
            type="submit"
          >
            Record manual payment
          </Button>
        </form>
      </section>
    </div>
  );
}

function OutputsPanel({
  actionBusy,
  accountingOnly,
  data,
  instructionTemplateId,
  instructions,
  onCreateInstruction,
  onInstructionTemplateChange,
  onSignPrescription,
  prescription,
  profile,
  selectedPatientId
}: {
  actionBusy: string | null;
  accountingOnly: boolean;
  data: Cp5WorkflowData;
  instructionTemplateId: string;
  instructions: Cp5WorkflowData["instructionRecords"];
  onCreateInstruction: (channel: "print" | "whatsapp") => void;
  onInstructionTemplateChange: (templateId: string) => void;
  onSignPrescription: () => void;
  prescription: Cp5WorkflowData["prescriptions"][number] | null;
  profile: MeProfile;
  selectedPatientId: string;
}) {
  if (accountingOnly || !canViewClinicalOutput(profile.roles)) {
    return (
      <section className="work-panel" data-testid="cp5-clinical-output-hidden">
        <div className="panel-heading">
          <div>
            <h2>Clinical outputs hidden</h2>
            <p>Prescription and instruction content is not visible in the accounting role.</p>
          </div>
          <LockKeyhole size={20} aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <div className="workflow-grid workflow-grid--checkout">
      <section className="work-panel" aria-labelledby="cp5-prescription-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp5-prescription-title">Prescription extension</h2>
            <p>Doctor-only signing remains a UI and backend-enforced boundary.</p>
          </div>
          {prescription ? <span className="state-pill">{prescription.state}</span> : null}
        </div>
        {prescription ? (
          <>
            <div className="payment-ledger">
              {prescription.items.map((item) => (
                <div className="ledger-row" key={`${item.medication}-${item.duration}`}>
                  <span>{item.medication}</span>
                  <span>{item.dosage}</span>
                  <strong>{item.duration}</strong>
                </div>
              ))}
            </div>
            {!canSignPrescription(profile.roles) ? (
              <div
                className="readiness-gate readiness-gate--blocked"
                data-testid="cp5-prescription-gate"
              >
                <LockKeyhole size={18} aria-hidden="true" />
                <span>Prescription signing requires a doctor role and backend authorization.</span>
              </div>
            ) : null}
            <Button
              data-testid="cp5-prescription-sign"
              disabled={
                !canSignPrescription(profile.roles) ||
                prescription.state === "signed" ||
                actionBusy === "sign-prescription"
              }
              icon={<FileSignature size={16} />}
              onClick={onSignPrescription}
            >
              Sign prescription
            </Button>
          </>
        ) : (
          <EmptyState text="No prescription draft is attached to this checkout." />
        )}
      </section>

      <section className="work-panel" aria-labelledby="cp5-instruction-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp5-instruction-title">Instruction picker</h2>
            <p>Print/send-ready instruction records without pretending provider delivery.</p>
          </div>
        </div>
        <div className="clinical-form cp5-output-form">
          <label className="clinical-field clinical-field--wide">
            <span>Template</span>
            <select
              data-testid="cp5-instruction-template"
              value={instructionTemplateId}
              onChange={(event) => onInstructionTemplateChange(event.target.value)}
            >
              {data.instructionTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            data-testid="cp5-generate-instruction"
            disabled={
              !canManageInstructions(profile.roles) ||
              !selectedPatientId ||
              actionBusy === "instruction-print"
            }
            icon={<Printer size={16} />}
            onClick={() => onCreateInstruction("print")}
            type="button"
          >
            Prepare print instructions
          </Button>
          <Button
            data-testid="cp5-request-instruction-send"
            disabled={
              !canManageInstructions(profile.roles) ||
              !selectedPatientId ||
              actionBusy === "instruction-whatsapp"
            }
            icon={<Send size={16} />}
            onClick={() => onCreateInstruction("whatsapp")}
            type="button"
            variant="secondary"
          >
            Request WhatsApp send
          </Button>
        </div>
        <InstructionList instructions={instructions} />
      </section>
    </div>
  );
}

function TimelinePanel({ data }: { data: Cp5WorkflowData }) {
  return (
    <section className="work-panel" aria-labelledby="cp5-timeline-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp5-timeline-title">Checkout timeline</h2>
          <p>Local fixture timeline mirrors the audit/timeline evidence CP5 expects.</p>
        </div>
      </div>
      <div className="timeline-list" data-testid="cp5-timeline">
        {data.timeline.map((item) => (
          <article className="timeline-item" key={item.id}>
            <time>{formatShortTime(item.at)}</time>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
              <code>{item.kind}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InvoiceSummary({ invoice }: { invoice: Invoice }) {
  return (
    <div className="invoice-summary">
      <div className="detail-strip detail-strip--four">
        <div>
          <span>Invoice</span>
          <strong>{invoice.invoiceNumber}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{formatMoney(invoice.totalAmountCents)}</strong>
        </div>
        <div>
          <span>Paid evidence</span>
          <strong>{formatMoney(getInvoicePaidAmountCents(invoice))}</strong>
        </div>
        <div>
          <span>Outstanding</span>
          <strong>{formatMoney(getOutstandingAmountCents(invoice))}</strong>
        </div>
      </div>
      <div className="payment-ledger">
        {invoice.items.map((item) => (
          <div className="ledger-row" key={item.id}>
            <span>{item.title}</span>
            <span>Qty {item.quantity}</span>
            <strong>{formatMoney(item.amountCents)}</strong>
          </div>
        ))}
      </div>
      {invoice.lastReadAt ? (
        <p className="field-help">Last read at {formatShortTime(invoice.lastReadAt)}</p>
      ) : null}
    </div>
  );
}

function PaymentRequestList({ invoice }: { invoice: Invoice }) {
  return (
    <div className="payment-ledger">
      {invoice.paymentRequests.length > 0 ? (
        invoice.paymentRequests.map((request) => (
          <div className="ledger-row" key={request.id}>
            <span>{request.channel.replace("_", " ")}</span>
            <span>{formatMoney(request.amountCents)}</span>
            <strong>{PAYMENT_REQUEST_STATE_LABELS[request.state]}</strong>
            <small>{request.statusDetail}</small>
          </div>
        ))
      ) : (
        <EmptyState text="No payment request has been created yet." />
      )}
    </div>
  );
}

function ManualPaymentList({ invoice }: { invoice: Invoice }) {
  return (
    <div className="payment-ledger" data-testid="cp5-manual-payment-ledger">
      {invoice.payments.length > 0 ? (
        invoice.payments.map((payment) => (
          <div className="ledger-row" key={payment.id}>
            <span>Manual payment recorded</span>
            <span>{formatMoney(payment.amountCents)}</span>
            <strong>{MANUAL_PAYMENT_METHOD_LABELS[payment.method]}</strong>
            <small>
              {payment.reference} - {payment.reason}
            </small>
          </div>
        ))
      ) : (
        <EmptyState text="No manual payment evidence recorded yet." />
      )}
    </div>
  );
}

function ReceiptList({ invoice }: { invoice: Invoice }) {
  return (
    <div className="payment-ledger" data-testid="cp5-receipts">
      {invoice.receipts.length > 0 ? (
        invoice.receipts.map((receipt) => (
          <div className="ledger-row" key={receipt.id}>
            <span>Receipt {receipt.id}</span>
            <span>{formatMoney(receipt.amountCents)}</span>
            <strong>{receipt.state.replace("_", " ")}</strong>
          </div>
        ))
      ) : (
        <EmptyState text="No receipt has been generated yet." />
      )}
    </div>
  );
}

function InstructionList({
  instructions
}: {
  instructions: Cp5WorkflowData["instructionRecords"];
}) {
  return (
    <div className="payment-ledger" data-testid="cp5-instructions">
      {instructions.length > 0 ? (
        instructions.map((instruction) => (
          <div className="ledger-row" key={instruction.id}>
            <span>{instruction.title}</span>
            <span>{instruction.channel}</span>
            <strong>{instruction.state.replace("_", " ")}</strong>
          </div>
        ))
      ) : (
        <EmptyState text="No instructions generated yet." />
      )}
    </div>
  );
}

function StatusMetric({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="readiness-metric">
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <Loader2 size={18} aria-hidden="true" />
        <span>Loading CP5 checkout workflow...</span>
      </div>
    </section>
  );
}

function WorkflowUnavailable({
  onRetry,
  problem
}: {
  onRetry: () => void;
  problem: Cp5WorkflowProblem;
}) {
  return (
    <section className="work-panel" aria-labelledby="cp5-unavailable-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp5-unavailable-title">Checkout workflow unavailable</h2>
          <p>{problem.message}</p>
        </div>
        <AlertCircle size={22} aria-hidden="true" />
      </div>
      <div className="endpoint-table">
        <div className="endpoint-row endpoint-row--head">
          <span>Endpoint</span>
          <span>Status</span>
        </div>
        {problem.endpoints.map((endpoint) => (
          <div className="endpoint-row" key={`${endpoint.endpoint}-${endpoint.message}`}>
            <span>{endpoint.endpoint}</span>
            <span>
              {endpoint.status ? `HTTP ${endpoint.status}: ` : ""}
              {endpoint.message}
            </span>
          </div>
        ))}
      </div>
      <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
        Retry
      </Button>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>{text}</span>
    </div>
  );
}

function RoleNote({ text }: { text: string }) {
  return (
    <div className="readiness-gate readiness-gate--blocked">
      <LockKeyhole size={18} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function addEstimateItemToPlan(
  plan: TreatmentPlan,
  input: EstimateItemInput,
  procedure: PricebookProcedure | undefined
): TreatmentPlan {
  if (!procedure) {
    throw new Error("Select a valid procedure before adding an estimate item.");
  }

  return {
    ...plan,
    phases: plan.phases.map((phase) =>
      phase.id === input.phaseId
        ? {
            ...phase,
            items: [
              ...phase.items,
              {
                amountCents: procedure.defaultAmountCents,
                id: `web-draft-${Date.now()}`,
                phaseId: phase.id,
                procedureId: procedure.id,
                procedureName: procedure.name,
                quantity: input.quantity,
                toothNumber: input.toothNumber
              }
            ]
          }
        : phase
    ),
    status: "draft"
  };
}

function patientLabel(patient: Cp5WorkflowData["patients"][number], accountingOnly: boolean) {
  return accountingOnly ? patient.accountLabel : patient.displayName;
}

function isAccountingOnly(profile: MeProfile) {
  return (
    profile.roles.includes("accountant") &&
    !profile.roles.some((role) => ["owner", "doctor", "assistant", "receptionist"].includes(role))
  );
}

function formatMoney(amountCents: number) {
  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amountCents / 100);
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function centsToMajorUnit(amountCents: number) {
  return (amountCents / 100).toFixed(0);
}

function majorUnitToCents(value: string) {
  const normalized = Number.parseFloat(value.replace(/,/g, "").trim());

  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Math.round(normalized * 100);
}
