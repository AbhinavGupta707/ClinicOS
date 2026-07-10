import { BoundaryError } from "./boundary-error.ts";
import type {
  AbuseBudgetPolicy,
  ExpensiveOperationBudgetPolicy,
  RateBudgetPolicy
} from "./abuse-budget.ts";

export type SecurityHeaderValue = string | readonly string[] | null | undefined;

export interface TrustedEdgePolicy {
  productionLike: boolean;
  trustedHosts: readonly string[];
  trustedOrigins: readonly string[];
  proxyBoundary: "direct_canonical" | "verified_alb_adapter_required";
  hsts: "disabled_until_domain_ready" | "enabled_preloaded";
  cspReportUri?: string | null;
}

const VERIFIED_PROXY_BOUNDARY = Symbol("clinic-os-verified-proxy-boundary");

export interface VerifiedTrustedProxyBoundary {
  readonly kind: "verified_trusted_proxy_boundary";
  readonly source: "aws_alb_normalizing_adapter";
  readonly canonicalHost: string;
  readonly canonicalProtocol: "http" | "https";
  readonly verificationId: string;
  readonly [VERIFIED_PROXY_BOUNDARY]: true;
}

export interface TrustedRequestBoundary {
  host: string;
  origin: string | null;
  protocol: "http" | "https";
}

export interface CorsDecision {
  allowed: boolean;
  headers: Readonly<Record<string, string>>;
}

export interface ApplicationResourcePolicy {
  policyId: string;
  rate: RateBudgetPolicy;
  expensiveOperation: ExpensiveOperationBudgetPolicy | null;
  maximumBodyBytes: number;
  maximumResponseBytes: number;
  maximumDurationMs: number;
  maximumConcurrencyPerActor: number;
  cache: "no-store";
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SIMPLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUSTED_HEADER_PATTERN = /^[\x20-\x7E]{1,512}$/;
const HOST_PATTERN = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;
const CSP_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const POLICY_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

export const CP14_APPLICATION_RESOURCE_POLICIES = Object.freeze({
  login: defineApplicationResourcePolicy({
    policyId: "identity.login",
    rate: { limit: 10, windowSeconds: 300, scope: "ip" },
    expensiveOperation: null,
    maximumBodyBytes: 0,
    maximumResponseBytes: 8192,
    maximumDurationMs: 5_000,
    maximumConcurrencyPerActor: 2,
    cache: "no-store"
  }),
  callback: defineApplicationResourcePolicy({
    policyId: "identity.callback",
    rate: { limit: 20, windowSeconds: 300, scope: "ip" },
    expensiveOperation: null,
    maximumBodyBytes: 0,
    maximumResponseBytes: 8192,
    maximumDurationMs: 10_000,
    maximumConcurrencyPerActor: 2,
    cache: "no-store"
  }),
  session: defineApplicationResourcePolicy({
    policyId: "identity.session",
    rate: { limit: 120, windowSeconds: 60, scope: "actor" },
    expensiveOperation: null,
    maximumBodyBytes: 0,
    maximumResponseBytes: 16_384,
    maximumDurationMs: 5_000,
    maximumConcurrencyPerActor: 4,
    cache: "no-store"
  }),
  mutation: defineApplicationResourcePolicy({
    policyId: "bff.mutation",
    rate: { limit: 120, windowSeconds: 60, scope: "tenant_actor" },
    expensiveOperation: null,
    maximumBodyBytes: 1_048_576,
    maximumResponseBytes: 2_097_152,
    maximumDurationMs: 15_000,
    maximumConcurrencyPerActor: 8,
    cache: "no-store"
  }),
  privileged: defineApplicationResourcePolicy({
    policyId: "identity.privileged",
    rate: { limit: 10, windowSeconds: 300, scope: "tenant_actor" },
    expensiveOperation: {
      maxUnitsPerRequest: 1,
      maxUnitsPerWindow: 5,
      windowSeconds: 900,
      scope: "tenant_actor"
    },
    maximumBodyBytes: 65_536,
    maximumResponseBytes: 65_536,
    maximumDurationMs: 10_000,
    maximumConcurrencyPerActor: 1,
    cache: "no-store"
  })
});

export function normalizeTrustedEdgePolicy(policy: TrustedEdgePolicy): TrustedEdgePolicy {
  const trustedHosts = [...new Set(policy.trustedHosts.map(normalizeHost))].sort();
  const trustedOrigins = [
    ...new Set(
      policy.trustedOrigins.map((origin) => normalizeOrigin(origin, policy.productionLike))
    )
  ].sort();
  if (trustedHosts.length === 0 || trustedOrigins.length === 0) {
    throw new Error("Trusted host and origin allowlists must not be empty.");
  }
  for (const origin of trustedOrigins) {
    if (!trustedHosts.includes(new URL(origin).host.toLowerCase())) {
      throw new Error("Every trusted origin host must be present in the trusted-host allowlist.");
    }
  }
  if (!["direct_canonical", "verified_alb_adapter_required"].includes(policy.proxyBoundary)) {
    throw new Error("Trusted proxy boundary mode is invalid.");
  }
  if (policy.hsts === "enabled_preloaded" && !policy.productionLike) {
    throw new Error("HSTS preload policy is valid only for a production-like HTTPS origin.");
  }
  const cspReportUri = policy.cspReportUri
    ? normalizeCspReportUri(policy.cspReportUri)
    : policy.cspReportUri;
  if (cspReportUri) {
    if (!trustedOrigins.includes(new URL(cspReportUri).origin.toLowerCase())) {
      throw new Error("CSP report endpoint origin must be explicitly trusted.");
    }
  }
  return Object.freeze({ ...policy, trustedHosts, trustedOrigins, cspReportUri });
}

/**
 * Called only by the master-owned adapter after it verifies the connection peer and proves that the
 * ALB overwrote client-supplied forwarding headers. Raw request code must not call this factory.
 */
export function createVerifiedTrustedProxyBoundary(input: {
  connectionVerified: boolean;
  forwardingHeadersOverwritten: boolean;
  forwardedChainLength: number;
  canonicalHostHeader: SecurityHeaderValue;
  canonicalProtoHeader: SecurityHeaderValue;
  verificationId: string;
  productionLike: boolean;
}): VerifiedTrustedProxyBoundary {
  if (!input.connectionVerified || !input.forwardingHeadersOverwritten) {
    throw boundaryDenied("Trusted proxy connection and header normalization were not proven.");
  }
  if (input.forwardedChainLength !== 1) {
    throw boundaryDenied("Trusted proxy adapter requires one normalized forwarding hop.");
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.verificationId)) {
    throw boundaryDenied("Trusted proxy verification id is malformed.");
  }
  return Object.freeze({
    kind: "verified_trusted_proxy_boundary",
    source: "aws_alb_normalizing_adapter",
    canonicalHost: normalizeHost(
      singleHeader(input.canonicalHostHeader, "Normalized proxy host", true)
    ),
    canonicalProtocol: normalizeProtocol(
      singleHeader(input.canonicalProtoHeader, "Normalized proxy protocol", true),
      input.productionLike
    ),
    verificationId: input.verificationId,
    [VERIFIED_PROXY_BOUNDARY]: true as const
  });
}

