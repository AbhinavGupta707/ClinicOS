"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  FileUp,
  RefreshCw,
  RotateCcw
} from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";

import {
  getCanonicalMigrationCsvTemplate,
  getMigrationTrialStepStates,
  MIGRATION_BATCH_STATUS_LABELS,
  MIGRATION_IMPORT_TYPE_LABELS,
  type CreateMigrationBatchRequest,
  type EligibleClinicDoctor,
  type MigrationBatch,
  type MigrationBatchStatus,
  type MigrationConflict,
  type MigrationImportType,
  type MigrationResolutionAction,
  type MigrationRow,
  type ResolveMigrationRowRequest
} from "@/lib/cp7-integration-ops";

interface MigrationOperationsPanelProps {
  actionBusy: boolean;
  batches: MigrationBatch[];
  eligibleDoctors: EligibleClinicDoctor[];
  fixtureMode: boolean;
  onCommit: (batch: MigrationBatch) => Promise<void>;
  onCreate: (input: CreateMigrationBatchRequest) => Promise<void>;
  onRefresh: () => Promise<void>;
  onResolve: (
    batch: MigrationBatch,
    row: MigrationRow,
    conflict: MigrationConflict,
    input: Omit<ResolveMigrationRowRequest, "actorName">
  ) => Promise<void>;
  onRollback: (batch: MigrationBatch) => Promise<void>;
  onSelectBatch: (batchId: string) => void;
  selectedBatchId: string | null;
}

const ALL_BATCH_STATES = "all";
const RESOLVABLE_STATES = new Set<MigrationBatchStatus>([
  "needs_review",
  "ready_to_commit",
  "validated"
]);

