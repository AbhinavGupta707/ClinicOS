import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  loadContinuityOperationsOverview,
  type ContinuityOperationsGeneratedClient
} from "../features/cp13/continuity-operations/loader";

const observedAt = new Date("2026-07-10T12:00:00.000Z");

describe("CP13 continuity operations generated-client loader", () => {
  it("loads independent durable reads and reports fresh owner analytics", async () => {
    const client = generatedClientDouble(freshDashboard());
    const state = await loadContinuityOperationsOverview(client, {
      from: "2026-07-01",
      to: "2026-07-10",
      observedAt
    });
    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("Expected ready state");
    expect(state.data.freshness).toMatchObject({
      status: "fresh",
      generatedAt: "2026-07-10T11:59:59.000Z",
      rebuildSupported: false
    });
    expect(Object.values(client).every((method) => vi.mocked(method).mock.calls.length === 1)).toBe(
      true
    );
  });

  it("does not present stale analytics as fresh", async () => {
    const state = await loadContinuityOperationsOverview(
      generatedClientDouble({
        freshness: {
          status: "stale",
          generatedAt: "2026-07-10T11:00:00.000Z",
          staleAfterSeconds: 300,
          unavailableSources: []
        }
      }),
      { from: "2026-07-01", to: "2026-07-10", observedAt }
    );
    expect(state.status).toBe("stale");
    if (state.status !== "stale") throw new Error("Expected stale state");
    expect(state.data.freshness.status).toBe("stale");
  });

  it("returns an honest unavailable state when a durable analytics source is unavailable", async () => {
    const state = await loadContinuityOperationsOverview(
      generatedClientDouble({
        freshness: {
          status: "unavailable",
          generatedAt: "2026-07-10T11:59:59.000Z",
          staleAfterSeconds: 300,
          unavailableSources: ["continuity-operations"]
        }
      }),
      { from: "2026-07-01", to: "2026-07-10", observedAt }
    );
    expect(state).toMatchObject({
      status: "unavailable",
      problem: { code: "ANALYTICS_SOURCE_UNAVAILABLE" }
    });
  });

  it("classifies generated-client permission denial without returning cached or fixture data", async () => {
    const client = generatedClientDouble(freshDashboard());
    vi.mocked(client.getOwnerDashboard).mockRejectedValue({
      status: 403,
      code: "PERMISSION_DENIED",
      message: "The verified identity is not authorized for this operation.",
      requestId: "request-denied",
      responseMetadata: { retryAfterSeconds: null }
    });
    const state = await loadContinuityOperationsOverview(client, {
      from: "2026-07-01",
      to: "2026-07-10",
      observedAt
    });
    expect(state).toMatchObject({
      status: "unauthenticated",
      problem: { code: "PERMISSION_DENIED", requestId: "request-denied" }
    });
    expect("data" in state).toBe(false);
  });

  it("contains no production fixture fallback or handwritten fetch transport", () => {
    const source = readFileSync(
      new URL("../features/cp13/continuity-operations/loader.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/fixture|fallback/i);
    for (const method of [
      "getOwnerDashboard",
      "listTasks",
      "listRecalls",
      "listSopRuns",
      "listLabCases",
      "listInventoryItems",
      "listInventoryExceptions",
      "listIncidents",
      "listCorrectiveActions"
    ]) {
      expect(source).toContain(`client.${method}`);
    }
  });

  it("runs through the real CP12 generated client route family", async () => {
    const requested: Array<{ url: string; authorization: string | null; clinic: string | null }> =
      [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      requested.push({
        url,
        authorization: headers.get("authorization"),
        clinic: headers.get("x-clinic-id")
      });
      return responseFor(url);
    });
    const moduleName = "@clinic-os/api-client-generated";
    const generated = (await import(moduleName)) as {
      ClinicOsApiClient: new (input: {
        baseUrl: string;
        clinicId: string;
        getAccessToken: () => string;
        fetchImpl: typeof fetch;
      }) => ContinuityOperationsGeneratedClient;
    };
    const client = new generated.ClinicOsApiClient({
      baseUrl: "https://api.test",
      clinicId: "00000000-0000-4000-8000-000000000002",
      getAccessToken: () => "access-token",
      fetchImpl
    });
    const state = await loadContinuityOperationsOverview(client, {
      from: "2026-07-01",
      to: "2026-07-10",
      observedAt
    });
    expect(state.status).toBe("ready");
    expect(requested).toHaveLength(9);
    expect(requested.map((request) => new URL(request.url).pathname)).toEqual(
      expect.arrayContaining([
        "/v1/owner-dashboard",
        "/v1/tasks",
        "/v1/recalls",
        "/v1/sop-runs",
        "/v1/lab-cases",
        "/v1/inventory/items",
        "/v1/inventory/exceptions",
        "/v1/incidents",
        "/v1/corrective-actions"
      ])
    );
    expect(requested.every((request) => request.authorization === "Bearer access-token")).toBe(
      true
    );
    expect(
      requested.every((request) => request.clinic === "00000000-0000-4000-8000-000000000002")
    ).toBe(true);
  });
});

function generatedClientDouble(
  dashboard: Record<string, unknown>
): ContinuityOperationsGeneratedClient {
  return {
    getOwnerDashboard: vi.fn(async () => ({ dashboard: dashboard as never })),
    listTasks: vi.fn(async () => ({ tasks: [] })),
    listRecalls: vi.fn(async () => ({ recalls: [] })),
    listSopRuns: vi.fn(async () => ({ sopRuns: [] })),
    listLabCases: vi.fn(async () => ({ labCases: [] })),
    listInventoryItems: vi.fn(async () => ({ items: [] })),
    listInventoryExceptions: vi.fn(async () => ({ exceptions: [] })),
    listIncidents: vi.fn(async () => ({ incidents: [] })),
    listCorrectiveActions: vi.fn(async () => ({ correctiveActions: [] }))
  };
}

function freshDashboard() {
  return {
    freshness: {
      status: "fresh",
      generatedAt: "2026-07-10T11:59:59.000Z",
      staleAfterSeconds: 300,
      unavailableSources: []
    }
  };
}

function responseFor(url: string): Response {
  const path = new URL(url).pathname;
  const body =
    path === "/v1/owner-dashboard"
      ? { dashboard: freshDashboard() }
      : path === "/v1/tasks"
        ? { tasks: [] }
        : path === "/v1/recalls"
          ? { recalls: [] }
          : path === "/v1/sop-runs"
            ? { sopRuns: [] }
            : path === "/v1/lab-cases"
              ? { labCases: [] }
              : path === "/v1/inventory/items"
                ? { items: [] }
                : path === "/v1/inventory/exceptions"
                  ? { exceptions: [] }
                  : path === "/v1/incidents"
                    ? { incidents: [] }
                    : { correctiveActions: [] };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": `request-${path}` }
  });
}
