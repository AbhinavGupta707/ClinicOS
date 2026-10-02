import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  buildSetLocalRlsStatements,
  createPostgresClinicModuleUnitOfWork,
  lockClinicConfiguration,
  lockMetaWhatsAppDispatch,
  hasCurrentCommunicationAuthority,
  type ClinicModuleTransactionContext,
  type RepositoryScope
} from "@clinic-os/db";
import { systemClock, type UUID } from "@clinic-os/domain";
import {
  MetaWhatsAppClient,
  type MetaTemplateSendResult,
  type ProviderSecretResolver
} from "@clinic-os/integrations";
import type {
  Cp13PatientInstructionSendActivityRequest as Request,
  Cp13PatientInstructionSendActivityResult as Result
} from "@clinic-os/workflow";

type Row = Record<string, unknown>;
type Context = ClinicModuleTransactionContext;
const sql = (c: Context) => {
  if (!c.sqlClient) throw new Error("Instruction dispatch requires scoped SQL.");
  return c.sqlClient;
};
const args = (r: Request) => [r.tenantId, r.clinicId, r.instructionId];
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const instant = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const scope = (r: Request): RepositoryScope => ({
  tenantId: r.tenantId as UUID,
  clinicId: r.clinicId as UUID,
  actorUserId: r.actorUserId as UUID
});
class Blocked extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export class MetaInstructionRetryableError extends Error {
  constructor() {
    super("Instruction dispatch is pending or transport proved no dispatch.");
    this.name = "MetaInstructionRetryableError";
  }
}
export interface MetaInstructionSenderPort {
  send(request: Request): Promise<Result>;
}
interface Source {
  accountId: string;
  activation: "sandbox_verified" | "production_verified";
  apiVersion: string;
  phoneNumberId: string;
  tokenRef: string;
  recipient: string;
  templateName: string;
  language: string;
  body: string;
  consentId: string;
  consentVersion: number;
  templateVersion: number;
  registrationId: string;
}
interface Claim {
  outboundId: string;
  lease: string;
  source: Source;
  sourceDigest: string;
}
interface Outcome {
  outcome: "accepted_by_provider" | "not_dispatched" | "dispatch_ambiguous" | "rejected";
  providerId?: string;
  code?: string;
}

