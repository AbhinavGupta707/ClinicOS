import { describe, expect, it } from "vitest";

import {
  classifyProviderHealthAlert,
  classifyProviderHealthAlerts,
  clinicOsOperationalAlertRules
} from "./alerts.js";

describe("classifyProviderHealthAlert", () => {
  it("does not alert for available providers", () => {
    expect(
      classifyProviderHealthAlert({
        providerKey: "manual_import",
        status: "available"
      })
    ).toBeNull();
  });

  it("keeps local not-configured providers informational and non-paging", () => {
    const alert = classifyProviderHealthAlert(
      {
        providerKey: "razorpay",
        status: "not_configured",
        mode: "not configured"
      },
      { environment: "local" }
    );

    expect(alert).toMatchObject({
      severity: "info",
      shouldPage: false
    });
    expect(alert?.summary).toContain("honest unavailable/manual state");
  });

  it("pages for expected live provider outages in pilot-prod", () => {
    const alert = classifyProviderHealthAlert(
      {
        providerKey: "whatsapp_cloud",
        status: "unavailable",
        message: "signed webhook callback is unreachable"
      },
      { environment: "pilot-prod", expectedLiveProviders: ["whatsapp_cloud"] }
    );

    expect(alert).toMatchObject({
      severity: "critical",
      shouldPage: true
    });
    expect(alert?.details.expectedLiveProvider).toBe(true);
  });

  it("classifies multiple provider signals without successful-provider noise", () => {
    const alerts = classifyProviderHealthAlerts(
      [
        { providerKey: "manual_import", status: "available" },
        { providerKey: "exotel", status: "degraded" }
      ],
      { environment: "staging" }
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe("provider-health:exotel:degraded");
  });
});

describe("clinicOsOperationalAlertRules", () => {
  it("includes CP9 backup and provider-health alert runbooks", () => {
    expect(clinicOsOperationalAlertRules.map((rule) => rule.signal)).toEqual(
      expect.arrayContaining(["backup_failure", "provider_health", "outbox_lag"])
    );
    expect(
      clinicOsOperationalAlertRules.find((rule) => rule.signal === "backup_failure")?.runbookPath
    ).toBe("infra/runbooks/backup-restore-drill.md");
  });
});
