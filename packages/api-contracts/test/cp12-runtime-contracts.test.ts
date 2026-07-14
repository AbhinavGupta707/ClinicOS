import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  API_ERROR_CODES,
  DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS,
  IF_MATCH_SCHEMA,
  UNSAFE_JSON_PROPERTY_NAMES,
  VERSIONED_PUBLIC_RESOURCE_SCHEMA,
  VERSIONED_RESOURCE_RESPONSE_CONTRACTS,
  getNativeHttpOperation,
  parseNativeOperationRequest,
  parseNativeOperationResponse,
  parseNativeOperationResponseHeaders,
  parseRuntimeSchema,
  renderGeneratedClient,
  renderNativeOpenApi,
  renderNativeRouteInventory,
  resolveNativeResponseSchemaPath,
  schema,
  type RuntimeSchema
} from "../src/index.ts";

const patientId = "10000000-0000-4000-8000-000000000001";
const encounterId = "10000000-0000-4000-8000-000000000002";
const procedureId = "10000000-0000-4000-8000-000000000003";

const bearerHeaders = {
  authorization: "Bearer synthetic-contract-token",
  "idempotency-key": "idem-contract-0001",
  "content-type": "application/json"
};

function collectVersionedResponsePaths(definition: RuntimeSchema, path = ""): string[] {
  if (definition["x-clinicos-json-kind"] === "versioned-public") return [path];
  if (definition.type === "array") {
    return collectVersionedResponsePaths(definition.items ?? {}, `${path}[]`);
  }
  if (definition.type !== "object") return [];
  return Object.entries(definition.properties ?? {}).flatMap(([name, property]) =>
    collectVersionedResponsePaths(property, path ? `${path}.${name}` : name)
  );
}

test("active native registry covers identity/health and every implemented checkpoint", () => {
  assert.equal(ACTIVE_NATIVE_HTTP_OPERATIONS.length, 135);
  const checkpoints = new Set(
    ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation) => operation.checkpoint)
  );
  for (const checkpoint of [
    "CP1",
    "CP2",
    "CP3",
    "CP4",
    "CP5",
    "CP6",
    "CP7",
    "CP8",
    "CP9",
    "CP10",
    "CP15",
    "CP16"
  ]) {
    assert.ok(checkpoints.has(checkpoint as never), `missing ${checkpoint}`);
  }
  const routeKeys = ACTIVE_NATIVE_HTTP_OPERATIONS.map(
    (operation) => `${operation.method} ${operation.path}`
  );
  assert.equal(new Set(routeKeys).size, routeKeys.length);
  assert.equal(
    new Set(ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation) => operation.operationId)).size,
    135
  );
});

test("current identity response preserves bounded Keycloak provenance", () => {
  const valid = parseNativeOperationResponse("getCurrentIdentity", 200, {
    user: { id: patientId },
    tenant: { id: patientId },
    clinics: [],
    permissions: ["patient.read"],
    keycloak: {
      subject: "synthetic-subject",
      issuer: "http://keycloak.test/realms/clinic-os-test",
      roles: ["doctor"]
    }
  });
  assert.equal(valid.success, true);

  const missingProvenance = parseNativeOperationResponse("getCurrentIdentity", 200, {
    user: { id: patientId },
    tenant: { id: patientId },
    clinics: [],
    permissions: ["patient.read"]
  });
  assert.equal(missingProvenance.success, false);

  const unboundedRoleList = parseNativeOperationResponse("getCurrentIdentity", 200, {
    user: { id: patientId },
    tenant: { id: patientId },
    clinics: [],
    permissions: ["patient.read"],
    keycloak: {
      subject: "synthetic-subject",
      issuer: "http://keycloak.test/realms/clinic-os-test",
      roles: Array.from({ length: 101 }, (_, index) => `role-${index}`)
    }
  });
  assert.equal(unboundedRoleList.success, false);
});

