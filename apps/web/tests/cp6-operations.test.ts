import { afterEach, describe, expect, it, vi } from "vitest";

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
  classifyCp6EndpointFailures,
  completeLiveRecallAction,
  createFixtureCp6OperationsData,
  createLiveCorrectiveAction,
  createLiveIncident,
  createLiveInventoryCheckRun,
  createLiveLabReconciliation,
  createLiveTask,
  patchLiveCorrectiveAction,
  patchLiveInventoryCheckRun,
  patchLiveLabCase,
  patchLiveSopRun,
  patchLiveTask
} from "@/lib/cp6-operations";

describe("CP6 operations workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("completes recall, task, and SOP work without fake provider delivery", () => {
    const base = createFixtureCp6OperationsData("2026-07-07");
    const recalled = applyFixtureCompleteRecallAction(base, {
      actorName: "assistant fixture user",
      detail: "Manual recall call completed.",
      recallId: "cp6RecallSixMonth"
    });

    expect(recalled.recalls[0]).toMatchObject({
      status: "action_completed"
    });
    expect(recalled.recalls[0]?.actionHistory[0]).toMatchObject({
      kind: "manual_call_completed"
    });
    expect(JSON.stringify(recalled.recalls[0])).not.toMatch(/\b(delivered|sent)\b/i);

    const assigned = applyFixtureAssignTask(recalled, {
      assignedToName: "assistant fixture user",
      assignedToRole: "assistant",
      taskId: "cp6TaskPostOp"
    });
    const completed = applyFixtureCompleteTask(assigned, {
      actorName: "assistant fixture user",
      completionNote: "Follow-up done.",
      taskId: "cp6TaskPostOp"
    });

    expect(completed.tasks.find((task) => task.id === "cp6TaskPostOp")).toMatchObject({
      assignedToName: "assistant fixture user",
      status: "completed"
    });

    const firstItemDone = applyFixtureCompleteSopItem(completed, {
      actorName: "assistant fixture user",
      itemId: "cp6SopSwitches",
      sopRunId: "cp6SopRunSwitches"
    });
    const secondItemDone = applyFixtureCompleteSopItem(firstItemDone, {
      actorName: "assistant fixture user",
      itemId: "cp6SopCuringLight",
      sopRunId: "cp6SopRunSwitches"
    });
    const sopCompleted = applyFixtureCompleteSopRun(secondItemDone, {
      actorName: "assistant fixture user",
      sopRunId: "cp6SopRunSwitches"
    });

    expect(sopCompleted.sopRuns[0]).toMatchObject({
      status: "completed"
    });
    expect(sopCompleted.timeline.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["recall.action_completed", "task.completed", "sop_run.completed"])
    );
  });

  it("advances lab cases and creates reconciliation without marking vendor invoices paid", () => {
    const sent = applyFixtureAdvanceLabCase(createFixtureCp6OperationsData("2026-07-07"), {
      actorName: "assistant fixture user",
      labCaseId: "cp6LabCaseCrown36",
      status: "sent_to_lab"
    });
    const returned = applyFixtureAdvanceLabCase(sent, {
      actorName: "assistant fixture user",
      labCaseId: "cp6LabCaseCrown36",
      status: "returned"
    });
    const completed = applyFixtureAdvanceLabCase(returned, {
      actorName: "assistant fixture user",
      labCaseId: "cp6LabCaseCrown36",
      status: "completed"
    });
    const reconciled = applyFixtureCreateLabReconciliation(completed, {
      caseIds: ["cp6LabCaseCrown36"],
      createdBy: "assistant fixture user",
      month: "2026-07"
    });

    expect(reconciled.labCases[0]).toMatchObject({
      status: "completed"
    });
    expect(reconciled.labReconciliations[0]).toMatchObject({
      expectedAmountCents: 180000,
      state: "created"
    });
    expect(JSON.stringify(reconciled.labReconciliations[0])).not.toMatch(/\bpaid\b/i);
  });

  it("records inventory variance and creates a procurement task without executing purchase", () => {
    const counted = applyFixtureRecordInventoryCount(createFixtureCp6OperationsData("2026-07-07"), {
      actorName: "assistant fixture user",
      checkRunId: "cp6InventoryRunDrawerA",
      counts: {
        cp6CompositeItem: 2,
        cp6MirrorItem: 12
      }
    });

    expect(counted.inventoryCheckRuns[0]).toMatchObject({
      status: "variance_review"
    });
    expect(counted.inventoryExceptions[0]).toMatchObject({
      status: "low_stock"
    });

    const requested = applyFixtureRequestProcurement(counted, {
      actorName: "assistant fixture user",
      exceptionId: counted.inventoryExceptions[0]!.id
    });

    expect(requested.inventoryExceptions[0]).toMatchObject({
      status: "procurement_requested"
    });
    expect(requested.tasks[0]).toMatchObject({
      kind: "procurement",
      status: "assigned"
    });
    expect(JSON.stringify(requested)).not.toMatch(/\bpurchased\b/i);
  });

  it("creates incidents and completes CAPA evidence", () => {
    const incidentData = applyFixtureCreateIncident(createFixtureCp6OperationsData("2026-07-07"), {
      category: "stockout",
      description: "Synthetic stockout event.",
      impact: "Procedure setup delayed.",
      learning: "Check drawer before clinic opens.",
      reportedBy: "owner fixture user"
    });
    const incident = incidentData.incidents[0]!;
    const capaData = applyFixtureCreateCorrectiveAction(incidentData, {
      assignedToName: "assistant fixture user",
      assignedToRole: "assistant",
      dueDate: "2026-07-07",
      incidentId: incident.id,
      title: "Update drawer checklist"
    });
    const completed = applyFixtureCompleteCorrectiveAction(capaData, {
      actorName: "assistant fixture user",
      completionNote: "Checklist updated and reviewed.",
      correctiveActionId: capaData.correctiveActions[0]!.id
    });

    expect(completed.correctiveActions[0]).toMatchObject({
      completionNote: "Checklist updated and reviewed.",
      status: "completed"
    });
    expect(completed.incidents[0]).toMatchObject({
      status: "closed"
    });
  });

  it("classifies missing CP6 route registration before runtime debugging", () => {
    expect(
      classifyCp6EndpointFailures([
        {
          endpoint: "HTTP /v1/recalls",
          message: "Not found",
          status: 404
        }
      ])
    ).toMatchObject({
      code: "CP6_ENDPOINT_NOT_REGISTERED",
      message:
        "One or more CP6 continuity endpoints are not registered in this environment. Check route registration and activation before debugging permissions or runtime state."
    });
  });

  it("uses the documented live CP6 route family", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/v1/tasks") && init?.method === "POST") {
        return jsonResponse({ task: { id: "task-1" } });
      }

      if (url.endsWith("/v1/tasks/task-1") && init?.method === "PATCH") {
        return jsonResponse({ task: { id: "task-1", status: "completed" } });
      }

      if (url.endsWith("/v1/recalls/recall-1/actions")) {
        return jsonResponse({ recall: { id: "recall-1", status: "action_completed" } });
      }

      if (url.endsWith("/v1/sop-runs/sop-1")) {
        return jsonResponse({ sopRun: { id: "sop-1", status: "completed" } });
      }

      if (url.endsWith("/v1/lab-cases/lab-1")) {
        return jsonResponse({ labCase: { id: "lab-1", status: "returned" } });
      }

      if (url.endsWith("/v1/lab-reconciliations")) {
        return jsonResponse({ reconciliation: { id: "recon-1" } });
      }

      if (url.endsWith("/v1/inventory/check-runs") && init?.method === "POST") {
        return jsonResponse({ checkRun: { id: "check-1" } });
      }

      if (url.endsWith("/v1/inventory/check-runs/check-1")) {
        return jsonResponse({ checkRun: { id: "check-1", status: "variance_review" } });
      }

      if (url.endsWith("/v1/incidents")) {
        return jsonResponse({ incident: { id: "incident-1" } });
      }

      if (url.endsWith("/v1/corrective-actions") && init?.method === "POST") {
        return jsonResponse({ correctiveAction: { id: "capa-1" } });
      }

      if (url.endsWith("/v1/corrective-actions/capa-1")) {
        return jsonResponse({ correctiveAction: { id: "capa-1", status: "completed" } });
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLiveTask({
      assignedToName: "assistant fixture user",
      assignedToRole: "assistant",
      detail: "Procurement task.",
      dueAt: "2026-07-07",
      kind: "procurement",
      source: "inventory_exception",
      title: "Procurement request"
    });
    await patchLiveTask("task-1", {
      completionEvidence: {
        actorName: "assistant fixture user",
        note: "Done"
      },
      status: "completed"
    });
    await completeLiveRecallAction({
      actorName: "assistant fixture user",
      detail: "Manual recall action.",
      recallId: "recall-1"
    });
    await patchLiveSopRun("sop-1", {
      actorName: "assistant fixture user",
      status: "completed"
    });
    await patchLiveLabCase({
      actorName: "assistant fixture user",
      labCaseId: "lab-1",
      status: "returned"
    });
    await createLiveLabReconciliation({
      caseIds: ["lab-1"],
      createdBy: "assistant fixture user",
      month: "2026-07"
    });
    await createLiveInventoryCheckRun({
      startedBy: "assistant fixture user",
      templateId: "drawer-a"
    });
    await patchLiveInventoryCheckRun({
      actorName: "assistant fixture user",
      checkRunId: "check-1",
      counts: {
        itemA: 2
      }
    });
    await createLiveIncident({
      category: "lab_delay",
      description: "Delay.",
      impact: "Late seating.",
      learning: "Call earlier.",
      reportedBy: "assistant fixture user"
    });
    await createLiveCorrectiveAction({
      assignedToName: "assistant fixture user",
      assignedToRole: "assistant",
      dueDate: "2026-07-07",
      incidentId: "incident-1",
      title: "Call lab earlier"
    });
    await patchLiveCorrectiveAction({
      actorName: "assistant fixture user",
      completionNote: "Done.",
      correctiveActionId: "capa-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "http://localhost/v1/tasks",
      "http://localhost/v1/tasks/task-1",
      "http://localhost/v1/recalls/recall-1/actions",
      "http://localhost/v1/sop-runs/sop-1",
      "http://localhost/v1/lab-cases/lab-1",
      "http://localhost/v1/lab-reconciliations",
      "http://localhost/v1/inventory/check-runs",
      "http://localhost/v1/inventory/check-runs/check-1",
      "http://localhost/v1/incidents",
      "http://localhost/v1/corrective-actions",
      "http://localhost/v1/corrective-actions/capa-1"
    ]);

    const recallBody = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(recallBody).toMatchObject({
      actionType: "manual_call_completed",
      providerDeliveryConfirmedAt: null
    });

    const inventoryBody = JSON.parse(fetchMock.mock.calls[7]?.[1]?.body as string);
    expect(inventoryBody).toMatchObject({
      counts: [
        {
          countedOnHand: 2,
          itemId: "itemA"
        }
      ],
      status: "variance_review"
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}
