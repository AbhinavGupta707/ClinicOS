import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaTransportError,
  MetaWhatsAppClient,
  MetaWhatsAppError,
  deriveMetaProviderHealth,
  type MetaHttpTransport,
  type MetaTemplateSendInput
} from "../dist/cp15/meta-whatsapp/index.js";

const BASE_INPUT = {
  messageRequestId: "msg-request-1",
  idempotencyKey: "idem-1",
  correlationId: "corr-1",
  recipientPhoneE164: "+919999999999",
  template: { name: "appointment_reminder", languageCode: "en_US" },
  policy: {
    consent: "granted",
    purpose: "appointment",
    mode: "approved_template",
    templateState: "approved",
    now: "2026-07-11T10:00:00.000Z"
  }
} as const;

test("CP15 Meta template request is policy-gated before transport", async () => {
  let calls = 0;
  const client = createClient({ async post() { calls += 1; throw new Error("must not call"); } });
  await assert.rejects(
    () => client.sendApprovedTemplate({ ...BASE_INPUT, policy: { ...BASE_INPUT.policy, consent: "revoked" } }),
    (error) => error instanceof MetaWhatsAppError && error.code === "policy_blocked"
  );
  assert.equal(calls, 0);
});

test("CP15 Meta outbound stays disabled while merely configured", async () => {
  let calls = 0;
  const client = createClient(
    { async post() { calls += 1; throw new Error("must not call"); } },
    "configured"
  );
  await assert.rejects(
    () => client.sendApprovedTemplate(BASE_INPUT),
    (error) => error instanceof MetaWhatsAppError && error.code === "not_configured"
  );
  assert.equal(calls, 0);
});

test("CP15 Meta synchronous success records acceptance only, never sent/delivered/read", async () => {
  let authorization = "";
  const client = createClient({
    async post(input) {
      authorization = input.headers.authorization ?? "";
      const body = JSON.parse(Buffer.from(input.body).toString("utf8")) as Record<string, unknown>;
      assert.equal(body.messaging_product, "whatsapp");
      assert.equal(body.biz_opaque_callback_data, "msg-request-1");
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ messages: [{ id: "wamid.accepted.1" }] }), "utf8") };
    }
  });
  const result = await client.sendApprovedTemplate(BASE_INPUT);
  assert.equal(result.outcome, "accepted_by_provider");
  assert.equal(result.deliveryState, null);
  assert.equal(result.reconciliationRequired, false);
  assert.equal(authorization, "Bearer cp15-test-access-token-secret");
  assert.equal(JSON.stringify(result).includes("access-token"), false);
});

test("CP15 Meta ambiguous dispatch is never automatically retried or called delivered", async () => {
  const client = createClient({ async post() { throw new MetaTransportError("timeout", true); } });
  const result = await client.sendApprovedTemplate(BASE_INPUT);
  assert.equal(result.outcome, "dispatch_ambiguous");
  if (result.outcome === "dispatch_ambiguous") {
    assert.equal(result.retryAutomatically, false);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.deliveryState, null);
  }
});

test("CP15 Meta retries only a transport-confirmed not-dispatched request", async () => {
  const client = createClient({ async post() { throw new MetaTransportError("connection refused", false); } });
  const result = await client.sendApprovedTemplate(BASE_INPUT);
  assert.equal(result.outcome, "not_dispatched");
  if (result.outcome === "not_dispatched") {
    assert.equal(result.retryAutomatically, true);
    assert.equal(result.reconciliationRequired, false);
    assert.equal(result.deliveryState, null);
  }
});

test("CP15 Meta records a definite provider rejection without retry or delivery state", async () => {
  const client = createClient({
    async post() {
      return { status: 400, headers: {}, body: Buffer.from('{"error":{"message":"sensitive"}}', "utf8") };
    }
  });
  const result = await client.sendApprovedTemplate(BASE_INPUT);
  assert.equal(result.outcome, "rejected_by_provider");
  if (result.outcome === "rejected_by_provider") {
    assert.equal(result.providerHttpStatus, 400);
    assert.equal(result.retryAutomatically, false);
    assert.equal(result.deliveryState, null);
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
  }
});

test("CP15 Meta rejects unallowlisted template component fields before transport", async () => {
  let calls = 0;
  const client = createClient({ async post() { calls += 1; throw new Error("must not call"); } });
  const unsafe = {
    ...BASE_INPUT,
    template: {
      ...BASE_INPUT.template,
      components: [{ type: "body", parameters: [], access_token: "leak" }]
    }
  } as unknown as MetaTemplateSendInput;
  await assert.rejects(
    () => client.sendApprovedTemplate(unsafe),
    (error) => error instanceof MetaWhatsAppError && error.code === "policy_blocked"
  );
  assert.equal(calls, 0);
});

test("CP15 Meta provider health distinguishes registration, configuration, and official verification", () => {
  const checkedAt = "2026-07-11T10:00:00.000Z";
  assert.equal(deriveMetaProviderHealth({ enabled: true, registrationPresent: false, credentialsPresent: true, sandboxVerifiedAt: null, productionVerifiedAt: null, degradedReasonCode: null, checkedAt }).activation, "absent");
  assert.equal(deriveMetaProviderHealth({ enabled: true, registrationPresent: true, credentialsPresent: false, sandboxVerifiedAt: null, productionVerifiedAt: null, degradedReasonCode: null, checkedAt }).activation, "registered");
  const configured = deriveMetaProviderHealth({ enabled: true, registrationPresent: true, credentialsPresent: true, sandboxVerifiedAt: null, productionVerifiedAt: null, degradedReasonCode: null, checkedAt });
  assert.equal(configured.activation, "configured");
  assert.equal(configured.operational, false);
  const sandbox = deriveMetaProviderHealth({ enabled: true, registrationPresent: true, credentialsPresent: true, sandboxVerifiedAt: checkedAt, productionVerifiedAt: null, degradedReasonCode: null, checkedAt });
  assert.equal(sandbox.activation, "sandbox_verified");
  assert.equal(sandbox.operational, true);
});

function createClient(
  transport: MetaHttpTransport,
  activationState: "configured" | "sandbox_verified" = "sandbox_verified"
): MetaWhatsAppClient {
  return new MetaWhatsAppClient({
    activationState,
    graphApiVersion: "v23.0",
    phoneNumberId: "123456789012345",
    accessToken: "cp15-test-access-token-secret",
    transport
  });
}
