import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  API_ERROR_CODES,
  DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS,
  UNSAFE_JSON_PROPERTY_NAMES,
  getNativeHttpOperation,
  parseNativeOperationRequest,
  parseNativeOperationResponse,
  parseRuntimeSchema,
  renderGeneratedClient,
  renderNativeOpenApi,
  renderNativeRouteInventory,
  schema
} from "../src/index.ts";

const patientId = "10000000-0000-4000-8000-000000000001";
const encounterId = "10000000-0000-4000-8000-000000000002";
const procedureId = "10000000-0000-4000-8000-000000000003";

const bearerHeaders = {
  authorization: "Bearer synthetic-contract-token",
  "idempotency-key": "idem-contract-0001",
  "content-type": "application/json"
};

test("active native registry covers identity/health and every CP2-CP10 checkpoint", () => {
  assert.equal(ACTIVE_NATIVE_HTTP_OPERATIONS.length, 128);
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
    "CP10"
  ]) {
    assert.ok(checkpoints.has(checkpoint as never), `missing ${checkpoint}`);
  }
  const routeKeys = ACTIVE_NATIVE_HTTP_OPERATIONS.map(
    (operation) => `${operation.method} ${operation.path}`
  );
  assert.equal(new Set(routeKeys).size, routeKeys.length);
  assert.equal(
    new Set(ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation) => operation.operationId)).size,
    128
  );
});

test("every writable JSON body and query is strict and every authenticated mutation is idempotent", () => {
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    assert.equal(operation.request.query.additionalProperties, false, operation.operationId);
    if (operation.request.body?.contentType === "application/json") {
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
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "CONFLICT",
    "AI_PROVIDER_UNAVAILABLE",
    "DEPENDENCY_UNAVAILABLE",
    "CONFIGURATION_ERROR"
  ]);
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
    ACTIVE_NATIVE_HTTP_OPERATIONS.some((operation) => operation.path.startsWith("/v1/fhir")),
    false
  );
  assert.equal(getNativeHttpOperation("healthLive").auth, "none");
});
