import { createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createPostgresClinicModuleUnitOfWork,
  type ClinicModuleTransactionContext
} from "@clinic-os/db";
import { systemClock, type UUID } from "@clinic-os/domain";
import {
  MetaWhatsAppClient,
  MetaWhatsAppError,
  type MetaTemplateSendResult,
  type ProviderSecretResolver
} from "@clinic-os/integrations";
import type {
  Cp13PatientInstructionSendActivityRequest,
  Cp13PatientInstructionSendActivityResult
} from "@clinic-os/workflow";

interface ActivityScope {
  readonly tenantId: UUID;
  readonly clinicId: UUID;
  readonly actorUserId: UUID;
}

interface DispatchClaim {
  readonly outcome: "claimed";
  readonly outboundMessageId: UUID;
  readonly leaseOwner: string;
  readonly accessTokenRef: string;
  readonly activationState: "sandbox_verified" | "production_verified";
  readonly apiVersion: string;
  readonly phoneNumberId: string;
  readonly recipientPhoneE164: string;
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly bodyParameter: string;
}

type ClaimResult =
  | DispatchClaim
  | {
      readonly outcome: "already_accepted";
      readonly providerMessageId: string;
      readonly evidenceId: string;
    }
  | { readonly outcome: "permanent_failure"; readonly code: string; readonly evidenceId: string };

export interface MetaInstructionSenderPort {
  send(
    request: Cp13PatientInstructionSendActivityRequest
  ): Promise<Cp13PatientInstructionSendActivityResult>;
}

export class MetaInstructionRetryableError extends Error {
  constructor() {
    super("Meta instruction dispatch can be retried because transport proved no dispatch.");
    this.name = "MetaInstructionRetryableError";
  }
}

export function createScopedMetaInstructionSender(input: {
  readonly pool: Pool;
  readonly secrets: ProviderSecretResolver;
  readonly endpointHmacSecret: Uint8Array;
  readonly now?: () => Date;
  readonly clientFactory?: (
    options: ConstructorParameters<typeof MetaWhatsAppClient>[0]
  ) => Pick<MetaWhatsAppClient, "sendApprovedTemplate">;
}): MetaInstructionSenderPort {
  if (input.endpointHmacSecret.byteLength < 32) {
    throw new Error("Meta instruction endpoint HMAC secret must contain at least 32 bytes.");
  }
  const now = input.now ?? (() => systemClock.now());
  const unitOfWork = createPostgresClinicModuleUnitOfWork<ActivityScope>({
    client: input.pool,
    resolveScope: (scope) => scope
  });
  const run = <T>(
    request: Cp13PatientInstructionSendActivityRequest,
    callback: (context: ClinicModuleTransactionContext) => Promise<T>
  ) => unitOfWork.run(scopeFrom(request), callback);

  return {
    async send(request) {
      let claim: ClaimResult;
      try {
        claim = await run(request, (context) =>
          claimDispatch(context, request, input.endpointHmacSecret, now())
        );
      } catch (error) {
        if (error instanceof MetaWhatsAppError && !error.retryable) {
          const evidenceId = await run(request, (context) =>
            recordPreDispatchFailure(context, request, error.code, now())
          );
          return {
            outcome: "permanent_failure",
            failureCode:
              error.code === "policy_blocked"
                ? "INSTRUCTION_POLICY_BLOCKED"
                : "INSTRUCTION_PROVIDER_NOT_CONFIGURED",
            requestEvidenceId: evidenceId
          };
        }
        throw error;
      }
      if (claim.outcome === "already_accepted") {
        return {
          outcome: "requested",
          providerSubmissionId: claim.providerMessageId,
          requestEvidenceId: claim.evidenceId
        };
      }
      if (claim.outcome === "permanent_failure") {
        return {
          outcome: "permanent_failure",
          failureCode: claim.code,
          requestEvidenceId: claim.evidenceId
        };
      }

      let result: MetaTemplateSendResult;
      try {
        const accessToken = await input.secrets.resolveSecret(claim.accessTokenRef);
        const clientOptions = {
          activationState: claim.activationState,
          graphApiVersion: claim.apiVersion,
          phoneNumberId: claim.phoneNumberId,
          accessToken
        } as const;
        const client =
          input.clientFactory?.(clientOptions) ?? new MetaWhatsAppClient(clientOptions);
        result = await client.sendApprovedTemplate({
          messageRequestId: request.instructionId,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
          recipientPhoneE164: claim.recipientPhoneE164,
          template: {
            name: claim.templateName,
            languageCode: claim.templateLanguage,
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: claim.bodyParameter }]
              }
            ]
          },
          policy: {
            consent: "granted",
            purpose: "care_instruction",
            mode: "approved_template",
            templateState: "approved",
            now: now().toISOString()
          }
        });
      } catch (error) {
        const policyBlocked = error instanceof MetaWhatsAppError && error.code === "policy_blocked";
        const finalized = await run(request, (context) =>
          finalizeDispatch(
            context,
            request,
            claim,
            {
              outcome: policyBlocked ? "rejected_by_provider" : "not_dispatched",
              safeFailureCode: policyBlocked ? "policy_blocked" : "provider_unavailable"
            },
            now()
          )
        );
        if (policyBlocked) {
          return {
            outcome: "permanent_failure",
            failureCode: "INSTRUCTION_POLICY_BLOCKED",
            requestEvidenceId: finalized.evidenceId
          };
        }
        throw new MetaInstructionRetryableError();
      }

      const finalized = await run(request, (context) =>
        finalizeDispatch(context, request, claim, providerOutcome(result), now())
      );
      if (result.outcome === "accepted_by_provider") {
        return {
          outcome: "requested",
          providerSubmissionId: result.providerMessageId,
          requestEvidenceId: finalized.evidenceId
        };
      }
      if (result.outcome === "not_dispatched") throw new MetaInstructionRetryableError();
      return {
        outcome: "permanent_failure",
        failureCode:
          result.outcome === "dispatch_ambiguous"
            ? "INSTRUCTION_DISPATCH_AMBIGUOUS"
            : "INSTRUCTION_PROVIDER_REJECTED",
        requestEvidenceId: finalized.evidenceId
      };
    }
  };
}

