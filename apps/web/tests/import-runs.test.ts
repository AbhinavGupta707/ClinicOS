import { afterEach, describe, expect, it, vi } from "vitest";
import { createCp13ApiClient } from "../lib/cp13-api-client";
import {
  createLiveMigrationBatch,
  createFixtureCp7IntegrationOpsData,
  getInitialImportRunStep
} from "../lib/cp7-integration-ops";
import { importRunStorageKey, readImportRunId, loadImportRunWorkspace } from "../lib/import-runs";
import { createSyntheticMeFixture } from "../lib/dev-fixture";

const origin = "http://127.0.0.1:3000";
const runId = "00000000-0000-4000-8000-000000000001";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("operator import run boundaries", () => {
  it("reopens the first blocked or missing step without advancing an invalid-only file", () => {
    const batch = createFixtureCp7IntegrationOpsData().migrationBatches[0]!;
    expect(getInitialImportRunStep([])).toBe("patients");
    const committed = {
      ...batch,
      importType: "patients" as const,
      conflicts: [],
      counts: { ...batch.counts, committed: 1, ready: 0 }
    };
    expect(getInitialImportRunStep([committed])).toBe("practitioners");
    expect(
      getInitialImportRunStep([
        { ...committed, counts: { ...committed.counts, committed: 0, invalid: 1 } }
      ])
    ).toBe("patients");
  });

  it("isolates the resume pointer by tenant, clinic and user and rejects non-identifiers", () => {
    const profile = createSyntheticMeFixture();
    const key = importRunStorageKey(profile);
    for (const scope of ["tenant", "clinic", "user"] as const) {
      expect(
        importRunStorageKey({ ...profile, [scope]: { ...profile[scope], id: "other" } })
      ).not.toBe(key);
    }
    expect(readImportRunId({ getItem: () => runId }, key)).toBe(runId);
    for (const value of [
      null,
      "",
      '{"csv":"patient data"}',
      "https://other.test/run",
      "not-an-id"
    ]) {
      expect(readImportRunId({ getItem: () => value }, key)).toBeNull();
    }
    expect(
      readImportRunId(
        {
          getItem: () => {
            throw new Error("Storage disabled");
          }
        },
        key
      )
    ).toBeNull();
  });

  it("preserves saved progress when only the doctor lookup is unavailable", async () => {
    vi.stubGlobal("window", { location: { origin } });
    const client = createCp13ApiClient("clinic-1");
    const getImportRun = vi.spyOn(client, "getImportRun").mockResolvedValue({
      run: {
        id: runId,
        tenantId: "tenant",
        clinicId: "clinic",
        sourceSystem: "manual",
        createdAt: "2026-09-26T00:00:00Z",
        createdByUserId: "user"
      },
      batches: [],
      status: "awaiting_patients",
      reconciliation: {
        received: 0,
        valid: 0,
        invalid: 0,
        needsReview: 0,
        ready: 0,
        committed: 0,
        skipped: 0,
        rolledBack: 0,
        failed: 0,
        reconciled: 0,
        missingSourceAssessment: "unknown"
      }
    });
    vi.spyOn(client, "listClinicDoctors").mockRejectedValue(new Error("Unavailable"));
    expect(await loadImportRunWorkspace(client, runId)).toMatchObject({
      detail: { run: { id: runId } },
      doctors: [],
      doctorsUnavailable: true
    });
    getImportRun.mockRejectedValue(new Error("Run unavailable"));
    await expect(loadImportRunWorkspace(client, runId)).rejects.toThrow("Run unavailable");
  });

  it("uses registered cookie BFF routes, scoped pagination and a stable run identity", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT", "");
    vi.stubGlobal("window", { location: { origin }, dispatchEvent: vi.fn() });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return Response.json({ csrfToken: "c".repeat(43) });
      if (url.includes("/migration-batches"))
        return Response.json({ batch: { id: "batch-1" } }, { status: 201 });
      if (url.includes("?")) return Response.json({ runs: [], nextCursor: null });
      return Response.json({ run: { id: runId } });
    });
    vi.stubGlobal("fetch", fetch);
    const client = createCp13ApiClient("clinic-1");
    await client.createImportRun({
      headers: { "idempotency-key": runId },
      body: { id: runId, sourceSystem: "manual" }
    });
    await client.getImportRun({ path: { runId } });
    await client.listImportRuns({ query: { limit: 25, cursor: runId } });
    await createLiveMigrationBatch({
      importRunId: runId,
      sourceSystem: "manual",
      importType: "patients",
      csv: "external_reference,full_name\np1,Synthetic"
    });
    const business = fetch.mock.calls.filter(
      ([url]) => !String(url).endsWith("/auth/session")
    ) as unknown as [string, RequestInit][];
    expect(business.map(([url]) => new URL(url).pathname)).toEqual([
      "/bff/v1/migration-runs",
      `/bff/v1/migration-runs/${runId}`,
      "/bff/v1/migration-runs",
      "/bff/v1/migration-batches"
    ]);
    expect(new URL(business[2]![0]).searchParams.get("cursor")).toBe(runId);
    expect(new Headers(business[0]![1].headers).get("idempotency-key")).toBe(runId);
    expect(JSON.parse(String(business[3]![1].body)).importRunId).toBe(runId);
    for (const [, init] of business) {
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      expect(init.credentials).toBe("same-origin");
    }
  });
});
