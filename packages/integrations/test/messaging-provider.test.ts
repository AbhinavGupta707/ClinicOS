import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaWhatsAppCloudProvider,
  MessagingProviderError,
  createMessagingProvider,
  signMetaWebhook,
  type MessagingPurpose,
  type MessagingProviderFetch
} from "../dist/index.js";

const appSecret = "meta_app_secret_for_tests";
const now = () => new Date("2026-07-07T10:00:00.000Z");

test("Meta WhatsApp health reports not_configured when API keys are missing", async () => {
  const provider = new MetaWhatsAppCloudProvider({
    webhookVerifyToken: "verify-token",
    appSecret,
    now
  });

  const health = await provider.healthCheck();
  assert.equal(health.status, "not_configured");
  assert.deepEqual(health.capabilities, []);
  assert.match(health.message ?? "", /WHATSAPP_ACCESS_TOKEN/);
});

test("Meta WhatsApp health is unavailable when signed webhook verification is required without app secret", async () => {
  const provider = new MetaWhatsAppCloudProvider({
    accessToken: "token",
    businessAccountId: "waba_1",
    phoneNumberId: "phone_1",
    webhookVerifyToken: "verify-token",
    signatureVerificationRequired: true,
    now
  });

  const health = await provider.healthCheck();
  assert.equal(health.status, "unavailable");
  assert.equal(health.capabilities.includes("VERIFY_WEBHOOKS"), false);
});

test("Meta WhatsApp template send uses official messages endpoint with injectable fetch", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  const fetch: MessagingProviderFetch = async (url, init) => {
    calls.push({
      url,
      body: JSON.parse(init.body ?? "{}"),
      auth: init.headers.authorization
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          messaging_product: "whatsapp",
          contacts: [{ input: "919876543210", wa_id: "919876543210" }],
          messages: [{ id: "wamid.outbound.1", message_status: "accepted" }]
        };
      },
      async text() {
        return "";
      }
    };
  };
  const provider = configuredProvider({ fetch });

  const result = await provider.sendTemplateMessage({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    messageRequestId: "msg_req_1",
    recipient: optedInRecipient(),
    template: {
      name: "appointment_confirmation",
      languageCode: "en",
      category: "utility",
      lifecycleState: "approved",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: "Rhea" }]
        }
      ]
    },
    policy: businessInitiatedPolicy("appointment_confirmation"),
    idempotencyKey: "idem-msg-1",
    correlationId: "corr-msg-1"
  });

  assert.equal(result.providerMessageId, "wamid.outbound.1");
  assert.equal(result.status, "sent_to_provider");
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/phone_1/messages");
  assert.equal(calls[0].auth, "Bearer token");
  assert.equal(calls[0].body.messaging_product, "whatsapp");
  assert.equal(calls[0].body.to, "919876543210");
  assert.equal(calls[0].body.type, "template");
  assert.deepEqual((calls[0].body.template as Record<string, unknown>).language, { code: "en" });
  assert.match(String(calls[0].body.biz_opaque_callback_data), /msg_req_1/);
});

test("Meta WhatsApp live calls are disabled unless explicit option or injected fetch is used", async () => {
  const provider = configuredProvider();

  await assert.rejects(
    () =>
      provider.sendTemplateMessage({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        messageRequestId: "msg_req_1",
        recipient: optedInRecipient(),
        template: {
          name: "appointment_confirmation",
          languageCode: "en",
          category: "utility",
          lifecycleState: "approved"
        },
        policy: businessInitiatedPolicy("appointment_confirmation"),
        idempotencyKey: "idem-msg-1",
        correlationId: "corr-msg-1"
      }),
    (error) => error instanceof MessagingProviderError && error.status === "live_api_disabled"
  );
});

test("provider boundary blocks opted-out non-essential WhatsApp messages before fetch", async () => {
  let called = false;
  const fetch: MessagingProviderFetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };
  const provider = configuredProvider({ fetch });

  await assert.rejects(
    () =>
      provider.sendTemplateMessage({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        messageRequestId: "msg_req_1",
        recipient: {
          ...optedInRecipient(),
          consent: { whatsapp: "opted_out", optedOutAt: "2026-07-06T08:00:00.000Z" }
        },
        template: {
          name: "six_month_recall",
          languageCode: "en",
          category: "utility",
          lifecycleState: "approved"
        },
        policy: businessInitiatedPolicy("recall"),
        idempotencyKey: "idem-recall-1",
        correlationId: "corr-recall-1"
      }),
    (error) => error instanceof MessagingProviderError && error.status === "policy_blocked"
  );
  assert.equal(called, false);
});

