import assert from "node:assert/strict";
import test from "node:test";
import {
  ClinicOsApiClient,
  ClinicOsApiError,
  type CreateLabCaseResponse,
  type UpdateInventoryCheckRunResponse
} from "../src/index.ts";

const patientId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";

test("generated detail response types expose their nested canonical row versions", () => {
  const labResponse: CreateLabCaseResponse = {
    labCase: {
      labCase: { id: patientId, rowVersion: 3 },
      vendor: {},
      items: [],
      statusHistory: []
    }
  };
  const checkRunResponse: UpdateInventoryCheckRunResponse = {
    checkRun: {
      run: { id: patientId, rowVersion: 4 },
      template: {},
      lines: [],
      procurementSuggestions: []
    }
  };
  assert.equal(labResponse.labCase.labCase.rowVersion, 3);
  assert.equal(checkRunResponse.checkRun.run.rowVersion, 4);
});

test("generated client carries auth, clinic, idempotency, strict body, and typed path/query data", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid/",
    clinicId,
    getAccessToken: () => "synthetic-token",
    fetchImpl: (async (url, init) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          patient: { id: patientId, rowVersion: 1 },
          duplicateSuggestions: [],
          matchedLead: null
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-create-patient",
            "idempotency-replayed": "false"
          }
        }
      );
    }) as typeof fetch
  });

  const response = await client.createPatient({
    headers: { "idempotency-key": "idem-create-patient-0001" },
    body: {
      fullName: "Synthetic Patient",
      phone: "+919876543210",
      source: "manual"
    }
  });

  assert.equal(response.patient.id, patientId);
  assert.equal(response.patient.rowVersion, 1);
  assert.equal(captured?.url, "https://clinic-os.invalid/v1/patients");
  assert.equal(
    (captured?.init?.headers as Record<string, string>).authorization,
    "Bearer synthetic-token"
  );
  assert.equal((captured?.init?.headers as Record<string, string>)["x-clinic-id"], clinicId);
  assert.equal(
    (captured?.init?.headers as Record<string, string>)["idempotency-key"],
    "idem-create-patient-0001"
  );
  assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
    fullName: "Synthetic Patient",
    phone: "+919876543210",
    source: "manual"
  });
});

test("generated metadata methods extract strong ETag, request id and replay wire values", async () => {
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid",
    getAccessToken: () => "synthetic-token",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ patient: { id: patientId, rowVersion: 8 } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-update-patient",
          etag: '"rv-8"',
          "idempotency-replayed": "true"
        }
      })) as typeof fetch
  });

  const response = await client.updatePatientWithMetadata({
    path: { patientId },
    headers: {
      "idempotency-key": "idem-update-patient-0001",
      "if-match": '"rv-7"'
    },
    body: { fullName: "Updated Patient" }
  });

  assert.equal(response.body.patient.id, patientId);
  assert.equal(response.body.patient.rowVersion, 8);
  assert.deepEqual(response.metadata, {
    status: 200,
    requestId: "request-update-patient",
    etag: '"rv-8"',
    idempotencyReplayed: true,
    retryAfterSeconds: null
  });
});

test("generated webhook client sends raw bytes with production JSON media type", async () => {
  let captured: RequestInit | undefined;
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid",
    fetchImpl: (async (_url, init) => {
      captured = init;
      return new Response(
        JSON.stringify({
          status: "processed",
          replayed: false,
          invoice: null,
          transaction: null,
          reconciliationItem: null,
          providerEvent: { id: patientId }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "request-webhook" }
        }
      );
    }) as typeof fetch
  });
  const rawBody = new TextEncoder().encode('{"event":"payment.captured"}');

  await client.receiveRazorpayPaymentWebhook({
    path: { registrationKey: "synthetic_registration_key_0001" },
    headers: {
      "x-razorpay-signature": "synthetic-signature-value",
      "x-razorpay-event-id": "evt_synthetic_0001"
    },
    body: rawBody
  });

  assert.equal((captured?.headers as Record<string, string>)["content-type"], "application/json");
  assert.notEqual(captured?.body, rawBody);
  assert.deepEqual(captured?.body, rawBody);
});

test("generated health client returns the declared unavailable health response", async () => {
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          status: "unavailable",
          service: "clinic-os-api",
          repository_mode: "postgres",
          auth_mode: "keycloak_jwks",
          evidence_tier: "E3_durable",
          dependencies: [],
          request_id: "req-health"
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      )) as typeof fetch
  });

  const response = await client.healthReady();
  assert.equal(response.status, "unavailable");
});

test("generated client maps stable API error envelopes", async () => {
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid",
    getAccessToken: () => "synthetic-token",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "PERMISSION_DENIED",
            message: "Denied.",
            details: {},
            request_id: "req-denied"
          }
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )) as typeof fetch
  });

  await assert.rejects(
    () => client.getPatient({ path: { patientId } }),
    (error: unknown) =>
      error instanceof ClinicOsApiError &&
      error.status === 403 &&
      error.code === "PERMISSION_DENIED" &&
      error.requestId === "req-denied"
  );
});

test("generated API errors expose bounded Retry-After delta-seconds", async () => {
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid",
    getAccessToken: () => "synthetic-token",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Retry later.",
            details: {},
            request_id: "request-rate-limited"
          }
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-rate-limited",
            "retry-after": "120"
          }
        }
      )) as typeof fetch
  });

  await assert.rejects(
    () => client.getPatient({ path: { patientId } }),
    (error: unknown) =>
      error instanceof ClinicOsApiError &&
      error.responseMetadata.requestId === "request-rate-limited" &&
      error.responseMetadata.retryAfterSeconds === 120
  );
});
