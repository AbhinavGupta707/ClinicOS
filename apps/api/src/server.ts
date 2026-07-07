import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { safeParseClinicOsEnv, type ClinicOsConfig } from "@clinic-os/config";
import {
  AuthenticationError,
  AuthorizationError,
  buildAccessContext,
  principalFromVerifiedKeycloakClaims,
  type AccessContext,
  type KeycloakAccessTokenClaims
} from "@clinic-os/auth";
import {
  PostgresAuditEventSink,
  PostgresClinicOperationsRepository,
  PostgresIdentityRepository,
  type ClinicOperationsRepository,
  type IdentityRepository
} from "@clinic-os/db";
import { isUuid, type UUID } from "@clinic-os/domain";
import type { AuditEventRecord } from "@clinic-os/security";
import { Pool } from "pg";
import { ApiError, toApiErrorBody } from "./errors.ts";
import { KeycloakJwtVerifier } from "./keycloak-verifier.ts";
import {
  createLocalFixtureClaims,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository
} from "./local-fixture.ts";
import { getMe } from "./me.ts";
import {
  checkInAppointment,
  amendEncounterClinicalNote,
  confirmAppointment,
  convertLeadToAppointment,
  createAppointment,
  createEncounter,
  createEncounterPrescription,
  createIntakeFormTemplate,
  createLead,
  createPatient,
  createPatientConsent,
  getMorningDashboard,
  getEncounter,
  getPatient,
  getPatientTimeline,
  listAppointmentTypes,
  listAppointments,
  listChairs,
  listIntakeFormTemplates,
  listLeads,
  listPatientConsents,
  listPatients,
  listProviderSchedules,
  listQueue,
  markAppointmentNoShow,
  matchLeadToPatient,
  revokePatientConsent,
  saveEncounterClinicalNoteDraft,
  signEncounterClinicalNote,
  signPrescription,
  startEncounter,
  submitPatientIntakeForm,
  updateAppointment,
  updateLeadStatus,
  updatePatient,
  updateQueueEntry,
  type OperationsRequestContext
} from "./operations.ts";

interface AuditSink {
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
}

interface TokenVerifier {
  verifyAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<KeycloakAccessTokenClaims>;
}

export interface ClinicOsApiServerOptions {
  config: ClinicOsConfig;
  identityRepository: IdentityRepository;
  operationsRepository?: ClinicOperationsRepository;
  auditSink?: AuditSink;
  tokenVerifier?: TokenVerifier;
  useLocalAuthFixture?: boolean;
  fixtureSubject?: string;
}

interface RuntimeOptions {
  server: Server;
  port: number;
}

const DEFAULT_PORT = 4000;
const DEFAULT_API_AUDIENCE = "clinic-os-api";

export function createClinicOsApiServer(options: ClinicOsApiServerOptions): Server {
  const expectedIssuer = buildExpectedIssuer(options.config);
  const acceptedAudience = process.env.CLINIC_OS_API_AUDIENCE ?? DEFAULT_API_AUDIENCE;
  const tokenVerifier =
    options.tokenVerifier ??
    new KeycloakJwtVerifier({
      expectedIssuer,
      jwksUri: `${expectedIssuer}/protocol/openid-connect/certs`
    });

  return createServer(async (request, response) => {
    const requestId = getRequestId(request);
    response.setHeader("x-request-id", requestId);

    try {
      if (request.method === "GET" && request.url === "/health/live") {
        return sendJson(response, 200, {
          status: "ok",
          service: "clinic-os-api",
          request_id: requestId
        });
      }

      if (request.method === "GET" && request.url === "/health/ready") {
        return sendJson(response, 200, {
          status: "ready",
          auth: options.useLocalAuthFixture ? "local_synthetic_fixture" : "keycloak_jwks",
          repository: "identity_repository_configured",
          request_id: requestId
        });
      }

      if (request.method === "GET" && request.url === "/v1/me") {
        const verifiedKeycloakClaims = await resolveClaims({
          request,
          tokenVerifier,
          useLocalAuthFixture: options.useLocalAuthFixture ?? false,
          fixtureSubject: options.fixtureSubject,
          expectedIssuer,
          acceptedAudience
        });

        const result = await getMe(
          {
            requestId,
            verifiedKeycloakClaims,
            ipAddress: request.socket.remoteAddress ?? null,
            userAgent: request.headers["user-agent"] ?? null
          },
          {
            keycloak: {
              expectedIssuer,
              acceptedAudiences: [
                acceptedAudience,
                options.config.auth.keycloakClientId,
                "clinicos-api"
              ],
              acceptedClientIds: [acceptedAudience, options.config.auth.keycloakClientId]
            },
            identityRepository: options.identityRepository,
            auditSink: options.auditSink
          }
        );

        return sendJson(response, result.status, result.body);
      }

      if (request.url?.startsWith("/v1/")) {
        if (!options.operationsRepository) {
          throw new ApiError(
            503,
            "CONFIGURATION_ERROR",
            "ClinicOS operations repository is not configured."
          );
        }

        const result = await routeOperationsRequest({
          request,
          requestId,
          tokenVerifier,
          expectedIssuer,
          acceptedAudience,
          config: options.config,
          identityRepository: options.identityRepository,
          repository: options.operationsRepository,
          auditSink: options.auditSink,
          useLocalAuthFixture: options.useLocalAuthFixture ?? false,
          fixtureSubject: options.fixtureSubject
        });

        return sendJson(response, result.status, result.body);
      }

      throw new ApiError(404, "NOT_FOUND", "Route not found.", {
        method: request.method,
        path: request.url
      });
    } catch (error) {
      return sendApiError(response, normalizeApiError(error), requestId);
    }
  });
}

