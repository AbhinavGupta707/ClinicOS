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
  return (
    <section
      aria-label="Front-office clinic day"
      style={shellStyle}
      data-testid="cp13-front-office-day"
    >
      <header>
        <p>Clinic day</p>
        <h2>{dashboard.date}</h2>
        <p aria-label="Last refreshed">Durable data refreshed {props.state.refreshedAt}</p>
      </header>
      <div style={gridStyle}>
        <FrontOfficeMetric label="Appointments" value={dashboard.totalAppointments} />
        <FrontOfficeMetric label="Waiting queue" value={queue.length} />
        <FrontOfficeMetric label="Open leads" value={leads.length} />
        <FrontOfficeMetric label="Active intake forms" value={intakeTemplates.length} />
      </div>
      <div style={gridStyle}>
        <FrontOfficeRecordList
          title="Unconfirmed appointments"
          records={dashboard.unconfirmedAppointments}
        />
        <FrontOfficeRecordList title="Queue" records={queue} />
        <FrontOfficeRecordList title="Open tasks" records={dashboard.openTasks} />
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
