import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  MetaWebhookBoundary,
  MetaWebhookService,
  MetaWhatsAppError,
  metaWebhookEvidenceSummary,
  signMetaWebhookBytes,
  type MetaEncryptedRawBodyStore,
  type MetaPersistVerifiedInput,
  type MetaWebhookPersistence
} from "../dist/cp15/meta-whatsapp/index.js";

const APP_SECRET = "test-app-secret-at-least-sixteen";
const VERIFY_TOKEN = "test-verify-token-at-least-sixteen";
const RECEIVED_AT = "2026-07-11T10:01:00.000Z";

test("CP15 Meta challenge requires subscribe mode and constant-time token match", () => {
  const boundary = createBoundary();
  assert.equal(boundary.verifyChallenge({ mode: "subscribe", verifyToken: VERIFY_TOKEN, challenge: "12345" }), "12345");
  assert.throws(() => boundary.verifyChallenge({ mode: "subscribe", verifyToken: "wrong-token-value", challenge: "12345" }), errorCode("invalid_challenge"));
  assert.throws(() => boundary.verifyChallenge({ mode: "other", verifyToken: VERIFY_TOKEN, challenge: "12345" }), errorCode("invalid_challenge"));
});

test("CP15 Meta verifies exact bounded bytes before content-type and JSON parsing", () => {
  const boundary = createBoundary();
  const malformed = Buffer.from("{not-json", "utf8");
  assert.throws(
    () => boundary.verifyAndNormalize(rawInput(malformed, "sha256=" + "0".repeat(64))),
    errorCode("invalid_signature")
  );
  assert.throws(
    () => boundary.verifyAndNormalize(rawInput(malformed, signMetaWebhookBytes(malformed, APP_SECRET))),
    errorCode("invalid_payload")
  );

  const oversizedBoundary = createBoundary(1024);
  const oversized = Buffer.alloc(1025, 0x20);
  assert.throws(
    () => oversizedBoundary.verifyAndNormalize(rawInput(oversized, signMetaWebhookBytes(oversized, APP_SECRET))),
    errorCode("body_too_large")
  );
});

test("CP15 Meta rejects signed smuggling headers and non-JSON content before parsing", () => {
  const bytes = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }), "utf8");
  const signature = signMetaWebhookBytes(bytes, APP_SECRET);
  assert.throws(
    () => createBoundary().verifyAndNormalize({
      ...rawInput(bytes, signature),
      headers: { "content-type": "application/json", "x-hub-signature-256": [signature, signature] }
    }),
    errorCode("invalid_signature")
  );
  assert.throws(
    () => createBoundary().verifyAndNormalize({
      ...rawInput(bytes, signature),
      headers: { "content-type": "text/plain", "x-hub-signature-256": signature }
    }),
    errorCode("invalid_content_type")
  );
});

test("CP15 Meta normalizes inbound, opt-out, service window, status, and template lifecycle with unique keys", () => {
  const bytes = Buffer.from(JSON.stringify(webhookFixture()), "utf8");
  const verified = createBoundary().verifyAndNormalize(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET)));
  assert.equal(verified.events.length, 3);
  const inbound = verified.events.find((event) => event.kind === "inbound_message");
  assert.ok(inbound && inbound.kind === "inbound_message");
  assert.equal(inbound.consentCommand, "opt_out");
  assert.equal(inbound.serviceWindowExpiresAt, "2026-07-12T10:00:00.000Z");
  assert.equal(inbound.uniqueEventKey, "meta:inbound:wamid.inbound.1");

  const status = verified.events.find((event) => event.kind === "message_status");
  assert.ok(status && status.kind === "message_status");
  assert.equal(status.status, "delivered");
  assert.match(status.uniqueEventKey, /^meta:status:[a-f0-9]{64}$/u);

  const template = verified.events.find((event) => event.kind === "template_lifecycle");
  assert.ok(template && template.kind === "template_lifecycle");
  assert.equal(template.lifecycle, "approved");

  const evidence = metaWebhookEvidenceSummary(verified);
  assert.deepEqual(evidence.eventCounts, {
    inbound_message: 1,
    message_status: 1,
    template_lifecycle: 1,
    unsupported_change: 0
  });
  assert.equal(JSON.stringify(evidence).includes("STOP"), false);
  assert.equal(evidence.eventKeyDigests.every((value) => /^[a-f0-9]{64}$/u.test(value)), true);
});

