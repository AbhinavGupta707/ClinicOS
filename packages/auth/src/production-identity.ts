import type { ClinicRoleSlug } from "@clinic-os/domain";
import {
  AuthenticationError,
  type AuthenticatedPrincipal,
  type KeycloakAccessTokenClaims
} from "./keycloak.ts";
import {
  persistRequiredSecurityAudit,
  validateRequiredSecurityAuditIntent,
  type RequiredSecurityAuditIntent,
  type RequiredSecurityAuditOutbox
} from "./security-audit.ts";

const TOKEN_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;
const MFA_METHODS = new Set(["otp", "totp", "webauthn", "webauthn-passwordless", "hwk", "mfa"]);
const PRIVILEGED_ROLES = new Set<ClinicRoleSlug>(["owner_admin", "platform_admin"]);

export interface ProductionAuthenticatedPrincipal extends AuthenticatedPrincipal {
  authorizedParty: string;
  tokenId: string;
  keycloakSessionId: string;
  issuedAt: string;
  expiresAt: string;
  authTime: string | null;
  acr: string | null;
  amr: string[];
}

export interface ProductionTokenValidationOptions {
  expectedIssuer: string;
  requiredAudience: string;
  acceptedAuthorizedParties: readonly string[];
  now: Date;
  clockSkewSeconds?: number;
  maximumAccessTokenLifetimeSeconds?: number;
}

export function principalFromProductionKeycloakClaims(
  claims: KeycloakAccessTokenClaims,
  options: ProductionTokenValidationOptions
): ProductionAuthenticatedPrincipal {
  const now = trustedInstant(options.now, "token validation time");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  const maximumLifetime = options.maximumAccessTokenLifetimeSeconds ?? 300;
  if (!Number.isSafeInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 60) {
    throw new Error("Token clock skew must be between 0 and 60 seconds.");
  }
  if (!Number.isSafeInteger(maximumLifetime) || maximumLifetime < 60 || maximumLifetime > 600) {
    throw new Error("Access-token maximum lifetime must be between 60 and 600 seconds.");
  }
  if (!claims.sub) throw new AuthenticationError("Keycloak token is missing subject.");
  if (claims.iss !== options.expectedIssuer) {
    throw new AuthenticationError("Keycloak issuer is not accepted.");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(options.requiredAudience)) {
    throw new AuthenticationError("Keycloak API audience is not accepted.");
  }
  if (!claims.azp || !options.acceptedAuthorizedParties.includes(claims.azp)) {
    throw new AuthenticationError("Keycloak authorized party is not accepted.");
  }
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    throw new AuthenticationError("Keycloak token is missing valid issued-at or expiry claims.");
  }
  if (claims.iat! - clockSkewSeconds > nowSeconds) {
    throw new AuthenticationError("Keycloak token issued-at time is in the future.");
  }
  if (claims.exp + clockSkewSeconds <= nowSeconds) {
    throw new AuthenticationError("Keycloak token is expired.");
  }
  if (claims.exp - claims.iat! > maximumLifetime) {
    throw new AuthenticationError("Keycloak access-token lifetime exceeds policy.");
  }
  if (claims.nbf !== undefined && claims.nbf - clockSkewSeconds > nowSeconds) {
    throw new AuthenticationError("Keycloak token is not valid yet.");
  }
  if (claims.typ !== "Bearer") {
    throw new AuthenticationError("Only Keycloak bearer access tokens are accepted.");
  }
  if (!claims.jti || !TOKEN_IDENTIFIER_PATTERN.test(claims.jti)) {
    throw new AuthenticationError("Keycloak token id is missing or malformed.");
  }
  const keycloakSessionId = claims.sid ?? claims.session_state;
  if (!keycloakSessionId || !TOKEN_IDENTIFIER_PATTERN.test(keycloakSessionId)) {
    throw new AuthenticationError("Keycloak session id is missing or malformed.");
  }

  const resourceRoles = Object.values(claims.resource_access ?? {}).flatMap(
    (resource) => resource.roles ?? []
  );
  const keycloakRoles = [
    ...new Set([...(claims.realm_access?.roles ?? []), ...resourceRoles])
  ].sort();
  const amr = normalizeAuthenticationMethods(claims.amr ?? []);

  return {
    subject: claims.sub,
    issuer: claims.iss,
    email: claims.email ?? null,
    displayName: claims.name ?? claims.preferred_username ?? null,
    username: claims.preferred_username ?? null,
    keycloakRoles,
    authorizedParty: claims.azp,
    tokenId: claims.jti,
    keycloakSessionId,
    issuedAt: new Date(claims.iat! * 1000).toISOString(),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    authTime:
      Number.isSafeInteger(claims.auth_time) && claims.auth_time! <= nowSeconds + clockSkewSeconds
        ? new Date(claims.auth_time! * 1000).toISOString()
        : null,
    acr: claims.acr ?? null,
    amr
  };
}

