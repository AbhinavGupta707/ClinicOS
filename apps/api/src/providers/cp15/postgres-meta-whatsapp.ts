import { createHash, createHmac, randomUUID } from "node:crypto";
import type { SqlQueryClient } from "@clinic-os/db";
import { buildSetLocalRlsStatements } from "@clinic-os/db";
import { decideMetaStatusTransition, type UUID } from "@clinic-os/domain";
import type {
  MetaNormalizedEvent,
  MetaPersistVerifiedInput,
  MetaPersistVerifiedResult,
  MetaWebhookPersistence
} from "@clinic-os/integrations";

interface ProviderUnitOfWork {
  run<T>(callback: (context: { readonly sqlClient?: SqlQueryClient }) => Promise<T>): Promise<T>;
}

interface RawEventRow {
  id: string;
  raw_body_sha256: string | null;
  signature_sha256: string | null;
  normalized_event_sha256: string | null;
  verified_secret_version: string | null;
  verified_with_previous_secret: boolean;
  raw_body_length: number | null;
}

interface IdRow {
  id: string;
}

interface OutboundRow {
  id: string;
  state: "send_requested" | "accepted_by_provider" | "sent" | "delivered" | "read" | "failed";
}

const SYSTEM_ACTOR_ID = "clinic-os:meta-whatsapp";

export class PostgresMetaWebhookPersistence implements MetaWebhookPersistence {
  readonly #unitOfWork: ProviderUnitOfWork;
  readonly #endpointHmacSecret: Buffer;

  constructor(input: {
    readonly unitOfWork: ProviderUnitOfWork;
    readonly endpointHmacSecret: Uint8Array;
  }) {
    if (input.endpointHmacSecret.byteLength < 32) {
      throw new Error("Meta endpoint HMAC secret must contain at least 32 bytes.");
    }
    this.#unitOfWork = input.unitOfWork;
    this.#endpointHmacSecret = Buffer.from(input.endpointHmacSecret);
  }

