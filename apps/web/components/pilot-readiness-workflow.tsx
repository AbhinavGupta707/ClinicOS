"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  RefreshCw
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  CP10_STATUS_LABELS,
  classifyCp10EndpointFailures,
  loadCp10PilotReadiness,
  type Cp10PilotReadinessItem,
  type Cp10PilotReadinessLoadState,
  type Cp10PilotReadinessPlan,
  type Cp10PilotReadinessProblem,
  type Cp10PilotReadinessStatus
} from "@/lib/cp10-pilot-readiness";

type PilotReadinessState = Cp10PilotReadinessLoadState | { status: "loading" };

const CP10_SURFACES = new Set(["pilot-readiness"]);

export function isCp10PilotReadinessSurface(surfaceId: string) {
  return CP10_SURFACES.has(surfaceId);
}

export function PilotReadinessWorkflow() {
  const [loadState, setLoadState] = useState<PilotReadinessState>({ status: "loading" });

  const load = () => {
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    void loadCp10PilotReadiness(controller.signal)
      .then(setLoadState)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState({
          problem: classifyCp10EndpointFailures([
            {
              endpoint: "FETCH /v1/pilot-readiness",
              message: error instanceof Error ? error.message : "Unable to load CP10 readiness",
              status: 0
            }
          ]),
          status: "unavailable"
        });
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, []);

  if (loadState.status === "loading") {
    return <PilotReadinessLoading />;
  }

  if (loadState.status === "unavailable") {
    return <PilotReadinessProblemPanel onRetry={load} problem={loadState.problem} />;
  }

  return <PilotReadinessContent data={loadState.data} onRefresh={load} />;
}

function PilotReadinessContent({
  data,
  onRefresh
}: {
  data: Cp10PilotReadinessPlan;
  onRefresh: () => void;
}) {
  const providerAndOps = data.items.filter(
    (item) => item.category === "provider" || item.category === "operations"
  );
  const localConfig = data.items.filter(
    (item) => item.category !== "provider" && item.category !== "operations"
  );

  return (
    <div className="surface-stack cp10-workflow" data-testid="cp10-pilot-readiness-workspace">
      <section className="surface-hero surface-hero--pilot" aria-labelledby="cp10-title">
        <div>
          <p className="eyebrow">Release candidate</p>
          <h1 id="cp10-title">Pilot readiness</h1>
          <p className="hero-subline">
            {data.clinicName} is {CP10_STATUS_LABELS[data.localConfigurationStatus].toLowerCase()}{" "}
            for local pilot configuration. Go-live is{" "}
            {CP10_STATUS_LABELS[data.pilotGoLiveStatus].toLowerCase()} until external activation
            evidence is recorded.
          </p>
        </div>
        <div
          className={
            data.pilotGoLiveStatus === "ready"
              ? "hero-status"
              : "hero-status hero-status--pending"
          }
          aria-label="Pilot go-live state"
          data-testid="cp10-go-live-status"
        >
          <span
            className={
              data.pilotGoLiveStatus === "ready"
                ? "status-dot status-dot--ok"
                : "status-dot status-dot--warn"
            }
          />
          <span>{CP10_STATUS_LABELS[data.pilotGoLiveStatus]}</span>
        </div>
      </section>

      {data.source === "cp10_fixture" ? (
        <section
          className="inline-alert"
          aria-label="Synthetic CP10 pilot readiness fixture"
          data-testid="cp10-fixture-alert"
        >
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Local synthetic CP10 fixture mode</strong>
            <span>
              Readiness data is synthetic and secret-free. It exercises configuration review only;
              it does not activate live providers, ABDM, AWS apply, GitHub push, or devices.
            </span>
          </div>
        </section>
      ) : null}

      <section className="readiness-grid" aria-label="Pilot readiness summary">
        <ReadinessMetric
          icon={<CheckCircle2 size={20} />}
          label="Ready"
          value={data.summary.ready}
        />
        <ReadinessMetric icon={<Ban size={20} />} label="Blocked" value={data.summary.blocked} />
        <ReadinessMetric
          icon={<Clock3 size={20} />}
          label="Deferred"
          value={data.summary.deferred}
        />
      </section>

      <div className="workflow-grid workflow-grid--cp10">
        <section className="work-panel" aria-labelledby="cp10-local-title">
          <div className="panel-heading">
            <div>
              <h2 id="cp10-local-title">Configuration and workflows</h2>
              <p>Local RC setup, synthetic inputs, templates, migration inputs, and implemented workflow evidence.</p>
            </div>
            <StatusPill status={data.localConfigurationStatus} />
          </div>
          <div className="cp10-status-list">
            {localConfig.map((item) => (
              <ReadinessItemRow item={item} key={item.id} />
            ))}
          </div>
        </section>

        <section className="work-panel" aria-labelledby="cp10-gaps-title">
          <div className="panel-heading">
            <div>
              <h2 id="cp10-gaps-title">External go-live gates</h2>
              <p>Provider, cloud, CI, ABDM, restore, and device checks that need external evidence.</p>
            </div>
            <StatusPill status={data.pilotGoLiveStatus} />
          </div>
          <div className="cp10-status-list" data-testid="cp10-live-gaps">
            {data.liveVerificationGaps.map((item) => (
              <ReadinessItemRow item={item} key={item.id} compact />
            ))}
          </div>
        </section>
      </div>

      <section className="work-panel" aria-labelledby="cp10-provider-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp10-provider-title">Provider and operations contract</h2>
            <p>Current status is based on configured evidence and official activation paths only.</p>
          </div>
          <Button
            aria-label="Refresh pilot readiness"
            icon={<RefreshCw size={16} />}
            onClick={onRefresh}
            size="sm"
            variant="secondary"
          >
            Refresh
          </Button>
        </div>
        <div className="cp10-provider-grid">
          {providerAndOps.map((item) => (
            <ReadinessCard item={item} key={item.id} />
          ))}
        </div>
      </section>

      <section className="inline-alert inline-alert--info" aria-label="CP10 safety posture">
        <ClipboardCheck size={18} aria-hidden="true" />
        <div>
          <strong>Safety posture</strong>
          <span>
            Synthetic-only: {data.safety.syntheticOnly ? "yes" : "no"}; no real PHI:{" "}
            {data.safety.noRealPhi ? "yes" : "no"}; live provider activation:{" "}
            {data.safety.noLiveProviderActivation ? "off" : "on"}; secret values exposed:{" "}
            {data.safety.noSecretValues ? "no" : "yes"}.
          </span>
        </div>
      </section>
    </div>
  );
}

function ReadinessMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="readiness-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadinessItemRow({
  compact = false,
  item
}: {
  compact?: boolean;
  item: Cp10PilotReadinessItem;
}) {
  return (
    <article className={compact ? "cp10-item-row cp10-item-row--compact" : "cp10-item-row"}>
      <div>
        <strong>{item.label}</strong>
        <span>{item.evidence}</span>
      </div>
      <StatusPill status={item.status} />
    </article>
  );
}

function ReadinessCard({ item }: { item: Cp10PilotReadinessItem }) {
  return (
    <article className="activation-card cp10-readiness-card">
      <div className="cp10-card-heading">
        <strong>{item.label}</strong>
        <StatusPill status={item.status} />
      </div>
      <p>{item.evidence}</p>
      <ul>
        {item.activationPath.slice(0, 3).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      {item.routeContracts.length > 0 ? (
        <div className="cp10-route-list" aria-label={`${item.label} route contracts`}>
          {item.routeContracts.slice(0, 3).map((route) => (
            <code key={route}>{route}</code>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: Cp10PilotReadinessStatus }) {
  return (
    <span className={`state-pill state-pill--${status}`}>
      {CP10_STATUS_LABELS[status]}
    </span>
  );
}

function PilotReadinessLoading() {
  return (
    <div className="surface-stack" aria-busy="true" aria-live="polite">
      <section className="surface-hero surface-hero--pilot">
        <div>
          <p className="eyebrow">Release candidate</p>
          <h1>Pilot readiness</h1>
          <p className="hero-subline">Loading pilot configuration evidence.</p>
        </div>
      </section>
      <section className="work-panel">
        <div className="skeleton-line skeleton-line--short" />
        <div className="skeleton-line" />
        <div className="skeleton-grid">
          <div />
          <div />
          <div />
        </div>
      </section>
    </div>
  );
}

function PilotReadinessProblemPanel({
  onRetry,
  problem
}: {
  onRetry: () => void;
  problem: Cp10PilotReadinessProblem;
}) {
  return (
    <section
      className="state-panel state-panel--content"
      aria-labelledby="cp10-problem-title"
      data-testid="cp10-pilot-readiness-unavailable"
    >
      <AlertCircle size={28} aria-hidden="true" />
      <p className="state-kicker">Pilot readiness unavailable</p>
      <h1 id="cp10-problem-title">{problem.message}</h1>
      <div className="state-diagnostics">
        {problem.endpoints.map((endpoint) => (
          <div key={`${endpoint.endpoint}-${endpoint.status ?? "unknown"}`}>
            <dt>{endpoint.endpoint}</dt>
            <dd>
              {endpoint.status ?? "network"} {endpoint.message}
            </dd>
          </div>
        ))}
      </div>
      <Button
        aria-label="Retry pilot readiness"
        icon={<RefreshCw size={16} />}
        onClick={onRetry}
        variant="secondary"
      >
        Retry
      </Button>
    </section>
  );
}
