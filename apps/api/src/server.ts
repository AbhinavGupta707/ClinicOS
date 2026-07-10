import { createHash } from "node:crypto";
import { type IncomingMessage, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { safeParseClinicOsEnv, type ClinicOsConfig } from "@clinic-os/config";
import {
  createPaymentProvider,
  type AiGatewayProvider,
  type PaymentProvider,
  type PaymentProviderWebhookEvent,
  type RawPaymentWebhook
} from "@clinic-os/integrations";
import {
  buildAccessContext,
  buildMeResponse,
  principalFromVerifiedKeycloakClaims,
  type AccessContext,
  type KeycloakAccessTokenClaims
} from "@clinic-os/auth";
import {
  PostgresAuditEventSink,
  PostgresClinicOperationsRepository,
  PostgresClinicUnitOfWork,
  PostgresIdentityRepository,
  LATEST_DATABASE_SCHEMA_VERSION,
  type ClinicOperationsRepository,
  type DurableIntegrityRepository,
  type IdentityRepository,
  type PaymentProviderEventRecord,
  type RepositoryScope,
  type SqlConnectionFactory,
  type ScopedApiRequestGuardsPort
} from "@clinic-os/db";
import {
  clinicLocalDateFromClock,
  isUuid,
  systemClock,
  type Clinic,
  type Clock,
  type UUID
} from "@clinic-os/domain";
import {
  createAuditEvent,
  type AtomicBudgetStore,
  type AuditEventRecord
} from "@clinic-os/security";
import { Pool } from "pg";
import { ApiError, toApiErrorBody } from "./errors.ts";
import { ApiHealthMonitor, type ApiDependencyProbe, type ApiRepositoryMode } from "./health.ts";
import { KeycloakJwtVerifier } from "./keycloak-verifier.ts";
import {
  createLocalFixtureClaims,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository
} from "./local-fixture.ts";
import {
  checkInAppointment,
  acceptTreatmentPlan,
  amendEncounterClinicalNote,
  createAiScribeSession,
  createAiScribeSourceAnchor,
  createAiScribeTranscriptSegment,
  confirmAppointment,
  commitMigrationBatch,
  convertLeadToAppointment,
  createAppointment,
  createBreakGlassAccessRequest,
  createCorrectiveAction,
  createDeletionRequest,
  createEncounter,
  createTask,
  createRecallRule,
  createDentalChartSnapshot,
  createEncounterDentalFinding,
  createEncounterProcedurePerformed,
  createEncounterPrescription,
  createIncident,
  createInventoryCategory,
  createInventoryCheckRun,
  createInventoryCheckTemplate,
  createInventoryItem,
  createInvoice,
  createInvoiceReceipt,
  createIntakeFormTemplate,
  createLabCase,
  createLabReconciliation,
  createLabVendor,
  createLead,
  createMigrationBatch,
  completeMediaUpload,
  createSignedMediaAccess,
  createInvoicePaymentRequest,
  createPatientDentalFinding,
  createPatientInstruction,
  createPatient,
  createPatientConsent,
  createPatientRecordExport,
  createPatientTreatmentPlan,
  createSopSchedule,
  createSopTemplate,
  generateDueContinuityTasks,
  generateDueSopRuns,
  generateAiScribeDrafts,
  listAuditReviewEvents,
  listBreakGlassAccessRequests,
  listDeadLetterEvents,
  listDeletionRequests,
  listEncounterAiScribeSessions,
  getMorningDashboard,
  getAiScribeSession,
  getOwnerDashboard,
  getEncounter,
  getInvoice,
  getMigrationBatch,
  getPilotReadiness,
  listMigrationBatches,
  getPatientDentalChart,
  getPatient,
  getPatientPrepSummary,
  getPatientTimeline,
  listPricebookProcedures,
  listCorrectiveActions,
  listDentalFindingHistory,
  listAppointmentTypes,
  listAppointments,
  listChairs,
  listIntakeFormTemplates,
  listIncidents,
  listInventoryCategories,
  listInventoryCheckTemplates,
  listInventoryExceptions,
  listInventoryItems,
  listLabCases,
  listLabVendors,
  listLeads,
  listMigrationBatchRows,
  listPatientMediaAssets,
  listPatientConsents,
  listPatientRecordExports,
  listPatients,
  listProviderHealth,
  listProviderSchedules,
  listQueue,
  listRecalls,
  listSopRuns,
  listTasks,
  markAppointmentNoShow,
  matchLeadToPatient,
  revokePatientConsent,
  receiveMediaUploadContent,
  recordInvoiceManualPayment,
  recordAiScribeReviewDecision,
  reviewAuditEvent,
  reviewBreakGlassAccessRequest,
  reviewDeletionRequest,
  requestMediaUploadUrl,
  replayDeadLetterEvent,
  resolveMigrationBatchRow,
  rollbackMigrationBatch,
  runRetentionJob,
  deleteAiScribeRetainedPayloads,
  saveEncounterClinicalNoteDraft,
  signEncounterClinicalNote,
  signPrescription,
  createStockLedgerEntry,
  startEncounter,
  submitPatientIntakeForm,
  recordRecallAction,
  processPaymentWebhook,
  updateCorrectiveAction,
  updateDentalFinding,
  updateAppointment,
  updateInventoryCheckRun,
  updateLabCase,
  updateLeadStatus,
  updateSopRun,
  updateTask,
  updateTreatmentPlan,
  updatePatient,
  updateQueueEntry,
  type PaymentOperationsRepository,
  type OperationsRequestContext
} from "./operations.ts";
import { LocalMediaStorageSimulator, type MediaStorageProvider } from "./media-storage.ts";
import type {
  ApiTransactionContext,
  AtomicMutationCoordinator,
  ClinicOsNestRuntime,
  ResolvedAccessContext,
  VerifiedClinicRequestContext
} from "./framework/contracts.ts";
import {
  InMemoryAtomicBudgetStore,
  InMemoryAtomicMutationCoordinator
} from "./framework/in-memory-test-doubles.ts";
import {
  createClinicOsNestApplication,
  createClinicOsNestCompatibilityServer,
  type ClinicOsNestApplication
} from "./framework/nest-application.ts";
import { RedisAtomicBudgetStore } from "./framework/redis-budget-store.ts";
import { PostgresAtomicMutationCoordinator } from "./framework/postgres-mutation-coordinator.ts";
import type { ClinicFeatureHandlerMap } from "./features/contracts.ts";
import { createCp13ClinicFeatureHandlerMap } from "./features/cp13-composition.ts";
import type { Cp13ClinicFeatureOperationId } from "./features/cp13-operation-ownership.ts";
import { createClinicalDentalRelationshipAuthority } from "./features/clinical-dental/index.ts";
import {
  IdentitySessionEdgeGuard,
  PostgresIdentitySecurityAuditOutbox,
  RedisTokenRevocationStore
} from "./features/identity-session-edge/index.ts";
import { runClinicFeatureOperation } from "./features/runtime.ts";
import {
  createTreatmentBillingProviderOperationService,
  type DurablePaymentProviderEventResultProjection,
  type PaymentProviderEventEvidenceProjection,
  type VerifiedRazorpayPaymentEventRequest
} from "./features/treatment-billing/index.ts";
import { PendingLocalClinicalMediaInspectionSimulator } from "./media-inspection.ts";

interface AuditSink {
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
}

interface TokenVerifier {
  verifyAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<KeycloakAccessTokenClaims>;
}

interface OperationsUnitOfWork {
  run<T>(
    callback: (context: {
      repository: ClinicOperationsRepository;
      auditSink: AuditSink;
      requestGuards: ScopedApiRequestGuardsPort;
      sqlClient?: import("@clinic-os/db").SqlQueryClient;
    }) => Promise<T>
  ): Promise<T>;
}

export interface ClinicOsApiServerOptions {
  config: ClinicOsConfig;
  identityRepository: IdentityRepository;
  operationsRepository?: ClinicOperationsRepository;
  auditSink?: AuditSink;
  mediaStorage?: MediaStorageProvider;
  paymentProvider?: PaymentProvider;
  aiGatewayProvider?: AiGatewayProvider;
  tokenVerifier?: TokenVerifier;
  useLocalAuthFixture?: boolean;
  fixtureSubject?: string;
  dependencyProbes?: readonly ApiDependencyProbe[];
  repositoryMode?: ApiRepositoryMode;
  operationsUnitOfWork?: OperationsUnitOfWork;
  clock?: Clock;
  budgetStore?: AtomicBudgetStore;
  budgetKeySecret?: string;
  mutationCoordinator?: AtomicMutationCoordinator;
  featureHandlers?: ClinicFeatureHandlerMap;
  identityEdgeGuard?: IdentitySessionEdgeGuard;
}

interface RuntimeOptions {
  server: Server;
  port: number;
}

interface RuntimeNestOptions {
  app: ClinicOsNestApplication["app"];
  port: number;
}

const DEFAULT_PORT = 4000;
const DEFAULT_API_AUDIENCE = "clinic-os-api";
const SYSTEM_INTEGRATION_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000000" as UUID;

export function createClinicOsApiServer(options: ClinicOsApiServerOptions): Server {
  return createClinicOsNestCompatibilityServer(createClinicOsNestRuntime(options));
}

export function createClinicOsApiNestApplication(
  options: ClinicOsApiServerOptions
): Promise<ClinicOsNestApplication> {
  return createClinicOsNestApplication(createClinicOsNestRuntime(options));
}

function createClinicOsNestRuntime(options: ClinicOsApiServerOptions): ClinicOsNestRuntime {
  const expectedIssuer = buildExpectedIssuer(options.config);
  const acceptedAudience = process.env.CLINIC_OS_API_AUDIENCE ?? DEFAULT_API_AUDIENCE;
  const tokenVerifier =
    options.tokenVerifier ??
    new KeycloakJwtVerifier({
      expectedIssuer,
      jwksUri: `${expectedIssuer}/protocol/openid-connect/certs`
    });
  const repositoryMode = options.repositoryMode ?? "injected";
  const fixtureMode = repositoryMode === "fixture";
  const budgetStore = options.budgetStore ?? (fixtureMode ? new InMemoryAtomicBudgetStore() : null);
  const budgetKeySecret =
    options.budgetKeySecret ??
    (fixtureMode ? "clinicos-cp12-fixture-budget-secret-000000000000" : null);
  const mutationCoordinator =
    options.mutationCoordinator ?? (fixtureMode ? new InMemoryAtomicMutationCoordinator() : null);
  if (!budgetStore || !budgetKeySecret || !mutationCoordinator) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "ClinicOS API security persistence dependencies are not configured.",
      {
        missing: [
          ...(!budgetStore ? ["atomic_budget_store"] : []),
          ...(!budgetKeySecret ? ["budget_key_secret"] : []),
          ...(!mutationCoordinator ? ["transactional_mutation_coordinator"] : [])
        ]
      }
    );
  }
  if (!fixtureMode && mutationCoordinator.durability !== "durable_transactional") {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Non-fixture ClinicOS runtime requires durable transactional mutation coordination."
    );
  }
  if (options.config.isProductionLike && !options.identityEdgeGuard) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Production identity-session edge dependencies are not configured."
    );
  }
  const budgetStoreWithReadiness = budgetStore as AtomicBudgetStore & {
    readiness?: () => Promise<void>;
  };
  const healthMonitor = new ApiHealthMonitor({
    repositoryMode,
    authMode: options.useLocalAuthFixture ? "local_synthetic_fixture" : "keycloak_jwks",
    probes: [
      ...(options.dependencyProbes ?? []),
      ...(options.identityEdgeGuard
        ? [
            {
              name: "identity_session_edge",
              required: true,
              check: () => options.identityEdgeGuard!.readiness()
            }
          ]
        : []),
      {
        name: "redis_abuse_budget",
        required: true,
        check: () => budgetStoreWithReadiness.readiness?.() ?? Promise.resolve()
      },
      {
        name: "transactional_mutation_coordinator",
        required: true,
        check: () => mutationCoordinator.readiness()
      }
    ]
  });

  const dispatchLegacyOperation: ClinicOsNestRuntime["handleLegacyOperation"] = async (
    request,
    requestId,
    access,
    body,
    rawBody,
    transaction
  ) => {
    const repository = transaction?.repository ?? options.operationsRepository;
    const auditSink = transaction?.auditSink ?? options.auditSink;
    if (!repository) throw missingOperationsRepository();
    const routeInput = {
      request,
      requestId,
      tokenVerifier,
      expectedIssuer,
      acceptedAudience,
      config: options.config,
      identityRepository: options.identityRepository,
      mediaStorage: options.mediaStorage,
      paymentProvider: options.paymentProvider ?? createRuntimePaymentProvider(options.config),
      aiGatewayProvider: options.aiGatewayProvider,
      useLocalAuthFixture: options.useLocalAuthFixture ?? false,
      fixtureSubject: options.fixtureSubject,
      clock: options.clock,
      resolvedAccess: access,
      preparedBody: body,
      preparedRawBody: rawBody
    };
    if (transaction) return routeOperationsRequest({ ...routeInput, repository, auditSink });
    return options.operationsUnitOfWork
      ? options.operationsUnitOfWork.run(
          ({ repository: activeRepository, auditSink: activeAudit }) =>
            routeOperationsRequest({
              ...routeInput,
              repository: activeRepository,
              auditSink: activeAudit
            })
        )
      : routeOperationsRequest({ ...routeInput, repository, auditSink });
  };

  return {
    clock: options.clock ?? systemClock,
    budgetStore,
    budgetKeySecret,
    mutationCoordinator,
    repositoryMode,
    useLocalAuthFixture: options.useLocalAuthFixture ?? false,
    identityRepository: options.identityRepository,
    async health(kind, requestId) {
      if (kind === "liveness") {
        return {
          status: 200,
          body: { status: "ok", service: "clinic-os-api", request_id: requestId }
        };
      }
      const report =
        kind === "readiness" ? await healthMonitor.readiness() : await healthMonitor.startup();
      return {
        status: report.status === "ready" ? 200 : 503,
        body: { ...report, request_id: requestId }
      };
    },
    admitTraffic: () => healthMonitor.admitTraffic(),
    resolveAccess: (request) =>
      resolveAccessContext({
        request,
        tokenVerifier,
        useLocalAuthFixture: options.useLocalAuthFixture ?? false,
        fixtureSubject: options.fixtureSubject,
        expectedIssuer,
        acceptedAudience,
        config: options.config,
        identityRepository: options.identityRepository,
        identityEdgeGuard: options.identityEdgeGuard,
        clock: options.clock ?? systemClock
      }),
    async handleIdentity(request, requestId, access) {
      if (options.auditSink) {
        await options.auditSink.appendAuditEvent(
          createAuditEvent({
            tenantId: access.context.tenant.id,
            clinicId: null,
            actor: { type: "user", id: access.context.user.id },
            action: "auth.session.resolved",
            resourceType: "user",
            resourceId: access.context.user.id,
            ipAddress: request.socket.remoteAddress ?? null,
            userAgent: headerValue(request, "user-agent") ?? null,
            correlationId: requestId
          })
        );
      }
      return { status: 200, body: buildMeResponse(access.context, access.clinics) };
    },
    async handleWebhook(request, requestId, rawBody, transaction) {
      const repository = transaction?.repository ?? options.operationsRepository;
      const auditSink = transaction?.auditSink ?? options.auditSink;
      if (!repository || !auditSink) throw missingOperationsRepository();
      const provider = options.paymentProvider ?? createRuntimePaymentProvider(options.config);
      const receivedAt = (options.clock ?? systemClock).now();
      if (fixtureMode) {
        return processPaymentWebhook(
          {
            repository,
            auditSink,
            paymentProvider: provider,
            paymentRepository: paymentRepositoryFromOperationsRepository(repository)
          },
          {
            requestId,
            providerKey: provider.providerKey,
            rawBody: rawBody.toString("utf8"),
            receivedAt: receivedAt.toISOString(),
            headers: allowlistedWebhookHeaders(request, options.useLocalAuthFixture ?? false),
            ipAddress: request.socket.remoteAddress ?? null,
            userAgent: headerValue(request, "user-agent") ?? null
          }
        );
      }
      const raw: RawPaymentWebhook = {
        providerKey: provider.providerKey,
        rawBody: rawBody.toString("utf8"),
        receivedAt: receivedAt.toISOString(),
        headers: allowlistedWebhookHeaders(request, options.useLocalAuthFixture ?? false)
      };
      const verification = await provider.verifyWebhook(raw);
      if (verification.status !== "verified" || !verification.signatureHeader?.trim()) {
        throw new ApiError(
          verification.status === "invalid_signature" ? 403 : 400,
          verification.status === "invalid_signature" ? "PERMISSION_DENIED" : "VALIDATION_ERROR",
          verification.message,
          {
            verification_status: verification.status,
            provider_event_id: verification.providerEventId ?? null
          }
        );
      }
      const event = await provider.parseWebhook(raw);
      const scope = verifiedPaymentProviderScope(event);
      const providerKey = verifiedCp13PaymentProviderKey(event.providerKey);
      const signatureSha256 = sha256Text(verification.signatureHeader);
      const execute = (activeRepository: ClinicOperationsRepository, activeAudit: AuditSink) =>
        executeVerifiedPaymentProviderEvent({
          repository: activeRepository,
          auditSink: activeAudit,
          scope,
          providerKey,
          requestId,
          event,
          signatureSha256,
          receivedAt,
          ipAddress: request.socket.remoteAddress ?? null,
          userAgent: headerValue(request, "user-agent") ?? null,
          clock: options.clock ?? systemClock
        });
      if (transaction) return execute(repository, auditSink);
      if (!options.operationsUnitOfWork) {
        throw new ApiError(
          503,
          "CONFIGURATION_ERROR",
          "Durable payment provider transaction dependencies are not configured."
        );
      }
      return options.operationsUnitOfWork.run(
        ({ repository: activeRepository, auditSink: activeAudit }) =>
          execute(activeRepository, activeAudit)
      );
    },
    async handleClinicOperation(
      request,
      operationId,
      requestId,
      access,
      parsedRequest,
      receivedAt,
      rawBody,
      transaction
    ) {
      const featureOperationId = operationId as Cp13ClinicFeatureOperationId;
      const handler = options.featureHandlers?.[featureOperationId];
      if (!handler) {
        return dispatchLegacyOperation(
          request,
          requestId,
          access,
          parsedRequest.body,
          rawBody,
          transaction
        );
      }

      const execute = (activeTransaction: ApiTransactionContext) =>
        runClinicFeatureOperation({
          operationId: featureOperationId,
          handler,
          request,
          requestId,
          access,
          parsedRequest,
          receivedAt,
          transaction: activeTransaction,
          clock: options.clock ?? systemClock
        });
      if (transaction) return execute(transaction);
      if (!options.operationsUnitOfWork) {
        throw new ApiError(
          503,
          "CONFIGURATION_ERROR",
          "ClinicOS feature transaction dependencies are not configured."
        );
      }
      return options.operationsUnitOfWork.run(({ repository, auditSink, requestGuards, sqlClient }) =>
        execute({ repository, auditSink, requestGuards, ...(sqlClient ? { sqlClient } : {}) })
      );
    },
    handleLegacyOperation: dispatchLegacyOperation
  };
}

