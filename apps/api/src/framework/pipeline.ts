import type { IncomingMessage } from "node:http";
import {
  parseNativeOperationRequest,
  parseNativeOperationResponse,
  parseNativeOperationResponseHeaders,
  type ParsedOperationRequest
} from "@clinic-os/api-contracts";
import {
  deriveVerifiedRequestScope,
  permissionsForScope,
  roleSlugsForScope
} from "@clinic-os/auth";
import {
  API_REPLAY_RESPONSE_HEADER_ALLOWLIST,
  OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES,
  type OptimisticConcurrencyOperationId
} from "@clinic-os/db";
import { isUuid, type UUID } from "@clinic-os/domain";
import {
  BoundaryError,
  assertContentLengthWithinBudget,
  createBodyBudgetCounter,
  createRequestCorrelationContext,
  deriveAbuseBudgetKey,
  enforceExpensiveOperationBudget,
  enforceQueryBudget,
  enforceRateBudget
} from "@clinic-os/security";
import type {
  ApiResponse,
  ApiTransactionContext,
  ClinicOsNestRuntime,
  ResolvedAccessContext,
  VerifiedClinicRequestContext
} from "./contracts.ts";
import { ProbeSafeLivenessBudgetStore } from "./probe-safe-liveness-budget.ts";
import {
  matchClinicOsRoute,
  permissionsForOperation,
  requiredRolesForOperation
} from "./route-registry.ts";
import {
  assertUnambiguousSecurityHeaders,
  attachRequestId,
  canonicalRequestDigest,
  headerValue,
  rawRequestBody,
  requestBodyForContract,
  requestIdHeader,
  requestUrl,
  selectContractHeaders,
  type ParsedIncomingRequest
} from "./request-utils.ts";

export interface PipelineResponse extends ApiResponse {
  headers: Readonly<Record<string, string>>;
}

const PRE_AUTHENTICATION_RATE_POLICY = {
  limit: 600,
  windowSeconds: 60,
  scope: "ip" as const
};

export class ClinicOsRequestPipeline {
  readonly #runtime: ClinicOsNestRuntime;
  readonly #healthProbeBudgetStore = new ProbeSafeLivenessBudgetStore();

  constructor(runtime: ClinicOsNestRuntime) {
    this.#runtime = runtime;
    if (
      runtime.repositoryMode !== "fixture" &&
      runtime.mutationCoordinator.durability !== "durable_transactional"
    ) {
      throw new Error(
        "Non-fixture ClinicOS runtime requires a durable transaction-bound idempotency and concurrency coordinator."
      );
    }
  }

  async readiness(): Promise<void> {
    await this.#runtime.mutationCoordinator.readiness();
    const candidate = this.#runtime.budgetStore as { readiness?: () => Promise<void> };
    if (candidate.readiness) await candidate.readiness();
  }