export function hasMfaEvidence(input: { amr: readonly string[]; acr?: string | null }): boolean {
  const methods = normalizeAuthenticationMethods(input.amr);
  if (methods.some((method) => MFA_METHODS.has(method))) return true;
  return Boolean(input.acr && /(?:^|[.:_-])(2|mfa|loa2|aal2)(?:$|[.:_-])/i.test(input.acr));
}

export async function assertMfaForAccess(input: {
  roleSlugs: readonly ClinicRoleSlug[];
  amr: readonly string[];
  acr?: string | null;
  breakGlass?: boolean;
  subject: string;
  issuer: string;
  authorizedParty: string;
  auditDeduplicationKey: string;
  now: Date;
  auditOutbox: RequiredSecurityAuditOutbox;
}): Promise<void> {
  const privileged = input.breakGlass || input.roleSlugs.some((role) => PRIVILEGED_ROLES.has(role));
  if (privileged && !hasMfaEvidence(input)) {
    await persistRequiredSecurityAudit(
      input.auditOutbox,
      validateRequiredSecurityAuditIntent({
        schemaVersion: 1,
        action: "auth.mfa.denied",
        occurredAt: trustedInstant(input.now, "MFA denial audit time").toISOString(),
        deduplicationKey: `auth.mfa.denied:${input.auditDeduplicationKey}:${
          input.breakGlass ? "break_glass" : "privileged_role"
        }`,
        subject: input.subject,
        issuer: input.issuer,
        authorizedParty: input.authorizedParty,
        reasonCode: input.breakGlass ? "break_glass" : "privileged_role",
        roleSlugs: [...new Set(input.roleSlugs)].sort()
      })
    );
    throw new AuthenticationError(
      input.breakGlass
        ? "Break-glass access requires multi-factor authentication."
        : "Multi-factor authentication is required for privileged access."
    );
  }
}

export type JmlTransition = "joiner" | "mover" | "leaver";

export type JmlControlStep =
  | "lock_application_access"
  | "create_identity_disabled"
  | "set_membership_and_clinic_assignments"
  | "set_product_roles"
  | "require_privileged_mfa"
  | "bump_authority_revision"
  | "revoke_application_session_families"
  | "revoke_keycloak_sessions_and_offline_tokens"
  | "disable_keycloak_identity"
  | "remove_product_roles"
  | "deactivate_memberships"
  | "enable_keycloak_identity"
  | "unlock_application_access";

export interface JmlCommand {
  commandId: string;
  transition: JmlTransition;
  subject: string;
  tenantId: string;
  requestedBy: string;
  approvedBy: string;
  ticketId: string;
  requestedRoles: readonly ClinicRoleSlug[];
}

export interface JmlControlPlan {
  commandId: string;
  transition: JmlTransition;
  subject: string;
  tenantId: string;
  requestedRoles: ClinicRoleSlug[];
  requiresMfaEnrollment: boolean;
  steps: readonly JmlControlStep[];
}

export interface JmlControlPort {
  readonly atomicity: "security_state_and_required_audit_outbox";
  /** The final state mutation and non-null requiredAudit commit in one durable transaction. */
  executeStep(input: {
    command: JmlCommand;
    step: JmlControlStep;
    idempotencyKey: string;
    requiredAudit: RequiredSecurityAuditIntent | null;
  }): Promise<void>;
}

export function buildJmlControlPlan(command: JmlCommand): JmlControlPlan {
  validateJmlCommand(command);
  const requestedRoles = [...new Set(command.requestedRoles)].sort();
  const requiresMfaEnrollment = requestedRoles.some((role) => PRIVILEGED_ROLES.has(role));
  const steps: readonly JmlControlStep[] =
    command.transition === "joiner"
      ? [
          "create_identity_disabled",
          "lock_application_access",
          "set_membership_and_clinic_assignments",
          "set_product_roles",
          ...(requiresMfaEnrollment ? (["require_privileged_mfa"] as const) : []),
          "bump_authority_revision",
          "enable_keycloak_identity",
          "unlock_application_access"
        ]
      : command.transition === "mover"
        ? [
            "lock_application_access",
            "revoke_application_session_families",
            "revoke_keycloak_sessions_and_offline_tokens",
            "set_membership_and_clinic_assignments",
            "set_product_roles",
            ...(requiresMfaEnrollment ? (["require_privileged_mfa"] as const) : []),
            "bump_authority_revision",
            "unlock_application_access"
          ]
        : [
            "lock_application_access",
            "revoke_application_session_families",
            "revoke_keycloak_sessions_and_offline_tokens",
            "disable_keycloak_identity",
            "remove_product_roles",
            "deactivate_memberships",
            "bump_authority_revision"
          ];

  return {
    commandId: command.commandId,
    transition: command.transition,
    subject: command.subject,
    tenantId: command.tenantId,
    requestedRoles,
    requiresMfaEnrollment,
    steps
  };
}