test("every writable JSON body and query is strict and every authenticated mutation is idempotent", () => {
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    assert.equal(operation.request.query.additionalProperties, false, operation.operationId);
    if (
      operation.request.body?.contentType === "application/json" &&
      operation.request.body.schema.format !== "binary"
    ) {
      assert.equal(
        operation.request.body.schema.additionalProperties,
        false,
        operation.operationId
      );
      assert.ok((operation.request.body.maximumBytes ?? 0) <= 1024 * 1024, operation.operationId);
    }
    if (operation.method !== "GET" && operation.auth === "bearer") {
      assert.equal(operation.idempotency.mode, "header", operation.operationId);
      assert.ok(
        operation.request.headers.required?.includes("idempotency-key"),
        operation.operationId
      );
    }
  }
});

test("versioned public resources require a UUID and positive safe rowVersion with public filtering", () => {
  const valid = parseRuntimeSchema(VERSIONED_PUBLIC_RESOURCE_SCHEMA, {
    id: patientId,
    rowVersion: 1,
    displayName: "Synthetic resource",
    nested: { safe: true }
  });
  assert.equal(valid.success, true);

  for (const candidate of [
    { id: patientId },
    { id: patientId, rowVersion: 0 },
    { id: patientId, rowVersion: -1 },
    { id: patientId, rowVersion: 1.5 },
    { id: patientId, rowVersion: Number.MAX_SAFE_INTEGER + 1 },
    { id: patientId, rowVersion: 1, nested: { objectKey: "private/object" } }
  ]) {
    assert.equal(parseRuntimeSchema(VERSIONED_PUBLIC_RESOURCE_SCHEMA, candidate).success, false);
  }
});