  async execute(request: ParsedIncomingRequest): Promise<PipelineResponse> {
    const url = requestUrl(request);
    const method = (request.method ?? "GET").toUpperCase();
    const matched = matchClinicOsRoute(method, url.pathname);
    const now = this.#runtime.clock.now();
    const correlation = createRequestCorrelationContext({
      requestIdHeader: requestIdHeader(request),
      method,
      routeId: matched?.policy.routeId ?? "unmatched.route",
      now
    });
    attachRequestId(request, correlation.requestId);
    if (!matched) {
      throw new BoundaryError({
        code: "NOT_FOUND",
        message: "Route not found.",
        details: { method }
      });
    }

    assertUnambiguousSecurityHeaders(request);
    enforceQueryBudget(url.searchParams, matched.policy.abuse.query);
    this.#enforceBodyBudget(request, matched.operation.request.body?.maximumBytes ?? null);
    if (matched.policy.access.mode !== "public_health") {
      await this.#enforcePreAuthenticationRate(request, matched.policy.routeId, now);
    }

    if (url.pathname.startsWith("/v1/") && !(await this.#runtime.admitTraffic())) {
      throw new BoundaryError({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "ClinicOS API startup dependencies are unavailable.",
        details: { reason: "startup_dependencies_unavailable" }
      });
    }

    let access: ResolvedAccessContext | null = null;
    let verifiedClinic: VerifiedClinicRequestContext | null = null;
    if (matched.policy.access.mode === "authenticated") {
      access = await this.#runtime.resolveAccess(request);
      assertActiveMembership(access);
      if (matched.policy.access.clinic === "verified_active_membership") {
        verifiedClinic = resolveVerifiedClinic(request, access);
      }
      assertCentralPermissions(matched.operation.operationId, access, verifiedClinic);
    }

    const parsedRequest = parseRequestContract(
      request,
      url,
      matched.operation.operationId,
      matched.pathParameters,
      correlation.requestId,
      this.#runtime.useLocalAuthFixture
    );

    if (access) {
      await this.#enforceAuthenticatedBudgets(
        matched.policy,
        access,
        verifiedClinic,
        now
      );
    } else if (matched.policy.access.mode !== "authenticated") {
      await this.#enforcePublicRouteBudget(request, matched.policy, now);
    }

    const dispatch = (transaction?: ApiTransactionContext): Promise<ApiResponse> => {
      if (matched.policy.access.mode === "public_health") {
        return this.#runtime.health(matched.policy.access.healthKind, correlation.requestId);
      }
      if (matched.policy.access.mode === "verified_webhook") {
        const rawBody = rawRequestBody(request) ?? Buffer.alloc(0);
        return this.#runtime.handleWebhook(
          request,
          correlation.requestId,
          rawBody,
          transaction
        );
      }
      if (matched.operation.operationId === "getCurrentIdentity") {
        if (!access) throw new Error("Identity route reached dispatch without verified access.");
        return this.#runtime.handleIdentity(request, correlation.requestId, access);
      }
      if (!verifiedClinic) {
        throw new Error("Clinic operation reached dispatch without verified clinic context.");
      }
      return this.#runtime.handleLegacyOperation(
        request,
        correlation.requestId,
        verifiedClinic,
        parsedRequest.body,
        rawRequestBody(request),
        transaction
      );
    };

    const validateResponse = (response: ApiResponse, replayed: boolean): ApiResponse => {
      const body = normalizeJsonResponseBody(response.body);
      const headers = contractResponseHeaders({
        operation: matched.operation,
        status: response.status,
        body,
        effectHeaders: response.headers,
        requestId: correlation.requestId,
        replayed
      });
      const normalizedResponse = {
        status: response.status,
        body,
        headers
      };
      const responseContract = parseNativeOperationResponse(
        matched.operation.operationId,
        normalizedResponse.status,
        normalizedResponse.body
      );
      if (!responseContract.success) {
        throw new BoundaryError({
          code: "INTERNAL_ERROR",
          message: "The response failed its runtime contract.",
          details: {
            operation: matched.operation.operationId,
            issues: responseContract.issues
              .slice(0, 50)
              .map(({ path, code }) => ({ path, code }))
          }
        });
      }
      const headerContract = parseNativeOperationResponseHeaders(
        matched.operation.operationId,
        normalizedResponse.status,
        normalizedResponse.headers
      );
      if (!headerContract.success) {
        throw new BoundaryError({
          code: "INTERNAL_ERROR",
          message: "The response headers failed their runtime contract.",
          details: {
            operation: matched.operation.operationId,
            issues: headerContract.issues
              .slice(0, 50)
              .map(({ path, code }) => ({ path, code }))
          }
        });
      }
      return normalizedResponse;
    };
    const concurrency =
      matched.operation.concurrency.mode === "if-match"
        ? concurrencyMetadata(
            matched.operation.operationId,
            matched.pathParameters,
            requiredParsedHeader(parsedRequest, "if-match")
          )
        : null;
    const mutationResult =
      matched.operation.idempotency.mode === "header"
        ? await this.#runtime.mutationCoordinator.execute(
            {
              identity: mutationIdentity(verifiedClinic),
              idempotency: {
                operationId: matched.operation.operationId,
                key: requiredParsedHeader(parsedRequest, "idempotency-key"),
                requestDigest: canonicalRequestDigest(matched.operation, parsedRequest)
              },
              concurrency,
              versionAdvances: deriveVersionAdvancesForMutation(
                matched.operation.operationId,
                matched.pathParameters,
                parsedRequest.body,
                concurrency
              ),
              requestId: correlation.requestId,
              now
            },
            async (transaction) => validateResponse(await dispatch(transaction), false)
          )
        : null;
    const response = mutationResult
      ? validateResponse(mutationResult.response, mutationResult.replayed)
      : validateResponse(await dispatch(), false);
    const successfulIdempotentMutation =
      matched.operation.idempotency.mode === "header" &&
      response.status >= 200 &&
      response.status < 300;

    return {
      status: response.status,
      body: response.body,
      headers: {
        ...response.headers,
        "cache-control": response.headers?.["cache-control"] ?? "no-store",
        "x-request-id": correlation.requestId,
        ...(successfulIdempotentMutation
          ? { "idempotency-replayed": mutationResult?.replayed ? "true" : "false" }
          : {})
      }
    };
  }

  #enforceBodyBudget(request: ParsedIncomingRequest, maximumBytes: number | null): void {
    const contentLength = headerValue(request, "content-length");
    const rawBody = rawRequestBody(request);
    if (maximumBytes === null) {
      if (contentLength !== undefined && contentLength !== "0") {
        throw new BoundaryError({
          code: "VALIDATION_ERROR",
          message: "This operation does not accept a request body.",
          details: { source: "body", reason: "body_not_allowed" }
        });
      }
      return;
    }
    const policy = { maxBytes: maximumBytes };
    assertContentLengthWithinBudget(contentLength, policy);
    if (rawBody) createBodyBudgetCounter(policy).observe(rawBody);
  }

  async #enforcePreAuthenticationRate(
    request: IncomingMessage,
    routeId: string,
    now: Date
  ): Promise<void> {
    const identity = request.socket.remoteAddress ?? "unknown-ip";
    await enforceRateBudget({
      store: this.#runtime.budgetStore,
      bucketKey: deriveAbuseBudgetKey({
        secret: this.#runtime.budgetKeySecret,
        routeId: `${routeId}.preauth`,
        scope: "ip",
        identity
      }),
      policy: PRE_AUTHENTICATION_RATE_POLICY,
      now
    });
  }

  async #enforceAuthenticatedBudgets(
    policy: (typeof import("./route-registry.ts"))["CLINIC_OS_ROUTE_POLICIES"][number],
    access: ResolvedAccessContext,
    clinic: VerifiedClinicRequestContext | null,
    now: Date
  ): Promise<void> {
    const identity = `${access.context.tenant.id}:${clinic?.clinicId ?? "tenant"}:${access.context.user.id}`;
    const rateKey = deriveAbuseBudgetKey({
      secret: this.#runtime.budgetKeySecret,
      routeId: policy.routeId,
      scope: policy.abuse.rate.scope,
      identity
    });
    await enforceRateBudget({
      store: this.#runtime.budgetStore,
      bucketKey: rateKey,
      policy: policy.abuse.rate,
      now
    });
    if (policy.abuse.expensiveOperation) {
      await enforceExpensiveOperationBudget({
        store: this.#runtime.budgetStore,
        bucketKey: `${rateKey}:expensive`,
        requestedUnits: 1,
        policy: policy.abuse.expensiveOperation,
        now
      });
    }
  }

  async #enforcePublicRouteBudget(
    request: IncomingMessage,
    policy: (typeof import("./route-registry.ts"))["CLINIC_OS_ROUTE_POLICIES"][number],
    now: Date
  ): Promise<void> {
    const identity = request.socket.remoteAddress ?? "unknown-ip";
    await enforceRateBudget({
      store:
        policy.access.mode === "public_health"
          ? this.#healthProbeBudgetStore
          : this.#runtime.budgetStore,
      bucketKey: deriveAbuseBudgetKey({
        secret: this.#runtime.budgetKeySecret,
        routeId: policy.routeId,
        scope: policy.abuse.rate.scope,
        identity
      }),
      policy: policy.abuse.rate,
      now
    });
  }
}