  async persistVerified(input: MetaPersistVerifiedInput): Promise<MetaPersistVerifiedResult> {
    return this.#unitOfWork.run(async ({ sqlClient }) => {
      if (!sqlClient)
        throw new Error("Meta webhook persistence requires a transaction-bound SQL client.");
      await setScope(sqlClient, input.tenantId as UUID, input.clinicId as UUID);
      const existing = await sqlClient.query<RawEventRow>(
        `select id, raw_body_sha256, signature_sha256, normalized_event_sha256,
                verified_secret_version, verified_with_previous_secret, raw_body_length
           from raw_webhook_events
          where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
            and idempotency_key = $4
          for update`,
        [input.tenantId, input.clinicId, input.externalAccountId, input.rawEventId]
      );
      const prior = existing.rows[0];
      if (prior) {
        assertMatchingEvidence(prior, input);
        await recordVerifiedProviderCallback(sqlClient, {
          tenantId: input.tenantId,
          clinicId: input.clinicId,
          externalAccountId: input.externalAccountId,
          receivedAt: input.receivedAt
        });
        return {
          outcome: "duplicate",
          rawEventId: input.rawEventId,
          acceptedEventKeys: [],
          duplicateEventKeys: input.events.map((event) => event.uniqueEventKey)
        };
      }

      const raw = await sqlClient.query<IdRow>(
        `insert into raw_webhook_events (
           tenant_id, clinic_id, provider_key, external_account_id, event_type,
           provider_event_id, idempotency_key, verification_status, processing_status,
           raw_payload, raw_payload_digest, received_at, processed_at,
           event_kind, raw_body_sha256, signature_sha256, normalized_event_sha256,
           normalized_event, evidence_state, verified_secret_version,
           verified_with_previous_secret, raw_body_length
         ) values (
           $1, $2, 'meta_whatsapp_cloud', $3, 'webhook_batch',
           $4, $4, 'verified', 'verified',
           $5::jsonb, $6::text, $7::timestamptz, null,
           'webhook_batch', $6::char(64), $8::char(64), $9::char(64),
           $10::jsonb, 'verified', $11, $12, $13
         ) returning id`,
        [
          input.tenantId,
          input.clinicId,
          input.externalAccountId,
          input.rawEventId,
          JSON.stringify({
            ciphertext_ref: input.rawBodyCiphertextRef,
            digest: input.rawBodySha256,
            byte_length: input.rawBodyByteLength,
            retention_class: "provider_webhook_restricted"
          }),
          input.rawBodySha256,
          input.receivedAt,
          input.signatureSha256,
          input.normalizedEventSha256,
          JSON.stringify({ digest: input.normalizedEventSha256, event_count: input.events.length }),
          input.verifiedSecretVersion,
          input.verifiedWithPreviousSecret,
          input.rawBodyByteLength
        ]
      );
      const rawDatabaseId = requiredId(raw.rows[0]);
      const auditId = randomUUID();
      const outboxId = randomUUID();
      await insertAudit(sqlClient, {
        id: auditId,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        externalAccountId: input.externalAccountId,
        action: input.audit.action,
        resourceType: "provider_webhook",
        resourceId: rawDatabaseId,
        correlationId: input.correlationId,
        occurredAt: input.receivedAt,
        metadata: {
          outcome: input.audit.outcome,
          event_count: input.audit.eventCount,
          raw_body_sha256: input.rawBodySha256
        },
        phiInvolved: input.events.some((event) => event.eventType === "inbound_message")
      });
      await insertOutbox(sqlClient, {
        id: outboxId,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        externalAccountId: input.externalAccountId,
        eventType: input.outbox.topic,
        aggregateType: "provider_event",
        aggregateId: rawDatabaseId,
        idempotencyKey: input.outbox.idempotencyKey,
        correlationId: input.correlationId,
        occurredAt: input.receivedAt,
        payload: {
          provider: "meta_whatsapp_cloud",
          raw_body_sha256: input.rawBodySha256,
          event_count: input.events.length
        }
      });
      const commit = await sqlClient.query<IdRow>(
        `insert into meta_whatsapp_webhook_commits (
           tenant_id, clinic_id, external_account_id, raw_event_id,
           raw_body_digest, raw_body_ciphertext_ref, raw_body_byte_length,
           audit_event_id, outbox_event_id, correlation_id, received_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)
         returning id`,
        [
          input.tenantId,
          input.clinicId,
          input.externalAccountId,
          rawDatabaseId,
          input.rawBodySha256,
          input.rawBodyCiphertextRef,
          input.rawBodyByteLength,
          auditId,
          outboxId,
          input.correlationId,
          input.receivedAt
        ]
      );
      const commitId = requiredId(commit.rows[0]);
      const acceptedEventKeys: string[] = [];
      const duplicateEventKeys: string[] = [];
      for (const event of input.events) {
        const existingReceipt = await sqlClient.query<IdRow>(
          `select id from meta_whatsapp_event_receipts
            where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
              and unique_event_key = $4`,
          [input.tenantId, input.clinicId, input.externalAccountId, event.uniqueEventKey]
        );
        if (existingReceipt.rows[0]) {
          duplicateEventKeys.push(event.uniqueEventKey);
          continue;
        }
        const normalized = await sqlClient.query<IdRow>(
          `insert into normalized_integration_events (
             tenant_id, clinic_id, raw_event_id, event_type, normalized_payload, status
           ) values ($1,$2,$3,$4,$5::jsonb,'normalized') returning id`,
          [
            input.tenantId,
            input.clinicId,
            rawDatabaseId,
            event.eventType,
            JSON.stringify(event.payload)
          ]
        );
        const normalizedId = requiredId(normalized.rows[0]);
        const receipt = await sqlClient.query<IdRow>(
          `insert into meta_whatsapp_event_receipts (
             tenant_id, clinic_id, external_account_id, webhook_commit_id,
             normalized_event_id, unique_event_key, event_kind, provider_occurred_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) returning id`,
          [
            input.tenantId,
            input.clinicId,
            input.externalAccountId,
            commitId,
            normalizedId,
            event.uniqueEventKey,
            event.eventType,
            event.occurredAt
          ]
        );
        const receiptId = requiredId(receipt.rows[0]);
        const outcome = await applyNormalizedEvent(sqlClient, {
          tenantId: input.tenantId,
          clinicId: input.clinicId,
          externalAccountId: input.externalAccountId,
          correlationId: input.correlationId,
          receiptId,
          normalizedId,
          event: event.payload,
          endpointHmacSecret: this.#endpointHmacSecret
        });
        await sqlClient.query(
          `update meta_whatsapp_event_receipts
              set application_outcome = $4, applied_at = $5::timestamptz
            where tenant_id = $1 and clinic_id = $2 and id = $3`,
          [input.tenantId, input.clinicId, receiptId, outcome, event.occurredAt]
        );
        await sqlClient.query(
          `update normalized_integration_events set status = 'applied'
            where tenant_id = $1 and clinic_id = $2 and id = $3`,
          [input.tenantId, input.clinicId, normalizedId]
        );
        acceptedEventKeys.push(event.uniqueEventKey);
      }
      const resultProjection = {
        status: "applied",
        provider_event_id: input.rawEventId,
        accepted_event_key_digests: acceptedEventKeys.map(sha256Text),
        duplicate_event_key_digests: duplicateEventKeys.map(sha256Text)
      };
      await sqlClient.query(
        `update raw_webhook_events
            set processing_status = 'applied', evidence_state = 'applied',
                processed_at = $5::timestamptz, lease_owner = null, lease_expires_at = null,
                result_digest = $6, result_projection = $7::jsonb
          where tenant_id = $1 and clinic_id = $2 and external_account_id = $3 and id = $4`,
        [
          input.tenantId,
          input.clinicId,
          input.externalAccountId,
          rawDatabaseId,
          input.receivedAt,
          sha256Text(canonicalJson(resultProjection)),
          JSON.stringify(resultProjection)
        ]
      );
      await recordVerifiedProviderCallback(sqlClient, {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        externalAccountId: input.externalAccountId,
        receivedAt: input.receivedAt
      });
      return {
        outcome: "committed",
        rawEventId: input.rawEventId,
        acceptedEventKeys,
        duplicateEventKeys
      };
    });
  }
}

