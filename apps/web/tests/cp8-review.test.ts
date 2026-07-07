import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyFixtureCp8ReviewDecision,
  createFixtureCp8ReviewData,
  getCp8PendingCount,
  getCp8RejectedRetainedCount,
  loadCp8Review,
  loadLiveCp8Review,
  submitLiveCp8ReviewDecision
} from "@/lib/cp8-review";

describe("CP8 AI review workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps source anchors and warnings visible for clinical claims", () => {
    const data = createFixtureCp8ReviewData("2026-07-07");
    const note = data.items.find((item) => item.kind === "clinical_note");

    expect(note).toMatchObject({
      confidence: expect.any(Number),
      requiredReviewer: "doctor",
      status: "pending_review"
    });
    expect(note?.warnings.length).toBeGreaterThan(0);
    expect(note?.importantClaimAnchorIds.length).toBeGreaterThan(0);
    expect(note?.importantClaimAnchorIds.every((anchorId) =>
      note.sourceAnchors.some((anchor) => anchor.id === anchorId)
    )).toBe(true);
  });

  it("prevents assistants from approving doctor-only note drafts", () => {
    const data = createFixtureCp8ReviewData("2026-07-07");

    expect(() =>
      applyFixtureCp8ReviewDecision(data, {
        actorName: "assistant fixture user",
        decision: "approve",
        detail: "Assistant attempted note approval.",
        itemId: "cp8ClinicalNoteDraft",
        roles: ["assistant"]
      })
    ).toThrow(/Doctor review is required/);
  });

  it("records doctor approval as review evidence only without fake application", () => {
    const data = createFixtureCp8ReviewData("2026-07-07");
    const next = applyFixtureCp8ReviewDecision(data, {
      actorName: "doctor fixture user",
      decision: "approve",
      detail: "Doctor reviewed the draft.",
      itemId: "cp8ClinicalNoteDraft",
      roles: ["doctor"]
    });
    const note = next.items.find((item) => item.id === "cp8ClinicalNoteDraft");

    expect(note).toMatchObject({
      applicationState: "not_applied_fixture",
      status: "approval_recorded"
    });
    expect(next.reviewAudit[0]?.detail).toContain("Review decision recorded only");
    expect(JSON.stringify(note)).not.toMatch(/\b(signed|sent|paid|delivered)\b/i);
  });

  it("retains rejected output for evaluation and audit", () => {
    const data = createFixtureCp8ReviewData("2026-07-07");
    const rejected = applyFixtureCp8ReviewDecision(data, {
      actorName: "assistant fixture user",
      decision: "reject",
      detail: "Assistant rejected low-confidence tooth patch.",
      itemId: "cp8DentalChartPatch",
      roles: ["assistant"]
    });

    expect(getCp8PendingCount(data)).toBe(3);
    expect(getCp8RejectedRetainedCount(rejected)).toBe(1);
    expect(rejected.items.find((item) => item.id === "cp8DentalChartPatch")).toMatchObject({
      retainedForEvaluation: true,
      status: "rejected"
    });
  });

  it("returns a whole-workflow unavailable state when no backend contract is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_USE_CP8_REVIEW_FIXTURE", "false");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "production");

    const state = await loadCp8Review();

    expect(state.status).toBe("unavailable");
    expect("problem" in state ? state.problem : null).toMatchObject({
      code: "CP8_REVIEW_CONTRACT_NOT_CONFIGURED"
    });
  });

  it("uses only the configured live queue path and backend-provided decision href", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url === "http://localhost/v1/ai/review-queue") {
        expect(init?.method).toBeUndefined();
        return jsonResponse({
          reviewItems: [
            {
              confidence: 0.84,
              encounterLabel: "Encounter",
              id: "liveNoteDraft",
              importantClaimAnchorIds: ["anchor1"],
              kind: "clinical_note",
              links: {
                reviewDecision: "/v1/ai/review-decisions/liveNoteDraft"
              },
              patientName: "Synthetic API patient",
              requiredReviewer: "doctor",
              retainedForEvaluation: true,
              sections: {
                assessment: "Draft assessment",
                chiefComplaint: "Pain",
                examination: "Exam",
                history: "History",
                plan: "Plan"
              },
              sourceAnchors: [
                {
                  excerpt: "Patient describes pain.",
                  id: "anchor1",
                  label: "Transcript",
                  timeRange: "00:01-00:04"
                }
              ],
              status: "pending_review",
              title: "Live note draft",
              warnings: ["Doctor must verify."]
            }
          ]
        });
      }

      if (url === "http://localhost/v1/ai/review-decisions/liveNoteDraft") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body).toMatchObject({
          decision: "approve",
          safetyConfirmation:
            "review_decision_only_no_clinical_application_without_backend_confirmation",
          source: "cp8_review_surface"
        });
        return jsonResponse({ reviewDecision: { status: "recorded" } });
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadLiveCp8Review("/v1/ai/review-queue", undefined, "2026-07-07");
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") {
      throw new Error("Expected live CP8 review data.");
    }
    await submitLiveCp8ReviewDecision(loaded.data.items[0]!, {
      actorName: "doctor fixture user",
      decision: "approve",
      detail: "Reviewed"
    });

    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "http://localhost/v1/ai/review-queue",
      "http://localhost/v1/ai/review-decisions/liveNoteDraft"
    ]);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}
