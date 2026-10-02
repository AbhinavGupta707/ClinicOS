"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type {
  ClinicOsApiClient,
  PublicJsonObject,
  VersionedPublicResource
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "../../../lib/me";
import { PatientSelector } from "../shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "../shared/WorkflowAction";
import { clinicDisplayTime, etag, fieldText, record, valueList } from "../shared/workflow-values";
import { clinicDateTimeToInstant } from "../front-office/front-desk";
import { printClinicalDocument } from "../clinical-dental/clinical-workflow";
import {
  acceptedIncompleteItems,
  blankPlanItem,
  blankPlanPhase,
  formatInrMinor,
  parseInrMinor,
  planDraftFromResource,
  planPhases,
  receiptablePayments,
  type PlanItemDraft,
  type PlanPhaseDraft
} from "./billing-workflow";

export interface BillingWorkflowWorkspaceProps {
  readonly client: ClinicOsApiClient;
  readonly profile: MeProfile;
  readonly surfaceId: string;
  readonly patientId: string | null;
  readonly onSelectPatient: (id: string) => void;
}

type BillingContext = BillingWorkflowWorkspaceProps & {
  readonly patientId: string;
  readonly patientName: string;
  readonly locked: boolean;
  readonly mutate: <T>(
    run: (key: string) => Promise<T>,
    after?: (result: T) => Promise<void> | void
  ) => Promise<boolean>;
};

function can(profile: MeProfile, permission: string): boolean {
  return profile.permissions.includes(permission);
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

function useRemote<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await load();
      if (current === generation.current) setData(result);
    } catch (cause) {
      if (current === generation.current) setError(failure(cause));
      throw cause;
    } finally {
      if (current === generation.current) setLoading(false);
    }
    // Explicit stable keys supplied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void refresh().catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}

function usePaged<T>(
  load: (cursor?: string) => Promise<{ records: readonly T[]; nextCursor: string | null }>,
  getId: (item: T) => string,
  deps: readonly unknown[]
) {
  const [rows, setRows] = useState<readonly T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const loadedPages = useRef(1);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      let result = await load();
      const refreshed = [...result.records];
      for (let page = 1; page < loadedPages.current && result.nextCursor; page++) {
        result = await load(result.nextCursor);
        refreshed.push(...result.records);
      }
      if (current === generation.current) {
        setRows([...new Map(refreshed.map((item) => [getId(item), item])).values()]);
        setCursor(result.nextCursor);
      }
    } catch (cause) {
      if (current === generation.current) setError(failure(cause));
      throw cause;
    } finally {
      if (current === generation.current) setLoading(false);
    }
    // Explicit stable keys supplied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const loadMore = async () => {
    if (!cursor || loading) return;
    const current = generation.current;
    setLoading(true);
    try {
      const result = await load(cursor);
      if (current === generation.current) {
        loadedPages.current += 1;
        setRows((previous) => [
          ...previous,
          ...result.records.filter((item) => !previous.some((old) => getId(old) === getId(item)))
        ]);
        setCursor(result.nextCursor);
        setError("");
      }
    } catch (cause) {
      if (current === generation.current) setError(failure(cause));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    loadedPages.current = 1;
    void refresh().catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  return { rows, cursor, error, loading, refresh, loadMore };
}

function Panel(props: {
  title: string;
  error?: string;
  loading?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="workspace-card" aria-busy={props.loading}>
      <header>
        <h2>{props.title}</h2>
        {props.onRefresh ? (
          <button type="button" onClick={props.onRefresh}>
            Refresh
          </button>
        ) : null}
      </header>
      {props.loading ? <p>Loading…</p> : null}
      {props.error ? (
        <p role="alert">{props.error} Previously loaded rows, if any, remain visible.</p>
      ) : null}
      {props.children}
    </section>
  );
}