export function assertTrustedRequestBoundary(input: {
  policy: TrustedEdgePolicy;
  hostHeader: SecurityHeaderValue;
  originHeader?: SecurityHeaderValue;
  directProtocol?: SecurityHeaderValue;
  untrustedForwardedHostHeader?: SecurityHeaderValue;
  untrustedForwardedProtoHeader?: SecurityHeaderValue;
  proxyBoundary?: VerifiedTrustedProxyBoundary | null;
}): TrustedRequestBoundary {
  const policy = normalizeTrustedEdgePolicy(input.policy);
  const directHost = singleHeader(input.hostHeader, "Host", true);
  const untrustedForwardedHost = singleHeader(
    input.untrustedForwardedHostHeader,
    "Unverified X-Forwarded-Host",
    false
  );
  const untrustedForwardedProto = singleHeader(
    input.untrustedForwardedProtoHeader,
    "Unverified X-Forwarded-Proto",
    false
  );
  if (untrustedForwardedHost || untrustedForwardedProto) {
    throw boundaryDenied(
      "Raw forwarded host/protocol headers must be stripped by the verified proxy adapter."
    );
  }
  let host: string;
  let protocol: "http" | "https";
  if (policy.proxyBoundary === "verified_alb_adapter_required") {
    if (
      !input.proxyBoundary ||
      input.proxyBoundary[VERIFIED_PROXY_BOUNDARY] !== true ||
      input.proxyBoundary.kind !== "verified_trusted_proxy_boundary" ||
      input.proxyBoundary.source !== "aws_alb_normalizing_adapter"
    ) {
      throw boundaryDenied("Verified trusted-proxy boundary is required.");
    }
    host = input.proxyBoundary.canonicalHost;
    protocol = input.proxyBoundary.canonicalProtocol;
  } else {
    if (input.proxyBoundary) {
      throw boundaryDenied("Proxy boundary is not accepted for direct-canonical requests.");
    }
    host = normalizeHost(directHost);
    protocol = normalizeProtocol(
      singleHeader(input.directProtocol, "Direct request protocol", true),
      policy.productionLike
    );
  }
  if (!policy.trustedHosts.includes(host)) {
    throw boundaryDenied("Request host is not trusted.");
  }
  const originValue = singleHeader(input.originHeader, "Origin", false);
  const origin = originValue ? normalizeOrigin(originValue, policy.productionLike) : null;
  if (origin && !policy.trustedOrigins.includes(origin)) {
    throw boundaryDenied("Request origin is not trusted.");
  }
  if (origin && new URL(origin).host.toLowerCase() !== host) {
    throw boundaryDenied("Request origin and host do not match.");
  }
  return { host, origin, protocol };
}