export function createRuntimeApiServer(env: NodeJS.ProcessEnv = process.env): RuntimeOptions {
  const composition = createRuntimeComposition(env);
  let server: Server;
  try {
    server = createClinicOsApiServer(composition.serverOptions);
  } catch (error) {
    void composition.close();
    throw error;
  }
  server.once("error", () => {
    void composition.close();
  });
  server.once("close", () => {
    void composition.close();
  });
  return { port: composition.port, server };
}

export async function createRuntimeApiNestApplication(
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeNestOptions> {
  const composition = createRuntimeComposition(env);
  try {
    const { app } = await createClinicOsApiNestApplication(composition.serverOptions);
    app.getHttpServer().once("close", () => {
      void composition.close();
    });
    return { app, port: composition.port };
  } catch (error) {
    await composition.close();
    throw error;
  }
}

function createRuntimeComposition(env: NodeJS.ProcessEnv = process.env): {
  serverOptions: ClinicOsApiServerOptions;
  port: number;
  close(): Promise<void>;
} {
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
  const useFixtureRepository = parseBoolean(env.CLINIC_OS_API_USE_FIXTURE_REPOSITORY);

  if (parsed.data.isProductionLike && (useLocalAuthFixture || useFixtureRepository)) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Local auth and repository fixtures are forbidden outside local/dev environments."
    );
  }

  const configuredBudgetKeySecret = parsed.data.security.abuseBudgetKeySecret;
  const runtimeBudgetKeySecret =
    configuredBudgetKeySecret ??
    (parsed.data.isProductionLike ? null : "clinicos-local-synthetic-budget-secret-000000000000");
  if (!useFixtureRepository && !runtimeBudgetKeySecret) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "The production abuse-budget key secret is not configured."
    );
  }

  let pool: Pool | undefined;
  let redisBudgetStore: RedisAtomicBudgetStore | undefined;
  let tokenRevocationStore: RedisTokenRevocationStore | undefined;
  const repositorySet = useFixtureRepository
    ? {
        identityRepository: new LocalFixtureIdentityRepository(),
        operationsRepository: new LocalFixtureClinicOperationsRepository(),
        auditSink: new InMemoryAuditSink()
      }
    : createPostgresRepositorySet(parsed.data, runtimeBudgetKeySecret ?? undefined);
  if ("pool" in repositorySet) pool = repositorySet.pool;
  const port = parsePort(env.PORT ?? env.API_PORT);
  const mediaStorage = createRuntimeMediaStorage(parsed.data, env);
  const mediaInspection = createRuntimeMediaInspection(parsed.data, env);
  if (parsed.data.isProductionLike && (!mediaStorage || !mediaInspection)) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Production private-media storage and scanner composition is not registered.",
      {
        missing: [
          ...(!mediaStorage ? ["private_media_storage"] : []),
          ...(!mediaInspection ? ["private_media_scanner"] : [])
        ]
      }
    );
  }
  const paymentProvider = createRuntimePaymentProvider(parsed.data);
  const tokenRevocationKeySecret =
    parsed.data.security.tokenRevocationKeySecret ??
    (parsed.data.isProductionLike
      ? null
      : "clinicos-local-synthetic-token-revocation-key-000000000000");
  const identityEdgeGuard =
    pool && !useLocalAuthFixture && tokenRevocationKeySecret
      ? (() => {
          tokenRevocationStore = new RedisTokenRevocationStore({
            redisUrl: parsed.data.services.redisUrl,
            keyHmacSecret: Buffer.from(tokenRevocationKeySecret, "utf8"),
            now: () => systemClock.now()
          });
          return new IdentitySessionEdgeGuard({
            configuration: {
              productionLike: parsed.data.isProductionLike,
              expectedIssuer: buildExpectedIssuer(parsed.data),
              mfaAssurancePolicy: {
                policyId: "clinicos-amr-two-factor-v1",
                reviewedRealmEvidenceId: null,
                acceptedAcrValues: [],
                primaryFactorAmrValues: ["pwd"],
                secondaryFactorAmrValues: ["otp", "totp", "webauthn"],
                phishingResistantAmrValues: []
              },
              requiredAudience: DEFAULT_API_AUDIENCE,
              acceptedAuthorizedParties: [
                parsed.data.auth.keycloakClientId,
                "clinic-os-mobile"
              ],
              maximumAccessTokenLifetimeSeconds: 300,
              browserSessionCookieName: "__Host-clinicos_session"
            },
            revocations: tokenRevocationStore,
            securityAuditOutbox: new PostgresIdentitySecurityAuditOutbox(
              pool as unknown as SqlConnectionFactory
            )
          });
        })()
      : undefined;

  const serverOptions: ClinicOsApiServerOptions = {
    config: parsed.data,
    identityRepository: repositorySet.identityRepository,
    operationsRepository: repositorySet.operationsRepository,
    auditSink: repositorySet.auditSink,
    mediaStorage,
    paymentProvider,
    useLocalAuthFixture,
    repositoryMode: useFixtureRepository ? "fixture" : "postgres",
    identityEdgeGuard,
    dependencyProbes: pool
      ? createRuntimeDependencyProbes({
          pool,
          config: parsed.data,
          useLocalAuthFixture
        })
      : undefined
  };
  serverOptions.featureHandlers = createCp13ClinicFeatureHandlerMap({
    paymentProvider,
    clinicalDental: {
      relationshipAuthority: createClinicalDentalRelationshipAuthority(),
      ...(mediaStorage ? { mediaStorage } : {}),
      ...(mediaInspection ? { mediaInspection } : {})
    }
  });
  if (!useFixtureRepository) {
    redisBudgetStore = new RedisAtomicBudgetStore({ redisUrl: parsed.data.services.redisUrl });
    serverOptions.budgetStore = redisBudgetStore;
    serverOptions.budgetKeySecret = runtimeBudgetKeySecret ?? undefined;
  }
  if ("operationsUnitOfWork" in repositorySet) {
    serverOptions.operationsUnitOfWork = repositorySet.operationsUnitOfWork;
    serverOptions.mutationCoordinator = new PostgresAtomicMutationCoordinator({
      unitOfWork: repositorySet.operationsUnitOfWork,
      readinessProbe: () => repositorySet.pool.query("select 1")
    });
  }

  if (env.CLINIC_OS_API_DEV_SUBJECT) {
    serverOptions.fixtureSubject = env.CLINIC_OS_API_DEV_SUBJECT;
  }

  let closePromise: Promise<void> | undefined;
  return {
    port,
    serverOptions,
    close() {
      closePromise ??= Promise.all([
        ...(pool ? [pool.end()] : []),
        ...(redisBudgetStore ? [redisBudgetStore.close()] : []),
        ...(tokenRevocationStore ? [tokenRevocationStore.close()] : [])
      ]).then(() => undefined);
      return closePromise;
    }
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
  mediaStorage?: MediaStorageProvider;
  paymentProvider?: PaymentProvider;
  aiGatewayProvider?: AiGatewayProvider;
  useLocalAuthFixture: boolean;
  fixtureSubject?: string | undefined;
  clock?: Clock | undefined;
  resolvedAccess?: VerifiedClinicRequestContext;
  preparedBody?: unknown;
  preparedRawBody?: Buffer | undefined;
}) {
  const url = new URL(input.request.url ?? "/", "http://clinic-os.local");
  const pathname = url.pathname;
  const resolvedAccess = input.resolvedAccess ?? (await resolveAccessContext(input));
  const accessContext = resolvedAccess.context;
  const clinicId = input.resolvedAccess?.clinicId ?? resolveClinicId(input.request, accessContext);
  const clinic =
    input.resolvedAccess?.clinic ??
    resolvedAccess.clinics.find((candidate) => candidate.id === clinicId);
  if (!clinic) {
    throw new ApiError(403, "PERMISSION_DENIED", "Clinic timezone is unavailable for this user.", {
      reason: "clinic_mismatch"
    });
  }
  const operationsContext: OperationsRequestContext = {
    requestId: input.requestId,
    accessContext,
    clinicId,
    clinicTimeZone: clinic.timezone,
    ipAddress: input.request.socket.remoteAddress ?? null,
    userAgent: headerValue(input.request, "user-agent") ?? null,
    idempotencyKey: headerValue(input.request, "idempotency-key") ?? null
  };
  const clinicToday = clinicLocalDateFromClock(input.clock ?? systemClock, clinic.timezone);
  const dependencies = {
    repository: input.repository,
    clock: input.clock,
    auditSink: input.auditSink,
    mediaStorage: input.mediaStorage,
    paymentProvider: input.paymentProvider,
    aiGatewayProvider: input.aiGatewayProvider,
    paymentRepository: paymentRepositoryFromOperationsRepository(input.repository),
    runtimeConfig: input.config
  };
  const isMediaContentUpload =
    input.request.method === "PUT" && /^\/v1\/media\/uploads\/[^/]+\/content$/.test(pathname);
  const body =
    "preparedBody" in input
      ? input.preparedBody
      : ["POST", "PATCH"].includes(input.request.method ?? "") ||
          (input.request.method === "PUT" && !isMediaContentUpload)
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

  if (input.request.method === "GET" && pathname === "/v1/provider-health") {
    return listProviderHealth(operationsContext, dependencies);
  }

  if (input.request.method === "GET" && pathname === "/v1/pilot-readiness") {
    return getPilotReadiness(operationsContext, dependencies);
  }

  if (input.request.method === "GET" && pathname === "/v1/dead-letter-events") {
    return listDeadLetterEvents(operationsContext, dependencies, {
      limit: url.searchParams.get("limit"),
      status: url.searchParams.get("status")
    });
  }

  if (input.request.method === "GET" && pathname === "/v1/audit-events") {
    return listAuditReviewEvents(operationsContext, dependencies, {
      patientId: url.searchParams.get("patientId"),
      action: url.searchParams.get("action"),
      category: url.searchParams.get("category"),
      riskLevel: url.searchParams.get("riskLevel"),
      limit: url.searchParams.get("limit")
    });
  }

  const auditReviewMatch = pathname.match(/^\/v1\/audit-events\/([^/]+)\/reviews$/);
  if (auditReviewMatch && input.request.method === "POST") {
    return reviewAuditEvent(
      operationsContext,
      dependencies,
      pathUuid(auditReviewMatch[1], "auditEventId"),
      body
    );
  }

  if (pathname === "/v1/privacy/deletion-requests") {
    if (input.request.method === "GET") {
      return listDeletionRequests(operationsContext, dependencies, {
        patientId: url.searchParams.get("patientId"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit")
      });
    }
    if (input.request.method === "POST") {
      return createDeletionRequest(operationsContext, dependencies, body);
    }
  }

  const deletionReviewMatch = pathname.match(/^\/v1\/privacy\/deletion-requests\/([^/]+)\/review$/);
  if (deletionReviewMatch && input.request.method === "POST") {
    return reviewDeletionRequest(
      operationsContext,
      dependencies,
      pathUuid(deletionReviewMatch[1], "deletionRequestId"),
      body
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/privacy/retention-runs") {
    return runRetentionJob(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/break-glass/access-requests") {
    if (input.request.method === "GET") {
      return listBreakGlassAccessRequests(operationsContext, dependencies, {
        patientId: url.searchParams.get("patientId"),
        status: url.searchParams.get("status"),
        requestedByUserId: url.searchParams.get("requestedByUserId"),
        limit: url.searchParams.get("limit")
      });
    }
    if (input.request.method === "POST") {
      return createBreakGlassAccessRequest(operationsContext, dependencies, body);
    }
  }

  const breakGlassReviewMatch = pathname.match(
    /^\/v1\/break-glass\/access-requests\/([^/]+)\/review$/
  );
  if (breakGlassReviewMatch && input.request.method === "POST") {
    return reviewBreakGlassAccessRequest(
      operationsContext,
      dependencies,
      pathUuid(breakGlassReviewMatch[1], "breakGlassAccessId"),
      body
    );
  }

  const deadLetterReplayMatch = pathname.match(/^\/v1\/dead-letter-events\/([^/]+)\/replay$/);
  if (deadLetterReplayMatch && input.request.method === "POST") {
    return replayDeadLetterEvent(
      operationsContext,
      dependencies,
      pathUuid(deadLetterReplayMatch[1], "deadLetterEventId"),
      body
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/migration-batches") {
    return listMigrationBatches(operationsContext, dependencies, {
      limit: url.searchParams.get("limit"),
      status: url.searchParams.get("status")
    });
  }

  if (input.request.method === "POST" && pathname === "/v1/migration-batches") {
    return createMigrationBatch(operationsContext, dependencies, body);
  }

  const migrationBatchRowsMatch = pathname.match(/^\/v1\/migration-batches\/([^/]+)\/rows$/);
  if (migrationBatchRowsMatch && input.request.method === "GET") {
    return listMigrationBatchRows(
      operationsContext,
      dependencies,
      pathUuid(migrationBatchRowsMatch[1], "batchId"),
      {
        matchStatus: url.searchParams.get("matchStatus"),
        status: url.searchParams.get("status")
      }
    );
  }

  const migrationBatchRowResolveMatch = pathname.match(
    /^\/v1\/migration-batches\/([^/]+)\/rows\/([^/]+)\/resolve$/
  );
  if (migrationBatchRowResolveMatch && input.request.method === "POST") {
    return resolveMigrationBatchRow(
      operationsContext,
      dependencies,
      pathUuid(migrationBatchRowResolveMatch[1], "batchId"),
      pathUuid(migrationBatchRowResolveMatch[2], "rowId"),
      body
    );
  }

  const migrationBatchCommitMatch = pathname.match(/^\/v1\/migration-batches\/([^/]+)\/commit$/);
  if (migrationBatchCommitMatch && input.request.method === "POST") {
    return commitMigrationBatch(
      operationsContext,
      dependencies,
      pathUuid(migrationBatchCommitMatch[1], "batchId"),
      body
    );
  }

  const migrationBatchRollbackMatch = pathname.match(
    /^\/v1\/migration-batches\/([^/]+)\/rollback$/
  );
  if (migrationBatchRollbackMatch && input.request.method === "POST") {
    return rollbackMigrationBatch(
      operationsContext,
      dependencies,
      pathUuid(migrationBatchRollbackMatch[1], "batchId"),
      body
    );
  }

  const migrationBatchMatch = pathname.match(/^\/v1\/migration-batches\/([^/]+)$/);
  if (migrationBatchMatch && input.request.method === "GET") {
    return getMigrationBatch(
      operationsContext,
      dependencies,
      pathUuid(migrationBatchMatch[1], "batchId")
    );
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

  const recordExportsMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/record-exports$/);
  if (recordExportsMatch) {
    const patientId = pathUuid(recordExportsMatch[1], "patientId");
    if (input.request.method === "GET") {
      return listPatientRecordExports(operationsContext, dependencies, patientId, {
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit")
      });
    }
    if (input.request.method === "POST") {
      return createPatientRecordExport(operationsContext, dependencies, patientId, body);
    }
  }

  const prepSummaryMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/prep-summary$/);
  if (prepSummaryMatch && input.request.method === "GET") {
    return getPatientPrepSummary(
      operationsContext,
      dependencies,
      pathUuid(prepSummaryMatch[1], "patientId"),
      {
        appointmentId: url.searchParams.get("appointmentId")
          ? pathUuid(url.searchParams.get("appointmentId") ?? "", "appointmentId")
          : null
      }
    );
  }

  const patientMediaMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/media$/);
  if (patientMediaMatch && input.request.method === "GET") {
    return listPatientMediaAssets(
      operationsContext,
      dependencies,
      pathUuid(patientMediaMatch[1], "patientId")
    );
  }

  const patientDentalChartMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/dental-chart$/);
  if (patientDentalChartMatch && input.request.method === "GET") {
    return getPatientDentalChart(
      operationsContext,
      dependencies,
      pathUuid(patientDentalChartMatch[1], "patientId")
    );
  }

  const patientDentalFindingMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/dental-findings$/);
  if (patientDentalFindingMatch && input.request.method === "POST") {
    return createPatientDentalFinding(
      operationsContext,
      dependencies,
      pathUuid(patientDentalFindingMatch[1], "patientId"),
      body
    );
  }

  const patientDentalSnapshotMatch = pathname.match(
    /^\/v1\/patients\/([^/]+)\/dental-chart\/snapshots$/
  );
  if (patientDentalSnapshotMatch && input.request.method === "POST") {
    return createDentalChartSnapshot(
      operationsContext,
      dependencies,
      pathUuid(patientDentalSnapshotMatch[1], "patientId"),
      body
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

  const consentRevokeMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/consents\/([^/]+)\/revoke$/);
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

  if (input.request.method === "GET" && pathname === "/v1/pricebook/procedures") {
    return listPricebookProcedures(operationsContext, dependencies);
  }

  const patientTreatmentPlansMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/treatment-plans$/);
  if (patientTreatmentPlansMatch && input.request.method === "POST") {
    return createPatientTreatmentPlan(
      operationsContext,
      dependencies,
      pathUuid(patientTreatmentPlansMatch[1], "patientId"),
      body
    );
  }

  const treatmentPlanMatch = pathname.match(/^\/v1\/treatment-plans\/([^/]+)$/);
  if (treatmentPlanMatch && input.request.method === "PATCH") {
    return updateTreatmentPlan(
      operationsContext,
      dependencies,
      pathUuid(treatmentPlanMatch[1], "treatmentPlanId"),
      body
    );
  }

  const treatmentPlanAcceptMatch = pathname.match(/^\/v1\/treatment-plans\/([^/]+)\/accept$/);
  if (treatmentPlanAcceptMatch && input.request.method === "POST") {
    return acceptTreatmentPlan(
      operationsContext,
      dependencies,
      pathUuid(treatmentPlanAcceptMatch[1], "treatmentPlanId"),
      body
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/invoices") {
    return createInvoice(operationsContext, dependencies, body);
  }

  const invoiceMatch = pathname.match(/^\/v1\/invoices\/([^/]+)$/);
  if (invoiceMatch && input.request.method === "GET") {
    return getInvoice(operationsContext, dependencies, pathUuid(invoiceMatch[1], "invoiceId"));
  }

  const invoiceReceiptMatch = pathname.match(/^\/v1\/invoices\/([^/]+)\/receipts$/);
  if (invoiceReceiptMatch && input.request.method === "POST") {
    return createInvoiceReceipt(
      operationsContext,
      dependencies,
      pathUuid(invoiceReceiptMatch[1], "invoiceId"),
      body
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/media/upload-urls") {
    return requestMediaUploadUrl(operationsContext, dependencies, body);
  }

  const mediaUploadContentMatch = pathname.match(/^\/v1\/media\/uploads\/([^/]+)\/content$/);
  if (mediaUploadContentMatch && input.request.method === "PUT") {
    return receiveMediaUploadContent(
      operationsContext,
      dependencies,
      pathUuid(mediaUploadContentMatch[1], "uploadId"),
      {
        body:
          "preparedRawBody" in input
            ? (input.preparedRawBody ?? Buffer.alloc(0))
            : await readRawBody(input.request),
        contentType: headerValue(input.request, "content-type") ?? null
      }
    );
  }

  const mediaCompleteUploadMatch = pathname.match(/^\/v1\/media\/uploads\/([^/]+)\/complete$/);
  if (mediaCompleteUploadMatch && input.request.method === "POST") {
    return completeMediaUpload(
      operationsContext,
      dependencies,
      pathUuid(mediaCompleteUploadMatch[1], "uploadId"),
      body
    );
  }

  const mediaSignedUrlMatch = pathname.match(/^\/v1\/media\/assets\/([^/]+)\/signed-url$/);
  if (mediaSignedUrlMatch && input.request.method === "POST") {
    return createSignedMediaAccess(
      operationsContext,
      dependencies,
      pathUuid(mediaSignedUrlMatch[1], "mediaAssetId"),
      body
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
    return listQueue(operationsContext, dependencies, url.searchParams.get("date") ?? clinicToday);
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
      url.searchParams.get("date") ?? clinicToday
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/owner-dashboard") {
    return getOwnerDashboard(operationsContext, dependencies, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      defaultDate: clinicToday
    });
  }

  if (input.request.method === "GET" && pathname === "/v1/tasks") {
    return listTasks(operationsContext, dependencies, url.searchParams);
  }

  if (input.request.method === "POST" && pathname === "/v1/tasks") {
    return createTask(operationsContext, dependencies, body);
  }

  if (input.request.method === "POST" && pathname === "/v1/tasks/generate-due") {
    return generateDueContinuityTasks(operationsContext, dependencies, body);
  }

  const taskMatch = pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (taskMatch && input.request.method === "PATCH") {
    return updateTask(operationsContext, dependencies, pathUuid(taskMatch[1], "taskId"), body);
  }

  if (input.request.method === "POST" && pathname === "/v1/recall-rules") {
    return createRecallRule(operationsContext, dependencies, body);
  }

  if (input.request.method === "GET" && pathname === "/v1/recalls") {
    return listRecalls(operationsContext, dependencies, url.searchParams);
  }

  const recallActionMatch = pathname.match(/^\/v1\/recalls\/([^/]+)\/actions$/);
  if (recallActionMatch && input.request.method === "POST") {
    return recordRecallAction(
      operationsContext,
      dependencies,
      pathUuid(recallActionMatch[1], "recallId"),
      body
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/sop-templates") {
    return createSopTemplate(operationsContext, dependencies, body);
  }

  if (input.request.method === "POST" && pathname === "/v1/sop-schedules") {
    return createSopSchedule(operationsContext, dependencies, body);
  }

  if (input.request.method === "GET" && pathname === "/v1/sop-runs") {
    return listSopRuns(operationsContext, dependencies, url.searchParams);
  }

  if (input.request.method === "POST" && pathname === "/v1/sop-runs/generate-due") {
    return generateDueSopRuns(operationsContext, dependencies, body);
  }

  const sopRunMatch = pathname.match(/^\/v1\/sop-runs\/([^/]+)$/);
  if (sopRunMatch && input.request.method === "PATCH") {
    return updateSopRun(
      operationsContext,
      dependencies,
      pathUuid(sopRunMatch[1], "sopRunId"),
      body
    );
  }

  if (pathname === "/v1/lab-vendors") {
    if (input.request.method === "GET") return listLabVendors(operationsContext, dependencies);
    if (input.request.method === "POST")
      return createLabVendor(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/lab-cases") {
    if (input.request.method === "GET")
      return listLabCases(operationsContext, dependencies, {
        status: url.searchParams.get("status"),
        dueBefore: url.searchParams.get("dueBefore"),
        vendorId: url.searchParams.get("vendorId")
      });
    if (input.request.method === "POST")
      return createLabCase(operationsContext, dependencies, body);
  }

  const labCaseMatch = pathname.match(/^\/v1\/lab-cases\/([^/]+)$/);
  if (labCaseMatch && input.request.method === "PATCH") {
    return updateLabCase(
      operationsContext,
      dependencies,
      pathUuid(labCaseMatch[1], "labCaseId"),
      body
    );
  }

  if (input.request.method === "POST" && pathname === "/v1/lab-reconciliations") {
    return createLabReconciliation(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/inventory/categories") {
    if (input.request.method === "GET")
      return listInventoryCategories(operationsContext, dependencies);
    if (input.request.method === "POST")
      return createInventoryCategory(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/inventory/items") {
    if (input.request.method === "GET") return listInventoryItems(operationsContext, dependencies);
    if (input.request.method === "POST")
      return createInventoryItem(operationsContext, dependencies, body);
  }

  if (input.request.method === "POST" && pathname === "/v1/inventory/stock-ledger") {
    return createStockLedgerEntry(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/inventory/check-templates") {
    if (input.request.method === "GET")
      return listInventoryCheckTemplates(operationsContext, dependencies);
    if (input.request.method === "POST")
      return createInventoryCheckTemplate(operationsContext, dependencies, body);
  }

  if (input.request.method === "POST" && pathname === "/v1/inventory/check-runs") {
    return createInventoryCheckRun(operationsContext, dependencies, body);
  }

  const inventoryCheckRunMatch = pathname.match(/^\/v1\/inventory\/check-runs\/([^/]+)$/);
  if (inventoryCheckRunMatch && input.request.method === "PATCH") {
    return updateInventoryCheckRun(
      operationsContext,
      dependencies,
      pathUuid(inventoryCheckRunMatch[1], "checkRunId"),
      body
    );
  }

  if (input.request.method === "GET" && pathname === "/v1/inventory/exceptions") {
    return listInventoryExceptions(operationsContext, dependencies, {
      itemId: url.searchParams.get("itemId"),
      checkRunId: url.searchParams.get("checkRunId")
    });
  }

  if (pathname === "/v1/incidents") {
    if (input.request.method === "GET")
      return listIncidents(operationsContext, dependencies, {
        status: url.searchParams.get("status"),
        severity: url.searchParams.get("severity"),
        category: url.searchParams.get("category")
      });
    if (input.request.method === "POST")
      return createIncident(operationsContext, dependencies, body);
  }

  if (pathname === "/v1/corrective-actions") {
    if (input.request.method === "GET")
      return listCorrectiveActions(operationsContext, dependencies);
    if (input.request.method === "POST")
      return createCorrectiveAction(operationsContext, dependencies, body);
  }

  const correctiveActionMatch = pathname.match(/^\/v1\/corrective-actions\/([^/]+)$/);
  if (correctiveActionMatch && input.request.method === "PATCH") {
    return updateCorrectiveAction(
      operationsContext,
      dependencies,
      pathUuid(correctiveActionMatch[1], "correctiveActionId"),
      body
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
      return saveEncounterClinicalNoteDraft(operationsContext, dependencies, encounterId, body);
  }

  const encounterAiSessionsMatch = pathname.match(
    /^\/v1\/encounters\/([^/]+)\/ai-scribe\/sessions$/
  );
  if (encounterAiSessionsMatch) {
    const encounterId = pathUuid(encounterAiSessionsMatch[1], "encounterId");
    if (input.request.method === "GET")
      return listEncounterAiScribeSessions(operationsContext, dependencies, encounterId);
    if (input.request.method === "POST")
      return createAiScribeSession(operationsContext, dependencies, encounterId, body);
  }

  const aiSessionMatch = pathname.match(/^\/v1\/ai-scribe\/sessions\/([^/]+)$/);
  if (aiSessionMatch && input.request.method === "GET") {
    return getAiScribeSession(
      operationsContext,
      dependencies,
      pathUuid(aiSessionMatch[1], "sessionId")
    );
  }

  const aiTranscriptSegmentMatch = pathname.match(
    /^\/v1\/ai-scribe\/sessions\/([^/]+)\/transcript-segments$/
  );
  if (aiTranscriptSegmentMatch && input.request.method === "POST") {
    return createAiScribeTranscriptSegment(
      operationsContext,
      dependencies,
      pathUuid(aiTranscriptSegmentMatch[1], "sessionId"),
      body
    );
  }

  const aiSourceAnchorMatch = pathname.match(
    /^\/v1\/ai-scribe\/sessions\/([^/]+)\/source-anchors$/
  );
  if (aiSourceAnchorMatch && input.request.method === "POST") {
    return createAiScribeSourceAnchor(
      operationsContext,
      dependencies,
      pathUuid(aiSourceAnchorMatch[1], "sessionId"),
      body
    );
  }

  const aiGenerateMatch = pathname.match(/^\/v1\/ai-scribe\/sessions\/([^/]+)\/generate-drafts$/);
  if (aiGenerateMatch && input.request.method === "POST") {
    return generateAiScribeDrafts(
      operationsContext,
      dependencies,
      pathUuid(aiGenerateMatch[1], "sessionId"),
      body
    );
  }

  const aiReviewMatch = pathname.match(/^\/v1\/ai-scribe\/sessions\/([^/]+)\/review-decisions$/);
  if (aiReviewMatch && input.request.method === "POST") {
    return recordAiScribeReviewDecision(
      operationsContext,
      dependencies,
      pathUuid(aiReviewMatch[1], "sessionId"),
      body
    );
  }

  const aiRetentionDeleteMatch = pathname.match(
    /^\/v1\/ai-scribe\/sessions\/([^/]+)\/retention-delete$/
  );
  if (aiRetentionDeleteMatch && input.request.method === "POST") {
    return deleteAiScribeRetainedPayloads(
      operationsContext,
      dependencies,
      pathUuid(aiRetentionDeleteMatch[1], "sessionId")
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

  const encounterPrescriptionMatch = pathname.match(/^\/v1\/encounters\/([^/]+)\/prescriptions$/);
  if (encounterPrescriptionMatch && input.request.method === "POST") {
    return createEncounterPrescription(
      operationsContext,
      dependencies,
      pathUuid(encounterPrescriptionMatch[1], "encounterId"),
      body
    );
  }

  const encounterDentalFindingMatch = pathname.match(
    /^\/v1\/encounters\/([^/]+)\/dental-findings$/
  );
  if (encounterDentalFindingMatch && input.request.method === "POST") {
    return createEncounterDentalFinding(
      operationsContext,
      dependencies,
      pathUuid(encounterDentalFindingMatch[1], "encounterId"),
      body
    );
  }

  const encounterProcedureMatch = pathname.match(/^\/v1\/encounters\/([^/]+)\/procedures$/);
  if (encounterProcedureMatch && input.request.method === "POST") {
    return createEncounterProcedurePerformed(
      operationsContext,
      dependencies,
      pathUuid(encounterProcedureMatch[1], "encounterId"),
      body
    );
  }

  const dentalFindingHistoryMatch = pathname.match(/^\/v1\/dental-findings\/([^/]+)\/history$/);
  if (dentalFindingHistoryMatch && input.request.method === "GET") {
    return listDentalFindingHistory(
      operationsContext,
      dependencies,
      pathUuid(dentalFindingHistoryMatch[1], "findingId")
    );
  }

  const dentalFindingMatch = pathname.match(/^\/v1\/dental-findings\/([^/]+)$/);
  if (dentalFindingMatch && input.request.method === "PATCH") {
    return updateDentalFinding(
      operationsContext,
      dependencies,
      pathUuid(dentalFindingMatch[1], "findingId"),
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

  const patientInstructionMatch = pathname.match(/^\/v1\/patients\/([^/]+)\/instructions$/);
  if (patientInstructionMatch && input.request.method === "POST") {
    return createPatientInstruction(
      operationsContext,
      dependencies,
      pathUuid(patientInstructionMatch[1], "patientId"),
      body
    );
  }

  const invoicePaymentRequestMatch = pathname.match(/^\/v1\/invoices\/([^/]+)\/payment-requests$/);
  if (invoicePaymentRequestMatch && input.request.method === "POST") {
    return createInvoicePaymentRequest(
      operationsContext,
      dependencies,
      pathUuid(invoicePaymentRequestMatch[1], "invoiceId"),
      body
    );
  }

  const invoiceManualPaymentMatch = pathname.match(/^\/v1\/invoices\/([^/]+)\/manual-payments$/);
  if (invoiceManualPaymentMatch && input.request.method === "POST") {
    return recordInvoiceManualPayment(
      operationsContext,
      dependencies,
      pathUuid(invoiceManualPaymentMatch[1], "invoiceId"),
      body
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
  identityEdgeGuard?: IdentitySessionEdgeGuard;
  clock?: Clock;
}): Promise<{ context: AccessContext; clinics: Clinic[] }> {
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

  const context = buildAccessContext({
    principal,
    tenant: snapshot.tenant,
    user: snapshot.user,
    memberships: snapshot.memberships,
    clinicAssignments: snapshot.clinicAssignments,
    roleAssignments: snapshot.roleAssignments
  });
  if (input.identityEdgeGuard) {
    const selectedClinic = headerValue(input.request, "x-clinic-id");
    await input.identityEdgeGuard.verify({
      claims: verifiedKeycloakClaims,
      accessContext: context,
      clinics: snapshot.clinics,
      ...(selectedClinic ? { selectedClinicId: pathUuid(selectedClinic, "x-clinic-id") } : {}),
      cookieHeader: input.request.headers.cookie,
      now: (input.clock ?? systemClock).now()
    });
  }
  return { context, clinics: snapshot.clinics };
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

function createPostgresRepositorySet(
  config: ClinicOsConfig,
  dueGenerationCursorSecret: string | undefined
): {
  identityRepository: IdentityRepository;
  operationsRepository: ClinicOperationsRepository;
  auditSink: AuditSink;
  operationsUnitOfWork: OperationsUnitOfWork;
  pool: Pool;
} {
  const pool = new Pool({
    connectionString: config.services.databaseUrl
  });
  const operationsUnitOfWork = new PostgresClinicUnitOfWork(pool, {
    clock: systemClock,
    dueGenerationCursorSecret
  });
  pool.on("error", (error) => {
    const code = "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error(
      JSON.stringify({
        level: "error",
        event: "postgres.pool.idle_client_error",
        code
      })
    );
  });

  return {
    identityRepository: new PostgresIdentityRepository(pool),
    operationsRepository: new PostgresClinicOperationsRepository(pool, {
      dueGenerationCursorSecret
    }),
    auditSink: new PostgresAuditEventSink(pool),
    operationsUnitOfWork,
    pool
  };
}

function createRuntimeDependencyProbes(input: {
  pool: Pool;
  config: ClinicOsConfig;
  useLocalAuthFixture: boolean;
}): ApiDependencyProbe[] {
  const probes: ApiDependencyProbe[] = [
    {
      name: "postgres_schema",
      required: true,
      timeoutMs: 1500,
      async check() {
        const result = await input.pool.query<{ version: string; success: boolean }>(
          `select version, success
           from flyway_schema_history
           where type = 'SQL'
           order by installed_rank desc
           limit 1`
        );
        const latest = result.rows[0];
        if (!latest?.success || latest.version !== LATEST_DATABASE_SCHEMA_VERSION) {
          throw new Error("Database schema is not at the required application version.");
        }
      }
    }
  ];

  if (!input.useLocalAuthFixture) {
    probes.push({
      name: "keycloak_jwks",
      required: true,
      timeoutMs: 1500,
      async check() {
        const issuer = buildExpectedIssuer(input.config);
        const response = await fetch(`${issuer}/protocol/openid-connect/certs`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(1400)
        });
        if (!response.ok) throw new Error("Keycloak JWKS endpoint returned an error status.");
        const body: unknown = await response.json();
        if (!hasJwksKeys(body)) throw new Error("Keycloak JWKS endpoint returned no signing keys.");
      }
    });
  }

  return probes;
}

function hasJwksKeys(value: unknown): value is { keys: unknown[] } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "keys" in value &&
    Array.isArray((value as { keys?: unknown }).keys) &&
    (value as { keys: unknown[] }).keys.length > 0
  );
}

function createRuntimeMediaStorage(
  config: ClinicOsConfig,
  env: NodeJS.ProcessEnv
): MediaStorageProvider | undefined {
  const provider =
    env.CLINIC_OS_MEDIA_STORAGE_PROVIDER ?? (config.isProductionLike ? "" : "local_simulator");

  if (!provider) return undefined;

  if (provider !== "local_simulator") {
    throw new ApiError(503, "CONFIGURATION_ERROR", "Unsupported media storage provider.", {
      provider
    });
  }

  if (config.isProductionLike) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "The local media storage simulator is forbidden outside local/dev environments."
    );
  }

  return new LocalMediaStorageSimulator({
    environment: config.clinicOsEnv,
    region: config.storage.region,
    publicBaseUrl: env.CLINIC_OS_MEDIA_PUBLIC_BASE_URL,
    uploadBasePath: "/v1/media/uploads"
  });
}

function createRuntimeMediaInspection(config: ClinicOsConfig, env: NodeJS.ProcessEnv) {
  const provider =
    env.CLINIC_OS_MEDIA_INSPECTION_PROVIDER ??
    (config.isProductionLike ? "" : "local_pending_simulator");

  if (!provider) return undefined;
  if (provider !== "local_pending_simulator") {
    throw new ApiError(503, "CONFIGURATION_ERROR", "Unsupported media inspection provider.", {
      provider
    });
  }
  if (config.isProductionLike) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "The local pending media inspection simulator is forbidden outside local/dev environments."
    );
  }
  return new PendingLocalClinicalMediaInspectionSimulator();
}

function createRuntimePaymentProvider(config: ClinicOsConfig): PaymentProvider {
  return createPaymentProvider({
    provider: config.providers.payment.provider,
    qrMode: config.providers.payment.qrMode,
    razorpayKeyId: config.providers.payment.razorpayKeyId,
    razorpayKeySecret: config.providers.payment.razorpayKeySecret,
    razorpayWebhookSecret: config.providers.payment.razorpayWebhookSecret,
    razorpayWebhookUrl: config.providers.payment.razorpayWebhookUrl
  });
}

async function executeVerifiedPaymentProviderEvent(input: {
  repository: ClinicOperationsRepository;
  auditSink: AuditSink;
  scope: RepositoryScope;
  providerKey: "razorpay" | "simulator";
  requestId: string;
  event: PaymentProviderWebhookEvent;
  signatureSha256: string;
  receivedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  clock: Clock;
}) {
  const durable = durableIntegrityRepositoryFrom(input.repository);
  const account = await durable.findActivePaymentProviderAccount(input.scope, {
    providerKey: input.providerKey,
    requiredCapability: "VERIFY_WEBHOOKS"
  });
  if (account.outcome !== "resolved") {
    throw new ApiError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "The clinic payment webhook account is not available.",
      {
        provider_key: input.providerKey,
        provider_account_state: account.outcome,
        required_capability: "VERIFY_WEBHOOKS"
      }
    );
  }

  const request: VerifiedRazorpayPaymentEventRequest = {
    operationId: "receiveRazorpayPaymentWebhook",
    accountScope: {
      tenantId: input.scope.tenantId,
      clinicId: input.scope.clinicId,
      providerAccountKey: account.account.externalAccountId
    },
    verification: {
      status: "verified",
      providerKey: input.providerKey,
      rawBodySha256: input.event.rawBodySha256,
      signatureSha256: input.signatureSha256
    },
    event: input.event,
    metadata: {
      requestId: input.requestId,
      receivedAt: input.receivedAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  };
  const providerEvents = createDurablePaymentProviderEventAdapter({
    durable,
    scope: input.scope,
    providerKey: input.providerKey,
    externalAccountId: account.account.externalAccountId,
    leaseOwner: input.requestId,
    now: () => input.clock.now()
  });
  const service = createTreatmentBillingProviderOperationService();
  return service.receiveRazorpayPaymentWebhook(request, {
    billing: {
      listPricebookProcedures: () => input.repository.listPricebookProcedures(input.scope),
      findPricebookProcedureById: (procedureId) =>
        input.repository.findPricebookProcedureById(input.scope, procedureId),
      createInvoice: (invoice) => input.repository.createInvoice(input.scope, invoice),
      findInvoiceById: (invoiceId) => input.repository.findInvoiceById(input.scope, invoiceId),
      createPaymentRequest: (paymentRequest) =>
        input.repository.createPaymentRequest(input.scope, paymentRequest),
      recordPaymentTransaction: (payment) =>
        input.repository.recordPaymentTransaction(input.scope, payment),
      createReceipt: (invoiceId, receipt) =>
        input.repository.createReceipt(input.scope, invoiceId, receipt)
    },
    providerEvents,
    evidence: {
      appendIntegrationAudit: (event) =>
        input.auditSink.appendAuditEvent(
          createAuditEvent({
            tenantId: input.scope.tenantId,
            clinicId: input.scope.clinicId,
            actor: { type: "integration", id: account.account.externalAccountId },
            action: event.action,
            patientId: event.patientId,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            metadata: event.metadata,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            correlationId: event.correlationId,
            occurredAt: new Date(event.occurredAt)
          })
        ),
      async appendOutboxEvent(event) {
        const appended = await durable.appendPaymentProviderIntegrationOutboxEvent(input.scope, {
          ...event,
          externalAccountId: account.account.externalAccountId,
          providerKey: input.providerKey,
          requiredCapability: "VERIFY_WEBHOOKS"
        });
        if (appended.outcome !== "appended" && appended.outcome !== "replayed") {
          throw new ApiError(
            appended.outcome === "account_unavailable" ? 503 : 409,
            appended.outcome === "account_unavailable" ? "DEPENDENCY_UNAVAILABLE" : "CONFLICT",
            "Payment provider evidence outbox could not be committed under integration authority.",
            { provider_outbox_outcome: appended.outcome }
          );
        }
      }
    },
    now: () => input.clock.now()
  });
}

function createDurablePaymentProviderEventAdapter(input: {
  durable: DurableIntegrityRepository;
  scope: RepositoryScope;
  providerKey: "razorpay" | "simulator";
  externalAccountId: UUID;
  leaseOwner: string;
  now: () => Date;
}) {
  return {
    async claimVerifiedEvent(claim: {
      providerKey: "razorpay" | "simulator";
      providerAccountKey: string;
      providerEventId: string;
      idempotencyKey: string;
      eventName: string;
      eventKind: string;
      rawBodySha256: string;
      signatureSha256: string;
      normalizedEvent: Record<string, unknown>;
      receivedAt: string;
      leaseOwner: string;
      leaseExpiresAt: string;
    }) {
      if (
        claim.providerKey !== input.providerKey ||
        claim.providerAccountKey !== input.externalAccountId ||
        claim.leaseOwner !== input.leaseOwner
      ) {
        throw new ApiError(
          409,
          "CONFLICT",
          "Verified provider event scope changed before its durable claim."
        );
      }
      const result = await input.durable.claimVerifiedPaymentProviderEvent(input.scope, {
        providerKey: input.providerKey,
        externalAccountId: input.externalAccountId,
        providerEventId: claim.providerEventId,
        idempotencyKey: claim.idempotencyKey,
        eventName: claim.eventName,
        eventKind: claim.eventKind,
        rawBodySha256: claim.rawBodySha256,
        signatureSha256: claim.signatureSha256,
        normalizedEventSha256: sha256StableJson(claim.normalizedEvent),
        normalizedEvent: claim.normalizedEvent,
        receivedAt: claim.receivedAt,
        leaseOwner: claim.leaseOwner,
        leaseExpiresAt: claim.leaseExpiresAt
      });
      if (result.outcome === "claimed" || result.outcome === "recovered") {
        return { outcome: "claimed" as const, eventId: result.event.id };
      }
      if (result.outcome === "in_progress") {
        return { outcome: "in_progress" as const, eventId: result.event.id };
      }
      if (result.outcome === "duplicate") {
        return duplicateProviderEventProjection(result.event);
      }
      if (result.outcome === "evidence_mismatch") {
        throw new ApiError(
          409,
          "CONFLICT",
          "A duplicate provider event does not match stored verified evidence.",
          { reason: "provider_event_evidence_mismatch", reconciliation_required: true }
        );
      }
      throw new ApiError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        "The clinic payment webhook account became unavailable."
      );
    },
    async createReconciliation(reconciliation: {
      providerEventRecordId: UUID;
      invoiceId: UUID | null;
      patientId: UUID | null;
      reason:
        | "overpayment"
        | "missing_invoice_reference"
        | "currency_mismatch"
        | "invalid_provider_amount"
        | "scope_mismatch"
        | "manual_review_required";
      capturedAmountMinor: number;
      appliedAmountMinor: number;
      unallocatedAmountMinor: number;
      currency: string | null;
      evidence: Record<string, unknown>;
    }) {
      const record = await input.durable.createPaymentReconciliation(input.scope, {
        ...reconciliation,
        createdAt: input.now().toISOString()
      });
      return {
        id: record.id,
        reason: record.reason,
        invoiceId: record.invoiceId,
        patientId: record.patientId,
        capturedAmountMinor: record.capturedAmountMinor,
        appliedAmountMinor: record.appliedAmountMinor,
        unallocatedAmountMinor: record.unallocatedAmountMinor,
        currency: record.currency,
        status: "open" as const
      };
    },
    async completeEvent(completion: {
      providerEventRecordId: UUID;
      processingStatus: "applied" | "ignored" | "reconciliation_required" | "failed";
      processedAt: string;
      result: DurablePaymentProviderEventResultProjection;
    }) {
      const completed = await input.durable.completePaymentProviderEvent(input.scope, {
        providerEventRecordId: completion.providerEventRecordId,
        leaseOwner: input.leaseOwner,
        processingStatus: completion.processingStatus,
        resultDigest: sha256StableJson(completion.result),
        resultProjection: completion.result as unknown as Record<string, unknown>,
        processedAt: completion.processedAt
      });
      if (completed.outcome !== "completed" && completed.outcome !== "replayed") {
        throw new ApiError(
          completed.outcome === "lost_lease" ? 503 : 409,
          completed.outcome === "lost_lease" ? "DEPENDENCY_UNAVAILABLE" : "CONFLICT",
          "Verified provider event could not be completed under its durable claim.",
          { provider_event_completion: completed.outcome }
        );
      }
    }
  };
}

function duplicateProviderEventProjection(event: PaymentProviderEventRecord) {
  if (!event.resultProjection) {
    throw new ApiError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "A completed provider event is missing its durable result projection."
    );
  }
  const result = event.resultProjection as unknown as DurablePaymentProviderEventResultProjection;
  const storedEvidence: PaymentProviderEventEvidenceProjection = {
    rawBodySha256: event.rawBodySha256,
    signatureSha256: event.signatureSha256,
    normalizedEvent: event.normalizedEvent
  };
  return { outcome: "duplicate" as const, eventId: event.id, storedEvidence, result };
}

function durableIntegrityRepositoryFrom(
  repository: ClinicOperationsRepository
): DurableIntegrityRepository {
  const candidate = repository as ClinicOperationsRepository & Partial<DurableIntegrityRepository>;
  const required = [
    "findActivePaymentProviderAccount",
    "appendPaymentProviderIntegrationOutboxEvent",
    "claimVerifiedPaymentProviderEvent",
    "createPaymentReconciliation",
    "completePaymentProviderEvent"
  ] as const;
  if (required.every((operation) => typeof candidate[operation] === "function")) {
    return candidate as ClinicOperationsRepository & DurableIntegrityRepository;
  }
  throw new ApiError(
    503,
    "CONFIGURATION_ERROR",
    "Durable payment provider event persistence is not configured."
  );
}

function verifiedPaymentProviderScope(event: PaymentProviderWebhookEvent): RepositoryScope {
  if (!event.tenantId || !event.clinicId || !isUuid(event.tenantId) || !isUuid(event.clinicId)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Verified payment provider event scope is missing or invalid.",
      { reason: "provider_event_scope_missing" }
    );
  }
  return {
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    actorUserId: SYSTEM_INTEGRATION_ACTOR_USER_ID
  };
}

function verifiedCp13PaymentProviderKey(value: string): "razorpay" | "simulator" {
  if (value === "razorpay" || value === "simulator") return value;
  throw new ApiError(
    503,
    "CONFIGURATION_ERROR",
    "The configured payment provider cannot process CP13 signed webhook events."
  );
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256StableJson(value: unknown): string {
  return sha256Text(JSON.stringify(stableJsonValue(value)));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }
  return value;
}

function missingOperationsRepository(): ApiError {
  return new ApiError(
    503,
    "CONFIGURATION_ERROR",
    "ClinicOS operations repository is not configured."
  );
}

function allowlistedWebhookHeaders(
  request: IncomingMessage,
  useLocalAuthFixture: boolean
): Record<string, string | undefined> {
  return {
    "x-razorpay-signature": headerValue(request, "x-razorpay-signature"),
    ...(useLocalAuthFixture
      ? {
          "x-clinic-os-simulator-signature": headerValue(request, "x-clinic-os-simulator-signature")
        }
      : {})
  };
}

function paymentRepositoryFromOperationsRepository(
  repository: ClinicOperationsRepository
): PaymentOperationsRepository | undefined {
  const candidate = repository as Partial<PaymentOperationsRepository>;
  const requiredMethods = [
    "findPaymentInvoiceById",
    "createPaymentRequestFromProvider",
    "recordManualPayment",
    "recordPaymentWebhookReceipt",
    "markPaymentWebhookReceiptRejected",
    "applyPaymentProviderWebhook"
  ] as const;

  if (requiredMethods.every((method) => typeof candidate[method] === "function")) {
    return candidate as PaymentOperationsRepository;
  }
  return undefined;
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

function headerValue(request: IncomingMessage, header: string): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) return value[0];
  return value;
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

async function readRawBody(
  request: IncomingMessage,
  maxBytes = 100 * 1024 * 1024
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxBytes) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Request body exceeds the configured byte limit."
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function pathUuid(value: string, label: string): UUID {
  if (!isUuid(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${label} must be a valid UUID.`, { field: label });
  }

  return value;
}

function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(500, "CONFIGURATION_ERROR", "ClinicOS API startup failed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createRuntimeApiNestApplication()
    .then(async ({ app, port }) => {
      await app.listen(port, "127.0.0.1");
      console.log(`ClinicOS API listening on http://127.0.0.1:${port}`);
    })
    .catch((error) => {
      const normalized = normalizeApiError(error);
      console.error(JSON.stringify(toApiErrorBody(normalized, "startup"), null, 2));
      process.exitCode = 1;
    });
}
