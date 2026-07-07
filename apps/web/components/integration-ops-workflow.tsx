"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  CheckCircle2,
  DatabaseBackup,
  PlugZap,
  RadioTower,
  RotateCcw
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  applyFixtureCommitMigrationBatch,
  applyFixtureReplayDeadLetter,
  applyFixtureResolveMigrationConflict,
  CAPABILITY_STATUS_LABELS,
  classifyCp7EndpointFailures,
  commitLiveMigrationBatch,
  DEAD_LETTER_STATUS_LABELS,
  getOpenDeadLetterCount,
  getProviderStatusCount,
  getUnresolvedMigrationConflictCount,
  loadCp7IntegrationOps,
  MIGRATION_BATCH_STATUS_LABELS,
  PROVIDER_STATUS_LABELS,
  replayLiveDeadLetterEvent,
  resolveLiveMigrationConflict,
  type Cp7IntegrationOpsData,
  type Cp7IntegrationOpsLoadState,
  type Cp7IntegrationOpsProblem,
  type DeadLetterEvent,
  type MigrationBatch,
  type ProviderHealthCard
} from "@/lib/cp7-integration-ops";
import type { MeProfile } from "@/lib/me";

interface IntegrationOpsWorkflowProps {
  activeSurfaceId: string;
  profile: MeProfile;
}

type Cp7Mode = "migration" | "providers" | "replay";
type ActionMessage = { text: string; tone: "error" | "info" | "success" };

const CP7_SURFACES = new Set(["event-replay", "integrations", "migration-review"]);

const MODE_ITEMS: Array<{ icon: typeof RadioTower; id: Cp7Mode; label: string }> = [
  { icon: RadioTower, id: "providers", label: "Providers" },
  { icon: RotateCcw, id: "replay", label: "Replay" },
  { icon: DatabaseBackup, id: "migration", label: "Migration" }
];

export function isCp7WorkflowSurface(surfaceId: string) {
  return CP7_SURFACES.has(surfaceId);
}