test("freeform WhatsApp messages require an open customer service window", async () => {
  const provider = configuredProvider({
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { contacts: [{ wa_id: "919876543210" }], messages: [{ id: "wamid.freeform.1" }] };
      },
      async text() {
        return "";
      }
    })
  });

  await assert.rejects(
    () =>
      provider.sendFreeformMessage({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        messageRequestId: "msg_req_2",
        recipient: optedInRecipient(),
        body: "We can help with that appointment.",
        policy: {
          purpose: "human_reply",
          containsPhi: false,
          businessInitiated: false,
          conversationWindowExpiresAt: "2026-07-07T09:59:00.000Z"
        },
        idempotencyKey: "idem-freeform-1",
        correlationId: "corr-freeform-1"
      }),
    (error) =>
      error instanceof MessagingProviderError && error.status === "conversation_window_closed"
  );
});

test("Meta webhook challenge verification returns challenge only for matching verify token", async () => {
  const provider = configuredProvider();

  const ok = await provider.verifyWebhookChallenge({
    mode: "subscribe",
    verifyToken: "verify-token",
    challenge: "hub-challenge"
  });
  assert.equal(ok.status, "verified");
  assert.equal(ok.challenge, "hub-challenge");

  const rejected = await provider.verifyWebhookChallenge({
    mode: "subscribe",
    verifyToken: "wrong",
    challenge: "hub-challenge"
  });
  assert.equal(rejected.status, "invalid_token");
  assert.equal(rejected.challenge, null);
});

test("Meta webhook verification uses x-hub-signature-256 over raw body", async () => {
  const provider = configuredProvider();
  const rawBody = JSON.stringify(whatsAppWebhookFixture());
  const signature = signMetaWebhook(rawBody, appSecret);

  const verified = await provider.verifyWebhook({
    rawBody,
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: { "x-hub-signature-256": signature }
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.rawBodySha256.length, 64);

  const tampered = await provider.verifyWebhook({
    rawBody: rawBody.replace("wamid.inbound.1", "wamid.inbound.tampered"),
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: { "x-hub-signature-256": signature }
  });
  assert.equal(tampered.status, "invalid_signature");
});

test("Meta inbound webhook normalization emits idempotency, correlation, and raw payload reference", async () => {
  const provider = configuredProvider();
  const rawBody = JSON.stringify(whatsAppWebhookFixture());
  const inbound = await provider.parseInboundWebhook({
    rawEventId: "raw_whatsapp_1",
    rawBody,
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: { "x-clinic-os-correlation-id": "corr-webhook-1" }
  });

  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].providerMessageId, "wamid.inbound.1");
  assert.equal(inbound[0].idempotencyKey, "whatsapp_cloud:inbound:wamid.inbound.1");
  assert.equal(inbound[0].correlationId, "corr-webhook-1");
  assert.equal(inbound[0].fromPhoneE164, "+919876543210");
  assert.equal(inbound[0].patientDisplayName, "Rhea Synthetic");
  assert.equal(inbound[0].textBody, "Need to reschedule today's appointment.");
  assert.equal(inbound[0].rawPayloadReference.rawEventId, "raw_whatsapp_1");
  assert.equal(inbound[0].rawPayloadReference.rawBodySha256.length, 64);
});

test("Meta status webhook normalization maps delivery/read/failure statuses and failure reasons", async () => {
  const provider = configuredProvider();
  const statuses = await provider.parseStatusWebhook({
    rawEventId: "raw_whatsapp_status_1",
    rawBody: JSON.stringify(whatsAppStatusWebhookFixture()),
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: {}
  });

  assert.equal(statuses.length, 3);
  assert.equal(statuses[0].status, "sent_to_provider");
  assert.equal(statuses[1].status, "read");
  assert.equal(statuses[2].status, "failed");
  assert.equal(statuses[2].failureReason?.code, "131026");
  assert.equal(statuses[2].failureReason?.retryable, false);
  assert.match(statuses[2].idempotencyKey, /wamid.outbound.failed:failed/);
  assert.equal(statuses[2].rawPayloadReference.rawBodySha256.length, 64);
});