function BillingPatientSearch(props: {
  client: ClinicOsApiClient;
  patientId: string | null;
  onChoose: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<readonly { id: string; fullName: string }[]>([]);
  const [status, setStatus] = useState(
    "Search by patient name for an invoice or completed procedure."
  );
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );
  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    const current = ++generation.current;
    if (term.length < 2) {
      setStatus("Enter at least two characters.");
      setPatients([]);
      return;
    }
    setStatus("Searching billing records…");
    try {
      const result = await props.client.searchBillingPatients({ query: { query: term } });
      if (current !== generation.current) return;
      setPatients(result.patients);
      setStatus(
        result.patients.length
          ? "At most 50 matches are shown. Refine the name if needed."
          : "No billing records match this name."
      );
    } catch (cause) {
      if (current === generation.current) {
        setPatients([]);
        setStatus(failure(cause));
      }
    }
  }
  return (
    <section aria-label="Find billing patient">
      <form onSubmit={(event) => void search(event)}>
        <label>
          Patient name
          <input
            value={query}
            onChange={(event) => {
              generation.current += 1;
              setQuery(event.target.value);
              setPatients([]);
              setStatus("Search by patient name for an invoice or completed procedure.");
            }}
            autoComplete="off"
            placeholder="At least two letters"
          />
        </label>
        <button type="submit">Search billing records</button>
      </form>
      <p role="status">{status}</p>
      {patients.length ? (
        <ul>
          {patients.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={props.patientId === item.id ? "true" : undefined}
                onClick={() => props.onChoose(item.id, item.fullName)}
              >
                {item.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function BillingWorkflowWorkspace(props: BillingWorkflowWorkspaceProps) {
  const financialOnly = can(props.profile, "billing.read") && !can(props.profile, "patient.read");
  const [billingSelection, setBillingSelection] = useState<{ id: string; name: string } | null>(
    null
  );
  const scope = `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`;
  const [revision, setRevision] = useState(0);
  const clinical = can(props.profile, "patient.phi.read");
  const identity = useRemote(() => {
    if (!props.patientId || financialOnly) return Promise.resolve(null);
    return clinical
      ? props.client.getPatient({ path: { patientId: props.patientId } })
      : props.client.getPatientDemographics({ path: { patientId: props.patientId } });
  }, [props.client, props.patientId, financialOnly, clinical]);
  const patientName = financialOnly
    ? billingSelection?.id === props.patientId
      ? billingSelection.name
      : "Selected billing account"
    : fieldText(identity.data?.patient, "fullName");
  const action = useWorkflowAction(
    scope,
    patientName ? `patient ${patientName}` : "the selected billing account"
  );
  const context: BillingContext | null =
    props.patientId && (financialOnly || identity.data?.patient.id === props.patientId)
      ? {
          ...props,
          patientId: props.patientId,
          patientName,
          locked: action.locked,
          mutate: action.execute
        }
      : null;

  return (
    <div className="billing-workflow-workspace">
      <fieldset disabled={action.locked}>
        {financialOnly ? (
          <BillingPatientSearch
            client={props.client}
            patientId={props.patientId}
            onChoose={(id, name) => {
              setBillingSelection({ id, name });
              props.onSelectPatient(id);
            }}
          />
        ) : can(props.profile, "patient.read") ? (
          <PatientSelector
            client={props.client}
            patientId={props.patientId}
            onSelectPatient={props.onSelectPatient}
          />
        ) : (
          <p>This account cannot discover patients.</p>
        )}
      </fieldset>
      <WorkflowAction
        message={action.message}
        pending={action.pending}
        pendingLabel={action.pendingLabel}
        busy={action.busy}
        onRecover={() =>
          void action.recover(async () => {
            await identity.refresh();
            setRevision((value) => value + 1);
          })
        }
      />
      {!props.patientId ? <p>Choose a patient to continue.</p> : null}
      {identity.loading && props.patientId && !financialOnly ? <p>Loading patient…</p> : null}
      {identity.error && !financialOnly ? <p role="alert">{identity.error}</p> : null}
      {context ? (
        <Fragment key={`${context.patientId}:${revision}`}>
          <h1>{patientName}</h1>
          {clinical && can(props.profile, "dental.chart.read") ? (
            <TreatmentPanel {...context} />
          ) : null}
          {can(props.profile, "billing.read") ? <BillingPanel {...context} /> : null}
          {clinical && can(props.profile, "patient_instruction.write") ? (
            <InstructionPanel {...context} />
          ) : null}
          {!can(props.profile, "billing.read") && !clinical ? (
            <p>No treatment or billing capability is available to this account.</p>
          ) : null}
        </Fragment>
      ) : null}
    </div>
  );
}

function TreatmentPanel(props: BillingContext) {
  const plans = usePaged(
    (cursor) =>
      props.client
        .listPatientTreatmentPlans({
          path: { patientId: props.patientId },
          query: { cursor, limit: 50 }
        })
        .then((page) => ({ records: page.treatmentPlans, nextCursor: page.nextCursor })),
    (item) => item.id,
    [props.client, props.patientId]
  );
  const visits = usePaged(
    (cursor) =>
      props.client
        .listPatientEncounters({
          path: { patientId: props.patientId },
          query: { cursor, limit: 50 }
        })
        .then((page) => ({ records: page.encounters, nextCursor: page.nextCursor })),
    (item) => item.id,
    [props.client, props.patientId]
  );
  const pricebook = usePaged(
    (cursor) =>
      props.client
        .listPricebookProcedures({ query: { cursor, limit: 100 } })
        .then((page) => ({ records: page.procedures, nextCursor: page.nextCursor })),
    (item) => fieldText(item, "id"),
    [props.client]
  );
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [newPlan, setNewPlan] = useState(false);
  const selectedPlan = plans.rows.find((item) => item.id === selectedPlanId) ?? null;
  const procedureNames = new Map(
    pricebook.rows.map((item) => [
      fieldText(item, "id"),
      fieldText(item, "displayName") || fieldText(item, "code")
    ]) ?? []
  );

  return (
    <>
      <Panel
        title="Treatment plans"
        loading={plans.loading}
        error={plans.error}
        onRefresh={() => void plans.refresh().catch(() => undefined)}
      >
        {plans.rows.length ? (
          <ul>
            {plans.rows.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  aria-current={selectedPlanId === plan.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedPlanId(plan.id);
                    setNewPlan(false);
                  }}
                >
                  {fieldText(plan, "title")} · {fieldText(plan, "status")} ·{" "}
                  {formatInrMinor(plan.totalMinor)}
                </button>
              </li>
            ))}
          </ul>
        ) : !plans.loading ? (
          <p>No treatment plans recorded for this patient.</p>
        ) : null}
        {plans.cursor ? (
          <button type="button" disabled={plans.loading} onClick={() => void plans.loadMore()}>
            Load older plans
          </button>
        ) : null}
        {can(props.profile, "dental.chart.write") ? (
          <button
            type="button"
            onClick={() => {
              setSelectedPlanId("");
              setNewPlan(true);
            }}
          >
            Create treatment plan
          </button>
        ) : null}
      </Panel>
      {selectedPlan ? (
        <Panel title="Selected treatment plan">
          <p>
            {fieldText(selectedPlan, "title")} · {fieldText(selectedPlan, "status")} · server-priced
            total {formatInrMinor(selectedPlan.totalMinor)}
          </p>
          {fieldText(selectedPlan, "clinicalSummary") ? (
            <p>{fieldText(selectedPlan, "clinicalSummary")}</p>
          ) : null}
          <ol>
            {valueList(selectedPlan.phases).map((phaseValue, phaseIndex) => {
              const phase = record(phaseValue);
              return (
                <li key={fieldText(phase, "id") || phaseIndex}>
                  <strong>{fieldText(phase, "title")}</strong>
                  {fieldText(phase, "description") ? (
                    <p>{fieldText(phase, "description")}</p>
                  ) : null}
                  <ul>
                    {valueList(phase.estimateItems).map((itemValue, itemIndex) => {
                      const item = record(itemValue);
                      return (
                        <li key={fieldText(item, "id") || itemIndex}>
                          {procedureNames.get(fieldText(item, "pricebookProcedureId")) ||
                            "Catalog procedure"}
                          {fieldText(item, "toothNumber")
                            ? ` · tooth ${fieldText(item, "toothNumber")}`
                            : ""}
                          {` · ${String(item.quantity ?? 1)} × ${formatInrMinor(item.unitPriceMinor)} = ${formatInrMinor(item.totalMinor)}`}
                          {` · ${fieldText(item, "status")}`}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
          {pricebook.cursor ? (
            <button
              type="button"
              disabled={pricebook.loading || props.locked}
              onClick={() => void pricebook.loadMore()}
            >
              Load more pricebook procedures
            </button>
          ) : null}
          {can(props.profile, "dental.chart.write") ? (
            <PlanActions
              {...props}
              key={`${selectedPlan.id}:${selectedPlan.rowVersion}`}
              plan={selectedPlan}
              pricebook={pricebook.rows ?? []}
              pricebookError={pricebook.error}
              onSaved={plans.refresh}
            />
          ) : null}
          {fieldText(selectedPlan, "status") === "accepted" ? (
            <ProcedurePanel
              {...props}
              plan={selectedPlan}
              visits={visits.rows}
              visitsCursor={visits.cursor}
              visitsLoading={visits.loading}
              onMoreVisits={visits.loadMore}
              onCompleted={plans.refresh}
              procedureNames={procedureNames}
            />
          ) : null}
        </Panel>
      ) : null}
      {newPlan && can(props.profile, "dental.chart.write") ? (
        <Panel title="New treatment plan">
          {pricebook.cursor ? (
            <button
              type="button"
              disabled={pricebook.loading || props.locked}
              onClick={() => void pricebook.loadMore()}
            >
              Load more pricebook procedures
            </button>
          ) : null}
          {pricebook.error ? <p role="alert">Pricebook: {pricebook.error}</p> : null}
          <PlanEditor
            {...props}
            pricebook={pricebook.rows ?? []}
            visits={visits.rows}
            visitsCursor={visits.cursor}
            onMoreVisits={visits.loadMore}
            onSaved={async (id) => {
              setNewPlan(false);
              setSelectedPlanId(id);
              await plans.refresh();
            }}
          />
        </Panel>
      ) : null}
    </>
  );
}

function PhaseFields(props: {
  readonly phases: readonly PlanPhaseDraft[];
  readonly onChange: (phases: PlanPhaseDraft[]) => void;
  readonly pricebook: readonly PublicJsonObject[];
}) {
  const active = props.pricebook.filter((item) => fieldText(item, "status") === "active");
  function updatePhase(index: number, changes: Partial<PlanPhaseDraft>) {
    props.onChange(
      props.phases.map((phase, phaseIndex) =>
        phaseIndex === index ? { ...phase, ...changes } : phase
      )
    );
  }
  function updateItem(phaseIndex: number, itemIndex: number, changes: Partial<PlanItemDraft>) {
    props.onChange(
      props.phases.map((phase, index) =>
        index === phaseIndex
          ? {
              ...phase,
              items: phase.items.map((item, inner) =>
                inner === itemIndex ? { ...item, ...changes } : item
              )
            }
          : phase
      )
    );
  }
  return (
    <>
      {props.phases.map((phase, phaseIndex) => (
        <fieldset key={phaseIndex}>
          <legend>Phase {phaseIndex + 1}</legend>
          <label>
            Phase title{" "}
            <input
              value={phase.title}
              required
              onChange={(event) => updatePhase(phaseIndex, { title: event.target.value })}
            />
          </label>
          <label>
            Description{" "}
            <textarea
              value={phase.description}
              onChange={(event) => updatePhase(phaseIndex, { description: event.target.value })}
            />
          </label>
          <label>
            Estimated start after days{" "}
            <input
              type="number"
              min="0"
              step="1"
              value={phase.estimatedStartAfterDays}
              onChange={(event) =>
                updatePhase(phaseIndex, { estimatedStartAfterDays: event.target.value })
              }
            />
          </label>
          {phase.items.map((item, itemIndex) => (
            <fieldset key={itemIndex}>
              <legend>Item {itemIndex + 1}</legend>
              <label>
                Catalog procedure{" "}
                <select
                  value={item.pricebookProcedureId}
                  onChange={(event) =>
                    updateItem(phaseIndex, itemIndex, { pricebookProcedureId: event.target.value })
                  }
                  required
                >
                  <option value="">Choose a procedure</option>
                  {item.pricebookProcedureId &&
                  !active.some((p) => fieldText(p, "id") === item.pricebookProcedureId) ? (
                    <option value={item.pricebookProcedureId} disabled>
                      Saved procedure unavailable in the active pricebook — select an approved
                      replacement
                    </option>
                  ) : null}
                  {active.map((procedure) => (
                    <option key={fieldText(procedure, "id")} value={fieldText(procedure, "id")}>
                      {fieldText(procedure, "displayName") || fieldText(procedure, "code")} ·
                      catalog {formatInrMinor(procedure.defaultUnitPriceMinor)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                FDI tooth, if applicable{" "}
                <input
                  inputMode="numeric"
                  maxLength={2}
                  value={item.toothNumber}
                  onChange={(event) =>
                    updateItem(phaseIndex, itemIndex, { toothNumber: event.target.value })
                  }
                />
              </label>
              <label>
                Quantity{" "}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(phaseIndex, itemIndex, { quantity: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Estimated visits{" "}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={item.estimatedVisits}
                  onChange={(event) =>
                    updateItem(phaseIndex, itemIndex, { estimatedVisits: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Clinical item notes{" "}
                <textarea
                  value={item.notes}
                  onChange={(event) =>
                    updateItem(phaseIndex, itemIndex, { notes: event.target.value })
                  }
                />
              </label>
              {phase.items.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    updatePhase(phaseIndex, {
                      items: phase.items.filter((_, index) => index !== itemIndex)
                    })
                  }
                >
                  Remove item
                </button>
              ) : null}
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => updatePhase(phaseIndex, { items: [...phase.items, blankPlanItem()] })}
          >
            Add item to phase
          </button>
          {props.phases.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                props.onChange(props.phases.filter((_, index) => index !== phaseIndex))
              }
            >
              Remove phase
            </button>
          ) : null}
        </fieldset>
      ))}
      <button type="button" onClick={() => props.onChange([...props.phases, blankPlanPhase()])}>
        Add treatment phase
      </button>
      <p>Prices and tax are calculated from the clinic pricebook by the server when saved.</p>
    </>
  );
}

function PlanEditor(
  props: BillingContext & {
    readonly plan?: VersionedPublicResource;
    readonly pricebook: readonly PublicJsonObject[];
    readonly visits: readonly VersionedPublicResource[];
    readonly visitsCursor: string | null;
    readonly onMoreVisits: () => void;
    readonly onSaved: (id: string) => Promise<void>;
  }
) {
  const initial = props.plan ? planDraftFromResource(props.plan) : null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [summary, setSummary] = useState(initial?.clinicalSummary ?? "");
  const [phases, setPhases] = useState<PlanPhaseDraft[]>(initial?.phases ?? [blankPlanPhase()]);
  const [encounterId, setEncounterId] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const timeZone = props.profile.clinic.timezone || "UTC";
  const activeIds = new Set(
    props.pricebook
      .filter((item) => fieldText(item, "status") === "active")
      .map((item) => fieldText(item, "id"))
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (!title.trim()) throw new Error("Enter a treatment plan title.");
      const content = planPhases(phases, activeIds);
      setMessage("");
      const success = props.plan
        ? await props.mutate(
            (key) =>
              props.client.updateTreatmentPlan({
                path: { treatmentPlanId: props.plan!.id },
                headers: { "idempotency-key": key, "if-match": etag(props.plan!) },
                body: {
                  title: title.trim(),
                  clinicalSummary: summary.trim() || null,
                  phases: content
                }
              }),
            async (result) => {
              setDirty(false);
              await props.onSaved(result.treatmentPlan.id);
            }
          )
        : await props.mutate(
            (key) =>
              props.client.createPatientTreatmentPlan({
                path: { patientId: props.patientId },
                headers: { "idempotency-key": key },
                body: {
                  title: title.trim(),
                  clinicalSummary: summary.trim() || null,
                  encounterId: encounterId || undefined,
                  status: "draft",
                  phases: content
                }
              }),
            async (result) => {
              setDirty(false);
              await props.onSaved(result.treatmentPlan.id);
            }
          );
      if (success) setMessage("Treatment plan saved with server-calculated prices.");
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      {dirty ? <p role="status">Unsaved plan edits. Save before leaving this page.</p> : null}
      <label>
        Plan title{" "}
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          required
        />
      </label>
      <label>
        Clinical summary{" "}
        <textarea
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
            setDirty(true);
          }}
        />
      </label>
      {!props.plan ? (
        <>
          <label>
            Related visit, if any{" "}
            <select
              value={encounterId}
              onChange={(event) => {
                setEncounterId(event.target.value);
                setDirty(true);
              }}
            >
              <option value="">No linked visit</option>
              {props.visits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {clinicDisplayTime(fieldText(visit, "createdAt"), timeZone)} ·{" "}
                  {fieldText(visit, "status").replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {props.visitsCursor ? (
            <button type="button" onClick={props.onMoreVisits}>
              Load older visit choices
            </button>
          ) : null}
        </>
      ) : null}
      <PhaseFields
        phases={phases}
        pricebook={props.pricebook}
        onChange={(next) => {
          setPhases(next);
          setDirty(true);
        }}
      />
      {message ? <p role="status">{message}</p> : null}
      <button type="submit" disabled={props.locked || !props.pricebook.length}>
        Save {props.plan ? "changes" : "draft plan"}
      </button>
    </form>
  );
}

function PlanActions(
  props: BillingContext & {
    readonly plan: VersionedPublicResource;
    readonly pricebook: readonly PublicJsonObject[];
    readonly pricebookError: string;
    readonly onSaved: () => Promise<void>;
  }
) {
  const status = fieldText(props.plan, "status");
  const mutable = !["accepted", "cancelled"].includes(status);
  const [acceptedBy, setAcceptedBy] = useState("");
  const [evidence, setEvidence] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [attested, setAttested] = useState(false);
  const [message, setMessage] = useState("");

  async function setStatus(next: "presented" | "deferred" | "declined" | "cancelled") {
    const success = await props.mutate(
      (key) =>
        props.client.updateTreatmentPlan({
          path: { treatmentPlanId: props.plan.id },
          headers: { "idempotency-key": key, "if-match": etag(props.plan) },
          body: { status: next }
        }),
      props.onSaved
    );
    if (success) setMessage(`Plan marked ${next}.`);
  }

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!attested || !acceptedBy.trim() || !evidence.trim() || !evidenceDate) {
      setMessage(
        "Record the accepting person and the location and date of actual acceptance evidence."
      );
      return;
    }
    const headers = { "if-match": etag(props.plan) };
    const success = await props.mutate(
      (key) =>
        props.client.acceptTreatmentPlan({
          path: { treatmentPlanId: props.plan.id },
          headers: { "idempotency-key": key, ...headers },
          body: {
            acceptedByName: acceptedBy.trim(),
            acceptanceEvidence: {
              recordLocation: evidence.trim(),
              recordedOn: evidenceDate,
              confirmation: "already_obtained"
            }
          }
        }),
      props.onSaved
    );
    if (success) {
      setAttested(false);
      setMessage("Existing patient acceptance evidence recorded.");
    }
  }

  if (!mutable)
    return <p>Plan is {status}; its accepted estimate remains part of the clinical record.</p>;
  return (
    <section aria-label="Treatment plan actions">
      <fieldset disabled={props.locked}>
        {props.pricebookError ? (
          <p role="alert">Pricebook unavailable: {props.pricebookError}</p>
        ) : null}
        <PlanEditor
          {...props}
          visits={[]}
          visitsCursor={null}
          onMoreVisits={() => undefined}
          onSaved={async () => props.onSaved()}
        />
        <h3>Plan status</h3>
        {status !== "presented" ? (
          <button type="button" disabled={props.locked} onClick={() => void setStatus("presented")}>
            Mark presented to patient
          </button>
        ) : null}
        {status !== "deferred" ? (
          <button type="button" disabled={props.locked} onClick={() => void setStatus("deferred")}>
            Defer
          </button>
        ) : null}
        {status !== "declined" ? (
          <button type="button" disabled={props.locked} onClick={() => void setStatus("declined")}>
            Record declined
          </button>
        ) : null}
        <button type="button" disabled={props.locked} onClick={() => void setStatus("cancelled")}>
          Cancel plan
        </button>
        {["draft", "presented"].includes(status) ? (
          <form onSubmit={(event) => void accept(event)}>
            <h3>Record acceptance already obtained</h3>
            <p>
              Check the saved server-priced estimate and the clinic’s actual signed acceptance
              record before recording acceptance.
            </p>
            <label>
              Person accepting{" "}
              <input
                value={acceptedBy}
                onChange={(event) => setAcceptedBy(event.target.value)}
                required
              />
            </label>
            <label>
              Signed evidence location or reference{" "}
              <input
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                required
              />
            </label>
            <label>
              Date on evidence{" "}
              <input
                type="date"
                value={evidenceDate}
                onChange={(event) => setEvidenceDate(event.target.value)}
                required
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
              />{" "}
              I verified this specific estimate was accepted using the clinic’s approved process.
            </label>
            <button type="submit" disabled={props.locked || !attested}>
              Record acceptance
            </button>
          </form>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </fieldset>
    </section>
  );
}

function ProcedurePanel(
  props: BillingContext & {
    readonly plan: VersionedPublicResource;
    readonly visits: readonly VersionedPublicResource[];
    readonly visitsCursor: string | null;
    readonly visitsLoading: boolean;
    readonly onMoreVisits: () => void;
    readonly onCompleted: () => Promise<void>;
    readonly procedureNames: ReadonlyMap<string, string>;
  }
) {
  const [itemId, setItemId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [performedLocal, setPerformedLocal] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [message, setMessage] = useState("");
  const items = acceptedIncompleteItems(props.plan);
  const ownVisits = props.visits.filter(
    (visit) =>
      props.profile.roles.includes("doctor") &&
      fieldText(visit, "providerUserId") === props.profile.user.id &&
      ["drafting", "ready_for_sign", "signed", "amended"].includes(fieldText(visit, "status"))
  );
  const timeZone = props.profile.clinic.timezone || "UTC";

  async function complete(event: FormEvent) {
    event.preventDefault();
    if (
      !items.some((item) => fieldText(item, "id") === itemId) ||
      !ownVisits.some((visit) => visit.id === encounterId)
    ) {
      setMessage("Choose an accepted incomplete item and your assigned active visit.");
      return;
    }
    try {
      const performedAt = performedLocal
        ? clinicDateTimeToInstant(performedLocal, timeZone)
        : undefined;
      const success = await props.mutate(
        (key) =>
          props.client.createEncounterProcedurePerformed({
            path: { encounterId },
            headers: { "idempotency-key": key },
            body: {
              treatmentPlanId: props.plan.id,
              treatmentPlanEstimateItemId: itemId,
              performedAt,
              notes: notes.trim() || undefined,
              outcome: outcome.trim() || undefined,
              provenance: { recordedByUserId: props.profile.user.id, source: "clinician_entry" }
            }
          }),
        props.onCompleted
      );
      if (success) {
        setItemId("");
        setNotes("");
        setOutcome("");
        setMessage("Completed procedure recorded. It is available for billing.");
      }
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <section aria-label="Completed treatment">
      <h3>Record performed procedure</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={fieldText(item, "id")}>
              {props.procedureNames.get(fieldText(item, "pricebookProcedureId")) ||
                "Catalog procedure"}
              {fieldText(item, "toothNumber") ? ` · tooth ${fieldText(item, "toothNumber")}` : ""}
              {` · estimated ${formatInrMinor(item.totalMinor)}`}
            </li>
          ))}
        </ul>
      ) : (
        <p>All accepted items have been completed or none are available.</p>
      )}
      {!can(props.profile, "clinical.note.write") || !props.profile.roles.includes("doctor") ? (
        <p>Only the assigned doctor may record completed clinical work.</p>
      ) : (
        <form onSubmit={(event) => void complete(event)}>
          <label>
            Accepted incomplete plan item{" "}
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              <option value="">Choose an item</option>
              {items.map((item) => (
                <option key={fieldText(item, "id")} value={fieldText(item, "id")}>
                  {props.procedureNames.get(fieldText(item, "pricebookProcedureId")) ||
                    "Catalog procedure"}
                  {fieldText(item, "toothNumber")
                    ? ` · tooth ${fieldText(item, "toothNumber")}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assigned active visit{" "}
            <select
              value={encounterId}
              onChange={(event) => setEncounterId(event.target.value)}
              required
            >
              <option value="">Choose your visit</option>
              {ownVisits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {clinicDisplayTime(fieldText(visit, "createdAt"), timeZone)} ·{" "}
                  {fieldText(visit, "status").replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {props.visitsCursor ? (
            <button type="button" disabled={props.visitsLoading} onClick={props.onMoreVisits}>
              Load older visits
            </button>
          ) : null}
          <label>
            Performed at, clinic time{" "}
            <input
              type="datetime-local"
              value={performedLocal}
              onChange={(event) => setPerformedLocal(event.target.value)}
            />
          </label>
          <label>
            Clinical notes{" "}
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <label>
            Outcome{" "}
            <textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} />
          </label>
          <button type="submit" disabled={props.locked || !itemId || !encounterId}>
            Record completed procedure
          </button>
        </form>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function BillingPanel(props: BillingContext) {
  const invoices = usePaged(
    (cursor) =>
      props.client
        .listPatientInvoices({ path: { patientId: props.patientId }, query: { cursor, limit: 50 } })
        .then((page) => ({ records: page.invoices, nextCursor: page.nextCursor })),
    (item) => fieldText(item, "id"),
    [props.client, props.patientId]
  );
  const procedures = usePaged(
    (cursor) =>
      props.client
        .listUninvoicedPatientProcedures({
          path: { patientId: props.patientId },
          query: { cursor, limit: 50 }
        })
        .then((page) => ({ records: page.procedures, nextCursor: page.nextCursor })),
    (item) => fieldText(item, "id"),
    [props.client, props.patientId]
  );
  const pricebook = usePaged(
    (cursor) =>
      props.client
        .listPricebookProcedures({ query: { cursor, limit: 100 } })
        .then((page) => ({ records: page.procedures, nextCursor: page.nextCursor })),
    (item) => fieldText(item, "id"),
    [props.client]
  );
  const [invoiceId, setInvoiceId] = useState("");
  const [selectedProcedureIds, setSelectedProcedureIds] = useState<string[]>([]);
  const [dueLocal, setDueLocal] = useState("");
  const [message, setMessage] = useState("");
  const timeZone = props.profile.clinic.timezone || "UTC";
  const procedureNames = new Map(
    pricebook.rows.map((item) => [
      fieldText(item, "id"),
      fieldText(item, "displayName") || fieldText(item, "code")
    ]) ?? []
  );
  const chosenPlanId = fieldText(
    procedures.rows.find((item) => selectedProcedureIds.includes(fieldText(item, "id"))),
    "treatmentPlanId"
  );

  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    const selected = procedures.rows.filter((item) =>
      selectedProcedureIds.includes(fieldText(item, "id"))
    );
    if (
      !selected.length ||
      selected.length !== selectedProcedureIds.length ||
      selected.some(
        (item) => fieldText(item, "status") !== "completed" || fieldText(item, "invoiceId")
      )
    ) {
      setMessage("Choose saved, completed, uninvoiced procedures.");
      return;
    }
    if (new Set(selected.map((item) => fieldText(item, "treatmentPlanId"))).size !== 1) {
      setMessage("Create one invoice per treatment plan.");
      return;
    }
    try {
      const dueAt = dueLocal ? clinicDateTimeToInstant(dueLocal, timeZone) : undefined;
      const success = await props.mutate(
        (key) =>
          props.client.createInvoice({
            headers: { "idempotency-key": key },
            body: {
              patientId: props.patientId,
              treatmentPlanId: chosenPlanId,
              procedurePerformedIds: selectedProcedureIds,
              dueAt
            }
          }),
        async (result) => {
          setInvoiceId(fieldText(result.invoice, "id"));
          await Promise.all([invoices.refresh(), procedures.refresh()]);
        }
      );
      if (success) {
        setSelectedProcedureIds([]);
        setDueLocal("");
        setMessage("Invoice issued from saved completed work.");
      }
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <>
      <Panel
        title="Completed work awaiting invoice"
        loading={procedures.loading}
        error={procedures.error}
        onRefresh={() => void procedures.refresh().catch(() => undefined)}
      >
        {procedures.rows.length ? (
          <form onSubmit={(event) => void createInvoice(event)}>
            <ul>
              {procedures.rows.map((item) => {
                const id = fieldText(item, "id");
                const samePlan =
                  !chosenPlanId || chosenPlanId === fieldText(item, "treatmentPlanId");
                return (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedProcedureIds.includes(id)}
                        disabled={!samePlan || props.locked || !can(props.profile, "billing.write")}
                        onChange={(event) =>
                          setSelectedProcedureIds((previous) =>
                            event.target.checked
                              ? [...previous, id]
                              : previous.filter((value) => value !== id)
                          )
                        }
                      />
                      {procedureNames.get(fieldText(item, "pricebookProcedureId")) ||
                        "Completed catalog procedure"}
                      {fieldText(item, "toothNumber")
                        ? ` · tooth ${fieldText(item, "toothNumber")}`
                        : ""}
                      {` · ${formatInrMinor(item.totalMinor)} · ${clinicDisplayTime(fieldText(item, "performedAt"), timeZone)}`}
                    </label>
                  </li>
                );
              })}
            </ul>
            {can(props.profile, "billing.write") ? (
              <>
                <label>
                  Due date, clinic time (optional){" "}
                  <input
                    type="datetime-local"
                    value={dueLocal}
                    onChange={(event) => setDueLocal(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={props.locked || selectedProcedureIds.length === 0}>
                  Issue invoice for selected completed work
                </button>
              </>
            ) : null}
          </form>
        ) : !procedures.loading ? (
          <p>No completed uninvoiced procedures found.</p>
        ) : null}
        {procedures.cursor ? (
          <button
            type="button"
            disabled={procedures.loading}
            onClick={() => void procedures.loadMore()}
          >
            Load more completed work
          </button>
        ) : null}
        {pricebook.error ? (
          <p>Procedure names unavailable; saved financial evidence is still shown.</p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </Panel>
      <Panel
        title="Invoices"
        loading={invoices.loading}
        error={invoices.error}
        onRefresh={() => void invoices.refresh().catch(() => undefined)}
      >
        {invoices.rows.length ? (
          <ul>
            {invoices.rows.map((item, index) => (
              <li key={fieldText(item, "id") || index}>
                <button
                  type="button"
                  aria-current={invoiceId === fieldText(item, "id") ? "true" : undefined}
                  onClick={() => setInvoiceId(fieldText(item, "id"))}
                >
                  {fieldText(item, "invoiceNumber") || "Invoice"} ·{" "}
                  {fieldText(item, "paymentStatus").replaceAll("_", " ")} ·
                  {` ${formatInrMinor(item.totalMinor)} total, ${formatInrMinor(item.balanceMinor)} balance`}
                </button>
              </li>
            ))}
          </ul>
        ) : !invoices.loading ? (
          <p>No invoices found for this patient.</p>
        ) : null}
        {invoices.cursor ? (
          <button
            type="button"
            disabled={invoices.loading}
            onClick={() => void invoices.loadMore()}
          >
            Load older invoices
          </button>
        ) : null}
      </Panel>
      {invoiceId ? (
        <InvoiceDetail
          key={invoiceId}
          {...props}
          invoiceId={invoiceId}
          onChanged={async () => {
            await invoices.refresh();
            await procedures.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function InvoiceDetail(
  props: BillingContext & { readonly invoiceId: string; readonly onChanged: () => Promise<void> }
) {
  const detail = useRemote(
    () => props.client.getInvoice({ path: { invoiceId: props.invoiceId } }),
    [props.client, props.invoiceId]
  );
  const invoice = detail.data?.invoice;
  const [message, setMessage] = useState("");
  const timeZone = props.profile.clinic.timezone || "UTC";
  if (invoice && fieldText(invoice, "patientId") !== props.patientId) {
    return <p role="alert">This invoice does not belong to the selected billing patient.</p>;
  }

  async function refreshAll() {
    await detail.refresh();
    await props.onChanged();
  }

  function printInvoice() {
    if (!invoice || fieldText(invoice, "status") !== "issued") return;
    try {
      printClinicalDocument(`Invoice ${fieldText(invoice, "invoiceNumber")}`, [
        `Clinic: ${props.profile.clinic.name}`,
        `Patient: ${props.patientName}`,
        `Issued: ${clinicDisplayTime(fieldText(invoice, "issuedAt"), timeZone)}`,
        ...valueList(invoice.items).map((itemValue) => {
          const item = record(itemValue);
          return `${fieldText(item, "description") || "Recorded procedure"} · ${String(item.quantity ?? 1)} × ${formatInrMinor(item.unitPriceMinor)} = ${formatInrMinor(item.totalMinor)}`;
        }),
        `Subtotal: ${formatInrMinor(invoice.subtotalMinor)}`,
        `Tax: ${formatInrMinor(invoice.taxMinor)}`,
        `Total: ${formatInrMinor(invoice.totalMinor)}`,
        `Paid: ${formatInrMinor(invoice.paidMinor)}`,
        `Balance: ${formatInrMinor(invoice.balanceMinor)}`
      ]);
    } catch (error) {
      setMessage(failure(error));
    }
  }

  function printReceipt(receipt: PublicJsonObject) {
    if (fieldText(receipt, "status") !== "generated") return;
    try {
      printClinicalDocument(`Receipt ${fieldText(receipt, "receiptNumber")}`, [
        `Clinic: ${props.profile.clinic.name}`,
        `Patient: ${props.patientName}`,
        `Invoice: ${fieldText(invoice, "invoiceNumber")}`,
        `Generated: ${clinicDisplayTime(fieldText(receipt, "generatedAt"), timeZone)}`,
        `Received: ${formatInrMinor(receipt.amountMinor)}`,
        ...valueList(receipt.paymentAllocations).map(
          (allocation) => `Payment allocation: ${formatInrMinor(record(allocation).amountMinor)}`
        )
      ]);
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <Panel
      title="Selected invoice"
      loading={detail.loading}
      error={detail.error}
      onRefresh={() => void detail.refresh().catch(() => undefined)}
    >
      {invoice ? (
        <>
          <p>
            <strong>{fieldText(invoice, "invoiceNumber")}</strong> · {fieldText(invoice, "status")}{" "}
            · {fieldText(invoice, "paymentStatus").replaceAll("_", " ")}
          </p>
          <p>
            Issued {clinicDisplayTime(fieldText(invoice, "issuedAt"), timeZone)} · total{" "}
            {formatInrMinor(invoice.totalMinor)} · paid {formatInrMinor(invoice.paidMinor)} ·
            balance {formatInrMinor(invoice.balanceMinor)}
          </p>
          <ul>
            {valueList(invoice.items).map((itemValue, index) => {
              const item = record(itemValue);
              return (
                <li key={fieldText(item, "id") || index}>
                  {fieldText(item, "description") || "Completed procedure"} ·{" "}
                  {formatInrMinor(item.totalMinor)}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={printInvoice}>
            Print saved invoice
          </button>
          {can(props.profile, "billing.write") ? (
            <>
              <ManualPaymentForm {...props} invoice={invoice} onChanged={refreshAll} />
              <section aria-label="Provider payment requests">
                <h3>Provider payment requests</h3>
                <p>
                  New provider links and QR requests are unavailable until this clinic’s provider
                  activation is verified. A request is never payment confirmation.
                </p>
                {valueList(invoice.paymentRequests).length ? (
                  <ul>
                    {valueList(invoice.paymentRequests).map((entry, index) => {
                      const requestRecord = record(entry);
                      return (
                        <li key={fieldText(requestRecord, "id") || index}>
                          {fieldText(requestRecord, "requestType").replaceAll("_", " ")} ·{" "}
                          {fieldText(requestRecord, "status")} ·{" "}
                          {formatInrMinor(requestRecord.amountMinor)}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
              <ReceiptForm {...props} invoice={invoice} onChanged={refreshAll} />
            </>
          ) : null}
          <h3>Saved receipts</h3>
          {valueList(invoice.receipts).length ? (
            <ul>
              {valueList(invoice.receipts).map((receiptValue, index) => {
                const receipt = record(receiptValue);
                return (
                  <li key={fieldText(receipt, "id") || index}>
                    {fieldText(receipt, "receiptNumber")} · {formatInrMinor(receipt.amountMinor)}
                    {fieldText(receipt, "status") === "generated" ? (
                      <button type="button" onClick={() => printReceipt(receipt)}>
                        Print saved receipt
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No receipts generated.</p>
          )}
        </>
      ) : !detail.loading ? (
        <p>Invoice detail unavailable. Retry before collecting payment.</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </Panel>
  );
}

const MANUAL_METHODS = ["cash", "upi", "card", "bank_transfer", "cheque", "other"] as const;

function ManualPaymentForm(
  props: BillingContext & {
    readonly invoice: PublicJsonObject;
    readonly onChanged: () => Promise<void>;
  }
) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceLocation, setEvidenceLocation] = useState("");
  const [receivedLocal, setReceivedLocal] = useState("");
  const [message, setMessage] = useState("");
  const balanceMinor =
    typeof props.invoice.balanceMinor === "number" ? props.invoice.balanceMinor : 0;
  const timeZone = props.profile.clinic.timezone || "UTC";
  let preview = "";
  if (amount)
    try {
      preview = `${parseInrMinor(amount)} paise`;
    } catch {
      preview = "Invalid amount";
    }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    try {
      const amountMinor = parseInrMinor(amount);
      if (amountMinor > balanceMinor)
        throw new Error("Amount cannot exceed the remaining invoice balance.");
      if (!reference.trim() || !reason.trim() || !evidenceLocation.trim()) {
        throw new Error("Payment reference, audit reason and evidence location are required.");
      }
      const receivedAt = receivedLocal
        ? clinicDateTimeToInstant(receivedLocal, timeZone)
        : undefined;
      const success = await props.mutate(
        (key) =>
          props.client.recordInvoiceManualPayment({
            path: { invoiceId: fieldText(props.invoice, "id") },
            headers: { "idempotency-key": key },
            body: {
              amountMinor,
              currency: "INR",
              method,
              reference: reference.trim(),
              reason: reason.trim(),
              receivedAt,
              evidence: {
                recordLocation: evidenceLocation.trim(),
                recordedByUserId: props.profile.user.id
              }
            }
          }),
        props.onChanged
      );
      if (success) {
        setAmount("");
        setReference("");
        setReason("");
        setEvidenceLocation("");
        setReceivedLocal("");
        setMessage("Manual payment recorded against the invoice. Review the refreshed balance.");
      }
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <section aria-label="Record manual payment">
      <h3>Record received manual payment</h3>
      <p>
        Only record money already received with matching clinic evidence. Partial payments are
        supported.
      </p>
      {fieldText(props.invoice, "status") === "issued" && balanceMinor > 0 ? (
        <form onSubmit={(event) => void recordPayment(event)}>
          <p>Remaining balance: {formatInrMinor(balanceMinor)}</p>
          <label>
            Amount received (INR){" "}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          {preview ? <p role="status">Exact amount: {preview}</p> : null}
          <label>
            Method{" "}
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              {MANUAL_METHODS.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Clinic payment reference{" "}
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          </label>
          <label>
            Audit reason{" "}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <label>
            Evidence location{" "}
            <input
              value={evidenceLocation}
              onChange={(event) => setEvidenceLocation(event.target.value)}
              required
            />
          </label>
          <label>
            Received at, clinic time (optional){" "}
            <input
              type="datetime-local"
              value={receivedLocal}
              onChange={(event) => setReceivedLocal(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.locked || !amount || preview === "Invalid amount"}>
            Record received payment
          </button>
        </form>
      ) : (
        <p>No collectible balance remains on this issued invoice.</p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function ReceiptForm(
  props: BillingContext & {
    readonly invoice: PublicJsonObject;
    readonly onChanged: () => Promise<void>;
  }
) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const eligible = receiptablePayments(props.invoice);
  const timeZone = props.profile.clinic.timezone || "UTC";

  async function generate(event: FormEvent) {
    event.preventDefault();
    const ids = eligible.map((item) => fieldText(item, "id"));
    if (!selectedIds.length || selectedIds.some((id) => !ids.includes(id))) {
      setMessage("Select settled, verified transactions without a receipt.");
      return;
    }
    const success = await props.mutate(
      (key) =>
        props.client.createInvoiceReceipt({
          path: { invoiceId: fieldText(props.invoice, "id") },
          headers: { "idempotency-key": key },
          body: { paymentTransactionIds: selectedIds }
        }),
      props.onChanged
    );
    if (success) {
      setSelectedIds([]);
      setMessage("Receipt generated from selected settled transactions.");
    }
  }

  return (
    <section aria-label="Generate receipt">
      <h3>Generate receipt</h3>
      {eligible.length ? (
        <form onSubmit={(event) => void generate(event)}>
          <ul>
            {eligible.map((item) => {
              const id = fieldText(item, "id");
              return (
                <li key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(id)}
                      onChange={(event) =>
                        setSelectedIds((previous) =>
                          event.target.checked
                            ? [...previous, id]
                            : previous.filter((value) => value !== id)
                        )
                      }
                    />
                    {formatInrMinor(item.amountMinor)} ·{" "}
                    {fieldText(item, "method") || fieldText(item, "provider")} ·{" "}
                    {clinicDisplayTime(fieldText(item, "receivedAt"), timeZone)}
                  </label>
                </li>
              );
            })}
          </ul>
          <button type="submit" disabled={props.locked || selectedIds.length === 0}>
            Generate receipt for selected payments
          </button>
        </form>
      ) : (
        <p>No settled, verified, unreceipted transactions are available.</p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function InstructionPanel(props: BillingContext) {
  const instructions = usePaged(
    (cursor) =>
      props.client
        .listPatientInstructions({
          path: { patientId: props.patientId },
          query: { cursor, limit: 50 }
        })
        .then((page) => ({ records: page.instructions, nextCursor: page.nextCursor })),
    (item) => fieldText(item, "id"),
    [props.client, props.patientId]
  );
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const timeZone = props.profile.clinic.timezone || "UTC";

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!approved || !templateId.trim() || !title.trim() || !body.trim()) {
      setMessage("Enter the approved reference and actual instruction text, then confirm review.");
      return;
    }
    const success = await props.mutate(
      (key) =>
        props.client.createPatientInstruction({
          path: { patientId: props.patientId },
          headers: { "idempotency-key": key },
          body: {
            channel: "print",
            templateId: templateId.trim(),
            title: title.trim(),
            body: body.trim()
          }
        }),
      instructions.refresh
    );
    if (success) {
      setTitle("");
      setBody("");
      setApproved(false);
      setMessage(
        "Instruction saved as a print request. Print and hand it over through the clinic process."
      );
    }
  }

  function printInstruction(item: PublicJsonObject) {
    if (fieldText(item, "channel") !== "print" || !fieldText(item, "body")) return;
    try {
      printClinicalDocument(fieldText(item, "title") || "Patient instruction", [
        `Clinic: ${props.profile.clinic.name}`,
        `Patient: ${props.patientName}`,
        `Approved reference: ${fieldText(item, "templateId")}`,
        `Recorded: ${clinicDisplayTime(fieldText(item, "createdAt"), timeZone)}`,
        fieldText(item, "body")
      ]);
    } catch (error) {
      setMessage(failure(error));
    }
  }

  return (
    <Panel
      title="Patient instructions"
      loading={instructions.loading}
      error={instructions.error}
      onRefresh={() => void instructions.refresh().catch(() => undefined)}
    >
      <p>
        Print requests are saved records; printing or handing over a copy must be confirmed by staff
        outside this screen.
      </p>
      {instructions.rows.length ? (
        <ul>
          {instructions.rows.map((item, index) => (
            <li key={fieldText(item, "id") || index}>
              {fieldText(item, "title") || "Patient instruction"} ·{" "}
              {fieldText(item, "status").replaceAll("_", " ")}
              {fieldText(item, "channel") === "print" && fieldText(item, "body") ? (
                <button type="button" onClick={() => printInstruction(item)}>
                  Print saved instruction
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !instructions.loading ? (
        <p>No instruction records found.</p>
      ) : null}
      {instructions.cursor ? (
        <button
          type="button"
          disabled={instructions.loading}
          onClick={() => void instructions.loadMore()}
        >
          Load older instructions
        </button>
      ) : null}
      <form onSubmit={(event) => void create(event)}>
        <h3>Record approved print instruction</h3>
        <label>
          Clinic-approved template or protocol reference{" "}
          <input
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            required
          />
        </label>
        <label>
          Title <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Clinician-entered instruction text{" "}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} required />
        </label>
        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />{" "}
          I checked this text against the approved clinic reference for this patient.
        </label>
        <button type="submit" disabled={props.locked || !approved}>
          Save print instruction request
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </Panel>
  );
}
