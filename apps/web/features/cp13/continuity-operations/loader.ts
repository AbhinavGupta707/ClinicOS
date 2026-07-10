export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type PublicJsonObject = Readonly<Record<string, JsonValue>>;
export type VersionedPublicResource = PublicJsonObject & {
  readonly id: string;
  readonly rowVersion: number;
};

export interface ContinuityOperationsOverviewData {
  readonly ownerDashboard: PublicJsonObject | null;
  readonly tasks: readonly VersionedPublicResource[];
  readonly recalls: readonly PublicJsonObject[];
  readonly sopRuns: readonly VersionedPublicResource[];
  readonly labCases: readonly VersionedPublicResource[];
  readonly inventoryItems: readonly PublicJsonObject[];
  readonly inventoryExceptions: readonly PublicJsonObject[];
  readonly incidents: readonly PublicJsonObject[];
  readonly correctiveActions: readonly VersionedPublicResource[];
  readonly loadedAt: string;
  readonly freshness: OwnerFreshness | null;
}

export type ContinuityOperationsScope = "continuity" | "lab" | "operations" | "owner";

export interface OwnerFreshness {
  readonly status: "fresh" | "stale" | "unavailable";
  readonly generatedAt: string | null;
  readonly ageSeconds: number | null;
  readonly unavailableSources: readonly string[];
  readonly rebuildSupported: false;
}

export type ContinuityOperationsLoadState =
  | { readonly status: "ready"; readonly data: ContinuityOperationsOverviewData }
  | { readonly status: "stale"; readonly data: ContinuityOperationsOverviewData }
  | {
      readonly status: "unavailable";
      readonly problem: ContinuityOperationsProblem;
    }
  | {
      readonly status: "unauthenticated";
      readonly problem: ContinuityOperationsProblem;
    };

interface ContinuityOperationsProblem {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
}

/** Exact structural subset of the CP12 generated client consumed by this feature. */
export interface ContinuityOperationsGeneratedClient {
  getOwnerDashboard(input?: {
    readonly query?: { readonly from?: string; readonly to?: string };
  }): Promise<{ readonly dashboard: PublicJsonObject }>;
  listTasks(input?: { readonly query?: ReadQuery }): Promise<{
    readonly tasks: readonly VersionedPublicResource[];
  }>;
  listRecalls(input?: { readonly query?: ReadQuery }): Promise<{
    readonly recalls: readonly PublicJsonObject[];
  }>;
  listSopRuns(input?: { readonly query?: ReadQuery }): Promise<{
    readonly sopRuns: readonly VersionedPublicResource[];
  }>;
  listLabCases(input?: { readonly query?: ReadQuery }): Promise<{
    readonly labCases: readonly VersionedPublicResource[];
  }>;
  listInventoryItems(input?: { readonly query?: ReadQuery }): Promise<{
    readonly items: readonly PublicJsonObject[];
  }>;
  listInventoryExceptions(input?: { readonly query?: ReadQuery }): Promise<{
    readonly exceptions: readonly PublicJsonObject[];
  }>;
  listIncidents(input?: { readonly query?: ReadQuery }): Promise<{
    readonly incidents: readonly PublicJsonObject[];
  }>;
  listCorrectiveActions(input?: { readonly query?: ReadQuery }): Promise<{
    readonly correctiveActions: readonly VersionedPublicResource[];
  }>;
}

interface ReadQuery {
  readonly dueBefore?: string;
  readonly limit?: number;
}

