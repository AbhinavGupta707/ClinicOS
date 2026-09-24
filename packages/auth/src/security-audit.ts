const AUDIT_VALUE_PATTERN = /^[A-Za-z0-9._:@/-]{3,255}$/;
const DEDUPLICATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,384}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

interface RequiredSecurityAuditBase {
  schemaVersion: 1;
  occurredAt: string;
  deduplicationKey: string;
  subject: string;
  /** Verified application scope when the audit originates inside a clinic request. */
  tenantId?: string;
  clinicId?: string;
}

export type RequiredSecurityAuditIntent =
  | (RequiredSecurityAuditBase & {
      action: "auth.session.created" | "auth.session.rotated" | "auth.session.revoked";
      issuer: string;
      authorizedParty: string;
      reasonCode: string;
    })
  | (RequiredSecurityAuditBase & {
      action: "auth.refresh.replay_detected" | "auth.refresh.recovery_uncertain";
      issuer: string;
      authorizedParty: string;
      reasonCode: string;
    })
  | (RequiredSecurityAuditBase & {
      action: "auth.mfa.denied";
      issuer: string;
      authorizedParty: string;
      reasonCode: "privileged_role" | "break_glass" | "keycloak_admin";
      roleSlugs: readonly string[];
    })
  | (RequiredSecurityAuditBase & {
      action:
        "identity.joiner.completed" | "identity.mover.completed" | "identity.leaver.completed";
      tenantId: string;
      transition: "joiner" | "mover" | "leaver";
      commandId: string;
      reasonCode: "jml_completed";
    });

/** Production implementations persist this intent to a durable outbox before returning success. */
export interface RequiredSecurityAuditOutbox {
  readonly atomicity: "durable_transactional_outbox";
  persistRequired(intent: RequiredSecurityAuditIntent): Promise<void>;
}

