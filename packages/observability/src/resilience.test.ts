import { describe, expect, it } from "vitest";
import { evaluateOperationalAlerts } from "./alerts.js";
import { evaluateBackpressure, evaluateReadinessSignals } from "./resilience.js";
import { evaluateErrorBudget } from "./slos.js";

describe("operational alert evaluation", () => {
  it("never claims paging delivery when a target is unavailable", () => {
    const alerts = evaluateOperationalAlerts([
      { signal: "auth_failure_spike", value: 0.2, observedWindows: 2 },
      { signal: "media_quarantine_lag", value: 900, observedWindows: 2 }
    ]);
    expect(alerts.find((alert) => alert.definitionId === "auth-failure-spike")).toMatchObject({
      state: "firing",
      notificationState: "paging_target_unavailable"
    });
    expect(alerts.find((alert) => alert.definitionId === "media-quarantine-lag")).toMatchObject({
      state: "firing",
      notificationState: "not_required"
    });
  });

  it("marks a firing page as ready to dispatch only after target configuration", () => {
    const alerts = evaluateOperationalAlerts(
      [{ signal: "backup_failure", value: 1, observedWindows: 1 }],
      { targetId: "oncall-primary" }
    );
    expect(alerts.find((alert) => alert.definitionId === "backup-failure")).toMatchObject({
      state: "firing",
      notificationState: "ready_to_dispatch"
    });
  });
});

describe("backpressure and readiness", () => {
  it("sheds noncritical work before it removes readiness", () => {
    expect(
      evaluateBackpressure({
        queueDepth: 1_500,
        dueNow: 500,
        oldestAgeSeconds: 450,
        deadLettered: 0,
        dependencyHealthy: true
      })
    ).toMatchObject({
      state: "shed_noncritical",
      readiness: "ready",
      acceptCritical: true,
      acceptNoncritical: false,
      workerConcurrencyPercent: 50
    });
  });

  it("removes readiness for dependency loss and exposes only bounded component names", () => {
    const backpressure = evaluateBackpressure({
      queueDepth: 2,
      dueNow: 0,
      oldestAgeSeconds: 0,
      deadLettered: 0,
      dependencyHealthy: false
    });
    expect(
      evaluateReadinessSignals(
        [
          { component: "postgres", required: true, state: "unhealthy" },
          { component: "provider:patient-123", required: false, state: "not_configured" }
        ],
        backpressure
      )
    ).toEqual({
      ready: false,
      state: "unhealthy",
      blockedComponents: ["postgres", "backpressure"],
      degradedComponents: ["unknown"]
    });
  });
});

describe("error budget evaluation", () => {
  it("freezes risky-change posture when the budget is exhausted", () => {
    expect(
      evaluateErrorBudget({
        objectiveId: "authenticated-clinic-operation-availability",
        totalEvents: 10_000,
        badEvents: 20
      })
    ).toMatchObject({
      state: "exhausted",
      consumedBadEvents: 20,
      remainingBadEvents: 0
    });
  });
});
