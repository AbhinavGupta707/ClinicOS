import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import type {
  FrontOfficeDayData,
  FrontOfficeLoadState,
  FrontOfficePatientSearchData,
  FrontOfficePatientWorkspaceData
} from "./loaders";

const shellStyle = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  overflowWrap: "anywhere" as const
};

export function FrontOfficeDayPanel(props: {
  readonly onOpenPatient: (patientId: string) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly state: FrontOfficeLoadState<FrontOfficeDayData>;
  readonly timeZone?: string;
}) {
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  if (props.state.status === "loading") {
    return (
      <FrontOfficeStateCard title="Loading clinic day" detail="Reading durable clinic records…" />
    );
  }
  if (props.state.status === "unavailable") {
    return <FrontOfficeStateCard title="Clinic day unavailable" detail={props.state.message} />;
  }
  if (props.state.status === "error") {
    return (
      <FrontOfficeStateCard title="Clinic day could not be loaded" detail={props.state.message} />
    );
  }

  const { dashboard, queue } = props.state.data;
  const appointments = dashboard.clinicDayAppointments;
  return (
    <section
      aria-label="Front-office clinic day"
      className="cp13-day"
      style={shellStyle}
      data-testid="cp13-front-office-day"
    >
      <header className="cp13-day__summary">
        <p>Today</p>
        <h1>{formatClinicDateHeading(dashboard.date)}</h1>
        <div className="cp13-day__summary-row">
          <div className="cp13-day__freshness" aria-label="Data freshness">
            <CheckCircle2 size={17} strokeWidth={1.75} aria-hidden="true" />
            <span>
              Loaded {formatClinicTimestamp(props.state.refreshedAt, props.timeZone)}
              {dashboard.dataAsOf
                ? " · Latest update " + formatClinicTimestamp(dashboard.dataAsOf, props.timeZone)
                : " · No appointment updates yet"}
            </span>
          </div>
          {props.onRefresh ? (
            <button
              className="cp13-day__refresh"
              onClick={() => void props.onRefresh?.()}
              type="button"
            >
              <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
              Refresh
            </button>
          ) : null}
        </div>
      </header>

      <div className="cp13-day__workspace">
        <article className="cp13-day__appointments">
          <header className="cp13-day__section-header">
            <div>
              <h2>Today&apos;s schedule</h2>
              <span>
                {appointments.length} appointment{appointments.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="cp13-day__view-control" aria-label="Schedule view">
              <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
              Day view
              <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
            </div>
          </header>

          {dashboard.appointmentsTruncated ? (
            <p className="cp13-day__notice" role="status">
              Only the first 500 appointments are shown. Narrow the clinic-day query before making
              completeness-sensitive decisions.
            </p>
          ) : null}

          {appointments.length === 0 ? (
            <div className="cp13-day__empty">
              <CalendarDays size={24} strokeWidth={1.6} aria-hidden="true" />
              <strong>No appointments recorded for this clinic day.</strong>
              <p>Import or create an appointment, then refresh Today.</p>
            </div>
          ) : (
            <div className="cp13-schedule-table">
              <div className="cp13-schedule-table__head" aria-hidden="true">
                <span>Time</span>
                <span>Patient</span>
                <span>Visit</span>
                <span>Dentist</span>
                <span>Chair</span>
                <span>Source</span>
                <span>Status</span>
              </div>
              <ol className="cp13-appointment-list" data-testid="cp13-clinic-day-appointments">
                {appointments.map((appointment) => {
                  const selected = selectedAppointmentId === appointment.id;
                  return (
                    <li key={appointment.id} data-state={appointment.status}>
                      <button
                        aria-expanded={selected}
                        className={
                          selected
                            ? "cp13-appointment-card cp13-appointment-card--selected"
                            : "cp13-appointment-card"
                        }
                        data-testid={"cp13-clinic-day-appointment-" + appointment.id}
                        onClick={() => setSelectedAppointmentId(selected ? null : appointment.id)}
                        type="button"
                      >
                        <span className="cp13-appointment-card__time">
                          <time dateTime={appointment.startAt}>
                            {formatClinicTime(appointment.startAt, props.timeZone)}
                          </time>
                          <small>{formatClinicTime(appointment.endAt, props.timeZone)}</small>
                        </span>
                        <span className="cp13-appointment-card__patient">
                          <span className="cp13-patient-avatar" aria-hidden="true">
                            {getInitials(appointment.patientName)}
                          </span>
                          <span>
                            <strong>{appointment.patientName}</strong>
                            <small>
                              {appointment.patientKind === "new"
                                ? "New patient"
                                : "Returning patient"}
                            </small>
                          </span>
                        </span>
                        <span className="cp13-appointment-card__cell">
                          <strong>{appointment.appointmentTypeName}</strong>
                          <small>{appointment.reason ?? "Clinic visit"}</small>
                        </span>
                        <span className="cp13-appointment-card__cell">
                          <strong>{appointment.providerName}</strong>
                        </span>
                        <span className="cp13-appointment-card__cell">
                          <strong>{appointment.chairName ?? "Not assigned"}</strong>
                        </span>
                        <span className="cp13-appointment-card__cell">
                          <strong>{humanize(appointment.source)}</strong>
                        </span>
                        <span
                          className="cp13-appointment-card__status"
                          data-status={appointment.status}
                        >
                          {humanize(appointment.status)}
                        </span>
                      </button>
                      {selected ? (
                        <div
                          className="cp13-appointment-detail"
                          data-testid="cp13-appointment-detail"
                        >
                          <dl>
                            <div>
                              <dt>Patient</dt>
                              <dd>
                                {appointment.patientKind === "new"
                                  ? "New patient"
                                  : "Returning patient"}
                              </dd>
                            </div>
                            <div>
                              <dt>Time</dt>
                              <dd>
                                {formatClinicTimeRange(
                                  appointment.startAt,
                                  appointment.endAt,
                                  props.timeZone
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Visit</dt>
                              <dd>{appointment.appointmentTypeName}</dd>
                            </div>
                            <div>
                              <dt>Dentist</dt>
                              <dd>{appointment.providerName}</dd>
                            </div>
                            <div>
                              <dt>Chair</dt>
                              <dd>{appointment.chairName ?? "Not assigned"}</dd>
                            </div>
                            <div>
                              <dt>Source</dt>
                              <dd>{humanize(appointment.source)}</dd>
                            </div>
                          </dl>
                          <div className="cp13-appointment-detail__actions">
                            <button
                              className="button-link button-link--primary"
                              onClick={() => props.onOpenPatient(appointment.patientId)}
                              type="button"
                            >
                              Open patient
                            </button>
                            <Link className="button-link" href="/surface/appointments">
                              View appointment
                            </Link>
                            <button onClick={() => setSelectedAppointmentId(null)} type="button">
                              <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                              Close details
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </article>

        <aside className="cp13-practice-pulse" aria-labelledby="clinic-pulse-title">
          <h2 id="clinic-pulse-title">Practice pulse</h2>
          <FrontOfficePulseSection title="Waiting" records={queue} />
          <FrontOfficePulseSection title="Open tasks" records={dashboard.openTasks} />
          <FrontOfficePulseSection
            title="Unconfirmed"
            records={dashboard.unconfirmedAppointments}
          />
        </aside>
      </div>
    </section>
  );
}

export function FrontOfficePatientSearchPanel(props: {
  readonly initialQuery?: string;
  readonly onSearch: (query: string) => Promise<void>;
  readonly onSelect: (patientId: string) => void;
  readonly selectedPatientId: string | null;
  readonly state: FrontOfficeLoadState<FrontOfficePatientSearchData> | { readonly status: "idle" };
}) {
  const [query, setQuery] = useState(props.initialQuery ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.onSearch(query);
  }

  return (
    <section className="cp13-patient-search" data-testid="cp13-patient-search">
      <header>
        <h1>Patients</h1>
      </header>
      <form onSubmit={submit} role="search">
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <label className="sr-only" htmlFor="cp13-patient-query">
          Search by name or phone
        </label>
        <input
          autoComplete="off"
          id="cp13-patient-query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or phone"
          value={query}
        />
        <button
          disabled={query.trim().length < 2 || props.state.status === "loading"}
          type="submit"
        >
          Search
        </button>
      </form>
      {props.state.status === "idle" ? (
        <p className="cp13-patient-search__hint">
          Enter at least two characters to search clinic patients.
        </p>
      ) : props.state.status === "loading" ? (
        <p className="cp13-patient-search__hint" aria-live="polite">
          Searching clinic records…
        </p>
      ) : props.state.status !== "ready" ? (
        <p className="cp13-patient-search__hint" role="alert">
          {props.state.message}
        </p>
      ) : props.state.data.patients.length === 0 ? (
        <p className="cp13-patient-search__hint">No patients matched “{props.state.data.query}”.</p>
      ) : (
        <>
          <p className="cp13-patient-search__count">
            {props.state.data.patients.length} result
            {props.state.data.patients.length === 1 ? "" : "s"}
          </p>
          <ul>
            {props.state.data.patients.map((patient) => (
              <li key={patient.id}>
                <button
                  aria-current={patient.id === props.selectedPatientId ? "true" : undefined}
                  onClick={() => props.onSelect(patient.id)}
                  type="button"
                >
                  <span className="cp13-patient-avatar" aria-hidden="true">
                    {getInitials(patient.fullName)}
                  </span>
                  <span>
                    <strong>{patient.fullName}</strong>
                    <small>
                      {patient.phone ??
                        (patient.source ? "Source: " + humanize(patient.source) : "Clinic patient")}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function FrontOfficePatientWorkspacePanel(props: {
  readonly dayState?: FrontOfficeLoadState<FrontOfficeDayData>;
  readonly onOpenFullProfile: (patientId: string) => void;
  readonly state: FrontOfficeLoadState<FrontOfficePatientWorkspaceData>;
}) {
  if (props.state.status !== "ready") {
    const detail =
      props.state.status === "loading"
        ? "Reading authorized patient records…"
        : props.state.message;
    return <FrontOfficeStateCard title="Patient preparation" detail={detail} />;
  }
  const { patient, timeline, prepSummary } = props.state.data;
  const patientName = displayField(patient, "fullName", "Authorized patient");
  const patientId = displayField(patient, "id", "");
  const source = displayField(patient, "source", "Not recorded");
  const dayData = props.dayState?.status === "ready" ? props.dayState.data : null;
  const appointments =
    dayData?.dashboard.clinicDayAppointments.filter(
      (appointment) => appointment.patientId === patientId
    ) ?? [];
  const queue =
    dayData?.queue.filter((record) => displayField(record, "patientId", "") === patientId) ?? [];
  const tasks =
    dayData?.dashboard.openTasks.filter(
      (record) => displayField(record, "patientId", "") === patientId
    ) ?? [];
  const leads =
    dayData?.leads.filter((record) => displayField(record, "patientId", "") === patientId) ?? [];
  const patientKind = appointments[0]?.patientKind === "new" ? "New patient" : "Clinic patient";

  return (
    <section
      aria-label="Patient front-office preparation"
      className="cp13-patient-workspace"
      data-testid="cp13-front-office-patient"
    >
      <header className="cp13-patient-workspace__header">
        <span className="cp13-patient-avatar cp13-patient-avatar--large" aria-hidden="true">
          {getInitials(patientName)}
        </span>
        <div>
          <h2>{patientName}</h2>
          <span>{patientKind}</span>
        </div>
        <button
          className="button-link button-link--primary"
          disabled={!patientId}
          onClick={() => props.onOpenFullProfile(patientId)}
          type="button"
        >
          Open full profile
        </button>
      </header>

      <dl className="cp13-patient-identity">
        <div>
          <dt>Source</dt>
          <dd>{humanize(source)}</dd>
        </div>
        <div>
          <dt>Patient type</dt>
          <dd>{patientKind}</dd>
        </div>
        <div>
          <dt>Intake status</dt>
          <dd>{prepSummary.latestIntakeResponse ? "Recorded" : "Not started"}</dd>
        </div>
      </dl>

      <div className="cp13-patient-workspace__grid">
        <article className="cp13-patient-panel cp13-patient-panel--appointments">
          <h3>Appointments</h3>
          {appointments.length === 0 ? (
            <div className="cp13-patient-empty">
              <CalendarDays size={23} strokeWidth={1.6} aria-hidden="true" />
              <strong>No appointment on today&apos;s clinic day.</strong>
              <span>Other visits remain available from the full profile.</span>
            </div>
          ) : (
            <ul>
              {appointments.map((appointment) => (
                <li key={appointment.id}>
                  <time>{formatClinicTimestamp(appointment.startAt)}</time>
                  <strong>{appointment.appointmentTypeName}</strong>
                  <span>{humanize(appointment.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="cp13-patient-panel">
          <h3>
            Current queue <span>{queue.length}</span>
          </h3>
          <p>
            {queue.length
              ? displayField(queue[0] ?? {}, "status", "Waiting")
              : "Not currently in the queue."}
          </p>
        </article>
        <article className="cp13-patient-panel">
          <h3>
            Open tasks <span>{tasks.length}</span>
          </h3>
          <p>
            {tasks.length
              ? displayField(tasks[0] ?? {}, "title", "Open clinic task")
              : "No open tasks for today."}
          </p>
        </article>
        <article className="cp13-patient-panel">
          <h3>Intake</h3>
          <p>
            {prepSummary.latestIntakeResponse
              ? "Latest intake response is recorded."
              : "No intake started."}
          </p>
        </article>
        <article className="cp13-patient-panel">
          <h3>
            Leads <span>{leads.length}</span>
          </h3>
          <p>{leads.length ? "A linked lead is available for review." : "No linked open leads."}</p>
        </article>
        <article className="cp13-patient-panel cp13-patient-panel--summary">
          <h3>Clinical summary</h3>
          {timeline.length === 0 ? (
            <p>No clinical summary recorded.</p>
          ) : (
            <p>
              {timeline.length} timeline item{timeline.length === 1 ? "" : "s"} recorded. Open the
              full profile for clinical detail.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function FrontOfficePulseSection(props: {
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly title: string;
}) {
  return (
    <section className="cp13-pulse-section">
      <header>
        <h3>{props.title}</h3>
        <span>{props.records.length}</span>
      </header>
      {props.records.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <ul>
          {props.records.slice(0, 3).map((record, index) => (
            <li key={typeof record.id === "string" ? record.id : props.title + "-" + index}>
              <strong>
                {displayField(
                  record,
                  "patientName",
                  displayField(record, "title", displayField(record, "status", "Recorded item"))
                )}
              </strong>
              <small>{displayField(record, "status", displayField(record, "dueAt", "Open"))}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FrontOfficeStateCard(props: { readonly title: string; readonly detail: string }) {
  return (
    <section
      role="status"
      aria-live="polite"
      style={shellStyle}
      data-testid="cp13-front-office-state"
    >
      <h2>{props.title}</h2>
      <p>{props.detail}</p>
    </section>
  );
}

function displayField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string
): string {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function formatClinicTime(value: string, timeZone?: string): string {
  return formatClinicDateTime(value, timeZone, "time");
}

function formatClinicTimeRange(startAt: string, endAt: string, timeZone?: string): string {
  return formatClinicTime(startAt, timeZone) + "–" + formatClinicTime(endAt, timeZone);
}

function formatClinicDateHeading(value: string): string {
  const date = new Date(value + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function getInitials(value: string): string {
  return (
    value
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "P"
  );
}

function formatClinicTimestamp(value: string, timeZone?: string): string {
  return formatClinicDateTime(value, timeZone, "timestamp");
}

function formatClinicDateTime(
  value: string,
  timeZone: string | undefined,
  mode: "time" | "timestamp"
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";

  const options: Intl.DateTimeFormatOptions =
    mode === "time"
      ? { hour: "numeric", minute: "2-digit" }
      : {
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          year: "numeric"
        };
  try {
    return new Intl.DateTimeFormat("en-IN", {
      ...options,
      ...(timeZone ? { timeZone } : {})
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-IN", options).format(date);
  }
}

function humanize(value: string): string {
  if (value === "walkin") return "Walk-in";
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