async function recordPreDispatchFailure(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest,
  safeFailureCode: string,
  now: Date
): Promise<string> {
  const evidenceId = randomUUID();
  await context.evidence.appendAuditEvent({
    id: evidenceId,
    action: "instruction.send_failed",
    category: "integration",
    riskLevel: "high",
    phiInvolved: true,
    resourceType: "patient_instruction",
    resourceId: request.instructionId,
    patientId: request.patientId as UUID,
    metadata: {
      providerKey: "meta_whatsapp_cloud",
      dispatchOutcome: "not_dispatched",
      reconciliationRequired: false,
      automaticRetryAllowed: false,
      safeFailureCode
    },
    ipAddress: null,
    userAgent: "clinic-os-worker",
    correlationId: request.correlationId,
    occurredAt: now.toISOString()
  });
  return evidenceId;
}

async function claimDispatch(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest,
  endpointHmacSecret: Uint8Array,
  now: Date
): Promise<ClaimResult> {
  const sql = requiredSql(context);
  const leaseOwner = `meta:${request.eventId}`;
  const existing = await sql.query<{
    id: UUID;
    dispatch_outcome: string;
    dispatch_attempt_count: number;
    dispatch_lease_expires_at: string | null;
    provider_message_id: string | null;
    audit_event_id: string;
  }>(
    `select id, dispatch_outcome, dispatch_attempt_count,
            dispatch_lease_expires_at::text, provider_message_id, audit_event_id
     from meta_whatsapp_outbound_messages
     where tenant_id = $1 and clinic_id = $2 and message_request_id = $3
     for update`,
    [request.tenantId, request.clinicId, request.instructionId]
  );
  const previous = existing.rows[0];
  if (previous) {
    if (previous.dispatch_outcome === "accepted_by_provider" && previous.provider_message_id) {
      return {
        outcome: "already_accepted",
        providerMessageId: previous.provider_message_id,
        evidenceId: previous.audit_event_id
      };
    }
    if (previous.dispatch_outcome === "pending") {
      const expiresAt = previous.dispatch_lease_expires_at
        ? Date.parse(previous.dispatch_lease_expires_at)
        : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt > now.getTime()) {
        throw new MetaInstructionRetryableError();
      }
      const evidenceId = await markAmbiguousAfterLeaseLoss(context, request, previous.id, now);
      return {
        outcome: "permanent_failure",
        code: "INSTRUCTION_DISPATCH_AMBIGUOUS",
        evidenceId
      };
    }
    if (previous.dispatch_outcome === "not_dispatched" && previous.dispatch_attempt_count < 3) {
      await sql.query(
        `update meta_whatsapp_outbound_messages
         set dispatch_outcome = 'pending', automatic_retry_allowed = false,
             dispatch_attempt_count = dispatch_attempt_count + 1,
             dispatch_lease_owner = $4, dispatch_lease_expires_at = $5,
             failure_category = null
         where tenant_id = $1 and clinic_id = $2 and id = $3`,
        [
          request.tenantId,
          request.clinicId,
          previous.id,
          leaseOwner,
          new Date(now.getTime() + 120_000).toISOString()
        ]
      );
      return loadDispatchInput(context, request, previous.id, leaseOwner);
    }
    return {
      outcome: "permanent_failure",
      code:
        previous.dispatch_outcome === "dispatch_ambiguous"
          ? "INSTRUCTION_DISPATCH_AMBIGUOUS"
          : "INSTRUCTION_PROVIDER_UNAVAILABLE",
      evidenceId: previous.audit_event_id
    };
  }

  const source = await loadInstructionSource(context, request);
  const outboundMessageId = randomUUID() as UUID;
  const auditEventId = randomUUID();
  await context.evidence.appendAuditEvent({
    id: auditEventId,
    action: "instruction.send_requested",
    category: "integration",
    riskLevel: "medium",
    phiInvolved: true,
    resourceType: "patient_instruction",
    resourceId: request.instructionId,
    patientId: request.patientId as UUID,
    metadata: {
      providerKey: "meta_whatsapp_cloud",
      activationState: source.activationState,
      templateName: source.templateName,
      templateLanguage: source.templateLanguage,
      dispatchOutcome: "pending"
    },
    ipAddress: null,
    userAgent: "clinic-os-worker",
    correlationId: request.correlationId,
    occurredAt: now.toISOString()
  });
  await sql.query(
    `insert into meta_whatsapp_outbound_messages (
       id, tenant_id, clinic_id, external_account_id, message_request_id,
       patient_id, recipient_endpoint_hmac, purpose, template_name, template_language,
       consent_evidence_id, consent_template_version, state, dispatch_outcome,
       dispatch_attempt_count, dispatch_lease_owner, dispatch_lease_expires_at,
       audit_event_id, outbox_event_id
     ) values (
       $1, $2, $3, $4, $5, $6, $7, 'care_instruction', $8, $9,
       $10, $11, 'send_requested', 'pending', 1, $12, $13, $14, $15
     )`,
    [
      outboundMessageId,
      request.tenantId,
      request.clinicId,
      source.externalAccountId,
      request.instructionId,
      request.patientId,
      hmacEndpoint(endpointHmacSecret, source.recipientPhoneE164),
      source.templateName,
      source.templateLanguage,
      source.consentEvidenceId,
      source.consentTemplateVersion,
      leaseOwner,
      new Date(now.getTime() + 120_000).toISOString(),
      auditEventId,
      source.outboxEventId
    ]
  );
  return {
    outcome: "claimed",
    outboundMessageId,
    leaseOwner,
    accessTokenRef: source.accessTokenRef,
    activationState: source.activationState,
    apiVersion: source.apiVersion,
    phoneNumberId: source.phoneNumberId,
    recipientPhoneE164: source.recipientPhoneE164,
    templateName: source.templateName,
    templateLanguage: source.templateLanguage,
    bodyParameter: source.bodyParameter
  };
}

