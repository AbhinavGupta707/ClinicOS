import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  buildSetLocalRlsStatements,
  createPostgresClinicModuleUnitOfWork,
  prepareCommunicationAppointment,
  CommunicationConflict,
  CommunicationNotFound,
  lockClinicConfiguration,
  type ClinicModuleTransactionContext,
  type RepositoryScope
} from "@clinic-os/db";
import { approvedAppointmentTemplate, systemClock, type UUID } from "@clinic-os/domain";
import {
  MetaWhatsAppClient,
  MetaTemplateReader,
  type MetaTemplateReaderPort,
  type MetaTemplateSendResult,
  type ProviderSecretResolver
} from "@clinic-os/integrations";
import type { OutboxEventHandler, OutboxEventRecord } from "../outbox/types.js";

type Row = Record<string, unknown>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sql = (c: ClinicModuleTransactionContext) => {
  if (!c.sqlClient) throw new Error("Communications require scoped SQL.");
  return c.sqlClient;
};
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
export class CommunicationRetry extends Error {
  constructor() {
    super("Communication dependency is temporarily unavailable; retry durable evidence.");
  }
}
export function createCommunicationHandlers(input: {
  pool: Pool;
  secrets: ProviderSecretResolver;
  endpointHmacSecret: Uint8Array;
  now?: () => Date;
  templateReader?: MetaTemplateReaderPort;
  clientFactory?: (
    o: ConstructorParameters<typeof MetaWhatsAppClient>[0]
  ) => Pick<MetaWhatsAppClient, "sendApprovedTemplate">;
}): OutboxEventHandler[] {
  if (input.endpointHmacSecret.byteLength < 32)
    throw new Error("Endpoint HMAC key must be at least 32 bytes.");
  const now = input.now ?? (() => systemClock.now()),
    reader = input.templateReader ?? new MetaTemplateReader();
  const uow = createPostgresClinicModuleUnitOfWork<RepositoryScope>({
    client: input.pool,
    resolveScope: (s) => s
  });
  const scope = (e: OutboxEventRecord): RepositoryScope => ({
    tenantId: e.tenantId as UUID,
    clinicId: e.clinicId as UUID,
    actorUserId: e.actor.id as UUID
  });
  const run = <T>(e: OutboxEventRecord, fn: (c: ClinicModuleTransactionContext) => Promise<T>) =>
    uow.run(scope(e), async (c) => {
      for (const statement of buildSetLocalRlsStatements({
        tenantId: e.tenantId as UUID,
        clinicId: e.clinicId as UUID,
        userId: e.actor.id as UUID
      }))
        await sql(c).query(statement.sql, statement.values);
      return fn(c);
    });
  const args = (e: OutboxEventRecord) => [e.tenantId, e.clinicId, e.aggregateId];
  async function audit(c: ClinicModuleTransactionContext, e: OutboxEventRecord, outcome: string) {
    const id = randomUUID();
    await c.evidence.appendAuditEvent({
      id,
      action: "communication.dispatch",
      category: "integration",
      riskLevel: "high",
      phiInvolved: true,
      resourceType: "communication",
      resourceId: e.aggregateId as UUID,
      patientId: null,
      metadata: { outcome },
      ipAddress: null,
      userAgent: "clinic-os-worker",
      correlationId: e.correlationId,
      occurredAt: now().toISOString()
    });
    return id;
  }
  const sync: OutboxEventHandler = {
    eventType: "communication.template_sync_requested",
    async handle(e) {
      const source = await run(e, async (c) => {
        const rows = await sql(c).query<Row>(
          `select t.*,d.sync_job_id,r.api_version,r.api_credential_ref,r.activation_state from communication_template_definitions d join meta_whatsapp_template_snapshots t on t.tenant_id=d.tenant_id and t.clinic_id=d.clinic_id and t.id=d.template_id join provider_callback_registrations r on r.tenant_id=t.tenant_id and r.clinic_id=t.clinic_id and r.external_account_id=t.external_account_id and r.provider_key='meta_whatsapp_cloud' where d.tenant_id=$1 and d.clinic_id=$2 and d.sync_job_id=$3 and d.sync_status='queued'`,
          args(e)
        );
        return rows.rows.length === 1 ? rows.rows[0] : null;
      });
      if (!source) return;
      let definition: ReturnType<typeof approvedAppointmentTemplate> = null,
        status = "unsupported";
      try {
        if (!["sandbox_verified", "production_verified"].includes(String(source.activation_state)))
          throw new Error("inactive");
        definition = approvedAppointmentTemplate(
          await reader.read({
            templateId: String(source.provider_template_id),
            apiVersion: String(source.api_version),
            accessToken: await input.secrets.resolveSecret(String(source.api_credential_ref))
          })
        );
        if (
          definition &&
          (definition.id !== source.provider_template_id ||
            definition.name !== source.template_name ||
            definition.language !== source.language_code)
        )
          definition = null;
        status = definition ? "ready" : "unsupported";
      } catch {
        status = "failed";
      }
      await run(e, async (c) => {
        await sql(c).query(
          `update communication_template_definitions d set sync_status=$4,body=$5,definition_digest=$6,snapshot_version=$7,verified_at=$8 where tenant_id=$1 and clinic_id=$2 and sync_job_id=$3 and sync_status='queued'`,
          [
            ...args(e),
            status,
            definition?.body ?? null,
            definition ? digest(definition) : null,
            source.row_version,
            now().toISOString()
          ]
        );
        await audit(c, e, `template_${status}`);
      });
    }
  };
  async function finalize(
    c: ClinicModuleTransactionContext,
    e: OutboxEventRecord,
    outcome: string,
    providerId: string | null,
    code: string | null,
    lease: string
  ) {
    const at = now().toISOString();
    await sql(c).query(
      `select id from communication_requests where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
      args(e)
    );
    const locked = (
      await sql(c).query<Row>(
        `select dispatch_outcome,dispatch_lease_owner from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 for update`,
        args(e)
      )
    ).rows[0];
    if (!locked || locked.dispatch_outcome !== "pending" || locked.dispatch_lease_owner !== lease)
      return;
    await sql(c).query(
      `update meta_whatsapp_outbound_messages set dispatch_outcome=$4,state=case when $4='accepted_by_provider' then 'accepted_by_provider' when $4='rejected' then 'failed' else 'send_requested' end,provider_message_id=$5,accepted_by_provider_at=case when $4='accepted_by_provider' then $6::timestamptz else null end,failed_at=case when $4='rejected' then $6::timestamptz else null end,failure_category=$7,automatic_retry_allowed=($4='not_dispatched'),reconciliation_required=($4='dispatch_ambiguous'),dispatch_lease_owner=null,dispatch_lease_expires_at=null where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 and dispatch_outcome='pending'`,
      [...args(e), outcome, providerId, at, code]
    );
    await sql(c).query(
      `update communication_requests set status=$4,failure_code=$5 where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [
        ...args(e),
        outcome === "accepted_by_provider"
          ? "accepted"
          : outcome === "dispatch_ambiguous"
            ? "ambiguous"
            : outcome,
        code
      ]
    );
    if (outcome === "dispatch_ambiguous")
      await sql(c).query(
        `insert into meta_whatsapp_reconciliation_jobs(tenant_id,clinic_id,external_account_id,outbound_message_id,reason,status,attempt_count,next_attempt_at) select tenant_id,clinic_id,external_account_id,id,'dispatch_ambiguous','pending',0,$4 from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 on conflict do nothing`,
        [...args(e), at]
      );
    await audit(c, e, outcome);
  }
  async function current(c: ClinicModuleTransactionContext, e: OutboxEventRecord, r: Row) {
    if (new Date(iso(r.expires_at)).getTime() <= now().getTime())
      throw new CommunicationConflict("approval_expired");
    const eligible = await sql(c).query(
      `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=$1 and a.clinic_id=$2 and a.status='active' where u.id=$3 and u.status='active' and exists(select 1 from user_role_assignments x join role_permissions rp on rp.role_id=x.role_id where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=u.id and x.revoked_at is null and rp.permission_key='message.write')`,
      [e.tenantId, e.clinicId, r.approved_by_user_id]
    );
    if (!eligible.rows.length) throw new CommunicationConflict("approver_unavailable");
    const prepared = await prepareCommunicationAppointment(
      sql(c),
      scope(e),
      {
        threadId: String(r.thread_id),
        appointmentId: String(r.appointment_id),
        templateId: String(r.template_id)
      },
      now()
    );
    if (prepared.digest !== r.approval_digest) throw new CommunicationConflict("approval_changed");
    return prepared;
  }
  const send: OutboxEventHandler = {
    eventType: "communication.appointment_send_requested",
    async handle(e) {
      // First claim is committed before any possible external dispatch. Lost worker
      // ownership is uncertain, never permission to send a second copy.
      const claim = await run(e, async (c) => {
        await lockClinicConfiguration(sql(c), scope(e));
        const r = (
          await sql(c).query<Row>(
            `select * from communication_requests where tenant_id=$1 and clinic_id=$2 and id=$3 and outbox_event_id=$4 and approved_by_user_id=$5 for update`,
            [...args(e), e.eventId, e.actor.id]
          )
        ).rows[0];
        if (!r || !["queued", "sending", "not_dispatched"].includes(String(r.status))) return null;
        const old = (
          await sql(c).query<Row>(
            `select * from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 for update`,
            args(e)
          )
        ).rows[0];
        if (old?.dispatch_outcome === "pending") {
          if (new Date(iso(old.dispatch_lease_expires_at)).getTime() > now().getTime())
            throw new CommunicationRetry();
          await finalize(
            c,
            e,
            "dispatch_ambiguous",
            null,
            "dispatch_lease_expired",
            String(old.dispatch_lease_owner)
          );
          return null;
        }
        if (
          old &&
          (old.dispatch_outcome !== "not_dispatched" || Number(old.dispatch_attempt_count) >= 3)
        ) {
          await sql(c).query(
            `update communication_requests set status='blocked',failure_code='retry_exhausted' where tenant_id=$1 and clinic_id=$2 and id=$3`,
            args(e)
          );
          return null;
        }
        let prepared;
        try {
          prepared = await current(c, e, r);
        } catch (error) {
          if (!(
            error instanceof CommunicationConflict ||
            error instanceof CommunicationNotFound ||
            error instanceof RangeError
          ))
            throw error;
          await sql(c).query(
            `update communication_requests set status='blocked',failure_code='review_required' where tenant_id=$1 and clinic_id=$2 and id=$3`,
            args(e)
          );
          await audit(c, e, "review_required");
          return null;
        }
        const s = prepared.snapshot,
          lease = randomUUID(),
          expires = new Date(now().getTime() + 120_000).toISOString();
        if (old)
          await sql(c).query(
            `update meta_whatsapp_outbound_messages set dispatch_outcome='pending',automatic_retry_allowed=false,dispatch_attempt_count=dispatch_attempt_count+1,dispatch_lease_owner=$4,dispatch_lease_expires_at=$5,failure_category=null where tenant_id=$1 and clinic_id=$2 and message_request_id=$3`,
            [...args(e), lease, expires]
          );
        else {
          const auditId = await audit(c, e, "claimed");
          await sql(c).query(
            `insert into meta_whatsapp_outbound_messages(tenant_id,clinic_id,external_account_id,message_request_id,patient_id,recipient_endpoint_hmac,purpose,template_name,template_language,consent_evidence_id,consent_template_version,state,dispatch_outcome,dispatch_attempt_count,dispatch_lease_owner,dispatch_lease_expires_at,audit_event_id,outbox_event_id) values($1,$2,$3,$4,$5,$6,'appointment',$7,$8,$9,$10,'send_requested','pending',1,$11,$12,$13,$14)`,
            [
              e.tenantId,
              e.clinicId,
              s.accountId,
              e.aggregateId,
              s.patientId,
              createHmac("sha256", input.endpointHmacSecret)
                .update(s.recipient.slice(1))
                .digest("hex"),
              s.templateName,
              s.language,
              s.consentId,
              s.consentVersion,
              lease,
              expires,
              auditId,
              e.eventId
            ]
          );
        }
        await sql(c).query(
          `update communication_requests set status='sending',failure_code=null where tenant_id=$1 and clinic_id=$2 and id=$3`,
          args(e)
        );
        return { lease, prepared };
      });
      if (!claim) return;
      let token: string, definition: ReturnType<typeof approvedAppointmentTemplate>;
      try {
        token = await input.secrets.resolveSecret(
          String(claim.prepared.registration.api_credential_ref)
        );
        definition = approvedAppointmentTemplate(
          await reader.read({
            templateId: claim.prepared.snapshot.providerTemplateId,
            apiVersion: claim.prepared.snapshot.apiVersion,
            accessToken: token
          })
        );
      } catch {
        await run(e, (c) =>
          finalize(c, e, "not_dispatched", null, "template_unavailable", claim.lease)
        );
        throw new CommunicationRetry();
      }
      const retry = await run(e, async (c) => {
        await lockClinicConfiguration(sql(c), scope(e));
        const r = (
          await sql(c).query<Row>(
            `select * from communication_requests where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
            args(e)
          )
        ).rows[0]!;
        const out = (
          await sql(c).query<Row>(
            `select * from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 for update`,
            args(e)
          )
        ).rows[0]!;
        if (out.dispatch_outcome !== "pending" || out.dispatch_lease_owner !== claim.lease)
          return false;
        if (new Date(iso(out.dispatch_lease_expires_at)).getTime() <= now().getTime()) {
          await finalize(c, e, "dispatch_ambiguous", null, "dispatch_lease_expired", claim.lease);
          return false;
        }
        let prepared;
        try {
          prepared = await current(c, e, r);
          if (!definition || digest(definition) !== prepared.snapshot.templateDefinitionDigest)
            throw new CommunicationConflict("template_changed");
        } catch (error) {
          if (!(
            error instanceof CommunicationConflict ||
            error instanceof CommunicationNotFound ||
            error instanceof RangeError
          ))
            throw error;
          await finalize(c, e, "rejected", null, "review_required", claim.lease);
          return false;
        }
        const s = prepared.snapshot;
        const options = {
          activationState: prepared.registration.activation_state as
            "sandbox_verified" | "production_verified",
          graphApiVersion: s.apiVersion,
          phoneNumberId: s.phoneNumberId,
          accessToken: token
        };
        let client: Pick<MetaWhatsAppClient, "sendApprovedTemplate">;
        try {
          client = input.clientFactory?.(options) ?? new MetaWhatsAppClient(options);
        } catch {
          await finalize(
            c,
            e,
            "not_dispatched",
            null,
            "provider_configuration_invalid",
            claim.lease
          );
          await sql(c).query(
            `update communication_requests set status='blocked' where tenant_id=$1 and clinic_id=$2 and id=$3`,
            args(e)
          );
          return false;
        }
        let result: MetaTemplateSendResult;
        try {
          result = await client.sendApprovedTemplate({
            messageRequestId: e.aggregateId,
            idempotencyKey: e.idempotencyKey,
            correlationId: e.correlationId,
            recipientPhoneE164: s.recipient,
            template: {
              name: s.templateName,
              languageCode: s.language,
              components: [{ type: "body", parameters: [{ type: "text", text: s.parameter }] }]
            },
            policy: {
              consent: "granted",
              purpose: "appointment",
              mode: "approved_template",
              templateState: "approved",
              now: now().toISOString()
            }
          });
        } catch {
          // A thrown adapter error is not proof that the provider received nothing.
          await finalize(c, e, "dispatch_ambiguous", null, "provider_outcome_unknown", claim.lease);
          return false;
        }
        const outcome = result.outcome === "rejected_by_provider" ? "rejected" : result.outcome;
        await finalize(
          c,
          e,
          outcome,
          result.outcome === "accepted_by_provider" ? result.providerMessageId : null,
          result.outcome === "accepted_by_provider" ? null : outcome,
          claim.lease
        );
        return outcome === "not_dispatched";
      });
      if (retry) throw new CommunicationRetry();
    }
  };
  return [sync, send];
}
