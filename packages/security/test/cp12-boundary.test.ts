import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundaryError,
  assertContentLengthWithinBudget,
  assertRouteSecurityCoverage,
  assertStrictObject,
  createBodyBudgetCounter,
  createRequestCorrelationContext,
  defineRouteSecurityPolicy,
  deriveAbuseBudgetKey,
  enforceExpensiveOperationBudget,
  enforceQueryBudget,
  enforceRateBudget,
  normalizeUnknownBoundaryError,
  parseJsonRequestBody,
  parsePaginationBudget,
  safeRequestAuditMetadata,
  serializeBoundaryError,
  validateRuntimeValue,
  type AtomicBudgetStore,
  type BudgetConsumptionRequest,
  type BudgetConsumptionResult,
  type RouteSecurityPolicy
} from "../src/index.ts";

const fixedNow = new Date("2026-07-10T10:00:00.000Z");

test("stable boundary errors cover required statuses and Retry-After", () => {
  const required = [
    ["BAD_REQUEST", 400],
    ["UNAUTHENTICATED", 401],
    ["PERMISSION_DENIED", 403],
    ["CONFLICT", 409],
    ["PAYLOAD_TOO_LARGE", 413],
    ["VALIDATION_ERROR", 422]
  ] as const;

  for (const [code, status] of required) {
    const serialized = serializeBoundaryError(
      new BoundaryError({ code, message: "Safe public message." }),
      "req-stable-1"
    );
    assert.equal(serialized.status, status);
    assert.equal(serialized.body.error.code, code);
    assert.equal(serialized.headers["cache-control"], "no-store");
  }

  const limited = serializeBoundaryError(
    new BoundaryError({
      code: "RATE_LIMITED",
      message: "Request budget exhausted. Retry later.",
      retryAfterSeconds: 17
    }),
    "req-stable-2"
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "17");
  assert.throws(
    () =>
      new BoundaryError({
        code: "RATE_LIMITED",
        message: "Missing retry value."
      }),
    /Retry-After/
  );
});

test("unknown internal errors become generic and sensitive details are redacted", () => {
  const unknown = normalizeUnknownBoundaryError(
    new Error("SQL SELECT patient_name using password=hunter2")
  );
  assert.equal(unknown.code, "INTERNAL_ERROR");
  assert.equal(unknown.publicMessage, "The request could not be completed.");

  const serialized = serializeBoundaryError(
    new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request body failed validation.",
      details: {
        authorization: "Bearer secret-token",
        patientName: "Synthetic Patient",
        nested: {
          password: "hunter2",
          message: "email synthetic.patient@example.test token=public"
        }
      }
    }),
    "req-redacted"
  );

  assert.equal(serialized.body.error.details.authorization, "[REDACTED]");
  assert.equal(serialized.body.error.details.patientName, "[REDACTED]");
  assert.deepEqual(serialized.body.error.details.nested, {
    password: "[REDACTED]",
    message: "email s***@example.test token=public"
  });
  assert.doesNotMatch(JSON.stringify(serialized), /hunter2|secret-token|Synthetic Patient/);
});

test("request ids accept one bounded safe value and regenerate invalid or ambiguous values", () => {
  const generatedIds = ["generated-id-1", "generated-id-2"];
  const generated = () => generatedIds.shift()!;
  const accepted = createRequestCorrelationContext({
    requestIdHeader: "edge.req:123",
    method: "POST",
    routeId: "patients.create",
    now: fixedNow,
    generateId: generated
  });
  assert.equal(accepted.requestId, "edge.req:123");
  assert.equal(accepted.requestIdProvenance, "validated_client_value");
  assert.equal(accepted.receivedAt, "2026-07-10T10:00:00.000Z");

  const invalid = createRequestCorrelationContext({
    requestIdHeader: "contains patient@example.test and spaces",
    method: "POST",
    routeId: "patients.create",
    now: fixedNow,
    generateId: generated
  });
  assert.equal(invalid.requestId, "generated-id-1");
  assert.equal(invalid.requestIdProvenance, "generated_after_invalid_client_value");

  const ambiguous = createRequestCorrelationContext({
    requestIdHeader: ["first", "second"],
    method: "GET",
    routeId: "patients.list",
    now: fixedNow,
    generateId: generated
  });
  assert.equal(ambiguous.requestId, "generated-id-2");
  assert.equal(ambiguous.requestIdProvenance, "generated_after_invalid_client_value");
  assert.deepEqual(Object.keys(safeRequestAuditMetadata(accepted)).sort(), [
    "method",
    "receivedAt",
    "requestId",
    "requestIdProvenance",
    "routeId"
  ]);
  assert.throws(
    () =>
      createRequestCorrelationContext({
        method: "GET",
        routeId: "patients.list",
        now: new Date(Number.NaN)
      }),
    /valid injected received-at instant/
  );
});

