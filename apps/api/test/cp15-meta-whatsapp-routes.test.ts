import assert from "node:assert/strict";
import test from "node:test";
import { createMetaWhatsAppRoutes } from "../src/features/cp15-meta-whatsapp/index.ts";
import {
  MetaWebhookBoundary,
  MetaWebhookService,
  signMetaWebhookBytes,
  type MetaEncryptedRawBodyStore,
  type MetaWebhookPersistence
} from "../../../packages/integrations/dist/cp15/meta-whatsapp/index.js";

const SECRET = "route-test-app-secret-long-enough";
const VERIFY_TOKEN = "route-test-verify-token-long-enough";
const REGISTRATION_KEY = "registration_key_123456";

test("CP15 Meta API route returns only a verified challenge with no-store", () => {
  const routes = createRoutes();
  const ok = routes.challenge(REGISTRATION_KEY, { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "98765" });
  assert.equal(ok.status, 200);
  assert.equal(Buffer.from(ok.body).toString("utf8"), "98765");
  assert.equal(ok.headers["cache-control"], "no-store");
  const denied = routes.challenge(REGISTRATION_KEY, { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "98765" });
  assert.equal(denied.status, 403);
});

test("CP15 Meta API route bounds raw stream before invoking provider parser", async () => {
  let called = false;
  const routes = createMetaWhatsAppRoutes({
    maxRawBodyBytes: 1024,
    resolveProcessor: () => ({
      verifyChallenge() { return "ok"; },
      async processWebhook() { called = true; return { outcome: "committed", rawEventId: "raw", acceptedEventKeys: [], duplicateEventKeys: [] }; }
    })
  });
  const response = await routes.webhook(request(Buffer.alloc(1025), "sha256=" + "0".repeat(64)));
  assert.equal(response.status, 413);
  assert.equal(called, false);
});

test("CP15 Meta API route diagnoses registration before body or signature handling", async () => {
  let iterated = false;
  async function* unreadBody(): AsyncIterable<Uint8Array> {
    iterated = true;
    yield Buffer.from("{}", "utf8");
  }
  const routes = createMetaWhatsAppRoutes({ resolveProcessor: () => null });
  const response = await routes.webhook({
    ...request(Buffer.from("{}", "utf8"), "sha256=" + "0".repeat(64)),
    registrationKey: "unknown_registration_1234",
    body: unreadBody()
  });
  assert.equal(response.status, 404);
  assert.equal(json(response).error.code, "provider_registration_not_found");
  assert.equal(iterated, false);
});

test("CP15 Meta API route rejects oversized declared length before reading the stream", async () => {
  let iterated = false;
  async function* unreadBody(): AsyncIterable<Uint8Array> {
    iterated = true;
    yield Buffer.from("{}", "utf8");
  }
  const routes = createRoutes();
  const response = await routes.webhook({
    ...request(Buffer.from("{}", "utf8"), "sha256=" + "0".repeat(64)),
    headers: {
      "content-type": "application/json",
      "content-length": String(1024 * 1024 + 1),
      "x-hub-signature-256": "sha256=" + "0".repeat(64)
    },
    body: unreadBody()
  });
  assert.equal(response.status, 413);
  assert.equal(iterated, false);
});

test("CP15 Meta API route maps invalid signature and authenticated malformed JSON distinctly", async () => {
  const routes = createRoutes();
  const malformed = Buffer.from("{bad-json", "utf8");
  const invalid = await routes.webhook(request(malformed, "sha256=" + "0".repeat(64)));
  assert.equal(invalid.status, 401);
  assert.equal(json(invalid).error.code, "invalid_signature");
  const authenticated = await routes.webhook(request(malformed, signMetaWebhookBytes(malformed, SECRET)));
  assert.equal(authenticated.status, 400);
  assert.equal(json(authenticated).error.code, "invalid_payload");
});

test("CP15 Meta API route acknowledges a duplicate only after atomic persistence without exposing volume", async () => {
  let calls = 0;
  const routes = createRoutes({
    async persistVerified(input) {
      calls += 1;
      return { outcome: "duplicate", rawEventId: input.rawEventId, acceptedEventKeys: [], duplicateEventKeys: input.events.map((event) => event.uniqueEventKey) };
    }
  });
  const body = Buffer.from(JSON.stringify(inboundFixture()), "utf8");
  const response = await routes.webhook(request(body, signMetaWebhookBytes(body, SECRET)));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(json(response), { accepted: true });
});

test("CP15 Meta API route returns retryable 503 without internal detail when commit fails", async () => {
  const routes = createRoutes({ async persistVerified() { throw new Error("database password and PHI"); } });
  const body = Buffer.from(JSON.stringify(inboundFixture()), "utf8");
  const response = await routes.webhook(request(body, signMetaWebhookBytes(body, SECRET)));
  assert.equal(response.status, 503);
  assert.deepEqual(json(response), { error: { code: "persistence_failed", retryable: true } });
  assert.equal(Buffer.from(response.body).toString("utf8").includes("password"), false);
});

function createRoutes(persistence: MetaWebhookPersistence = defaultPersistence()) {
  const boundary = new MetaWebhookBoundary({ appSecret: SECRET, appSecretVersion: "v1", verifyToken: VERIFY_TOKEN });
  const rawBodyStore: MetaEncryptedRawBodyStore = {
    async put(input) { return { ciphertextRef: `restricted://${input.rawEventId}` }; },
    async deleteUncommitted() {}
  };
  const service = new MetaWebhookService({
    tenantId: "tenant-1",
    clinicId: "clinic-1",
    externalAccountId: "account-1",
    expectedBusinessAccountId: "100000000000001",
    expectedPhoneNumberId: "200000000000001",
    boundary,
    rawBodyStore,
    persistence
  });
  return createMetaWhatsAppRoutes({
    resolveProcessor: (registrationKey) => registrationKey === REGISTRATION_KEY ? service : null
  });
}

function defaultPersistence(): MetaWebhookPersistence {
  return {
    async persistVerified(input) {
      return { outcome: "committed", rawEventId: input.rawEventId, acceptedEventKeys: input.events.map((event) => event.uniqueEventKey), duplicateEventKeys: [] };
    }
  };
}

function request(body: Uint8Array, signature: string) {
  return {
    registrationKey: REGISTRATION_KEY,
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: chunks(body),
    receivedAt: "2026-07-11T10:01:00.000Z",
    correlationId: "corr-route-test"
  } as const;
}

async function* chunks(body: Uint8Array): AsyncIterable<Uint8Array> {
  const middle = Math.floor(body.byteLength / 2);
  yield body.slice(0, middle);
  yield body.slice(middle);
}

function inboundFixture(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "100000000000001", changes: [{ field: "messages", value: { metadata: { phone_number_id: "200000000000001" }, messages: [{ from: "919999999999", id: "wamid.inbound.route.1", timestamp: "1783764000", type: "text", text: { body: "Hello" } }] } }] }]
  };
}

function json(response: { readonly body: Uint8Array }): any {
  return JSON.parse(Buffer.from(response.body).toString("utf8"));
}
