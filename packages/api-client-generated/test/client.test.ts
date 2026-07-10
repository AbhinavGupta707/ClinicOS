import assert from "node:assert/strict";
import test from "node:test";
import { ClinicOsApiClient, ClinicOsApiError } from "../src/index.ts";

const patientId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";

test("generated client carries auth, clinic, idempotency, strict body, and typed path/query data", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const client = new ClinicOsApiClient({
    baseUrl: "https://clinic-os.invalid/",
    clinicId,
    getAccessToken: () => "synthetic-token",
    fetchImpl: (async (url, init) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({ patient: { id: patientId }, duplicateSuggestions: [], matchedLead: null }),
        {
          status: 201,
          headers: { "content-type": "application/json" }
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

  assert.equal((response.patient as { id?: string }).id, patientId);
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