function normalizeJsonResponseBody(body: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(body)) as unknown;
  } catch {
    throw new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The response could not be serialized safely."
    });
  }
}

function contractResponseHeaders(input: {
  operation: (typeof import("@clinic-os/api-contracts"))["ACTIVE_NATIVE_HTTP_OPERATIONS"][number];
  status: number;
  body: unknown;
  effectHeaders: Readonly<Record<string, string>> | undefined;
  requestId: string;
  replayed: boolean;
}): Readonly<Record<string, string>> {
  const responseContract = input.operation.responses[input.status];
  const allowed = new Set<string>([
    ...API_REPLAY_RESPONSE_HEADER_ALLOWLIST,
    "cache-control",
    "content-type",
    ...Object.keys(responseContract?.headers ?? {}).map((name) => name.toLowerCase())
  ]);
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input.effectHeaders ?? {})) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name)) continue;
    if (/\r|\n/u.test(value)) {
      throw new BoundaryError({
        code: "INTERNAL_ERROR",
        message: "The response headers could not be completed safely."
      });
    }
    headers[name] = value;
  }
  headers["x-request-id"] = input.requestId;
  if (!responseContract) return headers;
  const successful = input.status >= 200 && input.status < 300;
  if (successful && responseContract.headers["idempotency-replayed"]) {
    headers["idempotency-replayed"] = input.replayed ? "true" : "false";
  } else {
    delete headers["idempotency-replayed"];
  }
  const etagContract = Object.entries(responseContract.headers).find(
    ([name]) => name.toLowerCase() === "etag"
  )?.[1];
  if (etagContract?.sourceProperty) {
    const rowVersion = responseRowVersion(input.body, etagContract.sourceProperty);
    const derived = `"rv-${rowVersion}"`;
    if (headers.etag !== undefined && headers.etag !== derived) {
      throw new BoundaryError({
        code: "INTERNAL_ERROR",
        message: "The response ETag did not match its version source."
      });
    }
    headers.etag = derived;
  } else {
    delete headers.etag;
  }
  return headers;
}

