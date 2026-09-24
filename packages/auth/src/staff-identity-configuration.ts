import { createHmac } from "node:crypto";
import type { MfaAssurancePolicy } from "./production-identity.ts";

export const STAFF_MFA_POLICY: MfaAssurancePolicy = Object.freeze({
  policyId: "clinicos-amr-two-factor-v1",
  reviewedRealmEvidenceId: null,
  acceptedAcrValues: [],
  primaryFactorAmrValues: ["pwd"],
  secondaryFactorAmrValues: ["otp", "totp", "webauthn"],
  phishingResistantAmrValues: []
});

/** Shared, server-only registration. No discovery starts connections or services. */
export function readStaffIdentityConfiguration(env: Readonly<Record<string, string | undefined>>) {
  if (!env.CLINICOS_STAFF_SIGN_IN_ENABLED || env.CLINICOS_STAFF_SIGN_IN_ENABLED === "false")
    return null;
  if (
    env.CLINICOS_STAFF_SIGN_IN_ENABLED !== "true" ||
    env.CLINIC_OS_ENV !== "local" ||
    env.PILOT_SYNTHETIC_DATA_ONLY !== "true" ||
    env.CLINIC_OS_API_USE_DEV_AUTH_FIXTURE === "true" ||
    env.CLINIC_OS_API_USE_FIXTURE_REPOSITORY === "true" ||
    env.NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT === "synthetic_bearer"
  ) {
    // An ALB peer/forwarding adapter needs deployed evidence. A boolean cannot attest it.
    throw new Error("Staff identity requires the reviewed direct-loopback synthetic runtime.");
  }
  const keyText = env.CLINICOS_SESSION_KEY;
  if (!keyText || !/^[A-Za-z0-9+/]{43}=$/.test(keyText)) throw invalid();
  const rootKey = Buffer.from(keyText, "base64");
  if (rootKey.length !== 32 || rootKey.toString("base64") !== keyText) throw invalid();
  const keyId = env.CLINICOS_SESSION_KEY_ID ?? "initial";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw invalid();
  const issuerBase = loopbackOrigin(env.KEYCLOAK_BASE_URL);
  const realm = env.KEYCLOAK_REALM;
  if (
    !realm ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(realm) ||
    env.KEYCLOAK_CLIENT_ID !== "clinic-os-web-bff"
  )
    throw invalid();
  const redisUrl = serviceUrl(env.REDIS_URL, "redis:");
  const namespace = env.CLINICOS_IDENTITY_NAMESPACE ?? "clinicos:staff:v1";
  if (!/^[a-z][a-z0-9:-]{2,45}$/.test(namespace)) throw invalid();
  const derive = (purpose: string) =>
    createHmac("sha256", rootKey).update(`clinicos-staff-v1:${purpose}`).digest();
  const idleTtlSeconds = Number(env.CLINICOS_SESSION_IDLE_SECONDS ?? "900");
  if (!Number.isSafeInteger(idleTtlSeconds) || idleTtlSeconds < 300 || idleTtlSeconds > 1800)
    throw invalid();
  return Object.freeze({
    idleTtlSeconds,
    issuer: `${issuerBase}/realms/${realm}`,
    clientId: "clinic-os-web-bff",
    redisUrl,
    namespace,
    storeKey: derive("redis"),
    lookupKey: derive("lookup"),
    csrfKey: derive("csrf"),
    oauthKey: derive("oauth"),
    revocationKey: derive("revocation"),
    encryptionKeys: [{ id: keyId, key: derive("encryption") }] as const,
    mfaPolicy: STAFF_MFA_POLICY
  });
}

export type StaffIdentityConfiguration = NonNullable<
  ReturnType<typeof readStaffIdentityConfiguration>
>;

export function loopbackOrigin(value: string | undefined): string {
  const url = serviceUrl(value, "http:");
  const parsed = new URL(url);
  if (
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    parsed.origin !== value
  )
    throw invalid();
  return parsed.origin;
}

export function staffDatabaseUrl(
  value: string | undefined,
  role: "clinic_os_runtime" | "clinic_os_worker"
): string {
  const url = serviceUrl(value, "postgresql:");
  const parsed = new URL(url);
  if (parsed.username !== role || parsed.pathname !== "/clinic_os" || parsed.search || parsed.hash)
    throw invalid();
  return url;
}

function serviceUrl(value: string | undefined, protocol: string): string {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== protocol ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.hash ||
      url.search
    )
      throw invalid();
    return url.toString();
  } catch {
    throw invalid();
  }
}
function invalid() {
  return new Error("Staff identity server configuration is invalid.");
}
