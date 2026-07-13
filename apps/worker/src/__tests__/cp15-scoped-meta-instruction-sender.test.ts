import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createScopedMetaInstructionSender } from "../cp15/scoped-meta-instruction-sender.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";
const actorUserId = "10000000-0000-4000-8000-000000000003";
const patientId = "10000000-0000-4000-8000-000000000004";
const instructionId = "10000000-0000-4000-8000-000000000005";
const externalAccountId = "10000000-0000-4000-8000-000000000006";
const outboxEventId = "10000000-0000-4000-8000-000000000007";
const consentId = "10000000-0000-4000-8000-000000000008";

test("CP15 Meta instruction sender binds verified consent/template/account and records acceptance only", async () => {
  const queries: string[] = [];
  let outboundCreated = false;
  let secretRef = "";
  let sendInput: Record<string, unknown> | undefined;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("from meta_whatsapp_outbound_messages") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.includes("from provider_callback_registrations")) {
        return {
          rows: [
            {
              external_account_id: externalAccountId,
              activation_state: "sandbox_verified",
              provider_endpoint_id: "200000000000001",
              api_version: "v23.0",
              api_credential_ref: "clinicos/provider/meta/access-token"
            }
          ]
        };
      }
      if (sql.includes("from patient_instruction_requests instruction")) {
        return {
          rows: [
            {
              patient_id: patientId,
              template_id: "care_instruction_v1",
              body: "Take one synthetic tablet after food.",
              outbox_event_id: outboxEventId,
              phone: "+919999999999",
              consent_evidence_id: consentId,
              consent_template_version: 2,
              template_name: "care_instruction_v1",
              language_code: "en"
            }
          ]
        };
      }
      if (sql.includes("insert into meta_whatsapp_outbound_messages")) {
        outboundCreated = true;
        return { rows: [] };
      }
      if (sql.includes("update meta_whatsapp_outbound_messages") && sql.includes("returning id")) {
        assert.equal(outboundCreated, true);
        return { rows: [{ id: instructionId }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async connect() {
      return client;
    }
  } as unknown as Pool;
  const sender = createScopedMetaInstructionSender({
    pool,
    secrets: {
      async resolveSecret(reference) {
        secretRef = reference;
        return "synthetic-meta-access-token-0001";
      }
    },
    endpointHmacSecret: Buffer.from(
      "synthetic-meta-endpoint-hmac-secret-0000000001",
      "utf8"
    ),
    clientFactory() {
      return {
        async sendApprovedTemplate(input) {
          sendInput = input as unknown as Record<string, unknown>;
          return {
            outcome: "accepted_by_provider",
            providerMessageId: "wamid.synthetic.accepted.1",
            messageRequestId: input.messageRequestId,
            idempotencyKey: input.idempotencyKey,
            correlationId: input.correlationId,
            deliveryState: null,
            reconciliationRequired: false
          };
        }
      };
    },
    now: () => new Date("2026-07-13T08:00:00.000Z")
  });
  const result = await sender.send({
    tenantId,
    clinicId,
    actorUserId,
    patientId,
    instructionId,
    eventId: "10000000-0000-4000-8000-000000000009",
    correlationId: "cp15-meta-send-correlation-0001",
    idempotencyKey: "cp15-meta-send-idempotency-0001",
    requestedAt: "2026-07-13T07:59:59.000Z"
  });
  assert.equal(result.outcome, "requested");
  assert.equal(
    result.outcome === "requested" ? result.providerSubmissionId : null,
    "wamid.synthetic.accepted.1"
  );
  assert.equal(secretRef, "clinicos/provider/meta/access-token");
  assert.equal(sendInput?.recipientPhoneE164, "+919999999999");
  assert.equal(JSON.stringify(result).includes("delivered"), false);
  assert.equal(JSON.stringify(result).includes("read"), false);
  assert.equal(
    queries.some((sql) => sql.includes("recipient_endpoint_hmac")),
    true
  );
});
