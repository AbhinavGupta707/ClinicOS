"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileImage,
  History,
  Images,
  Link2,
  Loader2,
  LockKeyhole,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Stethoscope
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";

import {
  CP4_REQUIRED_ENDPOINTS,
  DENTAL_SURFACES,
  FINDING_SEVERITY_LABELS,
  FINDING_STATUS_LABELS,
  FINDING_TYPE_LABELS,
  MEDIA_KIND_LABELS,
  MEDIA_TAG_LABELS,
  PERMANENT_TOOTH_NUMBERS,
  SURFACE_LABELS,
  applyFixtureAddFinding,
  applyFixtureAttachMedia,
  applyFixtureUpdateFinding,
  applyFixtureViewMedia,
  attachLiveMedia,
  createLiveFinding,
  getFindingsForTooth,
  getMediaForContext,
  loadCp4Workflow,
  requestLiveMediaView,
  updateLiveFinding,
  type Cp4Encounter,
  type Cp4WorkflowData,
  type Cp4WorkflowLoadState,
  type Cp4WorkflowProblem,
  type DentalFinding,
  type DentalFindingSeverity,
  type DentalFindingStatus,
  type DentalFindingType,
  type DentalSurface,
  type MediaAsset,
  type MediaAttachmentTarget,
  type MediaKind,
  type MediaTag
} from "@/lib/cp4-workflow";
import type { MeProfile } from "@/lib/me";
import type { ClinicRole } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";

interface DentalMediaWorkflowProps {
  profile: MeProfile;
}

type LoadState = Cp4WorkflowLoadState | { status: "loading" };

type ActionMessage = {
  tone: "error" | "info" | "success";
  text: string;
};

type Cp4Mode = "chart" | "compare" | "history" | "media";

interface FindingDraftState {
  note: string;
  severity: DentalFindingSeverity;
  status: DentalFindingStatus;
  surfaces: DentalSurface[];
  type: DentalFindingType;
}

interface MediaDraftState {
  externalReference: string;
  kind: MediaKind;
  tag: MediaTag;
  target: MediaAttachmentTarget;
}

const WORKFLOW_MODES: Array<{
  icon: LucideIcon;
  label: string;
  mode: Cp4Mode;
}> = [
  { icon: Stethoscope, label: "Chart", mode: "chart" },
  { icon: Images, label: "Media", mode: "media" },
  { icon: FileImage, label: "Compare", mode: "compare" },
  { icon: History, label: "History", mode: "history" }
];

const cp4WorkflowSurfaceIds = new Set(["dental-media"]);

const DEFAULT_FINDING_DRAFT: FindingDraftState = {
  note: "Synthetic CP4 finding note for local workflow verification.",
  severity: "moderate",
  status: "active",
  surfaces: ["occlusal"],
  type: "caries"
};

const DEFAULT_MEDIA_DRAFT: MediaDraftState = {
  externalReference: "Synthetic intraoral photo upload completion",
  kind: "intraoral_photo",
  tag: "intraoral_photo",
  target: "tooth"
};

export function isCp4WorkflowSurface(surfaceId: string) {
  return cp4WorkflowSurfaceIds.has(surfaceId);
}