async function loadDispatchInput(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest,
  outboundMessageId: UUID,
  leaseOwner: string
): Promise<DispatchClaim> {
  const source = await loadInstructionSource(context, request);
  return {
    outcome: "claimed",
    outboundMessageId,
    leaseOwner,
    accessTokenRef: source.accessTokenRef,
    activationState: source.activationState,
    apiVersion: source.apiVersion,
    phoneNumberId: source.phoneNumberId,
    recipientPhoneE164: source.recipientPhoneE164,
    templateName: source.templateName,
    templateLanguage: source.templateLanguage,
    bodyParameter: source.bodyParameter
  };
}

async function loadInstructionSource(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest
) {
  const sql = requiredSql(context);
  const registrations = await sql.query<{
    external_account_id: UUID;
    activation_state: "sandbox_verified" | "production_verified";
    provider_endpoint_id: string;
    api_version: string;
    api_credential_ref: string;
  }>(
    `select external_account_id, activation_state, provider_endpoint_id,
            api_version, api_credential_ref
     from provider_callback_registrations
     where tenant_id = $1 and clinic_id = $2
       and provider_key = 'meta_whatsapp_cloud'
       and activation_state in ('sandbox_verified', 'production_verified')
     order by id limit 2`,
    [request.tenantId, request.clinicId]
  );
  if (registrations.rows.length !== 1) throw permanentConfigurationFailure();
  const registration = registrations.rows[0]!;
  const rows = await sql.query<{
    patient_id: UUID;
    template_id: string;
    body: string;
    outbox_event_id: UUID;
    phone: string;
    consent_evidence_id: UUID;
    consent_template_version: number;
    template_name: string;
    language_code: string;
  }>(
    `select instruction.patient_id, instruction.template_id, instruction.body,
            instruction.outbox_event_id, patient.phone,
            consent.id as consent_evidence_id,
            consent.template_version as consent_template_version,
            template.template_name, template.language_code
     from patient_instruction_requests instruction
     join patients patient
       on patient.tenant_id = instruction.tenant_id
      and patient.clinic_id = instruction.clinic_id
      and patient.id = instruction.patient_id
     join consents consent
       on consent.tenant_id = instruction.tenant_id
      and consent.clinic_id = instruction.clinic_id
      and consent.patient_id = instruction.patient_id
      and consent.purpose = 'whatsapp_communication'
      and consent.status = 'active'
     join meta_whatsapp_template_snapshots template
       on template.tenant_id = instruction.tenant_id
      and template.clinic_id = instruction.clinic_id
      and template.external_account_id = $4
      and template.template_name = instruction.template_id
      and template.lifecycle_state = 'approved'
     where instruction.tenant_id = $1 and instruction.clinic_id = $2
       and instruction.id = $3 and instruction.patient_id = $5
       and instruction.channel = 'whatsapp' and instruction.status = 'send_requested'
       and instruction.outbox_event_id is not null
     order by template.language_code limit 2`,
    [
      request.tenantId,
      request.clinicId,
      request.instructionId,
      registration.external_account_id,
      request.patientId
    ]
  );
  if (rows.rows.length !== 1) throw permanentConfigurationFailure();
  const row = rows.rows[0]!;
  if (!/^\+[1-9]\d{7,14}$/u.test(row.phone) || row.body.length < 1 || row.body.length > 4096) {
    throw permanentConfigurationFailure();
  }
  return {
    externalAccountId: registration.external_account_id,
    activationState: registration.activation_state,
    phoneNumberId: registration.provider_endpoint_id,
    apiVersion: registration.api_version,
    accessTokenRef: registration.api_credential_ref,
    recipientPhoneE164: row.phone,
    consentEvidenceId: row.consent_evidence_id,
    consentTemplateVersion: row.consent_template_version,
    templateName: row.template_name,
    templateLanguage: row.language_code,
    bodyParameter: row.body,
    outboxEventId: row.outbox_event_id
  } as const;
}

