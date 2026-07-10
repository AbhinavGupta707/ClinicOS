export type BackpressureState = "normal" | "constrained" | "shed_noncritical" | "not_ready";

export interface BackpressureObservation {
  readonly queueDepth: number;
  readonly dueNow: number;
  readonly oldestAgeSeconds: number;
  readonly deadLettered: number;
  readonly dependencyHealthy: boolean;
}

export interface BackpressurePolicy {
  readonly constrainedDepth: number;
  readonly shedDepth: number;
  readonly notReadyDepth: number;
  readonly constrainedAgeSeconds: number;
  readonly shedAgeSeconds: number;
  readonly notReadyAgeSeconds: number;
}

export interface BackpressureDecision {
  readonly state: BackpressureState;
  readonly readiness: "ready" | "not_ready";
  readonly acceptCritical: boolean;
  readonly acceptNoncritical: boolean;
  readonly workerConcurrencyPercent: 25 | 50 | 100;
  readonly reasons: readonly string[];
}

export const defaultBackpressurePolicy: BackpressurePolicy = {
  constrainedDepth: 250,
  shedDepth: 1_000,
  notReadyDepth: 5_000,
  constrainedAgeSeconds: 120,
  shedAgeSeconds: 300,
  notReadyAgeSeconds: 900
};

export function evaluateBackpressure(
  observation: BackpressureObservation,
  policy: BackpressurePolicy = defaultBackpressurePolicy
): BackpressureDecision {
  validateBackpressureObservation(observation);
  const reasons: string[] = [];
  if (!observation.dependencyHealthy) reasons.push("dependency_unhealthy");
  if (observation.deadLettered > 0) reasons.push("dead_letter_present");
  if (observation.queueDepth >= policy.notReadyDepth) reasons.push("queue_depth_not_ready");
  if (observation.oldestAgeSeconds >= policy.notReadyAgeSeconds)
    reasons.push("queue_age_not_ready");
  if (reasons.some((reason) => reason === "dependency_unhealthy" || reason.endsWith("not_ready"))) {
    return decision("not_ready", reasons);
  }
  if (observation.queueDepth >= policy.shedDepth) reasons.push("queue_depth_shed");
  if (observation.oldestAgeSeconds >= policy.shedAgeSeconds) reasons.push("queue_age_shed");
  if (reasons.some((reason) => reason.endsWith("_shed"))) {
    return decision("shed_noncritical", reasons);
  }
  if (observation.queueDepth >= policy.constrainedDepth) reasons.push("queue_depth_constrained");
  if (observation.oldestAgeSeconds >= policy.constrainedAgeSeconds)
    reasons.push("queue_age_constrained");
  if (reasons.length > 0) return decision("constrained", reasons);
  return decision("normal", []);
}

export interface ReadinessDependencySignal {
  readonly component: string;
  readonly required: boolean;
  readonly state: "healthy" | "degraded" | "unhealthy" | "not_configured";
}

export interface ReadinessDecision {
  readonly ready: boolean;
  readonly state: "healthy" | "degraded" | "unhealthy";
  readonly blockedComponents: readonly string[];
  readonly degradedComponents: readonly string[];
}

export function evaluateReadinessSignals(
  dependencies: readonly ReadinessDependencySignal[],
  backpressure: BackpressureDecision
): ReadinessDecision {
  const blockedComponents = dependencies
    .filter(
      (dependency) =>
        dependency.required && ["unhealthy", "not_configured"].includes(dependency.state)
    )
    .map((dependency) => safeComponent(dependency.component));
  if (backpressure.readiness === "not_ready") blockedComponents.push("backpressure");
  const degradedComponents = dependencies
    .filter(
      (dependency) =>
        dependency.state === "degraded" ||
        (!dependency.required && dependency.state === "not_configured")
    )
    .map((dependency) => safeComponent(dependency.component));
  return {
    ready: blockedComponents.length === 0,
    state:
      blockedComponents.length > 0
        ? "unhealthy"
        : degradedComponents.length > 0 || backpressure.state !== "normal"
          ? "degraded"
          : "healthy",
    blockedComponents,
    degradedComponents
  };
}

function decision(state: BackpressureState, reasons: readonly string[]): BackpressureDecision {
  if (state === "not_ready") {
    return {
      state,
      readiness: "not_ready",
      acceptCritical: false,
      acceptNoncritical: false,
      workerConcurrencyPercent: 25,
      reasons
    };
  }
  if (state === "shed_noncritical") {
    return {
      state,
      readiness: "ready",
      acceptCritical: true,
      acceptNoncritical: false,
      workerConcurrencyPercent: 50,
      reasons
    };
  }
  return {
    state,
    readiness: "ready",
    acceptCritical: true,
    acceptNoncritical: true,
    workerConcurrencyPercent: state === "constrained" ? 50 : 100,
    reasons
  };
}

function validateBackpressureObservation(observation: BackpressureObservation): void {
  for (const value of [
    observation.queueDepth,
    observation.dueNow,
    observation.oldestAgeSeconds,
    observation.deadLettered
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("BACKPRESSURE_OBSERVATION_INVALID");
  }
}

function safeComponent(component: string): string {
  return /^[a-z][a-z0-9_.-]{1,63}$/u.test(component) ? component : "unknown";
}