test("Meta template lifecycle normalization maps provider statuses", () => {
  const provider = configuredProvider();

  const approved = provider.normalizeTemplate({
    id: "template_1",
    name: "appointment_confirmation",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hi {{1}}, your appointment is confirmed." }]
  });
  assert.equal(approved.lifecycleState, "approved");
  assert.equal(approved.category, "utility");
  assert.equal(approved.components[0].type, "BODY");

  const rejected = provider.normalizeTemplate({
    name: "promo",
    language: "en",
    category: "MARKETING",
    status: "REJECTED",
    rejected_reason: "INVALID_FORMAT"
  });
  assert.equal(rejected.lifecycleState, "rejected");
  assert.equal(rejected.category, "marketing");
  assert.equal(rejected.rejectionReason, "INVALID_FORMAT");
});

test("simulator provider selection is unavailable and cannot send product messages", async () => {
  const provider = createMessagingProvider({ provider: "simulator" });
  const health = await provider.healthCheck();
  assert.equal(health.status, "unavailable");
  assert.deepEqual(health.capabilities, []);
  await assert.rejects(
    () =>
      provider.sendTemplateMessage({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        messageRequestId: "msg_req_1",
        recipient: optedInRecipient(),
        template: {
          name: "appointment_confirmation",
          languageCode: "en",
          category: "utility",
          lifecycleState: "approved"
        },
        policy: businessInitiatedPolicy("appointment_confirmation"),
        idempotencyKey: "idem-msg-1",
        correlationId: "corr-msg-1"
      }),
    (error) => error instanceof MessagingProviderError && error.status === "unavailable"
  );
});

function configuredProvider(
  options: Partial<ConstructorParameters<typeof MetaWhatsAppCloudProvider>[0]> = {}
) {
  return new MetaWhatsAppCloudProvider({
    accessToken: "token",
    businessAccountId: "waba_1",
    phoneNumberId: "phone_1",
    webhookVerifyToken: "verify-token",
    appSecret,
    now,
    ...options
  });
}

function optedInRecipient() {
  return {
    phoneE164: "+91 98765 43210",
    patientId: "10000000-0000-4000-8000-000000000301",
    displayName: "Rhea Synthetic",
    consent: { whatsapp: "opted_in" as const }
  };
}

function businessInitiatedPolicy(purpose: MessagingPurpose = "appointment_confirmation") {
  return {
    purpose,
    containsPhi: false,
    businessInitiated: true
  };
}

function whatsAppWebhookFixture() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: "phone_1"
              },
              contacts: [
                {
                  profile: { name: "Rhea Synthetic" },
                  wa_id: "919876543210"
                }
              ],
              messages: [
                {
                  from: "919876543210",
                  id: "wamid.inbound.1",
                  timestamp: "1783428000",
                  text: { body: "Need to reschedule today's appointment." },
                  type: "text"
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

function whatsAppStatusWebhookFixture() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: "phone_1"
              },
              statuses: [
                {
                  id: "wamid.outbound.sent",
                  status: "sent",
                  timestamp: "1783428001",
                  recipient_id: "919876543210",
                  conversation: { id: "conv_1" },
                  pricing: { category: "utility" }
                },
                {
                  id: "wamid.outbound.read",
                  status: "read",
                  timestamp: "1783428002",
                  recipient_id: "919876543210",
                  conversation: { id: "conv_1" },
                  pricing: { category: "utility" }
                },
                {
                  id: "wamid.outbound.failed",
                  status: "failed",
                  timestamp: "1783428003",
                  recipient_id: "919876543210",
                  errors: [
                    {
                      code: "131026",
                      title: "Message undeliverable",
                      message: "Message was not delivered.",
                      error_data: { details: "Recipient phone number is not a WhatsApp user." }
                    }
                  ]
                }
              ]
            }
          }
        ]
      }
    ]
  };
}