export function DentalMediaWorkflow({ profile }: DentalMediaWorkflowProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<Cp4Mode>("chart");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedToothNumber, setSelectedToothNumber] = useState("36");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [findingDraft, setFindingDraft] = useState<FindingDraftState>(DEFAULT_FINDING_DRAFT);
  const [editDraft, setEditDraft] = useState<Pick<FindingDraftState, "note" | "status">>({
    note: "",
    status: "active"
  });
  const [mediaDraft, setMediaDraft] = useState<MediaDraftState>(DEFAULT_MEDIA_DRAFT);
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined);

  const actorRole = getClinicalActorRole(profile.roles);
  const data = loadState.status === "ready" ? loadState.data : null;

  const selectedPatient = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.patients.find((patient) => patient.id === selectedPatientId) ?? data.patients[0]!;
  }, [data, selectedPatientId]);

  const selectedEncounter = useMemo(() => {
    if (!data || !selectedPatient) {
      return null;
    }

    return data.encounters.find((encounter) => encounter.patientId === selectedPatient.id) ?? null;
  }, [data, selectedPatient]);

  const selectedToothFindings = useMemo(() => {
    if (!data || !selectedPatient) {
      return [];
    }

    return getFindingsForTooth(data, selectedPatient.id, selectedToothNumber);
  }, [data, selectedPatient, selectedToothNumber]);

  const selectedFinding =
    selectedToothFindings.find((finding) => finding.id === selectedFindingId) ??
    selectedToothFindings[0] ??
    null;

  const visibleMedia = useMemo(() => {
    if (!data || !selectedPatient) {
      return [];
    }

    return getMediaForContext(data, selectedPatient.id, selectedToothNumber, selectedFinding?.id);
  }, [data, selectedPatient, selectedToothNumber, selectedFinding]);

  const selectedMedia =
    visibleMedia.find((asset) => asset.id === selectedMediaId) ?? visibleMedia[0] ?? null;

  const comparisonMedia = comparisonIds
    .map((id) => data?.mediaAssets.find((asset) => asset.id === id) ?? null)
    .filter((asset): asset is MediaAsset => Boolean(asset));

  const reloadWorkflow = () => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp4Workflow(controller.signal).then(setLoadState);

    return controller;
  };

  useEffect(() => {
    const controller = reloadWorkflow();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedPatientId && selectedPatient) {
      setSelectedPatientId(selectedPatient.id);
    }
  }, [selectedPatient, selectedPatientId]);

  useEffect(() => {
    if (selectedFinding) {
      setSelectedFindingId(selectedFinding.id);
      setEditDraft({
        note: selectedFinding.note,
        status: selectedFinding.status
      });
    }
  }, [selectedFinding]);

  useEffect(() => {
    if (selectedMedia && selectedMediaId !== selectedMedia.id) {
      setSelectedMediaId(selectedMedia.id);
    }
  }, [selectedMedia, selectedMediaId]);

  const handleActionError = (error: unknown, fallback: string) => {
    setActionMessage({
      text: error instanceof Error ? error.message : fallback,
      tone: "error"
    });
  };

  const handleSurfaceToggle = (surface: DentalSurface) => {
    setFindingDraft((current) => {
      const nextSurfaces = current.surfaces.includes(surface)
        ? current.surfaces.filter((item) => item !== surface)
        : [...current.surfaces, surface];

      return {
        ...current,
        surfaces: nextSurfaces.length > 0 ? nextSurfaces : [surface]
      };
    });
  };

  const handleAddFinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedPatient || !selectedEncounter) {
      return;
    }

    setActionBusy("add-finding");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      actorRole,
      encounterId: selectedEncounter.id,
      note: findingDraft.note,
      patientId: selectedPatient.id,
      severity: findingDraft.severity,
      status: findingDraft.status,
      surfaces: findingDraft.surfaces,
      toothNumber: selectedToothNumber,
      type: findingDraft.type
    };

    try {
      if (data.source === "cp4_fixture") {
        const nextData = applyFixtureAddFinding(data, input);
        setLoadState({ data: nextData, status: "ready" });
        setSelectedFindingId(nextData.findings[0]?.id ?? null);
        setFindingDraft({ ...DEFAULT_FINDING_DRAFT, note: "" });
        setActionMessage({
          text: "Dental finding created in local synthetic CP4 fixture mode.",
          tone: "success"
        });
      } else {
        await createLiveFinding(input);
        reloadWorkflow();
        setActionMessage({ text: "Dental finding sent to the CP4 API boundary.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Dental finding could not be saved.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleUpdateFinding = async () => {
    if (!data || !selectedFinding) {
      return;
    }

    setActionBusy("update-finding");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      actorRole,
      findingId: selectedFinding.id,
      note: editDraft.note,
      status: editDraft.status
    };

    try {
      if (data.source === "cp4_fixture") {
        const nextData = applyFixtureUpdateFinding(data, input);
        setLoadState({ data: nextData, status: "ready" });
        setActionMessage({
          text: "Finding history updated in local synthetic CP4 fixture mode.",
          tone: "success"
        });
      } else {
        await updateLiveFinding(input);
        reloadWorkflow();
        setActionMessage({ text: "Finding update sent to the CP4 API boundary.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Dental finding update failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAttachMedia = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedPatient || !selectedEncounter) {
      return;
    }

    if (mediaDraft.target === "finding" && !selectedFinding) {
      setActionMessage({
        text: "Select or create a finding before linking media to it.",
        tone: "error"
      });
      return;
    }

    setActionBusy("attach-media");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      actorRole,
      encounterId: selectedEncounter.id,
      externalReference: mediaDraft.externalReference,
      file: selectedFile,
      findingId: selectedFinding?.id,
      kind: mediaDraft.kind,
      patientId: selectedPatient.id,
      tag: mediaDraft.tag,
      target: mediaDraft.target,
      toothNumber: selectedToothNumber
    };

    try {
      if (data.source === "cp4_fixture") {
        const nextData = applyFixtureAttachMedia(data, input);
        setLoadState({ data: nextData, status: "ready" });
        setSelectedMediaId(nextData.mediaAssets[0]?.id ?? null);
        setActionMessage({
          text: "Media metadata linked in local synthetic CP4 fixture mode.",
          tone: "success"
        });
      } else {
        await attachLiveMedia(input);
        reloadWorkflow();
        setActionMessage({ text: "Media upload completion sent to CP4 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Media could not be attached.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleViewMedia = async () => {
    if (!data || !selectedMedia) {
      return;
    }

    setActionBusy("view-media");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      mediaId: selectedMedia.id
    };

    try {
      if (data.source === "cp4_fixture") {
        const nextData = applyFixtureViewMedia(data, input);
        setLoadState({ data: nextData, status: "ready" });
        setSelectedMediaId(selectedMedia.id);
        setActionMessage({
          text: "Signed media view recorded in local synthetic CP4 fixture mode.",
          tone: "success"
        });
      } else {
        await requestLiveMediaView(input);
        reloadWorkflow();
        setActionMessage({ text: "Signed media access requested from CP4 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Signed media access failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleOpenComparison = () => {
    if (!data || data.mediaAssets.length < 2) {
      setActionMessage({
        text: "At least two media assets are required for comparison.",
        tone: "error"
      });
      return;
    }

    const primary = selectedMedia?.id ?? data.mediaAssets[0]!.id;
    const secondary = data.mediaAssets.find((asset) => asset.id !== primary)?.id;

    if (!secondary) {
      return;
    }

    setComparisonIds([primary, secondary]);
    setMode("compare");
  };

  return (
    <div data-testid="cp4-dental-media-workspace">
      <div className="surface-stack cp4-workflow" data-testid="cp4-workflow">
        <section className="surface-hero surface-hero--dental" aria-labelledby="cp4-title">
          <div>
            <p className="eyebrow">Dental chart and media</p>
            <h1 id="cp4-title">{selectedPatient?.displayName ?? profile.clinic.name}</h1>
            <p className="hero-subline">
              Tooth-level findings, audited media links, signed viewing, and chart history for{" "}
              {profile.roles.map((role) => ROLE_LABELS[role]).join(", ")}.
            </p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp4_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp4_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "ready" && selectedPatient && selectedEncounter ? (
          <>
            {loadState.data.source === "cp4_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP4 workflow fixture"
                data-testid="cp4-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP4 fixture mode</strong>
                  <span>
                    Non-PHI dental chart and media data is running behind the typed CP4 provider
                    boundary.
                  </span>
                </div>
              </section>
            ) : null}

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
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

            <PatientSwitcher
              data={loadState.data}
              onSelectPatient={setSelectedPatientId}
              selectedPatientId={selectedPatient.id}
            />

            <WorkflowTabs mode={mode} setMode={setMode} />

            {mode === "chart" ? (
              <ChartPanel
                actionBusy={actionBusy}
                data={loadState.data}
                editDraft={editDraft}
                findingDraft={findingDraft}
                onAddFinding={handleAddFinding}
                onEditDraftChange={setEditDraft}
                onFindingDraftChange={setFindingDraft}
                onSelectFinding={setSelectedFindingId}
                onSelectTooth={setSelectedToothNumber}
                onSurfaceToggle={handleSurfaceToggle}
                onUpdateFinding={handleUpdateFinding}
                selectedEncounter={selectedEncounter}
                selectedFinding={selectedFinding}
                selectedPatientId={selectedPatient.id}
                selectedToothFindings={selectedToothFindings}
                selectedToothNumber={selectedToothNumber}
              />
            ) : null}

            {mode === "media" ? (
              <MediaPanel
                actionBusy={actionBusy}
                mediaDraft={mediaDraft}
                onAttachMedia={handleAttachMedia}
                onCompare={handleOpenComparison}
                onFileChange={setSelectedFile}
                onMediaDraftChange={setMediaDraft}
                onSelectMedia={setSelectedMediaId}
                onViewMedia={handleViewMedia}
                selectedFile={selectedFile}
                selectedMedia={selectedMedia}
                selectedToothNumber={selectedToothNumber}
                visibleMedia={visibleMedia}
              />
            ) : null}

            {mode === "compare" ? (
              <ComparisonPanel
                comparisonMedia={comparisonMedia}
                onOpenComparison={handleOpenComparison}
                visibleMedia={visibleMedia}
              />
            ) : null}

            {mode === "history" ? <HistoryPanel data={loadState.data} /> : null}
          </>
        ) : loadState.status === "ready" ? (
          <EmptyState text="No CP4 dental workflow data is available." />
        ) : (
          <WorkflowUnavailable onRetry={reloadWorkflow} problem={loadState.problem} />
        )}
      </div>
    </div>
  );
}

function PatientSwitcher({
  data,
  onSelectPatient,
  selectedPatientId
}: {
  data: Cp4WorkflowData;
  onSelectPatient: (patientId: string) => void;
  selectedPatientId: string;
}) {
  return (
    <section
      className="patient-switcher"
      aria-label="CP4 patient selector"
      data-testid="cp4-patient-selector"
    >
      {data.patients.map((patient) => {
        const encounter = data.encounters.find((item) => item.patientId === patient.id);
        const active = patient.id === selectedPatientId;

        return (
          <button
            aria-pressed={active}
            className={active ? "patient-switch patient-switch--active" : "patient-switch"}
            data-testid={`cp4-select-patient-${patient.id}`}
            key={patient.id}
            onClick={() => onSelectPatient(patient.id)}
            type="button"
          >
            <strong>{patient.displayName}</strong>
            <span>
              {patient.kind === "new" ? "New" : "Returning"} -{" "}
              {encounter ? encounter.providerName : "No encounter"}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function WorkflowTabs({ mode, setMode }: { mode: Cp4Mode; setMode: (mode: Cp4Mode) => void }) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP4 dental media workflow surfaces">
      {WORKFLOW_MODES.map((item) => {
        const Icon = item.icon;
        const active = mode === item.mode;

        return (
          <button
            aria-selected={active}
            className={active ? "workflow-tab workflow-tab--active" : "workflow-tab"}
            key={item.mode}
            onClick={() => setMode(item.mode)}
            role="tab"
            type="button"
          >
            <Icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChartPanel({
  actionBusy,
  data,
  editDraft,
  findingDraft,
  onAddFinding,
  onEditDraftChange,
  onFindingDraftChange,
  onSelectFinding,
  onSelectTooth,
  onSurfaceToggle,
  onUpdateFinding,
  selectedEncounter,
  selectedFinding,
  selectedPatientId,
  selectedToothFindings,
  selectedToothNumber
}: {
  actionBusy: string | null;
  data: Cp4WorkflowData;
  editDraft: Pick<FindingDraftState, "note" | "status">;
  findingDraft: FindingDraftState;
  onAddFinding: (event: FormEvent<HTMLFormElement>) => void;
  onEditDraftChange: (draft: Pick<FindingDraftState, "note" | "status">) => void;
  onFindingDraftChange: (draft: FindingDraftState) => void;
  onSelectFinding: (findingId: string) => void;
  onSelectTooth: (toothNumber: string) => void;
  onSurfaceToggle: (surface: DentalSurface) => void;
  onUpdateFinding: () => void;
  selectedEncounter: Cp4Encounter;
  selectedFinding: DentalFinding | null;
  selectedPatientId: string;
  selectedToothFindings: DentalFinding[];
  selectedToothNumber: string;
}) {
  const mediaForSelectedTooth = getMediaForContext(data, selectedPatientId, selectedToothNumber);

  return (
    <div className="workflow-grid workflow-grid--dental">
      <section className="work-panel" aria-labelledby="odontogram-title">
        <div className="panel-heading">
          <div>
            <h2 id="odontogram-title">Odontogram</h2>
            <p>FDI tooth selection with finding and media state.</p>
          </div>
          <span className="state-pill" data-testid="cp4-selected-tooth">
            Tooth {selectedToothNumber}
          </span>
        </div>
        <Odontogram
          data={data}
          onSelectTooth={onSelectTooth}
          selectedPatientId={selectedPatientId}
          selectedToothNumber={selectedToothNumber}
        />
      </section>

      <section className="work-panel" aria-labelledby="tooth-detail-title">
        <div className="panel-heading">
          <div>
            <h2 id="tooth-detail-title">Tooth detail</h2>
            <p>
              {selectedToothFindings.length} findings and {mediaForSelectedTooth.length} linked
              media assets.
            </p>
          </div>
          <span className="state-pill">{selectedEncounter.status.replaceAll("_", " ")}</span>
        </div>
        <FindingList
          findings={selectedToothFindings}
          onSelectFinding={onSelectFinding}
          selectedFinding={selectedFinding}
        />
      </section>

      <section className="work-panel" aria-labelledby="finding-editor-title">
        <div className="panel-heading">
          <div>
            <h2 id="finding-editor-title">Add finding</h2>
            <p>Structured tooth/surface finding entry with provenance and history.</p>
          </div>
        </div>
        <form className="clinical-form cp4-finding-form" onSubmit={onAddFinding}>
          <label className="clinical-field">
            <span>Finding</span>
            <select
              data-testid="cp4-finding-type"
              value={findingDraft.type}
              onChange={(event) =>
                onFindingDraftChange({
                  ...findingDraft,
                  type: event.target.value as DentalFindingType
                })
              }
            >
              {Object.entries(FINDING_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="clinical-field">
            <span>Severity</span>
            <select
              value={findingDraft.severity}
              onChange={(event) =>
                onFindingDraftChange({
                  ...findingDraft,
                  severity: event.target.value as DentalFindingSeverity
                })
              }
            >
              {Object.entries(FINDING_SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="clinical-field">
            <span>Status</span>
            <select
              value={findingDraft.status}
              onChange={(event) =>
                onFindingDraftChange({
                  ...findingDraft,
                  status: event.target.value as DentalFindingStatus
                })
              }
            >
              {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="clinical-field clinical-field--wide">
            <span>Surfaces</span>
            <div className="surface-checkbox-grid">
              {DENTAL_SURFACES.map((surface) => (
                <label key={surface}>
                  <input
                    checked={findingDraft.surfaces.includes(surface)}
                    onChange={() => onSurfaceToggle(surface)}
                    type="checkbox"
                  />
                  <span>{SURFACE_LABELS[surface]}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="clinical-field clinical-field--wide">
            <span>Clinical note</span>
            <textarea
              data-testid="cp4-finding-note"
              value={findingDraft.note}
              onChange={(event) =>
                onFindingDraftChange({ ...findingDraft, note: event.target.value })
              }
            />
          </label>
          <Button
            data-testid="cp4-add-finding"
            disabled={actionBusy === "add-finding"}
            icon={<Plus size={16} />}
            type="submit"
            variant="primary"
          >
            Add finding
          </Button>
        </form>
      </section>

      <section className="work-panel" aria-labelledby="finding-history-title">
        <div className="panel-heading">
          <div>
            <h2 id="finding-history-title">Finding history</h2>
            <p>Edit state without overwriting prior provenance.</p>
          </div>
        </div>
        {selectedFinding ? (
          <div className="finding-history-layout">
            <label className="clinical-field">
              <span>Review status</span>
              <select
                value={editDraft.status}
                onChange={(event) =>
                  onEditDraftChange({
                    ...editDraft,
                    status: event.target.value as DentalFindingStatus
                  })
                }
              >
                {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="clinical-field">
              <span>Note</span>
              <textarea
                value={editDraft.note}
                onChange={(event) => onEditDraftChange({ ...editDraft, note: event.target.value })}
              />
            </label>
            <Button
              data-testid="cp4-update-finding"
              disabled={actionBusy === "update-finding"}
              icon={<Save size={16} />}
              onClick={onUpdateFinding}
              variant="secondary"
            >
              Update finding
            </Button>
            <HistoryList finding={selectedFinding} />
          </div>
        ) : (
          <EmptyState text="Select a tooth with findings or add a new finding." />
        )}
      </section>
    </div>
  );
}

function Odontogram({
  data,
  onSelectTooth,
  selectedPatientId,
  selectedToothNumber
}: {
  data: Cp4WorkflowData;
  onSelectTooth: (toothNumber: string) => void;
  selectedPatientId: string;
  selectedToothNumber: string;
}) {
  return (
    <div className="odontogram" data-testid="cp4-odontogram">
      <div className="odontogram-row" aria-label="Upper arch">
        {PERMANENT_TOOTH_NUMBERS.slice(0, 16).map((toothNumber) => (
          <ToothButton
            data={data}
            key={toothNumber}
            onSelectTooth={onSelectTooth}
            selected={selectedToothNumber === toothNumber}
            selectedPatientId={selectedPatientId}
            toothNumber={toothNumber}
          />
        ))}
      </div>
      <div className="odontogram-midline" aria-hidden="true">
        Upper arch / Lower arch
      </div>
      <div className="odontogram-row" aria-label="Lower arch">
        {PERMANENT_TOOTH_NUMBERS.slice(16).map((toothNumber) => (
          <ToothButton
            data={data}
            key={toothNumber}
            onSelectTooth={onSelectTooth}
            selected={selectedToothNumber === toothNumber}
            selectedPatientId={selectedPatientId}
            toothNumber={toothNumber}
          />
        ))}
      </div>
    </div>
  );
}

function ToothButton({
  data,
  onSelectTooth,
  selected,
  selectedPatientId,
  toothNumber
}: {
  data: Cp4WorkflowData;
  onSelectTooth: (toothNumber: string) => void;
  selected: boolean;
  selectedPatientId: string;
  toothNumber: string;
}) {
  const findings = getFindingsForTooth(data, selectedPatientId, toothNumber);
  const media = getMediaForContext(data, selectedPatientId, toothNumber);
  const highSeverity = findings.some((finding) => finding.severity === "high");

  return (
    <button
      aria-pressed={selected}
      className={[
        "tooth-button",
        selected ? "tooth-button--active" : "",
        findings.length > 0 ? "tooth-button--finding" : "",
        highSeverity ? "tooth-button--high" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`cp4-tooth-${toothNumber}`}
      onClick={() => onSelectTooth(toothNumber)}
      type="button"
    >
      <strong>{toothNumber}</strong>
      <span>{findings.length}</span>
      {media.length > 0 ? <i aria-label={`${media.length} media assets`} /> : null}
    </button>
  );
}

function FindingList({
  findings,
  onSelectFinding,
  selectedFinding
}: {
  findings: DentalFinding[];
  onSelectFinding: (findingId: string) => void;
  selectedFinding: DentalFinding | null;
}) {
  if (findings.length === 0) {
    return <EmptyState text="No findings are recorded for this tooth yet." />;
  }

  return (
    <div className="finding-list" data-testid="cp4-finding-list">
      {findings.map((finding) => {
        const active = selectedFinding?.id === finding.id;

        return (
          <button
            aria-pressed={active}
            className={active ? "finding-card finding-card--active" : "finding-card"}
            data-testid={`cp4-finding-card-${finding.id}`}
            key={finding.id}
            onClick={() => onSelectFinding(finding.id)}
            type="button"
          >
            <div>
              <strong>{FINDING_TYPE_LABELS[finding.type]}</strong>
              <span>
                Tooth {finding.toothNumber} -{" "}
                {finding.surfaces.map((surface) => SURFACE_LABELS[surface]).join(", ")}
              </span>
            </div>
            <span className={`state-pill state-pill--${finding.status}`}>
              {FINDING_STATUS_LABELS[finding.status]}
            </span>
            <p>{finding.note}</p>
          </button>
        );
      })}
    </div>
  );
}

function HistoryList({ finding }: { finding: DentalFinding }) {
  return (
    <div className="timeline-list" data-testid="cp4-finding-history">
      {finding.history.map((item) => (
        <div className="timeline-item" key={item.id}>
          <time dateTime={item.at}>{formatDateTime(item.at)}</time>
          <div>
            <strong>{item.kind.replaceAll("_", " ")}</strong>
            <span>{item.detail}</span>
            <code>
              {ROLE_LABELS[item.actorRole]} - {item.actorName}
            </code>
          </div>
        </div>
      ))}
    </div>
  );
}

function MediaPanel({
  actionBusy,
  mediaDraft,
  onAttachMedia,
  onCompare,
  onFileChange,
  onMediaDraftChange,
  onSelectMedia,
  onViewMedia,
  selectedFile,
  selectedMedia,
  selectedToothNumber,
  visibleMedia
}: {
  actionBusy: string | null;
  mediaDraft: MediaDraftState;
  onAttachMedia: (event: FormEvent<HTMLFormElement>) => void;
  onCompare: () => void;
  onFileChange: (file: File | undefined) => void;
  onMediaDraftChange: (draft: MediaDraftState) => void;
  onSelectMedia: (mediaId: string) => void;
  onViewMedia: () => void;
  selectedFile?: File;
  selectedMedia: MediaAsset | null;
  selectedToothNumber: string;
  visibleMedia: MediaAsset[];
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.target.files?.[0]);
  };

  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="media-attach-title">
        <div className="panel-heading">
          <div>
            <h2 id="media-attach-title">Attach media</h2>
            <p>Upload/import/link metadata to patient, encounter, tooth, or finding context.</p>
          </div>
        </div>
        <form className="clinical-form cp4-media-form" onSubmit={onAttachMedia}>
          <label className="clinical-field">
            <span>Media kind</span>
            <select
              value={mediaDraft.kind}
              onChange={(event) =>
                onMediaDraftChange({ ...mediaDraft, kind: event.target.value as MediaKind })
              }
            >
              {Object.entries(MEDIA_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="clinical-field">
            <span>Tag</span>
            <select
              value={mediaDraft.tag}
              onChange={(event) =>
                onMediaDraftChange({ ...mediaDraft, tag: event.target.value as MediaTag })
              }
            >
              {Object.entries(MEDIA_TAG_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="clinical-field">
            <span>Attach to</span>
            <select
              data-testid="cp4-media-target"
              value={mediaDraft.target}
              onChange={(event) =>
                onMediaDraftChange({
                  ...mediaDraft,
                  target: event.target.value as MediaAttachmentTarget
                })
              }
            >
              <option value="tooth">Selected tooth {selectedToothNumber}</option>
              <option value="finding">Selected finding</option>
              <option value="encounter">Encounter</option>
              <option value="patient">Patient</option>
            </select>
          </label>
          <label className="clinical-field">
            <span>File</span>
            <input aria-describedby="media-file-help" onChange={handleFileChange} type="file" />
          </label>
          <label className="clinical-field clinical-field--wide">
            <span>Reference or import note</span>
            <textarea
              data-testid="cp4-media-reference"
              value={mediaDraft.externalReference}
              onChange={(event) =>
                onMediaDraftChange({ ...mediaDraft, externalReference: event.target.value })
              }
            />
          </label>
          <p className="field-help" id="media-file-help">
            Live upload uses the CP4 signed upload boundary. Local fixture mode records synthetic
            metadata only.
          </p>
          {selectedFile ? <p className="field-help">Selected file: {selectedFile.name}</p> : null}
          <Button
            data-testid="cp4-attach-media"
            disabled={actionBusy === "attach-media"}
            icon={<Paperclip size={16} />}
            type="submit"
            variant="primary"
          >
            Attach media
          </Button>
        </form>
      </section>

      <section className="work-panel" aria-labelledby="media-gallery-title">
        <div className="panel-heading">
          <div>
            <h2 id="media-gallery-title">Media gallery</h2>
            <p>Object keys stay private; viewing is mediated by signed access.</p>
          </div>
          <Button
            data-testid="cp4-open-comparison"
            disabled={visibleMedia.length < 2}
            icon={<Images size={16} />}
            onClick={onCompare}
            size="sm"
            variant="secondary"
          >
            Compare
          </Button>
        </div>
        <div className="media-gallery" data-testid="cp4-media-gallery">
          {visibleMedia.map((asset) => (
            <button
              aria-pressed={selectedMedia?.id === asset.id}
              className={
                selectedMedia?.id === asset.id ? "media-card media-card--active" : "media-card"
              }
              data-testid={`cp4-select-media-${asset.id}`}
              key={asset.id}
              onClick={() => onSelectMedia(asset.id)}
              type="button"
            >
              <MediaPreview asset={asset} />
              <strong>{asset.displayName}</strong>
              <span>
                {MEDIA_KIND_LABELS[asset.kind]} - {MEDIA_TAG_LABELS[asset.tag]}
              </span>
            </button>
          ))}
        </div>
        {selectedMedia ? (
          <div className="signed-media-panel" data-testid="cp4-signed-media-view">
            <div>
              <strong>{selectedMedia.displayName}</strong>
              <span>{selectedMedia.referenceLabel}</span>
              {selectedMedia.signedAccess ? (
                <code>
                  Signed access expires {formatDateTime(selectedMedia.signedAccess.expiresAt)}
                </code>
              ) : (
                <code>Signed access not issued yet</code>
              )}
            </div>
            <Button
              data-testid="cp4-open-signed-view"
              disabled={actionBusy === "view-media"}
              icon={<ShieldCheck size={16} />}
              onClick={onViewMedia}
              variant="secondary"
            >
              Open signed view
            </Button>
          </div>
        ) : (
          <EmptyState text="No media assets are linked to this context yet." />
        )}
      </section>
    </div>
  );
}

function MediaPreview({ asset }: { asset: MediaAsset }) {
  return (
    <div className={`media-preview media-preview--${asset.kind}`}>
      {asset.kind === "xray" ? (
        <FileImage size={26} aria-hidden="true" />
      ) : asset.kind === "external_link" ? (
        <Link2 size={26} aria-hidden="true" />
      ) : asset.kind === "document" ? (
        <Paperclip size={26} aria-hidden="true" />
      ) : (
        <Camera size={26} aria-hidden="true" />
      )}
      <span>{MEDIA_KIND_LABELS[asset.kind]}</span>
    </div>
  );
}

function ComparisonPanel({
  comparisonMedia,
  onOpenComparison,
  visibleMedia
}: {
  comparisonMedia: MediaAsset[];
  onOpenComparison: () => void;
  visibleMedia: MediaAsset[];
}) {
  if (comparisonMedia.length < 2) {
    return (
      <section className="work-panel" aria-labelledby="comparison-empty-title">
        <div className="empty-state empty-state--large">
          <Images size={28} aria-hidden="true" />
          <p className="state-kicker">Comparison view</p>
          <h2 id="comparison-empty-title">Choose two media assets to compare.</h2>
          <p>{visibleMedia.length} media assets are available in the selected context.</p>
          <Button
            data-testid="cp4-open-comparison-empty"
            disabled={visibleMedia.length < 2}
            icon={<Images size={16} />}
            onClick={onOpenComparison}
            variant="secondary"
          >
            Compare available media
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="work-panel"
      aria-labelledby="comparison-title"
      data-testid="cp4-comparison-view"
    >
      <div className="panel-heading">
        <div>
          <h2 id="comparison-title">Side-by-side comparison</h2>
          <p>Clinical media review without exposing raw storage paths.</p>
        </div>
      </div>
      <div className="comparison-grid">
        {comparisonMedia.slice(0, 2).map((asset) => (
          <div className="comparison-panel" key={asset.id}>
            <MediaPreview asset={asset} />
            <strong>{asset.displayName}</strong>
            <span>{asset.referenceLabel}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryPanel({ data }: { data: Cp4WorkflowData }) {
  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="chart-history-title">
        <div className="panel-heading">
          <div>
            <h2 id="chart-history-title">Chart history</h2>
            <p>Snapshot history after finding and media changes.</p>
          </div>
        </div>
        <div className="timeline-list" data-testid="cp4-chart-history">
          {data.chartHistory.map((item) => (
            <div className="timeline-item" key={item.id}>
              <time dateTime={item.at}>{formatDateTime(item.at)}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <code>
                  {item.findingCount} findings - {item.actorName}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="cp4-timeline-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp4-timeline-title">Timeline</h2>
            <p>Dental and media events projected for patient history.</p>
          </div>
        </div>
        <div className="timeline-list" data-testid="cp4-timeline">
          {data.timeline.map((item) => (
            <div className="timeline-item" key={item.id}>
              <time dateTime={item.at}>{formatDateTime(item.at)}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <code>{item.kind}</code>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <Loader2 size={18} aria-hidden="true" />
        <span>Loading CP4 dental chart and media API state</span>
      </div>
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-line" />
      <div className="skeleton-grid">
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}

function WorkflowUnavailable({
  onRetry,
  problem
}: {
  onRetry: () => void;
  problem: Cp4WorkflowProblem;
}) {
  return (
    <section className="work-panel" aria-labelledby="cp4-unavailable-title">
      <div className="empty-state empty-state--large">
        <LockKeyhole size={28} aria-hidden="true" />
        <p className="state-kicker">CP4 API boundary unavailable</p>
        <h2 id="cp4-unavailable-title">{problem.message}</h2>
        {problem.detail ? <p>{problem.detail}</p> : null}
      </div>
      <div className="endpoint-table" role="table" aria-label="Required CP4 endpoints">
        <div className="endpoint-row endpoint-row--head" role="row">
          <span role="columnheader">Endpoint</span>
          <span role="columnheader">State</span>
        </div>
        {problem.endpoints.length > 0
          ? problem.endpoints.map((endpoint) => (
              <div
                className="endpoint-row"
                key={`${endpoint.endpoint}-${endpoint.status ?? "x"}`}
                role="row"
              >
                <span role="cell">{endpoint.endpoint}</span>
                <span role="cell">
                  {endpoint.status ? `${endpoint.status}: ${endpoint.message}` : endpoint.message}
                </span>
              </div>
            ))
          : CP4_REQUIRED_ENDPOINTS.map((endpoint) => (
              <div className="endpoint-row" key={endpoint} role="row">
                <span role="cell">{endpoint}</span>
                <span role="cell">Not loaded</span>
              </div>
            ))}
      </div>
      <div className="surface-actions">
        <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
          Retry workflow API
        </Button>
      </div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Stethoscope size={18} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function getClinicalActorRole(roles: ClinicRole[]): ClinicRole {
  for (const role of ["doctor", "assistant", "owner"] satisfies ClinicRole[]) {
    if (roles.includes(role)) {
      return role;
    }
  }

  return roles[0] ?? "assistant";
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time pending";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(date);
}
