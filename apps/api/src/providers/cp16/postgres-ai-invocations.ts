import { randomUUID } from "node:crypto";
import type { SqlQueryClient } from "@clinic-os/db";
import type { FireworksRequestProvenance } from "@clinic-os/integrations";
import type {
  Cp16AiApplicationPolicyEvidence,
  Cp16AiInvocationClaim,
  Cp16AiInvocationIdentity,
  Cp16AiInvocationPersistencePort,
  Cp16AiPersistedProviderResult,
  Cp16AiProviderResultDisposition
} from "../../features/cp16-ai/contracts.ts";
import {
  protectedPayloadFromDatabase,
  type Cp16ProtectedPayloadCodec
} from "./protected-payload.ts";
import {
  appendAiEvidence,
  assertInvocationIdentity,
  sha256,
  sha256Digest,
  validInstant,
  withAiScope,
  type Cp16AiUnitOfWork
} from "./postgres-ai-shared.ts";

const CLAIM_LEASE_MILLISECONDS = 5 * 60_000;

interface InvocationRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly clinic_id: string;
  readonly patient_id: string;
  readonly encounter_id: string;
  readonly actor_user_id: string;
  readonly task: Cp16AiInvocationIdentity["task"];
  readonly processing_stage: Cp16AiInvocationIdentity["processingStage"];
  readonly status:
    | "claimed"
    | "completed"
    | "failed"
    | "provider_outcome_uncertain"
    | "provider_succeeded_persistence_uncertain";
  readonly disposition: Cp16AiProviderResultDisposition | null;
  readonly workflow_idempotency_digest: string;
  readonly provider_call_idempotency_digest: string;
  readonly request_fingerprint: string;
  readonly correlation_digest: string;
  readonly result_kind: Cp16AiPersistedProviderResult["kind"] | null;
  readonly result_ciphertext: Uint8Array | null;
  readonly result_encryption_key_ref: string | null;
  readonly result_encryption_algorithm: string | null;
  readonly result_plaintext_digest: string | null;
  readonly lease_expires_at: string | Date | null;
}

export class PostgresCp16AiInvocationPersistence implements Cp16AiInvocationPersistencePort {
  readonly #unitOfWork: Cp16AiUnitOfWork;
  readonly #payloads: Cp16ProtectedPayloadCodec;
  readonly #now: () => Date;

  constructor(input: {
    readonly unitOfWork: Cp16AiUnitOfWork;
    readonly payloads: Cp16ProtectedPayloadCodec;
    readonly now?: () => Date;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#payloads = input.payloads;
    this.#now = input.now ?? (() => new Date());
  }

  async claimInvocation(identity: Cp16AiInvocationIdentity): Promise<Cp16AiInvocationClaim> {
    assertInvocationIdentity(identity);
    const now = validDate(this.#now(), "claim clock");
    const invocationId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MILLISECONDS).toISOString();
    return withAiScope(this.#unitOfWork, identity, async (client) => {
      const inserted = await client.query<{ readonly id: string }>(
        `insert into cp16_ai_invocations (
           id, tenant_id, clinic_id, patient_id, encounter_id, actor_user_id,
           provider_key, task, processing_stage, status, workflow_idempotency_digest,
           provider_call_idempotency_digest, request_fingerprint, correlation_digest,
           lease_expires_at
         ) values ($1,$2,$3,$4,$5,$6,'fireworks',$7,$8,'claimed',$9,$10,$11,$12,$13::timestamptz)
         on conflict (tenant_id, clinic_id, provider_call_idempotency_digest) do nothing
         returning id`,
        [
          invocationId,
          identity.tenantId,
          identity.clinicId,
          identity.patientId,
          identity.encounterId,
          identity.actorUserId,
          identity.task,
          identity.processingStage,
          identity.workflowIdempotencyDigest,
          identity.providerCallIdempotencyDigest,
          identity.requestFingerprint,
          sha256(identity.correlationId),
          leaseExpiresAt
        ]
      );
      if (inserted.rows.length === 1) return { outcome: "claimed", invocationId };

      const row = await lockedInvocation(client, identity.providerCallIdempotencyDigest);
      if (!row) throw new Error("AI invocation claim could not be resolved.");
      if (!matchesIdentity(row, identity)) {
        return { outcome: "idempotency_conflict", invocationId: row.id };
      }
      if (row.status === "completed") {
        return {
          outcome: "completed",
          invocationId: row.id,
          disposition: requiredDisposition(row.disposition),
          result: await this.#revealResult(row, identity)
        };
      }
      if (row.status === "provider_succeeded_persistence_uncertain") {
        return { outcome: row.status, invocationId: row.id };
      }
      if (row.status === "provider_outcome_uncertain") {
        return { outcome: row.status, invocationId: row.id };
      }
      if (row.status === "failed") {
        return { outcome: "idempotency_conflict", invocationId: row.id };
      }
      const lease = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : Number.NaN;
      if (Number.isFinite(lease) && lease > now.getTime()) {
        return { outcome: "in_progress", invocationId: row.id };
      }
      const policy = leaseExpiryPolicy(identity.processingStage, now.toISOString());
      const updated = await client.query<{ readonly id: string }>(
        `update cp16_ai_invocations
            set status = 'provider_outcome_uncertain', uncertain_reason = 'lease_expired_after_possible_dispatch',
                application_policy_snapshot_digest = $4,
                application_policy_reason_code = $5,
                application_policy_evaluated_at = $6::timestamptz,
                lease_expires_at = null, completed_at = $6::timestamptz
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'claimed'
          returning id`,
        [
          identity.tenantId,
          identity.clinicId,
          row.id,
          policy.snapshotDigest,
          policy.reasonCode,
          policy.evaluatedAt
        ]
      );
      if (updated.rows.length !== 1)
        throw new Error("AI stale invocation could not be quarantined.");
      await appendAiEvidence(client, {
        identity,
        invocationId: row.id,
        action: "ai.provider_outcome_uncertain",
        eventType: "ai.provider_outcome_uncertain",
        occurredAt: policy.evaluatedAt,
        metadata: terminalMetadata(identity, "lease_expired_after_possible_dispatch")
      });
      return { outcome: "provider_outcome_uncertain", invocationId: row.id };
    });
  }

