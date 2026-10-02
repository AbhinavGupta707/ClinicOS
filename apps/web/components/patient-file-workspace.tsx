"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@clinic-os/ui";
import {
  ClinicOsApiError,
  type ClinicOsApiClient,
  type GetPatientImportFileResponse
} from "@clinic-os/api-client-generated";
import {
  patientFileChunks,
  preparePatientFile,
  type PreparedPatientFile
} from "@/lib/practo-patient-file";
import {
  normalizeLiveMigrationBatch,
  resolveLiveMigrationConflict,
  rollbackLiveMigrationBatch,
  type MigrationBatch
} from "@/lib/cp7-integration-ops";
import { patientFileRequest } from "@/lib/patient-file-request";
import {
  PATIENT_CONTEXT_PROFILE,
  PATIENT_SOURCE_FIELDS,
  type PatientImportProfile
} from "@clinic-os/domain/patient-source-context";
import { PRACTO_PATIENT_EXCLUDED_HEADERS } from "@/lib/practo-patient-import";
import { MigrationOperationsPanel } from "./migration-operations-panel";

type FileDetail = GetPatientImportFileResponse["file"];
export function PatientFileWorkspace({
  client,
  runId,
  initialFile,
  onBusy,
  externalBusy
}: {
  client: ClinicOsApiClient;
  runId: string;
  initialFile: FileDetail | null;
  onBusy: (busy: boolean) => void;
  externalBusy: boolean;
}) {
  const [profile, setProfile] = useState<PatientImportProfile>(
    initialFile?.profile ?? "practo_ray_patients_v1"
  );
  const withContext = profile === PATIENT_CONTEXT_PROFILE;
  const [file, setFile] = useState<FileDetail | null>(initialFile);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedPatientFile | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [commitAccepted, setCommitAccepted] = useState(false);
  const [working, setBusy] = useState(false);
  const busy = working || externalBusy;
  const [phase, setPhase] = useState<"prepare" | "upload" | "commit" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<MigrationBatch | null>(null);
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);
  const active = useRef(false),
    mounted = useRef(true),
    pause = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pause.current = true;
      controller.current?.abort();
    };
  }, []);

  const request = <T,>(operation: () => Promise<T>) =>
    patientFileRequest(operation, {
      signal: controller.current?.signal,
      onWait: (seconds) => {
        if (mounted.current)
          setNotice(
            `Server is pacing the import. Waiting ${seconds} seconds, then resuming this group. Saved progress is retained.`
          );
      }
    });
  const refresh = async () => {
    try {
      const result = await request(() => client.getPatientImportFile({ path: { runId } }));
      if (mounted.current) setFile(result.file);
      return result.file;
    } catch (cause) {
      // Never continue using stale counters after an uncertain write.
      if (mounted.current) {
        setFile(null);
        setSelected(null);
      }
      throw cause;
    }
  };
  const loadChunk = async (batchId: string, ordinal: number) => {
    const result = normalizeLiveMigrationBatch(
      await request(() => client.getMigrationBatch({ path: { batchId } }))
    );
    if (!result) throw new Error("The review group could not be read safely.");
    if (mounted.current) {
      setSelected(result);
      setSelectedOrdinal(ordinal);
    }
  };
  const run = async (action: () => Promise<void>, recover = true) => {
    if (active.current) return;
    active.current = true;
    pause.current = false;
    controller.current = new AbortController();
    setBusy(true);
    onBusy(true);
    setError(false);
    setCommitAccepted(false);
    try {
      await action();
    } catch (cause) {
      if (!mounted.current) return;
      let recovered = false;
      if (recover) {
        try {
          await refresh();
          recovered = true;
        } catch {
          /* Explicit unavailable state below. */
        }
      }
      setError(true);
      const message =
        cause instanceof ClinicOsApiError
          ? cause.status < 500
            ? cause.message
            : "The server response could not be confirmed."
          : cause instanceof Error
            ? cause.message
            : "The operation could not be confirmed.";
      setNotice(
        `${message}${recover ? (recovered ? " Saved progress has been reloaded. Review it before retrying." : " Saved progress is unavailable. Refresh before continuing; a request may have succeeded.") : " No rows were sent."}`
      );
    } finally {
      active.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
        setPhase(null);
      }
    }
  };
  const choose = async (value: File) => {
    setPrepared(null);
    setLocalFile(null);
    setAccepted(false);
    setSelected(null);
    await run(async () => {
      setPhase("prepare");
      setNotice("Checking the complete file locally…");
      const result = await preparePatientFile(
        value,
        (count) => {
          if (mounted.current) setNotice(`Checking locally: ${count.toLocaleString()} patients…`);
        },
        controller.current?.signal,
        profile
      );
      if (
        file &&
        (file.profile !== result.manifest.profile ||
          file.rowCount !== result.manifest.rowCount ||
          file.chunks.some(
            (chunk, index) => chunk.digest !== result.manifest.chunks[index]?.digest
          ))
      )
        throw new Error(
          "This is not the mapped file saved in this run. Reselect the original file or start a new run."
        );
      if (mounted.current) {
        setLocalFile(value);
        setPrepared(result);
        setNotice(
          `${result.manifest.rowCount.toLocaleString()} patients checked locally. Review the field scope before uploading.`
        );
      }
    }, false);
  };
  const upload = () =>
    run(async () => {
      if (!localFile || !prepared || !accepted) return;
      setPhase("upload");
      setSelected(null);
      const saved = await request(() =>
        client.createPatientImportFile({
          path: { runId },
          headers: { "idempotency-key": `${runId}:file` },
          body: prepared.manifest
        })
      );
      if (mounted.current) setFile(saved.file);
      // Never use a cached mutation response to decide which chunks remain.
      const current = await refresh();
      for await (const chunk of patientFileChunks(
        localFile,
        controller.current?.signal,
        prepared.manifest.profile
      )) {
        if (pause.current || !mounted.current) break;
        if (chunk.digest !== prepared.manifest.chunks[chunk.ordinal]?.digest)
          throw new Error("The mapped file changed during upload. This run cannot be finalized.");
        if (current.chunks[chunk.ordinal]?.batchId) continue;
        const result = await request(() =>
          client.stagePatientImportChunk({
            path: { runId, ordinal: String(chunk.ordinal) },
            headers: { "idempotency-key": `${runId}:chunk:${chunk.ordinal}` },
            body: { csv: chunk.csv }
          })
        );
        if (mounted.current) {
          setFile(result.file);
          setNotice(
            `Received ${result.file.received.toLocaleString()} of ${result.file.rowCount.toLocaleString()} patients.`
          );
        }
      }
      if (!mounted.current) return;
      if (pause.current) {
        await refresh();
        setNotice("Upload paused. Saved parts are retained; resume with the same file.");
        return;
      }
      await request(() =>
        client.sealPatientImportFile({
          path: { runId },
          headers: { "idempotency-key": `${runId}:seal` },
          body: {}
        })
      );
      const final = await refresh();
      setPrepared(null);
      setLocalFile(null);
      setAccepted(false);
      setNotice(
        `All ${final.rowCount.toLocaleString()} records received. Review exceptions and counts before committing.`
      );
    });
  const commit = () =>
    run(async () => {
      if (!commitAccepted) return;
      setPhase("commit");
      let current = await refresh();
      if (
        !current.sealed ||
        current.chunks.some((chunk) => chunk.needsReview || chunk.failed || chunk.rolledBack)
      )
        throw new Error(
          "Resolve all conflicts before committing. Failed or rolled-back records require a separately reviewed run."
        );
      for (const chunk of current.chunks) {
        if (pause.current || !mounted.current) break;
        if (!chunk.batchId || !chunk.ready) continue;
        await request(() =>
          client.commitMigrationBatch({
            path: { batchId: chunk.batchId! },
            headers: { "idempotency-key": `${runId}:commit:${chunk.ordinal}` },
            body: {}
          })
        );
        current = await refresh();
        if (mounted.current)
          setNotice(
            `Committed ${current.chunks.reduce((sum, item) => sum + item.committed, 0).toLocaleString()} of ${current.rowCount.toLocaleString()} source records.`
          );
        if (current.chunks.some((item) => item.failed || item.needsReview))
          throw new Error(
            "Processing stopped on an exception. Review saved results before continuing."
          );
      }
      if (!mounted.current) return;
      setSelected(null);
      setNotice(
        pause.current
          ? "Commit paused after the current group. Already committed patients are retained."
          : "Processing finished. Check committed and excluded counts below, then verify patients in Patients."
      );
    });
  const totals = (file?.chunks ?? []).reduce(
    (sum, chunk) => ({
      ready: sum.ready + chunk.ready,
      needsReview: sum.needsReview + chunk.needsReview,
      invalid: sum.invalid + chunk.invalid,
      skipped: sum.skipped + chunk.skipped,
      committed: sum.committed + chunk.committed,
      reconciled: sum.reconciled + chunk.reconciled,
      failed: sum.failed + chunk.failed,
      rolledBack: sum.rolledBack + chunk.rolledBack
    }),
    {
      ready: 0,
      needsReview: 0,
      invalid: 0,
      skipped: 0,
      committed: 0,
      reconciled: 0,
      failed: 0,
      rolledBack: 0
    }
  );

  return (
    <section
      className="surface-stack"
      aria-label="Whole patient file"
      data-testid="patient-file-workspace"
    >
      <h2>Practo patient file · up to 5,000 patients</h2>
      <p>
        Upload one CSV, up to 25 MiB. ClinicOS saves small groups automatically. Keep this page open
        while uploading or committing. Closing it pauses further work; reopen this saved run to
        continue.
      </p>
      <label>
        Patient import profile
        <select
          data-testid="patient-file-profile"
          style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
          value={profile}
          disabled={busy || !!file}
          onChange={(event) => {
            setProfile(event.target.value as PatientImportProfile);
            setLocalFile(null);
            setPrepared(null);
            setAccepted(false);
            setCommitAccepted(false);
          }}
        >
          <option value="practo_ray_patients_v1">Demographics only (v1)</option>
          <option value={PATIENT_CONTEXT_PROFILE}>
            Demographics and historical source context (v2)
          </option>
        </select>
      </label>
      <p>
        Mapped demographics: Patient Number, name, primary mobile, email, date of birth and gender.
        Appointments are a separate workflow.
      </p>
      {withContext ? (
        <>
          <p>
            Retained as unverified historical text: {PATIENT_SOURCE_FIELDS.join(", ")}. Missing
            primary mobile is allowed and recorded; alternate contacts are not substituted or
            enabled for messaging. Historical fields are not current diagnoses, allergies or signed
            notes.
          </p>
          <p>
            Excluded: National Id, Age, Anniversary Date. No date of birth is inferred from age.
          </p>
          <p>
            <strong>
              Committing retains immutable clinical source evidence. These patients and source links
              cannot be removed by generic import rollback, even before clinical review.
            </strong>{" "}
            Review the selected file and identity decisions before committing.
          </p>
        </>
      ) : (
        <p>Excluded source columns: {PRACTO_PATIENT_EXCLUDED_HEADERS.join(", ")}.</p>
      )}
      <p>
        This is a manual export import. Source freshness and completeness of the clinic export
        remain unverified. No messages are sent to patients.
      </p>
      {notice ? (
        <p role={error ? "alert" : "status"} data-testid="patient-file-notice">
          {notice}
        </p>
      ) : null}
      {!file?.sealed ? (
        <>
          <label>
            Original patient CSV
            <input
              data-testid="patient-file-input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(event) => {
                const value = event.target.files?.[0];
                event.target.value = "";
                if (value) void choose(value);
              }}
            />
          </label>
          {prepared ? (
            <div data-testid="patient-file-preview">
              <p>
                {prepared.manifest.rowCount.toLocaleString()} patients ·{" "}
                {prepared.manifest.chunks.length} processing groups. Nothing has been committed.
              </p>
              <p>
                Excluded fields with values:{" "}
                {prepared.excludedFieldsWithValues.join(", ") || "none"}.
              </p>
              <label>
                <input
                  type="checkbox"
                  data-testid="patient-file-accept"
                  disabled={busy}
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />{" "}
                I understand the supported fields and exclusions.
              </label>
              <Button
                data-testid="patient-file-upload"
                disabled={busy || !accepted}
                onClick={() => void upload()}
              >
                Upload / resume file
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="surface-actions">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await refresh();
              setSelected(null);
              setNotice("Saved progress refreshed.");
            })
          }
        >
          Refresh file progress
        </Button>
        {working && (phase === "upload" || phase === "commit") ? (
          <Button
            variant="secondary"
            onClick={() => {
              pause.current = true;
              setNotice("Pausing after the current request. Its result will be checked.");
            }}
          >
            Pause after current group
          </Button>
        ) : null}
      </div>
      {file ? (
        <>
          <section
            className="import-run-summary"
            aria-label="Whole file reconciliation"
            data-testid="patient-file-summary"
          >
            <h3>{file.sealed ? "Complete file received" : "Upload incomplete — commit blocked"}</h3>
            <dl>
              {Object.entries({
                Expected: file.rowCount,
                Received: file.received,
                Ready: totals.ready,
                "Needs review": totals.needsReview,
                Invalid: totals.invalid,
                Skipped: totals.skipped,
                Committed: totals.committed,
                Failed: totals.failed,
                "Rolled back": totals.rolledBack
              }).map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <p>
              {totals.reconciled} committed records reconciled with existing patients. Committed
              counts are not a count of newly created patients. Invalid, skipped, failed and
              rolled-back rows have not been successfully migrated.
            </p>
          </section>
          <label>
            Review patient group
            <select
              data-testid="patient-file-group"
              style={{ display: "block", width: "100%", maxWidth: "100%", minWidth: 0 }}
              value={selectedOrdinal ?? ""}
              disabled={busy || !file.sealed}
              onChange={(event) => {
                if (event.target.value === "") {
                  setSelected(null);
                  setSelectedOrdinal(null);
                  return;
                }
                const ordinal = Number(event.target.value);
                const chunk = file.chunks[ordinal];
                if (event.target.value !== "" && chunk?.batchId)
                  void run(async () => {
                    await loadChunk(chunk.batchId!, ordinal);
                    setNotice("");
                  });
              }}
            >
              <option value="">Choose records to review</option>
              {file.chunks
                .filter((chunk) => chunk.batchId)
                .map((chunk) => (
                  <option key={chunk.ordinal} value={chunk.ordinal}>
                    Records{" "}
                    {file.chunks
                      .slice(0, chunk.ordinal)
                      .reduce((sum, item) => sum + item.rowCount, 0) + 1}
                    –
                    {file.chunks
                      .slice(0, chunk.ordinal + 1)
                      .reduce((sum, item) => sum + item.rowCount, 0)}
                    : {chunk.needsReview} review, {chunk.invalid} invalid, {chunk.committed}{" "}
                    committed
                  </option>
                ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              data-testid="patient-file-commit-accept"
              disabled={busy || !file.sealed}
              checked={commitAccepted}
              onChange={(event) => setCommitAccepted(event.target.checked)}
            />{" "}
            I reviewed the counts and exclusions and approve committing the ready patients.
          </label>
          <Button
            data-testid="patient-file-commit"
            disabled={
              busy ||
              !file.sealed ||
              !commitAccepted ||
              !totals.ready ||
              !!totals.needsReview ||
              !!totals.failed ||
              !!totals.rolledBack
            }
            onClick={() => void commit()}
          >
            Commit / resume reviewed patients
          </Button>
          <p>
            Each group commits separately. A pause or error can leave a partial import. Rollback is
            best-effort for unused, unchanged records; it is not a whole-file undo.
          </p>
        </>
      ) : null}
      {selected && file?.sealed ? (
        <MigrationOperationsPanel
          reviewOnly
          actionBusy={busy}
          batches={[selected]}
          eligibleDoctors={[]}
          fixtureMode={false}
          selectedBatchId={selected.id}
          onSelectBatch={() => undefined}
          onCreate={async () => {
            throw new Error("Use the patient file upload.");
          }}
          onRefresh={async () => {
            await run(async () => {
              await refresh();
              await loadChunk(selected.id, selectedOrdinal!);
            });
          }}
          onCommit={async () => {
            throw new Error("Use whole-file commit approval.");
          }}
          onResolve={async (batch, row, _conflict, input) => {
            await run(async () => {
              await resolveLiveMigrationConflict(batch.id, row.id, input);
              await refresh();
              await loadChunk(batch.id, selectedOrdinal!);
              setNotice("Review decision saved.");
            });
          }}
          onRollback={async (batch) => {
            await run(async () => {
              const result = await rollbackLiveMigrationBatch(batch.id);
              await refresh();
              await loadChunk(batch.id, selectedOrdinal!);
              setNotice(
                result.blockedCount
                  ? "Some records could not be rolled back because they changed or are in use."
                  : "Safe group rollback completed. Review the whole-file counts."
              );
            });
          }}
        />
      ) : null}
    </section>
  );
}