test("CP15 Meta retains unsupported signed changes for reconciliation instead of dropping them", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ id: "100000000000001", changes: [{ field: "future_subscription", value: {} }] }]
  };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const verified = createBoundary().verifyAndNormalize(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET)));
  assert.equal(verified.events.length, 1);
  const event = verified.events[0];
  assert.ok(event && event.kind === "unsupported_change");
  assert.equal(event.reconciliationRequired, true);
  assert.equal(event.field, "future_subscription");
});

test("CP15 Meta rejects impossible future provider timestamps after authenticating", () => {
  const payload = webhookFixture();
  const entry = (payload.entry as Array<Record<string, unknown>>)[0]!;
  const change = (entry.changes as Array<Record<string, unknown>>)[0]!;
  const value = change.value as Record<string, unknown>;
  const message = (value.messages as Array<Record<string, unknown>>)[0]!;
  message.timestamp = "9999999999999999";
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  assert.throws(
    () => createBoundary().verifyAndNormalize(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET))),
    errorCode("invalid_payload")
  );
});

test("CP15 Meta status failures retain safe classification but drop provider error prose", () => {
  const payload = webhookFixture();
  const entry = (payload.entry as Array<Record<string, unknown>>)[0]!;
  const change = (entry.changes as Array<Record<string, unknown>>)[0]!;
  const value = change.value as Record<string, unknown>;
  value.messages = [];
  value.statuses = [{
    id: "wamid.outbound.failed.1",
    status: "failed",
    timestamp: "1783764060",
    recipient_id: "919999999999",
    errors: [{ code: 131026, message: "recipient phone and clinical prose", error_data: { details: "PHI" } }]
  }];
  entry.changes = [change];
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const verified = createBoundary().verifyAndNormalize(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET)));
  const status = verified.events[0];
  assert.ok(status && status.kind === "message_status");
  assert.deepEqual(status.error, { code: "131026", retryable: false, safeCategory: "recipient" });
  assert.equal(JSON.stringify(status).includes("clinical prose"), false);
  assert.equal(JSON.stringify(status).includes("PHI"), false);
});

test("CP15 Meta signs UTF-8 bytes rather than reconstructed JSON text", () => {
  const compact = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");
  const spaced = Buffer.from('{ "object": "whatsapp_business_account", "entry": [] }', "utf8");
  const boundary = createBoundary();
  assert.doesNotThrow(() => boundary.verifyAndNormalize(rawInput(compact, signMetaWebhookBytes(compact, APP_SECRET))));
  assert.throws(() => boundary.verifyAndNormalize(rawInput(spaced, signMetaWebhookBytes(compact, APP_SECRET))), errorCode("invalid_signature"));
});

test("CP15 Meta accepts a bounded previous signing secret only inside its rotation window", () => {
  const previousSecret = "previous-test-app-secret-at-least-sixteen";
  const bytes = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', "utf8");
  const boundary = new MetaWebhookBoundary({
    appSecret: APP_SECRET,
    appSecretVersion: "v2",
    previousAppSecret: previousSecret,
    previousAppSecretVersion: "v1",
    previousAppSecretAcceptUntil: "2026-07-11T10:02:00.000Z",
    verifyToken: VERIFY_TOKEN
  });
  const current = boundary.verifyAndNormalize(
    rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET))
  );
  assert.equal(current.verifiedSecretVersion, "v2");
  assert.equal(current.verifiedWithPreviousSecret, false);
  const previous = boundary.verifyAndNormalize(
    rawInput(bytes, signMetaWebhookBytes(bytes, previousSecret))
  );
  assert.equal(previous.verifiedSecretVersion, "v1");
  assert.equal(previous.verifiedWithPreviousSecret, true);

  const expired = new MetaWebhookBoundary({
    appSecret: APP_SECRET,
    appSecretVersion: "v2",
    previousAppSecret: previousSecret,
    previousAppSecretVersion: "v1",
    previousAppSecretAcceptUntil: "2026-07-11T10:00:00.000Z",
    verifyToken: VERIFY_TOKEN
  });
  assert.throws(
    () => expired.verifyAndNormalize(rawInput(bytes, signMetaWebhookBytes(bytes, previousSecret))),
    errorCode("invalid_signature")
  );
});