export function MigrationOperationsPanel({
  actionBusy,
  batches,
  eligibleDoctors,
  fixtureMode,
  onCommit,
  onCreate,
  onRefresh,
  onResolve,
  onRollback,
  onSelectBatch,
  selectedBatchId
}: MigrationOperationsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<MigrationBatchStatus | typeof ALL_BATCH_STATES>(
    ALL_BATCH_STATES
  );
  const [importType, setImportType] = useState<MigrationImportType>("patients");
  const [sourceSystem, setSourceSystem] = useState("manual_trial");
  const [sourceFileName, setSourceFileName] = useState("synthetic-patients.csv");
  const [csv, setCsv] = useState(() => getCanonicalMigrationCsvTemplate("patients"));
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const [targetRecordIds, setTargetRecordIds] = useState<Record<string, string>>({});

  const filteredBatches = useMemo(
    () =>
      statusFilter === ALL_BATCH_STATES
        ? batches
        : batches.filter((batch) => batch.status === statusFilter),
    [batches, statusFilter]
  );
  const trialStepStates = useMemo(
    () => getMigrationTrialStepStates(batches, sourceSystem),
    [batches, sourceSystem]
  );
  const selectedBatch =
    filteredBatches.find((batch) => batch.id === selectedBatchId) ?? filteredBatches[0] ?? null;
  const lastCommittedAt = batches
    .flatMap((batch) => (batch.commit.committedAt ? [batch.commit.committedAt] : []))
    .sort((left, right) => right.localeCompare(left))[0];

  useEffect(() => {
    setRollbackConfirmed(false);
  }, [selectedBatch?.id]);

  const handleImportTypeChange = (nextImportType: MigrationImportType) => {
    setImportType(nextImportType);
    setSourceFileName("synthetic-" + nextImportType + ".csv");
    setCsv(getCanonicalMigrationCsvTemplate(nextImportType));
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceFileName(file.name);
    setCsv(await file.text());
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onCreate({
      csv,
      importType,
      sourceFileName,
      sourceSystem
    });
  };

  return (
    <div className="migration-ops" data-testid="cp7-migration-operations">
      <section className="readiness-grid migration-ops__readiness" aria-label="Import readiness">
        <Metric label="Scheduled sync" value="Not configured" />
        <Metric label="Source freshness" value="Unknown" />
        <Metric
          label="Last manual commit"
          value={lastCommittedAt ? formatTimestamp(lastCommittedAt) : "No successful commit"}
        />
      </section>

      <TrialGuide
        actionBusy={actionBusy}
        importType={importType}
        onSelectImportType={handleImportTypeChange}
        sourceSystem={sourceSystem}
        states={trialStepStates}
      />

      <section className="work-panel" aria-labelledby="migration-stage-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Manual trial path</p>
            <h2 id="migration-stage-title">Stage a bounded canonical import</h2>
            <p>
              Use de-identified CSV until real-data handling is approved. This accepts ClinicOS
              canonical columns, not an invented Practo export schema, and never writes back to the
              source system.
            </p>
          </div>
          <span className="state-pill">Maximum 100 rows</span>
        </div>

        {fixtureMode ? (
          <div className="inline-alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>Fixture mode cannot create durable imports</strong>
              <span>Disable the CP7 fixture flag and connect the local API/Postgres stack.</span>
            </div>
          </div>
        ) : (
          <form className="migration-import-form" onSubmit={handleSubmit}>
            <label>
              <span>Record type</span>
              <select
                data-testid="migration-import-type"
                disabled={actionBusy}
                onChange={(event) =>
                  handleImportTypeChange(event.target.value as MigrationImportType)
                }
                value={importType}
              >
                {Object.entries(MIGRATION_IMPORT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source system key</span>
              <input
                data-testid="migration-source-system"
                disabled={actionBusy}
                maxLength={120}
                onChange={(event) => setSourceSystem(event.target.value)}
                required
                value={sourceSystem}
              />
              <small>
                Stable identity such as manual_trial; this is not a vendor success claim.
              </small>
            </label>
            <label>
              <span>CSV file name</span>
              <input
                disabled={actionBusy}
                maxLength={240}
                onChange={(event) => setSourceFileName(event.target.value)}
                value={sourceFileName}
              />
            </label>
            <label>
              <span>Choose CSV</span>
              <input
                accept=".csv,text/csv"
                disabled={actionBusy}
                onChange={(event) => void handleFile(event)}
                type="file"
              />
            </label>
            <label className="migration-import-form__csv">
              <span>Canonical CSV preview</span>
              <textarea
                data-testid="migration-csv"
                disabled={actionBusy}
                onChange={(event) => setCsv(event.target.value)}
                required
                rows={7}
                value={csv}
              />
              <small>
                Appointment source means acquisition channel; keep it explicit rather than inferring
                it from the source-system key.
              </small>
            </label>
            <div className="surface-actions migration-import-form__actions">
              <Button
                data-testid="migration-stage-batch"
                disabled={actionBusy || !sourceSystem.trim() || !csv.trim()}
                icon={<FileUp size={16} />}
                type="submit"
              >
                Validate and stage
              </Button>
              <Button
                disabled={actionBusy}
                onClick={() => setCsv(getCanonicalMigrationCsvTemplate(importType))}
                type="button"
                variant="ghost"
              >
                Restore synthetic template
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="work-panel" aria-labelledby="migration-runs-title">
        <div className="panel-heading">
          <div>
            <h2 id="migration-runs-title">Import runs</h2>
            <p>Select any durable batch state; actions reload server truth after completion.</p>
          </div>
          <div className="surface-actions">
            <label className="migration-filter">
              <span className="sr-only">Filter import runs</span>
              <select
                disabled={actionBusy}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as MigrationBatchStatus | typeof ALL_BATCH_STATES
                  )
                }
                value={statusFilter}
              >
                <option value={ALL_BATCH_STATES}>All states</option>
                {Object.entries(MIGRATION_BATCH_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              aria-label="Refresh import runs"
              disabled={actionBusy}
              icon={<RefreshCw size={16} />}
              onClick={() => void onRefresh()}
              size="sm"
              variant="secondary"
            >
              Refresh
            </Button>
          </div>
        </div>

        {filteredBatches.length === 0 ? (
          <div className="empty-state">
            <span>No import runs match this state.</span>
          </div>
        ) : (
          <div className="migration-run-layout">
            <div className="migration-run-list" aria-label="Import runs">
              {filteredBatches.map((batch) => (
                <button
                  className={
                    batch.id === selectedBatch?.id
                      ? "migration-run-card migration-run-card--active"
                      : "migration-run-card"
                  }
                  key={batch.id}
                  onClick={() => onSelectBatch(batch.id)}
                  type="button"
                >
                  <span>
                    <strong>{MIGRATION_IMPORT_TYPE_LABELS[batch.importType]}</strong>
                    <small>{batch.sourceSystem}</small>
                  </span>
                  <span className="state-pill">{MIGRATION_BATCH_STATUS_LABELS[batch.status]}</span>
                  <small>
                    {batch.counts.total} rows · updated {formatTimestamp(batch.updatedAt)}
                  </small>
                </button>
              ))}
            </div>
            {selectedBatch ? (
              <BatchDetail
                actionBusy={actionBusy}
                batch={selectedBatch}
                eligibleDoctors={eligibleDoctors}
                fixtureMode={fixtureMode}
                onCommit={onCommit}
                onResolve={onResolve}
                onRollback={onRollback}
                rollbackConfirmed={rollbackConfirmed}
                setRollbackConfirmed={setRollbackConfirmed}
                setTargetRecordIds={setTargetRecordIds}
                targetRecordIds={targetRecordIds}
              />
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function BatchDetail({
  actionBusy,
  batch,
  eligibleDoctors,
  fixtureMode,
  onCommit,
  onResolve,
  onRollback,
  rollbackConfirmed,
  setRollbackConfirmed,
  setTargetRecordIds,
  targetRecordIds
}: {
  actionBusy: boolean;
  batch: MigrationBatch;
  eligibleDoctors: EligibleClinicDoctor[];
  fixtureMode: boolean;
  onCommit: MigrationOperationsPanelProps["onCommit"];
  onResolve: MigrationOperationsPanelProps["onResolve"];
  onRollback: MigrationOperationsPanelProps["onRollback"];
  rollbackConfirmed: boolean;
  setRollbackConfirmed: (value: boolean) => void;
  setTargetRecordIds: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)
  ) => void;
  targetRecordIds: Record<string, string>;
}) {
  const rollbackAvailable = ["committed", "partially_committed"].includes(batch.status);
  const openConflictsByRow = new Map(
    batch.conflicts
      .filter((conflict) => conflict.status === "unresolved")
      .map((conflict) => [conflict.rowId, conflict])
  );

  return (
    <div className="migration-batch-detail" data-testid="migration-selected-batch">
      <div className="cp7-card__heading">
        <div>
          <strong>{MIGRATION_IMPORT_TYPE_LABELS[batch.importType]}</strong>
          <span>
            {batch.sourceSystem} · {batch.sourceFileName ?? "No source file name"}
          </span>
        </div>
        <span className="state-pill" data-testid="cp7-migration-status">
          {MIGRATION_BATCH_STATUS_LABELS[batch.status]}
        </span>
      </div>

      <div className="migration-count-grid" aria-label="Import row counts">
        <Metric label="Total" value={String(batch.counts.total)} />
        <Metric label="Ready" value={String(batch.counts.ready)} />
        <Metric label="Conflicts" value={String(batch.counts.conflicts)} />
        <Metric label="Invalid" value={String(batch.counts.invalid)} />
        <Metric label="Committed" value={String(batch.counts.committed)} />
        <Metric label="Failed" value={String(batch.counts.failed)} />
      </div>

      <div className="cp7-card-list">
        {batch.rows.map((row) => {
          const conflict = openConflictsByRow.get(row.id);
          return (
            <article className="cp7-card cp7-card--compact" key={row.id}>
              <div className="cp7-card__heading">
                <div>
                  <strong>
                    Row {row.rowNumber}: {row.target}
                  </strong>
                  <span>{row.preview}</span>
                  <small>External reference: {row.externalReference}</small>
                </div>
                <span className="state-pill">{row.status.replaceAll("_", " ")}</span>
              </div>
              {row.issue ? <p className="cp7-card-note cp7-card-note--warn">{row.issue}</p> : null}
              {conflict && RESOLVABLE_STATES.has(batch.status) ? (
                <RowResolution
                  actionBusy={actionBusy}
                  batch={batch}
                  conflict={conflict}
                  eligibleDoctors={eligibleDoctors}
                  fixtureMode={fixtureMode}
                  onResolve={onResolve}
                  row={row}
                  setTargetRecordIds={setTargetRecordIds}
                  targetRecordId={targetRecordIds[row.id] ?? conflict.targetRecordId ?? ""}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <aside className="activation-card migration-batch-actions">
        <DatabaseBackup size={20} aria-hidden="true" />
        <strong>Reviewed commit gate</strong>
        <p>
          {batch.commit.state === "committed"
            ? batch.commit.committedRows +
              " reviewed rows committed. Invalid or skipped rows stayed out."
            : (batch.commit.blockedReason ?? "Only rows marked ready will be committed.")}
        </p>
        <div className="surface-actions">
          <Button
            data-testid="cp7-commit-migration-batch"
            disabled={actionBusy || batch.commit.state !== "ready"}
            onClick={() => void onCommit(batch)}
          >
            Commit reviewed rows
          </Button>
        </div>
        {rollbackAvailable ? (
          <div className="migration-rollback">
            <label>
              <input
                checked={rollbackConfirmed}
                disabled={actionBusy || fixtureMode}
                onChange={(event) => setRollbackConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                I understand rollback is best-effort compensation and may preserve records with
                later clinical or operational dependencies.
              </span>
            </label>
            <Button
              data-testid="cp7-rollback-migration-batch"
              disabled={actionBusy || fixtureMode || !rollbackConfirmed}
              icon={<RotateCcw size={16} />}
              onClick={() => void onRollback(batch)}
              size="sm"
              variant="secondary"
            >
              Attempt safe rollback
            </Button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function RowResolution({
  actionBusy,
  batch,
  conflict,
  eligibleDoctors,
  fixtureMode,
  onResolve,
  row,
  setTargetRecordIds,
  targetRecordId
}: {
  actionBusy: boolean;
  batch: MigrationBatch;
  conflict: MigrationConflict;
  eligibleDoctors: EligibleClinicDoctor[];
  fixtureMode: boolean;
  onResolve: MigrationOperationsPanelProps["onResolve"];
  row: MigrationRow;
  setTargetRecordIds: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)
  ) => void;
  targetRecordId: string;
}) {
  const targetRecordType =
    conflict.targetRecordType ?? (row.target === "practitioner" ? "provider_user" : row.target);
  const canCreate = row.target === "patient" && conflict.conflictType === "duplicate_patient";
  const canLink = row.target !== "appointment" || Boolean(conflict.targetRecordId);

  const resolve = (action: MigrationResolutionAction) =>
    onResolve(batch, row, conflict, {
      action,
      notes: resolutionNote(action, row),
      ...(action === "link_existing"
        ? {
            targetRecordId: targetRecordId.trim(),
            targetRecordType
          }
        : {})
    });

  return (
    <div className="migration-resolution">
      <p>{conflict.candidateSummary}</p>
      {canLink ? (
        <label>
          <span>
            {row.target === "practitioner"
              ? "Eligible ClinicOS doctor"
              : "Existing " + row.target + " ID"}
          </span>
          {row.target === "practitioner" ? (
            <>
              <select
                data-testid="migration-eligible-doctor"
                disabled={
                  actionBusy || Boolean(conflict.targetRecordId) || eligibleDoctors.length === 0
                }
                onChange={(event) =>
                  setTargetRecordIds((current) => ({
                    ...current,
                    [row.id]: event.target.value
                  }))
                }
                value={targetRecordId}
              >
                <option value="">Select an active clinic doctor</option>
                {eligibleDoctors.map((doctor) => (
                  <option key={doctor.providerUserId} value={doctor.providerUserId}>
                    {doctor.displayName}
                  </option>
                ))}
              </select>
              <small>
                {eligibleDoctors.length > 0
                  ? "Only active doctors with current clinic membership and role eligibility are listed."
                  : "No eligible ClinicOS doctor is configured for this clinic. Add or reactivate a doctor before linking this row."}
              </small>
            </>
          ) : (
            <input
              disabled={actionBusy || Boolean(conflict.targetRecordId)}
              onChange={(event) =>
                setTargetRecordIds((current) => ({ ...current, [row.id]: event.target.value }))
              }
              placeholder="UUID"
              value={targetRecordId}
            />
          )}
        </label>
      ) : (
        <small>
          Correct the missing patient, practitioner, type, or chair mapping and stage a new
          appointment batch. A generic action cannot bypass dependency checks.
        </small>
      )}
      <div className="surface-actions">
        {canLink ? (
          <Button
            data-testid="cp7-resolve-migration-conflict"
            disabled={actionBusy || !targetRecordId.trim()}
            onClick={() => void resolve("link_existing")}
            size="sm"
            variant="secondary"
          >
            Link existing
          </Button>
        ) : null}
        {canCreate ? (
          <Button
            disabled={actionBusy || fixtureMode}
            onClick={() => void resolve("create_new")}
            size="sm"
            variant="secondary"
          >
            Create separate patient
          </Button>
        ) : null}
        <Button
          disabled={actionBusy}
          onClick={() => void resolve("skip")}
          size="sm"
          variant="ghost"
        >
          Skip row
        </Button>
      </div>
    </div>
  );
}

const TRIAL_STEPS: ReadonlyArray<{
  description: string;
  importType: MigrationImportType;
  label: string;
}> = [
  {
    description: "Create or reconcile the patient identity link used by later appointments.",
    importType: "patients",
    label: "Patient"
  },
  {
    description: "Map the source practitioner to an active ClinicOS doctor; no user is created.",
    importType: "practitioners",
    label: "Practitioner"
  },
  {
    description: "Resolve both source links plus active type and chair codes, then verify Today.",
    importType: "appointments",
    label: "Appointment"
  }
];

function TrialGuide({
  actionBusy,
  importType,
  onSelectImportType,
  sourceSystem,
  states
}: {
  actionBusy: boolean;
  importType: MigrationImportType;
  onSelectImportType: (importType: MigrationImportType) => void;
  sourceSystem: string;
  states: Record<MigrationImportType, "complete" | "current" | "upcoming">;
}) {
  const appointmentComplete = states.appointments === "complete";

  return (
    <section className="work-panel migration-trial-guide" aria-labelledby="migration-trial-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Guided clinic trial</p>
          <h2 id="migration-trial-title">Build one appointment from source evidence</h2>
          <p>
            Use one stable source-system key across all three steps. Progress reflects committed
            rows in the visible durable import history; exact references are revalidated when the
            appointment is staged.
          </p>
        </div>
        <span className="state-pill">{sourceSystem.trim() || "Enter a source key"}</span>
      </div>
      <div className="migration-trial-steps">
        {TRIAL_STEPS.map((step, index) => {
          const state = states[step.importType];
          return (
            <article
              className={
                importType === step.importType
                  ? "migration-trial-step migration-trial-step--selected"
                  : "migration-trial-step"
              }
              data-state={state}
              key={step.importType}
            >
              <div className="migration-trial-step__heading">
                <span>{state === "complete" ? <CheckCircle2 size={18} /> : index + 1}</span>
                <strong>{step.label}</strong>
                <small>
                  {state === "complete" ? "Committed" : state === "current" ? "Next" : "Later"}
                </small>
              </div>
              <p>{step.description}</p>
              <Button
                data-testid={`migration-trial-step-${step.importType}`}
                disabled={actionBusy}
                onClick={() => onSelectImportType(step.importType)}
                size="sm"
                variant={importType === step.importType ? "primary" : "secondary"}
              >
                Prepare {step.label.toLowerCase()}
              </Button>
            </article>
          );
        })}
      </div>
      {appointmentComplete ? (
        <div className="migration-trial-complete" data-testid="migration-trial-complete">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>Committed appointment evidence is ready for product verification.</strong>
            <span>
              Open Today and confirm the patient, practitioner, time, and source are visible.
            </span>
          </div>
          <Link className="button-link button-link--primary" href="/">
            Open Today
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-metric cp7-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function resolutionNote(action: MigrationResolutionAction, row: MigrationRow) {
  if (action === "skip") return "Operator skipped imported " + row.target + " row after review.";
  if (action === "link_existing") {
    return "Operator confirmed the existing ClinicOS " + row.target + " identity after review.";
  }
  return "Operator confirmed this patient should be created separately after duplicate review.";
}

function formatTimestamp(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(instant);
}
