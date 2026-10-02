"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  ClinicOsApiClient,
  ListLeadsRequest,
  CreateLeadRequest,
  VersionedPublicResource,
  UpdateLeadStatusRequest
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "@/lib/me";
import { PatientSelector } from "../shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "../shared/WorkflowAction";
import { WorkflowCard, useWorkflowData } from "../shared/WorkflowData";
import { etag, fieldText, record } from "../shared/workflow-values";
import { loadBookingConfiguration, clinicDateTimeToInstant } from "./front-desk";

type Props = { client: ClinicOsApiClient; profile: MeProfile };
type LeadStatus = NonNullable<ListLeadsRequest["query"]>["status"];
const statuses = ["new", "contacted", "matched", "booked", "lost", "duplicate", "spam"] as const;
const sources = [
  "manual",
  "walkin",
  "call",
  "whatsapp",
  "practo",
  "google",
  "website",
  "instagram",
  "referral"
] as const;
export function LeadsWorkspace(props: Props) {
  const [status, setStatus] = useState<LeadStatus>("new"),
    [selected, setSelected] = useState("");
  const action = useWorkflowAction(
    `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`
  );
  const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const cursor = pages.at(-1);
  const data = useWorkflowData(
    () => props.client.listLeads({ query: { status, cursor, limit: 100 } }),
    [props.client, status, cursor]
  );
  const lead = data.data?.leads.find((row) => row.id === selected);
  return (
    <div className="daily-workspace">
      <h1>Lead inbox</h1>
      <WorkflowAction
        {...action}
        onRecover={() =>
          void action.recover(async () => {
            await data.refresh();
            setRevision((value) => value + 1);
          })
        }
      />
      <WorkflowCard
        title="Enquiries"
        loading={data.loading}
        error={data.error}
        onRefresh={() => void data.refresh().catch(() => undefined)}
      >
        <label>
          Lead status
          <select
            value={status}
            disabled={action.locked}
            onChange={(event) => {
              setStatus(event.target.value as LeadStatus);
              setPages([undefined]);
              setSelected("");
            }}
          >
            {statuses.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <ul>
          {data.data?.leads.map((row) => (
            <li key={row.id}>
              <button type="button" disabled={action.locked} onClick={() => setSelected(row.id)}>
                {fieldText(record(row.sourceDetail), "patientName") ||
                  fieldText(row, "primaryContact")}{" "}
                · {fieldText(row, "source")} · {fieldText(row, "status")}
              </button>
            </li>
          ))}
        </ul>
        {!data.loading && !data.data?.leads.length ? <p>No enquiries in this status.</p> : null}
        <div className="workflow-toolbar">
          <button
            type="button"
            disabled={data.loading || action.locked || pages.length < 2}
            onClick={() => {
              setSelected("");
              setPages(pages.slice(0, -1));
            }}
          >
            Previous enquiries
          </button>
          <button
            type="button"
            disabled={data.loading || action.locked || !data.data?.nextCursor}
            onClick={() => {
              setSelected("");
              setPages([...pages, data.data?.nextCursor ?? undefined]);
            }}
          >
            Next enquiries
          </button>
        </div>
      </WorkflowCard>
      {lead ? (
        <LeadEditor
          {...props}
          key={`${lead.id}:${lead.rowVersion}:${revision}`}
          lead={lead}
          action={action}
          refresh={async () => {
            await data.refresh();
          }}
        />
      ) : null}
      {props.profile.permissions.includes("message.write") ? (
        <CreateLead
          {...props}
          key={`create:${revision}`}
          action={action}
          refresh={async () => {
            await data.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
function CreateLead(
  props: Props & { action: ReturnType<typeof useWorkflowAction>; refresh: () => Promise<void> }
) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget,
      form = new FormData(element),
      text = (key: string) => String(form.get(key) ?? "").trim();
    setError("");
    if (!/^\+[1-9][0-9]{7,14}$/.test(text("contact"))) {
      setError("Enter a valid contact number including country code.");
      return;
    }
    const body: CreateLeadRequest["body"] = {
      primaryContact: text("contact"),
      source: text("source") as CreateLeadRequest["body"]["source"],
      intent: text("intent") as CreateLeadRequest["body"]["intent"],
      sourceDetail: { patientName: text("name"), note: text("note") }
    };
    const success = await props.action.execute(
      (key) => props.client.createLead({ headers: { "idempotency-key": key }, body }),
      props.refresh
    );
    if (success) element.reset();
  }
  return (
    <WorkflowCard title="Record an enquiry">
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={props.action.locked}>
          <legend>Enquiry details</legend>
          <div className="workflow-fields">
            <label>
              Name if provided
              <input name="name" autoComplete="off" maxLength={200} />
            </label>
            <label>
              Contact number
              <input name="contact" type="tel" required placeholder="+91…" />
            </label>
            <label>
              Source
              <select name="source">
                {sources.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Enquiry purpose
              <select name="intent">
                {[
                  "appointment_request",
                  "pricing_query",
                  "followup",
                  "emergency",
                  "lab_vendor",
                  "unknown"
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Enquiry note
              <textarea name="note" maxLength={2000} />
            </label>
          </div>
          <p>This records an enquiry; it does not send a message or book a visit.</p>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit">Save enquiry</button>
        </fieldset>
      </form>
    </WorkflowCard>
  );
}
function LeadEditor(
  props: Props & {
    lead: VersionedPublicResource;
    action: ReturnType<typeof useWorkflowAction>;
    refresh: () => Promise<void>;
  }
) {
  const [patientId, setPatientId] = useState<string | null>(
      fieldText(props.lead, "patientId") || null
    ),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const config = useWorkflowData(() => loadBookingConfiguration(props.client), [props.client]);
  const patient = useWorkflowData(
    () =>
      patientId
        ? props.client.getPatientDemographics({ path: { patientId } })
        : Promise.resolve(null),
    [props.client, patientId]
  );
  const transitions: Record<string, readonly UpdateLeadStatusRequest["body"]["status"][]> = {
    new: ["contacted", "lost", "duplicate", "spam"],
    contacted: ["lost", "duplicate", "spam"],
    matched: ["lost", "duplicate"],
    lost: ["contacted"]
  };
  const matched = Boolean(props.lead.patientId),
    status = fieldText(props.lead, "status"),
    canMatch = ["new", "contacted"].includes(status),
    canBook = ["matched", "new", "contacted"].includes(status) && matched;
  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget),
      text = (key: string) => String(form.get(key) ?? "");
    try {
      const durationMinutes = Number(text("duration"));
      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720)
        throw new Error("Enter a duration of 5–720 minutes.");
      const startAt = clinicDateTimeToInstant(text("start"), props.profile.clinic.timezone!);
      await props.action.execute(
        (key) =>
          props.client.convertLeadToAppointment({
            path: { leadId: props.lead.id },
            headers: { "idempotency-key": key },
            body: {
              providerUserId: text("doctor"),
              appointmentTypeId: text("type"),
              chairId: text("chair") || null,
              startAt,
              durationMinutes,
              status: "booked",
              reason: text("reason") || null
            }
          }),
        props.refresh
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the booking.");
    }
  }
  return (
    <WorkflowCard title="Selected enquiry">
      <p>
        {fieldText(record(props.lead.sourceDetail), "patientName")} ·{" "}
        {fieldText(props.lead, "primaryContact")} · {status}
      </p>
      <p>{fieldText(record(props.lead.sourceDetail), "note")}</p>
      {matched ? (
        <p>Matched patient: {fieldText(patient.data?.patient, "fullName") || "Loading patient…"}</p>
      ) : canMatch ? (
        <fieldset
          disabled={props.action.locked || !props.profile.permissions.includes("message.write")}
        >
          <legend>Match to a patient</legend>
          <PatientSelector
            client={props.client}
            patientId={patientId}
            onSelectPatient={(id) => {
              setPatientId(id);
              setConfirmed(false);
            }}
          />
          {patient.error ? <p role="alert">{patient.error}</p> : null}
          {patient.data?.patient.id === patientId ? (
            <>
              <p>
                Selected: {fieldText(patient.data.patient, "fullName")} ·{" "}
                {fieldText(patient.data.patient, "phone")}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I verified this enquiry belongs to the selected person.
              </label>
            </>
          ) : null}
          <button
            type="button"
            disabled={!patientId || !confirmed || patient.loading || !!patient.error}
            onClick={() =>
              void props.action.execute(
                (key) =>
                  props.client.matchLeadToPatient({
                    path: { leadId: props.lead.id },
                    headers: { "idempotency-key": key },
                    body: { patientId: patientId! }
                  }),
                props.refresh
              )
            }
          >
            Confirm patient match
          </button>
          <p>
            New patient? <Link href="/surface/patients">Register them in Patients</Link>, then
            return to match this enquiry.
          </p>
        </fieldset>
      ) : null}
      {canBook && props.profile.permissions.includes("schedule.write") ? (
        <form onSubmit={(event) => void convert(event)}>
          <fieldset disabled={props.action.locked || config.loading || !!config.error}>
            <legend>Book the matched patient</legend>
            <div className="workflow-fields">
              <label>
                Doctor
                <select name="doctor" required>
                  <option value="">Choose doctor</option>
                  {config.data?.doctors.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Visit type
                <select name="type" required>
                  <option value="">Choose visit type</option>
                  {config.data?.types.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · usual {item.durationMinutes} min
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Chair
                <select name="chair">
                  <option value="">Unassigned</option>
                  {config.data?.chairs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Visit starts (clinic time)
                <input name="start" type="datetime-local" required />
              </label>
              <label>
                Planned duration in minutes
                <input name="duration" type="number" min={5} max={720} required />
              </label>
              <label>
                Reason
                <textarea name="reason" />
              </label>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <button type="submit">Convert enquiry to appointment</button>
          </fieldset>
        </form>
      ) : null}
      {config.error ? <p role="alert">{config.error}</p> : null}
      {props.profile.permissions.includes("message.write") ? (
        <div className="workflow-links">
          {transitions[status]?.map((next) => (
            <button
              key={next}
              disabled={props.action.locked}
              onClick={() =>
                void props.action.execute(
                  (key) =>
                    props.client.updateLeadStatus({
                      path: { leadId: props.lead.id },
                      headers: { "idempotency-key": key, "if-match": etag(props.lead) },
                      body: { status: next }
                    }),
                  props.refresh
                )
              }
            >
              Mark {next}
            </button>
          ))}
        </div>
      ) : null}
    </WorkflowCard>
  );
}
