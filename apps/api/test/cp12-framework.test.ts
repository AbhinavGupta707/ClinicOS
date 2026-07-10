import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  parseNativeOperationResponse,
  parseNativeOperationResponseHeaders
} from "@clinic-os/api-contracts";
import { buildAccessContext } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS, OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES } from "@clinic-os/db";
import { FixedClock } from "@clinic-os/domain";
import { BoundaryError } from "@clinic-os/security";
import {
  createClinicOsApiServer,
  createRuntimeApiServer,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository
} from "../src/index.ts";
import { ApiError } from "../src/errors.ts";
import type {
  ApiResponse,
  AtomicMutationRequest,
  AtomicMutationResult,
  ClinicOsNestRuntime
} from "../src/framework/contracts.ts";
import {
  InMemoryAtomicBudgetStore,
  InMemoryAtomicMutationCoordinator
} from "../src/framework/in-memory-test-doubles.ts";
import {
  createClinicOsNestApplication,
  createClinicOsNestCompatibilityServer
} from "../src/framework/nest-application.ts";
import {
  ClinicOsRequestPipeline,
  deriveVersionAdvancesForMutation
} from "../src/framework/pipeline.ts";
import type { ParsedIncomingRequest } from "../src/framework/request-utils.ts";
import { serializeCentralizedError } from "../src/framework/error-mapping.ts";
import { RedisAtomicBudgetStore } from "../src/framework/redis-budget-store.ts";
import {
  CLINIC_OS_ROUTE_POLICIES,
  matchClinicOsRoute,
  permissionsForOperation,
  requiredRolesForOperation
} from "../src/framework/route-registry.ts";

test("CP12 app registry covers exactly 128 operations and separates doctor roles from permissions", () => {
  assert.equal(ACTIVE_NATIVE_HTTP_OPERATIONS.length, 128);
  assert.equal(CLINIC_OS_ROUTE_POLICIES.length, 128);
  assert.equal(new Set(CLINIC_OS_ROUTE_POLICIES.map(({ routeId }) => routeId)).size, 128);
  assert.deepEqual(
    ACTIVE_NATIVE_HTTP_OPERATIONS.filter(({ concurrency }) => concurrency.mode === "if-match")
      .map(({ operationId }) => operationId)
      .sort(),
    Object.keys(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES).sort()
  );
  assert.deepEqual(permissionsForOperation("signEncounterClinicalNote"), ["clinical.note.sign"]);
  assert.deepEqual(requiredRolesForOperation("signEncounterClinicalNote"), ["doctor"]);
  assert.deepEqual(permissionsForOperation("signPrescription"), ["prescription.sign"]);
  assert.deepEqual(requiredRolesForOperation("signPrescription"), ["doctor"]);
  assert.equal(
    CLINIC_OS_ROUTE_POLICIES.some(
      (policy) =>
        policy.access.mode === "authenticated" &&
        policy.access.authorization.mode === "all_permissions" &&
        policy.access.authorization.permissions.some((permission) => permission.startsWith("role:"))
    ),
    false
  );
  assert.equal(
    matchClinicOsRoute("PATCH", `/v1/patients/${CHECKPOINT1_SEED_IDS.patientId}`)?.operation
      .operationId,
    "updatePatient"
  );
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    const concretePath = operation.path.replace(
      /\{[^}]+\}/g,
      "10000000-0000-4000-8000-000000000999"
    );
    assert.equal(
      matchClinicOsRoute(operation.method, concretePath)?.operation.operationId,
      operation.operationId,
      `${operation.method} ${operation.path}`
    );
  }
});