test("all 12 conditional-update families expose versions on canonical records, not projections", () => {
  assert.equal(VERSIONED_RESOURCE_RESPONSE_CONTRACTS.length, 12);
  const conditionalOperationIds = ACTIVE_NATIVE_HTTP_OPERATIONS.filter(
    (operation) =>
      operation.concurrency.mode === "if-match" &&
      operation.integration.concurrencyOwnership === "pipeline"
  )
    .map((operation) => operation.operationId)
    .sort();
  assert.deepEqual(
    VERSIONED_RESOURCE_RESPONSE_CONTRACTS.map((contract) => contract.updateOperationId).sort(),
    conditionalOperationIds
  );

  for (const contract of VERSIONED_RESOURCE_RESPONSE_CONTRACTS) {
    assert.ok(
      contract.sources.some((source) => source.role === "update"),
      contract.family
    );
    assert.ok(
      contract.sources.some((source) =>
        ["aggregate", "create", "list", "read"].includes(source.role)
      ),
      contract.family
    );
    for (const source of contract.sources) {
      const definition = resolveNativeResponseSchemaPath(
        source.operationId,
        source.status,
        source.responsePath
      );
      assert.equal(
        definition["x-clinicos-json-kind"],
        "versioned-public",
        `${contract.family}:${source.operationId}:${source.responsePath}`
      );
      assert.deepEqual(definition.required, ["id", "rowVersion"]);
    }
  }

  const mappedSources = VERSIONED_RESOURCE_RESPONSE_CONTRACTS.flatMap((contract) =>
    contract.sources.map(
      (source) => `${source.operationId}:${source.status}:${source.responsePath}`
    )
  ).sort();
  const discoveredSources = ACTIVE_NATIVE_HTTP_OPERATIONS.flatMap((operation) =>
    Object.entries(operation.responses).flatMap(([status, response]) =>
      Number(status) >= 200 && Number(status) < 300
        ? collectVersionedResponsePaths(response.schema).map(
            (responsePath) => `${operation.operationId}:${status}:${responsePath}`
          )
        : []
    )
  ).sort();
  assert.deepEqual(discoveredSources, mappedSources);

  const duplicatePatientProjection = resolveNativeResponseSchemaPath(
    "createPatient",
    201,
    "duplicateSuggestions[].patient"
  );
  assert.notEqual(duplicatePatientProjection["x-clinicos-json-kind"], "versioned-public");
  assert.equal(duplicatePatientProjection.properties?.rowVersion, undefined);
  for (const responsePath of ["prepSummary.patient", "prepSummary.appointment"]) {
    const projection = resolveNativeResponseSchemaPath("getPatientPrepSummary", 200, responsePath);
    assert.notEqual(projection["x-clinicos-json-kind"], "versioned-public", responsePath);
    assert.equal(projection.properties?.rowVersion, undefined, responsePath);
  }
  const validCreateResponse = parseNativeOperationResponse("createPatient", 201, {
    patient: { id: patientId, rowVersion: 1 },
    duplicateSuggestions: [
      {
        patient: {
          id: procedureId,
          fullName: "Projection Only",
          phone: "+919876543210",
          email: null,
          createdAt: "2026-07-10T12:00:00Z"
        },
        score: 80,
        reasons: ["phone_exact"]
      }
    ],
    matchedLead: null
  });
  assert.equal(validCreateResponse.success, true);

  const labCaseDetail = {
    labCase: { id: patientId, rowVersion: 3 },
    vendor: { id: procedureId },
    items: [],
    statusHistory: []
  };
  assert.equal(
    parseNativeOperationResponse("createLabCase", 201, { labCase: labCaseDetail }).success,
    true
  );
  assert.equal(
    parseNativeOperationResponse("createLabCase", 201, {
      labCase: { ...labCaseDetail, labCase: { id: patientId } }
    }).success,
    false
  );
  assert.equal(
    getNativeHttpOperation("createLabCase").responses[201]?.headers.ETag?.sourceProperty,
    "labCase.labCase"
  );

  const checkRunDetail = {
    run: { id: patientId, rowVersion: 4 },
    template: { id: procedureId },
    lines: [],
    procurementSuggestions: []
  };
  assert.equal(
    parseNativeOperationResponse("updateInventoryCheckRun", 200, {
      checkRun: checkRunDetail
    }).success,
    true
  );
  assert.equal(
    parseNativeOperationResponse("updateInventoryCheckRun", 200, {
      checkRun: { ...checkRunDetail, run: { id: patientId } }
    }).success,
    false
  );
  assert.equal(
    getNativeHttpOperation("updateInventoryCheckRun").responses[200]?.headers.ETag?.sourceProperty,
    "checkRun.run"
  );
});