test("strict runtime validation rejects mass assignment and prototype-pollution corpus", () => {
  const corpus = [
    { tenantId: "client-controlled" },
    { clinicId: "client-controlled" },
    { actorUserId: "client-controlled" },
    { role: "owner" },
    { permissions: ["clinic.manage"] },
    { price: 1 },
    { paymentStatus: "succeeded" },
    { signedByUserId: "client-controlled" },
    JSON.parse('{"__proto__":{"isAdmin":true}}') as Record<string, unknown>,
    { constructor: { prototype: { isAdmin: true } } }
  ];

  for (const candidate of corpus) {
    assert.throws(
      () => assertStrictObject({ fullName: "Synthetic", ...candidate }, ["fullName"]),
      (error: unknown) =>
        error instanceof BoundaryError && error.code === "VALIDATION_ERROR" && error.status === 422
    );
  }

  assert.deepEqual(assertStrictObject({ fullName: "Synthetic" }, ["fullName"]), {
    fullName: "Synthetic"
  });
  assert.deepEqual(parseJsonRequestBody(""), {});
  assert.throws(
    () => parseJsonRequestBody("{"),
    (error: unknown) => error instanceof BoundaryError && error.code === "BAD_REQUEST"
  );
});

test("runtime validator adapter never forwards raw values in issues", () => {
  assert.throws(
    () =>
      validateRuntimeValue(
        {
          safeParse: () => ({
            success: false,
            issues: [
              {
                path: ["patient", "phone"],
                code: "invalid_format",
                message: "+91 99999 88888 is invalid"
              }
            ]
          })
        },
        { patient: { phone: "+91 99999 88888" } },
        "body"
      ),
    (error: unknown) => {
      assert.ok(error instanceof BoundaryError);
      assert.doesNotMatch(JSON.stringify(error.safeDetails), /99999/);
      return error.code === "VALIDATION_ERROR";
    }
  );
});

test("body query and pagination budgets reject oversize and ambiguous input", () => {
  assertContentLengthWithinBudget("8", { maxBytes: 8 });
  assert.throws(
    () => assertContentLengthWithinBudget("9", { maxBytes: 8 }),
    (error: unknown) => error instanceof BoundaryError && error.status === 413
  );
  assert.throws(
    () => assertContentLengthWithinBudget("1,2", { maxBytes: 8 }),
    (error: unknown) => error instanceof BoundaryError && error.status === 400
  );

  const counter = createBodyBudgetCounter({ maxBytes: 5 });
  counter.observe("12");
  counter.observe(Buffer.from("345"));
  assert.equal(counter.bytesRead, 5);
  assert.throws(
    () => counter.observe("6"),
    (error: unknown) => error instanceof BoundaryError && error.status === 413
  );

  const queryPolicy = {
    maxParameters: 2,
    maxTotalBytes: 16,
    maxKeyBytes: 8,
    maxValueBytes: 8,
    maxValuesPerKey: 1
  };
  enforceQueryBudget(new URLSearchParams("a=1&b=2"), queryPolicy);
  for (const value of ["a=1&a=2", "a=1&b=2&c=3", "longvalue=1", "a=123456789"]) {
    assert.throws(
      () => enforceQueryBudget(new URLSearchParams(value), queryPolicy),
      (error: unknown) => error instanceof BoundaryError && error.status === 400
    );
  }

  assert.deepEqual(
    parsePaginationBudget(
      { limit: "25", cursor: "opaque" },
      { defaultLimit: 20, maxLimit: 100, maxCursorBytes: 64 }
    ),
    { limit: 25, cursor: "opaque" }
  );
  for (const limit of ["0", "101", "1.5", "many"]) {
    assert.throws(
      () =>
        parsePaginationBudget({ limit }, { defaultLimit: 20, maxLimit: 100, maxCursorBytes: 64 }),
      (error: unknown) => error instanceof BoundaryError && error.status === 422
    );
  }
});

