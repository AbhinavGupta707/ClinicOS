"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  MessageSquareWarning,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  applyFixtureCp8ReviewDecision,
  canRoleReviewCp8Item,
  CP8_ROLE_LABELS,
  CP8_STATUS_LABELS,
  getCp8ItemsForMode,
  getCp8PendingCount,
  getCp8RejectedRetainedCount,
  getCp8WarningCount,
  loadCp8Review,
  submitLiveCp8ReviewDecision,
  type Cp8ActionProposal,
  type Cp8ClinicalNoteDraft,
  type Cp8DentalChartPatchDraft,
  type Cp8ReviewData,
  type Cp8ReviewDecision,
  type Cp8ReviewItem,
  type Cp8ReviewLoadState,
  type Cp8ReviewMode,
  type Cp8ReviewProblem,
  type Cp8SourceAnchor
} from "@/lib/cp8-review";
import type { MeProfile } from "@/lib/me";

interface AiReviewWorkflowProps {
  activeSurfaceId: string;
  profile: MeProfile;
}

type ActionMessage = { text: string; tone: "error" | "info" | "success" };

const CP8_SURFACES = new Set(["action-proposals", "ai-review", "chart-drafts", "note-drafts"]);

const MODE_ITEMS: Array<{ icon: typeof FileText; id: Cp8ReviewMode; label: string }> = [
  { icon: FileText, id: "notes", label: "Notes" },
  { icon: Stethoscope, id: "chart", label: "Chart" },
  { icon: ClipboardCheck, id: "actions", label: "Actions" }
];

export function isCp8WorkflowSurface(surfaceId: string) {
  return CP8_SURFACES.has(surfaceId);
}

export function AiReviewWorkflow({ activeSurfaceId, profile }: AiReviewWorkflowProps) {
  const [loadState, setLoadState] = useState<Cp8ReviewLoadState | { status: "loading" }>({
    status: "loading"
  });
  const [mode, setMode] = useState<Cp8ReviewMode>(() => modeForSurface(activeSurfaceId));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

  useEffect(() => {
    setMode(modeForSurface(activeSurfaceId));
    setSelectedItemId(null);
  }, [activeSurfaceId]);

  useEffect(() => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp8Review(controller.signal)
      .then(setLoadState)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;

        setLoadState({
          problem: {
            code: "NETWORK_UNAVAILABLE",
            endpoints: [
              {
                endpoint: "CP8 review loader",
                message: error instanceof Error ? error.message : "Unable to load CP8 review"
              }
            ],
            message: "The CP8 AI review surface could not load."
          },
          status: "unavailable"
        });
      });

    return () => controller.abort();
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  const modeItems = useMemo(() => (data ? getCp8ItemsForMode(data, mode) : []), [data, mode]);
  const selectedItem =
    modeItems.find((item) => item.id === selectedItemId) ?? modeItems[0] ?? null;

  const updateFixtureData = (nextData: Cp8ReviewData) => {
    setLoadState({ data: nextData, status: "ready" });
  };

  const handleDecision = async (item: Cp8ReviewItem, decision: Cp8ReviewDecision) => {
    if (!data) return;

    setActionBusy(true);
    setActionMessage(null);
    try {
      const detail = `${profile.user.displayName} recorded ${decision} from the CP8 review surface.`;

      if (data.source === "cp8_fixture") {
        const nextData = applyFixtureCp8ReviewDecision(data, {
          actorName: profile.user.displayName,
          decision,
          detail,
          itemId: item.id,
          roles: profile.roles
        });
        updateFixtureData(nextData);
        setActionMessage({
          text: messageForFixtureDecision(decision),
          tone: decision === "reject" ? "info" : "success"
        });
      } else {
        await submitLiveCp8ReviewDecision(item, {
          actorName: profile.user.displayName,
          decision,
          detail
        });
        setActionMessage({
          text: "Review decision was sent to the CP8 backend boundary. Wait for backend evidence before treating any clinical or operational state as changed.",
          tone: "info"
        });
      }
    } catch (error) {
      setActionMessage({
        text: error instanceof Error ? error.message : "Review decision failed.",
        tone: "error"
      });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div data-testid="cp8-ai-review-workspace">
      <div className="surface-stack cp8-workflow" data-testid={`cp8-surface-${activeSurfaceId}`}>
        <section className="surface-hero surface-hero--ai" aria-labelledby="cp8-title">
          <div>
            <p className="eyebrow">AI draft review</p>
            <h1 id="cp8-title">{titleForSurface(activeSurfaceId)}</h1>
            <p className="hero-subline">{descriptionForSurface(activeSurfaceId)}</p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp8_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp8_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "unavailable" ? (
          <ProblemPanel problem={loadState.problem} />
        ) : (
          <>
            {loadState.data.source === "cp8_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP8 AI review fixture"
                data-testid="cp8-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP8 fixture mode</strong>
                  <span>
                    Drafts, chart patches, and proposals are synthetic review material. Decisions
                    are recorded as evaluation evidence only and do not change clinical records or
                    send operational actions.
                  </span>
                </div>
              </section>
            ) : null}

            <SafetyMetrics data={loadState.data} />

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
                data-testid="cp8-action-message"
              >
                {actionMessage.tone === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {actionMessage.tone === "error" ? "Decision failed" : "Review update"}
                  </strong>
                  <span>{actionMessage.text}</span>
                </div>
              </section>
            ) : null}

            <WorkflowTabs mode={mode} setMode={setMode} />

            <section className="workflow-grid workflow-grid--cp8" data-testid="cp8-review-panel">
              <DraftList
                items={modeItems}
                onSelect={setSelectedItemId}
                selectedItemId={selectedItem?.id ?? null}
              />
              <DraftDetail
                actionBusy={actionBusy}
                item={selectedItem}
                onDecision={handleDecision}
                profile={profile}
              />
            </section>

            <AuditPanel data={loadState.data} />
          </>
        )}
      </div>
    </div>
  );
}