async function recordVerifiedProviderCallback(
  client: SqlQueryClient,
  input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly receivedAt: string;
  }
): Promise<void> {
  const updated = await client.query<IdRow>(
    `update provider_callback_registrations
        set last_verified_callback_at = case
              when last_verified_callback_at is null
                or last_verified_callback_at < $4::timestamptz
              then $4::timestamptz
              else last_verified_callback_at
            end,
            last_health_check_at = case
              when last_health_check_at is null or last_health_check_at < $4::timestamptz
              then $4::timestamptz
              else last_health_check_at
            end,
            last_failure_code = null,
            row_version = row_version + 1
      where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
        and provider_key = 'meta_whatsapp_cloud'
      returning id`,
    [input.tenantId, input.clinicId, input.externalAccountId, input.receivedAt]
  );
  if (updated.rows.length !== 1) {
    throw new Error("Verified Meta callback has no unique durable provider registration.");
  }
}

async function applyNormalizedEvent(
  client: SqlQueryClient,
  input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly correlationId: string;
    readonly receiptId: string;
    readonly normalizedId: string;
    readonly event: MetaNormalizedEvent;
    readonly endpointHmacSecret: Buffer;
  }
): Promise<"applied" | "duplicate" | "ignored_stale" | "reconciliation_scheduled"> {
  const event = input.event;
  if (event.kind === "inbound_message") {
    const endpointHmac = createHmac("sha256", input.endpointHmacSecret)
      .update(event.senderWaId, "utf8")
      .digest("hex");
    await client.query(
      `insert into meta_whatsapp_service_windows (
         tenant_id, clinic_id, external_account_id, recipient_endpoint_hmac,
         opened_by_event_receipt_id, opened_at, expires_at
       ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)`,
      [
        input.tenantId,
        input.clinicId,
        input.externalAccountId,
        endpointHmac,
        input.receiptId,
        event.occurredAt,
        event.serviceWindowExpiresAt
      ]
    );
    if (event.consentCommand !== "none") {
      await recordConsentCommand(client, {
        ...input,
        endpointHmac,
        command: event.consentCommand,
        occurredAt: event.occurredAt,
        senderWaId: event.senderWaId
      });
    }
    return "applied";
  }
  if (event.kind === "message_status") {
    const outbound = await client.query<OutboundRow>(
      `select id, state from meta_whatsapp_outbound_messages
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
          and provider_message_id = $4 for update`,
      [input.tenantId, input.clinicId, input.externalAccountId, event.providerMessageId]
    );
    const message = outbound.rows[0];
    if (!message) {
      await scheduleMetaReconciliation(client, input, "webhook_gap", null);
      return "reconciliation_scheduled";
    }
    const transition = decideMetaStatusTransition(message.state, event.status);
    if (transition.decision === "duplicate") return "duplicate";
    if (transition.decision === "ignore_stale") return "ignored_stale";
    if (transition.decision === "reconcile") {
      await scheduleMetaReconciliation(
        client,
        input,
        transition.reason === "unknown_provider_status"
          ? "unknown_status"
          : "conflicting_terminal_status",
        message.id
      );
      return "reconciliation_scheduled";
    }
    const timestampColumn =
      transition.next === "sent"
        ? "sent_at"
        : transition.next === "delivered"
          ? "delivered_at"
          : transition.next === "read"
            ? "read_at"
            : transition.next === "failed"
              ? "failed_at"
              : null;
    if (!timestampColumn) throw new Error("Signed Meta status cannot move to an inferred state.");
    await client.query(
      `update meta_whatsapp_outbound_messages
          set state = $5, ${timestampColumn} = coalesce(${timestampColumn}, $6::timestamptz),
              failure_category = case when $5 = 'failed' then $7 else failure_category end
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3 and id = $4`,
      [
        input.tenantId,
        input.clinicId,
        input.externalAccountId,
        message.id,
        transition.next,
        event.occurredAt,
        event.error?.safeCategory ?? null
      ]
    );
    return "applied";
  }
  if (event.kind === "template_lifecycle") {
    await client.query(
      `insert into meta_whatsapp_template_snapshots (
         tenant_id, clinic_id, external_account_id, provider_template_id,
         template_name, language_code, lifecycle_state, last_event_receipt_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (tenant_id, clinic_id, external_account_id, provider_template_id, language_code)
       do update set lifecycle_state = excluded.lifecycle_state,
                     last_event_receipt_id = excluded.last_event_receipt_id,
                     row_version = meta_whatsapp_template_snapshots.row_version + 1,
                     updated_at = now()`,
      [
        input.tenantId,
        input.clinicId,
        input.externalAccountId,
        event.providerTemplateId,
        event.templateName,
        event.languageCode,
        event.lifecycle,
        input.receiptId
      ]
    );
    return "applied";
  }
  await scheduleMetaReconciliation(client, input, "unsupported_change", null);
  return "reconciliation_scheduled";
}

