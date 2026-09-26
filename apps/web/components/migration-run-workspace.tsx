"use client";

import { Button } from "@clinic-os/ui";
import { ClinicOsApiError, type ListImportRunsResponse } from "@clinic-os/api-client-generated";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCp13ApiClient } from "@/lib/cp13-api-client";
import {
  commitLiveMigrationBatch,
  createLiveMigrationBatch,
  resolveLiveMigrationConflict,
  rollbackLiveMigrationBatch,
  type EligibleClinicDoctor
} from "@/lib/cp7-integration-ops";
import {
  IMPORT_RUN_STATUS_LABELS,
  importRunStorageKey,
  loadImportRunWorkspace,
  readImportRunId,
  type ImportRunDetail
} from "@/lib/import-runs";
import type { MeProfile } from "@/lib/me";
import { MigrationOperationsPanel } from "./migration-operations-panel";

type Notice = { text: string; error?: boolean };

export function MigrationRunWorkspace({ profile }: { profile: MeProfile }) {
  const client = useMemo(() => createCp13ApiClient(profile.clinic.id), [profile.clinic.id]);
  const storageKey = importRunStorageKey(profile);
  const [runs, setRuns] = useState<ListImportRunsResponse["runs"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportRunDetail | null>(null);
  const [doctorsUnavailable, setDoctorsUnavailable] = useState(false);
  const [doctors, setDoctors] = useState<EligibleClinicDoctor[]>([]);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const currentId = useRef<string | null>(null);
  const pendingCreate = useRef<{ id: string; sourceSystem: string } | null>(null);

  const remember = useCallback(
    (id: string) => {
      currentId.current = id;
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        setStorageWarning(true);
      }
    },
    [storageKey]
  );

  const readRun = useCallback(
    async (id: string, token: number) => {
      const next = await loadImportRunWorkspace(client, id);
      if (generation.current !== token) return;
      setDetail(next.detail);
      setDoctors(next.doctors);
      setDoctorsUnavailable(next.doctorsUnavailable);
      setUnavailable(false);
    },
    [client]
  );

  const initialize = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const token = ++generation.current;
    try {
      const listing = await client.listImportRuns({ query: { limit: 25 } });
      if (generation.current !== token) return;
      setRuns(listing.runs);
      setCursor(listing.nextCursor);
      let saved: string | null = currentId.current;
      try {
        saved ??= readImportRunId(window.localStorage, storageKey);
      } catch {
        /* Storage may be disabled. */
      }
      if (saved) {
        currentId.current = saved;
        try {
          await readRun(saved, token);
        } catch (error) {
          if (!(error instanceof ClinicOsApiError && error.status === 404)) throw error;
          if (generation.current === token) {
            setDetail(null);
            setNotice({
              text: "The remembered run was not found in this clinic. Choose a saved run or start a new one."
            });
          }
        }
      }
      if (generation.current === token) setUnavailable(false);
    } catch {
      if (generation.current === token) {
        setUnavailable(true);
        setDetail(null);
      }
    } finally {
      if (generation.current === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [client, readRun, storageKey]);

  useEffect(() => {
    void initialize();
    return () => {
      generation.current += 1;
      busyRef.current = false;
    };
  }, [initialize]);

  const selectRun = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setDetail(null);
    const token = ++generation.current;
    remember(id);
    pendingCreate.current = null;
    try {
      await readRun(id, token);
    } catch {
      if (generation.current === token) setUnavailable(true);
    } finally {
      if (generation.current === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const mutate = async (id: string, action: () => Promise<string>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const token = ++generation.current;
    try {
      const text = await action();
      await readRun(id, token);
      if (generation.current === token) setNotice({ text });
    } catch (error) {
      try {
        await readRun(id, token);
        if (generation.current === token)
          setNotice({
            error: true,
            text:
              error instanceof ClinicOsApiError && error.status >= 400 && error.status < 500
                ? `${error.message} Saved progress has been reloaded; review it before retrying.`
                : "The response could not be confirmed. Saved progress has been reloaded; review it before retrying."
          });
      } catch {
        if (generation.current === token) {
          setDetail(null);
          setUnavailable(true);
          setNotice({
            error: true,
            text: "The result could not be confirmed and saved progress is unavailable. Refresh before retrying; the request may have succeeded."
          });
        }
      }
    } finally {
      if (generation.current === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const createRun = async () => {
    if (busyRef.current || !source.trim()) return;
    const request =
      pendingCreate.current?.sourceSystem === source.trim()
        ? pendingCreate.current
        : { id: crypto.randomUUID(), sourceSystem: source.trim() };
    pendingCreate.current = request;
    remember(request.id);
    setDetail(null);
    await mutate(request.id, async () => {
      const result = await client.createImportRun({
        headers: { "idempotency-key": request.id },
        body: request
      });
      setRuns((existing) => [result.run, ...existing.filter((run) => run.id !== result.run.id)]);
      pendingCreate.current = null;
      return "Run saved. Add patients first, then map practitioners and add appointments.";
    });
  };

  const loadOlder = async () => {
    if (busyRef.current || !cursor) return;
    busyRef.current = true;
    setBusy(true);
    const token = generation.current;
    try {
      const page = await client.listImportRuns({ query: { limit: 25, cursor } });
      if (generation.current !== token) return;
      setRuns((existing) => [
        ...existing,
        ...page.runs.filter((run) => !existing.some((item) => item.id === run.id))
      ]);
      setCursor(page.nextCursor);
    } catch {
      if (generation.current === token)
        setNotice({ error: true, text: "Older runs could not be loaded. Try again." });
    } finally {
      if (generation.current === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <div data-testid="cp7-integration-ops-workspace" className="surface-stack cp7-workflow">
      <section className="import-page-hero">
        <div>
          <p className="eyebrow">Manual clinic onboarding</p>
          <h1>Import clinic data</h1>
          <p>Save a run, review each file, then confirm the imported appointments in Today.</p>
          <p>ClinicOS-formatted CSV only. Practo is not connected. No source-system writeback.</p>
        </div>
        <span aria-label="Workflow API mode">Live boundary</span>
      </section>
      <section className="import-run-controls" aria-label="Import runs">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createRun();
          }}
        >
          <label>
            Import name
            <input
              data-testid="migration-new-source-system"
              value={source}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setSource(event.target.value)}
              required
              placeholder="For example: Healthy Roots manual"
            />
          </label>
          <p>
            Use the same name for repeat exports from the same source. Each run accepts one file per
            step, up to 100 rows per file. Correct a saved file in a new run.
          </p>
          <Button
            data-testid="migration-create-run"
            type="submit"
            disabled={busy || !source.trim()}
          >
            Start new run
          </Button>
        </form>
        <div>
          <label>
            Saved runs
            <select
              aria-label="Saved runs"
              data-testid="migration-run-selector"
              disabled={busy}
              value={detail?.run.id ?? ""}
              onChange={(event) => {
                if (event.target.value) void selectRun(event.target.value);
              }}
            >
              <option value="">Choose a saved run</option>
              {detail && !runs.some((run) => run.id === detail.run.id) ? (
                <option value={detail.run.id}>
                  {detail.run.sourceSystem} · {new Date(detail.run.createdAt).toLocaleString()}
                </option>
              ) : null}
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.sourceSystem} · {new Date(run.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {cursor ? (
            <Button variant="ghost" disabled={busy} onClick={() => void loadOlder()}>
              Load older runs
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => void initialize()}>
            Refresh saved progress
          </Button>
        </div>
      </section>
      {storageWarning ? (
        <p role="status">
          This browser cannot remember your selection. Your run is saved on the server; choose it
          from Saved runs when you return.
        </p>
      ) : null}
      {notice ? (
        <section
          className={`inline-alert inline-alert--${notice.error ? "error" : "success"}`}
          data-testid="cp7-action-message"
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </section>
      ) : null}
      {busy ? <p role="status">Loading saved import progress…</p> : null}
      {unavailable ? (
        <section role="alert">
          <h2>Saved import progress unavailable</h2>
          <p>No completion can be confirmed. Check the connection and refresh saved progress.</p>
        </section>
      ) : null}
      {detail && !unavailable ? (
        <>
          <section
            className="import-run-summary"
            data-testid="migration-run-summary"
            aria-label="Run reconciliation"
          >
            <h2>{IMPORT_RUN_STATUS_LABELS[detail.status]}</h2>
            <p>
              {detail.run.sourceSystem} · Run started{" "}
              {new Date(detail.run.createdAt).toLocaleString()}
            </p>
            <dl>
              {(
                [
                  ["Received", "received"],
                  ["Invalid", "invalid"],
                  ["Needs review", "needsReview"],
                  ["Ready", "ready"],
                  ["Committed", "committed"],
                  ["Skipped", "skipped"],
                  ["Rolled back", "rolledBack"],
                  ["Failed", "failed"]
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{detail.reconciliation[key]}</dd>
                </div>
              ))}
            </dl>
            <p>
              {detail.reconciliation.reconciled} committed row(s) reconciled with an existing
              record. Missing records and source freshness are unknown. This run does not prove the
              source export is complete.
            </p>
          </section>
          {doctorsUnavailable ? (
            <p role="alert">
              The doctor list is unavailable. Saved progress is visible, but mapping a practitioner
              is disabled until you refresh successfully.
            </p>
          ) : null}
          <MigrationOperationsPanel
            key={detail.run.id}
            run={detail.run}
            actionBusy={busy}
            batches={detail.batches}
            eligibleDoctors={doctors}
            fixtureMode={false}
            selectedBatchId={null}
            onSelectBatch={() => undefined}
            onRefresh={async () => {
              await selectRun(detail.run.id);
            }}
            onCreate={async (input) => {
              await mutate(detail.run.id, async () => {
                await createLiveMigrationBatch(input);
                return "File validated and staged. Review the saved rows before committing.";
              });
            }}
            onCommit={async (batch) => {
              await mutate(detail.run.id, async () => {
                await commitLiveMigrationBatch(batch.id);
                return "Reviewed rows were committed. Check the counts and remaining exceptions.";
              });
            }}
            onResolve={async (batch, row, conflict, input) => {
              await mutate(detail.run.id, async () => {
                await resolveLiveMigrationConflict(batch.id, row.id, input);
                return "Review decision saved.";
              });
            }}
            onRollback={async (batch) => {
              await mutate(detail.run.id, async () => {
                const result = await rollbackLiveMigrationBatch(batch.id);
                return result.blockedCount
                  ? `Rollback is incomplete: ${result.blockedCount} record(s) retained because they have changed or are still in use. Review the saved counts.`
                  : "Safe rollback completed. Review the saved counts.";
              });
            }}
          />
        </>
      ) : !busy && !unavailable ? (
        <p>Start a run or choose a saved run to continue. Existing files remain unchanged.</p>
      ) : null}
    </div>
  );
}
