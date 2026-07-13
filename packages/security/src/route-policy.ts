import type { AbuseBudgetPolicy } from "./abuse-budget.ts";

export const HTTP_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RouteAccessPolicy =
  | {
      mode: "public_health";
      healthKind: "liveness" | "readiness" | "startup";
    }
  | {
      mode: "verified_webhook";
      provider: string;
      signatureVerification: "raw_body_before_parse";
      replayProtection: "required";
    }
  | {
      mode: "provider_challenge";
      provider: string;
      verification: "constant_time_registered_token";
    }
  | {
      mode: "authenticated";
      tenant: "verified_active_membership";
      clinic: "verified_active_membership" | "not_applicable";
      authorization:
        | { mode: "active_identity" }
        | { mode: "all_permissions"; permissions: readonly [string, ...string[]] };
    };

export interface RouteSecurityPolicy {
  routeId: string;
  method: HttpMethod;
  pathTemplate: string;
  access: RouteAccessPolicy;
  abuse: AbuseBudgetPolicy;
  runtimeValidation: {
    path: "strict" | "none";
    query: "strict" | "none";
    body: "strict" | "none" | "verified_raw_body";
    response: "strict";
    rejectUnknownFields: true;
  };
  cachePolicy: "no-store";
}

export interface RegisteredRoute {
  method: HttpMethod;
  pathTemplate: string;
}

export function defineRouteSecurityPolicy(policy: RouteSecurityPolicy): RouteSecurityPolicy {
  if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(policy.routeId)) {
    throw new Error("Route policy requires a stable routeId.");
  }
  if (!policy.pathTemplate.startsWith("/")) {
    throw new Error("Route policy pathTemplate must be absolute.");
  }
  if (policy.runtimeValidation.response !== "strict") {
    throw new Error("Every route must validate responses at runtime.");
  }
  if (!policy.runtimeValidation.rejectUnknownFields) {
    throw new Error("Every route must reject unknown writable fields.");
  }
  if (policy.cachePolicy !== "no-store") {
    throw new Error("ClinicOS API route policies must default to no-store.");
  }
  assertNonNegativePolicyInteger(policy.abuse.query.maxParameters, "query.maxParameters");
  assertNonNegativePolicyInteger(policy.abuse.query.maxTotalBytes, "query.maxTotalBytes");
  assertPositivePolicyInteger(policy.abuse.query.maxKeyBytes, "query.maxKeyBytes");
  assertPositivePolicyInteger(policy.abuse.query.maxValueBytes, "query.maxValueBytes");
  assertPositivePolicyInteger(policy.abuse.query.maxValuesPerKey, "query.maxValuesPerKey");
  assertPositivePolicyInteger(policy.abuse.rate.limit, "rate.limit");
  assertPositivePolicyInteger(policy.abuse.rate.windowSeconds, "rate.windowSeconds");
  if (policy.abuse.body) {
    assertNonNegativePolicyInteger(policy.abuse.body.maxBytes, "body.maxBytes");
  }
  if (policy.abuse.pagination) {
    assertPositivePolicyInteger(policy.abuse.pagination.defaultLimit, "pagination.defaultLimit");
    assertPositivePolicyInteger(policy.abuse.pagination.maxLimit, "pagination.maxLimit");
    assertPositivePolicyInteger(
      policy.abuse.pagination.maxCursorBytes,
      "pagination.maxCursorBytes"
    );
    if (policy.abuse.pagination.defaultLimit > policy.abuse.pagination.maxLimit) {
      throw new Error("Pagination defaultLimit cannot exceed maxLimit.");
    }
  }
  if (policy.abuse.expensiveOperation) {
    assertPositivePolicyInteger(
      policy.abuse.expensiveOperation.maxUnitsPerRequest,
      "expensiveOperation.maxUnitsPerRequest"
    );
    assertPositivePolicyInteger(
      policy.abuse.expensiveOperation.maxUnitsPerWindow,
      "expensiveOperation.maxUnitsPerWindow"
    );
    assertPositivePolicyInteger(
      policy.abuse.expensiveOperation.windowSeconds,
      "expensiveOperation.windowSeconds"
    );
  }
  const bodyValidation = policy.runtimeValidation.body;
  if (["GET", "HEAD"].includes(policy.method)) {
    if (bodyValidation !== "none" || policy.abuse.body !== null) {
      throw new Error("GET and HEAD route policies cannot declare request bodies.");
    }
  } else if (policy.abuse.body === null) {
    throw new Error("Non-read route policies require an explicit body byte budget.");
  } else if (bodyValidation === "none" && policy.abuse.body.maxBytes !== 0) {
    throw new Error("Routes without a request body must use a zero-byte body budget.");
  } else if (bodyValidation !== "none" && policy.abuse.body.maxBytes < 1) {
    throw new Error("Routes with a request body require a positive body byte budget.");
  }
  if (policy.runtimeValidation.query === "none") {
    if (policy.abuse.query.maxParameters !== 0 || policy.abuse.query.maxTotalBytes !== 0) {
      throw new Error("Routes without query input must use zero query count and byte budgets.");
    }
  }
  if (policy.access.mode === "verified_webhook") {
    if (policy.runtimeValidation.body !== "verified_raw_body") {
      throw new Error(
        "Verified webhooks must preserve raw body bytes until signature verification."
      );
    }
    if (policy.abuse.body === null) {
      throw new Error("Verified webhooks require an explicit raw-body byte budget.");
    }
  }
  if (policy.access.mode === "public_health" && policy.abuse.rate.scope !== "ip") {
    throw new Error("Public health routes require an IP-scoped application rate budget.");
  }
  if (policy.access.mode === "verified_webhook" && policy.abuse.rate.scope !== "ip") {
    throw new Error("Provider webhooks require a pre-verification IP-scoped rate budget.");
  }
  if (policy.access.mode === "provider_challenge" && policy.abuse.rate.scope !== "ip") {
    throw new Error("Provider challenges require a pre-verification IP-scoped rate budget.");
  }
  if (policy.access.mode === "provider_challenge" && policy.method !== "GET") {
    throw new Error("Provider challenges must use a read-only GET route.");
  }
  if (
    policy.access.mode === "authenticated" &&
    policy.access.authorization.mode === "all_permissions" &&
    policy.access.authorization.permissions.length === 0
  ) {
    throw new Error("Authenticated permission policies must require at least one permission.");
  }
  if (
    policy.access.mode === "authenticated" &&
    policy.access.authorization.mode === "all_permissions"
  ) {
    const permissions = policy.access.authorization.permissions;
    if (
      permissions.some((permission) => !/^[a-z][a-z0-9_.:-]{2,127}$/.test(permission)) ||
      new Set(permissions).size !== permissions.length
    ) {
      throw new Error("Authenticated route permissions must be unique stable identifiers.");
    }
  }
  return Object.freeze(policy);
}

