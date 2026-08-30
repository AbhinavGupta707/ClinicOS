import type {
  FrontOfficeDayData,
  FrontOfficeLoadState,
  FrontOfficePatientWorkspaceData
} from "./loaders";

const shellStyle = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  overflowWrap: "anywhere" as const
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
  gap: "0.75rem",
  width: "100%",
  minWidth: 0
};

export function FrontOfficeDayPanel(props: {
  readonly state: FrontOfficeLoadState<FrontOfficeDayData>;
  readonly timeZone?: string;
}) {
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

  const { dashboard, queue, leads, intakeTemplates } = props.state.data;
  const appointments = dashboard.clinicDayAppointments;
  return (
    <section
      aria-label="Front-office clinic day"
      className="cp13-day"
      style={shellStyle}
      data-testid="cp13-front-office-day"
    >
      <header className="cp13-day__summary">
        <p className="eyebrow">Today</p>
        <h2>{dashboard.date}</h2>
        <p aria-label="Data freshness">
          Loaded {formatClinicTimestamp(props.state.refreshedAt, props.timeZone)}.{" "}
          {dashboard.dataAsOf
            ? `Latest appointment update ${formatClinicTimestamp(
                dashboard.dataAsOf,
                props.timeZone
              )}.`
            : "No appointment updates have been recorded yet."}
        </p>
      </header>
      <div style={gridStyle}>
        <FrontOfficeMetric label="Appointments" value={dashboard.totalAppointments} />
        <FrontOfficeMetric label="Waiting queue" value={queue.length} />
        <FrontOfficeMetric label="Open leads" value={leads.length} />
        <FrontOfficeMetric label="Active intake forms" value={intakeTemplates.length} />
      </div>
      <article className="cp13-day__appointments">
        <header className="cp13-day__section-header">
          <div>
            <p className="eyebrow">Schedule</p>
            <h3>Today&apos;s appointments</h3>
          </div>
          <strong>{appointments.length} shown</strong>
        </header>
        {dashboard.appointmentsTruncated ? (
          <p className="cp13-day__notice" role="status">
            Only the first 500 appointments are shown. Narrow the clinic-day query before making
            completeness-sensitive decisions.
          </p>
        ) : null}
        {appointments.length === 0 ? (
          <div className="cp13-day__empty">
            <strong>No appointments recorded for this clinic day.</strong>
            <p>Import or create an appointment, then refresh Today.</p>
          </div>
        ) : (
          <ol className="cp13-appointment-list" data-testid="cp13-clinic-day-appointments">
            {appointments.map((appointment) => (
              <li key={appointment.id}>
                <article
                  className="cp13-appointment-card"
                  data-testid={`cp13-clinic-day-appointment-${appointment.id}`}
                >
                  <div className="cp13-appointment-card__time">
                    <time dateTime={appointment.startAt}>
                      {formatClinicTimeRange(
                        appointment.startAt,
                        appointment.endAt,
                        props.timeZone
                      )}
                    </time>
                    <span>{humanize(appointment.status)}</span>
                  </div>
                  <div className="cp13-appointment-card__patient">
                    <h4>{appointment.patientName}</h4>
                    <p>{appointment.patientKind === "new" ? "New patient" : "Returning patient"}</p>
                  </div>
                  <dl className="cp13-appointment-card__details">
                    <div>
                      <dt>Practitioner</dt>
                      <dd>{appointment.providerName}</dd>
                    </div>
                    <div>
                      <dt>Visit</dt>
                      <dd>{appointment.appointmentTypeName}</dd>
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
                </article>
              </li>
            ))}
          </ol>
        )}
      </article>
      <div style={gridStyle}>
        <FrontOfficeRecordList title="Queue" records={queue} />
        <FrontOfficeRecordList title="Open tasks" records={dashboard.openTasks} />
        <FrontOfficeRecordList title="Unconfirmed" records={dashboard.unconfirmedAppointments} />
      </div>
    </section>
  );
}

export function FrontOfficePatientWorkspacePanel(props: {
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
  return (
    <section
      aria-label="Patient front-office preparation"
      style={shellStyle}
      data-testid="cp13-front-office-patient"
    >
      <h2>{displayField(patient, "fullName", "Authorized patient")}</h2>
      <p>
        {prepSummary.medicalHistoryChangePromptRequired
          ? "Medical history needs review."
          : "Medical history response is present."}
      </p>
      <div style={gridStyle}>
        <FrontOfficeMetric label="Timeline items" value={timeline.length} />
        <FrontOfficeMetric
          label="Active consents"
          value={prepSummary.activeConsentPurposes.length}
        />
        <FrontOfficeMetric
          label="Preparation highlights"
          value={prepSummary.timelineHighlights.length}
        />
      </div>
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

function FrontOfficeMetric(props: { readonly label: string; readonly value: number }) {
  return (
    <article
      style={{
        minWidth: 0,
        padding: "0.75rem",
        border: "1px solid currentColor",
        borderRadius: "0.75rem"
      }}
    >
      <p>{props.label}</p>
      <strong>{props.value}</strong>
    </article>
  );
}

function FrontOfficeRecordList(props: {
  readonly title: string;
  readonly records: readonly Readonly<Record<string, unknown>>[];
}) {
  return (
    <article style={{ minWidth: 0 }}>
      <h3>{props.title}</h3>
      {props.records.length === 0 ? (
        <p>None recorded.</p>
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: "1.25rem" }}>
          {props.records.map((record, index) => (
            <li key={typeof record.id === "string" ? record.id : `${props.title}-${index}`}>
              {displayField(
                record,
                "displayName",
                displayField(record, "title", displayField(record, "status", "Recorded item"))
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
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

function formatClinicTimeRange(startAt: string, endAt: string, timeZone?: string): string {
  return `${formatClinicDateTime(startAt, timeZone, "time")}–${formatClinicDateTime(
    endAt,
    timeZone,
    "time"
  )}`;
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
