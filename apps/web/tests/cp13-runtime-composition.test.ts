import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clinicLocalDate,
  isCp13WorkspaceSurface,
  paymentIntentState
} from "../features/cp13/runtime-helpers";
import {
  ClinicOsSessionUnavailableError,
  createCp13ApiClient,
  registerClinicOsAccessTokenProvider
} from "../lib/cp13-api-client";
import { createSyntheticMeFixture } from "../lib/dev-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CP13 browser runtime composition", () => {
  it("uses a registration-only in-memory token boundary and fails closed after disposal", async () => {
    const requested: Array<{ authorization: string | null; clinic: string | null; credentials: string | null }> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requested.push({
        authorization: headers.get("authorization"),
        clinic: headers.get("x-clinic-id"),
        credentials: init?.credentials ?? null
      });
      return new Response(JSON.stringify({ procedures: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "cp13-web-request" }
      });
    });
    vi.stubGlobal("window", { location: { origin: "https://clinic.example" } });
    vi.stubGlobal("fetch", fetchImpl);

    const dispose = registerClinicOsAccessTokenProvider(() => "memory-only-access-token");
    const client = createCp13ApiClient("00000000-0000-4000-8000-000000000002");
    await client.listPricebookProcedures();
    expect(requested).toEqual([
      {
        authorization: "Bearer memory-only-access-token",
        clinic: "00000000-0000-4000-8000-000000000002",
        credentials: "include"
      }
    ]);

    dispose();
    await expect(client.listPricebookProcedures()).rejects.toBeInstanceOf(
      ClinicOsSessionUnavailableError
    );
  });

  it("uses the durable seed scope only when the local identity fixture is explicitly enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE", "true");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "local");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_DEV_ROLE", "owner");
    const requested: Array<{ authorization: string | null; clinic: string | null }> = [];
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:3000" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requested.push({
          authorization: headers.get("authorization"),
          clinic: headers.get("x-clinic-id")
        });
        return new Response(JSON.stringify({ procedures: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const profile = createSyntheticMeFixture();
    expect(profile).toMatchObject({
      clinic: { id: "10000000-0000-4000-8000-000000000101" },
      tenant: { id: "10000000-0000-4000-8000-000000000001" },
      user: { id: "10000000-0000-4000-8000-000000001001" }
    });

    await createCp13ApiClient(profile.clinic.id).listPricebookProcedures();
    expect(requested).toEqual([
      {
        authorization: "Bearer local-synthetic-fixture",
        clinic: "10000000-0000-4000-8000-000000000101"
      }
    ]);
  });

  it("selects the clinic-local date across a UTC day boundary", () => {
    const instant = new Date("2026-07-10T20:30:00.000Z");
    expect(clinicLocalDate(instant, "Asia/Kolkata")).toBe("2026-07-11");
    expect(clinicLocalDate(instant, "America/Los_Angeles")).toBe("2026-07-10");
    expect(() => clinicLocalDate(instant, "Not/A_Timezone")).toThrow(RangeError);
  });

  it("never presents a newly recorded provider intent as payment confirmation", () => {
    expect(paymentIntentState({ paymentIntent: { status: "pending_provider_request" } })).toEqual({
      status: "pending",
      message:
        "Payment intent recorded as pending provider request. This is not payment confirmation."
    });
  });

  it("mounts active CP13 surfaces without persisting resource identifiers in URLs or storage", () => {
    expect(isCp13WorkspaceSurface("patients")).toBe(true);
    expect(isCp13WorkspaceSurface("encounter")).toBe(true);
    expect(isCp13WorkspaceSurface("accounting")).toBe(true);
    expect(isCp13WorkspaceSurface("owner-control")).toBe(true);

    const workspace = readFileSync(
      new URL("../features/cp13/Cp13Workspace.tsx", import.meta.url),
      "utf8"
    );
    const authBoundary = readFileSync(new URL("../lib/cp13-api-client.ts", import.meta.url), "utf8");
    expect(workspace).not.toContain('method="get"');
    expect(workspace).not.toMatch(/URLSearchParams|searchParams|localStorage|sessionStorage/);
    expect(authBoundary).not.toMatch(/localStorage|sessionStorage|NEXT_PUBLIC_.*TOKEN/);
    expect(authBoundary).toContain("SESSION_TOKEN_PROVIDER_UNAVAILABLE");
  });
});
