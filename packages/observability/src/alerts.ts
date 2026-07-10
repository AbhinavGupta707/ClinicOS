export type OperationalAlertSeverity = "info" | "warning" | "critical";

export type OperationalAlertSignal =
  | "api_error_spike"
  | "auth_failure_spike"
  | "backup_failure"
  | "backup_freshness"
  | "backpressure"
  | "cache_failure"
  | "database_connection_saturation"
  | "media_quarantine_lag"
  | "media_scanner_failure"
  | "outbox_lag"
  | "payment_reconciliation_mismatch"
  | "provider_health"
  | "readiness_failure"
  | "security_anomaly"
  | "webhook_failure_spike"
  | "worker_down";

export type ProviderHealthSignalStatus =
  "available" | "degraded" | "not_configured" | "unavailable";

export interface OperationalAlertRule {
  readonly id: string;
  readonly signal: OperationalAlertSignal;
  readonly severity: OperationalAlertSeverity;
  readonly summary: string;
  readonly threshold: string;
  readonly runbookPath: string;
}

export interface ProviderHealthAlertSignal {
  readonly providerKey: string;
  readonly status: ProviderHealthSignalStatus;
  readonly checkedAt?: string;
  readonly mode?: string;
  readonly message?: string;
}

export interface ProviderHealthAlertOptions {
  readonly environment?: string;
  readonly expectedLiveProviders?: readonly string[];
}

export interface OperationalAlert {
  readonly id: string;
  readonly signal: OperationalAlertSignal;
  readonly severity: OperationalAlertSeverity;
  readonly summary: string;
  readonly runbookPath: string;
  readonly shouldPage: boolean;
  readonly details: Record<string, string | boolean | undefined>;
}

export interface OperationalSignalSample {
  readonly signal: OperationalAlertSignal;
  readonly value: number;
  readonly observedWindows: number;
}

export interface ProductionAlertDefinition {
  readonly id: string;
  readonly signal: OperationalAlertSignal;
  readonly severity: OperationalAlertSeverity;
  readonly comparison: "greater_than" | "greater_than_or_equal" | "less_than";
  readonly threshold: number;
  readonly requiredWindows: number;
  readonly page: boolean;
  readonly owner: "security" | "sre" | "identity" | "media" | "recovery" | "providers";
  readonly runbookPath: string;
}

export interface PagingConfiguration {
  readonly targetId?: string;
}

export interface EvaluatedOperationalAlert {
  readonly definitionId: string;
  readonly signal: OperationalAlertSignal;
  readonly severity: OperationalAlertSeverity;
  readonly state: "inactive" | "firing";
  readonly notificationState: "not_required" | "paging_target_unavailable" | "ready_to_dispatch";
  readonly runbookPath: string;
}

export const clinicOsProductionAlertDefinitions: readonly ProductionAlertDefinition[] = [
  productionAlert(
    "auth-failure-spike",
    "auth_failure_spike",
    "critical",
    "greater_than",
    0.05,
    2,
    true,
    "identity"
  ),
  productionAlert(
    "outbox-oldest-age",
    "outbox_lag",
    "critical",
    "greater_than",
    300,
    2,
    true,
    "sre"
  ),
  productionAlert(
    "provider-failure",
    "provider_health",
    "critical",
    "greater_than",
    0,
    2,
    true,
    "providers"
  ),
  productionAlert(
    "database-saturation",
    "database_connection_saturation",
    "critical",
    "greater_than",
    0.85,
    2,
    true,
    "sre"
  ),
  productionAlert("cache-failure", "cache_failure", "critical", "greater_than", 0, 1, true, "sre"),
  productionAlert(
    "backup-failure",
    "backup_failure",
    "critical",
    "greater_than",
    0,
    1,
    true,
    "recovery"
  ),
  productionAlert(
    "backup-freshness",
    "backup_freshness",
    "critical",
    "greater_than",
    900,
    1,
    true,
    "recovery"
  ),
  productionAlert(
    "security-anomaly",
    "security_anomaly",
    "critical",
    "greater_than",
    0,
    1,
    true,
    "security"
  ),
  productionAlert(
    "media-quarantine-lag",
    "media_quarantine_lag",
    "warning",
    "greater_than",
    600,
    2,
    false,
    "media"
  ),
  productionAlert(
    "media-scanner-failure",
    "media_scanner_failure",
    "critical",
    "greater_than",
    0,
    1,
    true,
    "media"
  ),
  productionAlert(
    "readiness-failure",
    "readiness_failure",
    "critical",
    "greater_than",
    0,
    2,
    true,
    "sre"
  ),
  productionAlert(
    "backpressure-not-ready",
    "backpressure",
    "critical",
    "greater_than_or_equal",
    3,
    1,
    true,
    "sre"
  )
];

