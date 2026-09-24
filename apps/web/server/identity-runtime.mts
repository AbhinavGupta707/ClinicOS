import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  readStaffIdentityConfiguration,
  loopbackOrigin,
  staffDatabaseUrl,
  AuditDeliveryHealth,
  RedisWebSessionStore,
  RedisOAuthTransactionStore,
  RedisTokenRevocationStore,
  OAuthTransactionManager,
  WebSessionManager,
  CurrentSessionAuthorityResolver,
  WebSessionRefreshProviderError,
  principalFromProductionKeycloakClaims,
  assertMfaForAccess,
  AuthenticationError,
  type KeycloakAccessTokenClaims
} from "@clinic-os/auth";
import { PostgresIdentityRepository, type SqlConnectionFactory } from "@clinic-os/db";
import { systemClock } from "@clinic-os/domain";
import {
  Cp14BffRuntime,
  type Cp14BffSecurityPort,
  type Cp14ApiTransport
} from "../lib/cp14-session/bff-contract.ts";
import { KeycloakOidcBffClient } from "../lib/cp14-session/keycloak-oidc-client.ts";

// Active authenticated API route families; provider callbacks are excluded.
// A contract test keeps this allowlist aligned with the generated route inventory.
export const STAFF_API_PREFIXES = [
  "/v1/abdm",
  "/v1/ai-scribe",
  "/v1/appointment-types",
  "/v1/appointments",
  "/v1/audit-events",
  "/v1/break-glass",
  "/v1/chairs",
  "/v1/clinic-doctors",
  "/v1/corrective-actions",
  "/v1/dashboard",
  "/v1/dead-letter-events",
  "/v1/dental-findings",
  "/v1/encounters",
  "/v1/fhir",
  "/v1/form-templates",
  "/v1/incidents",
  "/v1/inventory",
  "/v1/invoices",
  "/v1/lab-cases",
  "/v1/lab-reconciliations",
  "/v1/lab-vendors",
  "/v1/leads",
  "/v1/me",
  "/v1/media",
  "/v1/migration-batches",
  "/v1/owner-dashboard",
  "/v1/patients",
  "/v1/pilot-readiness",
  "/v1/prescriptions",
  "/v1/pricebook",
  "/v1/privacy",
  "/v1/provider-health",
  "/v1/provider-schedules",
  "/v1/queue",
  "/v1/recall-rules",
  "/v1/recalls",
  "/v1/sop-runs",
  "/v1/sop-schedules",
  "/v1/sop-templates",
  "/v1/tasks",
  "/v1/treatment-plans"
] as const;