test("fixture mutation coordinator replays one digest and conflicts on key reuse", async () => {
  const coordinator = new InMemoryAtomicMutationCoordinator();
  let effects = 0;
  const request = mutationRequest("stable-key", "stable-digest", '"rv-1"');
  const first = await coordinator.execute(request, async () => {
    effects += 1;
    return {
      status: 200,
      body: { patient: { id: "synthetic" } },
      headers: { etag: '"rv-2"' }
    };
  });
  const replay = await coordinator.execute(request, async () => {
    effects += 1;
    throw new Error("A replay must not execute the mutation again.");
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(effects, 1);
  await assert.rejects(
    coordinator.execute(mutationRequest("stable-key", "different-digest", '"rv-2"'), async () => ({
      status: 200,
      body: {}
    })),
    (error) =>
      error instanceof BoundaryError &&
      error.code === "CONFLICT" &&
      error.safeDetails.reason === "idempotency_digest_mismatch"
  );
});

test("directly derivable action writes map to the DB row-version allowlist", () => {
  const leadId = "10000000-0000-4000-8000-000000002101";
  const appointmentId = "10000000-0000-4000-8000-000000003101";
  const encounterId = "10000000-0000-4000-8000-000000004101";
  const treatmentPlanId = "10000000-0000-4000-8000-000000005101";
  const cases = [
    ["createPatient", {}, { leadId }, "updateLeadStatus", leadId],
    ["matchLeadToPatient", { leadId }, {}, "updateLeadStatus", leadId],
    ["convertLeadToAppointment", { leadId }, {}, "updateLeadStatus", leadId],
    ["confirmAppointment", { appointmentId }, {}, "updateAppointment", appointmentId],
    ["checkInAppointment", { appointmentId }, {}, "updateAppointment", appointmentId],
    ["markAppointmentNoShow", { appointmentId }, {}, "updateAppointment", appointmentId],
    ["startEncounter", { encounterId }, {}, "saveEncounterClinicalNoteDraft", encounterId],
    [
      "signEncounterClinicalNote",
      { encounterId },
      {},
      "saveEncounterClinicalNoteDraft",
      encounterId
    ],
    [
      "amendEncounterClinicalNote",
      { encounterId },
      {},
      "saveEncounterClinicalNoteDraft",
      encounterId
    ],
    ["acceptTreatmentPlan", { treatmentPlanId }, {}, "updateTreatmentPlan", treatmentPlanId],
    [
      "createEncounterProcedurePerformed",
      { encounterId },
      { treatmentPlanId },
      "updateTreatmentPlan",
      treatmentPlanId
    ]
  ];
  for (const [operationId, path, body, tableOperationId, resourceId] of cases) {
    assert.deepEqual(
      deriveVersionAdvancesForMutation(operationId, path, body, null),
      [{ operationId: tableOperationId, resourceId }],
      operationId
    );
  }
  assert.deepEqual(deriveVersionAdvancesForMutation("createPatient", {}, {}, null), []);
});

test("fixture mutation coordinator serializes different keys for one resource and stages versions", async () => {
  const coordinator = new InMemoryAtomicMutationCoordinator();
  let rejectFirst: ((error: Error) => void) | undefined;
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const firstEffect = new Promise<never>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const first = coordinator.execute(
    mutationRequest("key-first", "digest-first", '"rv-1"'),
    async () => {
      firstStarted?.();
      return firstEffect;
    }
  );
  await started;
  let secondRan = false;
  const second = coordinator.execute(
    mutationRequest("key-second", "digest-second", '"rv-1"'),
    async () => {
      secondRan = true;
      return { status: 200, body: { patient: {} }, headers: { etag: '"rv-2"' } };
    }
  );
  await Promise.resolve();
  assert.equal(secondRan, false);
  rejectFirst?.(new Error("synthetic rollback"));
  await assert.rejects(first, /synthetic rollback/);
  const secondResult = await second;
  assert.equal(secondResult.etag, '"rv-2"');
  assert.equal(secondRan, true);
  const third = await coordinator.execute(
    mutationRequest("key-third", "digest-third", '"rv-2"'),
    async () => ({
      status: 200,
      body: { patient: {} },
      headers: { etag: '"rv-3"' }
    })
  );
  assert.equal(third.etag, '"rv-3"');
});

test("Redis budget adapter consumes atomically and fails closed when Redis is unavailable", async () => {
  const client = new FakeRedisClient();
  const store = new RedisAtomicBudgetStore({ redisUrl: "", client });
  const now = new Date("2026-07-10T10:00:00.000Z");
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      store.consume({ bucketKey: "bucket", limit: 10, cost: 1, windowSeconds: 60, now })
    )
  );
  assert.equal(results.filter(({ allowed }) => allowed).length, 10);
  assert.equal(results.filter(({ allowed }) => !allowed).length, 2);
  assert.equal(client.errorListenerRegistered, true);

  const unavailable = new RedisAtomicBudgetStore({
    redisUrl: "",
    client: new FakeRedisClient({ failEval: true })
  });
  await assert.rejects(
    unavailable.consume({ bucketKey: "bucket", limit: 1, cost: 1, windowSeconds: 60, now }),
    (error) => error instanceof BoundaryError && error.code === "DEPENDENCY_UNAVAILABLE"
  );
});

