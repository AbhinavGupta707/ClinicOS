export type SloIndicatorKind = "availability" | "latency" | "freshness" | "durability";

export interface ServiceLevelObjective {
  readonly id: string;
  readonly journey: string;
  readonly indicator: SloIndicatorKind;
  readonly target: number;
  readonly windowDays: number;
  readonly measurement: string;
  readonly errorBudgetPolicy: "freeze_risky_changes" | "incident_review" | "capacity_review";
}

export interface SloObservation {
  readonly objectiveId: string;
  readonly totalEvents: number;
  readonly badEvents: number;
}

export interface ErrorBudgetEvaluation {
  readonly objectiveId: string;
  readonly allowedBadEvents: number;
  readonly consumedBadEvents: number;
  readonly remainingBadEvents: number;
  readonly consumedRatio: number;
  readonly state: "healthy" | "at_risk" | "exhausted" | "insufficient_data";
}

export const clinicOsServiceLevelObjectives: readonly ServiceLevelObjective[] = [
  slo(
    "authenticated-clinic-operation-availability",
    "Authenticated clinic operation",
    "availability",
    0.999,
    28,
    "Successful non-user-error responses / eligible requests",
    "freeze_risky_changes"
  ),
  slo(
    "authenticated-clinic-operation-latency",
    "Authenticated clinic operation",
    "latency",
    0.99,
    28,
    "Requests completed within the route-family latency objective",
    "capacity_review"
  ),
  slo(
    "identity-session-availability",
    "Identity login and session refresh",
    "availability",
    0.999,
    28,
    "Successful valid authentication outcomes / eligible attempts",
    "freeze_risky_changes"
  ),
  slo(
    "outbox-freshness",
    "Durable outbox processing",
    "freshness",
    0.999,
    28,
    "Events completed within 300 seconds / due events",
    "incident_review"
  ),
  slo(
    "provider-callback-freshness",
    "Signed provider callback processing",
    "freshness",
    0.995,
    28,
    "Callbacks reconciled within 300 seconds / verified callbacks",
    "incident_review"
  ),
  slo(
    "media-quarantine-freshness",
    "Media quarantine scanning",
    "freshness",
    0.995,
    28,
    "Uploads scanned within 600 seconds / completed uploads",
    "incident_review"
  ),
  slo(
    "backup-recoverability",
    "Backup and recovery evidence",
    "durability",
    1,
    28,
    "Successful scheduled backups and current restore evidence / required recovery controls",
    "freeze_risky_changes"
  )
];

export function evaluateErrorBudget(observation: SloObservation): ErrorBudgetEvaluation {
  const objective = clinicOsServiceLevelObjectives.find(
    (candidate) => candidate.id === observation.objectiveId
  );
  if (!objective) throw new Error("SLO_OBJECTIVE_NOT_FOUND");
  if (
    !Number.isSafeInteger(observation.totalEvents) ||
    !Number.isSafeInteger(observation.badEvents) ||
    observation.totalEvents < 0 ||
    observation.badEvents < 0 ||
    observation.badEvents > observation.totalEvents
  ) {
    throw new Error("SLO_OBSERVATION_INVALID");
  }
  if (observation.totalEvents === 0) {
    return {
      objectiveId: objective.id,
      allowedBadEvents: 0,
      consumedBadEvents: 0,
      remainingBadEvents: 0,
      consumedRatio: 0,
      state: "insufficient_data"
    };
  }
  const allowedBadEvents = Math.max(
    0,
    Math.floor(observation.totalEvents * (1 - objective.target))
  );
  const consumedRatio =
    allowedBadEvents === 0
      ? observation.badEvents === 0
        ? 0
        : Number.MAX_SAFE_INTEGER
      : observation.badEvents / allowedBadEvents;
  return {
    objectiveId: objective.id,
    allowedBadEvents,
    consumedBadEvents: observation.badEvents,
    remainingBadEvents: Math.max(0, allowedBadEvents - observation.badEvents),
    consumedRatio,
    state:
      observation.badEvents > allowedBadEvents
        ? "exhausted"
        : consumedRatio >= 0.8
          ? "at_risk"
          : "healthy"
  };
}

function slo(
  id: string,
  journey: string,
  indicator: SloIndicatorKind,
  target: number,
  windowDays: number,
  measurement: string,
  errorBudgetPolicy: ServiceLevelObjective["errorBudgetPolicy"]
): ServiceLevelObjective {
  return { id, journey, indicator, target, windowDays, measurement, errorBudgetPolicy };
}
