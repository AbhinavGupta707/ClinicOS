"use client";

import type { ClinicOsApiClient } from "@clinic-os/api-client-generated";
import { Button } from "@clinic-os/ui";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { createCp13ApiClient } from "@/lib/cp13-api-client";
import type { MeProfile } from "@/lib/me";

import { ClinicalDentalWorkspace } from "./clinical-dental/ClinicalDentalWorkspace";
import { ContinuityOperationsOverview } from "./continuity-operations/continuity-operations-overview";
import {
  loadContinuityOperationsOverview,
  type ContinuityOperationsLoadState,
  type ContinuityOperationsScope
} from "./continuity-operations/loader";
import { FrontOfficeDayPanel, FrontOfficePatientWorkspacePanel } from "./front-office/components";
import {
  loadFrontOfficeDay,
  loadFrontOfficePatientWorkspace,
  type FrontOfficeDayData,
  type FrontOfficeLoadState,
  type FrontOfficePatientWorkspaceData
} from "./front-office/loaders";
import { TreatmentBillingWorkspace } from "./treatment-billing/components";
import {
  loadTreatmentBillingWorkspace,
  type TreatmentBillingWorkspaceState
} from "./treatment-billing/loaders";
import {
  clinicLocalDate,
  isCp13BillingSurface,
  isCp13ClinicalSurface,
  isCp13OperationsSurface,
  paymentIntentState,
  type PaymentIntentUiState
} from "./runtime-helpers";

export function Cp13Workspace(props: {
  readonly activeSurfaceId: string;
  readonly profile: MeProfile;
}) {
  const clinicId = props.profile.clinic.id;
  const client = useMemo(() => createCp13ApiClient(clinicId), [clinicId]);

  if (isCp13BillingSurface(props.activeSurfaceId)) {
    return <TreatmentBillingRuntime client={client} />;
  }
  if (isCp13ClinicalSurface(props.activeSurfaceId)) {
    return <ClinicalRuntime client={client} />;
  }
  if (isCp13OperationsSurface(props.activeSurfaceId)) {
    return (
      <OperationsRuntime
        client={client}
        surfaceId={props.activeSurfaceId}
        timeZone={props.profile.clinic.timezone}
      />
    );
  }
  if (props.profile.roles.includes("accountant")) {
    return <TreatmentBillingRuntime client={client} />;
  }
  return <FrontOfficeRuntime client={client} allowPatientSelection={props.activeSurfaceId === "patients"} />;
}

function FrontOfficeRuntime(props: {
  readonly client: ClinicOsApiClient;
  readonly allowPatientSelection: boolean;
}) {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [dayState, setDayState] = useState<FrontOfficeLoadState<FrontOfficeDayData>>({
    status: "loading"
  });
  const [patientState, setPatientState] = useState<
    FrontOfficeLoadState<FrontOfficePatientWorkspaceData>
  >({ status: "loading" });

  const loadDay = useCallback(async () => {
    setDayState({ status: "loading" });
    setDayState(await loadFrontOfficeDay(props.client));
  }, [props.client]);
  const loadPatient = useCallback(async () => {
    if (!patientId) return;
    setPatientState({ status: "loading" });
    setPatientState(await loadFrontOfficePatientWorkspace(props.client, { patientId }));
  }, [patientId, props.client]);

  useEffect(() => void (patientId ? loadPatient() : loadDay()), [loadDay, loadPatient, patientId]);

  return (
    <section className="cp13-runtime" data-testid="cp13-front-office-runtime">
      <RuntimeHeader
        eyebrow="Durable front office"
        title={patientId ? "Patient preparation" : "Clinic day"}
        onRefresh={patientId ? loadPatient : loadDay}
      />
      {props.allowPatientSelection ? (
        <ResourceSelectionForm
          field="patientId"
          label={patientId ? "Open another patient" : "Open patient preparation"}
          onSelect={(selection) => setPatientId(selection.primaryId)}
        />
      ) : null}
      {patientId ? (
        <>
          <Button onClick={() => setPatientId(null)} variant="secondary">
            Return to clinic day
          </Button>
          <FrontOfficePatientWorkspacePanel state={patientState} />
        </>
      ) : (
        <FrontOfficeDayPanel state={dayState} />
      )}
    </section>
  );
}