test("invalid mutation responses roll back before completion and cannot be replayed", async () => {
  const identityRepository = new LocalFixtureIdentityRepository();
  const snapshot = await identityRepository.findAccessByKeycloakSubject("seed-assistant");
  assert.ok(snapshot);
  const coordinator = new RecordingTransactionalMutationCoordinator();
  const pipeline = new ClinicOsRequestPipeline({
    clock: new FixedClock("2026-07-10T10:00:00.000Z"),
    budgetStore: new InMemoryAtomicBudgetStore(),
    budgetKeySecret: "cp12-invalid-response-test-budget-key-000000000000",
    mutationCoordinator: coordinator,
    repositoryMode: "fixture",
    useLocalAuthFixture: true,
    identityRepository,
    health: async () => ({ status: 200, body: { status: "ok" } }),
    admitTraffic: async () => true,
    resolveAccess: async () => ({
      context: buildAccessContext({
        principal: {
          subject: "seed-assistant",
          issuer: "http://localhost:8080/realms/clinic-os-local",
          email: null,
          displayName: snapshot.user.displayName,
          username: null,
          keycloakRoles: ["assistant"]
        },
        tenant: snapshot.tenant,
        user: snapshot.user,
        memberships: snapshot.memberships,
        clinicAssignments: snapshot.clinicAssignments,
        roleAssignments: snapshot.roleAssignments
      }),
      clinics: snapshot.clinics
    }),
    handleIdentity: async () => ({ status: 500, body: {} }),
    handleWebhook: async () => ({ status: 500, body: {} }),
    handleLegacyOperation: async () => ({
      status: 201,
      body: { patient: { deliberately: "invalid-response-contract" } }
    })
  });
  const request = mutationPipelineRequest();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      pipeline.execute({ ...request, headers: { ...request.headers } }),
      (error) => error instanceof BoundaryError && error.code === "INTERNAL_ERROR"
    );
  }
  assert.equal(coordinator.attempts, 2);
  assert.equal(coordinator.rollbacks, 2);
  assert.equal(coordinator.commits, 0);
  assert.equal(coordinator.replays, 0);
});