export async function loadContinuityOperationsOverview(
  client: ContinuityOperationsGeneratedClient,
  input: {
    readonly from: string;
    readonly to: string;
    readonly observedAt: Date;
    readonly scope?: ContinuityOperationsScope;
  }
): Promise<ContinuityOperationsLoadState> {
  try {
    const scope = input.scope ?? "owner";
    const includeContinuity = scope === "continuity" || scope === "owner";
    const includeLab = scope === "lab" || scope === "owner";
    const includeOperations = scope === "operations" || scope === "owner";
    const [
      dashboardResponse,
      tasksResponse,
      recallsResponse,
      sopRunsResponse,
      labCasesResponse,
      inventoryItemsResponse,
      inventoryExceptionsResponse,
      incidentsResponse,
      correctiveActionsResponse
    ] = await Promise.all([
      scope === "owner"
        ? client.getOwnerDashboard({ query: { from: input.from, to: input.to } })
        : Promise.resolve(null),
      includeContinuity
        ? client.listTasks({ query: { dueBefore: endOfDay(input.to), limit: 200 } })
        : Promise.resolve({ tasks: [] }),
      includeContinuity
        ? client.listRecalls({ query: { dueBefore: endOfDay(input.to), limit: 200 } })
        : Promise.resolve({ recalls: [] }),
      includeContinuity
        ? client.listSopRuns({ query: { dueBefore: endOfDay(input.to), limit: 200 } })
        : Promise.resolve({ sopRuns: [] }),
      includeLab
        ? client.listLabCases({ query: { dueBefore: endOfDay(input.to), limit: 200 } })
        : Promise.resolve({ labCases: [] }),
      includeOperations
        ? client.listInventoryItems({ query: { limit: 200 } })
        : Promise.resolve({ items: [] }),
      includeOperations
        ? client.listInventoryExceptions({ query: { limit: 200 } })
        : Promise.resolve({ exceptions: [] }),
      includeOperations
        ? client.listIncidents({ query: { limit: 200 } })
        : Promise.resolve({ incidents: [] }),
      includeOperations
        ? client.listCorrectiveActions({ query: { limit: 200 } })
        : Promise.resolve({ correctiveActions: [] })
    ]);

    const freshness = dashboardResponse ? parseFreshness(dashboardResponse, input.observedAt) : null;
    const data: ContinuityOperationsOverviewData = {
      ownerDashboard: dashboardResponse?.dashboard ?? null,
      tasks: tasksResponse.tasks,
      recalls: recallsResponse.recalls,
      sopRuns: sopRunsResponse.sopRuns,
      labCases: labCasesResponse.labCases,
      inventoryItems: inventoryItemsResponse.items,
      inventoryExceptions: inventoryExceptionsResponse.exceptions,
      incidents: incidentsResponse.incidents,
      correctiveActions: correctiveActionsResponse.correctiveActions,
      loadedAt: input.observedAt.toISOString(),
      freshness
    };
    if (!freshness) return { status: "ready", data };
    return freshness.status === "fresh"
      ? { status: "ready", data }
      : freshness.status === "stale"
        ? { status: "stale", data }
        : {
            status: "unavailable",
            problem: {
              code: "ANALYTICS_SOURCE_UNAVAILABLE",
              message: "Owner analytics has one or more unavailable durable sources.",
              requestId: null,
              retryAfterSeconds: null
            }
          };
  } catch (error) {
    if (isClinicOsSessionUnavailable(error)) {
      return {
        status: "unauthenticated",
        problem: {
          code: error.code,
          message:
            "The authenticated session token provider is unavailable. No alternate data was substituted.",
          requestId: null,
          retryAfterSeconds: null
        }
      };
    }
    if (isGeneratedClientError(error)) {
      const unauthenticated = error.status === 401 || error.status === 403;
      return {
        status: unauthenticated ? "unauthenticated" : "unavailable",
        problem: {
          code: error.code,
          message: error.message,
          requestId: error.requestId || null,
          retryAfterSeconds: error.responseMetadata.retryAfterSeconds
        }
      };
    }
    return {
      status: "unavailable",
      problem: {
        code: "NETWORK_OR_CONTRACT_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Continuity operations could not be loaded from the generated API client.",
        requestId: null,
        retryAfterSeconds: null
      }
    };
  }
}

function parseFreshness(
  response: { readonly dashboard: PublicJsonObject },
  observedAt: Date
): OwnerFreshness {
  const raw = objectValue(response.dashboard.freshness);
  const generatedAt = typeof raw?.generatedAt === "string" ? raw.generatedAt : null;
  const unavailableSources = Array.isArray(raw?.unavailableSources)
    ? raw.unavailableSources.filter((value): value is string => typeof value === "string")
    : [];
  const serverStatus = raw?.status;
  if (serverStatus === "unavailable" || unavailableSources.length > 0) {
    return {
      status: "unavailable",
      generatedAt,
      ageSeconds: generatedAt ? ageSeconds(generatedAt, observedAt) : null,
      unavailableSources,
      rebuildSupported: false
    };
  }
  if (!generatedAt) {
    return {
      status: "unavailable",
      generatedAt: null,
      ageSeconds: null,
      unavailableSources: ["owner-dashboard-freshness"],
      rebuildSupported: false
    };
  }
  const age = ageSeconds(generatedAt, observedAt);
  const staleAfter = typeof raw?.staleAfterSeconds === "number" ? raw.staleAfterSeconds : 300;
  return {
    status: serverStatus === "stale" || age > staleAfter ? "stale" : "fresh",
    generatedAt,
    ageSeconds: age,
    unavailableSources,
    rebuildSupported: false
  };
}

function isGeneratedClientError(error: unknown): error is {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly responseMetadata: { readonly retryAfterSeconds: number | null };
} {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  const metadata = candidate.responseMetadata;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.requestId === "string" &&
    Boolean(metadata) &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ageSeconds(generatedAt: string, observedAt: Date): number {
  const generatedMs = Date.parse(generatedAt);
  return Number.isFinite(generatedMs)
    ? Math.max(0, Math.floor((observedAt.getTime() - generatedMs) / 1_000))
    : Number.POSITIVE_INFINITY;
}

function endOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}
import { isClinicOsSessionUnavailable } from "@/lib/cp13-api-client";