export function createStaffIdentityRuntime(
  env: Readonly<Record<string, string | undefined>>,
  security: Cp14BffSecurityPort
) {
  const config = readStaffIdentityConfiguration(env);
  if (!config) return null;
  const webOrigin = loopbackOrigin(env.CLINICOS_WEB_ORIGIN);
  const apiOrigin = loopbackOrigin(env.CLINIC_OS_API_INTERNAL_URL);
  const secret = env.CLINICOS_OIDC_CLIENT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024)
    throw new Error("Staff OIDC client configuration is invalid.");
  const now = () => systemClock.now();
  const pool = new Pool({
    connectionString: staffDatabaseUrl(env.DATABASE_URL, "clinic_os_runtime"),
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 3000
  });
  pool.on("error", () => undefined); // Dependency failures are returned through readiness, without credentials.
  const repository = new PostgresIdentityRepository(pool as unknown as SqlConnectionFactory);
  const authority = new CurrentSessionAuthorityResolver(repository);
  const health = new AuditDeliveryHealth(config);
  const sessionsStore = new RedisWebSessionStore({
    redisUrl: config.redisUrl,
    keyHmacSecret: config.storeKey,
    keyPrefix: `${config.namespace}:sessions`,
    now
  });
  const oauthStore = new RedisOAuthTransactionStore({
    redisUrl: config.redisUrl,
    keyHmacSecret: config.storeKey,
    encryptionKeys: config.encryptionKeys,
    keyPrefix: `${config.namespace}:oauth`,
    now
  });
  const revocations = new RedisTokenRevocationStore({
    redisUrl: config.redisUrl,
    keyHmacSecret: config.revocationKey,
    keyPrefix: `${config.namespace}:revocation`,
    maximumRetentionMs: 86_400_000,
    now
  });
  const endpoint = (path: string) => `${config.issuer}/protocol/openid-connect/${path}`;
  const tokens = new KeycloakOidcBffClient({
    productionLike: false,
    issuer: config.issuer,
    tokenEndpoint: endpoint("token"),
    revocationEndpoint: endpoint("revoke"),
    clientId: config.clientId,
    sessionLogoutEndpoint: endpoint("logout"),
    clientSecret: secret,
    redirectUri: `${webOrigin}/auth/callback`,
    apiAudience: "clinic-os-api",
    now,
    maximumAccessTokenLifetimeSeconds: 300,
    maximumRefreshTokenLifetimeSeconds: 43_200,
    refreshProviderErrorFactory: (failure) => new WebSessionRefreshProviderError(failure)
  });
  const sessions = new WebSessionManager({
    store: sessionsStore,
    providerRevoker: tokens,
    policy: {
      productionLike: false,
      expectedIssuer: config.issuer,
      mfaAssurancePolicy: config.mfaPolicy,
      cookieName: "clinicos_session",
      secureCookie: false,
      idleTtlSeconds: config.idleTtlSeconds,
      absoluteTtlSeconds: 28_800,
      rotateAfterSeconds: 600,
      refreshLeewaySeconds: 30,
      refreshLeaseSeconds: 15,
      lookupHmacKey: config.lookupKey,
      csrfHmacKey: config.csrfKey,
      encryptionKeys: config.encryptionKeys
    },
    revocations: {
      async record(input) {
        // An app-cookie replacement does not terminate the shared Keycloak SSO session.
        if (input.reason === "login_rotation" || input.reason === "periodic_rotation") return;
        if (input.issuer !== config.issuer || !input.keycloakSessionId)
          throw new Error("Session revocation identity is invalid.");
        await revocations.recordRevocation({
          subject: input.subject,
          keycloakSessionId: input.keycloakSessionId,
          reason:
            input.reason === "logout"
              ? "logout"
              : input.reason === "refresh_replay"
                ? "refresh_replay"
                : input.reason === "administrator_revoked"
                  ? "administrator_action"
                  : input.reason === "jml_transition"
                    ? "jml_transition"
                    : "authority_revision",
          revokedAt: input.now,
          // The registered synthetic realm caps SSO/client sessions at eight hours.
          // Keep denial for a full day, including refresh uncertainty and clock skew.
          expiresAt: new Date(input.now.getTime() + 86_400_000)
        });
      }
    }
  });
  const runtime = new Cp14BffRuntime({
    configuration: {
      productionLike: false,
      issuer: config.issuer,
      mfaAssurancePolicy: config.mfaPolicy,
      authorizationEndpoint: endpoint("auth"),
      tokenEndpoint: endpoint("token"),
      revocationEndpoint: endpoint("revoke"),
      clientId: config.clientId,
      clientSecret: secret,
      apiAudience: "clinic-os-api",
      webOrigin,
      callbackUri: `${webOrigin}/auth/callback`,
      apiBaseUrl: `${apiOrigin}/`,
      allowedApiPathPrefixes: STAFF_API_PREFIXES
    },
    security,
    transactions: new OAuthTransactionManager({ store: oauthStore, stateHmacKey: config.oauthKey }),
    sessions,
    authorityResolver: authority,
    tokens,
    api: new BoundedApiTransport(apiOrigin),
    identity: {
      validate(claims, policy) {
        return principalFromProductionKeycloakClaims(claims as KeycloakAccessTokenClaims, policy);
      }
    },
    async admitIdentity({ claims, now: instant }) {
      const principal = principalFromProductionKeycloakClaims(claims as KeycloakAccessTokenClaims, {
        expectedIssuer: config.issuer,
        requiredAudience: "clinic-os-api",
        acceptedAuthorizedParties: [config.clientId],
        now: instant
      });
      const snapshot = await repository.findAccessByKeycloakIdentity(principal);
      if (
        !snapshot ||
        !principal.authTime ||
        !Number.isFinite(Date.parse(snapshot.authenticationValidAfter)) ||
        Date.parse(principal.authTime) <= Date.parse(snapshot.authenticationValidAfter)
      ) {
        throw new AuthenticationError(
          "A current clinic membership and fresh sign-in are required."
        );
      }
      const current = await new CurrentSessionAuthorityResolver({
        findAccessByKeycloakIdentity: async () => snapshot
      }).resolve(principal);
      if (!current.active) throw new AuthenticationError("Clinic access is unavailable.");
      await assertMfaForAccess({
        roleSlugs: snapshot.roleAssignments.map((role) => role.roleSlug),
        amr: principal.amr,
        acr: principal.acr,
        mfaAssurancePolicy: config.mfaPolicy,
        subject: principal.subject,
        issuer: principal.issuer,
        authorizedParty: principal.authorizedParty,
        now: instant,
        auditDeduplicationKey: randomUUID(),
        auditOutbox: sessionsStore.requiredAuditOutbox()
      });
      if (
        await revocations.isRevoked({
          subject: principal.subject,
          tokenId: principal.tokenId,
          keycloakSessionId: principal.keycloakSessionId,
          issuedAt: principal.issuedAt,
          now: instant
        })
      ) {
        throw new AuthenticationError("This identity session was revoked.");
      }
      return current;
    }
  });
  return {
    runtime,
    webOrigin,
    sessions,
    async readiness(requireAuditDelivery = true) {
      await Promise.all([
        ...(requireAuditDelivery ? [health.readiness()] : []),
        sessionsStore.readiness(),
        oauthStore.readiness(),
        revocations.readiness(),
        pool
          .query("select 1 from flyway_schema_history where version = '026' and success")
          .then((r) => {
            if (r.rowCount !== 1) throw new Error("Identity schema is unavailable.");
          })
      ]);
    },
    async close() {
      await Promise.allSettled([
        pool.end(),
        sessionsStore.close(),
        oauthStore.close(),
        revocations.close(),
        health.close()
      ]);
    }
  };
}

export class BoundedApiTransport implements Cp14ApiTransport {
  readonly origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }
  async send(input: Parameters<Cp14ApiTransport["send"]>[0]) {
    if (new URL(input.url).origin !== this.origin)
      throw new Error("API destination is not allowed.");
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body ? new Uint8Array(input.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
      cache: "no-store"
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("API redirects are not accepted.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > input.maximumResponseBytes) {
            await reader.cancel();
            throw new Error("API response exceeds policy.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "etag", "retry-after", "x-request-id"]) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return { status: response.status, headers, body: Buffer.concat(chunks) };
  }
}