test("nested response version sources derive canonical ETags and reject mismatched effect headers", async () => {
  const identityRepository = new LocalFixtureIdentityRepository();
  const snapshot = await identityRepository.findAccessByKeycloakSubject("seed-assistant");
  assert.ok(snapshot);
  const access = {
    context: buildAccessContext({
      principal: {
        subject: "seed-assistant",
        issuer: "http://localhost:8080/realms/clinic-os-local",
        email: null,
        displayName: snapshot.user.displayName,
        username: null,
        keycloakRoles: ["assistant"]
      },
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinics: snapshot.clinics
  };
  const labCaseId = "10000000-0000-4000-8000-000000006101";
  const responseBody = {
    labCase: {
      labCase: { id: labCaseId, rowVersion: 7 },
      vendor: {},
      items: [],
      statusHistory: []
    }
  };
  const createPipeline = (
    coordinator: RecordingTransactionalMutationCoordinator,
    effectEtag?: string
  ) =>
    new ClinicOsRequestPipeline({
      clock: new FixedClock("2026-07-10T10:00:00.000Z"),
      budgetStore: new InMemoryAtomicBudgetStore(),
      budgetKeySecret: "cp12-nested-etag-test-budget-key-000000000000",
      mutationCoordinator: coordinator,
      repositoryMode: "fixture",
      useLocalAuthFixture: true,
      identityRepository,
      health: async () => ({ status: 200, body: { status: "ok" } }),
      admitTraffic: async () => true,
      resolveAccess: async () => access,
      handleIdentity: async () => ({ status: 500, body: {} }),
      handleWebhook: async () => ({ status: 500, body: {} }),
      handleLegacyOperation: async () => ({
        status: 201,
        body: responseBody,
        ...(effectEtag ? { headers: { etag: effectEtag } } : {})
      })
    });

  const committedCoordinator = new RecordingTransactionalMutationCoordinator();
  const committed = await createPipeline(committedCoordinator).execute(
    labCaseMutationPipelineRequest("nested-etag-commit")
  );
  assert.equal(committed.headers.etag, '"rv-7"');
  assert.equal(committedCoordinator.commits, 1);
  assert.equal(committedCoordinator.rollbacks, 0);

  const rejectedCoordinator = new RecordingTransactionalMutationCoordinator();
  await assert.rejects(
    createPipeline(rejectedCoordinator, '"rv-8"').execute(
      labCaseMutationPipelineRequest("nested-etag-mismatch")
    ),
    (error) => error instanceof BoundaryError && error.code === "INTERNAL_ERROR"
  );
  assert.equal(rejectedCoordinator.commits, 0);
  assert.equal(rejectedCoordinator.rollbacks, 1);
});

test("the central response boundary strips undeclared sensitive effect headers", async () => {
  const identityRepository = new LocalFixtureIdentityRepository();
  const pipeline = new ClinicOsRequestPipeline({
    clock: new FixedClock("2026-07-10T10:00:00.000Z"),
    budgetStore: new InMemoryAtomicBudgetStore(),
    budgetKeySecret: "cp12-response-header-test-budget-key-000000000000",
    mutationCoordinator: new InMemoryAtomicMutationCoordinator(),
    repositoryMode: "fixture",
    useLocalAuthFixture: true,
    identityRepository,
    health: async (_kind, requestId) => ({
      status: 200,
      body: { status: "ok", service: "clinic-os-api", request_id: requestId },
      headers: {
        "set-cookie": "session=must-not-escape",
        "content-language": "en"
      }
    }),
    admitTraffic: async () => true,
    resolveAccess: async () => {
      throw new Error("Liveness must not resolve access.");
    },
    handleIdentity: async () => ({ status: 500, body: {} }),
    handleWebhook: async () => ({ status: 500, body: {} }),
    handleLegacyOperation: async () => ({ status: 500, body: {} })
  });
  const response = await pipeline.execute({
    method: "GET",
    url: "/health/live",
    originalUrl: "/health/live",
    headers: { "x-request-id": "cp12-safe-header-request" },
    rawHeaders: ["x-request-id", "cp12-safe-header-request"],
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as ParsedIncomingRequest);
  assert.equal(response.status, 200);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(response.headers["content-language"], "en");
  assert.equal(response.headers["x-request-id"], "cp12-safe-header-request");
});

test("unparsed chunked bodies fail before route dispatch", async () => {
  const identityRepository = new LocalFixtureIdentityRepository();
  let dispatches = 0;
  const pipeline = new ClinicOsRequestPipeline({
    clock: new FixedClock("2026-07-10T10:00:00.000Z"),
    budgetStore: new InMemoryAtomicBudgetStore(),
    budgetKeySecret: "cp12-chunked-transport-test-budget-key-000000000000",
    mutationCoordinator: new InMemoryAtomicMutationCoordinator(),
    repositoryMode: "fixture",
    useLocalAuthFixture: true,
    identityRepository,
    health: async () => {
      dispatches += 1;
      return { status: 200, body: {} };
    },
    admitTraffic: async () => true,
    resolveAccess: async () => {
      throw new Error("Unparsed chunked health request must not resolve access.");
    },
    handleIdentity: async () => ({ status: 500, body: {} }),
    handleWebhook: async () => ({ status: 500, body: {} }),
    handleLegacyOperation: async () => ({ status: 500, body: {} })
  });
  await assert.rejects(
    pipeline.execute({
      method: "GET",
      url: "/health/live",
      originalUrl: "/health/live",
      headers: { "transfer-encoding": "chunked" },
      rawHeaders: ["transfer-encoding", "chunked"],
      socket: { remoteAddress: "127.0.0.1" }
    } as unknown as ParsedIncomingRequest),
    (error) =>
      error instanceof BoundaryError &&
      error.code === "BAD_REQUEST" &&
      error.safeDetails.reason === "unparsed_chunked_body"
  );
  assert.equal(dispatches, 0);
});

test("central error serializers satisfy the matched operation body and header contracts", () => {
  const request = {
    method: "GET",
    url: "/v1/patients",
    originalUrl: "/v1/patients",
    headers: {},
    rawHeaders: [],
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as ParsedIncomingRequest;
  const cases = [
    serializeCentralizedError(
      request,
      new BoundaryError({
        code: "RATE_LIMITED",
        message: "The request budget was exhausted.",
        retryAfterSeconds: 17
      }),
      "cp12-rate-limited-error"
    ),
    serializeCentralizedError(
      request,
      new ApiError(400, "VALIDATION_ERROR", "Synthetic validation failure."),
      "cp12-api-validation-error"
    ),
    serializeCentralizedError(
      request,
      new ApiError(200, "NOT_FOUND", "An invalid status must fail closed."),
      "cp12-invalid-error-status"
    )
  ];
  assert.equal(cases[0].status, 429);
  assert.equal(cases[0].headers["retry-after"], "17");
  assert.equal(cases[1].status, 422);
  assert.equal(cases[2].status, 500);
  for (const response of cases) {
    assert.equal(typeof response.headers["x-request-id"], "string");
    assert.equal(
      parseNativeOperationResponse("listPatients", response.status, response.body).success,
      true
    );
    assert.equal(
      parseNativeOperationResponseHeaders("listPatients", response.status, response.headers)
        .success,
      true
    );
  }
});

test("strict CP12 boundary rejects unknown, authority, unsafe, invalid-time, and duplicate query input", async (t) => {
  await withFixtureServer(t, {}, async (baseUrl) => {
    const cases = [
      {
        body: JSON.stringify({
          fullName: "Unknown Field",
          phone: "+919876543210",
          source: "manual",
          unexpected: true
        }),
        expectedStatus: 422
      },
      {
        body: JSON.stringify({
          fullName: "Authority Field",
          phone: "+919876543211",
          source: "manual",
          sourceDetail: { actorUserId: CHECKPOINT1_SEED_IDS.users.owner }
        }),
        expectedStatus: 422
      },
      {
        body: '{"fullName":"Unsafe Key","phone":"+919876543212","source":"manual","sourceDetail":{"__proto__":{"polluted":true}}}',
        expectedStatus: 422
      },
      {
        body: JSON.stringify({
          fullName: "Invalid Date",
          phone: "+919876543213",
          source: "manual",
          dateOfBirth: "2026-02-30"
        }),
        expectedStatus: 422
      }
    ];
    for (const [index, candidate] of cases.entries()) {
      const response = await fetch(`${baseUrl}/v1/patients`, {
        method: "POST",
        headers: fixtureMutationHeaders(`strict-${index}`),
        body: candidate.body
      });
      assert.equal(response.status, candidate.expectedStatus);
      assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
    }

    const duplicate = await fetch(`${baseUrl}/v1/patients?query=a&query=b`, {
      headers: { "x-clinic-os-dev-subject": "seed-assistant" }
    });
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error.code, "BAD_REQUEST");
  });
});

test("authentication precedes malformed resource disclosure", async (t) => {
  await withFixtureServer(
    t,
    {
      useLocalAuthFixture: false,
      tokenVerifier: {
        verifyAuthorizationHeader() {
          throw new BoundaryError({ code: "UNAUTHENTICATED", message: "Synthetic denial." });
        }
      }
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/patients/not-a-uuid`);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
    }
  );
});

test("clinic-scoped central permission and doctor-role predicates deny cross-clinic union leakage", async (t) => {
  const baseIdentity = new LocalFixtureIdentityRepository();
  const baseSnapshot = await baseIdentity.findAccessByKeycloakSubject("seed-doctor");
  assert.ok(baseSnapshot);
  const secondClinicId = "10000000-0000-4000-8000-000000000102";
  const secondClinic = {
    ...baseSnapshot.clinics[0],
    id: secondClinicId,
    slug: "synthetic-second-clinic",
    displayName: "Synthetic Second Clinic"
  };
  const identityRepository = {
    async findAccessByKeycloakSubject() {
      return {
        ...baseSnapshot,
        clinics: [...baseSnapshot.clinics, secondClinic],
        clinicAssignments: [
          ...baseSnapshot.clinicAssignments,
          {
            tenantId: baseSnapshot.tenant.id,
            clinicId: secondClinicId,
            userId: baseSnapshot.user.id,
            status: "active"
          }
        ],
        roleAssignments: [
          ...baseSnapshot.roleAssignments,
          {
            tenantId: baseSnapshot.tenant.id,
            clinicId: secondClinicId,
            userId: baseSnapshot.user.id,
            roleSlug: "assistant"
          }
        ]
      };
    }
  };
  await withFixtureServer(
    t,
    { identityRepository, fixtureSubject: "seed-doctor" },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/encounters/10000000-0000-4000-8000-000000000901/sign-note`,
        {
          method: "POST",
          headers: {
            "x-clinic-id": secondClinicId,
            "x-clinic-os-dev-subject": "seed-doctor",
            "idempotency-key": "cross-clinic-sign-denial"
          }
        }
      );
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.error.details.reason, "missing_permission");
      assert.equal(body.error.details.required_permission, "clinical.note.sign");
    }
  );
});

test("chunked JSON body over the route limit returns 413 without Content-Length", async (t) => {
  await withFixtureServer(t, {}, async (baseUrl) => {
    const url = new URL("/v1/patients", baseUrl);
    const response = await chunkedRequest(url, Buffer.alloc(1024 * 1024 + 1, 0x61));
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, "PAYLOAD_TOO_LARGE");
  });
});