export function createRuntimeApiServer(env: NodeJS.ProcessEnv = process.env): RuntimeOptions {
  const parsed = safeParseClinicOsEnv(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw new ApiError(503, "CONFIGURATION_ERROR", "ClinicOS API configuration is invalid.", {
      issues
    });
  }

  const useLocalAuthFixture = parseBoolean(env.CLINIC_OS_API_USE_DEV_AUTH_FIXTURE);

  if (parsed.data.isProductionLike && useLocalAuthFixture) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "CLINIC_OS_API_USE_DEV_AUTH_FIXTURE is forbidden outside local/dev environments."
    );
  }

  const repositorySet = useLocalAuthFixture
    ? {
        identityRepository: new LocalFixtureIdentityRepository(),
        operationsRepository: new LocalFixtureClinicOperationsRepository(),
        auditSink: new InMemoryAuditSink()
      }
    : createPostgresRepositorySet(parsed.data);
  const port = parsePort(env.PORT ?? env.API_PORT);

  const serverOptions: ClinicOsApiServerOptions = {
    config: parsed.data,
    identityRepository: repositorySet.identityRepository,
    operationsRepository: repositorySet.operationsRepository,
    auditSink: repositorySet.auditSink,
    useLocalAuthFixture
  };

  if (env.CLINIC_OS_API_DEV_SUBJECT) {
    serverOptions.fixtureSubject = env.CLINIC_OS_API_DEV_SUBJECT;
  }

  return {
    port,
    server: createClinicOsApiServer(serverOptions)
  };
}

