import { describe, expect, it } from "vitest";
import { HealthRegistry, createHealthCheckResult } from "./health.js";

describe("PHI-safe health reports", () => {
  it("allowlists bounded health details and removes provider accounts and free text", () => {
    const result = createHealthCheckResult("provider_health:media", "unhealthy", {
      observedAt: { toISOString: () => "2026-07-10T00:00:00.000Z" } as Date,
      message: "patient Rhea scanner failed with secret token",
      details: {
        providerKey: "media_scanner",
        accountId: "provider-account-secret",
        latencyMs: 42,
        signedUrl: "https://storage.example/object?signature=secret"
      }
    });
    expect(result).toEqual({
      name: "provider_health:media",
      status: "unhealthy",
      observedAt: "2026-07-10T00:00:00.000Z",
      message: "health_detail_available",
      details: { providerKey: "media_scanner", latencyMs: 42 }
    });
    expect(JSON.stringify(result)).not.toMatch(/Rhea|secret|signedUrl|accountId/u);
  });

  it("converts thrown dependency details to a bounded health code", async () => {
    const registry = new HealthRegistry("clinic-os-worker");
    registry.register({
      name: "postgres",
      check: async () => {
        throw new Error("password=secret patient Rhea");
      }
    });
    const report = await registry.report();
    expect(report.checks[0]?.message).toBe("health_check_failed");
    expect(JSON.stringify(report)).not.toMatch(/password|secret|Rhea/u);
  });
});
