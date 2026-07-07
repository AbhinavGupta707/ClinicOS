"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  Loader2,
  LockKeyhole,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  applyFixtureAdvanceLabCase,
  applyFixtureAssignTask,
  applyFixtureCompleteCorrectiveAction,
  applyFixtureCompleteRecallAction,
  applyFixtureCompleteSopItem,
  applyFixtureCompleteSopRun,
  applyFixtureCompleteTask,
  applyFixtureCreateCorrectiveAction,
  applyFixtureCreateIncident,
  applyFixtureCreateLabReconciliation,
  applyFixtureRecordInventoryCount,
  applyFixtureRequestProcurement,
  canManageContinuityTasks,
  canManageLabCases,
  canManageOperations,
  canViewOwnerControl,
  completeLiveRecallAction,
  createLiveTask,
  createLiveCorrectiveAction,
  createLiveIncident,
  createLiveLabReconciliation,
  deriveCp6OwnerMetrics,
  formatMoney,
  loadCp6Operations,
  patchLiveCorrectiveAction,
  patchLiveInventoryCheckRun,
  patchLiveLabCase,
  patchLiveSopRun,
  patchLiveTask,
  type CorrectiveAction,
  type Cp6OperationsData,
  type Cp6OperationsLoadState,
  type Cp6OperationsProblem,
  type Cp6Task,
  type Incident,
  type InventoryCheckRun,
  type InventoryException,
  type LabCase,
  type LabCaseStatus,
  type RecallDue,
  type SopRun,
  type TaskCompletionInput
} from "@/lib/cp6-operations";
import type { MeProfile } from "@/lib/me";
import type { ClinicRole } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";

interface OperationsWorkflowProps {
  activeSurfaceId: string;
  profile: MeProfile;
}

type LoadState = Cp6OperationsLoadState | { status: "loading" };
type Cp6Mode = "incidents" | "inventory" | "lab" | "owner" | "recalls" | "sops" | "tasks";

type ActionMessage = {
  tone: "error" | "info" | "success";
  text: string;
};

const cp6WorkflowSurfaceIds = new Set(["lab", "operations", "owner-control", "tasks"]);

const TASK_MODES: Array<{ icon: LucideIcon; label: string; mode: Cp6Mode }> = [
  { icon: Send, label: "Recalls", mode: "recalls" },
  { icon: ClipboardList, label: "Tasks", mode: "tasks" },
  { icon: ClipboardCheck, label: "SOPs", mode: "sops" }
];

const OPERATIONS_MODES: Array<{ icon: LucideIcon; label: string; mode: Cp6Mode }> = [
  { icon: Boxes, label: "Inventory", mode: "inventory" },
  { icon: ShieldCheck, label: "Incidents", mode: "incidents" }
];

export function isCp6WorkflowSurface(surfaceId: string) {
  return cp6WorkflowSurfaceIds.has(surfaceId);
}

