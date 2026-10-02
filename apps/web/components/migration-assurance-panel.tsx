"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@clinic-os/ui";
import type {
  ClinicOsApiClient,
  GetMigrationAssuranceResponse,
  ListImportRunsResponse
} from "@clinic-os/api-client-generated";
import { MIGRATION_ASSURANCE_ISSUES } from "@clinic-os/domain/migration-assurance";

type Report = GetMigrationAssuranceResponse["report"];
const labels: Record<Report["state"], string> = {
  incomplete: "Upload incomplete",
  action_required: "Actions remain",
  accounted_for: "Selected rows accounted for"
};
export function MigrationAssurancePanel({
  client,
  runId,
  sourceSystem,
  runs,
  busy
}: {
  client: ClinicOsApiClient;
  runId: string;
  sourceSystem: string;
  runs: ListImportRunsResponse["runs"];
  busy: boolean;
}) {
  const [comparison, setComparison] = useState("");
  const [appointment, setAppointment] = useState("");
  const [appointments, setAppointments] = useState<Array<{ id: string; createdAt: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [appointmentNotice, setAppointmentNotice] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    generation.current += 1;
    setReport(null);
    setNotice("");
  }, [busy]);

  const invalidate = () => {
    generation.current += 1;
    setReport(null);
    setNotice("");
  };
  const loadAppointments = async (older = false) => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await client.listAppointmentImports({
        query: older && cursor ? { cursor } : {}
      });
      if (!mounted.current) return;
      const records = page.imports
        .filter(
          (r) =>
            r.sourceSystem === sourceSystem &&
            typeof r.id === "string" &&
            typeof r.createdAt === "string"
        )
        .map((r) => ({ id: String(r.id), createdAt: String(r.createdAt) }));
      if (!older && appointment && !records.some((record) => record.id === appointment)) {
        setAppointment("");
        invalidate();
      }
      setAppointments((existing) =>
        older
          ? [...existing, ...records.filter((r) => !existing.some((e) => e.id === r.id))]
          : records
      );
      setCursor(page.nextCursor);
      setAppointmentNotice(
        records.length
          ? "Choose a file only if it belongs to this migration exercise."
          : "No matching files on this page. Load older files if available, or leave appointment evidence unselected."
      );
    } catch {
      if (mounted.current)
        setAppointmentNotice(
          "Appointment files could not be loaded. Their coverage cannot be confirmed."
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const refresh = async () => {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    invalidate();
    const token = generation.current;
    try {
      const result = await client.getMigrationAssurance({
        path: { runId },
        query: {
          ...(comparison ? { comparisonRunId: comparison } : {}),
          ...(appointment ? { appointmentImportId: appointment } : {})
        }
      });
      if (mounted.current && token === generation.current) setReport(result.report);
    } catch {
      if (mounted.current && token === generation.current)
        setNotice(
          "The report could not be confirmed. Check the selected evidence and refresh; no completion is assumed."
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const download = () => {
    if (!report || busy || loading) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...report,
            nextActions: report.issues.map((issue) => MIGRATION_ASSURANCE_ISSUES[issue]),
            limits: [
              "Database observation only; source freshness and clinic approval are not established.",
              "CSV evidence does not prove migration of charts, images, signed notes, invoices, payments or messaging consent.",
              "Absent source rows do not mean deletion or cancellation. Appointment evidence is selected separately.",
              "This report is not a backup and does not establish a tested independent restore."
            ]
          },
          null,
          2
        )
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clinicos-migration-assurance-${runId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const disabled = busy || loading;
  return (
    <details
      className="panel surface-stack"
      aria-label="Migration assurance"
      data-testid="migration-assurance"
    >
      <summary>Migration assurance · check saved results</summary>
      <div className="surface-stack">
        <div>
          <h2>Migration assurance</h2>
          <p>
            Check stored rows and identity links independently of the upload counters. This report
            does not approve replacing Practo.
          </p>
        </div>
        <label>
          Compare an earlier patient file (optional)
          <select
            aria-label="Compare patient file"
            disabled={disabled}
            value={comparison}
            onChange={(e) => {
              invalidate();
              setComparison(e.target.value);
            }}
          >
            <option value="">No comparison selected</option>
            {runs
              .filter((r) => r.id !== runId && r.sourceSystem === sourceSystem)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.createdAt).toLocaleString()} · {r.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
        <p>
          Use Load older runs above to discover earlier files. Comparisons require complete files
          with the same source and profile.
        </p>
        <div className="button-row">
          <Button variant="secondary" disabled={disabled} onClick={() => void loadAppointments()}>
            Find appointment evidence
          </Button>
          {cursor ? (
            <Button variant="ghost" disabled={disabled} onClick={() => void loadAppointments(true)}>
              Load older appointment files
            </Button>
          ) : null}
        </div>
        <label>
          Appointment evidence (optional, separately selected)
          <select
            aria-label="Appointment evidence for report"
            disabled={disabled}
            value={appointment}
            onChange={(e) => {
              invalidate();
              setAppointment(e.target.value);
            }}
          >
            <option value="">Appointment coverage not assessed</option>
            {appointments.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.createdAt).toLocaleString()} · {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {appointmentNotice ? <p role="status">{appointmentNotice}</p> : null}
        <p>
          Matching source names do not prove that files are from the same export. Source
          appointments without duration or booking identity still need explicit review.
        </p>
        <Button disabled={disabled} onClick={() => void refresh()}>
          Refresh assurance report
        </Button>
        {loading ? <p role="status">Reading saved evidence…</p> : null}
        {busy ? (
          <p>Refresh after the current operation finishes. Previous evidence has been cleared.</p>
        ) : null}
        {notice ? <p role="alert">{notice}</p> : null}
        {report && !busy ? (
          <>
            <h3>{labels[report.state]}</h3>
            <p>
              Database checked {new Date(report.observedAt).toLocaleString()}. Vendor freshness:
              unknown. Clinic approval: not assessed.
            </p>
            <dl className="migration-assurance-counts">
              <div>
                <dt>Expected rows</dt>
                <dd>{report.expected ?? "No whole-file manifest"}</dd>
              </div>
              <div>
                <dt>Received rows</dt>
                <dd>{report.received}</dd>
              </div>
              <div>
                <dt>Committed rows (includes replay/linking)</dt>
                <dd>{report.rows.committed}</dd>
              </div>
              <div>
                <dt>Distinct linked patients</dt>
                <dd>{report.patients.distinctPatients}</dd>
              </div>
              <div>
                <dt>Patient records created by this run</dt>
                <dd>{report.patients.createdPatients}</dd>
              </div>
              <div>
                <dt>Ready to commit</dt>
                <dd>{report.rows.ready}</dd>
              </div>
              <div>
                <dt>Rows needing review</dt>
                <dd>{report.rows.needsReview}</dd>
              </div>
              <div>
                <dt>Invalid / skipped / failed / rolled back</dt>
                <dd>
                  {report.rows.invalid} / {report.rows.skipped} / {report.rows.failed} /{" "}
                  {report.rows.rolledBack}
                </dd>
              </div>
              <div>
                <dt>Receipt / counter / patient-link discrepancies</dt>
                <dd>
                  {report.manifestProblems} / {report.counterMismatches} /{" "}
                  {report.patients.missingLinks}
                </dd>
              </div>
            </dl>
            <h3>What this evidence covers</h3>
            <p>
              {report.coverage === "practo_demographics_and_context"
                ? "Selected patient demographics and preserved source context. Historical context remains unverified until a clinician reviews its exact version."
                : report.coverage === "practo_demographics"
                  ? "Patient demographics only. Source notes and other excluded fields were not retained by this profile."
                  : "Only the canonical rows explicitly staged in this run. This does not prove a complete vendor export."}
            </p>
            <p>
              National ID, age-derived dates and anniversary data are not imported by the Practo
              profiles. CSVs do not establish coverage of dental charts, images, signed notes,
              invoices, payments or messaging consent.
            </p>
            <p>
              Historical versions added by this run: {report.context.versionsAdded}. Latest retained
              versions for its committed patient identities: {report.context.retainedVersions};
              reviewed: {report.context.reviewed}; clarification required:{" "}
              {report.context.needsClarification}; unreviewed: {report.context.unreviewed}; missing
              context: {report.context.missingRows}. Retained versions can include later source
              evidence; replay reuses earlier versions without clearing their review needs.
            </p>
            {report.comparison ? (
              <div>
                <h3>Source-file comparison</h3>
                {report.comparison.eligibility === "comparable" ? (
                  <p>
                    Added source identifiers: {report.comparison.added}; changed evidence:{" "}
                    {report.comparison.changed}; unchanged evidence: {report.comparison.unchanged};
                    absent from this file: {report.comparison.absent}. These counts do not mean
                    patients were created, updated or deleted.
                  </p>
                ) : (
                  <p>
                    Comparison unavailable: {report.comparison.eligibility.replaceAll("_", " ")}.
                    Difference counts are not assessed.
                  </p>
                )}
              </div>
            ) : (
              <p>
                No prior patient file selected; changes and absent source rows are not assessed.
              </p>
            )}
            {report.appointments ? (
              <div>
                <h3>Selected appointment evidence</h3>
                <p>
                  Expected: {report.appointments.expected}; pending: {report.appointments.pending};
                  history only: {report.appointments.history}; excluded:{" "}
                  {report.appointments.excluded}; linked bookings: {report.appointments.linked};
                  created bookings: {report.appointments.created}; broken links:{" "}
                  {report.appointments.missingLinks}.
                </p>
                <p>
                  History and excluded observations are not appointments. This selection does not
                  establish recurring sync.
                </p>
              </div>
            ) : (
              <p>No appointment file selected; appointment coverage is not assessed.</p>
            )}
            {report.issues.length ? (
              <div>
                <h3>Next actions</h3>
                <ul>
                  {report.issues.map((issue) => (
                    <li key={issue}>{MIGRATION_ASSURANCE_ISSUES[issue]}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>
                Selected stored rows are accounted for. Actual source completeness, clinic
                acceptance and independent backup/restore remain separate checks.
              </p>
            )}
            <Button variant="secondary" onClick={download} disabled={disabled}>
              Download aggregate report
            </Button>
            <p>
              The download contains counts and evidence IDs, not patient names or clinical text. It
              is an observation at the displayed time, not a backup.
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
}