export function IntegrationOpsWorkflow({ activeSurfaceId, profile }: IntegrationOpsWorkflowProps) {
  const [loadState, setLoadState] = useState<Cp7IntegrationOpsLoadState | { status: "loading" }>({
    status: "loading"
  });
  const [mode, setMode] = useState<Cp7Mode>(() => modeForSurface(activeSurfaceId));
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

  useEffect(() => {
    setMode(modeForSurface(activeSurfaceId));
  }, [activeSurfaceId]);

  useEffect(() => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp7IntegrationOps(controller.signal)
      .then(setLoadState)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;

        setLoadState({
          problem: classifyCp7EndpointFailures([
            {
              endpoint: "FETCH /v1/provider-health",
              message: error instanceof Error ? error.message : "Unable to load CP7 integration ops",
              status: 0
            }
          ]),
          status: "unavailable"
        });
      });

    return () => controller.abort();
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  const primaryDeadLetter = useMemo(
    () => data?.deadLetters.find((event) => event.replayAvailable) ?? data?.deadLetters[0] ?? null,
    [data]
  );
  const primaryBatch = data?.migrationBatches[0] ?? null;

  const updateFixtureData = (nextData: Cp7IntegrationOpsData) => {
    setLoadState({ data: nextData, status: "ready" });
  };

  const handleReplayDeadLetter = async (event: DeadLetterEvent) => {
    if (!data) return;

    setActionBusy(true);
    setActionMessage(null);
    try {
      if (data.source === "cp7_fixture") {
        updateFixtureData(
          applyFixtureReplayDeadLetter(data, {
            actorName: profile.user.displayName,
            deadLetterEventId: event.id,
            reason: "Operator reviewed failed provider event in CP7 fixture."
          })
        );
        setActionMessage({
          text: "Fixture replay was recorded for review. No provider-confirmed completion state was created.",
          tone: "success"
        });
      } else {
        await replayLiveDeadLetterEvent(event.id, {
          actorName: profile.user.displayName,
          reason: "Operator reviewed failed provider event from CP7 integration ops."
        });
        setActionMessage({
          text: "Replay request was sent to the CP7 API boundary; wait for handler evidence before changing provider state.",
          tone: "info"
        });
      }
    } catch (error) {
      setActionMessage({
        text: error instanceof Error ? error.message : "Replay request failed.",
        tone: "error"
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleResolveConflict = async (batch: MigrationBatch) => {
    if (!data) return;
    const conflict = batch.conflicts.find((item) => item.status === "unresolved");
    if (!conflict) return;

    setActionBusy(true);
    setActionMessage(null);
    try {
      if (data.source === "cp7_fixture") {
        updateFixtureData(
          applyFixtureResolveMigrationConflict(data, {
            actorName: profile.user.displayName,
            batchId: batch.id,
            conflictId: conflict.id,
            resolution: "keep_existing_verified_record"
          })
        );
        setActionMessage({
          text: "Duplicate review resolved by keeping the verified ClinicOS record.",
          tone: "success"
        });
      } else {
        await resolveLiveMigrationConflict(batch.id, conflict.id, {
          actorName: profile.user.displayName,
          notes: "Keep existing verified ClinicOS record; import row stays unverified/history only.",
          resolution: "keep_existing_verified_record"
        });
        setActionMessage({
          text: "Migration conflict resolution was sent to the CP7 API boundary.",
          tone: "info"
        });
      }
    } catch (error) {
      setActionMessage({
        text: error instanceof Error ? error.message : "Migration conflict resolution failed.",
        tone: "error"
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleCommitBatch = async (batch: MigrationBatch) => {
    if (!data) return;

    setActionBusy(true);
    setActionMessage(null);
    try {
      if (data.source === "cp7_fixture") {
        const committed = applyFixtureCommitMigrationBatch(data, {
          actorName: profile.user.displayName,
          batchId: batch.id
        });
        updateFixtureData(committed);
        const updatedBatch =
          committed.migrationBatches.find((candidate) => candidate.id === batch.id) ?? batch;
        setActionMessage({
          text: `${updatedBatch.commit.committedRows} reviewed rows committed in fixture mode; rejected rows stayed out.`,
          tone: "success"
        });
      } else {
        await commitLiveMigrationBatch(batch.id, {
          actorName: profile.user.displayName
        });
        setActionMessage({
          text: "Migration commit request was sent to the CP7 API boundary for reviewed rows only.",
          tone: "info"
        });
      }
    } catch (error) {
      setActionMessage({
        text: error instanceof Error ? error.message : "Migration commit failed.",
        tone: "error"
      });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div data-testid="cp7-integration-ops-workspace">
      <div className="surface-stack cp7-workflow" data-testid={`cp7-surface-${activeSurfaceId}`}>
        <section className="surface-hero surface-hero--integrations" aria-labelledby="cp7-title">
          <div>
            <p className="eyebrow">Live integration operations</p>
            <h1 id="cp7-title">{titleForSurface(activeSurfaceId)}</h1>
            <p className="hero-subline">{descriptionForSurface(activeSurfaceId)}</p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp7_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp7_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "unavailable" ? (
          <ProblemPanel problem={loadState.problem} />
        ) : (
          <>
            {loadState.data.source === "cp7_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP7 integration ops fixture"
                data-testid="cp7-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP7 fixture mode</strong>
                  <span>
                    Non-PHI provider, replay, and migration data is synthetic. It exercises review
                    and safety states without claiming live provider completion.
                  </span>
                </div>
              </section>
            ) : null}

            <ReadinessPanel data={loadState.data} />

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
                data-testid="cp7-action-message"
              >
                {actionMessage.tone === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {actionMessage.tone === "error" ? "Action failed" : "Workflow update"}
                  </strong>
                  <span>{actionMessage.text}</span>
                </div>
              </section>
            ) : null}

            <WorkflowTabs mode={mode} setMode={setMode} />

            {mode === "providers" ? <ProviderDashboard data={loadState.data} /> : null}
            {mode === "replay" ? (
              <ReplayPanel
                actionBusy={actionBusy}
                event={primaryDeadLetter}
                onReplay={handleReplayDeadLetter}
              />
            ) : null}
            {mode === "migration" ? (
              <MigrationReviewPanel
                actionBusy={actionBusy}
                batch={primaryBatch}
                onCommit={handleCommitBatch}
                onResolveConflict={handleResolveConflict}
              />
            ) : null}

            <TimelinePanel data={loadState.data} />
          </>
        )}
      </div>
    </div>
  );
}

function ReadinessPanel({ data }: { data: Cp7IntegrationOpsData }) {
  return (
    <section
      className="readiness-grid readiness-grid--cp7"
      aria-label="CP7 provider readiness"
      data-testid="cp7-provider-readiness"
    >
      <MetricCard
        label="WhatsApp"
        value="Configured/degraded"
        detail="Sandbox-capable only; verified callback still required."
      />
      <MetricCard label="Telephony" value="Unavailable" detail="Manual missed-call entry only." />
      <MetricCard
        label="Google"
        value="Manual/source only"
        detail="No Business Profile API dependency."
      />
      <MetricCard
        label="Razorpay"
        value="Webhook URL missing"
        detail="Payment state still waits for signed callback evidence."
      />
      <MetricCard
        label="Failed events"
        value={`${getOpenDeadLetterCount(data)} open`}
        detail={data.readiness.replay === "fixture_review_only" ? "Fixture review path" : "API path"}
      />
      <MetricCard
        label="Migration"
        value={`${getUnresolvedMigrationConflictCount(data)} conflicts`}
        detail={migrationReadinessLabel(data.readiness.migrationCommit)}
      />
    </section>
  );
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="workflow-metric cp7-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ProviderDashboard({ data }: { data: Cp7IntegrationOpsData }) {
  const degraded = getProviderStatusCount(data, "degraded");
  const unavailable = getProviderStatusCount(data, "unavailable");

  return (
    <section className="work-panel" aria-labelledby="cp7-provider-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp7-provider-title">Provider health and capabilities</h2>
          <p>
            Provider account status is shown before capability/debug work. Degraded or unavailable
            providers keep live actions disabled until official activation is complete.
          </p>
        </div>
        <div className="dashboard-flags" aria-label="Provider summary">
          <span>{degraded} degraded</span>
          <span>{unavailable} unavailable</span>
        </div>
      </div>

      <div className="cp7-card-list" data-testid="cp7-provider-dashboard">
        {data.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ provider }: { provider: ProviderHealthCard }) {
  return (
    <article className="cp7-card" data-testid={`cp7-provider-${provider.id}`}>
      <div className="cp7-card__heading">
        <div>
          <strong>{provider.label}</strong>
          <span>{provider.evidence}</span>
        </div>
        <span className={`state-pill cp7-status cp7-status--${provider.status}`}>
          {PROVIDER_STATUS_LABELS[provider.status]}
        </span>
      </div>
      <div className="detail-strip detail-strip--three">
        <div>
          <span>Mode</span>
          <strong>{provider.mode}</strong>
        </div>
        <div>
          <span>Category</span>
          <strong>{provider.category}</strong>
        </div>
        <div>
          <span>Checked</span>
          <strong>{provider.checkedAt}</strong>
        </div>
      </div>
      <div className="cp7-capabilities">
        {provider.capabilities.map((capability) => (
          <div key={capability.key} className="cp7-capability">
            <strong>{capability.label}</strong>
            <span>{CAPABILITY_STATUS_LABELS[capability.status]}</span>
            <small>{capability.detail}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function ReplayPanel({
  actionBusy,
  event,
  onReplay
}: {
  actionBusy: boolean;
  event: DeadLetterEvent | null;
  onReplay: (event: DeadLetterEvent) => void;
}) {
  if (!event) {
    return (
      <section className="work-panel" data-testid="cp7-dead-letter-replay">
        <EmptyState text="No failed provider events are available for review." />
      </section>
    );
  }

  return (
    <section className="work-panel" aria-labelledby="cp7-replay-title" data-testid="cp7-dead-letter-replay">
      <div className="panel-heading">
        <div>
          <h2 id="cp7-replay-title">Dead-letter replay review</h2>
          <p>
            Failed provider events can be replayed only as reviewed operations. Replay does not
            advance patient/provider state without handler evidence.
          </p>
        </div>
      </div>
      <div className="workflow-grid workflow-grid--cp7">
        <article className="cp7-card">
          <div className="cp7-card__heading">
            <div>
              <strong>{event.eventType}</strong>
              <span>{event.lastError}</span>
            </div>
            <span className="state-pill" data-testid="cp7-replay-status">
              {DEAD_LETTER_STATUS_LABELS[event.status]}
            </span>
          </div>
          <div className="detail-strip detail-strip--three">
            <div>
              <span>Provider</span>
              <strong>{event.providerKey}</strong>
            </div>
            <div>
              <span>Attempts</span>
              <strong>{event.attempts}</strong>
            </div>
            <div>
              <span>Failed at</span>
              <strong>{event.failedAt}</strong>
            </div>
          </div>
          <p className="cp7-card-note">{event.outcomeDetail}</p>
          {event.replayBlockedReason ? (
            <p className="cp7-card-note cp7-card-note--warn">{event.replayBlockedReason}</p>
          ) : null}
          <div className="surface-actions">
            <Button
              data-testid="cp7-replay-dead-letter"
              disabled={actionBusy || !event.replayAvailable || event.status === "replayed"}
              icon={<RotateCcw size={16} />}
              onClick={() => onReplay(event)}
              variant="secondary"
            >
              Replay reviewed event
            </Button>
          </div>
        </article>
        <section className="activation-card">
          <PlugZap size={20} aria-hidden="true" />
          <strong>Replay guardrails</strong>
          <p>
            Check registration and handler availability first. Permission/runtime debugging starts
            only after the dead-letter route and handler are present.
          </p>
        </section>
      </div>
    </section>
  );
}

function MigrationReviewPanel({
  actionBusy,
  batch,
  onCommit,
  onResolveConflict
}: {
  actionBusy: boolean;
  batch: MigrationBatch | null;
  onCommit: (batch: MigrationBatch) => void;
  onResolveConflict: (batch: MigrationBatch) => void;
}) {
  if (!batch) {
    return (
      <section className="work-panel" data-testid="cp7-migration-review">
        <EmptyState text="No migration batch is ready for review." />
      </section>
    );
  }

  const openConflict = batch.conflicts.find((conflict) => conflict.status === "unresolved");
  const commitReady = batch.commit.state === "ready";

  return (
    <section className="work-panel" aria-labelledby="cp7-migration-title" data-testid="cp7-migration-review">
      <div className="panel-heading">
        <div>
          <h2 id="cp7-migration-title">Migration review and commit</h2>
          <p>
            Imported rows are reviewed before commit. Bad rows stay out, duplicate candidates are
            resolved explicitly, and verified ClinicOS records are preserved.
          </p>
        </div>
        <span className="state-pill" data-testid="cp7-migration-status">
          {MIGRATION_BATCH_STATUS_LABELS[batch.status]}
        </span>
      </div>
      <div className="workflow-grid workflow-grid--cp7">
        <div className="cp7-card-list">
          {batch.rows.map((row) => (
            <article className="cp7-card cp7-card--compact" key={row.id}>
              <div className="cp7-card__heading">
                <div>
                  <strong>
                    Row {row.rowNumber}: {row.target}
                  </strong>
                  <span>{row.preview}</span>
                </div>
                <span className="state-pill">{row.status.replaceAll("_", " ")}</span>
              </div>
              {row.issue ? <p className="cp7-card-note">{row.issue}</p> : null}
            </article>
          ))}
        </div>
        <aside className="activation-card">
          <DatabaseBackup size={20} aria-hidden="true" />
          <strong>Commit gate</strong>
          <p>
            {batch.commit.state === "committed"
              ? `${batch.commit.committedRows} reviewed rows committed. Rejected rows were not imported.`
              : batch.commit.blockedReason ?? "Reviewed rows are ready to commit."}
          </p>
          {openConflict ? (
            <p>
              Conflict: {openConflict.candidateSummary} Resolution must be recorded before commit.
            </p>
          ) : null}
          <div className="surface-actions">
            <Button
              data-testid="cp7-resolve-migration-conflict"
              disabled={actionBusy || !openConflict}
              onClick={() => onResolveConflict(batch)}
              size="sm"
              variant="secondary"
            >
              Resolve duplicate
            </Button>
            <Button
              data-testid="cp7-commit-migration-batch"
              disabled={actionBusy || !commitReady}
              onClick={() => onCommit(batch)}
              size="sm"
            >
              Commit reviewed rows
            </Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function TimelinePanel({ data }: { data: Cp7IntegrationOpsData }) {
  return (
    <section className="work-panel" aria-labelledby="cp7-timeline-title" data-testid="cp7-timeline">
      <div className="panel-heading">
        <div>
          <h2 id="cp7-timeline-title">Evidence timeline</h2>
          <p>Fixture and live actions stay auditable and describe their provider assumptions.</p>
        </div>
      </div>
      <div className="timeline-list">
        {data.timeline.map((item) => (
          <article className="timeline-item" key={item.id}>
            <time>{item.at}</time>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
              <code>{item.kind}</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProblemPanel({ problem }: { problem: Cp7IntegrationOpsProblem }) {
  return (
    <section className="work-panel" data-testid="cp7-unavailable-state">
      <div className="panel-heading">
        <div>
          <h2>CP7 integration ops unavailable</h2>
          <p>{problem.message}</p>
        </div>
        <span className="state-pill">{problem.code}</span>
      </div>
      <div className="endpoint-table">
        <div className="endpoint-row endpoint-row--head">
          <span>Endpoint</span>
          <span>Status</span>
        </div>
        {problem.endpoints.map((endpoint) => (
          <div className="endpoint-row" key={`${endpoint.endpoint}-${endpoint.status ?? "n/a"}`}>
            <span>{endpoint.endpoint}</span>
            <span>
              {endpoint.status ?? "n/a"} - {endpoint.message}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkflowTabs({
  mode,
  setMode
}: {
  mode: Cp7Mode;
  setMode: (mode: Cp7Mode) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP7 integration ops views">
      {MODE_ITEMS.map((item) => {
        const Icon = item.icon;
        const selected = mode === item.id;

        return (
          <button
            aria-selected={selected}
            className={selected ? "workflow-tab workflow-tab--active" : "workflow-tab"}
            key={item.id}
            onClick={() => setMode(item.id)}
            role="tab"
            type="button"
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <RadioTower size={18} aria-hidden="true" />
        <span>Loading CP7 integration ops...</span>
      </div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>{text}</span>
    </div>
  );
}

function modeForSurface(surfaceId: string): Cp7Mode {
  if (surfaceId === "event-replay") return "replay";
  if (surfaceId === "migration-review") return "migration";

  return "providers";
}

function titleForSurface(surfaceId: string) {
  if (surfaceId === "event-replay") return "Failed event replay";
  if (surfaceId === "migration-review") return "Migration review";

  return "Provider health";
}

function descriptionForSurface(surfaceId: string) {
  if (surfaceId === "event-replay") {
    return "Review failed provider events and replay only through explicit, auditable routes.";
  }
  if (surfaceId === "migration-review") {
    return "Inspect import conflicts and commit only reviewed, non-overwriting migration rows.";
  }

  return "Inspect WhatsApp, telephony, Google/source, Razorpay, and import capabilities without fake live success states.";
}

function migrationReadinessLabel(readiness: Cp7IntegrationOpsData["readiness"]["migrationCommit"]) {
  if (readiness === "committed") return "Reviewed commit recorded";
  if (readiness === "ready_to_commit") return "Ready after duplicate review";

  return "Review required";
}