async function finalizeDispatch(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest,
  claim: DispatchClaim,
  result: {
    readonly outcome:
      "accepted_by_provider" | "not_dispatched" | "dispatch_ambiguous" | "rejected_by_provider";
    readonly providerMessageId?: string;
    readonly safeFailureCode?: string;
  },
  now: Date
): Promise<{ evidenceId: string }> {
  const sql = requiredSql(context);
  const evidenceId = randomUUID();
  const outcome = result.outcome === "rejected_by_provider" ? "rejected" : result.outcome;
  const state =
    result.outcome === "accepted_by_provider"
      ? "accepted_by_provider"
      : result.outcome === "rejected_by_provider"
        ? "failed"
        : "send_requested";
  const updated = await sql.query<{ id: UUID }>(
    `update meta_whatsapp_outbound_messages
     set state = $6,
         dispatch_outcome = $7,
         provider_message_id = $8,
         automatic_retry_allowed = $9,
         reconciliation_required = $10,
         accepted_by_provider_at = case when $7 = 'accepted_by_provider' then $11::timestamptz else null end,
         failed_at = case when $7 = 'rejected' then $11::timestamptz else null end,
         failure_category = $12,
         dispatch_lease_owner = null,
         dispatch_lease_expires_at = null
     where tenant_id = $1 and clinic_id = $2 and id = $3
       and dispatch_outcome = 'pending' and dispatch_lease_owner = $4
       and message_request_id = $5
     returning id`,
    [
      request.tenantId,
      request.clinicId,
      claim.outboundMessageId,
      claim.leaseOwner,
      request.instructionId,
      state,
      outcome,
      result.providerMessageId ?? null,
      result.outcome === "not_dispatched",
      result.outcome === "dispatch_ambiguous",
      now.toISOString(),
      result.safeFailureCode ?? null
    ]
  );
  if (updated.rows.length !== 1) throw new MetaInstructionRetryableError();
  if (result.outcome === "dispatch_ambiguous") {
    await sql.query(
      `insert into meta_whatsapp_reconciliation_jobs (
         tenant_id, clinic_id, external_account_id, outbound_message_id,
         reason, status, attempt_count, next_attempt_at
       )
       select tenant_id, clinic_id, external_account_id, id,
              'dispatch_ambiguous', 'pending', 0, $4
       from meta_whatsapp_outbound_messages
       where tenant_id = $1 and clinic_id = $2 and id = $3
       on conflict (tenant_id, clinic_id, outbound_message_id)
         where status in ('pending', 'leased', 'provider_unavailable')
       do nothing`,
      [request.tenantId, request.clinicId, claim.outboundMessageId, now.toISOString()]
    );
  }
  await context.evidence.appendAuditEvent({
    id: evidenceId,
    action:
      result.outcome === "accepted_by_provider"
        ? "workflow.cp13.instruction_send_requested"
        : "instruction.send_failed",
    category: "integration",
    riskLevel: result.outcome === "accepted_by_provider" ? "medium" : "high",
    phiInvolved: true,
    resourceType: "patient_instruction",
    resourceId: request.instructionId,
    patientId: request.patientId as UUID,
    metadata: {
      providerKey: "meta_whatsapp_cloud",
      dispatchOutcome: result.outcome,
      reconciliationRequired: result.outcome === "dispatch_ambiguous",
      automaticRetryAllowed: result.outcome === "not_dispatched",
      safeFailureCode: result.safeFailureCode ?? null
    },
    ipAddress: null,
    userAgent: "clinic-os-worker",
    correlationId: request.correlationId,
    occurredAt: now.toISOString()
  });
  return { evidenceId };
}