async function routeOperationsRequest(input: {
  request: IncomingMessage;
  requestId: string;
  tokenVerifier: TokenVerifier;
  expectedIssuer: string;
  acceptedAudience: string;
  config: ClinicOsConfig;
  identityRepository: IdentityRepository;
  repository: ClinicOperationsRepository;
  auditSink?: AuditSink;
  useLocalAuthFixture: boolean;
  fixtureSubject?: string | undefined;
}) {
  const url = new URL(input.request.url ?? "/", "http://clinic-os.local");
  const pathname = url.pathname;
  const accessContext = await resolveAccessContext(input);
  const operationsContext: OperationsRequestContext = {
    requestId: input.requestId,
    accessContext,
    clinicId: resolveClinicId(input.request, accessContext),
    ipAddress: input.request.socket.remoteAddress ?? null,
    userAgent: headerValue(input.request, "user-agent") ?? null,
    idempotencyKey: headerValue(input.request, "idempotency-key") ?? null
  };
  const dependencies = {
    repository: input.repository,
    auditSink: input.auditSink
  };
  const body = ["POST", "PATCH", "PUT"].includes(input.request.method ?? "")
    ? await readJsonBody(input.request)
    : undefined;

  if (input.request.method === "GET" && pathname === "/v1/form-templates") {
    return listIntakeFormTemplates(operationsContext, dependencies);
  }

  if (input.request.method === "POST" && pathname === "/v1/form-templates") {
    return createIntakeFormTemplate(operationsContext, dependencies, body);
  }

  if (input.request.method === "GET" && pathname === "/v1/patients") {
    return listPatients(operationsContext, dependencies, {
      query: url.searchParams.get("query"),
      phone: url.searchParams.get("phone"),
      source: url.searchParams.get("source")
    });
  }

  if (input.request.method === "POST" && pathname === "/v1/patients") {
    return createPatient(operationsContext, dependencies, body);
  }

  const patientMatch = pathname.match(/^\/v1\/patients\/([^/]+)$/);
  if (patientMatch) {
    const patientId = pathUuid(patientMatch[1], "patientId");
    if (input.request.method === "GET")
      return getPatient(operationsContext, dependencies, patientId);
    if (input.request.method === "PATCH")
      return updatePatient(operationsContext, dependencies, patientId, body);
  }

  const timelineMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/timeline$/);
  if (timelineMatch && input.request.method === "GET") {
    return getPatientTimeline(
      operationsContext,
      dependencies,
      pathUuid(timelineMatch[1], "patientId")
    );
  }

  const formResponseMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/form-responses$/);
  if (formResponseMatch && input.request.method === "POST") {
    return submitPatientIntakeForm(
      operationsContext,
      dependencies,
      pathUuid(formResponseMatch[1], "patientId"),
      body
    );
  }

  const consentsMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/consents$/);
  if (consentsMatch) {
    const patientId = pathUuid(consentsMatch[1], "patientId");
    if (input.request.method === "GET")
      return listPatientConsents(operationsContext, dependencies, patientId);
    if (input.request.method === "POST")
      return createPatientConsent(operationsContext, dependencies, patientId, body);
  }

  const consentRevokeMatch = pathname.match(
    /^\/v1\/patients\/([^/]+)\/consents\/([^/]+)\/revoke$/
  );
  if (consentRevokeMatch && input.request.method === "POST") {
    return revokePatientConsent(
      operationsContext,
      dependencies,
      pathUuid(consentRevokeMatch[1], "patientId"),
      pathUuid(consentRevokeMatch[2], "consentId"),
      body
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/leads") {
    return listLeads(operationsContext, dependencies, {
      source: url.searchParams.get("source"),
      status: url.searchParams.get("status")
    });
  }

  if (input.request.method === "POST" && pathname === "/v1/leads") {
    return createLead(operationsContext, dependencies, body);
  }

  const leadMatchPatientMatch = pathname.match(/^\/v1\/leads\/([^/]+)\/match-patient$/);
  if (leadMatchPatientMatch && input.request.method === "POST") {
    return matchLeadToPatient(
      operationsContext,
      dependencies,
      pathUuid(leadMatchPatientMatch[1], "leadId"),
      body
    );
  }

  const leadConvertMatch = pathname.match(/^\/v1\/leads\/([^/]+)\/convert-to-appointment$/);
  if (leadConvertMatch && input.request.method === "POST") {
    return convertLeadToAppointment(
      operationsContext,
      dependencies,
      pathUuid(leadConvertMatch[1], "leadId"),
      body
    );
  }

  const leadStatusMatch = pathname.match(/^\/v1\/leads\/([^/]+)\/status$/);
  if (leadStatusMatch && input.request.method === "PATCH") {
    return updateLeadStatus(
      operationsContext,
      dependencies,
      pathUuid(leadStatusMatch[1], "leadId"),
      body
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/appointments") {
    return listAppointments(operationsContext, dependencies, {
      date: url.searchParams.get("date"),
      providerId: url.searchParams.get("providerId"),
      status: url.searchParams.get("status")
    });
  }

  if (input.request.method === "POST" && pathname === "/v1/appointments") {
    return createAppointment(operationsContext, dependencies, body);
  }

  if (input.request.method === "GET" && pathname === "/v1/appointment-types") {
    return listAppointmentTypes(operationsContext, dependencies);
  }

  if (input.request.method === "GET" && pathname === "/v1/chairs") {
    return listChairs(operationsContext, dependencies);
  }

  if (input.request.method === "GET" && pathname === "/v1/provider-schedules") {
    return listProviderSchedules(
      operationsContext,
      dependencies,
      url.searchParams.get("providerId")
    );
  }

  const appointmentPatchMatch = pathname.match(/^\/v1\/appointments\/([^/]+)$/);
  if (appointmentPatchMatch && input.request.method === "PATCH") {
    return updateAppointment(
      operationsContext,
      dependencies,
      pathUuid(appointmentPatchMatch[1], "appointmentId"),
      body
    );
  }

  const appointmentConfirmMatch = pathname.match(/^\/v1\/appointments\/([^/]+)\/confirm$/);
  if (appointmentConfirmMatch && input.request.method === "POST") {
    return confirmAppointment(
      operationsContext,
      dependencies,
      pathUuid(appointmentConfirmMatch[1], "appointmentId")
    );
  }

  const appointmentCheckInMatch = pathname.match(/^\/v1\/appointments\/([^/]+)\/check-in$/);
  if (appointmentCheckInMatch && input.request.method === "POST") {
    return checkInAppointment(
      operationsContext,
      dependencies,
      pathUuid(appointmentCheckInMatch[1], "appointmentId")
    );
  }

  const appointmentNoShowMatch = pathname.match(/^\/v1\/appointments\/([^/]+)\/mark-no-show$/);
  if (appointmentNoShowMatch && input.request.method === "POST") {
    return markAppointmentNoShow(
      operationsContext,
      dependencies,
      pathUuid(appointmentNoShowMatch[1], "appointmentId")
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/queue") {
    return listQueue(
      operationsContext,
      dependencies,
      url.searchParams.get("date") ?? todayIsoDate()
    );
  }

  const queuePatchMatch = pathname.match(/^\/v1\/queue\/([^/]+)$/);
  if (queuePatchMatch && input.request.method === "PATCH") {
    return updateQueueEntry(
      operationsContext,
      dependencies,
      pathUuid(queuePatchMatch[1], "queueEntryId"),
      body
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/dashboard/morning") {
    return getMorningDashboard(
      operationsContext,
      dependencies,
      url.searchParams.get("date") ?? todayIsoDate()
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/encounters") {
    return createEncounter(operationsContext, dependencies, body);
  }

  const encounterMatch = pathname.match(/^\/v1\/encounters\/([^/]+)$/);
  if (encounterMatch) {
    const encounterId = pathUuid(encounterMatch[1], "encounterId");
    if (input.request.method === "GET")
      return getEncounter(operationsContext, dependencies, encounterId);
    if (input.request.method === "PATCH")
      return saveEncounterClinicalNoteDraft(
        operationsContext,
        dependencies,
        encounterId,
        body
      );
  }

  const encounterStartMatch = pathname.match(/^\/v1\/encounters\/([^/]+)\/start$/);
  if (encounterStartMatch && input.request.method === "POST") {
    return startEncounter(
      operationsContext,
      dependencies,
      pathUuid(encounterStartMatch[1], "encounterId")
    );
  }

  const encounterSignNoteMatch = pathname.match(/^\/v1\/encounters\/([^/]+)\/sign-note$/);
  if (encounterSignNoteMatch && input.request.method === "POST") {
    return signEncounterClinicalNote(
      operationsContext,
      dependencies,
      pathUuid(encounterSignNoteMatch[1], "encounterId")
    );
  }

  const encounterAmendNoteMatch = pathname.match(/^\/v1\/encounters\/([^/]+)\/amend-note$/);
  if (encounterAmendNoteMatch && input.request.method === "POST") {
    return amendEncounterClinicalNote(
      operationsContext,
      dependencies,
      pathUuid(encounterAmendNoteMatch[1], "encounterId"),
      body
    );
  }

  const encounterPrescriptionMatch = pathname.match(
    /^\/v1\/encounters\/([^/]+)\/prescriptions$/
  );
  if (encounterPrescriptionMatch && input.request.method === "POST") {
    return createEncounterPrescription(
      operationsContext,
      dependencies,
      pathUuid(encounterPrescriptionMatch[1], "encounterId"),
      body
    );
  }

  const prescriptionSignMatch = pathname.match(/^\/v1\/prescriptions\/([^/]+)\/sign$/);
  if (prescriptionSignMatch && input.request.method === "POST") {
    return signPrescription(
      operationsContext,
      dependencies,
      pathUuid(prescriptionSignMatch[1], "prescriptionId")
    );
  }

  throw new ApiError(404, "NOT_FOUND", "Route not found.", {
    method: input.request.method,
    path: pathname
  });
}

async function resolveAccessContext(input: {
  request: IncomingMessage;
  tokenVerifier: TokenVerifier;
  useLocalAuthFixture: boolean;
  fixtureSubject?: string | undefined;
  expectedIssuer: string;
  acceptedAudience: string;
  config: ClinicOsConfig;
  identityRepository: IdentityRepository;
}): Promise<AccessContext> {
  const verifiedKeycloakClaims = await resolveClaims({
    request: input.request,
    tokenVerifier: input.tokenVerifier,
    useLocalAuthFixture: input.useLocalAuthFixture,
    fixtureSubject: input.fixtureSubject,
    expectedIssuer: input.expectedIssuer,
    acceptedAudience: input.acceptedAudience
  });
  const principal = principalFromVerifiedKeycloakClaims(verifiedKeycloakClaims, {
    expectedIssuer: input.expectedIssuer,
    acceptedAudiences: [input.acceptedAudience, input.config.auth.keycloakClientId, "clinicos-api"],
    acceptedClientIds: [input.acceptedAudience, input.config.auth.keycloakClientId]
  });
  const snapshot = await input.identityRepository.findAccessByKeycloakSubject(principal.subject);

  if (!snapshot) {
    throw new ApiError(
      403,
      "PERMISSION_DENIED",
      "Authenticated identity is not registered for ClinicOS.",
      {
        reason: "identity_not_registered"
      }
    );
  }

  return buildAccessContext({
    principal,
    tenant: snapshot.tenant,
    user: snapshot.user,
    memberships: snapshot.memberships,
    clinicAssignments: snapshot.clinicAssignments,
    roleAssignments: snapshot.roleAssignments
  });
}

function resolveClinicId(request: IncomingMessage, context: AccessContext): UUID {
  const requestedClinicId = headerValue(request, "x-clinic-id");

  if (requestedClinicId) return pathUuid(requestedClinicId, "x-clinic-id");

  const assignment = context.clinicAssignments.find((candidate) => candidate.status === "active");

  if (!assignment) {
    throw new ApiError(403, "PERMISSION_DENIED", "User is not assigned to an active clinic.");
  }

  return assignment.clinicId;
}

function createPostgresRepositorySet(config: ClinicOsConfig): {
  identityRepository: IdentityRepository;
  operationsRepository: ClinicOperationsRepository;
  auditSink: AuditSink;
} {
  const pool = new Pool({
    connectionString: config.services.databaseUrl
  });

  return {
    identityRepository: new PostgresIdentityRepository(pool),
    operationsRepository: new PostgresClinicOperationsRepository(pool),
    auditSink: new PostgresAuditEventSink(pool)
  };
}

function resolveClaims(input: {
  request: IncomingMessage;
  tokenVerifier: TokenVerifier;
  useLocalAuthFixture: boolean;
  fixtureSubject?: string | undefined;
  expectedIssuer: string;
  acceptedAudience: string;
}): Promise<KeycloakAccessTokenClaims> {
  if (input.useLocalAuthFixture) {
    const subject =
      headerValue(input.request, "x-clinic-os-dev-subject") ??
      headerValue(input.request, "x-clinicos-dev-subject") ??
      input.fixtureSubject ??
      "seed-assistant";

    return Promise.resolve(
      createLocalFixtureClaims({
        subject,
        expectedIssuer: input.expectedIssuer,
        acceptedAudience: input.acceptedAudience
      })
    );
  }

  return input.tokenVerifier.verifyAuthorizationHeader(headerValue(input.request, "authorization"));
}

function buildExpectedIssuer(config: ClinicOsConfig): string {
  return `${config.auth.keycloakBaseUrl.replace(/\/$/, "")}/realms/${config.auth.keycloakRealm}`;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_PORT);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new ApiError(503, "CONFIGURATION_ERROR", "API port is invalid.", { value });
  }

  return parsed;
}

function getRequestId(request: IncomingMessage): string {
  return headerValue(request, "x-request-id") ?? randomUUID();
}

function headerValue(request: IncomingMessage, header: string): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) return value[0];
  return value;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > 1024 * 1024) {
      throw new ApiError(400, "VALIDATION_ERROR", "Request body exceeds the 1MB limit.");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
}

function pathUuid(value: string, label: string): UUID {
  if (!isUuid(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${label} must be a valid UUID.`, { field: label });
  }

  return value;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sendApiError(response: ServerResponse, error: ApiError, requestId: string) {
  sendJson(response, error.status, toApiErrorBody(error, requestId));
}

function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AuthenticationError)
    return new ApiError(401, "UNAUTHENTICATED", error.message);
  if (error instanceof AuthorizationError) {
    return new ApiError(403, "PERMISSION_DENIED", error.message, {
      required_permission: error.requiredPermission,
      reason: error.reason
    });
  }
  if (error instanceof Error) return new ApiError(500, "CONFIGURATION_ERROR", error.message);
  return new ApiError(500, "CONFIGURATION_ERROR", "Unexpected API error.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { server, port } = createRuntimeApiServer();

    server.listen(port, "127.0.0.1", () => {
      console.log(`ClinicOS API listening on http://127.0.0.1:${port}`);
    });
  } catch (error) {
    const normalized = normalizeApiError(error);
    console.error(JSON.stringify(toApiErrorBody(normalized, "startup"), null, 2));
    process.exitCode = 1;
  }
}