export function assertBrowserMutationRequest(input: {
  policy: TrustedEdgePolicy;
  method: string;
  hostHeader: SecurityHeaderValue;
  originHeader: SecurityHeaderValue;
  directProtocol?: SecurityHeaderValue;
  untrustedForwardedHostHeader?: SecurityHeaderValue;
  untrustedForwardedProtoHeader?: SecurityHeaderValue;
  proxyBoundary?: VerifiedTrustedProxyBoundary | null;
  csrfHeader: SecurityHeaderValue;
  contentTypeHeader?: SecurityHeaderValue;
  authorizationHeader?: SecurityHeaderValue;
  secFetchSiteHeader?: SecurityHeaderValue;
  verifyCsrfToken: (token: string) => boolean;
}): TrustedRequestBoundary {
  const method = input.method.toUpperCase();
  if (!MUTATION_METHODS.has(method)) {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Browser mutation guard only accepts state-changing methods."
    });
  }
  const boundary = assertTrustedRequestBoundary(input);
  if (!boundary.origin) throw boundaryDenied("Browser mutation requires an Origin header.");
  const authorization = singleHeader(input.authorizationHeader, "Authorization", false);
  if (authorization) {
    throw boundaryDenied("Browser BFF requests cannot supply bearer authorization.");
  }
  const secFetchSite = singleHeader(input.secFetchSiteHeader, "Sec-Fetch-Site", false);
  if (secFetchSite && !["same-origin", "none"].includes(secFetchSite.toLowerCase())) {
    throw boundaryDenied("Cross-site browser mutation is not accepted.");
  }
  const contentType = singleHeader(input.contentTypeHeader, "Content-Type", false);
  if (contentType && !isAcceptedMutationContentType(contentType)) {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Browser mutation content type is not accepted."
    });
  }
  const csrfToken = singleHeader(input.csrfHeader, "X-CSRF-Token", true);
  if (!input.verifyCsrfToken(csrfToken)) {
    throw boundaryDenied("CSRF verification failed.");
  }
  return boundary;
}

export function evaluateCorsRequest(input: {
  policy: TrustedEdgePolicy;
  originHeader: SecurityHeaderValue;
  requestMethod?: SecurityHeaderValue;
  requestHeaders?: SecurityHeaderValue;
  allowMethods: readonly string[];
  allowHeaders: readonly string[];
  credentialed: boolean;
}): CorsDecision {
  const policy = normalizeTrustedEdgePolicy(input.policy);
  const originValue = singleHeader(input.originHeader, "Origin", false);
  if (!originValue) return { allowed: false, headers: {} };
  const origin = normalizeOrigin(originValue, policy.productionLike);
  if (!policy.trustedOrigins.includes(origin)) return { allowed: false, headers: {} };
  const methods = [...new Set(input.allowMethods.map((method) => method.toUpperCase()))].sort();
  if (methods.some((method) => !MUTATION_METHODS.has(method) && !SIMPLE_METHODS.has(method))) {
    throw new Error("CORS allow-method list contains an unsupported method.");
  }
  const allowedHeaders = [
    ...new Set(input.allowHeaders.map((header) => header.toLowerCase()))
  ].sort();
  if (
    allowedHeaders.some((header) => !/^[a-z0-9-]{1,64}$/.test(header)) ||
    allowedHeaders.includes("cookie") ||
    allowedHeaders.includes("host")
  ) {
    throw new Error("CORS allow-header list contains a forbidden header.");
  }
  const requestedMethod = singleHeader(input.requestMethod, "Access-Control-Request-Method", false);
  if (requestedMethod && !methods.includes(requestedMethod.toUpperCase())) {
    return { allowed: false, headers: {} };
  }
  const requestedHeaders = singleHeader(
    input.requestHeaders,
    "Access-Control-Request-Headers",
    false,
    true
  );
  if (requestedHeaders) {
    const values = requestedHeaders
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (values.some((header) => !allowedHeaders.includes(header))) {
      return { allowed: false, headers: {} };
    }
  }
  return {
    allowed: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": methods.join(", "),
      "access-control-allow-headers": allowedHeaders.join(", "),
      "access-control-max-age": "300",
      ...(input.credentialed ? { "access-control-allow-credentials": "true" } : {}),
      vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
    }
  };
}