test("chunked body with an unsupported content type fails before unbounded dispatch", async (t) => {
  await withFixtureServer(t, {}, async (baseUrl) => {
    const url = new URL("/v1/patients", baseUrl);
    const response = await chunkedRequest(
      url,
      Buffer.from('{"fullName":"unsupported transport"}'),
      "text/plain"
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "BAD_REQUEST");
    assert.equal(response.body.error.details.reason, "unparsed_chunked_body");
  });
});

test("production-shaped Razorpay JSON verifies Nest raw bytes before parsing and rejects other media", async (t) => {
  let verifyCalls = 0;
  let parseCalls = 0;
  const paymentProvider = {
    async verifyWebhook() {
      verifyCalls += 1;
      return { status: "invalid_signature", message: "Invalid signature." };
    },
    async parseWebhook() {
      parseCalls += 1;
      throw new Error("Must not parse an invalid signature.");
    }
  };
  await withFixtureServer(t, { paymentProvider, useLocalAuthFixture: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/payment-webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "invalid-signature-value"
      },
      body: "{not-json"
    });
    assert.equal(response.status, 403);
    assert.equal(verifyCalls, 1);
    assert.equal(parseCalls, 0);
    const unsupported = await fetch(`${baseUrl}/v1/payment-webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-razorpay-signature": "unsupported-media-signature"
      },
      body: "unsupported"
    });
    assert.equal(unsupported.status, 422);
    assert.equal((await unsupported.json()).error.code, "VALIDATION_ERROR");
    assert.equal(verifyCalls, 1);
    assert.equal(parseCalls, 0);
  });
});

test("liveness stays 200 while Redis loss removes readiness, startup, and v1 admission", async (t) => {
  const unavailableBudgetStore = {
    readiness: () => Promise.reject(new Error("synthetic Redis loss")),
    consume: () =>
      Promise.reject(
        new BoundaryError({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "A required request-budget dependency is unavailable."
        })
      )
  };
  await withFixtureServer(t, { budgetStore: unavailableBudgetStore }, async (baseUrl) => {
    const live = await fetch(`${baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).status, "ok");
    for (const path of ["/health/ready", "/health/startup"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { "x-clinic-os-dev-subject": "seed-assistant" }
      });
      assert.equal(response.status, 503, path);
      const report = await response.json();
      assert.equal(report.status, "unavailable", path);
      assert.ok(
        report.dependencies.some(
          (dependency) =>
            dependency.name === "redis_abuse_budget" && dependency.status === "unavailable"
        ),
        path
      );
    }

    const admitted = await fetch(`${baseUrl}/v1/me`, {
      headers: { "x-clinic-os-dev-subject": "seed-assistant" }
    });
    assert.equal(admitted.status, 503);
    assert.equal((await admitted.json()).error.code, "DEPENDENCY_UNAVAILABLE");
  });
});