export async function executeJmlControlPlan(
  command: JmlCommand,
  port: JmlControlPort,
  now: Date
): Promise<JmlControlPlan> {
  if (port.atomicity !== "security_state_and_required_audit_outbox") {
    throw new Error("JML coordinator must atomically persist state and required audit outbox.");
  }
  const plan = buildJmlControlPlan(command);
  const occurredAt = trustedInstant(now, "JML completion audit time");
  for (const [index, step] of plan.steps.entries()) {
    const requiredAudit =
      index === plan.steps.length - 1
        ? validateRequiredSecurityAuditIntent({
            schemaVersion: 1,
            action: `identity.${command.transition}.completed`,
            occurredAt: occurredAt.toISOString(),
            deduplicationKey: `identity.${command.transition}.completed:${command.commandId}`,
            subject: command.subject,
            tenantId: command.tenantId,
            transition: command.transition,
            commandId: command.commandId,
            reasonCode: "jml_completed"
          })
        : null;
    await port.executeStep({
      command,
      step,
      idempotencyKey: `${command.commandId}:${String(index + 1).padStart(2, "0")}:${step}`,
      requiredAudit
    });
  }
  return plan;
}

export interface BreakGlassGrant {
  grantId: string;
  tenantId: string;
  clinicId: string;
  patientId: string;
  requesterUserId: string;
  approverUserId: string;
  reasonCode: "patient_safety" | "clinical_emergency" | "continuity_of_care";
  ticketId: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  allowedCapabilities: readonly string[];
}

export async function assertActiveBreakGlassGrant(
  grant: BreakGlassGrant,
  input: {
    actorUserId: string;
    tenantId: string;
    clinicId: string;
    patientId: string;
    requiredCapability: string;
    now: Date;
    amr: readonly string[];
    acr?: string | null;
    issuer: string;
    authorizedParty: string;
    auditDeduplicationKey: string;
    auditOutbox: RequiredSecurityAuditOutbox;
  }
): Promise<void> {
  const now = trustedInstant(input.now, "break-glass evaluation time");
  if (grant.requesterUserId === grant.approverUserId) {
    throw new AuthenticationError("Break-glass access requires independent approval.");
  }
  if (grant.requesterUserId !== input.actorUserId) {
    throw new AuthenticationError("Break-glass grant does not belong to the verified actor.");
  }
  if (
    grant.tenantId !== input.tenantId ||
    grant.clinicId !== input.clinicId ||
    grant.patientId !== input.patientId
  ) {
    throw new AuthenticationError(
      "Break-glass grant does not match the verified tenant, clinic, and patient scope."
    );
  }
  const duration = grant.expiresAt.getTime() - grant.grantedAt.getTime();
  if (
    Number.isNaN(duration) ||
    duration <= 0 ||
    duration > 15 * 60 * 1000 ||
    grant.grantedAt.getTime() > now.getTime() ||
    grant.expiresAt.getTime() <= now.getTime() ||
    Boolean(grant.revokedAt)
  ) {
    throw new AuthenticationError("Break-glass grant is expired, revoked, or outside policy.");
  }
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(grant.ticketId)) {
    throw new AuthenticationError("Break-glass grant requires a non-PHI ticket identifier.");
  }
  if (
    grant.allowedCapabilities.length === 0 ||
    grant.allowedCapabilities.length > 16 ||
    new Set(grant.allowedCapabilities).size !== grant.allowedCapabilities.length ||
    grant.allowedCapabilities.some(
      (capability) => !/^[a-z][a-z0-9_.:-]{2,127}$/.test(capability)
    ) ||
    !grant.allowedCapabilities.includes(input.requiredCapability)
  ) {
    throw new AuthenticationError("Break-glass grant does not authorize the required capability.");
  }
  if (!hasMfaEvidence(input)) {
    await assertMfaForAccess({
      roleSlugs: [],
      amr: input.amr,
      acr: input.acr,
      breakGlass: true,
      subject: input.actorUserId,
      issuer: input.issuer,
      authorizedParty: input.authorizedParty,
      auditDeduplicationKey: input.auditDeduplicationKey,
      now,
      auditOutbox: input.auditOutbox
    });
  }
}

function validateJmlCommand(command: JmlCommand): void {
  for (const [label, value] of Object.entries({
    commandId: command.commandId,
    subject: command.subject,
    tenantId: command.tenantId,
    requestedBy: command.requestedBy,
    approvedBy: command.approvedBy,
    ticketId: command.ticketId
  })) {
    if (!TOKEN_IDENTIFIER_PATTERN.test(value)) {
      throw new Error(`JML ${label} is malformed.`);
    }
  }
  if (command.requestedBy === command.approvedBy) {
    throw new Error("JML changes require independent approval.");
  }
  if (command.transition === "leaver" && command.requestedRoles.length > 0) {
    throw new Error("Leaver transitions cannot retain requested roles.");
  }
}

function normalizeAuthenticationMethods(values: readonly string[]): string[] {
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))
  ];
  if (normalized.some((value) => !/^[a-z0-9._:-]{1,64}$/.test(value))) {
    throw new AuthenticationError("Keycloak authentication method claim is malformed.");
  }
  return normalized.sort();
}

function trustedInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid injected instant.`);
  }
  return new Date(value.getTime());
}