test("response-header contracts require correlation, replay truth, singleton ETags and retry delay", () => {
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    for (const [statusText, response] of Object.entries(operation.responses)) {
      const status = Number(statusText);
      assert.equal(response.headers["x-request-id"]?.required, true, operation.operationId);
      if (status === 429) {
        assert.equal(response.headers["Retry-After"]?.required, true, operation.operationId);
        assert.equal(response.headers["Retry-After"]?.schema.type, "string");
        assert.equal(response.headers["Retry-After"]?.schema.format, "retry-after-seconds");
      }
      if (status >= 200 && status < 300 && operation.idempotency.mode === "header") {
        const replay = response.headers["idempotency-replayed"];
        assert.equal(replay?.required, true, operation.operationId);
        assert.equal(replay?.schema.type, "string");
        assert.deepEqual(replay?.schema.enum, ["false", "true"]);
      }
    }
  }

  assert.equal(getNativeHttpOperation("getPatient").responses[200]?.headers.ETag?.required, true);
  assert.equal(getNativeHttpOperation("getEncounter").responses[200]?.headers.ETag?.required, true);
  assert.equal(getNativeHttpOperation("listPatients").responses[200]?.headers.ETag, undefined);
  assert.equal(getNativeHttpOperation("listLeads").responses[200]?.headers.ETag, undefined);

  for (const replayed of ["false", "true"]) {
    const parsed = parseNativeOperationResponseHeaders("updatePatient", 200, {
      "x-request-id": "request-versioned-response",
      etag: '"rv-2"',
      "idempotency-replayed": replayed
    });
    assert.equal(parsed.success, true, replayed);
  }
  assert.equal(
    parseNativeOperationResponseHeaders("updatePatient", 200, {
      "x-request-id": "request-versioned-response",
      etag: '"rv-2"'
    }).success,
    false
  );
  assert.equal(
    parseNativeOperationResponseHeaders("updatePatient", 200, {
      "x-request-id": "request-versioned-response",
      etag: '"rv-2"',
      "idempotency-replayed": "False"
    }).success,
    false
  );
  assert.equal(
    parseNativeOperationResponseHeaders("getPatient", 200, {
      "x-request-id": "request-singleton-get",
      etag: '"rv-7"'
    }).success,
    true
  );
  assert.equal(
    parseNativeOperationResponseHeaders("getPatient", 200, {
      "x-request-id": "request-singleton-get"
    }).success,
    false
  );
  assert.equal(
    parseNativeOperationResponseHeaders("listPatients", 200, {
      "x-request-id": "request-list"
    }).success,
    true
  );
  for (const retryAfter of ["1", "120", "86400"]) {
    assert.equal(
      parseNativeOperationResponseHeaders("getPatient", 429, {
        "x-request-id": "request-rate-limit",
        "retry-after": retryAfter
      }).success,
      true,
      retryAfter
    );
  }
  for (const retryAfter of ["0", "01", "86401", "1.5", "tomorrow"]) {
    assert.equal(
      parseNativeOperationResponseHeaders("getPatient", 429, {
        "x-request-id": "request-rate-limit",
        "retry-after": retryAfter
      }).success,
      false,
      retryAfter
    );
  }

  const openapi = JSON.parse(renderNativeOpenApi()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          responses: Record<
            string,
            {
              headers: Record<
                string,
                { schema: { type?: string; enum?: string[] }; "x-clinicos-required": boolean }
              >;
            }
          >;
        }
      >
    >;
  };
  const updateHeaders = openapi.paths["/v1/patients/{patientId}"]?.patch?.responses["200"]?.headers;
  assert.equal(updateHeaders?.ETag?.schema.type, "string");
  assert.equal(updateHeaders?.ETag?.["x-clinicos-required"], true);
  assert.deepEqual(updateHeaders?.["idempotency-replayed"]?.schema.enum, ["false", "true"]);
  assert.equal(updateHeaders?.["idempotency-replayed"]?.schema.type, "string");
  assert.equal(openapi.paths["/v1/patients"]?.get?.responses["200"]?.headers.ETag, undefined);
  const rateHeaders = openapi.paths["/v1/patients/{patientId}"]?.get?.responses["429"]?.headers;
  assert.equal(rateHeaders?.["Retry-After"]?.schema.type, "string");
  assert.equal(rateHeaders?.["Retry-After"]?.["x-clinicos-required"], true);
});

test("If-Match accepts only canonical strong safe row-version ETags", () => {
  for (const value of ['"rv-1"', '"rv-7"', '"rv-9007199254740991"']) {
    assert.equal(parseRuntimeSchema(IF_MATCH_SCHEMA, value).success, true, value);
  }
  for (const value of [
    'W/"rv-1"',
    "rv-1",
    '"rv-0"',
    '"rv--1"',
    '"rv-+1"',
    '"rv-01"',
    '"rv-9007199254740992"',
    '"rv-9999999999999999"',
    '"1"',
    "*"
  ]) {
    assert.equal(parseRuntimeSchema(IF_MATCH_SCHEMA, value).success, false, value);
  }
});

