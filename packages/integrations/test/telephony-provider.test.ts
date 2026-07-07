import assert from "node:assert/strict";
import test from "node:test";
import {
  ExotelTelephonyProvider,
  SimulatorTelephonyProvider,
  createTelephonyProvider,
  signTelephonyWebhook
} from "../dist/index.js";

const webhookSecret = "test_telephony_webhook_secret";
const receivedAt = "2026-07-07T10:30:00.000Z";

test("unconfigured telephony provider exposes honest not_configured gates", async () => {
  const provider = createTelephonyProvider({ provider: "unconfigured" });
  const health = await provider.healthCheck();

  assert.equal(health.status, "not_configured");
  assert.deepEqual(health.capabilities, []);
  assert.match(health.message ?? "", /manual missed-call entry/i);

  await assert.rejects(
    () =>
      provider.parseWebhook({
        providerKey: "unconfigured",
        rawBody: "{}",
        headers: {},
        receivedAt
      }),
    /not configured/
  );
});

test("Exotel stays unavailable until credentials and signed callback registration are present", async () => {
  const missingCredentials = new ExotelTelephonyProvider({});
  const missingHealth = await missingCredentials.healthCheck();
  assert.equal(missingHealth.status, "not_configured");
  assert.match(missingHealth.message ?? "", /TELEPHONY_ACCOUNT_SID/);
  assert.deepEqual(missingHealth.capabilities, []);

  const missingCallback = new ExotelTelephonyProvider({
    accountSid: "clinic_sid",
    apiKey: "api_key",
    apiToken: "api_token",
    virtualNumber: "+918044445555",
    webhookSecret,
    webhookCallbackConfigured: false
  });
  const callbackHealth = await missingCallback.healthCheck();
  assert.equal(callbackHealth.status, "not_configured");
  assert.match(callbackHealth.message ?? "", /callback/i);
  assert.deepEqual(callbackHealth.capabilities, []);

  await assert.rejects(
    () =>
      missingCallback.parseWebhook({
        providerKey: "exotel",
        rawBody: JSON.stringify({ CallSid: "call_1" }),
        headers: {},
        receivedAt
      }),
    /callback registration/
  );
});

test("Exotel-shaped signed status callback normalizes missed calls and redacts recording URLs", async () => {
  const provider = new ExotelTelephonyProvider({
    accountSid: "clinic_sid",
    apiKey: "api_key",
    apiToken: "api_token",
    virtualNumber: "+918044445555",
    webhookSecret,
    webhookCallbackConfigured: true
  });
  const rawBody = JSON.stringify({
    CallSid: "80bfbec2d78bbbf10fb851f4fa165211",
    DateUpdated: "2026-07-07 10:29:45",
    Status: "no-answer",
    RecordingUrl: "https://provider.example.test/raw-recording.mp3?token=secret",
    EventType: "terminal",
    DateCreated: "2026-07-07 10:25:10",
    To: "+918044445555",
    From: "9876543210",
    PhoneNumberSid: "exo_phone_1",
    StartTime: "2026-07-07 10:25:12",
    EndTime: "2026-07-07 10:29:45",
    ConversationDuration: 0,
    Direction: "inbound"
  });
  const raw = {
    providerKey: "exotel",
    rawBody,
    receivedAt,
    headers: {
      "x-clinic-os-telephony-event-id": "evt_exotel_1",
      "x-clinic-os-telephony-signature": signTelephonyWebhook(rawBody, webhookSecret)
    }
  };

  const verification = await provider.verifyWebhook(raw);
  const events = await provider.parseWebhook(raw);
  const missedCall = events.find((event) => event.eventName === "call.missed");
  const recordingEvent = events.find((event) => event.eventName === "call.recording.available");

  assert.equal(verification.status, "verified");
  assert.equal(missedCall?.providerCallId, "80bfbec2d78bbbf10fb851f4fa165211");
  assert.equal(missedCall?.callerNumber, "9876543210");
  assert.equal(missedCall?.calledNumber, "+918044445555");
  assert.equal(missedCall?.source.sourceType, "phone");
  assert.equal(missedCall?.source.externalSystemId, "exotel");
  assert.equal(recordingEvent?.recording.availability, "available");
  assert.equal(recordingEvent?.recording.accessPolicy, "requires_call_recording_permission");
  assert.equal(recordingEvent?.recording.rawProviderUrlExposed, false);
  assert.equal(recordingEvent?.recording.rawProviderUrlSha256?.length, 64);
  assert.equal(JSON.stringify(events).includes("raw-recording.mp3"), false);
});

test("simulator telephony webhooks must be signed before local contract events are trusted", async () => {
  const provider = new SimulatorTelephonyProvider({ webhookSecret });
  const raw = provider.buildSignedWebhook({
    providerCallId: "call_sim_1",
    callerNumber: "+919876543210",
    calledNumber: "+918044445555",
    eventName: "call.missed",
    status: "no_answer",
    occurredAt: "2026-07-07T10:15:00.000Z",
    providerEventId: "evt_tel_1"
  });

  const verification = await provider.verifyWebhook(raw);
  const events = await provider.parseWebhook(raw);

  assert.equal(verification.status, "verified");
  assert.equal(events[0]?.eventName, "call.missed");
  assert.equal(events[0]?.idempotencyKey, "simulator:call:call_sim_1:call.missed:evt_tel_1");

  const unsigned = await provider.verifyWebhook({
    ...raw,
    headers: {}
  });
  assert.equal(unsigned.status, "missing_signature");
});
