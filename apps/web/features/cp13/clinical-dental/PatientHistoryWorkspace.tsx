"use client";

import type { useWorkflowAction } from "../shared/WorkflowAction";
import { PATIENT_SOURCE_FIELDS } from "@clinic-os/domain/patient-source-context";
import { ClinicalFileDetails, ClinicalMediaAccessButton } from "./ClinicalDentalWorkspace";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClinicOsApiClient, PublicJsonObject } from "@clinic-os/api-client-generated";
import type { MeProfile } from "../../../lib/me";
import { clinicDisplayTime, fieldText, record, valueList } from "../shared/workflow-values";
import {
  HISTORY_LABELS,
  compareDentalSnapshots,
  historySource,
  readHistorySource,
  type HistorySourceDetail
} from "./patient-history";

interface Props {
  client: ClinicOsApiClient;
  profile: MeProfile;
  patientId: string;
  locked: boolean;
  mutate: ReturnType<typeof useWorkflowAction>["execute"];
}
function label(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}
function useResource<T>(key: string, load: () => Promise<T>) {
  const loader = useRef(load);
  loader.current = load;
  const generation = useRef(0);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ key, data: null, loading: true, error: "" });
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setState((previous) => ({
      key,
      data: previous.key === key ? previous.data : null,
      loading: true,
      error: ""
    }));
    try {
      const data = await loader.current();
      if (current === generation.current) setState({ key, data, loading: false, error: "" });
    } catch (error) {
      if (current === generation.current)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "Record unavailable. Try again."
        }));
    }
  }, [key]);
  useEffect(() => {
    void refresh();
    const pending = generation;
    return () => {
      pending.current++;
    };
  }, [refresh]);
  return {
    ...(state.key === key ? state : { key, data: null, loading: true, error: "" }),
    refresh
  };
}
function ReadPanel(props: {
  title: string;
  loading: boolean;
  error: string;
  hasData: boolean;
  refresh: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="workspace-card patient-history-panel"
      aria-label={props.title}
      aria-busy={props.loading}
    >
      <header>
        <h2>{props.title}</h2>
        <button type="button" onClick={props.refresh} disabled={props.loading}>
          Refresh {props.title.toLowerCase()}
        </button>
      </header>
      {props.loading ? (
        <p role="status">{props.hasData ? "Refreshing the saved view…" : "Loading records…"}</p>
      ) : null}
      {props.error ? (
        <p role="alert">
          {props.error}{" "}
          {props.hasData
            ? "The previously loaded view is retained and may be out of date."
            : "No conclusion about missing records can be drawn."}
        </p>
      ) : null}
      {props.children}
    </section>
  );
}
export function PatientHistoryWorkspace(props: Props) {
  const scope = `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}:${props.patientId}`;
  return (
    <div className="patient-history-workspace" key={scope}>
      <p className="patient-history-boundary">
        ClinicOS records available to this account. Historical source context is available only when
        explicitly imported with the context profile. It does not include the source system’s
        complete clinical records, images or bills. Confirm missing history with the patient and
        clinic source record.
      </p>
      {props.profile.permissions.includes("patient.phi.read") &&
      props.profile.permissions.includes("clinical.note.read") ? (
        <SourceContexts {...props} scope={scope} />
      ) : null}
      <Preparation {...props} scope={scope} />
      <Timeline {...props} scope={scope} />
      {props.profile.permissions.includes("dental.chart.read") ? (
        <SnapshotComparison {...props} scope={scope} />
      ) : null}
    </div>
  );
}
function Preparation(props: Props & { scope: string }) {
  const result = useResource(props.scope, () =>
    props.client.getPatientPrepSummary({ path: { patientId: props.patientId } })
  );
  const prep = result.data?.prepSummary,
    timeZone = props.profile.clinic.timezone || "UTC";
  return (
    <ReadPanel title="Returning patient preparation" {...result} hasData={!!prep}>
      {prep ? (
        <>
          <p>
            Read from ClinicOS at {clinicDisplayTime(prep.generatedAt, timeZone)}. This is not the
            last source-system synchronization time.
          </p>
          <p>
            <strong>Confirm changes to medical history before treatment.</strong> Missing answers do
            not mean “no allergy” or “no condition”.
          </p>
          <h3>Latest saved intake</h3>
          {prep.latestIntakeResponse ? (
            <>
              <p>
                {clinicDisplayTime(fieldText(prep.latestIntakeResponse, "submittedAt"), timeZone)} ·{" "}
                {label(fieldText(prep.latestIntakeResponse, "source"))}
              </p>
              <TextFields data={record(prep.latestIntakeResponse.responses)} />
            </>
          ) : (
            <p>No intake is recorded. Medical history is unknown.</p>
          )}
          <h3>Active recorded consent</h3>
          <p>
            {prep.activeConsentPurposes.length
              ? prep.activeConsentPurposes.map(label).join(", ")
              : "No active consent is recorded."}{" "}
            Check the Consent workflow for the evidence and scope.
          </p>
          <h3>Record coverage</h3>
          <TextFields data={prep.dataCoverage} />
        </>
      ) : null}
    </ReadPanel>
  );
}
function Timeline(props: Props & { scope: string }) {
  const [category, setCategory] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<PublicJsonObject | null>(null);
  const cursor = cursors.at(-1),
    timeZone = props.profile.clinic.timezone || "UTC";
  const result = useResource(`${props.scope}:${category}:${cursor ?? "first"}`, () =>
    props.client.getPatientTimeline({
      path: { patientId: props.patientId },
      query: {
        limit: 20,
        cursor,
        ...(category
          ? {
              category: category as NonNullable<
                Parameters<ClinicOsApiClient["getPatientTimeline"]>[0]["query"]
              >["category"]
            }
          : {})
      }
    })
  );
  const data = result.data;
  function reset() {
    setSelected(null);
    setCursors([undefined]);
    if (!cursor) void result.refresh();
  }
  return (
    <>
      <ReadPanel title="Patient history" {...result} refresh={reset} hasData={!!data}>
        <label>
          History category
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setCursors([undefined]);
              setSelected(null);
            }}
          >
            <option value="">All authorized records</option>
            {(data?.allowedCategories ?? []).map((value) => (
              <option key={value} value={value}>
                {HISTORY_LABELS[value] ?? label(value)}
              </option>
            ))}
            {category && !data?.allowedCategories.includes(category as never) ? (
              <option value={category}>{HISTORY_LABELS[category]}</option>
            ) : null}
          </select>
        </label>
        {data ? (
          <>
            <p>
              Page {cursors.length} · {data.timeline.length} events · loaded{" "}
              {clinicDisplayTime(data.generatedAt, timeZone)}.
            </p>
            <ol className="patient-history-events">
              {data.timeline.map((item) => {
                const target = historySource(item, props.profile.permissions);
                return (
                  <li key={fieldText(item, "id")}>
                    <p className="patient-history-event-category">
                      {HISTORY_LABELS[fieldText(item, "category")] ??
                        label(fieldText(item, "itemType"))}
                    </p>
                    <h3>{fieldText(item, "title") || "Recorded event"}</h3>
                    <time dateTime={fieldText(item, "occurredAt")}>
                      {clinicDisplayTime(fieldText(item, "occurredAt"), timeZone)}
                    </time>
                    {fieldText(item, "summary") ? <p>{fieldText(item, "summary")}</p> : null}
                    {target ? (
                      <button type="button" onClick={() => setSelected(item)}>
                        Open record: {fieldText(item, "title") || label(target.kind)}
                      </button>
                    ) : (
                      <p className="muted-copy">
                        Event evidence only. Use its workflow to review or change the underlying
                        record.
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {!data.timeline.length && !result.error ? (
              <p>
                No events in this authorized category. This does not establish that external history
                is absent.
              </p>
            ) : null}
            <nav aria-label="Patient history pages">
              <button
                type="button"
                disabled={result.loading || cursors.length === 1}
                onClick={() => {
                  setSelected(null);
                  setCursors((old) => old.slice(0, -1));
                }}
              >
                Newer records
              </button>
              <button
                type="button"
                disabled={result.loading || !!result.error || !data.nextCursor}
                onClick={() => {
                  if (data.nextCursor) {
                    setSelected(null);
                    setCursors((old) => [...old, data.nextCursor!]);
                  }
                }}
              >
                Older records
              </button>
            </nav>
            {!data.nextCursor && !result.error ? (
              <p>
                End of the recorded events for this filter. Refresh to check for newly recorded
                work.
              </p>
            ) : null}
          </>
        ) : null}
      </ReadPanel>
      {selected ? (
        <SourceDetail
          key={`${props.scope}:${fieldText(selected, "id")}`}
          {...props}
          item={selected}
          close={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
function TextFields({ data, fields }: { data: PublicJsonObject; fields?: readonly string[] }) {
  const entries = (fields ?? Object.keys(data)).filter(
    (k) => data[k] !== undefined && data[k] !== null && data[k] !== ""
  );
  return entries.length ? (
    <dl className="patient-history-fields">
      {entries.map((k) => (
        <div key={k}>
          <dt>{label(k)}</dt>
          <dd>
            {Array.isArray(data[k])
              ? data[k]
                  .filter((v) => typeof v !== "object")
                  .map(String)
                  .join(", ") || "Structured answer recorded; review in Intake."
              : typeof data[k] === "object"
                ? "Structured answer recorded; review in Intake."
                : String(data[k])}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p>No details recorded in these fields.</p>
  );
}
const clinicalFields = [
  "chiefComplaint",
  "history",
  "examination",
  "investigations",
  "diagnosis",
  "treatmentPlan",
  "treatmentPerformed",
  "followUpInstructions"
];
const findingFields = [
  "toothNumber",
  "surface",
  "findingType",
  "severity",
  "status",
  "reviewStatus",
  "source",
  "confidence",
  "notes"
];
function SourceDetail(props: Props & { item: PublicJsonObject; close: () => void }) {
  const target = historySource(props.item, props.profile.permissions);
  const result = useResource(fieldText(props.item, "id"), () =>
    target
      ? readHistorySource(props.client, props.patientId, target)
      : Promise.reject(new Error("This source cannot be opened by this account."))
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const staff = useResource(`staff:${props.profile.clinic.id}`, () =>
    props.profile.permissions.includes("schedule.read")
      ? props.client.listClinicStaff()
      : Promise.resolve({ staff: [] })
  );
  function name(id: unknown) {
    return (
      staff.data?.staff.find((person) => person.id === id)?.displayName || "Staff name unavailable"
    );
  }
  const timeZone = props.profile.clinic.timezone || "UTC";
  function note(value: PublicJsonObject) {
    return (
      <article className="patient-history-record" key={fieldText(value, "id")}>
        <h4>
          Note version {String(value.versionNumber ?? "unknown")} ·{" "}
          {label(fieldText(value, "status"))}
        </h4>
        <p>
          {["signed", "amended"].includes(fieldText(value, "status"))
            ? `Signed by ${fieldText(value, "signedByDisplayName") || name(value.signedByUserId)} · ${clinicDisplayTime(fieldText(value, "signedAt"), timeZone)}`
            : "Unsigned draft — not a clinician-approved record."}
        </p>
        {fieldText(value, "amendmentReason") ? (
          <p>Amendment reason: {fieldText(value, "amendmentReason")}</p>
        ) : null}
        <TextFields data={record(value.content)} fields={clinicalFields} />
      </article>
    );
  }
  function content(detail: HistorySourceDetail) {
    const value = detail.value;
    switch (detail.kind) {
      case "media":
        return (
          <>
            <ClinicalFileDetails asset={value} />
            <ClinicalMediaAccessButton
              client={props.client}
              mediaAssetId={fieldText(value, "id")}
              asset={value}
            />
          </>
        );
      case "note":
        return note(value);
      case "encounter":
        return (
          <>
            <TextFields data={value} fields={["status", "reason"]} />
            <p>Visit clinician: {name(value.providerUserId)}</p>
            {detail.related.length ? (
              detail.related.map(note)
            ) : (
              <p>No note versions are recorded for this visit.</p>
            )}
          </>
        );
      case "prescription":
        return (
          <>
            <p>
              {label(fieldText(value, "status"))} ·{" "}
              {value.signedAt
                ? `Signed by ${fieldText(value, "signedByDisplayName") || name(value.signedByUserId)} · ${clinicDisplayTime(fieldText(value, "signedAt"), timeZone)}`
                : "Unsigned — not a signed prescription."}
            </p>
            {valueList(value.medications).map((med, i) => (
              <TextFields
                key={i}
                data={record(med)}
                fields={["name", "strength", "route", "frequency", "duration", "instructions"]}
              />
            ))}
            <TextFields data={value} fields={["notes"]} />
          </>
        );
      case "finding":
        return (
          <>
            <h4>Latest recorded finding</h4>
            <TextFields data={value} fields={findingFields} />
            <h4>Change history</h4>
            {detail.related.map((entry) => (
              <article key={fieldText(entry, "id")} className="patient-history-record">
                <p>
                  {clinicDisplayTime(fieldText(entry, "changedAt"), timeZone)} ·{" "}
                  {name(entry.changedByUserId)} ·{" "}
                  {fieldText(entry, "reason") || "No reason recorded"}
                </p>
                <TextFields data={record(entry.afterState)} fields={findingFields} />
              </article>
            ))}
          </>
        );
      case "snapshot":
        return (
          <>
            <p>
              Immutable snapshot {String(value.snapshotVersion)} ·{" "}
              {clinicDisplayTime(fieldText(value, "createdAt"), timeZone)}
            </p>
            <p>{fieldText(value, "reason")}</p>
            {valueList(record(value.chartState).findings).map((f) => (
              <TextFields key={fieldText(f, "findingId")} data={record(f)} fields={findingFields} />
            ))}
          </>
        );
      case "invoice":
        return (
          <>
            <TextFields data={value} fields={["invoiceNumber", "status", "currency"]} />
            <dl>
              {["totalMinor", "creditedMinor", "paidMinor", "refundedMinor", "balanceMinor"].map(
                (k) => (
                  <div key={k}>
                    <dt>{label(k.replace("Minor", ""))}</dt>
                    <dd>
                      {typeof value[k] === "number"
                        ? new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency: "INR"
                          }).format(Number(value[k]) / 100)
                        : "Not returned"}
                    </dd>
                  </div>
                )
              )}
            </dl>
            <p>
              Use Accounts and reconciliation to review movements, allocations and refundable
              credit.
            </p>
          </>
        );
    }
  }
  return (
    <section className="workspace-card patient-history-panel" aria-label="Source record">
      <header>
        <h2 tabIndex={-1} ref={titleRef}>
          Source record
        </h2>
        <button type="button" onClick={props.close}>
          Close record
        </button>
      </header>
      <h3>{fieldText(props.item, "title")}</h3>
      <p>Read-only view. Opening history does not change the record.</p>
      {result.loading ? <p role="status">Loading source record…</p> : null}
      {result.error ? (
        <p role="alert">
          {result.error}{" "}
          <button type="button" onClick={() => void result.refresh()}>
            Retry source record
          </button>
        </p>
      ) : null}
      {result.data ? content(result.data) : null}
    </section>
  );
}
function SnapshotComparison(props: Props & { scope: string }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [options, setOptions] = useState<PublicJsonObject[]>([]);
  const [earlier, setEarlier] = useState(""),
    [later, setLater] = useState("");
  const [pair, setPair] = useState<{ before: PublicJsonObject; after: PublicJsonObject } | null>(
    null
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const list = useResource(`${props.scope}:snapshots:${cursor ?? "first"}`, () =>
    props.client.listPatientDentalSnapshots({
      path: { patientId: props.patientId },
      query: { limit: 20, cursor }
    })
  );
  useEffect(() => {
    if (list.data)
      setOptions((old) => {
        const indexed = new Map((cursor ? old : []).map((row) => [row.id, row]));
        for (const row of list.data!.snapshots) indexed.set(row.id, row);
        return [...indexed.values()];
      });
  }, [list.data, cursor]);
  const timeZone = props.profile.clinic.timezone || "UTC";
  async function compare() {
    const current = ++generation.current;
    setBusy(true);
    setMessage("");
    setPair(null);
    try {
      const [a, b] = await Promise.all([
        props.client.getPatientDentalSnapshot({
          path: { patientId: props.patientId, snapshotId: earlier }
        }),
        props.client.getPatientDentalSnapshot({
          path: { patientId: props.patientId, snapshotId: later }
        })
      ]);
      compareDentalSnapshots(a.snapshot, b.snapshot);
      if (current === generation.current) setPair({ before: a.snapshot, after: b.snapshot });
    } catch (e) {
      if (current === generation.current)
        setMessage(e instanceof Error ? e.message : "Comparison unavailable.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function clear() {
    generation.current++;
    setBusy(false);
    setPair(null);
    setMessage("");
  }
  const differences = pair ? compareDentalSnapshots(pair.before, pair.after) : [];
  return (
    <ReadPanel
      title="Dental snapshot comparison"
      {...list}
      hasData={!!list.data}
      refresh={() => {
        clear();
        setEarlier("");
        setLater("");
        setOptions([]);
        setCursor(undefined);
        if (!cursor) void list.refresh();
      }}
    >
      <p>
        Compare saved chart states. A finding missing from a later snapshot is not proof of
        treatment or resolution.
      </p>
      {list.data && !options.length && !list.loading && !list.error ? (
        <p>No snapshots have been recorded. Save a snapshot in Dental chart after review.</p>
      ) : null}
      <div className="patient-history-comparison-controls">
        {[
          ["Earlier snapshot", earlier, setEarlier],
          ["Later snapshot", later, setLater]
        ].map(([title, value, set]) => (
          <label key={String(title)}>
            {String(title)}
            <select
              value={String(value)}
              onChange={(e) => {
                clear();
                (set as (value: string) => void)(e.target.value);
              }}
            >
              <option value="">Choose a saved snapshot</option>
              {options.map((row) => (
                <option key={fieldText(row, "id")} value={fieldText(row, "id")}>
                  Version {String(row.snapshotVersion)} ·{" "}
                  {clinicDisplayTime(fieldText(row, "createdAt"), timeZone)}
                  {fieldText(row, "reason") ? ` · ${fieldText(row, "reason")}` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {list.data?.nextCursor ? (
        <button
          type="button"
          disabled={list.loading || !!list.error}
          onClick={() => setCursor(list.data!.nextCursor!)}
        >
          Load older snapshots
        </button>
      ) : null}
      <button
        type="button"
        disabled={!earlier || !later || earlier === later || busy}
        onClick={() => void compare()}
      >
        Compare saved snapshots
      </button>
      {busy ? <p role="status">Reading both saved snapshots…</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      {pair ? (
        <div aria-label="Snapshot differences">
          <h3>
            Recorded differences: version {String(pair.before.snapshotVersion)} →{" "}
            {String(pair.after.snapshotVersion)}
          </h3>
          <p>
            {differences.filter((d) => d.change === "unchanged").length} unchanged findings.
            Identifiers refer to the same recorded finding across versions.
          </p>
          {!differences.some((d) => d.change !== "unchanged") ? (
            <p>No changes in the compared finding fields.</p>
          ) : null}
          {differences
            .filter((d) => d.change !== "unchanged")
            .map((d) => (
              <article className="patient-history-record" key={d.findingId}>
                <h4>
                  Tooth {fieldText(d.after ?? d.before, "toothNumber")} ·{" "}
                  {d.change === "not_in_later_snapshot"
                    ? "Not present in later snapshot"
                    : label(d.change)}
                </h4>
                {d.changedFields.length ? (
                  <p>Changed fields: {d.changedFields.map(label).join(", ")}</p>
                ) : null}
                <div className="patient-history-diff">
                  <div>
                    <h5>Earlier recorded state</h5>
                    {d.before ? (
                      <TextFields data={d.before} fields={findingFields} />
                    ) : (
                      <p>Not present.</p>
                    )}
                  </div>
                  <div>
                    <h5>Later recorded state</h5>
                    {d.after ? (
                      <TextFields data={d.after} fields={findingFields} />
                    ) : (
                      <p>Not present; no outcome inferred.</p>
                    )}
                  </div>
                </div>
              </article>
            ))}
        </div>
      ) : null}
    </ReadPanel>
  );
}

function SourceContexts(props: Props & { scope: string }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const result = useResource(`${props.scope}:${cursor ?? "first"}`, () =>
    props.client.listPatientSourceContexts({
      path: { patientId: props.patientId },
      query: cursor ? { cursor } : {}
    })
  );
  return (
    <ReadPanel title="Historical source context" {...result} hasData={!!result.data}>
      <p>
        Source evidence, not current verified clinical facts. Source record dates are unknown.
        Import time is not the date the clinic recorded the information. A review does not create
        diagnoses, allergies, consent or signed notes.
      </p>
      {result.data && !result.loading && !result.error ? (
        <>
          {result.data.records.length === 0 ? (
            <p>
              No historical context has been imported for this patient. This does not mean there is
              no medical history.
            </p>
          ) : null}
          {result.data.records.map((item) => (
            <SourceContextCard key={item.id} {...props} item={item} refresh={result.refresh} />
          ))}
          <div className="surface-actions">
            <button
              type="button"
              disabled={!cursor || props.locked}
              onClick={() => setCursor(undefined)}
            >
              Latest source versions
            </button>
            <button
              type="button"
              disabled={!result.data.nextCursor || props.locked}
              onClick={() => setCursor(result.data?.nextCursor ?? undefined)}
            >
              Older source versions
            </button>
          </div>
        </>
      ) : null}
    </ReadPanel>
  );
}
function SourceContextCard(
  props: Props & { item: PublicJsonObject; refresh: () => Promise<void> }
) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"reviewed" | "needs_clarification">("reviewed");
  const review = record(props.item.review),
    fields = record(props.item.fields);
  const contextId = fieldText(props.item, "id"),
    patientId = props.patientId;
  return (
    <article
      className="workspace-card"
      data-testid="source-context-card"
      style={{ overflowWrap: "anywhere" }}
    >
      <h3>
        {fieldText(props.item, "sourceSystem")} · version {String(props.item.version)}
      </h3>
      <p>
        Source patient reference: {fieldText(props.item, "externalReference")} · Imported{" "}
        {clinicDisplayTime(
          fieldText(props.item, "importedAt"),
          props.profile.clinic.timezone || "UTC"
        )}
      </p>
      <p>
        {props.item.contactUnavailable
          ? "No primary mobile was supplied in this source version."
          : "Primary mobile was supplied; permission to contact is not implied."}
      </p>
      <p>Review: {fieldText(review, "decision").replaceAll("_", " ") || "Not reviewed"}</p>
      {review.note ? (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {fieldText(review, "note")} ·{" "}
          {clinicDisplayTime(
            fieldText(review, "reviewedAt"),
            props.profile.clinic.timezone || "UTC"
          )}
        </p>
      ) : null}
      {PATIENT_SOURCE_FIELDS.filter((key) => typeof fields[key] === "string").map((key) => (
        <div key={key}>
          <h4>{key}</h4>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(fields[key])}</p>
        </div>
      ))}
      {!Object.keys(fields).length ? (
        <p>No additional historical text was supplied in this version.</p>
      ) : null}
      {props.profile.roles.includes("doctor") &&
      props.profile.permissions.includes("clinical.note.sign") ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void props.mutate(
              (key) =>
                props.client.reviewPatientSourceContext({
                  path: { patientId, contextId },
                  headers: { "idempotency-key": key },
                  body: { decision, note }
                }),
              async () => {
                setNote("");
                await props.refresh();
              }
            );
          }}
        >
          <label>
            Review outcome
            <select
              value={decision}
              disabled={props.locked}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="reviewed">Reviewed with source / patient</option>
              <option value="needs_clarification">Needs clarification</option>
            </select>
          </label>
          <label>
            Review evidence
            <textarea
              value={note}
              minLength={5}
              maxLength={2000}
              required
              disabled={props.locked}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button disabled={props.locked || note.trim().length < 5} type="submit">
            Save review of version {String(props.item.version)}
          </button>
        </form>
      ) : (
        <p>A clinician with signing authority can record a review.</p>
      )}
    </article>
  );
}
