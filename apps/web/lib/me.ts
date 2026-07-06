import { createSyntheticMeFixture, isDevFixtureAllowed } from "./dev-fixture";
import { normalizeRoles } from "./roles";
import type { ClinicRole } from "./roles";

export interface MeProfile {
  api?: {
    environment?: string;
    requestId?: string;
    serverTime?: string;
  };
  clinic: {
    id: string;
    name: string;
    timezone?: string;
  };
  featureFlags: Record<string, boolean>;
  permissions: string[];
  roles: ClinicRole[];
  source: "api" | "dev_fixture";
  tenant: {
    id: string;
    name: string;
  };
  user: {
    displayName: string;
    email?: string;
    id: string;
  };
}

export type MeProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "ME_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface MeProblem {
  code: MeProblemCode;
  detail?: string;
  message: string;
  requestId?: string;
  status?: number;
}

export type MeState =
  | { profile: MeProfile; status: "authenticated" }
  | { problem: MeProblem; status: "unavailable" | "unauthenticated" };

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function getMePath() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_ME_PATH ?? "/v1/me";
}

function buildMeUrl() {
  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  const path = getMePath().startsWith("/") ? getMePath() : `/${getMePath()}`;

  return `${baseUrl}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function readNestedRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (isRecord(value)) {
      return value;
    }
  }

  return null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeMePayload(payload: unknown): MeProfile | MeProblem {
  if (!isRecord(payload)) {
    return {
      code: "CONTRACT_MISMATCH",
      message: "/me did not return a JSON object."
    };
  }

  const user = readNestedRecord(payload, ["user", "principal"]);
  const tenant = readNestedRecord(payload, ["tenant", "organization"]);
  const clinic = readNestedRecord(payload, ["clinic", "currentClinic"]);
  const roles = normalizeRoles(payload.roles ?? payload.roleKeys ?? payload.role_keys);
  const permissions = readStringArray(payload.permissions);

  if (!user || !tenant || !clinic || roles.length === 0) {
    return {
      code: "CONTRACT_MISMATCH",
      detail: "Expected user, tenant, clinic, and at least one ClinicOS role.",
      message: "/me is reachable but does not match the Checkpoint 1 web contract."
    };
  }

  const userId = readString(user, ["id", "userId", "user_id", "sub"]);
  const tenantId = readString(tenant, ["id", "tenantId", "tenant_id"]);
  const clinicId = readString(clinic, ["id", "clinicId", "clinic_id"]);
  const displayName = readString(user, ["displayName", "display_name", "name", "fullName"]);
  const tenantName = readString(tenant, ["name", "displayName", "display_name"]);
  const clinicName = readString(clinic, ["name", "displayName", "display_name"]);

  if (!userId || !tenantId || !clinicId || !displayName || !tenantName || !clinicName) {
    return {
      code: "CONTRACT_MISMATCH",
      detail: "Expected stable ids and display names for user, tenant, and clinic.",
      message: "/me is reachable but is missing required identity context."
    };
  }

  const api = readNestedRecord(payload, ["api", "metadata", "meta"]);
  const featureFlags = isRecord(payload.featureFlags) ? payload.featureFlags : {};

  return {
    api: api
      ? {
          environment: readString(api, ["environment", "env"]) ?? undefined,
          requestId:
            readString(api, ["requestId", "request_id", "correlationId", "correlation_id"]) ??
            undefined,
          serverTime: readString(api, ["serverTime", "server_time", "now"]) ?? undefined
        }
      : undefined,
    clinic: {
      id: clinicId,
      name: clinicName,
      timezone: readString(clinic, ["timezone", "timeZone", "time_zone"]) ?? undefined
    },
    featureFlags: Object.fromEntries(
      Object.entries(featureFlags).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
      )
    ),
    permissions,
    roles,
    source: "api",
    tenant: {
      id: tenantId,
      name: tenantName
    },
    user: {
      displayName,
      email: readString(user, ["email", "emailAddress", "email_address"]) ?? undefined,
      id: userId
    }
  };
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = readNestedRecord(payload, ["error"]);
    const nested = error
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function problemFromHttp(response: Response, payload: unknown): MeProblem {
  const requestId = getRequestId(response, payload);

  if (response.status === 401 || response.status === 403) {
    return {
      code: "AUTH_REQUIRED",
      message: "Sign in through the configured identity provider before opening ClinicOS.",
      requestId,
      status: response.status
    };
  }

  if (response.status === 404) {
    return {
      code: "ME_ENDPOINT_NOT_REGISTERED",
      message: "The /me endpoint is not registered in this environment.",
      requestId,
      status: response.status
    };
  }

  if (response.status >= 500) {
    return {
      code: "SERVER_ERROR",
      message: "The ClinicOS API is reachable but not healthy enough to open the shell.",
      requestId,
      status: response.status
    };
  }

  return {
    code: "UNKNOWN",
    message: "The ClinicOS API returned an unexpected response for /me.",
    requestId,
    status: response.status
  };
}

export async function loadMe(signal?: AbortSignal): Promise<MeState> {
  if (isDevFixtureAllowed()) {
    return {
      profile: createSyntheticMeFixture(),
      status: "authenticated"
    };
  }

  try {
    const response = await fetch(buildMeUrl(), {
      credentials: "include",
      headers: {
        Accept: "application/json"
      },
      signal
    });
    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      const problem = problemFromHttp(response, payload);

      return {
        problem,
        status: problem.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
      };
    }

    const normalized = normalizeMePayload(payload);

    if ("code" in normalized) {
      return {
        problem: normalized,
        status: "unavailable"
      };
    }

    return {
      profile: normalized,
      status: "authenticated"
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return {
      problem: {
        code: "NETWORK_UNAVAILABLE",
        detail: error instanceof Error ? error.message : undefined,
        message: "The ClinicOS API could not be reached from the web shell."
      },
      status: "unavailable"
    };
  }
}
