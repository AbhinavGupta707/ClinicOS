import assert from "node:assert/strict";
import test from "node:test";
import { createAiGatewayProvider } from "../dist/index.js";

test("AI gateway simulator runs deterministically without provider keys", async () => {
  const provider = createAiGatewayProvider({
    llmProvider: "simulator",
    transcriptionProvider: "simulator",
    now: () => new Date("2026-07-07T10:00:00.000Z")
  });
  const request = {
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    patientId: "10000000-0000-4000-8000-000000010001",
    encounterId: "10000000-0000-4000-8000-000000030001",
    sessionId: "10000000-0000-4000-8000-000000080001",
    sourceAnchorIds: ["10000000-0000-4000-8000-000000081001"],
    correlationId: "cp8-ai-provider-test",
    segments: [
      {
        id: "10000000-0000-4000-8000-000000082001",
        sequence: 1,
        speakerRole: "doctor" as const,
        text: "Patient reports caries near tooth 36",
        startsAtMs: 0,
        endsAtMs: 2200
      }
    ]
  };

  const first = await provider.generateDrafts(request);
  const second = await provider.generateDrafts(request);
  assert.deepEqual(first, second);
  assert.equal(first.providerMode, "simulator");
  assert.equal(first.dentalChartPatchDraft.content.findings[0].toothNumber, "36");
});

test("AI gateway blocks non-simulator provider activation without explicit live approvals", async () => {
  const provider = createAiGatewayProvider({
    llmProvider: "openai",
    transcriptionProvider: "openai",
    openaiApiKey: "test-key",
    liveCallsEnabled: false,
    dataResidencyApproved: false
  });
  const health = await provider.healthCheck();
  assert.equal(health.status, "unavailable");
  assert.equal(provider.providerMode, "live_disabled");
  await assert.rejects(() => provider.generateDrafts({} as never), /Live AI\/STT calls are disabled/);
});
