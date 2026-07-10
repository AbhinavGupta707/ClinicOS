const AUDIT_VALUE_PATTERN = /^[A-Za-z0-9._:@/-]{3,255}$/;
const DEDUPLICATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,384}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

interface RequiredSecurityAuditBase {
  schemaVersion: 1;
  occurredAt: string;
  deduplicationKey: string;
  subject: string;
}

export type RequiredSecurityAuditIntent =
  | (RequiredSecurityAuditBase & {
      action: "auth.session.created" | "auth.session.rotated" | "auth.session.revoked";
      issuer: string;
      authorizedParty: string;
      reasonCode: string;
    })
  | (RequiredSecurityAuditBase & {
      action: "auth.refresh.replay_detected";
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
  const occurredAt = new Date(intent.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("Required security-audit occurrence time is invalid.");
  }
  if (!DEDUPLICATION_KEY_PATTERN.test(intent.deduplicationKey)) {
    throw new Error("Required security-audit deduplication key is invalid.");
  }
  if (!safeAuditValue(intent.subject) || !REASON_CODE_PATTERN.test(intent.reasonCode)) {
    throw new Error("Required security-audit identity or reason is invalid.");
  }
  if ("issuer" in intent) {
    if (!safeAuditUrl(intent.issuer) || !safeAuditValue(intent.authorizedParty)) {
      throw new Error("Required authentication audit context is invalid.");
    }
  }
  if (intent.action === "auth.mfa.denied") {
    if (
      intent.roleSlugs.length > 16 ||
      new Set(intent.roleSlugs).size !== intent.roleSlugs.length ||
      intent.roleSlugs.some((role) => !REASON_CODE_PATTERN.test(role))
    ) {
      throw new Error("Required MFA-denial audit roles are invalid.");
    }
  }
  if ("tenantId" in intent) {
    if (
      !safeAuditValue(intent.tenantId) ||
      !safeAuditValue(intent.commandId) ||
      intent.action !== `identity.${intent.transition}.completed`
    ) {
      throw new Error("Required JML completion audit context is invalid.");
    }
  }
  return Object.freeze(intent);
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

function safeAuditValue(value: string): boolean {
  return AUDIT_VALUE_PATTERN.test(value) && !/(?:token|secret|password)=/i.test(value);
}

function safeAuditUrl(value: string): boolean {
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