function responseRowVersion(body: unknown, sourceProperty: string): number {
  let current = body;
  for (const segment of sourceProperty.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new BoundaryError({
        code: "INTERNAL_ERROR",
        message: "The response version source was unavailable."
      });
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The response version source was unavailable."
    });
  }
  const rowVersion = (current as Record<string, unknown>).rowVersion;
  if (!Number.isSafeInteger(rowVersion) || (rowVersion as number) < 1) {
    throw new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The response row version was invalid."
    });
  }
  return rowVersion as number;
}

function parseRequestContract(
  request: ParsedIncomingRequest,
  url: URL,
  operationId: string,
  pathParameters: Readonly<Record<string, string>>,
  requestId: string,
  useLocalAuthFixture: boolean
): ParsedOperationRequest {
  const matched = matchClinicOsRoute((request.method ?? "GET").toUpperCase(), url.pathname);
  if (!matched || matched.operation.operationId !== operationId) {
    throw new Error("Route contract selection changed during request processing.");
  }
  const result = parseNativeOperationRequest(operationId, {
    path: pathParameters,
    query: url.searchParams,
    headers: selectContractHeaders(
      request,
      matched.operation,
      requestId,
      useLocalAuthFixture
    ),
    body: requestBodyForContract(request, matched.operation)
  });
  if (!result.success) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request failed runtime validation.",
      details: {
        issues: result.issues.slice(0, 50).map(({ location, path, code }) => ({
          location,
          path,
          code
        }))
      }
    });
  }
  return result.data;
}

function assertActiveMembership(access: ResolvedAccessContext): void {
  const active =
    access.context.tenant.status === "active" &&
    access.context.user.status === "active" &&
    access.context.memberships.some(
      (membership) =>
        membership.tenantId === access.context.tenant.id &&
        membership.userId === access.context.user.id &&
        membership.status === "active"
    );
  if (!active) {
    throw new BoundaryError({
      code: "PERMISSION_DENIED",
      message: "The verified identity has no active ClinicOS membership.",
      details: { reason: "inactive_membership" }
    });
  }
}

function resolveVerifiedClinic(
  request: IncomingMessage,
  access: ResolvedAccessContext
): VerifiedClinicRequestContext {
  const selected = headerValue(request, "x-clinic-id");
  if (selected && !isUuid(selected)) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request clinic selector failed validation.",
      details: { field: "x-clinic-id" }
    });
  }
  const scope = deriveVerifiedRequestScope({
    context: access.context,
    clinics: access.clinics,
    selectedClinicId: (selected as UUID | undefined) ?? null
  });
  const clinic = access.clinics.find((candidate) => candidate.id === scope.clinicId);
  if (!clinic) throw new Error("Verified clinic scope did not resolve to an identity snapshot clinic.");
  return { ...access, clinicId: scope.clinicId, clinic };
}

function assertCentralPermissions(
  operationId: string,
  access: ResolvedAccessContext,
  clinic: VerifiedClinicRequestContext | null
): void {
  if (operationId === "getCurrentIdentity") return;
  if (!clinic) throw new Error("Clinic-scoped authorization requires a verified clinic.");
  const activeClinicPermissions = permissionsForScope(
    clinic.context,
    clinic.context.tenant.id,
    clinic.clinicId
  );
  for (const required of permissionsForOperation(operationId)) {
    const allowed = activeClinicPermissions.includes(required as never);
    if (!allowed) {
      throw new BoundaryError({
        code: "PERMISSION_DENIED",
        message: "The verified identity is not authorized for this operation.",
        details: { reason: "missing_permission", required_permission: required }
      });
    }
  }
  const activeClinicRoles = roleSlugsForScope(
    clinic.context,
    clinic.context.tenant.id,
    clinic.clinicId
  );
  for (const requiredRole of requiredRolesForOperation(operationId)) {
    if (!activeClinicRoles.includes(requiredRole as never)) {
      throw new BoundaryError({
        code: "PERMISSION_DENIED",
        message: "The verified identity is not authorized for this operation.",
        details: { reason: "missing_clinic_role", required_role: requiredRole }
      });
    }
  }
}