test("Razorpay uses JSON transport while preserving bounded raw bytes before parsing", () => {
  const webhook = getNativeHttpOperation("receiveRazorpayPaymentWebhook");
  assert.equal(webhook.request.body?.contentType, "application/json");
  assert.equal(webhook.request.body?.schema.format, "binary");
  const rawBody = new TextEncoder().encode('{"event":"payment.captured"}');
  const valid = parseNativeOperationRequest("receiveRazorpayPaymentWebhook", {
    headers: {
      "x-razorpay-signature": "synthetic-signature-value",
      "x-razorpay-event-id": "synthetic-event-id-0001",
      "content-type": "application/json"
    },
    path: { registrationKey: "synthetic_registration_key_0001" },
    body: rawBody
  });
  assert.equal(valid.success, true);

  for (const contentType of ["application/octet-stream", "text/plain"]) {
    const invalid = parseNativeOperationRequest("receiveRazorpayPaymentWebhook", {
      headers: {
        "x-razorpay-signature": "synthetic-signature-value",
        "x-razorpay-event-id": "synthetic-event-id-0001",
        "content-type": contentType
      },
      path: { registrationKey: "synthetic_registration_key_0001" },
      body: rawBody
    });
    assert.equal(invalid.success, false, contentType);
  }
  assert.equal(
    parseNativeOperationRequest("receiveRazorpayPaymentWebhook", {
      headers: {
        "x-razorpay-signature": "synthetic-signature-value",
        "x-razorpay-event-id": "synthetic-event-id-0001",
        "content-type": "application/json"
      },
      path: { registrationKey: "synthetic_registration_key_0001" },
      body: { event: "payment.captured" }
    }).success,
    false
  );
  const openapi = JSON.parse(renderNativeOpenApi()) as {
    paths: Record<
      string,
      Record<string, { requestBody?: { content: Record<string, { schema: { format?: string } }> } }>
    >;
  };
  const content =
    openapi.paths["/v1/provider-callbacks/razorpay/{registrationKey}"]?.post?.requestBody?.content;
  assert.equal(content?.["application/json"]?.schema.format, "binary");
  assert.equal(content?.["application/octet-stream"], undefined);
});

test("Meta challenge and webhook contracts are registration-scoped and raw-body safe", () => {
  const path = { registrationKey: "synthetic_registration_key_0001" };
  assert.equal(
    parseNativeOperationRequest("verifyMetaWhatsAppCallback", {
      path,
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "synthetic-verify-token",
        "hub.challenge": "123456"
      }
    }).success,
    true
  );
  const rawBody = new TextEncoder().encode('{"object":"whatsapp_business_account"}');
  assert.equal(
    parseNativeOperationRequest("receiveMetaWhatsAppWebhook", {
      path,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`
      },
      body: rawBody
    }).success,
    true
  );
  assert.equal(
    parseNativeOperationRequest("receiveMetaWhatsAppWebhook", {
      path,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`
      },
      body: { object: "whatsapp_business_account" }
    }).success,
    false
  );
});

test("patient create rejects unknown, tenant, actor and nested authority fields", () => {
  const valid = parseNativeOperationRequest("createPatient", {
    headers: bearerHeaders,
    body: {
      fullName: "Synthetic Patient",
      phone: "+919876543210",
      source: "manual",
      sourceDetail: { campaign: "synthetic" }
    }
  });
  assert.equal(valid.success, true);

  for (const body of [
    {
      fullName: "Synthetic Patient",
      phone: "+919876543210",
      source: "manual",
      tenantId: patientId
    },
    {
      fullName: "Synthetic Patient",
      phone: "+919876543210",
      source: "manual",
      actor: { id: patientId }
    },
    {
      fullName: "Synthetic Patient",
      phone: "+919876543210",
      source: "manual",
      sourceDetail: { nested: { clinicId: patientId } }
    }
  ]) {
    const parsed = parseNativeOperationRequest("createPatient", { headers: bearerHeaders, body });
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed), /unknown_field|authority_field/);
  }
});