export function buildBrowserSecurityHeaders(input: {
  policy: TrustedEdgePolicy;
  nonce: string;
}): Readonly<Record<string, string>> {
  const policy = normalizeTrustedEdgePolicy(input.policy);
  if (!CSP_NONCE_PATTERN.test(input.nonce)) {
    throw new Error("CSP nonce must be a random base64url value.");
  }
  const report = policy.cspReportUri ? `; report-uri ${policy.cspReportUri}` : "";
  const headers: Record<string, string> = {
    "cache-control": "private, no-store, max-age=0, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    "content-security-policy":
      [
        "default-src 'none'",
        `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${input.nonce}'`,
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "manifest-src 'self'",
        "worker-src 'self' blob:",
        "upgrade-insecure-requests"
      ].join("; ") + report,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-permitted-cross-domain-policies": "none"
  };
  if (policy.hsts === "enabled_preloaded") {
    headers["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload";
  }
  return Object.freeze(headers);
}

export function buildSensitiveApiHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "private, no-store, max-age=0, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
}

export function defineApplicationResourcePolicy(
  policy: ApplicationResourcePolicy
): ApplicationResourcePolicy {
  if (!POLICY_ID_PATTERN.test(policy.policyId)) {
    throw new Error("Application resource policy id is malformed.");
  }
  for (const [field, value] of Object.entries({
    maximumBodyBytes: policy.maximumBodyBytes,
    maximumResponseBytes: policy.maximumResponseBytes,
    maximumDurationMs: policy.maximumDurationMs,
    maximumConcurrencyPerActor: policy.maximumConcurrencyPerActor,
    rateLimit: policy.rate.limit,
    rateWindowSeconds: policy.rate.windowSeconds
  })) {
    if (!Number.isSafeInteger(value) || value < (field === "maximumBodyBytes" ? 0 : 1)) {
      throw new Error(`Application resource policy ${field} is invalid.`);
    }
  }
  if (policy.cache !== "no-store") {
    throw new Error("Application resource policies must be no-store.");
  }
  return Object.freeze(policy);
}

export function routeAbusePolicy(resource: ApplicationResourcePolicy): AbuseBudgetPolicy {
  return {
    body: { maxBytes: resource.maximumBodyBytes },
    query: {
      maxParameters: 16,
      maxTotalBytes: 4096,
      maxKeyBytes: 128,
      maxValueBytes: 2048,
      maxValuesPerKey: 2
    },
    pagination: null,
    rate: resource.rate,
    expensiveOperation: resource.expensiveOperation
  };
}

function normalizeHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HOST_PATTERN.test(normalized) || normalized.includes("..")) {
    throw boundaryDenied("Request host is malformed.");
  }
  const portMatch = /:(\d+)$/.exec(normalized);
  if (portMatch && Number(portMatch[1]) > 65_535) {
    throw boundaryDenied("Request host port is malformed.");
  }
  return normalized;
}

function normalizeOrigin(value: string, productionLike: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw boundaryDenied("Request origin is malformed.");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw boundaryDenied("Request origin contains forbidden components.");
  }
  const localHttp =
    !productionLike &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw boundaryDenied("Request origin must use HTTPS.");
  }
  return parsed.origin.toLowerCase();
}

function normalizeCspReportUri(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw boundaryDenied("CSP report endpoint is malformed.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.pathname === "/"
  ) {
    throw boundaryDenied("CSP report endpoint must be a specific HTTPS path.");
  }
  return parsed.toString();
}

function normalizeProtocol(value: string, productionLike: boolean): "http" | "https" {
  if (!value) {
    throw boundaryDenied("Trusted proxy protocol header is required.");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "https" && !(normalized === "http" && !productionLike)) {
    throw boundaryDenied("Request protocol is not accepted.");
  }
  return normalized;
}

function singleHeader(
  value: SecurityHeaderValue,
  name: string,
  required: boolean,
  allowCommas = false
): string {
  if (Array.isArray(value)) {
    throw boundaryDenied(`${name} header is ambiguous.`);
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized &&
    (!TRUSTED_HEADER_PATTERN.test(normalized) || (!allowCommas && normalized.includes(",")))
  ) {
    throw boundaryDenied(`${name} header is malformed or ambiguous.`);
  }
  if (required && !normalized) throw boundaryDenied(`${name} header is required.`);
  return normalized;
}

function isAcceptedMutationContentType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType === "application/x-www-form-urlencoded";
}

function boundaryDenied(message: string): BoundaryError {
  return new BoundaryError({ code: "PERMISSION_DENIED", message });
}
