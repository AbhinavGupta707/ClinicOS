export type OperationalAlertSeverity = "info" | "warning" | "critical";

export type OperationalAlertSignal =
  | "api_error_spike"
  | "backup_failure"
  | "database_connection_saturation"
  | "outbox_lag"
  | "payment_reconciliation_mismatch"
  | "provider_health"
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

  const productionLike = isProductionLike(options.environment);
  const expectedLive = new Set(options.expectedLiveProviders ?? []);
  const expected = expectedLive.has(signal.providerKey);
  const shouldPage = expected && productionLike && signal.status !== "not_configured";
  const notConfiguredExpected = expected && productionLike && signal.status === "not_configured";

  return {
    id: `provider-health:${signal.providerKey}:${signal.status}`,
    signal: "provider_health",
    severity: providerHealthSeverity(signal.status, productionLike, expected),
    summary: providerHealthSummary(signal, productionLike, expected),
    runbookPath: "infra/runbooks/provider-health-alerting.md",
    shouldPage: shouldPage || notConfiguredExpected,
    details: {
      providerKey: signal.providerKey,
      status: signal.status,
      mode: signal.mode,
      checkedAt: signal.checkedAt,
      message: signal.message,
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