function ClinicalRuntime(props: { readonly client: ClinicOsApiClient }) {
  const [selection, setSelection] = useState<ResourceSelection | null>(null);
  if (!selection) {
    return (
      <section className="cp13-runtime" data-testid="cp13-clinical-selection">
        <RuntimeHeader eyebrow="Durable clinical record" title="Select an authorized patient" />
        <p>
          Enter a runtime patient identifier. ClinicOS loads only the verified clinic-scoped
          record and never substitutes or infers a patient.
        </p>
        <ResourceSelectionForm
          field="patientId"
          includeEncounter
          label="Open clinical record"
          onSelect={setSelection}
        />
      </section>
    );
  }
  return (
    <section className="cp13-runtime" data-testid="cp13-clinical-runtime">
      <Button onClick={() => setSelection(null)} variant="secondary">
        Close selected clinical record
      </Button>
      <ClinicalDentalWorkspace
        client={props.client}
        encounterId={selection.encounterId}
        patientId={selection.primaryId}
      />
    </section>
  );
}

function TreatmentBillingRuntime(props: { readonly client: ClinicOsApiClient }) {
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [state, setState] = useState<TreatmentBillingWorkspaceState | { status: "loading" }>({
    status: "loading"
  });
  const [intentState, setIntentState] = useState<PaymentIntentUiState>({ status: "idle" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    setState(await loadTreatmentBillingWorkspace(props.client, { invoiceId }));
  }, [invoiceId, props.client]);

  useEffect(() => void load(), [load]);

  async function requestPayment() {
    if (!invoiceId) return;
    setIntentState({ status: "requesting" });
    try {
      const response = await props.client.createInvoicePaymentRequest({
        path: { invoiceId },
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { requestType: "payment_link" }
      });
      setIntentState(paymentIntentState(response));
      await load();
    } catch (error) {
      setIntentState({
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "The payment request could not be recorded safely."
      });
    }
  }

  return (
    <section className="cp13-runtime" data-testid="cp13-treatment-billing-runtime">
      <RuntimeHeader
        eyebrow="Durable billing"
        title="Treatment, invoice and payment state"
        onRefresh={load}
      />
      <ResourceSelectionForm
        field="invoiceId"
        label={invoiceId ? "Open another invoice" : "Open invoice"}
        onSelect={(selection) => {
          setIntentState({ status: "idle" });
          setInvoiceId(selection.primaryId);
        }}
      />
      {invoiceId ? (
        <Button
          onClick={() => {
            setIntentState({ status: "idle" });
            setInvoiceId(null);
          }}
          variant="secondary"
        >
          Close selected invoice
        </Button>
      ) : null}
      {state.status === "loading" ? (
        <RuntimeLoading label="Loading billing data from the generated client…" />
      ) : (
        <TreatmentBillingWorkspace state={state} />
      )}
      {invoiceId && state.status === "ready" ? (
        <section className="cp13-action-card" aria-labelledby="cp13-payment-request-title">
          <h3 id="cp13-payment-request-title">Provider payment request</h3>
          <p>
            Creating a request records intent only. Payment remains unconfirmed until a signed
            provider event is reconciled.
          </p>
          <Button
            disabled={intentState.status === "requesting"}
            onClick={() => void requestPayment()}
            variant="secondary"
          >
            {intentState.status === "requesting" ? "Recording intent…" : "Request payment link"}
          </Button>
          <PaymentIntentStatus state={intentState} />
        </section>
      ) : null}
    </section>
  );
}