test("free-form writable and public JSON reject prototype-pollution keys recursively", () => {
  for (const definition of [schema.writableJsonObject(), schema.publicJsonObject()]) {
    for (const unsafeName of UNSAFE_JSON_PROPERTY_NAMES) {
      assert.ok(definition["x-clinicos-forbidden-property-names"]?.includes(unsafeName));
    }
  }
  const corpus = [
    '{"nested":{"__proto__":{"polluted":true}}}',
    '{"nested":[{"constructor":{"polluted":true}}]}',
    '{"nested":{"deeper":{"prototype":{"polluted":true}}}}'
  ];

  for (const serialized of corpus) {
    const parsedJson = JSON.parse(serialized) as Record<string, unknown>;
    const writable = parseRuntimeSchema(schema.writableJsonObject(), parsedJson);
    assert.equal(writable.success, false, serialized);
    assert.match(JSON.stringify(writable), /unsafe_field/);

    const publicRecord = parseRuntimeSchema(schema.publicJsonObject(), parsedJson);
    assert.equal(publicRecord.success, false, serialized);
    assert.match(JSON.stringify(publicRecord), /unsafe_field/);

    const operationRequest = parseNativeOperationRequest("createPatient", {
      headers: bearerHeaders,
      body: {
        fullName: "Synthetic Patient",
        phone: "+919876543210",
        source: "manual",
        sourceDetail: parsedJson
      }
    });
    assert.equal(operationRequest.success, false, serialized);
    assert.match(JSON.stringify(operationRequest), /unsafe_field/);
  }

  const inheritedPrototype = Object.create({ polluted: true }) as Record<string, unknown>;
  inheritedPrototype.safe = "value";
  const inherited = parseRuntimeSchema(schema.writableJsonObject(), inheritedPrototype);
  assert.equal(inherited.success, false);
  assert.match(JSON.stringify(inherited), /plain JSON prototype/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("date and date-time formats require real calendar values and explicit RFC3339 offsets", () => {
  for (const value of ["2024-02-29", "2000-02-29", "2026-12-31"]) {
    assert.equal(parseRuntimeSchema(schema.date(), value).success, true, value);
  }
  for (const value of ["2026-02-30", "2026-99-99", "1900-02-29", "0000-01-01"]) {
    const result = parseRuntimeSchema(schema.date(), value);
    assert.equal(result.success, false, value);
    assert.match(JSON.stringify(result), /format/);
  }

  for (const value of [
    "2026-07-10T12:34:56Z",
    "2026-07-10T12:34:56.123456789+05:30",
    "2024-02-29T00:00:00-04:00"
  ]) {
    assert.equal(parseRuntimeSchema(schema.dateTime(), value).success, true, value);
  }
  for (const value of [
    "2026-02-30T12:00:00Z",
    "2026-07-10T12:00:00",
    "2026-07-10 12:00:00Z",
    "2026-07-10T24:00:00Z",
    "2026-07-10T12:00:00+24:00",
    "July 10, 2026 12:00 PM UTC"
  ]) {
    const result = parseRuntimeSchema(schema.dateTime(), value);
    assert.equal(result.success, false, value);
    assert.match(JSON.stringify(result), /format/);
  }
});

test("price, scan, private storage and signature authority stay out of public writable shapes", () => {
  const treatment = parseNativeOperationRequest("createPatientTreatmentPlan", {
    path: { patientId },
    headers: bearerHeaders,
    body: {
      title: "Synthetic treatment plan",
      phases: [
        {
          title: "Phase one",
          items: [
            {
              pricebookProcedureId: procedureId,
              quantity: 1,
              unitPriceMinor: 100_000
            }
          ]
        }
      ]
    }
  });
  assert.equal(treatment.success, false);
  assert.match(JSON.stringify(treatment), /unitPriceMinor/);

  const media = parseNativeOperationRequest("completeMediaUpload", {
    path: { uploadId: procedureId },
    headers: bearerHeaders,
    body: { patientId, encounterId, scanStatus: "clean", objectKey: "private/key" }
  });
  assert.equal(media.success, false);
  assert.match(JSON.stringify(media), /scanStatus|objectKey/);

  const sign = parseNativeOperationRequest("signEncounterClinicalNote", {
    path: { encounterId },
    headers: {
      authorization: bearerHeaders.authorization,
      "idempotency-key": bearerHeaders["idempotency-key"]
    },
    body: { signedByUserId: patientId }
  });
  assert.equal(sign.success, false);
  assert.match(JSON.stringify(sign), /does not accept a request body/);
});

test("idempotency, optimistic concurrency and pagination ceilings are runtime validated", () => {
  const missingIdempotency = parseNativeOperationRequest("createPatient", {
    headers: { authorization: bearerHeaders.authorization, "content-type": "application/json" },
    body: { fullName: "Synthetic Patient", phone: "+919876543210", source: "manual" }
  });
  assert.equal(missingIdempotency.success, false);
  assert.match(JSON.stringify(missingIdempotency), /idempotency-key/);

  const missingIfMatch = parseNativeOperationRequest("updatePatient", {
    path: { patientId },
    headers: bearerHeaders,
    body: { fullName: "Changed" }
  });
  assert.equal(missingIfMatch.success, false);
  assert.match(JSON.stringify(missingIfMatch), /if-match/);

  const oversizedPage = parseNativeOperationRequest("listPatients", {
    headers: { authorization: bearerHeaders.authorization },
    query: { limit: 101 }
  });
  assert.equal(oversizedPage.success, false);
  assert.match(JSON.stringify(oversizedPage), /at most 100/);
});

test("public response guard rejects private storage and provider-secret fields recursively", () => {
  const safe = parseNativeOperationResponse("requestMediaUploadUrl", 201, {
    upload: { id: procedureId, patientId },
    uploadTarget: { method: "PUT", url: "/v1/media/uploads/synthetic/content" }
  });
  assert.equal(safe.success, true);

  const unsafe = parseNativeOperationResponse("requestMediaUploadUrl", 201, {
    upload: { id: procedureId, patientId, nested: { objectKey: "tenant/private" } },
    uploadTarget: { method: "PUT", url: "/v1/media/uploads/synthetic/content" }
  });
  assert.equal(unsafe.success, false);
  assert.match(JSON.stringify(unsafe), /objectKey/);
});

test("stable error taxonomy and response envelope validate", () => {
  assert.deepEqual(API_ERROR_CODES, [
    "BAD_REQUEST",
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "CONFLICT",
    "PAYLOAD_TOO_LARGE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "AI_PROVIDER_UNAVAILABLE",
    "DEPENDENCY_UNAVAILABLE",
    "CONFIGURATION_ERROR"
  ]);
  const patientOperation = getNativeHttpOperation("createPatient");
  assert.deepEqual(
    [400, 413, 422, 429, 500].filter((status) => patientOperation.responses[status]),
    [400, 413, 422, 429, 500]
  );
  const response = parseNativeOperationResponse("getPatient", 404, {
    error: {
      code: "NOT_FOUND",
      message: "Patient not found.",
      details: { patient_id: patientId },
      request_id: "request-contract-test"
    }
  });
  assert.equal(response.success, true);
});

test("generation is deterministic and documents deferred workflows without inventing routes", () => {
  assert.equal(renderNativeOpenApi(), renderNativeOpenApi());
  assert.equal(renderNativeRouteInventory(), renderNativeRouteInventory());
  assert.equal(renderGeneratedClient(), renderGeneratedClient());
  const openapi = JSON.parse(renderNativeOpenApi()) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const generatedOperationIds = Object.values(openapi.paths).flatMap((pathItem) =>
    Object.values(pathItem).map((operation) => operation.operationId)
  );
  assert.equal(generatedOperationIds.length, ACTIVE_NATIVE_HTTP_OPERATIONS.length);
  assert.ok(DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS.length >= 10);
  assert.equal(
    ACTIVE_NATIVE_HTTP_OPERATIONS.filter(
      (operation) => operation.checkpoint === "CP16" && operation.path.includes("fhir")
    ).length,
    4
  );
  assert.equal(getNativeHttpOperation("healthLive").auth, "none");
});