export function assertRouteSecurityCoverage(
  registeredRoutes: readonly RegisteredRoute[],
  policies: readonly RouteSecurityPolicy[]
): void {
  const registered = new Set<string>();
  for (const route of registeredRoutes) {
    const key = routeKey(route);
    if (registered.has(key)) throw new Error(`Duplicate registered route: ${key}`);
    registered.add(key);
  }

  const covered = new Set<string>();
  const routeIds = new Set<string>();
  for (const policy of policies) {
    defineRouteSecurityPolicy(policy);
    const key = routeKey(policy);
    if (covered.has(key)) throw new Error(`Duplicate route security policy: ${key}`);
    if (routeIds.has(policy.routeId))
      throw new Error(`Duplicate route security id: ${policy.routeId}`);
    covered.add(key);
    routeIds.add(policy.routeId);
  }

  const missing = [...registered].filter((key) => !covered.has(key));
  const stale = [...covered].filter((key) => !registered.has(key));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `Route security policy coverage mismatch; missing=[${missing.sort().join(",")}], stale=[${stale.sort().join(",")}]`
    );
  }
}

export function resolveRouteSecurityPolicy(
  policies: readonly RouteSecurityPolicy[],
  route: RegisteredRoute
): RouteSecurityPolicy {
  const key = routeKey(route);
  const policy = policies.find((candidate) => routeKey(candidate) === key);
  if (!policy) {
    throw new Error(`Registered route has no security policy: ${key}`);
  }
  return policy;
}

function routeKey(route: RegisteredRoute): string {
  return `${route.method} ${route.pathTemplate}`;
}

function assertPositivePolicyInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Route policy ${field} must be a positive safe integer.`);
  }
}

function assertNonNegativePolicyInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Route policy ${field} must be a non-negative safe integer.`);
  }
}