test("CP15 service commits verified event, audit, and outbox through one persistence call", async () => {
  const bytes = Buffer.from(JSON.stringify(webhookFixture()), "utf8");
  const writes: MetaPersistVerifiedInput[] = [];
  const store = memoryRawStore();
  const persistence: MetaWebhookPersistence = {
    async persistVerified(input) {
      writes.push(input);
      return { outcome: "committed", rawEventId: input.rawEventId, acceptedEventKeys: input.events.map((event) => event.uniqueEventKey), duplicateEventKeys: [] };
    }
  };
  const service = createService(store, persistence);
  const result = await service.processWebhook(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET)));
  assert.equal(result.outcome, "committed");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.audit.action, "meta_whatsapp.webhook_verified");
  assert.equal(writes[0]?.outbox.topic, "provider.meta_whatsapp.webhook_verified");
  assert.equal(writes[0]?.rawBodySha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(writes[0]?.verifiedWithPreviousSecret, false);
  assert.equal(store.deletes.length, 0);
});

test("CP15 service rejects a signed event routed to the wrong registered account before storage", async () => {
  const payload = webhookFixture();
  (payload.entry as Array<Record<string, unknown>>)[0]!.id = "100000000000099";
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const store = memoryRawStore();
  let persisted = false;
  const service = createService(store, {
    async persistVerified() {
      persisted = true;
      throw new Error("must not persist");
    }
  });
  await assert.rejects(
    () => service.processWebhook(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET))),
    errorCode("account_mismatch")
  );
  assert.equal(persisted, false);
  assert.equal(store.puts, 0);
});

test("CP15 service requests orphan cleanup and returns retryable safe error after transaction failure", async () => {
  const bytes = Buffer.from(JSON.stringify(webhookFixture()), "utf8");
  const store = memoryRawStore();
  const persistence: MetaWebhookPersistence = { async persistVerified() { throw new Error("sensitive database detail"); } };
  const service = createService(store, persistence);
  await assert.rejects(() => service.processWebhook(rawInput(bytes, signMetaWebhookBytes(bytes, APP_SECRET))), (error) => {
    assert.ok(error instanceof MetaWhatsAppError);
    assert.equal(error.code, "persistence_failed");
    assert.equal(error.retryable, true);
    assert.equal(error.message.includes("sensitive"), false);
    return true;
  });
  assert.equal(store.deletes.length, 1);
});

function createBoundary(maxBodyBytes?: number): MetaWebhookBoundary {
  return new MetaWebhookBoundary({ appSecret: APP_SECRET, appSecretVersion: "v1", verifyToken: VERIFY_TOKEN, ...(maxBodyBytes ? { maxBodyBytes } : {}) });
}

function rawInput(bytes: Uint8Array, signature: string) {
  return {
    rawBody: bytes,
    headers: { "content-type": "application/json; charset=utf-8", "x-hub-signature-256": signature },
    receivedAt: RECEIVED_AT,
    correlationId: "corr-cp15-meta-1"
  } as const;
}

function webhookFixture(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "200000000000001" },
              messages: [{ from: "919999999999", id: "wamid.inbound.1", timestamp: "1783764000", type: "text", text: { body: "STOP" } }],
              statuses: [{ id: "wamid.outbound.1", status: "delivered", timestamp: "1783764060", recipient_id: "919999999999" }]
            }
          },
          {
            field: "message_template_status_update",
            value: {
              message_template_id: "300000000000001",
              message_template_name: "appointment_reminder",
              message_template_language: "en_US",
              event: "APPROVED",
              timestamp: "1783764120"
            }
          }
        ]
      }
    ]
  };
}

function memoryRawStore(): MetaEncryptedRawBodyStore & { deletes: string[]; puts: number } {
  const deletes: string[] = [];
  const store = {
    deletes,
    puts: 0,
    async put(input: Parameters<MetaEncryptedRawBodyStore["put"]>[0]) {
      store.puts += 1;
      return { ciphertextRef: `restricted://${input.rawEventId}` };
    },
    async deleteUncommitted(input) { deletes.push(input.ciphertextRef); }
  } satisfies MetaEncryptedRawBodyStore & { deletes: string[]; puts: number };
  return store;
}

function createService(rawBodyStore: MetaEncryptedRawBodyStore, persistence: MetaWebhookPersistence): MetaWebhookService {
  return new MetaWebhookService({
    tenantId: "tenant-1",
    clinicId: "clinic-1",
    externalAccountId: "account-1",
    expectedBusinessAccountId: "100000000000001",
    expectedPhoneNumberId: "200000000000001",
    boundary: createBoundary(),
    rawBodyStore,
    persistence
  });
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof MetaWhatsAppError && error.code === code;
}