export function OperationsWorkflow({ activeSurfaceId, profile }: OperationsWorkflowProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<Cp6Mode>(defaultModeForSurface(activeSurfaceId));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedLabCaseId, setSelectedLabCaseId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [countDraft, setCountDraft] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [incidentDraft, setIncidentDraft] = useState({
    category: "lab_delay" as Incident["category"],
    description: "Synthetic event diary entry for CP6 workflow verification.",
    impact: "Patient seating had to be delayed while the case was traced.",
    learning: "Confirm due lab cases during evening close."
  });

  const data = loadState.status === "ready" ? loadState.data : null;

  const selectedTask = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.tasks.find((task) => task.id === selectedTaskId) ?? data.tasks[0] ?? null;
  }, [data, selectedTaskId]);

  const selectedLabCase = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.labCases.find((labCase) => labCase.id === selectedLabCaseId) ?? data.labCases[0] ?? null;
  }, [data, selectedLabCaseId]);

  const selectedIncident = useMemo(() => {
    if (!data) {
      return null;
    }

    return (
      data.incidents.find((incident) => incident.id === selectedIncidentId) ??
      data.incidents[0] ??
      null
    );
  }, [data, selectedIncidentId]);

  const selectedCapa = selectedIncident
    ? data?.correctiveActions.find((action) => action.incidentId === selectedIncident.id) ?? null
    : null;

  const reloadWorkflow = () => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp6Operations(controller.signal).then(setLoadState);

    return controller;
  };

  useEffect(() => {
    const controller = reloadWorkflow();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setMode(defaultModeForSurface(activeSurfaceId));
  }, [activeSurfaceId]);

  useEffect(() => {
    if (!selectedTaskId && selectedTask) {
      setSelectedTaskId(selectedTask.id);
    }
  }, [selectedTask, selectedTaskId]);

  useEffect(() => {
    if (!selectedLabCaseId && selectedLabCase) {
      setSelectedLabCaseId(selectedLabCase.id);
    }
  }, [selectedLabCase, selectedLabCaseId]);

  useEffect(() => {
    if (!selectedIncidentId && selectedIncident) {
      setSelectedIncidentId(selectedIncident.id);
    }
  }, [selectedIncident, selectedIncidentId]);

  useEffect(() => {
    if (!data || Object.keys(countDraft).length > 0) {
      return;
    }

    const checkRun = data.inventoryCheckRuns[0];

    if (!checkRun) {
      return;
    }

    setCountDraft(
      Object.fromEntries(
        checkRun.lines.map((line) => [
          line.itemId,
          String(line.countedOnHand ?? line.expectedOnHand)
        ])
      )
    );
  }, [countDraft, data]);

  const setReadyData = (nextData: Cp6OperationsData) => {
    setLoadState({ data: nextData, status: "ready" });
  };

  const handleActionError = (error: unknown, fallback: string) => {
    setActionMessage({
      text: error instanceof Error ? error.message : fallback,
      tone: "error"
    });
  };

  const handleCompleteRecall = async (recall: RecallDue) => {
    if (!data) {
      return;
    }

    setActionBusy("complete-recall");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      detail: "Manual recall call completed; no provider delivery state was created.",
      recallId: recall.id
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureCompleteRecallAction(data, input));
      } else {
        await completeLiveRecallAction(input);
        reloadWorkflow();
      }

      setActionMessage({
        text: "Recall action completed without fake sent, delivered, or booked state.",
        tone: "success"
      });
    } catch (error) {
      handleActionError(error, "Recall action could not be completed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAssignTask = async (task: Cp6Task) => {
    if (!data) {
      return;
    }

    setActionBusy("assign-task");
    setActionMessage(null);

    const input = {
      assignedToName: profile.user.displayName,
      assignedToRole: preferredAssignableRole(profile.roles),
      taskId: task.id
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureAssignTask(data, input));
      } else {
        await patchLiveTask(task.id, {
          assignedToName: input.assignedToName,
          assignedToRole: input.assignedToRole,
          status: "assigned"
        });
        reloadWorkflow();
      }

      setActionMessage({ text: "Task assignment recorded.", tone: "success" });
    } catch (error) {
      handleActionError(error, "Task assignment failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCompleteTask = async (task: Cp6Task) => {
    if (!data) {
      return;
    }

    setActionBusy("complete-task");
    setActionMessage(null);

    const input: TaskCompletionInput = {
      actorName: profile.user.displayName,
      completionNote: "Task completed from CP6 operations workbench.",
      taskId: task.id
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureCompleteTask(data, input));
      } else {
        await patchLiveTask(task.id, {
          completionEvidence: {
            actorName: input.actorName,
            note: input.completionNote
          },
          status: "completed"
        });
        reloadWorkflow();
      }

      setActionMessage({ text: "Task completion recorded with actor evidence.", tone: "success" });
    } catch (error) {
      handleActionError(error, "Task completion failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCompleteSopItem = async (run: SopRun, itemId: string) => {
    if (!data) {
      return;
    }

    setActionBusy(`sop-item-${itemId}`);
    setActionMessage(null);

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(
          applyFixtureCompleteSopItem(data, {
            actorName: profile.user.displayName,
            itemId,
            sopRunId: run.id
          })
        );
      } else {
        await patchLiveSopRun(run.id, {
          actorName: profile.user.displayName,
          checklist: run.checklist.map((item) => ({
            id: item.id,
            status: item.id === itemId ? "completed" : item.status
          })),
          status: "in_progress"
        });
        reloadWorkflow();
      }

      setActionMessage({ text: "SOP checklist item completed.", tone: "success" });
    } catch (error) {
      handleActionError(error, "SOP checklist item could not be completed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCompleteSopRun = async (run: SopRun) => {
    if (!data) {
      return;
    }

    setActionBusy("complete-sop-run");
    setActionMessage(null);

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(
          applyFixtureCompleteSopRun(data, {
            actorName: profile.user.displayName,
            sopRunId: run.id
          })
        );
      } else {
        await patchLiveSopRun(run.id, {
          actorName: profile.user.displayName,
          status: "completed"
        });
        reloadWorkflow();
      }

      setActionMessage({ text: "SOP run completed.", tone: "success" });
    } catch (error) {
      handleActionError(error, "SOP run could not be completed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAdvanceLabCase = async (labCase: LabCase, status: LabCaseStatus) => {
    if (!data) {
      return;
    }

    setActionBusy(`lab-${status}`);
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      labCaseId: labCase.id,
      status
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureAdvanceLabCase(data, input));
      } else {
        await patchLiveLabCase(input);
        reloadWorkflow();
      }

      setActionMessage({
        text: `Lab case marked ${status.replace(/_/g, " ")}.`,
        tone: "success"
      });
    } catch (error) {
      handleActionError(error, "Lab case status could not be updated.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateLabReconciliation = async () => {
    if (!data) {
      return;
    }

    setActionBusy("lab-reconciliation");
    setActionMessage(null);

    const input = {
      caseIds: data.labCases
        .filter((labCase) => ["completed", "fitted", "returned"].includes(labCase.status))
        .map((labCase) => labCase.id),
      createdBy: profile.user.displayName,
      month: data.today.slice(0, 7)
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureCreateLabReconciliation(data, input));
      } else {
        await createLiveLabReconciliation(input);
        reloadWorkflow();
      }

      setActionMessage({
        text: "Lab reconciliation created without marking vendor payment as executed.",
        tone: "success"
      });
    } catch (error) {
      handleActionError(error, "Lab reconciliation could not be created.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRecordInventoryCount = async (checkRun: InventoryCheckRun) => {
    if (!data) {
      return;
    }

    setActionBusy("inventory-count");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      checkRunId: checkRun.id,
      counts: Object.fromEntries(
        checkRun.lines.map((line) => [
          line.itemId,
          Number.parseInt(countDraft[line.itemId] ?? String(line.expectedOnHand), 10)
        ])
      )
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureRecordInventoryCount(data, input));
      } else {
        await patchLiveInventoryCheckRun(input);
        reloadWorkflow();
      }

      setActionMessage({
        text: "Inventory count recorded; low stock becomes an exception, not a fake purchase.",
        tone: "success"
      });
    } catch (error) {
      handleActionError(error, "Inventory count could not be recorded.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRequestProcurement = async (exception: InventoryException) => {
    if (!data) {
      return;
    }

    setActionBusy("procurement-request");
    setActionMessage(null);

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(
          applyFixtureRequestProcurement(data, {
            actorName: profile.user.displayName,
            exceptionId: exception.id
          })
        );
      } else {
        await createLiveTask({
          assignedToName: profile.user.displayName,
          assignedToRole: "assistant",
          detail: exception.detail,
          dueAt: data.today,
          kind: "procurement",
          source: "inventory_exception",
          title: "Procurement request"
        });
        reloadWorkflow();
      }

      setActionMessage({
        text: "Manual procurement task requested; no vendor purchase was executed.",
        tone: "success"
      });
    } catch (error) {
      handleActionError(error, "Procurement request could not be created.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data) {
      return;
    }

    setActionBusy("create-incident");
    setActionMessage(null);

    const input = {
      ...incidentDraft,
      reportedBy: profile.user.displayName
    };

    try {
      if (data.source === "cp6_fixture") {
        const nextData = applyFixtureCreateIncident(data, input);
        setReadyData(nextData);
        setSelectedIncidentId(nextData.incidents[0]?.id ?? null);
      } else {
        await createLiveIncident(input);
        reloadWorkflow();
      }

      setActionMessage({ text: "Incident diary entry created.", tone: "success" });
    } catch (error) {
      handleActionError(error, "Incident could not be created.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateCapa = async (incident: Incident) => {
    if (!data) {
      return;
    }

    setActionBusy("create-capa");
    setActionMessage(null);

    const input = {
      assignedToName: profile.user.displayName,
      assignedToRole: preferredAssignableRole(profile.roles),
      dueDate: data.today,
      incidentId: incident.id,
      title: "Review and prevent repeat event"
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureCreateCorrectiveAction(data, input));
      } else {
        await createLiveCorrectiveAction(input);
        reloadWorkflow();
      }

      setActionMessage({ text: "Corrective action assigned.", tone: "success" });
    } catch (error) {
      handleActionError(error, "Corrective action could not be assigned.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCompleteCapa = async (action: CorrectiveAction) => {
    if (!data) {
      return;
    }

    setActionBusy("complete-capa");
    setActionMessage(null);

    const input = {
      actorName: profile.user.displayName,
      completionNote: "Corrective action completed with learning reviewed.",
      correctiveActionId: action.id
    };

    try {
      if (data.source === "cp6_fixture") {
        setReadyData(applyFixtureCompleteCorrectiveAction(data, input));
      } else {
        await patchLiveCorrectiveAction(input);
        reloadWorkflow();
      }

      setActionMessage({ text: "Corrective action completed.", tone: "success" });
    } catch (error) {
      handleActionError(error, "Corrective action could not be completed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div data-testid="cp6-operations-workspace">
      <div className="surface-stack cp6-workflow" data-testid={`cp6-surface-${activeSurfaceId}`}>
        <section className="surface-hero surface-hero--operations" aria-labelledby="cp6-title">
          <div>
            <p className="eyebrow">Continuity operations</p>
            <h1 id="cp6-title">{titleForSurface(activeSurfaceId)}</h1>
            <p className="hero-subline">{descriptionForSurface(activeSurfaceId)}</p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp6_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp6_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "ready" ? (
          <>
            {loadState.data.source === "cp6_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP6 workflow fixture"
                data-testid="cp6-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP6 fixture mode</strong>
                  <span>
                    Non-PHI operations data is synthetic. Messaging provider delivery,
                    procurement purchase execution, and source-revenue analytics are not faked.
                  </span>
                </div>
              </section>
            ) : null}

            <ReadinessPanel data={loadState.data} />

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
                data-testid="cp6-action-message"
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

            {activeSurfaceId === "tasks" ? (
              <>
                <WorkflowTabs items={TASK_MODES} mode={mode} setMode={setMode} />
                {mode === "recalls" ? (
                  <RecallQueuePanel
                    actionBusy={actionBusy}
                    data={loadState.data}
                    onCompleteRecall={handleCompleteRecall}
                    profile={profile}
                  />
                ) : null}
                {mode === "tasks" ? (
                  <TaskWorkbenchPanel
                    actionBusy={actionBusy}
                    data={loadState.data}
                    onAssignTask={handleAssignTask}
                    onCompleteTask={handleCompleteTask}
                    onSelectTask={setSelectedTaskId}
                    profile={profile}
                    selectedTask={selectedTask}
                  />
                ) : null}
                {mode === "sops" ? (
                  <SopRunnerPanel
                    actionBusy={actionBusy}
                    data={loadState.data}
                    onCompleteItem={handleCompleteSopItem}
                    onCompleteRun={handleCompleteSopRun}
                    profile={profile}
                  />
                ) : null}
              </>
            ) : null}

            {activeSurfaceId === "lab" ? (
              <LabBoardPanel
                actionBusy={actionBusy}
                data={loadState.data}
                onAdvanceLabCase={handleAdvanceLabCase}
                onCreateReconciliation={handleCreateLabReconciliation}
                onSelectLabCase={setSelectedLabCaseId}
                profile={profile}
                selectedLabCase={selectedLabCase}
              />
            ) : null}

            {activeSurfaceId === "operations" ? (
              <>
                <WorkflowTabs items={OPERATIONS_MODES} mode={mode} setMode={setMode} />
                {mode === "inventory" ? (
                  <InventoryRunnerPanel
                    actionBusy={actionBusy}
                    countDraft={countDraft}
                    data={loadState.data}
                    onCountDraftChange={setCountDraft}
                    onRecordCount={handleRecordInventoryCount}
                    onRequestProcurement={handleRequestProcurement}
                    profile={profile}
                  />
                ) : null}
                {mode === "incidents" ? (
                  <IncidentDiaryPanel
                    actionBusy={actionBusy}
                    data={loadState.data}
                    draft={incidentDraft}
                    onCompleteCapa={handleCompleteCapa}
                    onCreateCapa={handleCreateCapa}
                    onCreateIncident={handleCreateIncident}
                    onDraftChange={setIncidentDraft}
                    onSelectIncident={setSelectedIncidentId}
                    profile={profile}
                    selectedCapa={selectedCapa}
                    selectedIncident={selectedIncident}
                  />
                ) : null}
              </>
            ) : null}

            {activeSurfaceId === "owner-control" ? (
              <OwnerControlPanel data={loadState.data} profile={profile} />
            ) : null}

            <TimelinePanel data={loadState.data} />
          </>
        ) : (
          <WorkflowUnavailable onRetry={reloadWorkflow} problem={loadState.problem} />
        )}
      </div>
    </div>
  );
}

function RecallQueuePanel({
  actionBusy,
  data,
  onCompleteRecall,
  profile
}: {
  actionBusy: string | null;
  data: Cp6OperationsData;
  onCompleteRecall: (recall: RecallDue) => void;
  profile: MeProfile;
}) {
  if (!canManageContinuityTasks(profile.roles)) {
    return <RoleNote text="Recall actions are hidden for this role." />;
  }

  return (
    <section className="work-panel" aria-labelledby="cp6-recall-title" data-testid="cp6-recall-queue">
      <div className="panel-heading">
        <div>
          <h2 id="cp6-recall-title">Recall queue</h2>
          <p>Due recall actions can be completed manually without fake provider delivery states.</p>
        </div>
      </div>
      <div className="cp6-card-list">
        {data.recalls.map((recall) => (
          <article className="cp6-card" key={recall.id}>
            <div>
              <strong>{patientName(data, recall.patientId)}</strong>
              <span>{recall.ruleLabel}</span>
              <span>Due {formatDate(recall.dueDate)}</span>
            </div>
            <span className="state-pill" data-testid="cp6-recall-status">
              {recall.status.replace(/_/g, " ")}
            </span>
            <Button
              data-testid="cp6-complete-recall"
              disabled={recall.status === "action_completed" || actionBusy === "complete-recall"}
              icon={<CheckCircle2 size={16} />}
              onClick={() => onCompleteRecall(recall)}
              size="sm"
            >
              Complete action
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}

function TaskWorkbenchPanel({
  actionBusy,
  data,
  onAssignTask,
  onCompleteTask,
  onSelectTask,
  profile,
  selectedTask
}: {
  actionBusy: string | null;
  data: Cp6OperationsData;
  onAssignTask: (task: Cp6Task) => void;
  onCompleteTask: (task: Cp6Task) => void;
  onSelectTask: (taskId: string) => void;
  profile: MeProfile;
  selectedTask: Cp6Task | null;
}) {
  if (!canManageContinuityTasks(profile.roles)) {
    return <RoleNote text="Task workbench actions are hidden for this role." />;
  }

  return (
    <div className="workflow-grid workflow-grid--cp6">
      <section className="work-panel" aria-labelledby="cp6-task-title" data-testid="cp6-task-workbench">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-task-title">Task workbench</h2>
            <p>Assignment, due status, and completion evidence for continuity work.</p>
          </div>
        </div>
        <div className="cp6-card-list">
          {data.tasks.map((task) => (
            <button
              aria-pressed={selectedTask?.id === task.id}
              className={
                selectedTask?.id === task.id ? "cp6-card cp6-card--active" : "cp6-card"
              }
              key={task.id}
              onClick={() => onSelectTask(task.id)}
              type="button"
            >
              <div>
                <strong>{task.title}</strong>
                <span>{task.detail}</span>
                <span>{task.patientId ? patientName(data, task.patientId) : "Clinic task"}</span>
              </div>
              <span className="state-pill">{task.status.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="cp6-task-detail-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-task-detail-title">Selected task</h2>
            <p>Assign work to a role holder, then complete it with actor evidence.</p>
          </div>
        </div>
        {selectedTask ? (
          <>
            <div className="detail-strip">
              <div>
                <span>Status</span>
                <strong data-testid="cp6-task-status">{selectedTask.status.replace(/_/g, " ")}</strong>
              </div>
              <div>
                <span>Assignee</span>
                <strong>{selectedTask.assignedToName ?? ROLE_LABELS[selectedTask.assignedToRole]}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{formatDateTime(selectedTask.dueAt)}</strong>
              </div>
            </div>
            <div className="checkout-actions">
              <Button
                data-testid="cp6-assign-task"
                disabled={selectedTask.status === "completed" || actionBusy === "assign-task"}
                icon={<UserCheck size={16} />}
                onClick={() => onAssignTask(selectedTask)}
              >
                Assign to me
              </Button>
              <Button
                data-testid="cp6-complete-task"
                disabled={selectedTask.status === "completed" || actionBusy === "complete-task"}
                icon={<CheckCircle2 size={16} />}
                onClick={() => onCompleteTask(selectedTask)}
                variant="secondary"
              >
                Complete task
              </Button>
            </div>
          </>
        ) : (
          <EmptyState text="No task is available." />
        )}
      </section>
    </div>
  );
}

function SopRunnerPanel({
  actionBusy,
  data,
  onCompleteItem,
  onCompleteRun,
  profile
}: {
  actionBusy: string | null;
  data: Cp6OperationsData;
  onCompleteItem: (run: SopRun, itemId: string) => void;
  onCompleteRun: (run: SopRun) => void;
  profile: MeProfile;
}) {
  if (!canManageOperations(profile.roles)) {
    return <RoleNote text="SOP checklist completion is hidden for this role." />;
  }

  const run = data.sopRuns[0] ?? null;

  return (
    <section className="work-panel" aria-labelledby="cp6-sop-title" data-testid="cp6-sop-runner">
      <div className="panel-heading">
        <div>
          <h2 id="cp6-sop-title">SOP checklist runner</h2>
          <p>Required checklist items must be completed before the run can close.</p>
        </div>
        {run ? <span className="state-pill">{run.status.replace(/_/g, " ")}</span> : null}
      </div>
      {run ? (
        <>
          <div className="cp6-checklist">
            {run.checklist.map((item) => (
              <div className="cp6-check-row" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.required ? "Required" : "Optional"}</span>
                </div>
                <span className="state-pill">{item.status}</span>
                <Button
                  data-testid={`cp6-complete-sop-item-${item.id}`}
                  disabled={item.status === "completed" || actionBusy === `sop-item-${item.id}`}
                  icon={<CheckCircle2 size={16} />}
                  onClick={() => onCompleteItem(run, item.id)}
                  size="sm"
                  variant="secondary"
                >
                  Complete
                </Button>
              </div>
            ))}
          </div>
          <Button
            data-testid="cp6-complete-sop-run"
            disabled={
              run.status === "completed" ||
              run.checklist.some((item) => item.required && item.status !== "completed") ||
              actionBusy === "complete-sop-run"
            }
            icon={<FileCheck2 size={16} />}
            onClick={() => onCompleteRun(run)}
          >
            Complete SOP run
          </Button>
        </>
      ) : (
        <EmptyState text="No SOP run is due today." />
      )}
    </section>
  );
}

function LabBoardPanel({
  actionBusy,
  data,
  onAdvanceLabCase,
  onCreateReconciliation,
  onSelectLabCase,
  profile,
  selectedLabCase
}: {
  actionBusy: string | null;
  data: Cp6OperationsData;
  onAdvanceLabCase: (labCase: LabCase, status: LabCaseStatus) => void;
  onCreateReconciliation: () => void;
  onSelectLabCase: (labCaseId: string) => void;
  profile: MeProfile;
  selectedLabCase: LabCase | null;
}) {
  if (!canManageLabCases(profile.roles)) {
    return <RoleNote text="Lab case tracking is hidden for this role." />;
  }

  return (
    <div className="workflow-grid workflow-grid--cp6">
      <section className="work-panel" aria-labelledby="cp6-lab-title" data-testid="cp6-lab-board">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-lab-title">Lab case board</h2>
            <p>Track sent, returned, completed, and exception states by due date.</p>
          </div>
        </div>
        <div className="cp6-card-list">
          {data.labCases.map((labCase) => (
            <button
              aria-pressed={selectedLabCase?.id === labCase.id}
              className={
                selectedLabCase?.id === labCase.id ? "cp6-card cp6-card--active" : "cp6-card"
              }
              key={labCase.id}
              onClick={() => onSelectLabCase(labCase.id)}
              type="button"
            >
              <div>
                <strong>{labCase.procedure}</strong>
                <span>{patientName(data, labCase.patientId)}</span>
                <span>
                  Tooth {labCase.toothNumber} - {labCase.material} - shade {labCase.shade}
                </span>
              </div>
              <span className="state-pill" data-testid="cp6-lab-status">
                {labCase.status.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="cp6-lab-detail-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-lab-detail-title">Progress and reconciliation</h2>
            <p>Month-end reconciliation records expected payable amounts only.</p>
          </div>
        </div>
        {selectedLabCase ? (
          <>
            <div className="detail-strip">
              <div>
                <span>Lab</span>
                <strong>{labVendorName(data, selectedLabCase.vendorId)}</strong>
              </div>
              <div>
                <span>Due</span>
                <strong>{formatDate(selectedLabCase.dueDate)}</strong>
              </div>
              <div>
                <span>Expected payable</span>
                <strong>{formatMoney(selectedLabCase.amountCents)}</strong>
              </div>
            </div>
            <div className="checkout-actions">
              <Button
                data-testid="cp6-lab-mark-sent"
                disabled={selectedLabCase.status === "sent_to_lab" || actionBusy === "lab-sent_to_lab"}
                icon={<Send size={16} />}
                onClick={() => onAdvanceLabCase(selectedLabCase, "sent_to_lab")}
              >
                Mark sent
              </Button>
              <Button
                data-testid="cp6-lab-mark-returned"
                disabled={selectedLabCase.status === "returned" || actionBusy === "lab-returned"}
                icon={<PackageCheck size={16} />}
                onClick={() => onAdvanceLabCase(selectedLabCase, "returned")}
                variant="secondary"
              >
                Mark returned
              </Button>
              <Button
                data-testid="cp6-lab-mark-completed"
                disabled={selectedLabCase.status === "completed" || actionBusy === "lab-completed"}
                icon={<CheckCircle2 size={16} />}
                onClick={() => onAdvanceLabCase(selectedLabCase, "completed")}
                variant="secondary"
              >
                Complete case
              </Button>
            </div>
            <Button
              data-testid="cp6-create-lab-reconciliation"
              disabled={
                !data.labCases.some((labCase) =>
                  ["completed", "fitted", "returned"].includes(labCase.status)
                ) || actionBusy === "lab-reconciliation"
              }
              icon={<FileCheck2 size={16} />}
              onClick={onCreateReconciliation}
            >
              Create reconciliation
            </Button>
            <div className="payment-ledger" data-testid="cp6-lab-reconciliation">
              {data.labReconciliations.length > 0 ? (
                data.labReconciliations.map((reconciliation) => (
                  <div className="ledger-row" key={reconciliation.id}>
                    <span>{reconciliation.month}</span>
                    <span>{reconciliation.caseIds.length} cases</span>
                    <strong>{formatMoney(reconciliation.expectedAmountCents)}</strong>
                    <small>created, not paid</small>
                  </div>
                ))
              ) : (
                <EmptyState text="No lab reconciliation has been created yet." />
              )}
            </div>
          </>
        ) : (
          <EmptyState text="No lab case is available." />
        )}
      </section>
    </div>
  );
}

function InventoryRunnerPanel({
  actionBusy,
  countDraft,
  data,
  onCountDraftChange,
  onRecordCount,
  onRequestProcurement,
  profile
}: {
  actionBusy: string | null;
  countDraft: Record<string, string>;
  data: Cp6OperationsData;
  onCountDraftChange: (draft: Record<string, string>) => void;
  onRecordCount: (checkRun: InventoryCheckRun) => void;
  onRequestProcurement: (exception: InventoryException) => void;
  profile: MeProfile;
}) {
  if (!canManageOperations(profile.roles)) {
    return <RoleNote text="Inventory checks are hidden for this role." />;
  }

  const checkRun = data.inventoryCheckRuns[0] ?? null;

  return (
    <div className="workflow-grid workflow-grid--cp6">
      <section
        className="work-panel"
        aria-labelledby="cp6-inventory-title"
        data-testid="cp6-inventory-runner"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cp6-inventory-title">Inventory check runner</h2>
            <p>Drawer-by-drawer count entry with variance and low-stock detection.</p>
          </div>
          {checkRun ? <span className="state-pill">{checkRun.status.replace(/_/g, " ")}</span> : null}
        </div>
        {checkRun ? (
          <>
            <div className="cp6-checklist">
              {checkRun.lines.map((line) => {
                const item = data.inventoryItems.find((candidate) => candidate.id === line.itemId);

                return (
                  <label className="cp6-count-row" key={line.itemId}>
                    <span>
                      <strong>{item?.name ?? line.itemId}</strong>
                      <small>
                        Expected {line.expectedOnHand} {item?.unit ?? "units"} - reorder at{" "}
                        {item?.reorderPoint ?? 0}
                      </small>
                    </span>
                    <input
                      data-testid={`cp6-inventory-count-${line.itemId}`}
                      min={0}
                      type="number"
                      value={countDraft[line.itemId] ?? ""}
                      onChange={(event) =>
                        onCountDraftChange({
                          ...countDraft,
                          [line.itemId]: event.target.value
                        })
                      }
                    />
                  </label>
                );
              })}
            </div>
            <Button
              data-testid="cp6-record-inventory-count"
              disabled={actionBusy === "inventory-count"}
              icon={<ClipboardCheck size={16} />}
              onClick={() => onRecordCount(checkRun)}
            >
              Record count
            </Button>
          </>
        ) : (
          <EmptyState text="No inventory check run is scheduled." />
        )}
      </section>

      <section className="work-panel" aria-labelledby="cp6-inventory-exception-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-inventory-exception-title">Exceptions and procurement requests</h2>
            <p>Low stock creates a manual procurement task, not a vendor purchase.</p>
          </div>
        </div>
        <div className="payment-ledger" data-testid="cp6-inventory-exceptions">
          {data.inventoryExceptions.length > 0 ? (
            data.inventoryExceptions.map((exception) => (
              <div className="ledger-row" key={exception.id}>
                <span>{inventoryItemName(data, exception.itemId)}</span>
                <span>{exception.status.replace(/_/g, " ")}</span>
                <strong>{exception.procurementTaskId ? "Task requested" : "Needs review"}</strong>
                <small>{exception.detail}</small>
                <Button
                  data-testid="cp6-request-procurement"
                  disabled={
                    exception.status === "procurement_requested" ||
                    actionBusy === "procurement-request"
                  }
                  icon={<PackageCheck size={16} />}
                  onClick={() => onRequestProcurement(exception)}
                  size="sm"
                  variant="secondary"
                >
                  Request procurement
                </Button>
              </div>
            ))
          ) : (
            <EmptyState text="No inventory exception is open." />
          )}
        </div>
      </section>
    </div>
  );
}

function IncidentDiaryPanel({
  actionBusy,
  data,
  draft,
  onCompleteCapa,
  onCreateCapa,
  onCreateIncident,
  onDraftChange,
  onSelectIncident,
  profile,
  selectedCapa,
  selectedIncident
}: {
  actionBusy: string | null;
  data: Cp6OperationsData;
  draft: {
    category: Incident["category"];
    description: string;
    impact: string;
    learning: string;
  };
  onCompleteCapa: (action: CorrectiveAction) => void;
  onCreateCapa: (incident: Incident) => void;
  onCreateIncident: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: {
    category: Incident["category"];
    description: string;
    impact: string;
    learning: string;
  }) => void;
  onSelectIncident: (incidentId: string) => void;
  profile: MeProfile;
  selectedCapa: CorrectiveAction | null;
  selectedIncident: Incident | null;
}) {
  if (!canManageOperations(profile.roles)) {
    return <RoleNote text="Incident and CAPA tracking is hidden for this role." />;
  }

  return (
    <div className="workflow-grid workflow-grid--cp6">
      <section
        className="work-panel"
        aria-labelledby="cp6-incident-title"
        data-testid="cp6-incident-diary"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cp6-incident-title">Incident diary</h2>
            <p>Operational events require category, impact, learning, and corrective action.</p>
          </div>
        </div>
        <form className="clinical-form cp6-incident-form" onSubmit={onCreateIncident}>
          <label className="clinical-field">
            <span>Category</span>
            <select
              data-testid="cp6-incident-category"
              value={draft.category}
              onChange={(event) =>
                onDraftChange({ ...draft, category: event.target.value as Incident["category"] })
              }
            >
              <option value="lab_delay">Lab delay</option>
              <option value="missed_appointment">Missed appointment</option>
              <option value="missing_instrument">Missing instrument</option>
              <option value="payment_not_collected">Payment not collected</option>
              <option value="stockout">Stockout</option>
            </select>
          </label>
          <label className="clinical-field clinical-field--wide">
            <span>Description</span>
            <textarea
              data-testid="cp6-incident-description"
              value={draft.description}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="clinical-field">
            <span>Impact</span>
            <textarea
              value={draft.impact}
              onChange={(event) => onDraftChange({ ...draft, impact: event.target.value })}
            />
          </label>
          <label className="clinical-field">
            <span>Learning</span>
            <textarea
              value={draft.learning}
              onChange={(event) => onDraftChange({ ...draft, learning: event.target.value })}
            />
          </label>
          <Button
            data-testid="cp6-create-incident"
            disabled={actionBusy === "create-incident"}
            icon={<ShieldCheck size={16} />}
            type="submit"
          >
            Create incident
          </Button>
        </form>

        <div className="cp6-card-list">
          {data.incidents.map((incident) => (
            <button
              aria-pressed={selectedIncident?.id === incident.id}
              className={
                selectedIncident?.id === incident.id ? "cp6-card cp6-card--active" : "cp6-card"
              }
              key={incident.id}
              onClick={() => onSelectIncident(incident.id)}
              type="button"
            >
              <div>
                <strong>{incident.category.replace(/_/g, " ")}</strong>
                <span>{incident.description}</span>
              </div>
              <span className="state-pill">{incident.status.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="cp6-capa-title">
        <div className="panel-heading">
          <div>
            <h2 id="cp6-capa-title">CAPA tracker</h2>
            <p>Corrective actions can be assigned and closed with completion evidence.</p>
          </div>
        </div>
        {selectedIncident ? (
          <>
            <div className="detail-strip">
              <div>
                <span>Incident</span>
                <strong>{selectedIncident.category.replace(/_/g, " ")}</strong>
              </div>
              <div>
                <span>Impact</span>
                <strong>{selectedIncident.impact}</strong>
              </div>
              <div>
                <span>Learning</span>
                <strong>{selectedIncident.learning}</strong>
              </div>
            </div>
            <div className="checkout-actions">
              <Button
                data-testid="cp6-create-capa"
                disabled={Boolean(selectedCapa) || actionBusy === "create-capa"}
                icon={<UserCheck size={16} />}
                onClick={() => onCreateCapa(selectedIncident)}
              >
                Assign CAPA
              </Button>
              <Button
                data-testid="cp6-complete-capa"
                disabled={
                  !selectedCapa ||
                  selectedCapa.status === "completed" ||
                  actionBusy === "complete-capa"
                }
                icon={<CheckCircle2 size={16} />}
                onClick={() => selectedCapa && onCompleteCapa(selectedCapa)}
                variant="secondary"
              >
                Complete CAPA
              </Button>
            </div>
            <div className="payment-ledger" data-testid="cp6-capa-list">
              {selectedCapa ? (
                <div className="ledger-row">
                  <span>{selectedCapa.title}</span>
                  <span>{selectedCapa.assignedToName}</span>
                  <strong>{selectedCapa.status.replace(/_/g, " ")}</strong>
                  <small>{selectedCapa.completionNote ?? "Completion evidence pending."}</small>
                </div>
              ) : (
                <EmptyState text="No corrective action assigned yet." />
              )}
            </div>
          </>
        ) : (
          <EmptyState text="No incident is selected." />
        )}
      </section>
    </div>
  );
}

function OwnerControlPanel({
  data,
  profile
}: {
  data: Cp6OperationsData;
  profile: MeProfile;
}) {
  if (!canViewOwnerControl(profile.roles)) {
    return <RoleNote text="Owner control is hidden outside the owner role." />;
  }

  const metrics = deriveCp6OwnerMetrics(data);

  return (
    <section className="work-panel" aria-labelledby="cp6-owner-title" data-testid="cp6-owner-control">
      <div className="panel-heading">
        <div>
          <h2 id="cp6-owner-title">Owner operations status</h2>
          <p>Operational metrics below are derived from the loaded CP6 read model.</p>
        </div>
        <BarChart3 size={20} aria-hidden="true" />
      </div>
      <div className="dashboard-metrics">
        <Metric label="Open tasks" value={String(metrics.openTasks)} />
        <Metric label="Completed tasks" value={String(metrics.completedTasks)} />
        <Metric label="Recalls due" value={String(metrics.recallsDue)} />
        <Metric label="Recall actions" value={String(metrics.recallActionsCompleted)} />
        <Metric label="Lab exceptions" value={String(metrics.labExceptions)} />
        <Metric label="Inventory exceptions" value={String(metrics.inventoryExceptions)} />
      </div>
      <section
        className="inline-alert inline-alert--info"
        data-testid="cp6-owner-source-revenue-deferred"
      >
        <AlertCircle size={18} aria-hidden="true" />
        <div>
          <strong>Source-attributed revenue waits for the Analytics/QA read model</strong>
          <span>
            This UX does not render static revenue cards. The live owner dashboard endpoint is the
            route owner for source, revenue, no-show, and leakage projections.
          </span>
        </div>
      </section>
    </section>
  );
}

function ReadinessPanel({ data }: { data: Cp6OperationsData }) {
  return (
    <section className="readiness-grid readiness-grid--cp6" data-testid="cp6-readiness">
      <StatusMetric
        icon={Send}
        label="Messaging"
        value={
          data.readiness.messagingProvider === "provider_unavailable"
            ? "Provider unavailable; no sent/delivered state"
            : "Simulator"
        }
      />
      <StatusMetric
        icon={PackageCheck}
        label="Procurement"
        value={
          data.readiness.inventoryProcurement === "manual_task_only"
            ? "Manual task only"
            : "Provider unavailable"
        }
      />
      <StatusMetric
        icon={BarChart3}
        label="Owner analytics"
        value={
          data.readiness.ownerAnalytics === "source_revenue_deferred"
            ? "Source revenue deferred"
            : "Available"
        }
      />
    </section>
  );
}

function WorkflowTabs({
  items,
  mode,
  setMode
}: {
  items: Array<{ icon: LucideIcon; label: string; mode: Cp6Mode }>;
  mode: Cp6Mode;
  setMode: (mode: Cp6Mode) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP6 operations workflow surfaces">
      {items.map((item) => {
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

function TimelinePanel({ data }: { data: Cp6OperationsData }) {
  return (
    <section className="work-panel" aria-labelledby="cp6-timeline-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp6-timeline-title">Operations timeline</h2>
          <p>Fixture timeline mirrors the audit/timeline evidence CP6 workflows expect.</p>
        </div>
      </div>
      <div className="timeline-list" data-testid="cp6-timeline">
        {data.timeline.map((item) => (
          <article className="timeline-item" key={item.id}>
            <time>{formatShortTime(item.at)}</time>
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

function StatusMetric({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="readiness-metric">
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <Loader2 size={18} aria-hidden="true" />
        <span>Loading CP6 operations workflow...</span>
      </div>
    </section>
  );
}

function WorkflowUnavailable({
  onRetry,
  problem
}: {
  onRetry: () => void;
  problem: Cp6OperationsProblem;
}) {
  return (
    <section className="work-panel" aria-labelledby="cp6-unavailable-title">
      <div className="panel-heading">
        <div>
          <h2 id="cp6-unavailable-title">Operations workflow unavailable</h2>
          <p>{problem.message}</p>
        </div>
        <AlertCircle size={22} aria-hidden="true" />
      </div>
      <div className="endpoint-table">
        <div className="endpoint-row endpoint-row--head">
          <span>Endpoint</span>
          <span>Status</span>
        </div>
        {problem.endpoints.map((endpoint) => (
          <div className="endpoint-row" key={`${endpoint.endpoint}-${endpoint.message}`}>
            <span>{endpoint.endpoint}</span>
            <span>
              {endpoint.status ? `HTTP ${endpoint.status}: ` : ""}
              {endpoint.message}
            </span>
          </div>
        ))}
      </div>
      <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
        Retry
      </Button>
    </section>
  );
}

function RoleNote({ text }: { text: string }) {
  return (
    <div className="readiness-gate readiness-gate--blocked">
      <LockKeyhole size={18} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>{text}</span>
    </div>
  );
}

function defaultModeForSurface(surfaceId: string): Cp6Mode {
  if (surfaceId === "lab") {
    return "lab";
  }

  if (surfaceId === "operations") {
    return "inventory";
  }

  if (surfaceId === "owner-control") {
    return "owner";
  }

  return "recalls";
}

function titleForSurface(surfaceId: string) {
  switch (surfaceId) {
    case "lab":
      return "Lab board";
    case "operations":
      return "Inventory and event diary";
    case "owner-control":
      return "Owner control";
    default:
      return "Tasks and recalls";
  }
}

function descriptionForSurface(surfaceId: string) {
  switch (surfaceId) {
    case "lab":
      return "Lab case progress and month-end reconciliation without fake invoice payment.";
    case "operations":
      return "Inventory checks, low-stock exceptions, procurement tasks, incidents, and CAPA.";
    case "owner-control":
      return "Role-gated operational status with source-attributed revenue deferred to the analytics read model.";
    default:
      return "Recall queue, follow-up tasks, assignment, completion, and SOP checklist runs.";
  }
}

function preferredAssignableRole(roles: ClinicRole[]): ClinicRole {
  if (roles.includes("assistant")) {
    return "assistant";
  }

  if (roles.includes("receptionist")) {
    return "receptionist";
  }

  if (roles.includes("doctor")) {
    return "doctor";
  }

  return roles.find((role) => role !== "platform_admin") ?? "assistant";
}

function patientName(data: Cp6OperationsData, patientId: string) {
  return data.patients.find((patient) => patient.id === patientId)?.displayName ?? "Patient account";
}

function labVendorName(data: Cp6OperationsData, vendorId: string) {
  return data.labVendors.find((vendor) => vendor.id === vendorId)?.name ?? "Lab vendor";
}

function inventoryItemName(data: Cp6OperationsData, itemId: string) {
  return data.inventoryItems.find((item) => item.id === itemId)?.name ?? itemId;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