test("runtime Postgres composition selects the durable mutation coordinator automatically", async (t) => {
  const { server } = createRuntimeApiServer(runtimePostgresEnvironment);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Socket binding is blocked in this sandbox; run CP12 API tests outside it.");
      return;
    }
    throw error;
  }
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/health/live`);
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("compatibility server shutdown closes Nest and runtime resources exactly once", async (t) => {
  let nestCloseCalls = 0;
  let runtimeCloseCalls = 0;
  const runtime: ClinicOsNestRuntime = {
    clock: new FixedClock("2026-07-10T10:00:00.000Z"),
    budgetStore: new InMemoryAtomicBudgetStore(),
    budgetKeySecret: "cp12-compatibility-close-budget-key-000000000000",
    mutationCoordinator: new InMemoryAtomicMutationCoordinator(),
    repositoryMode: "fixture",
    useLocalAuthFixture: true,
    identityRepository: new LocalFixtureIdentityRepository(),
    health: async () => ({ status: 200, body: { status: "ok" } }),
    admitTraffic: async () => true,
    resolveAccess: async () => {
      throw new Error("The teardown test must not resolve access.");
    },
    handleIdentity: async () => ({ status: 500, body: {} }),
    handleWebhook: async () => ({ status: 500, body: {} }),
    handleLegacyOperation: async () => ({ status: 500, body: {} }),
    close: async () => {
      runtimeCloseCalls += 1;
    }
  };
  const server = createClinicOsNestCompatibilityServer(runtime, async (activeRuntime, adapter) => {
    const application = await createClinicOsNestApplication(activeRuntime, adapter);
    const closeNest = application.app.close.bind(application.app);
    return {
      ...application,
      app: new Proxy(application.app, {
        get(target, property, receiver) {
          if (property !== "close") return Reflect.get(target, property, receiver);
          return async () => {
            nestCloseCalls += 1;
            await closeNest();
          };
        }
      })
    };
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Socket binding is blocked in this sandbox; run CP12 API tests outside it.");
      return;
    }
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert.deepEqual(
    { nestCloseCalls, runtimeCloseCalls },
    { nestCloseCalls: 1, runtimeCloseCalls: 1 }
  );
});

function mutationRequest(
  key: string,
  requestDigest: string,
  expectedEtag: string
): AtomicMutationRequest {
  return {
    identity: {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    idempotency: { operationId: "updatePatient", key, requestDigest },
    concurrency: {
      operationId: "updatePatient",
      resourceId: CHECKPOINT1_SEED_IDS.patientId,
      expectedEtag
    },
    versionAdvances: [{ operationId: "updatePatient", resourceId: CHECKPOINT1_SEED_IDS.patientId }],
    requestId: `request-${key}`,
    now: new Date("2026-07-10T10:00:00.000Z")
  };
}

async function withFixtureServer(t, overrides, callback) {
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: new LocalFixtureClinicOperationsRepository({
      clock: new FixedClock("2026-07-10T10:00:00.000Z")
    }),
    auditSink: new InMemoryAuditSink(),
    useLocalAuthFixture: true,
    repositoryMode: "fixture",
    clock: new FixedClock("2026-07-10T10:00:00.000Z"),
    ...overrides
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Socket binding is blocked in this sandbox; run CP12 API tests outside it.");
      return;
    }
    throw error;
  }
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function fixtureMutationHeaders(key: string) {
  return {
    "content-type": "application/json",
    "x-clinic-os-dev-subject": "seed-assistant",
    "idempotency-key": `cp12-${key}`
  };
}

function chunkedRequest(
  url: URL,
  body: Buffer,
  contentType = "application/json"
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          "x-clinic-os-dev-subject": "seed-assistant",
          "idempotency-key": "cp12-chunked-body-limit"
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        });
      }
    );
    request.on("error", reject);
    request.write(body.subarray(0, Math.floor(body.length / 2)));
    request.end(body.subarray(Math.floor(body.length / 2)));
  });
}

class FakeRedisClient {
  isOpen = true;
  errorListenerRegistered = false;
  #consumed = 0;
  #failEval: boolean;

  constructor(input: { failEval?: boolean } = {}) {
    this.#failEval = input.failEval ?? false;
  }

  connect() {
    this.isOpen = true;
    return Promise.resolve();
  }

  ping() {
    return Promise.resolve("PONG");
  }

  eval(_script, { arguments: args }) {
    if (this.#failEval) return Promise.reject(new Error("synthetic Redis loss"));
    const limit = Number(args[0]);
    const cost = Number(args[1]);
    const window = Number(args[2]);
    const allowed = this.#consumed + cost <= limit;
    if (allowed) this.#consumed += cost;
    return Promise.resolve([allowed ? 1 : 0, Math.max(0, limit - this.#consumed), window]);
  }

  quit() {
    this.isOpen = false;
    return Promise.resolve();
  }

  on(event) {
    if (event === "error") this.errorListenerRegistered = true;
  }
}

class RecordingTransactionalMutationCoordinator {
  readonly durability = "in_memory_test_double" as const;
  attempts = 0;
  commits = 0;
  rollbacks = 0;
  replays = 0;
  #completed = new Map<string, ApiResponse>();

  readiness() {
    return Promise.resolve();
  }

  async execute(
    request: AtomicMutationRequest,
    effect: (transaction: undefined) => Promise<ApiResponse>
  ): Promise<AtomicMutationResult> {
    this.attempts += 1;
    const completed = this.#completed.get(request.idempotency.key);
    if (completed) {
      this.replays += 1;
      return { response: completed, replayed: true, etag: null };
    }
    try {
      const response = await effect(undefined);
      this.#completed.set(request.idempotency.key, response);
      this.commits += 1;
      return { response, replayed: false, etag: null };
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

function mutationPipelineRequest(): ParsedIncomingRequest {
  const body = {
    fullName: "Invalid Response Contract",
    phone: "+919876543299",
    source: "manual"
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    url: "/v1/patients",
    originalUrl: "/v1/patients",
    headers: {
      "content-type": "application/json",
      "content-length": String(rawBody.byteLength),
      "idempotency-key": "invalid-response-must-not-complete"
    },
    rawHeaders: [
      "content-type",
      "application/json",
      "content-length",
      String(rawBody.byteLength),
      "idempotency-key",
      "invalid-response-must-not-complete"
    ],
    socket: { remoteAddress: "127.0.0.1" },
    body,
    rawBody
  } as unknown as ParsedIncomingRequest;
}

function labCaseMutationPipelineRequest(key: string): ParsedIncomingRequest {
  const body = {
    vendorId: "10000000-0000-4000-8000-000000006001",
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    title: "Nested response ETag test",
    dueAt: "2026-07-11T10:00:00.000Z",
    items: [{ itemType: "crown" }]
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    url: "/v1/lab-cases",
    originalUrl: "/v1/lab-cases",
    headers: {
      "content-type": "application/json",
      "content-length": String(rawBody.byteLength),
      "x-clinic-os-dev-subject": "seed-assistant",
      "idempotency-key": key
    },
    rawHeaders: [
      "content-type",
      "application/json",
      "content-length",
      String(rawBody.byteLength),
      "x-clinic-os-dev-subject",
      "seed-assistant",
      "idempotency-key",
      key
    ],
    socket: { remoteAddress: "127.0.0.1" },
    body,
    rawBody
  } as unknown as ParsedIncomingRequest;
}

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: { region: "ap-south-1", bucket: "clinic-os-local" },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: { provider: "simulator", qrMode: "payment_link_qr" },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: { syntheticDataOnly: true }
};

const runtimePostgresEnvironment = {
  NODE_ENV: "development",
  CLINIC_OS_ENV: "local",
  DATABASE_URL: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
  REDIS_URL: "redis://localhost:6379",
  TEMPORAL_ADDRESS: "localhost:7233",
  KEYCLOAK_BASE_URL: "http://localhost:8080",
  KEYCLOAK_REALM: "clinic-os-local",
  KEYCLOAK_CLIENT_ID: "clinic-os-web",
  S3_REGION: "ap-south-1",
  S3_BUCKET: "clinic-os-local",
  WHATSAPP_PROVIDER: "simulator",
  PAYMENT_PROVIDER: "simulator",
  TELEPHONY_PROVIDER: "simulator",
  LLM_PROVIDER: "simulator",
  TRANSCRIPTION_PROVIDER: "simulator",
  AWS_REGION: "ap-south-1",
  AWS_DR_REGION: "ap-south-2",
  ALERTING_PROVIDER: "unconfigured",
  BACKUP_RESTORE_DRILL_MODE: "dry_run",
  BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "false",
  BACKUP_RESTORE_RPO_MINUTES: "60",
  BACKUP_RESTORE_RTO_MINUTES: "240"
};
