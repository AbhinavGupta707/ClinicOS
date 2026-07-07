import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyCp10EndpointFailures,
  createFixtureCp10PilotReadinessPlan,
  loadCp10PilotReadiness,
  loadLiveCp10PilotReadiness
} from "@/lib/cp10-pilot-readiness";

describe("CP10 pilot readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps local pilot configuration ready while live go-live remains blocked", () => {
    const readiness = createFixtureCp10PilotReadinessPlan("2026-07-07");

    expect(readiness.localConfigurationStatus).toBe("ready");
    expect(readiness.pilotGoLiveStatus).toBe("blocked");
    expect(readiness.safety).toMatchObject({
      noLiveProviderActivation: true,
      noRealPhi: true,
      noSecretValues: true,
      syntheticOnly: true
    });
    expect(readiness.liveVerificationGaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining(["provider-whatsapp", "provider-razorpay", "ops-cloud-pilot-prod"])
    );
    expect(JSON.stringify(readiness)).not.toContain("Provider success confirmed");
    expect(JSON.stringify(readiness)).not.toContain("KEY_SECRET");
  });

  it("diagnoses missing CP10 route registration before permissions or runtime debugging", () => {
    expect(
      classifyCp10EndpointFailures([
        {
          endpoint: "GET /v1/pilot-readiness",
          message: "Not found",
          status: 404
        }
      ])
    ).toMatchObject({
      code: "CP10_ENDPOINT_NOT_REGISTERED",
      message:
        "The CP10 pilot readiness endpoint is not registered in this environment. Check route registration and official activation before debugging permissions or runtime state."
    });
  });

  it("uses fixture mode only when the explicit CP10 local fixture flag is active", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_USE_CP10_PILOT_FIXTURE", "true");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "local");

    const loaded = await loadCp10PilotReadiness(undefined, "2026-07-07");

    expect(loaded.status).toBe("ready");
    expect("data" in loaded ? loaded.data.source : null).toBe("cp10_fixture");
  });

  it("loads the documented live CP10 readiness route", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_API_BASE_URL", "http://localhost");
    const fixture = createFixtureCp10PilotReadinessPlan("2026-07-07");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe("http://localhost/v1/pilot-readiness");
      expect(init?.method).toBeUndefined();
      return jsonResponse({ readiness: fixture });
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadLiveCp10PilotReadiness();

    expect(loaded.status).toBe("ready");
    expect("data" in loaded ? loaded.data.source : null).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