export function validateRequiredSecurityAuditIntent(
  intent: RequiredSecurityAuditIntent
): RequiredSecurityAuditIntent {
  if (
    !intent ||
    typeof intent !== "object" ||
    Array.isArray(intent) ||
    intent.schemaVersion !== 1
  ) {
    throw new Error("Required security-audit schema is invalid.");
  }
  const authenticationActions = [
    "auth.session.created",
    "auth.session.rotated",
    "auth.session.revoked",
    "auth.refresh.replay_detected",
    "auth.refresh.recovery_uncertain",
    "auth.mfa.denied"
  ];
  const identityActions = [
    "identity.joiner.completed",
    "identity.mover.completed",
    "identity.leaver.completed"
  ];
  const isAuthentication = authenticationActions.includes(intent.action);
  if (!isAuthentication && !identityActions.includes(intent.action)) {
    throw new Error("Required security-audit action is invalid.");
  }
  const allowed = new Set([
    "schemaVersion",
    "occurredAt",
    "deduplicationKey",
    "subject",
    "tenantId",
    "clinicId",
    "action",
    "reasonCode",
    ...(isAuthentication ? ["issuer", "authorizedParty"] : ["transition", "commandId"]),
    ...(intent.action === "auth.mfa.denied" ? ["roleSlugs"] : [])
  ]);
  if (Object.keys(intent).some((key) => !allowed.has(key))) {
    throw new Error("Required security-audit contains unsupported fields.");
  }
  const occurredAt = new Date(intent.occurredAt);
  if (
    typeof intent.occurredAt !== "string" ||
    Number.isNaN(occurredAt.getTime()) ||
    occurredAt.toISOString() !== intent.occurredAt
  ) {
    throw new Error("Required security-audit occurrence time is invalid.");
  }
  if (
    typeof intent.deduplicationKey !== "string" ||
    !DEDUPLICATION_KEY_PATTERN.test(intent.deduplicationKey)
  ) {
    throw new Error("Required security-audit deduplication key is invalid.");
  }
  if (
    !safeAuditValue(intent.subject) ||
    typeof intent.reasonCode !== "string" ||
    !REASON_CODE_PATTERN.test(intent.reasonCode)
  ) {
    throw new Error("Required security-audit identity or reason is invalid.");
  }
  if (
    (intent.clinicId !== undefined && intent.tenantId === undefined) ||
    (intent.action === "auth.mfa.denied" &&
      (intent.tenantId === undefined) !== (intent.clinicId === undefined)) ||
    (intent.tenantId !== undefined && !safeAuditValue(intent.tenantId)) ||
    (intent.clinicId !== undefined && !safeAuditValue(intent.clinicId))
  ) {
    throw new Error("Required security-audit clinic scope is invalid.");
  }
  if (isAuthentication) {
    if (
      !("issuer" in intent) ||
      !safeAuditUrl(intent.issuer) ||
      !safeAuditValue(intent.authorizedParty)
    ) {
      throw new Error("Required authentication audit context is invalid.");
    }
  }
  if (intent.action === "auth.mfa.denied") {
    if (
      !Array.isArray(intent.roleSlugs) ||
      (intent.reasonCode === "privileged_role" && intent.roleSlugs.length === 0) ||
      intent.roleSlugs.length > 16 ||
      new Set(intent.roleSlugs).size !== intent.roleSlugs.length ||
      intent.roleSlugs.some(
        (role) => typeof role !== "string" || !REASON_CODE_PATTERN.test(role)
      ) ||
      !["privileged_role", "break_glass", "keycloak_admin"].includes(intent.reasonCode)
    ) {
      throw new Error("Required MFA-denial audit roles are invalid.");
    }
  }
  if (!isAuthentication) {
    if (
      !("transition" in intent) ||
      !safeAuditValue(intent.tenantId) ||
      !safeAuditValue(intent.commandId) ||
      intent.reasonCode !== "jml_completed" ||
      intent.action !== `identity.${intent.transition}.completed`
    ) {
      throw new Error("Required JML completion audit context is invalid.");
    }
  }
  // Copy an allowlisted canonical record; never retain caller-owned mutable arrays.
  const canonical = Object.fromEntries(
    Object.entries(intent)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  if (intent.action === "auth.mfa.denied")
    canonical.roleSlugs = Object.freeze([...intent.roleSlugs].sort());
  return Object.freeze(canonical) as unknown as RequiredSecurityAuditIntent;
}

export async function persistRequiredSecurityAudit(
  outbox: RequiredSecurityAuditOutbox,
  intent: RequiredSecurityAuditIntent
): Promise<void> {
  if (outbox.atomicity !== "durable_transactional_outbox") {
    throw new Error("Required security-audit outbox must be durable and transactional.");
  }
  await outbox.persistRequired(validateRequiredSecurityAuditIntent(intent));
}

/** Stable persisted payload. Raw deduplication material belongs only to the producer outbox. */
export function canonicalSecurityAuditPayload(
  raw: RequiredSecurityAuditIntent
): Readonly<Record<string, unknown>> {
  const intent = validateRequiredSecurityAuditIntent(raw);
  return Object.freeze({
    schemaVersion: intent.schemaVersion,
    action: intent.action,
    occurredAt: intent.occurredAt,
    subject: intent.subject,
    tenantId: intent.tenantId ?? null,
    clinicId: intent.clinicId ?? null,
    issuer: "issuer" in intent ? intent.issuer : null,
    authorizedParty: "authorizedParty" in intent ? intent.authorizedParty : null,
    reasonCode: intent.reasonCode,
    roleSlugs: intent.action === "auth.mfa.denied" ? intent.roleSlugs : [],
    transition: "transition" in intent ? intent.transition : null,
    commandId: "commandId" in intent ? intent.commandId : null
  });
}

function safeAuditValue(value: string): boolean {
  return (
    typeof value === "string" &&
    AUDIT_VALUE_PATTERN.test(value) &&
    !/(?:token|secret|password)=/i.test(value)
  );
}

function safeAuditUrl(value: string): boolean {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    ["https:", "http:"].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    value.length <= 512
  );
}