async function markAmbiguousAfterLeaseLoss(
  context: ClinicModuleTransactionContext,
  request: Cp13PatientInstructionSendActivityRequest,
  outboundMessageId: UUID,
  now: Date
): Promise<string> {
  const claim: DispatchClaim = {
    outcome: "claimed",
    outboundMessageId,
    leaseOwner: `expired:${request.eventId}`,
    accessTokenRef: "unused",
    activationState: "sandbox_verified",
    apiVersion: "v1.0",
    phoneNumberId: "000000",
    recipientPhoneE164: "+10000000",
    templateName: "unused",
    templateLanguage: "en",
    bodyParameter: "unused"
  };
  const sql = requiredSql(context);
  await sql.query(
    `update meta_whatsapp_outbound_messages
     set dispatch_lease_owner = $4
     where tenant_id = $1 and clinic_id = $2 and id = $3 and dispatch_outcome = 'pending'`,
    [request.tenantId, request.clinicId, outboundMessageId, claim.leaseOwner]
  );
  return (
    await finalizeDispatch(
      context,
      request,
      claim,
      {
        outcome: "dispatch_ambiguous",
        safeFailureCode: "dispatch_lease_expired"
      },
      now
    )
  ).evidenceId;
}

function providerOutcome(result: MetaTemplateSendResult) {
  if (result.outcome === "accepted_by_provider") {
    return { outcome: result.outcome, providerMessageId: result.providerMessageId } as const;
  }
  if (result.outcome === "rejected_by_provider") {
    return {
      outcome: result.outcome,
      safeFailureCode: `provider_http_${result.providerHttpStatus}`
    } as const;
  }
  return { outcome: result.outcome, safeFailureCode: result.outcome } as const;
}

function requiredSql(context: ClinicModuleTransactionContext) {
  if (!context.sqlClient) throw new Error("Meta instruction sender requires transaction SQL.");
  return context.sqlClient;
}

function hmacEndpoint(secret: Uint8Array, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function scopeFrom(request: Cp13PatientInstructionSendActivityRequest): ActivityScope {
  return {
    tenantId: request.tenantId as UUID,
    clinicId: request.clinicId as UUID,
    actorUserId: request.actorUserId as UUID
  };
}

function permanentConfigurationFailure(): MetaWhatsAppError {
  return new MetaWhatsAppError({
    code: "not_configured",
    message: "Meta instruction source is not uniquely configured.",
    httpStatus: 503,
    retryable: false
  });
}