  async commitProviderResult(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly disposition: Cp16AiProviderResultDisposition;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence;
    readonly result: Cp16AiPersistedProviderResult;
    readonly occurredAt: string;
  }): Promise<void> {
    assertInvocationIdentity(input.identity);
    assertPolicy(input.applicationPolicyEvidence);
    const occurredAt = validInstant(input.occurredAt, "result occurrence");
    const protectedResult = await this.#payloads.protectJson(input.result, {
      tenantId: input.identity.tenantId,
      clinicId: input.identity.clinicId,
      patientId: input.identity.patientId,
      resourceType: "ai_invocation_result",
      resourceId: input.invocationId
    });
    await withAiScope(this.#unitOfWork, input.identity, async (client) => {
      const row = await requiredLockedIdentity(client, input.identity, input.invocationId);
      if (row.status === "completed") return;
      if (row.status !== "claimed")
        throw new Error("AI invocation is not claimable for completion.");
      const provenance = provenanceRecord(input.result.value.provenance);
      const updated = await client.query<{ readonly id: string }>(
        `update cp16_ai_invocations
            set status = 'completed', disposition = $4, result_kind = $5,
                result_ciphertext = $6, result_encryption_key_ref = $7,
                result_encryption_algorithm = $8, result_plaintext_digest = $9,
                provenance = $10::jsonb, application_policy_snapshot_digest = $11,
                application_policy_reason_code = $12,
                application_policy_evaluated_at = $13::timestamptz,
                lease_expires_at = null, completed_at = $14::timestamptz
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'claimed'
          returning id`,
        [
          input.identity.tenantId,
          input.identity.clinicId,
          input.invocationId,
          input.disposition,
          input.result.kind,
          Buffer.from(protectedResult.ciphertext),
          protectedResult.keyReference,
          protectedResult.algorithm,
          protectedResult.plaintextDigest,
          JSON.stringify(provenance),
          input.applicationPolicyEvidence.snapshotDigest,
          input.applicationPolicyEvidence.reasonCode,
          input.applicationPolicyEvidence.evaluatedAt,
          occurredAt
        ]
      );
      if (updated.rows.length !== 1) throw new Error("AI result was not committed exactly once.");
      await appendAiEvidence(client, {
        identity: input.identity,
        invocationId: input.invocationId,
        action: "ai.output.created",
        eventType: "ai.output.created",
        occurredAt,
        metadata: {
          ...terminalMetadata(input.identity, "review_only"),
          disposition: input.disposition,
          resultKind: input.result.kind,
          modelId: provenance.modelId,
          promptVersion: provenance.promptVersion,
          schemaVersion: provenance.schemaVersion,
          requestDigest: provenance.requestDigest,
          responseDigest: provenance.responseDigest,
          attemptCount: provenance.attemptCount
        }
      });
    });
  }

  recordTerminalFailure(
    input: Parameters<Cp16AiInvocationPersistencePort["recordTerminalFailure"]>[0]
  ): Promise<void> {
    return this.#recordTerminal({ ...input, status: "failed" });
  }

  recordProviderSucceededPersistenceUncertain(
    input: Parameters<
      Cp16AiInvocationPersistencePort["recordProviderSucceededPersistenceUncertain"]
    >[0]
  ): Promise<void> {
    return this.#recordTerminal({
      ...input,
      status: "provider_succeeded_persistence_uncertain",
      provenance: provenanceRecord(input.provenance)
    });
  }

  recordProviderOutcomeUncertain(
    input: Parameters<Cp16AiInvocationPersistencePort["recordProviderOutcomeUncertain"]>[0]
  ): Promise<void> {
    return this.#recordTerminal({ ...input, status: "provider_outcome_uncertain" });
  }

  async #recordTerminal(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly occurredAt: string;
    readonly status:
      "failed" | "provider_succeeded_persistence_uncertain" | "provider_outcome_uncertain";
    readonly reasonCode?: string;
    readonly reason?: string;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence | null;
    readonly provenance?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    assertInvocationIdentity(input.identity);
    if (input.applicationPolicyEvidence) assertPolicy(input.applicationPolicyEvidence);
    const occurredAt = validInstant(input.occurredAt, "terminal occurrence");
    await withAiScope(this.#unitOfWork, input.identity, async (client) => {
      const row = await requiredLockedIdentity(client, input.identity, input.invocationId);
      if (row.status === "completed" || row.status === input.status) return;
      if (row.status !== "claimed")
        throw new Error("AI terminal state conflicts with durable truth.");
      const policy = input.applicationPolicyEvidence;
      const updated = await client.query<{ readonly id: string }>(
        `update cp16_ai_invocations
            set status = $4, error_code = $5, uncertain_reason = $6,
                provenance = $7::jsonb, application_policy_snapshot_digest = $8,
                application_policy_reason_code = $9,
                application_policy_evaluated_at = $10::timestamptz,
                lease_expires_at = null, completed_at = $11::timestamptz
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'claimed'
          returning id`,
        [
          input.identity.tenantId,
          input.identity.clinicId,
          input.invocationId,
          input.status,
          input.status === "failed" ? validReason(input.reasonCode ?? "provider_failure") : null,
          input.status === "failed" ? null : input.reason,
          input.provenance ? JSON.stringify(input.provenance) : null,
          policy?.snapshotDigest ?? null,
          policy?.reasonCode ?? null,
          policy?.evaluatedAt ?? null,
          occurredAt
        ]
      );
      if (updated.rows.length !== 1) throw new Error("AI terminal state was not committed.");
      const suffix = input.status === "failed" ? "failed" : input.status;
      await appendAiEvidence(client, {
        identity: input.identity,
        invocationId: input.invocationId,
        action: `ai.${suffix}`,
        eventType: `ai.${suffix}`,
        occurredAt,
        metadata: terminalMetadata(
          input.identity,
          input.status === "failed"
            ? validReason(input.reasonCode ?? "provider_failure")
            : (input.reason ?? suffix)
        )
      });
    });
  }

  async #revealResult(
    row: InvocationRow,
    identity: Cp16AiInvocationIdentity
  ): Promise<Cp16AiPersistedProviderResult> {
    if (
      !row.result_kind ||
      !row.result_ciphertext ||
      !row.result_encryption_key_ref ||
      !row.result_encryption_algorithm ||
      !row.result_plaintext_digest
    ) {
      throw new Error("AI completed result envelope is incomplete.");
    }
    const value = await this.#payloads.revealJson(
      protectedPayloadFromDatabase({
        ciphertext: row.result_ciphertext,
        keyReference: row.result_encryption_key_ref,
        algorithm: row.result_encryption_algorithm,
        plaintextDigest: row.result_plaintext_digest
      }),
      {
        tenantId: identity.tenantId,
        clinicId: identity.clinicId,
        patientId: identity.patientId,
        resourceType: "ai_invocation_result",
        resourceId: row.id
      }
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("AI completed result payload is invalid.");
    }
    const record = value as Record<string, unknown>;
    if (record.kind !== row.result_kind || !("value" in record)) {
      throw new Error("AI completed result kind is inconsistent.");
    }
    return value as Cp16AiPersistedProviderResult;
  }
}