function OperationsRuntime(props: {
  readonly client: ClinicOsApiClient;
  readonly surfaceId: string;
  readonly timeZone?: string;
}) {
  const [state, setState] = useState<ContinuityOperationsLoadState | { status: "loading" }>({
    status: "loading"
  });
  const scope = operationsScope(props.surfaceId);
  const load = useCallback(async () => {
    if (!props.timeZone) {
      setState(timeZoneUnavailableState());
      return;
    }
    let today: string;
    try {
      today = clinicLocalDate(new Date(), props.timeZone);
    } catch {
      setState(timeZoneUnavailableState());
      return;
    }
    setState({ status: "loading" });
    setState(
      await loadContinuityOperationsOverview(props.client, {
        from: today,
        to: today,
        observedAt: new Date(),
        scope
      })
    );
  }, [props.client, props.timeZone, scope]);

  useEffect(() => void load(), [load]);

  return (
    <section className="cp13-runtime" data-testid="cp13-operations-runtime">
      <RuntimeHeader
        eyebrow="Durable operations"
        title="Continuity and clinic operations"
        onRefresh={load}
      />
      {state.status === "loading" ? (
        <RuntimeLoading label="Loading operational records from the generated client…" />
      ) : (
        <ContinuityOperationsOverview state={state} />
      )}
    </section>
  );
}

function RuntimeHeader(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly onRefresh?: () => void | Promise<void>;
}) {
  return (
    <header className="cp13-runtime__header">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h1>{props.title}</h1>
      </div>
      {props.onRefresh ? (
        <Button onClick={() => void props.onRefresh?.()} variant="secondary">
          Refresh durable data
        </Button>
      ) : null}
    </header>
  );
}

interface ResourceSelection {
  readonly encounterId?: string;
  readonly primaryId: string;
}

function ResourceSelectionForm(props: {
  readonly field: "patientId" | "invoiceId";
  readonly label: string;
  readonly includeEncounter?: boolean;
  readonly onSelect: (selection: ResourceSelection) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const primary = String(form.get(props.field) ?? "").trim();
    if (!primary) return;
    const encounterId = String(form.get("encounterId") ?? "").trim();
    props.onSelect({ primaryId: primary, ...(encounterId ? { encounterId } : {}) });
    event.currentTarget.reset();
  }

  return (
    <form className="cp13-resource-form" onSubmit={submit}>
      <label>
        {props.field === "patientId" ? "Patient ID" : "Invoice ID"}
        <input name={props.field} required autoComplete="off" />
      </label>
      {props.includeEncounter ? (
        <label>
          Encounter ID (optional)
          <input name="encounterId" autoComplete="off" />
        </label>
      ) : null}
      <Button type="submit">{props.label}</Button>
    </form>
  );
}

function RuntimeLoading({ label }: { readonly label: string }) {
  return (
    <section aria-busy="true" aria-live="polite" className="cp13-action-card">
      {label}
    </section>
  );
}

function PaymentIntentStatus({ state }: { readonly state: PaymentIntentUiState }) {
  if (state.status === "idle" || state.status === "requesting") return null;
  return (
    <p
      role={state.status === "failed" ? "alert" : "status"}
      data-payment-intent-state={state.status}
    >
      {state.message}
    </p>
  );
}

function operationsScope(surfaceId: string): ContinuityOperationsScope {
  if (surfaceId === "owner-control") return "owner";
  if (surfaceId === "lab") return "lab";
  if (surfaceId === "operations") return "operations";
  return "continuity";
}

function timeZoneUnavailableState(): ContinuityOperationsLoadState {
  return {
    status: "unavailable",
    problem: {
      code: "CLINIC_TIMEZONE_UNAVAILABLE",
      message:
        "The clinic timezone is unavailable, so ClinicOS cannot safely select the operational day.",
      requestId: null,
      retryAfterSeconds: null
    }
  };
}