export function evaluateOperationalAlerts(
  samples: readonly OperationalSignalSample[],
  paging: PagingConfiguration = {}
): EvaluatedOperationalAlert[] {
  const sampleBySignal = new Map(samples.map((sample) => [sample.signal, sample]));
  return clinicOsProductionAlertDefinitions.map((definition) => {
    const sample = sampleBySignal.get(definition.signal);
    const firing = Boolean(
      sample &&
      sample.observedWindows >= definition.requiredWindows &&
      compare(sample.value, definition.comparison, definition.threshold)
    );
    return {
      definitionId: definition.id,
      signal: definition.signal,
      severity: definition.severity,
      state: firing ? "firing" : "inactive",
      notificationState:
        !firing || !definition.page
          ? "not_required"
          : paging.targetId
            ? "ready_to_dispatch"
            : "paging_target_unavailable",
      runbookPath: definition.runbookPath
    };
  });
}

export const clinicOsOperationalAlertRules: readonly OperationalAlertRule[] = [
  {
    id: "api-error-spike",
    signal: "api_error_spike",
    severity: "critical",
    summary: "API 5xx/error rate exceeds the pilot-prod threshold.",
    threshold: "5xx rate above 2% for 5 minutes or sustained request failure from synthetic smoke.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "worker-down",
    signal: "worker_down",
    severity: "critical",
    summary: "Worker health endpoint or heartbeat is unavailable.",
    threshold: "No healthy worker heartbeat for 5 minutes.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "outbox-lag",
    signal: "outbox_lag",
    severity: "warning",
    summary: "Outbox backlog or oldest pending event exceeds operating threshold.",
    threshold: "Oldest pending event exceeds 15 minutes or dead-letter count increases.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "webhook-failure-spike",
    signal: "webhook_failure_spike",
    severity: "warning",
    summary: "Signed webhook verification or normalization failures increased.",
    threshold: "More than 5 webhook failures in 10 minutes per provider account.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "payment-reconciliation-mismatch",
    signal: "payment_reconciliation_mismatch",
    severity: "critical",
    summary: "Payment provider state differs from ClinicOS invoice/payment evidence.",
    threshold: "Any confirmed paid/provider-paid mismatch for pilot-prod.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "database-connection-saturation",
    signal: "database_connection_saturation",
    severity: "critical",
    summary: "Database connections approach exhaustion.",
    threshold: "Connection utilization above 85% for 5 minutes.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  },
  {
    id: "backup-failure",
    signal: "backup_failure",
    severity: "critical",
    summary: "Automated backup, PITR, or cross-region backup evidence is missing or failed.",
    threshold: "Any failed backup job or missing expected backup for the RPO window.",
    runbookPath: "infra/runbooks/backup-restore-drill.md"
  },
  {
    id: "provider-outage",
    signal: "provider_health",
    severity: "critical",
    summary: "Expected live provider is unavailable or has degraded capabilities.",
    threshold: "Provider health is degraded/unavailable for an expected live provider.",
    runbookPath: "infra/runbooks/provider-health-alerting.md"
  }
];

export function classifyProviderHealthAlerts(
  signals: readonly ProviderHealthAlertSignal[],
  options: ProviderHealthAlertOptions = {}
): OperationalAlert[] {
  return signals.flatMap((signal) => {
    const alert = classifyProviderHealthAlert(signal, options);
    return alert ? [alert] : [];
  });
}

export function classifyProviderHealthAlert(
  signal: ProviderHealthAlertSignal,
  options: ProviderHealthAlertOptions = {}
): OperationalAlert | null {
  if (signal.status === "available") return null;

  const providerKey = safeProviderKey(signal.providerKey);
  const productionLike = isProductionLike(options.environment);
  const expectedLive = new Set((options.expectedLiveProviders ?? []).map(safeProviderKey));
  const expected = expectedLive.has(providerKey);
  const shouldPage = expected && productionLike && signal.status !== "not_configured";
  const notConfiguredExpected = expected && productionLike && signal.status === "not_configured";
  const safeSignal = { ...signal, providerKey, message: undefined, mode: undefined };

  return {
    id: `provider-health:${providerKey}:${signal.status}`,
    signal: "provider_health",
    severity: providerHealthSeverity(signal.status, productionLike, expected),
    summary: providerHealthSummary(safeSignal, productionLike, expected),
    runbookPath: "infra/runbooks/provider-health-alerting.md",
    shouldPage: shouldPage || notConfiguredExpected,
    details: {
      providerKey,
      status: signal.status,
      checkedAt: safeCheckedAt(signal.checkedAt),
      expectedLiveProvider: expected,
      productionLike
    }
  };
}

function providerHealthSeverity(
  status: ProviderHealthSignalStatus,
  productionLike: boolean,
  expected: boolean
): OperationalAlertSeverity {
  if (status === "not_configured") {
    if (productionLike && expected) return "critical";
    if (productionLike) return "warning";
    return "info";
  }
  if (status === "degraded") return productionLike && expected ? "critical" : "warning";
  return productionLike ? "critical" : "warning";
}

function providerHealthSummary(
  signal: ProviderHealthAlertSignal,
  productionLike: boolean,
  expected: boolean
): string {
  const state = signal.status.replace("_", " ");
  if (signal.status === "not_configured" && !expected) {
    return `${signal.providerKey} is ${state}; keep the product in an honest unavailable/manual state.`;
  }
  if (signal.status === "not_configured" && expected && productionLike) {
    return `${signal.providerKey} is expected live but not configured. Complete activation before claiming provider readiness.`;
  }
  if (expected && productionLike) {
    return `${signal.providerKey} is ${state} for an expected live provider.`;
  }
  return `${signal.providerKey} is ${state}; investigate before enabling live workflows.`;
}

function isProductionLike(environment = "local") {
  return ["pilot-prod", "prod", "staging"].includes(environment);
}

function productionAlert(
  id: string,
  signal: OperationalAlertSignal,
  severity: OperationalAlertSeverity,
  comparison: ProductionAlertDefinition["comparison"],
  threshold: number,
  requiredWindows: number,
  page: boolean,
  owner: ProductionAlertDefinition["owner"]
): ProductionAlertDefinition {
  return {
    id,
    signal,
    severity,
    comparison,
    threshold,
    requiredWindows,
    page,
    owner,
    runbookPath: "infra/runbooks/cp14-observability-operations.md"
  };
}

function compare(
  value: number,
  comparison: ProductionAlertDefinition["comparison"],
  threshold: number
): boolean {
  if (comparison === "greater_than") return value > threshold;
  if (comparison === "greater_than_or_equal") return value >= threshold;
  return value < threshold;
}

function safeProviderKey(value: string): string {
  return /^[a-z][a-z0-9_.-]{1,63}$/u.test(value) ? value : "unknown";
}

function safeCheckedAt(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    ? value
    : undefined;
}