export function createScopedMetaInstructionSender(input: {
  pool: Pool;
  secrets: ProviderSecretResolver;
  endpointHmacSecret: Uint8Array;
  now?: () => Date;
  clientFactory?: (
    o: ConstructorParameters<typeof MetaWhatsAppClient>[0]
  ) => Pick<MetaWhatsAppClient, "sendApprovedTemplate">;
}): MetaInstructionSenderPort {
  if (input.endpointHmacSecret.byteLength < 32)
    throw new Error("Meta instruction endpoint HMAC secret must contain at least 32 bytes.");
  const now = input.now ?? (() => systemClock.now());
  const uow = createPostgresClinicModuleUnitOfWork<RepositoryScope>({
    client: input.pool,
    resolveScope: (s) => s
  });
  const run = <T>(r: Request, fn: (c: Context) => Promise<T>) =>
    uow.run(scope(r), async (c) => {
      for (const q of buildSetLocalRlsStatements({
        tenantId: r.tenantId as UUID,
        clinicId: r.clinicId as UUID,
        userId: r.actorUserId as UUID
      }))
        await sql(c).query(q.sql, q.values);
      await lockMetaWhatsAppDispatch(sql(c), scope(r));
      await lockClinicConfiguration(sql(c), scope(r));
      return fn(c);
    });
  async function audit(c: Context, r: Request, code: string): Promise<string> {
    const id = randomUUID();
    await c.evidence.appendAuditEvent({
      id,
      action:
        code === "accepted_by_provider"
          ? "workflow.cp13.instruction_send_requested"
          : code === "dispatch_claimed"
            ? "instruction.send_requested"
            : "instruction.send_failed",
      category: "integration",
      riskLevel: "high",
      phiInvolved: true,
      resourceType: "patient_instruction",
      resourceId: r.instructionId as UUID,
      patientId: r.patientId as UUID,
      metadata: { providerKey: "meta_whatsapp_cloud", safeFailureCode: code },
      ipAddress: null,
      userAgent: "clinic-os-worker",
      correlationId: r.correlationId,
      occurredAt: now().toISOString()
    });
    return id;
  }
  async function reject(c: Context, r: Request, code: string, old?: Row): Promise<Result> {
    const evidenceId = await audit(c, r, code);
    // Once a retry is refused, restoring the source/authority must not revive it.
    if (old)
      await sql(c).query(
        `update meta_whatsapp_outbound_messages set dispatch_outcome='rejected',state='failed',
       automatic_retry_allowed=false,failure_category=$4,failed_at=$5,audit_event_id=$6
       where tenant_id=$1 and clinic_id=$2 and id=$3 and dispatch_outcome='not_dispatched'`,
        [r.tenantId, r.clinicId, old.id, code, now().toISOString(), evidenceId]
      );
    return {
      outcome: "permanent_failure",
      failureCode: code,
      requestEvidenceId: evidenceId
    };
  }
  async function finalize(
    c: Context,
    r: Request,
    claim: Claim,
    outcome: Outcome
  ): Promise<Result | "retry"> {
    const row = (
      await sql(c).query<Row>(
        `select * from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and id=$3 and message_request_id=$4 for update`,
        [r.tenantId, r.clinicId, claim.outboundId, r.instructionId]
      )
    ).rows[0];
    if (!row) throw new Error("Instruction dispatch evidence disappeared.");
    // A late worker must report durable truth, never its stale transport result.
    if (row.dispatch_outcome !== "pending" || row.dispatch_lease_owner !== claim.lease)
      return resultFrom(row);
    const id = await audit(c, r, outcome.code ?? outcome.outcome),
      at = now().toISOString();
    await sql(c).query(
      `update meta_whatsapp_outbound_messages set dispatch_outcome=$4,
      state=case when $4='accepted_by_provider' then 'accepted_by_provider' when $4='rejected' then 'failed' else 'send_requested' end,
      provider_message_id=$5,accepted_by_provider_at=case when $4='accepted_by_provider' then $6::timestamptz else null end,
      failed_at=case when $4='rejected' then $6::timestamptz else null end,failure_category=$7,
      automatic_retry_allowed=($4='not_dispatched' and dispatch_attempt_count<3),reconciliation_required=($4='dispatch_ambiguous'),
      dispatch_lease_owner=null,dispatch_lease_expires_at=null,audit_event_id=$8
      where tenant_id=$1 and clinic_id=$2 and id=$3`,
      [
        r.tenantId,
        r.clinicId,
        claim.outboundId,
        outcome.outcome,
        outcome.providerId ?? null,
        at,
        outcome.code ?? null,
        id
      ]
    );
    if (outcome.outcome === "dispatch_ambiguous")
      await sql(c).query(
        `insert into meta_whatsapp_reconciliation_jobs(tenant_id,clinic_id,external_account_id,outbound_message_id,reason,status,attempt_count,next_attempt_at)
      select tenant_id,clinic_id,external_account_id,id,'dispatch_ambiguous','pending',0,$4 from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and id=$3
      on conflict (tenant_id,clinic_id,outbound_message_id) where outbound_message_id is not null and status in ('pending','leased','provider_unavailable') do nothing`,
        [r.tenantId, r.clinicId, claim.outboundId, at]
      );
    if (outcome.outcome === "not_dispatched" && Number(row.dispatch_attempt_count) < 3)
      return "retry";
    return resultFrom({
      ...row,
      dispatch_outcome: outcome.outcome,
      provider_message_id: outcome.providerId,
      audit_event_id: id,
      failure_category: outcome.code
    });
  }
  async function claimDispatch(c: Context, r: Request): Promise<Claim | Result> {
    const instruction = await boundInstruction(c, r);
    const old = (
      await sql(c).query<Row>(
        `select * from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and message_request_id=$3 for update`,
        args(r)
      )
    ).rows[0];
    if (
      old &&
      (old.purpose !== "care_instruction" ||
        old.patient_id !== r.patientId ||
        old.outbox_event_id !== r.eventId)
    )
      throw new Blocked("INSTRUCTION_SOURCE_MISMATCH");
    if (old && old.dispatch_outcome !== "not_dispatched") {
      if (old.dispatch_outcome !== "pending") return resultFrom(old);
      if (instant(old.dispatch_lease_expires_at) > now().getTime())
        throw new MetaInstructionRetryableError();
      const expired = {
        outboundId: String(old.id),
        lease: String(old.dispatch_lease_owner)
      } as Claim;
      const result = await finalize(c, r, expired, {
        outcome: "dispatch_ambiguous",
        code: "dispatch_lease_expired"
      });
      if (result === "retry") throw new Error("An uncertain dispatch cannot retry.");
      return result;
    }
    if (old && (!old.automatic_retry_allowed || Number(old.dispatch_attempt_count) >= 3))
      return resultFrom(old);
    let source: Source;
    try {
      source = await currentSource(c, r, instruction, now());
    } catch (e) {
      if (e instanceof Blocked) return reject(c, r, e.code, old);
      throw e;
    }
    if (old && old.instruction_source_digest !== digest(source))
      return reject(c, r, "INSTRUCTION_REVIEW_REQUIRED", old);
    const id = old ? String(old.id) : randomUUID(),
      lease = randomUUID(),
      expires = new Date(now().getTime() + 120_000).toISOString();
    if (old)
      await sql(c).query(
        `update meta_whatsapp_outbound_messages set dispatch_outcome='pending',automatic_retry_allowed=false,dispatch_attempt_count=dispatch_attempt_count+1,dispatch_lease_owner=$4,dispatch_lease_expires_at=$5,failure_category=null where tenant_id=$1 and clinic_id=$2 and id=$3`,
        [r.tenantId, r.clinicId, id, lease, expires]
      );
    else {
      const evidenceId = await audit(c, r, "dispatch_claimed");
      await sql(c).query(
        `insert into meta_whatsapp_outbound_messages(id,tenant_id,clinic_id,external_account_id,message_request_id,patient_id,recipient_endpoint_hmac,purpose,template_name,template_language,consent_evidence_id,consent_template_version,state,dispatch_outcome,dispatch_attempt_count,dispatch_lease_owner,dispatch_lease_expires_at,audit_event_id,outbox_event_id,instruction_source_digest)
        values($1,$2,$3,$4,$5,$6,$7,'care_instruction',$8,$9,$10,$11,'send_requested','pending',1,$12,$13,$14,$15,$16)`,
        [
          id,
          r.tenantId,
          r.clinicId,
          source.accountId,
          r.instructionId,
          r.patientId,
          createHmac("sha256", input.endpointHmacSecret)
            .update(source.recipient.slice(1))
            .digest("hex"),
          source.templateName,
          source.language,
          source.consentId,
          source.consentVersion,
          lease,
          expires,
          evidenceId,
          r.eventId,
          digest(source)
        ]
      );
    }
    return { outboundId: id, lease, source, sourceDigest: digest(source) };
  }
  return {
    async send(r) {
      let claim: Claim | Result;
      try {
        claim = await run(r, (c) => claimDispatch(c, r));
      } catch (e) {
        if (e instanceof Blocked) return run(r, (c) => reject(c, r, e.code));
        throw e;
      }
      if ("outcome" in claim) return claim;
      let client: Pick<MetaWhatsAppClient, "sendApprovedTemplate">;
      try {
        const s = claim.source;
        const options = {
          activationState: s.activation,
          graphApiVersion: s.apiVersion,
          phoneNumberId: s.phoneNumberId,
          accessToken: await input.secrets.resolveSecret(s.tokenRef)
        };
        client = input.clientFactory?.(options) ?? new MetaWhatsAppClient(options);
      } catch {
        // No transport has been constructed/invoked successfully in this phase.
        const result = await run(r, (c) =>
          finalize(c, r, claim, {
            outcome: "not_dispatched",
            code: "provider_unavailable_before_send"
          })
        );
        if (result === "retry") throw new MetaInstructionRetryableError();
        return result;
      }
      const result = await run(r, async (c) => {
        const instruction = await boundInstruction(c, r);
        const row = (
          await sql(c).query<Row>(
            `select * from meta_whatsapp_outbound_messages where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
            [r.tenantId, r.clinicId, claim.outboundId]
          )
        ).rows[0];
        if (!row) throw new Error("Instruction dispatch evidence disappeared.");
        if (row.dispatch_outcome !== "pending" || row.dispatch_lease_owner !== claim.lease)
          return resultFrom(row);
        if (instant(row.dispatch_lease_expires_at) <= now().getTime())
          return finalize(c, r, claim, {
            outcome: "dispatch_ambiguous",
            code: "dispatch_lease_expired"
          });
        let source: Source;
        try {
          source = await currentSource(c, r, instruction, now());
          if (digest(source) !== claim.sourceDigest)
            throw new Blocked("INSTRUCTION_REVIEW_REQUIRED");
        } catch (e) {
          if (!(e instanceof Blocked)) throw e;
          return finalize(c, r, claim, { outcome: "rejected", code: e.code });
        }
        let sent: MetaTemplateSendResult;
        try {
          sent = await client.sendApprovedTemplate({
            messageRequestId: r.instructionId,
            idempotencyKey: r.idempotencyKey,
            correlationId: r.correlationId,
            recipientPhoneE164: source.recipient,
            template: {
              name: source.templateName,
              languageCode: source.language,
              components: [{ type: "body", parameters: [{ type: "text", text: source.body }] }]
            },
            policy: {
              consent: "granted",
              purpose: "care_instruction",
              mode: "approved_template",
              templateState: "approved",
              now: now().toISOString()
            }
          });
        } catch {
          return finalize(c, r, claim, {
            outcome: "dispatch_ambiguous",
            code: "provider_outcome_unknown"
          });
        }
        return finalize(c, r, claim, {
          outcome: sent.outcome === "rejected_by_provider" ? "rejected" : sent.outcome,
          ...(sent.outcome === "accepted_by_provider"
            ? { providerId: sent.providerMessageId }
            : { code: sent.outcome })
        });
      });
      if (result === "retry") throw new MetaInstructionRetryableError();
      return result;
    }
  };
}

function resultFrom(row: Row): Result {
  if (
    row.dispatch_outcome === "accepted_by_provider" &&
    typeof row.provider_message_id === "string"
  )
    return {
      outcome: "requested",
      providerSubmissionId: row.provider_message_id,
      requestEvidenceId: String(row.audit_event_id)
    };
  let failureCode = "INSTRUCTION_PROVIDER_UNAVAILABLE";
  if (row.dispatch_outcome === "dispatch_ambiguous" || row.dispatch_outcome === "pending")
    failureCode = "INSTRUCTION_DISPATCH_AMBIGUOUS";
  else if (row.failure_category === "rejected_by_provider")
    failureCode = "INSTRUCTION_PROVIDER_REJECTED";
  else if (
    [
      "INSTRUCTION_REVIEW_REQUIRED",
      "INSTRUCTION_AUTHORITY_REVOKED",
      "INSTRUCTION_POLICY_BLOCKED",
      "INSTRUCTION_PROVIDER_NOT_CONFIGURED"
    ].includes(String(row.failure_category))
  )
    failureCode = String(row.failure_category);
  return {
    outcome: "permanent_failure",
    failureCode,
    requestEvidenceId: String(row.audit_event_id)
  };
}

async function boundInstruction(c: Context, r: Request): Promise<Row> {
  const row = (
    await sql(c).query<Row>(
      `select i.*,e.occurred_at as requested_at from patient_instruction_requests i join outbox_events e on e.tenant_id=i.tenant_id and e.clinic_id=i.clinic_id and e.id=i.outbox_event_id
    where i.tenant_id=$1 and i.clinic_id=$2 and i.id=$3 and i.patient_id=$4 and i.created_by_user_id=$5
      and i.channel='whatsapp' and i.status='send_requested' and e.id=$6 and e.actor_type='user' and e.actor_id=i.created_by_user_id::text
      and e.event_type='instruction.send_requested' and e.aggregate_type='patient_instruction' and e.aggregate_id=i.id and e.patient_id=i.patient_id
      and e.idempotency_key=$7 and e.correlation_id=$8 and date_trunc('milliseconds',e.occurred_at)=$9::timestamptz for update of i`,
      [
        ...args(r),
        r.patientId,
        r.actorUserId,
        r.eventId,
        r.idempotencyKey,
        r.correlationId,
        r.requestedAt
      ]
    )
  ).rows[0];
  if (!row) throw new Blocked("INSTRUCTION_SOURCE_MISMATCH");
  return row;
}

async function currentSource(c: Context, r: Request, i: Row, now: Date): Promise<Source> {
  if (
    !i.dispatch_recipient_phone ||
    instant(i.requested_at) > now.getTime() ||
    now.getTime() - instant(i.requested_at) > 15 * 60_000
  )
    throw new Blocked("INSTRUCTION_REVIEW_REQUIRED");
  if (
    !(await hasCurrentCommunicationAuthority(sql(c), scope(r), [
      "patient.read",
      "patient_instruction.write"
    ]))
  )
    throw new Blocked("INSTRUCTION_AUTHORITY_REVOKED");
  const registrations = (
    await sql(c).query<Row>(
      `select * from provider_callback_registrations where tenant_id=$1 and clinic_id=$2 and provider_key='meta_whatsapp_cloud' and activation_state in ('sandbox_verified','production_verified') order by id limit 2 for share`,
      [r.tenantId, r.clinicId]
    )
  ).rows;
  if (registrations.length !== 1) throw new Blocked("INSTRUCTION_PROVIDER_NOT_CONFIGURED");
  const reg = registrations[0]!;
  await sql(c).query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `communication-contact:${r.tenantId}:${r.clinicId}:${reg.external_account_id}:${i.dispatch_recipient_phone}`
  ]);
  const source = (
    await sql(c).query<Row>(
      `select p.phone,c.id as consent_id,c.template_version,t.template_name,t.language_code,t.row_version
    from patients p join consents c on c.tenant_id=p.tenant_id and c.clinic_id=p.clinic_id and c.patient_id=p.id and c.purpose='whatsapp_communication' and c.status='active'
    join meta_whatsapp_template_snapshots t on t.tenant_id=p.tenant_id and t.clinic_id=p.clinic_id and t.external_account_id=$4 and t.template_name=$5 and t.lifecycle_state='approved'
    where p.tenant_id=$1 and p.clinic_id=$2 and p.id=$3 order by t.language_code limit 2 for share of p,c,t`,
      [r.tenantId, r.clinicId, r.patientId, reg.external_account_id, i.template_id]
    )
  ).rows;
  if (source.length !== 1) throw new Blocked("INSTRUCTION_POLICY_BLOCKED");
  const s = source[0]!,
    phone = String(s.phone),
    body = String(i.body);
  if (
    phone !== i.dispatch_recipient_phone ||
    !/^\+[1-9][0-9]{7,14}$/u.test(phone) ||
    !body ||
    body.length > 4096 ||
    body.includes("\0")
  )
    throw new Blocked("INSTRUCTION_REVIEW_REQUIRED");
  const stop = await sql(c).query(
    `select c.id from meta_whatsapp_consent_commands c join meta_whatsapp_event_receipts e on e.tenant_id=c.tenant_id and e.clinic_id=c.clinic_id and e.id=c.event_receipt_id
    join normalized_integration_events n on n.tenant_id=e.tenant_id and n.clinic_id=e.clinic_id and n.id=e.normalized_event_id
    where c.tenant_id=$1 and c.clinic_id=$2 and e.external_account_id=$3 and c.command='opt_out' and n.normalized_payload->>'senderWaId'=$4 limit 1`,
    [r.tenantId, r.clinicId, reg.external_account_id, phone.slice(1)]
  );
  if (stop.rows.length) throw new Blocked("INSTRUCTION_POLICY_BLOCKED");
  return {
    accountId: String(reg.external_account_id),
    activation: reg.activation_state as Source["activation"],
    apiVersion: String(reg.api_version),
    phoneNumberId: String(reg.provider_endpoint_id),
    tokenRef: String(reg.api_credential_ref),
    recipient: phone,
    templateName: String(s.template_name),
    language: String(s.language_code),
    body,
    consentId: String(s.consent_id),
    consentVersion: Number(s.template_version),
    templateVersion: Number(s.row_version),
    registrationId: String(reg.id)
  };
}