async function lockedInvocation(
  client: SqlQueryClient,
  digest: string
): Promise<InvocationRow | null> {
  const result = await client.query<InvocationRow>(
    `select * from cp16_ai_invocations
      where tenant_id = clinic_os.current_tenant_id()
        and clinic_id = clinic_os.current_clinic_id()
        and provider_call_idempotency_digest = $1
      for update`,
    [digest]
  );
  return result.rows[0] ?? null;
}

async function requiredLockedIdentity(
  client: SqlQueryClient,
  identity: Cp16AiInvocationIdentity,
  invocationId: string
): Promise<InvocationRow> {
  const result = await client.query<InvocationRow>(
    `select * from cp16_ai_invocations
      where tenant_id = $1 and clinic_id = $2 and id = $3
      for update`,
    [identity.tenantId, identity.clinicId, invocationId]
  );
  const row = result.rows[0];
  if (!row || !matchesIdentity(row, identity)) {
    throw new Error("AI invocation identity does not match durable state.");
  }
  return row;
}

function matchesIdentity(row: InvocationRow, identity: Cp16AiInvocationIdentity): boolean {
  return (
    row.tenant_id === identity.tenantId &&
    row.clinic_id === identity.clinicId &&
    row.patient_id === identity.patientId &&
    row.encounter_id === identity.encounterId &&
    row.actor_user_id === identity.actorUserId &&
    row.task === identity.task &&
    row.processing_stage === identity.processingStage &&
    row.workflow_idempotency_digest === identity.workflowIdempotencyDigest &&
    row.provider_call_idempotency_digest === identity.providerCallIdempotencyDigest &&
    row.request_fingerprint === identity.requestFingerprint &&
    row.correlation_digest === sha256(identity.correlationId)
  );
}