async function recordConsentCommand(
  client: SqlQueryClient,
  input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly correlationId: string;
    readonly receiptId: string;
    readonly endpointHmac: string;
    readonly command: "opt_out" | "opt_in_request";
    readonly occurredAt: string;
    readonly senderWaId: string;
  }
): Promise<void> {
  const patients = await client.query<{ patient_id: string }>(
    `select distinct patient_id from patient_contacts
      where tenant_id = $1 and clinic_id = $2
        and contact_type in ('phone','whatsapp','guardian_phone')
        and regexp_replace(normalized_value, '[^0-9]', '', 'g') = $3
      limit 2`,
    [input.tenantId, input.clinicId, input.senderWaId]
  );
  const patientId = patients.rows.length === 1 ? patients.rows[0]!.patient_id : null;
  let affectedConsentId: string | null = null;
  let outcome:
    "consent_revoked" | "already_revoked" | "no_active_consent" | "manual_review_required" =
    "manual_review_required";
  if (input.command === "opt_out" && patientId) {
    const active = await client.query<IdRow>(
      `select id from consents
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
          and purpose = 'whatsapp_communication' and status = 'active'
        for update`,
      [input.tenantId, input.clinicId, patientId]
    );
    affectedConsentId = active.rows[0]?.id ?? null;
    if (affectedConsentId) {
      await client.query(
        `update consents set status = 'revoked', revoked_at = $4::timestamptz,
             revoked_by_actor_type = 'integration', revoked_by_actor_id = $5,
             revocation_reason = 'signed_meta_whatsapp_opt_out'
          where tenant_id = $1 and clinic_id = $2 and id = $3`,
        [
          input.tenantId,
          input.clinicId,
          affectedConsentId,
          input.occurredAt,
          input.externalAccountId
        ]
      );
      outcome = "consent_revoked";
    } else {
      const revoked = await client.query<IdRow>(
        `select id from consents
          where tenant_id = $1 and clinic_id = $2 and patient_id = $3
            and purpose = 'whatsapp_communication' and status = 'revoked'
          order by created_at desc limit 1`,
        [input.tenantId, input.clinicId, patientId]
      );
      affectedConsentId = revoked.rows[0]?.id ?? null;
      outcome = affectedConsentId ? "already_revoked" : "no_active_consent";
    }
  }
  const auditId = randomUUID();
  const outboxId = randomUUID();
  await insertAudit(client, {
    id: auditId,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    externalAccountId: input.externalAccountId,
    action: "meta_whatsapp.consent_command_applied",
    resourceType: "consent",
    resourceId: affectedConsentId ?? input.receiptId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    metadata: { command: input.command, outcome },
    phiInvolved: true
  });
  await insertOutbox(client, {
    id: outboxId,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    externalAccountId: input.externalAccountId,
    eventType: "provider.meta_whatsapp.consent_command",
    aggregateType: affectedConsentId ? "consent" : "provider_event",
    aggregateId: affectedConsentId ?? input.receiptId,
    idempotencyKey: `meta:consent:${input.receiptId}`,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    payload: { command: input.command, outcome, patient_matched: patientId !== null }
  });
  await client.query(
    `insert into meta_whatsapp_consent_commands (
       tenant_id, clinic_id, patient_id, event_receipt_id, recipient_endpoint_hmac,
       command, outcome, affected_consent_id, audit_event_id, outbox_event_id, occurred_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
    [
      input.tenantId,
      input.clinicId,
      patientId,
      input.receiptId,
      input.endpointHmac,
      input.command,
      outcome,
      affectedConsentId,
      auditId,
      outboxId,
      input.occurredAt
    ]
  );
}

async function scheduleMetaReconciliation(
  client: SqlQueryClient,
  input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly receiptId: string;
  },
  reason: "unknown_status" | "conflicting_terminal_status" | "webhook_gap" | "unsupported_change",
  outboundMessageId: string | null
): Promise<void> {
  await client.query(
    `insert into meta_whatsapp_reconciliation_jobs (
       tenant_id, clinic_id, external_account_id, outbound_message_id,
       event_receipt_id, reason, status, next_attempt_at
     ) values ($1,$2,$3,$4,$5,$6,'pending',now())
     on conflict do nothing`,
    [
      input.tenantId,
      input.clinicId,
      input.externalAccountId,
      outboundMessageId,
      outboundMessageId ? null : input.receiptId,
      reason
    ]
  );
}

async function insertAudit(
  client: SqlQueryClient,
  input: {
    readonly id: string;
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly correlationId: string;
    readonly occurredAt: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly phiInvolved: boolean;
  }
): Promise<void> {
  await client.query(
    `insert into audit_events (
       id, tenant_id, clinic_id, actor_type, actor_id, action, category,
       risk_level, phi_involved, resource_type, resource_id, correlation_id,
       metadata, occurred_at
     ) values ($1,$2,$3,'integration',$4,$5,'integration','medium',$6,$7,$8,$9,$10::jsonb,$11::timestamptz)`,
    [
      input.id,
      input.tenantId,
      input.clinicId,
      input.externalAccountId,
      input.action,
      input.phiInvolved,
      input.resourceType,
      input.resourceId,
      input.correlationId,
      JSON.stringify(input.metadata),
      input.occurredAt
    ]
  );
}

async function insertOutbox(
  client: SqlQueryClient,
  input: {
    readonly id: string;
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly occurredAt: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }
): Promise<void> {
  await client.query(
    `insert into outbox_events (
       id, tenant_id, clinic_id, event_type, actor_type, actor_id,
       aggregate_type, aggregate_id, idempotency_key, correlation_id,
       payload, occurred_at
     ) values ($1,$2,$3,$4,'integration',$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz)`,
    [
      input.id,
      input.tenantId,
      input.clinicId,
      input.eventType,
      input.externalAccountId,
      input.aggregateType,
      input.aggregateId,
      input.idempotencyKey,
      input.correlationId,
      JSON.stringify(input.payload),
      input.occurredAt
    ]
  );
}

async function setScope(client: SqlQueryClient, tenantId: UUID, clinicId: UUID): Promise<void> {
  for (const statement of buildSetLocalRlsStatements({ tenantId, clinicId, userId: null })) {
    await client.query(statement.sql, statement.values);
  }
}

function assertMatchingEvidence(row: RawEventRow, input: MetaPersistVerifiedInput): void {
  if (
    row.raw_body_sha256 !== input.rawBodySha256 ||
    row.signature_sha256 !== input.signatureSha256 ||
    row.normalized_event_sha256 !== input.normalizedEventSha256 ||
    row.verified_secret_version !== input.verifiedSecretVersion ||
    row.verified_with_previous_secret !== input.verifiedWithPreviousSecret ||
    row.raw_body_length !== input.rawBodyByteLength
  ) {
    throw new Error("Duplicate Meta provider event conflicts with durable verification evidence.");
  }
}

function requiredId(row: IdRow | undefined): string {
  if (!row || !/^[0-9a-f-]{36}$/iu.test(row.id)) throw new Error("Database did not return a UUID.");
  return row.id;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}