function mutationIdentity(clinic: VerifiedClinicRequestContext | null) {
  if (!clinic) throw new Error("Mutation reached idempotency without verified clinic authority.");
  return {
    tenantId: clinic.context.tenant.id,
    clinicId: clinic.clinicId,
    actorUserId: clinic.context.user.id
  };
}

function requiredParsedHeader(request: ParsedOperationRequest, name: string): string {
  const headers = request.headers as Record<string, unknown>;
  const value = headers[name];
  if (typeof value !== "string") throw new Error(`Validated request is missing ${name}.`);
  return value;
}

const CONCURRENCY_RESOURCE_PARAMETER = Object.freeze({
  updatePatient: "patientId",
  updateLeadStatus: "leadId",
  updateAppointment: "appointmentId",
  updateQueueEntry: "queueEntryId",
  saveEncounterClinicalNoteDraft: "encounterId",
  updateDentalFinding: "findingId",
  updateTreatmentPlan: "treatmentPlanId",
  updateTask: "taskId",
  updateSopRun: "sopRunId",
  updateLabCase: "labCaseId",
  updateInventoryCheckRun: "checkRunId",
  updateCorrectiveAction: "correctiveActionId"
} satisfies Record<OptimisticConcurrencyOperationId, string>);

function concurrencyMetadata(
  operationId: string,
  pathParameters: Readonly<Record<string, string>>,
  expectedEtag: string
) {
  if (!Object.hasOwn(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES, operationId)) {
    throw new Error(`Concurrency operation is not DB-allowlisted: ${operationId}`);
  }
  const exactOperationId = operationId as OptimisticConcurrencyOperationId;
  const parameterName = CONCURRENCY_RESOURCE_PARAMETER[exactOperationId];
  const resourceId = pathParameters[parameterName];
  if (!resourceId || !isUuid(resourceId)) {
    throw new Error(`Validated concurrency resource is missing: ${parameterName}`);
  }
  return { operationId: exactOperationId, resourceId, expectedEtag };
}

export function deriveVersionAdvancesForMutation(
  operationId: string,
  pathParameters: Readonly<Record<string, string>>,
  body: unknown,
  concurrency: ReturnType<typeof concurrencyMetadata> | null
) {
  const advances: Array<{
    operationId: OptimisticConcurrencyOperationId;
    resourceId: UUID;
  }> = [];
  if (concurrency) {
    advances.push({ operationId: concurrency.operationId, resourceId: concurrency.resourceId });
  }

  const addPathResource = (
    tableOperationId: OptimisticConcurrencyOperationId,
    parameterName: string
  ) => {
    const resourceId = pathParameters[parameterName];
    if (!resourceId || !isUuid(resourceId)) {
      throw new Error(`Validated versioned resource is missing: ${parameterName}`);
    }
    advances.push({ operationId: tableOperationId, resourceId });
  };
  switch (operationId) {
    case "createPatient": {
      const leadId = bodyUuid(body, "leadId");
      if (leadId) advances.push({ operationId: "updateLeadStatus", resourceId: leadId });
      break;
    }
    case "matchLeadToPatient":
    case "convertLeadToAppointment":
      addPathResource("updateLeadStatus", "leadId");
      break;
    case "confirmAppointment":
    case "checkInAppointment":
    case "markAppointmentNoShow":
      addPathResource("updateAppointment", "appointmentId");
      break;
    case "startEncounter":
    case "signEncounterClinicalNote":
    case "amendEncounterClinicalNote":
      addPathResource("saveEncounterClinicalNoteDraft", "encounterId");
      break;
    case "acceptTreatmentPlan":
      addPathResource("updateTreatmentPlan", "treatmentPlanId");
      break;
    case "createEncounterProcedurePerformed": {
      const treatmentPlanId = bodyUuid(body, "treatmentPlanId");
      if (!treatmentPlanId) {
        throw new Error("Validated versioned resource is missing: treatmentPlanId");
      }
      advances.push({ operationId: "updateTreatmentPlan", resourceId: treatmentPlanId });
      break;
    }
  }
  return advances;
}

function bodyUuid(body: unknown, property: string): UUID | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[property];
  return isUuid(value) ? value : null;
}