function SafetyMetrics({ data }: { data: Cp8ReviewData }) {
  return (
    <section className="readiness-grid readiness-grid--cp8" data-testid="cp8-review-readiness">
      <MetricCard
        label="Pending"
        value={`${getCp8PendingCount(data)} drafts`}
        detail="All AI output is draft-only until reviewed."
      />
      <MetricCard
        label="Warnings"
        value={`${getCp8WarningCount(data)} visible`}
        detail="Low confidence and clinical safety warnings are shown inline."
      />
      <MetricCard
        label="Rejected retained"
        value={`${getCp8RejectedRetainedCount(data)} retained`}
        detail="Rejected AI output stays available for evaluation."
      />
    </section>
  );
}

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="workflow-metric cp8-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DraftList({
  items,
  onSelect,
  selectedItemId
}: {
  items: Cp8ReviewItem[];
  onSelect: (itemId: string) => void;
  selectedItemId: string | null;
}) {
  return (
    <section className="work-panel" aria-labelledby="cp8-draft-list-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp8-draft-list-title">Review queue</h2>
          <p>Drafts stay linked to anchors, warnings, and reviewer role boundaries.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState text="No AI review items are available for this view." />
      ) : (
        <div className="cp8-draft-list">
          {items.map((item) => (
            <button
              className={
                item.id === selectedItemId
                  ? "cp8-draft-card cp8-draft-card--active"
                  : "cp8-draft-card"
              }
              data-testid={`cp8-draft-${item.id}`}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span className="state-pill">{CP8_STATUS_LABELS[item.status]}</span>
              <strong>{item.title}</strong>
              <span>{item.patientName}</span>
              <small>
                {Math.round(item.confidence * 100)}% confidence ·{" "}
                {CP8_ROLE_LABELS[item.requiredReviewer]} review
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DraftDetail({
  actionBusy,
  item,
  onDecision,
  profile
}: {
  actionBusy: boolean;
  item: Cp8ReviewItem | null;
  onDecision: (item: Cp8ReviewItem, decision: Cp8ReviewDecision) => void;
  profile: MeProfile;
}) {
  if (!item) {
    return (
      <section className="work-panel" data-testid="cp8-draft-detail">
        <EmptyState text="Select an AI draft or action proposal to review." />
      </section>
    );
  }

  const canReview = canRoleReviewCp8Item(item, profile.roles);

  return (
    <section className="work-panel" aria-labelledby="cp8-detail-title" data-testid="cp8-draft-detail">
      <div className="panel-heading">
        <div>
          <h2 id="cp8-detail-title">{item.title}</h2>
          <p>
            {item.encounterLabel} · {item.patientName}
          </p>
        </div>
        <span className="state-pill" data-testid="cp8-selected-status">
          {CP8_STATUS_LABELS[item.status]}
        </span>
      </div>

      <div className="detail-strip detail-strip--three">
        <div>
          <span>Reviewer</span>
          <strong>{CP8_ROLE_LABELS[item.requiredReviewer]}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{Math.round(item.confidence * 100)}%</strong>
        </div>
        <div>
          <span>Application</span>
          <strong>{applicationLabel(item.applicationState)}</strong>
        </div>
      </div>

      {!canReview ? (
        <section className="inline-alert inline-alert--info" data-testid="cp8-role-boundary">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>{CP8_ROLE_LABELS[item.requiredReviewer]} review required</strong>
            <span>
              This role can inspect anchors and warnings, but approval controls stay unavailable
              until an authorized reviewer opens the item.
            </span>
          </div>
        </section>
      ) : null}

      <Warnings warnings={item.warnings} />
      <DraftBody item={item} />
      <SourceAnchors anchors={item.sourceAnchors} importantIds={item.importantClaimAnchorIds} />

      <div className="surface-actions cp8-review-actions">
        <Button
          data-testid="cp8-edit-draft"
          disabled={actionBusy || !canReview}
          icon={<PencilLine size={16} />}
          onClick={() => onDecision(item, "edit")}
          size="sm"
          variant="secondary"
        >
          Record edit
        </Button>
        <Button
          data-testid="cp8-reject-draft"
          disabled={actionBusy || !canReview || item.status === "rejected"}
          icon={<XCircle size={16} />}
          onClick={() => onDecision(item, "reject")}
          size="sm"
          variant="danger"
        >
          Reject
        </Button>
        <Button
          data-testid="cp8-approve-draft"
          disabled={actionBusy || !canReview || item.status === "rejected"}
          icon={<ShieldCheck size={16} />}
          onClick={() => onDecision(item, "approve")}
          size="sm"
        >
          Record approval
        </Button>
      </div>
    </section>
  );
}

function DraftBody({ item }: { item: Cp8ReviewItem }) {
  if (item.kind === "clinical_note") {
    return <ClinicalNoteBody item={item} />;
  }
  if (item.kind === "dental_chart_patch") {
    return <DentalChartPatchBody item={item} />;
  }

  return <ActionProposalBody item={item} />;
}

function ClinicalNoteBody({ item }: { item: Cp8ClinicalNoteDraft }) {
  const sections = [
    ["Chief complaint", item.sections.chiefComplaint],
    ["History", item.sections.history],
    ["Examination", item.sections.examination],
    ["Assessment", item.sections.assessment],
    ["Plan", item.sections.plan]
  ];

  return (
    <div className="cp8-note-grid" data-testid="cp8-clinical-note-draft">
      {sections.map(([label, value]) => (
        <label className="clinical-field" key={label}>
          <span>{label}</span>
          <textarea defaultValue={value} aria-label={`${label} draft text`} />
        </label>
      ))}
    </div>
  );
}

function DentalChartPatchBody({ item }: { item: Cp8DentalChartPatchDraft }) {
  return (
    <div className="cp8-finding-list" data-testid="cp8-dental-chart-draft">
      {item.findings.map((finding) => (
        <article className="finding-card" key={`${finding.toothNumber}-${finding.findingType}`}>
          <div className="cp8-finding-heading">
            <strong>
              Tooth {finding.toothNumber} {finding.surface ? `· ${finding.surface}` : ""}
            </strong>
            <span className="state-pill">{Math.round(finding.confidence * 100)}%</span>
          </div>
          <p>
            {finding.findingType.replaceAll("_", " ")} · {finding.status}: {finding.description}
          </p>
          <small>Anchors: {finding.sourceAnchorIds.join(", ")}</small>
        </article>
      ))}
    </div>
  );
}

function ActionProposalBody({ item }: { item: Cp8ActionProposal }) {
  return (
    <article className="cp8-proposal" data-testid="cp8-action-proposal-draft">
      <div className="detail-strip detail-strip--three">
        <div>
          <span>Action</span>
          <strong>{item.actionType.replaceAll("_", " ")}</strong>
        </div>
        <div>
          <span>Tool</span>
          <strong>{item.proposedTool}</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{item.riskLevel}</strong>
        </div>
      </div>
      <p>{item.summary}</p>
    </article>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <section className="cp8-warning-list" data-testid="cp8-warning-list">
      {warnings.map((warning) => (
        <div className="inline-alert inline-alert--info" key={warning}>
          <MessageSquareWarning size={16} aria-hidden="true" />
          <div>
            <strong>Review warning</strong>
            <span>{warning}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function SourceAnchors({
  anchors,
  importantIds
}: {
  anchors: Cp8SourceAnchor[];
  importantIds: string[];
}) {
  const important = new Set(importantIds);

  return (
    <section className="cp8-anchor-list" aria-label="Source anchors" data-testid="cp8-source-anchors">
      <div className="panel-heading panel-heading--compact">
        <div>
          <h3>Source anchors</h3>
          <p>Important claims must point to transcript or source evidence.</p>
        </div>
      </div>
      {anchors.map((anchor) => (
        <article
          className={important.has(anchor.id) ? "cp8-anchor cp8-anchor--important" : "cp8-anchor"}
          key={anchor.id}
        >
          <strong>
            {anchor.label} · {anchor.timeRange}
          </strong>
          <span>{anchor.excerpt}</span>
        </article>
      ))}
    </section>
  );
}

function AuditPanel({ data }: { data: Cp8ReviewData }) {
  return (
    <section className="work-panel" aria-labelledby="cp8-audit-title" data-testid="cp8-audit-panel">
      <div className="panel-heading">
        <div>
          <h2 id="cp8-audit-title">Review and evaluation evidence</h2>
          <p>Rejected and edited output remains retained for evaluation where the contract supports it.</p>
        </div>
      </div>
      <div className="timeline-list">
        {data.reviewAudit.map((item) => (
          <article className="timeline-item" key={item.id}>
            <time>{item.at}</time>
            <div>
              <strong>
                {item.decision} · {item.actorName}
              </strong>
              <span>{item.detail}</span>
              <code>ai.review_decision</code>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProblemPanel({ problem }: { problem: Cp8ReviewProblem }) {
  return (
    <section className="work-panel" data-testid="cp8-unavailable-state">
      <div className="panel-heading">
        <div>
          <h2>CP8 AI review unavailable</h2>
          <p>{problem.message}</p>
        </div>
        <span className="state-pill">{problem.code}</span>
      </div>
      <div className="endpoint-table">
        <div className="endpoint-row endpoint-row--head">
          <span>Contract boundary</span>
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
  mode: Cp8ReviewMode;
  setMode: (mode: Cp8ReviewMode) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP8 AI review views">
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
        <Bot size={18} aria-hidden="true" />
        <span>Loading CP8 AI review...</span>
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

function modeForSurface(surfaceId: string): Cp8ReviewMode {
  if (surfaceId === "chart-drafts") return "chart";
  if (surfaceId === "action-proposals") return "actions";

  return "notes";
}

function titleForSurface(surfaceId: string) {
  if (surfaceId === "chart-drafts") return "Dental chart draft review";
  if (surfaceId === "action-proposals") return "Action proposal inbox";

  return "Clinical note draft review";
}

function descriptionForSurface(surfaceId: string) {
  if (surfaceId === "chart-drafts") {
    return "Review tooth-level AI chart patches with source anchors before any durable chart write.";
  }
  if (surfaceId === "action-proposals") {
    return "Approve, edit, or reject proposed workflow actions without pretending messages, billing, or tasks were executed.";
  }

  return "Review AI scribe note drafts with warnings, confidence, source evidence, and doctor approval boundaries.";
}

function applicationLabel(state: Cp8ReviewItem["applicationState"]) {
  if (state === "waiting_for_backend") return "Waiting for backend evidence";
  if (state === "not_applied_fixture") return "Not applied in fixture";

  return "Not applied";
}

function messageForFixtureDecision(decision: Cp8ReviewDecision) {
  if (decision === "approve") {
    return "Approval was recorded as review evidence only. No clinical note, dental chart, message, task, payment, or billing state changed.";
  }
  if (decision === "reject") {
    return "Draft was rejected and retained for evaluation evidence. No product state changed.";
  }

  return "Edited draft state was recorded for review. Backend application still requires a real review decision route.";
}