test("rate and expensive-operation budgets rely on an atomic store and emit Retry-After", async () => {
  const store = new ScriptedBudgetStore([
    { allowed: true, remaining: 9, resetAt: new Date("2026-07-10T10:01:00.000Z") },
    { allowed: false, remaining: 0, resetAt: new Date("2026-07-10T10:00:17.000Z") },
    { allowed: true, remaining: 90, resetAt: new Date("2026-07-10T11:00:00.000Z") }
  ]);
  const key = deriveAbuseBudgetKey({
    secret: "0123456789abcdef0123456789abcdef",
    routeId: "patients.create",
    scope: "tenant_actor",
    identity: "tenant-id:actor-id"
  });
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /tenant-id|actor-id/);

  await enforceRateBudget({
    store,
    bucketKey: key,
    policy: { limit: 10, windowSeconds: 60, scope: "tenant_actor" },
    now: fixedNow
  });
  await assert.rejects(
    () =>
      enforceRateBudget({
        store,
        bucketKey: key,
        policy: { limit: 10, windowSeconds: 60, scope: "tenant_actor" },
        now: fixedNow
      }),
    (error: unknown) => {
      assert.ok(error instanceof BoundaryError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 17);
      return true;
    }
  );

  await enforceExpensiveOperationBudget({
    store,
    bucketKey: key,
    requestedUnits: 10,
    policy: {
      maxUnitsPerRequest: 25,
      maxUnitsPerWindow: 100,
      windowSeconds: 3600,
      scope: "tenant_actor"
    },
    now: fixedNow
  });
  assert.equal(store.requests.length, 3);
  assert.equal(store.requests[2]!.cost, 10);
  assert.ok(
    store.requests.every((request) => request.now.toISOString() === fixedNow.toISOString()),
    "budget stores must receive the injected instant"
  );
  await assert.rejects(
    () =>
      enforceRateBudget({
        store,
        bucketKey: key,
        policy: { limit: 10, windowSeconds: 60, scope: "tenant_actor" },
        now: new Date(Number.NaN)
      }),
    /valid injected instant/
  );
  assert.throws(
    () => deriveAbuseBudgetKey({ secret: "short", routeId: "x", scope: "ip", identity: "raw" }),
    /at least 32 bytes/
  );
});

test("route policies require explicit security controls and coverage is exact", () => {
  const authenticated = policy({
    routeId: "patients.create",
    method: "POST",
    pathTemplate: "/v1/patients",
    access: {
      mode: "authenticated",
      tenant: "verified_active_membership",
      clinic: "verified_active_membership",
      authorization: { mode: "all_permissions", permissions: ["patient.write"] }
    },
    body: "strict"
  });
  const webhook = policy({
    routeId: "razorpay.webhook",
    method: "POST",
    pathTemplate: "/v1/payment-webhooks/razorpay",
    access: {
      mode: "verified_webhook",
      provider: "razorpay",
      signatureVerification: "raw_body_before_parse",
      replayProtection: "required"
    },
    body: "verified_raw_body"
  });

  assertRouteSecurityCoverage(
    [
      { method: "POST", pathTemplate: "/v1/patients" },
      { method: "POST", pathTemplate: "/v1/payment-webhooks/razorpay" }
    ],
    [authenticated, webhook]
  );
  assert.throws(
    () =>
      assertRouteSecurityCoverage([{ method: "POST", pathTemplate: "/v1/patients" }], [webhook]),
    /missing=.*patients.*stale=.*razorpay/
  );
  assert.throws(
    () =>
      defineRouteSecurityPolicy({
        ...webhook,
        runtimeValidation: { ...webhook.runtimeValidation, body: "strict" }
      }),
    /raw body/
  );
});

class ScriptedBudgetStore implements AtomicBudgetStore {
  readonly requests: BudgetConsumptionRequest[] = [];
  readonly results: BudgetConsumptionResult[];

  constructor(results: BudgetConsumptionResult[]) {
    this.results = results;
  }

  consume(request: BudgetConsumptionRequest): Promise<BudgetConsumptionResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) throw new Error("No scripted budget result remains.");
    return Promise.resolve(result);
  }
}

function policy(input: {
  routeId: string;
  method: "POST";
  pathTemplate: string;
  access: RouteSecurityPolicy["access"];
  body: "strict" | "verified_raw_body";
}): RouteSecurityPolicy {
  return defineRouteSecurityPolicy({
    routeId: input.routeId,
    method: input.method,
    pathTemplate: input.pathTemplate,
    access: input.access,
    abuse: {
      body: { maxBytes: 1024 },
      query: {
        maxParameters: 8,
        maxTotalBytes: 2048,
        maxKeyBytes: 64,
        maxValueBytes: 512,
        maxValuesPerKey: 1
      },
      pagination: null,
      rate: {
        limit: 60,
        windowSeconds: 60,
        scope: input.access.mode === "verified_webhook" ? "ip" : "tenant_actor"
      },
      expensiveOperation: null
    },
    runtimeValidation: {
      path: "strict",
      query: "strict",
      body: input.body,
      response: "strict",
      rejectUnknownFields: true
    },
    cachePolicy: "no-store"
  });
}