function provenanceRecord(value: FireworksRequestProvenance): Readonly<Record<string, unknown>> {
  for (const digest of [
    value.serviceAccountDigest,
    value.actorDigest,
    value.tenantDigest,
    value.correlationDigest,
    value.consentSnapshotDigest,
    value.requestDigest,
    value.responseDigest,
    ...(value.providerRequestIdDigest ? [value.providerRequestIdDigest] : [])
  ]) {
    if (!sha256Digest(digest)) throw new Error("AI provenance digest is invalid.");
  }
  return Object.freeze({
    provider: value.provider,
    task: value.task,
    modelId: value.modelId,
    promptVersion: value.promptVersion,
    schemaVersion: value.schemaVersion,
    serviceAccountDigest: value.serviceAccountDigest,
    actorDigest: value.actorDigest,
    tenantDigest: value.tenantDigest,
    correlationDigest: value.correlationDigest,
    consentSnapshotDigest: value.consentSnapshotDigest,
    requestDigest: value.requestDigest,
    responseDigest: value.responseDigest,
    providerRequestIdDigest: value.providerRequestIdDigest,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    audioBytes: value.audioBytes,
    audioDurationMs: value.audioDurationMs,
    latencyMs: value.latencyMs,
    attemptCount: value.attemptCount,
    status: value.status
  });
}

function assertPolicy(value: Cp16AiApplicationPolicyEvidence): void {
  if (
    !sha256Digest(value.snapshotDigest) ||
    !/^[a-z0-9_]{1,64}$/u.test(value.reasonCode) ||
    !["clinical_processing", "capture_processing"].includes(value.stage)
  ) {
    throw new Error("AI application policy evidence is invalid.");
  }
  validInstant(value.evaluatedAt, "policy evaluation");
}

function requiredDisposition(
  value: Cp16AiProviderResultDisposition | null
): Cp16AiProviderResultDisposition {
  if (value !== "review_only_ready" && value !== "blocked") {
    throw new Error("AI completed disposition is invalid.");
  }
  return value;
}

function validReason(value: string): string {
  if (!/^[a-z0-9_]{1,64}$/u.test(value)) throw new Error("AI reason code is invalid.");
  return value;
}

function terminalMetadata(
  identity: Cp16AiInvocationIdentity,
  reasonCode: string
): Readonly<Record<string, unknown>> {
  return {
    provider: "fireworks",
    task: identity.task,
    processingStage: identity.processingStage,
    providerCallIdempotencyDigest: identity.providerCallIdempotencyDigest,
    requestFingerprint: identity.requestFingerprint,
    reasonCode
  };
}

function leaseExpiryPolicy(
  stage: Cp16AiInvocationIdentity["processingStage"],
  evaluatedAt: string
): Cp16AiApplicationPolicyEvidence {
  return {
    stage,
    evaluatedAt,
    reasonCode: "lease_expired_after_possible_dispatch",
    snapshotDigest: sha256(`cp16-ai-lease-expiry\0${evaluatedAt}`)
  };
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`AI ${field} is invalid.`);
  }
  return value;
}
