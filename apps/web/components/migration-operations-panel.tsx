"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  FileUp,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UploadCloud
} from "lucide-react";
import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  getCanonicalMigrationCsvTemplate,
  getMigrationTrialStepStates,
  getInitialImportRunStep,
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
  run?: { id: string; sourceSystem: string };
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

type ImportInputMode = "file" | "paste";

const ALL_BATCH_STATES = "all";
const RESOLVABLE_STATES = new Set<MigrationBatchStatus>([
  "needs_review",
  "ready_to_commit",
  "validated"
]);

export function MigrationOperationsPanel({
  run,
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
  const [importType, setImportType] = useState<MigrationImportType>(() =>
    run ? getInitialImportRunStep(batches) : "patients"
  );
  const [inputMode, setInputMode] = useState<ImportInputMode>("file");
  const [sourceSystem, setSourceSystem] = useState(run?.sourceSystem ?? "manual_trial");
  const [sourceFileName, setSourceFileName] = useState(
    run ? "patients.csv" : "synthetic-patients.csv"
  );
  const [csv, setCsv] = useState(() => (run ? "" : getCanonicalMigrationCsvTemplate("patients")));
  const fileReadSequence = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [hasSelectedFile, setHasSelectedFile] = useState(false);
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
  const selectedBatch = run
    ? (batches.find((batch) => batch.importType === importType) ?? null)
    : (filteredBatches.find((batch) => batch.id === selectedBatchId) ?? filteredBatches[0] ?? null);
  const lastCommittedAt = batches
    .flatMap((batch) => (batch.commit.committedAt ? [batch.commit.committedAt] : []))
    .sort((left, right) => right.localeCompare(left))[0];
  const template = getCanonicalMigrationCsvTemplate(importType);
  const templateHref = "data:text/csv;charset=utf-8," + encodeURIComponent(template);
  const recordLabel = operatorRecordLabel(importType);

  useEffect(() => {
    setRollbackConfirmed(false);
  }, [selectedBatch?.id]);

  const handleImportTypeChange = (nextImportType: MigrationImportType) => {
    setImportType(nextImportType);
    setSourceFileName((run ? "" : "synthetic-") + nextImportType + ".csv");
    fileReadSequence.current += 1;
    setReadingFile(false);
    setFileError(null);
    setCsv(run ? "" : getCanonicalMigrationCsvTemplate(nextImportType));
    setHasSelectedFile(false);
  };

  useEffect(
    () => () => {
      fileReadSequence.current += 1;
    },
    []
  );

  const readFile = async (file: File) => {
    if (actionBusy) return;
    const sequence = ++fileReadSequence.current;
    setFileError(null);
    setCsv("");
    setHasSelectedFile(false);
    if (file.size > 256_000) {
      setReadingFile(false);
      setFileError("Choose a CSV smaller than 256 KB, containing at most 100 rows.");
      return;
    }
    setReadingFile(true);
    try {
      const contents = await file.text();
      if (sequence !== fileReadSequence.current) return;
      setSourceFileName(file.name);
      setCsv(contents);
      setHasSelectedFile(true);
    } catch {
      if (sequence === fileReadSequence.current)
        setFileError("The file could not be read. Choose it again.");
    } finally {
      if (sequence === fileReadSequence.current) setReadingFile(false);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await readFile(file);
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) await readFile(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actionBusy || readingFile || !csv.trim()) return;
    await onCreate({
      ...(run ? { importRunId: run.id } : {}),
      csv,
      importType,
      sourceFileName,
      sourceSystem
    });
  };

  return (
    <div className="migration-ops" data-testid="cp7-migration-operations">
      <section className="import-truth-strip" aria-label="Import readiness">
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

      <section className="import-stage" aria-labelledby="migration-stage-title">
        <div className="import-stage__main">
          <header className="import-stage__header">
            <div>
              <p className="eyebrow">Step {trialStepNumber(importType)} of 3</p>
              <h2 id="migration-stage-title">Add {recordLabel} data</h2>
              <p>
                Upload a ClinicOS CSV template. We validate every row before anything can be added.
              </p>
            </div>
            <span>Up to 100 rows</span>
          </header>

          {fixtureMode ? (
            <div className="inline-alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>Preview mode</strong>
                <span>Connect the local API and database to create a durable import.</span>
              </div>
            </div>
          ) : (
            <form className="migration-import-form import-form" onSubmit={handleSubmit}>
              {run && selectedBatch ? (
                <p role="status">
                  This step already has a saved file. An identical retry recovers it. To correct its
                  content, start a new run with the same import name.
                </p>
              ) : null}
              {fileError ? <p role="alert">{fileError}</p> : null}
              {readingFile ? <p role="status">Reading file…</p> : null}
              <div className="import-input-tabs" role="tablist" aria-label="How to add CSV data">
                <button
                  aria-controls="migration-file-panel"
                  aria-selected={inputMode === "file"}
                  data-testid="migration-input-tab-file"
                  onClick={() => setInputMode("file")}
                  role="tab"
                  type="button"
                >
                  <FileSpreadsheet size={16} strokeWidth={1.75} aria-hidden="true" />
                  Upload file
                </button>
                <button
                  aria-controls="migration-paste-panel"
                  aria-selected={inputMode === "paste"}
                  data-testid="migration-input-tab-paste"
                  onClick={() => setInputMode("paste")}
                  role="tab"
                  type="button"
                >
                  Paste CSV
                </button>
              </div>

              {inputMode === "file" ? (
                <div
                  aria-labelledby="migration-file-tab"
                  className="import-file-panel"
                  id="migration-file-panel"
                  role="tabpanel"
                >
                  <label
                    className="import-dropzone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void handleDrop(event)}
                  >
                    <UploadCloud size={28} strokeWidth={1.5} aria-hidden="true" />
                    <strong>{hasSelectedFile ? sourceFileName : "Drop your CSV here"}</strong>
                    <span>
                      {hasSelectedFile
                        ? "File loaded and ready to validate"
                        : "or choose a file from this device"}
                    </span>
                    <span className="import-dropzone__button">Choose CSV file</span>
                    <input
                      accept=".csv,text/csv"
                      className="sr-only"
                      data-testid="migration-file-input"
                      disabled={actionBusy}
                      onChange={(event) => void handleFile(event)}
                      type="file"
                    />
                  </label>
                  <a className="import-template-link" download={sourceFileName} href={templateHref}>
                    <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                    Download {recordLabel} template
                  </a>
                </div>
              ) : (
                <label
                  className="migration-import-form__csv import-paste-panel"
                  id="migration-paste-panel"
                  role="tabpanel"
                >
                  <span>Paste ClinicOS-formatted CSV</span>
                  <textarea
                    data-testid="migration-csv"
                    disabled={actionBusy}
                    onChange={(event) => {
                      fileReadSequence.current += 1;
                      setReadingFile(false);
                      setFileError(null);
                      setCsv(event.target.value);
                    }}
                    required
                    rows={8}
                    value={csv}
                  />
                  <small>
                    Use synthetic or explicitly approved clinic data. Appointment source is kept as
                    its own field and is never inferred.
                  </small>
                </label>
              )}

              <label className="import-name-field">
                <span>Import name</span>
                <input
                  data-testid="migration-source-system"
                  disabled={actionBusy || Boolean(run)}
                  maxLength={120}
                  onChange={(event) => setSourceSystem(event.target.value)}
                  placeholder="For example: Healthy Roots trial"
                  required
                  value={sourceSystem}
                />
                <small>Use the same name for patient, practitioner, and appointment steps.</small>
              </label>

              <details className="import-advanced">
                <summary>Advanced options</summary>
                <div>
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
                    <span>Source file name</span>
                    <input
                      disabled={actionBusy}
                      maxLength={240}
                      onChange={(event) => setSourceFileName(event.target.value)}
                      value={sourceFileName}
                    />
                  </label>
                </div>
              </details>

              <div className="surface-actions migration-import-form__actions">
                <Button
                  data-testid="migration-stage-batch"
                  disabled={actionBusy || readingFile || !sourceSystem.trim() || !csv.trim()}
                  icon={<FileUp size={16} />}
                  type="submit"
                >
                  Validate file
                </Button>
                <Button
                  disabled={actionBusy}
                  onClick={() => {
                    fileReadSequence.current += 1;
                    setReadingFile(false);
                    setFileError(null);
                    setCsv(run ? "" : template);
                    setHasSelectedFile(false);
                  }}
                  type="button"
                  variant="ghost"
                >
                  {run ? "Clear input" : "Reset template"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <aside className="import-preflight" aria-labelledby="import-preflight-title">
          <ShieldCheck size={21} strokeWidth={1.6} aria-hidden="true" />
          <h3 id="import-preflight-title">Before you continue</h3>
          <ul>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" />
              CSV format only
            </li>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" />
              Maximum 100 rows
            </li>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" />
              Duplicates are flagged for review
            </li>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" />
              Nothing changes until you commit
            </li>
          </ul>
          <p>
            This is a manual import. ClinicOS is not connected to Practo and does not write back to
            it.
          </p>
        </aside>
      </section>

      {selectedBatch ? (
        <section className="import-review-panel" aria-labelledby="migration-review-title">
          <header className="import-review-panel__header">
            <div>
              <p className="eyebrow">Review before commit</p>
              <h2 id="migration-review-title">Validated import</h2>
              <p>Resolve flagged rows, then commit only the records marked ready.</p>
            </div>
            <Button
              aria-label="Refresh import review"
              disabled={actionBusy}
              icon={<RefreshCw size={16} />}
              onClick={() => void onRefresh()}
              size="sm"
              variant="secondary"
            >
              Refresh
            </Button>
          </header>
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
        </section>
      ) : (
        <section className="import-review-empty">
          <FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden="true" />
          <strong>Your validated rows will appear here.</strong>
          <span>Upload a file to begin the review.</span>
        </section>
      )}

      <details className="import-history">
        <summary>
          <span>{run ? "Files in this run" : "Import history"}</span>
          <span>
            {filteredBatches.length} file{filteredBatches.length === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="import-history__controls">
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
            variant="ghost"
          >
            Refresh
          </Button>
        </div>
        {filteredBatches.length === 0 ? (
          <div className="empty-state">
            <span>No import runs match this state.</span>
          </div>
        ) : (
          <div className="migration-run-list" aria-label="Import runs">
            {filteredBatches.map((batch) => (
              <button
                className={
                  batch.id === selectedBatch?.id
                    ? "migration-run-card migration-run-card--active"
                    : "migration-run-card"
                }
                key={batch.id}
                onClick={() => {
                  if (run) handleImportTypeChange(batch.importType);
                  onSelectBatch(batch.id);
                }}
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
        )}
      </details>
    </div>
  );
}

function operatorRecordLabel(importType: MigrationImportType) {
  if (importType === "patients") return "patient";
  if (importType === "practitioners") return "practitioner";
  return "appointment";
}

function trialStepNumber(importType: MigrationImportType) {
  if (importType === "patients") return 1;
  if (importType === "practitioners") return 2;
  return 3;
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
  const openConflictsByRow = new Map<string, MigrationConflict[]>();
  for (const conflict of batch.conflicts) {
    if (conflict.status !== "unresolved") continue;
    openConflictsByRow.set(conflict.rowId, [
      ...(openConflictsByRow.get(conflict.rowId) ?? []),
      conflict
    ]);
  }

  return (
    <div className="migration-batch-detail import-review" data-testid="migration-selected-batch">
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

      {batch.conflictsTruncated ? (
        <p role="status">
          The batch summary is shortened. Review the conflicts shown with each row.
        </p>
      ) : null}
      <div className="cp7-card-list import-review__rows" aria-label="Validated import rows">
        {batch.rows.map((row) => {
          const conflicts = openConflictsByRow.get(row.id) ?? [];
          const conflict = conflicts[0];
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
                  conflicts={conflicts}
                  eligibleDoctors={eligibleDoctors}
                  fixtureMode={fixtureMode}
                  onResolve={onResolve}
                  row={row}
                  setTargetRecordIds={setTargetRecordIds}
                  targetRecordId={targetRecordIds[row.id] ?? ""}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <aside className="activation-card migration-batch-actions import-commit-gate">
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
  conflicts,
  eligibleDoctors,
  fixtureMode,
  onResolve,
  row,
  setTargetRecordIds,
  targetRecordId
}: {
  actionBusy: boolean;
  batch: MigrationBatch;
  conflicts: MigrationConflict[];
  eligibleDoctors: EligibleClinicDoctor[];
  fixtureMode: boolean;
  onResolve: MigrationOperationsPanelProps["onResolve"];
  row: MigrationRow;
  setTargetRecordIds: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)
  ) => void;
  targetRecordId: string;
}) {
  const conflict =
    conflicts.find((candidate) => candidate.targetRecordId === targetRecordId) ?? conflicts[0]!;
  const patientCandidates = [
    ...new Map(
      conflicts
        .filter(
          (candidate) =>
            candidate.targetRecordType === "patient" &&
            candidate.targetRecordId &&
            candidate.candidatePatient
        )
        .map((candidate) => [candidate.targetRecordId!, candidate])
    ).values()
  ];
  const targetRecordType =
    conflict.targetRecordType ?? (row.target === "practitioner" ? "provider_user" : row.target);
  const canCreate =
    row.target === "patient" &&
    !row.conflictsTruncated &&
    conflicts.every((candidate) => candidate.conflictType === "duplicate_patient");
  const canLink =
    row.target === "patient"
      ? patientCandidates.length > 0
      : row.target === "practitioner" || Boolean(conflict.targetRecordId);
  const validSelection =
    row.target === "patient"
      ? patientCandidates.some((candidate) => candidate.targetRecordId === targetRecordId)
      : row.target === "practitioner"
        ? eligibleDoctors.some((doctor) => doctor.providerUserId === targetRecordId)
        : Boolean(targetRecordId && targetRecordId === conflict.targetRecordId);

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
      {conflicts.map((candidate) => (
        <p key={candidate.id}>{candidate.candidateSummary}</p>
      ))}
      {row.conflictsTruncated ? (
        <p role="status">
          Only part of this row&apos;s conflict list is available. Confirm identity before linking a
          listed record, or skip and narrow the source data before staging again. Creating a
          separate patient is blocked until all matches can be reviewed.
        </p>
      ) : null}
      {canLink ? (
        <label>
          <span>
            {row.target === "practitioner"
              ? "Eligible ClinicOS doctor"
              : row.target === "patient"
                ? "Existing ClinicOS patient"
                : "Existing " + row.target + " ID"}
          </span>
          {row.target === "patient" ? (
            <>
              <select
                data-testid="migration-patient-candidate"
                disabled={actionBusy}
                value={targetRecordId}
                onChange={(event) =>
                  setTargetRecordIds((current) => ({ ...current, [row.id]: event.target.value }))
                }
              >
                <option value="">Select a patient after checking their identity</option>
                {patientCandidates.map((candidate) => (
                  <option key={candidate.targetRecordId} value={candidate.targetRecordId!}>
                    {candidate.candidatePatient!.fullName} ·{" "}
                    {candidate.candidatePatient!.phone ?? "No phone recorded"}
                  </option>
                ))}
              </select>
              <small>
                Names and contact details are matching evidence, not proof of identity. Confirm with
                clinic records before linking. If the candidates cannot be distinguished, skip this
                row for further review.
              </small>
            </>
          ) : row.target === "practitioner" ? (
            <>
              <select
                data-testid="migration-eligible-doctor"
                disabled={actionBusy || eligibleDoctors.length === 0}
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
              disabled={actionBusy}
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
          {row.target === "patient"
            ? "Readable candidate identity is unavailable for this older batch. Skip this row and stage it again to review current matches."
            : "Correct the missing patient, practitioner, type, or chair mapping and stage a new appointment batch. A generic action cannot bypass dependency checks."}
        </small>
      )}
      <div className="surface-actions">
        {canLink ? (
          <Button
            data-testid="cp7-resolve-migration-conflict"
            disabled={actionBusy || !validSelection}
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
    <section className="migration-trial-guide" aria-labelledby="migration-trial-title">
      <header className="migration-trial-guide__header">
        <div>
          <p className="eyebrow">Guided clinic trial</p>
          <h2 id="migration-trial-title">Build one working appointment</h2>
          <p>Import in this order so ClinicOS can connect each record safely.</p>
        </div>
        <span>{sourceSystem.trim() || "Name this import"}</span>
      </header>
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
                variant={importType === step.importType ? "primary" : "ghost"}
              >
                {importType === step.importType ? "Current step" : "Open step"}
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
