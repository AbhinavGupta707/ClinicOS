import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildSetLocalRlsStatements } from "@clinic-os/db";
import { systemClock, type UUID as ClinicUuid } from "@clinic-os/domain";
import {
  RazorpayBoundaryError,
  type ProviderSecretResolver,
  type RazorpayPaymentSnapshot
} from "@clinic-os/integrations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SAFE_CODE = /^[a-z][a-z0-9_.-]{0,127}$/u;
const MAX_RECONCILIATION_ATTEMPTS = 8;
const RECONCILIATION_ACTIVE_STATES = new Set([
  "sandbox_verified",
  "production_verified",
  "degraded"
]);

export interface ProviderReconciliationScope {
  readonly tenantId: string;
  readonly clinicId: string;
}

export interface RazorpayCreationCollectionSnapshot {
  readonly providerRequestId: string;
  readonly kind: "payment_link" | "invoice_qr";
  readonly referenceId: string;
  readonly amountMinor: number;
  readonly currency: string | null;
  readonly status: string;
  readonly createdAtEpochSeconds: number;
}

export type RazorpayCreationLookupResult =
  | {
      readonly outcome: "found";
      readonly collection: RazorpayCreationCollectionSnapshot;
      readonly searchedQrPages: number;
    }
  | {
      readonly outcome: "not_found" | "inconclusive";
      readonly searchedQrPages: number;
    }
  | {
      readonly outcome: "ambiguous";
      readonly collections: readonly RazorpayCreationCollectionSnapshot[];
      readonly searchedQrPages: number;
      readonly reason: "multiple_matches" | "scope_mismatch";
    };

export interface RazorpayReconciliationProviderClient {
  /** Must be backed by the official Razorpay GET /payments/:id client. */
  fetchPayment(providerPaymentId: string): Promise<RazorpayPaymentSnapshot>;
  /** Must be backed by the official bounded Payment Link/QR collection GET client. */
  findCollectionByInvoiceReference(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly invoiceId: string;
    readonly providerRequestReference: string;
    readonly jobCreatedAt: string;
  }): Promise<RazorpayCreationLookupResult>;
}

export interface ProviderReconciliationProcessorOptions {
  readonly pool: Pick<Pool, "connect">;
  readonly workerId: string;
  readonly razorpaySecrets: ProviderSecretResolver;
  readonly createRazorpayClient: (
    credential: Readonly<{ keyId: string; keySecret: string }>,
    registration: Readonly<{
      providerMode: "test" | "live";
      providerAccountId: string;
    }>
  ) => RazorpayReconciliationProviderClient;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly now?: () => Date;
}

export interface ProviderReconciliationPollResult {
  readonly claimed: number;
  readonly matched: number;
  readonly variances: number;
  readonly retriesScheduled: number;
  readonly deadLettered: number;
  readonly manualReview: number;
  readonly leaseLost: number;
}

type MetaReason =
  | "dispatch_ambiguous"
  | "unknown_status"
  | "conflicting_terminal_status"
  | "webhook_gap"
  | "unsupported_change";

interface MetaClaim {
  readonly id: string;
  readonly externalAccountId: string;
  readonly reason: MetaReason;
  readonly attemptCount: number;
  readonly leaseOwner: string;
  readonly registrationId: string;
}

type RazorpayReason =
  | "missing_local_capture"
  | "amount_mismatch"
  | "currency_mismatch"
  | "refund_mismatch"
  | "provider_not_captured"
  | "provider_outage"
  | "creation_outcome_unknown";

interface RazorpayClaim {
  readonly id: string;
  readonly externalAccountId: string;
  readonly providerPaymentId: string | null;
  readonly providerRequestReference: string | null;
  readonly invoiceId: string | null;
  readonly reason: RazorpayReason;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly leaseOwner: string;
  readonly registrationId: string;
  readonly activationState: string;
  readonly providerMode: "test" | "live";
  readonly providerAccountId: string;
  readonly apiCredentialRef: string | null;
}

interface ClaimedBatch {
  readonly meta: readonly MetaClaim[];
  readonly razorpay: readonly RazorpayClaim[];
  readonly exhausted: number;
}

interface RegistrationLeaseRow {
  readonly registration_id: string;
  readonly api_credential_ref: string | null;
}

interface RazorpayDecision {
  readonly status: "matched" | "variance";
  readonly snapshotDigest: string;
  readonly failureCode: string | null;
}

export class ProviderReconciliationProcessor {
  readonly #pool: Pick<Pool, "connect">;
  readonly #workerId: string;
  readonly #razorpaySecrets: ProviderSecretResolver;
  readonly #createRazorpayClient: ProviderReconciliationProcessorOptions["createRazorpayClient"];
  readonly #batchSize: number;
  readonly #leaseMs: number;
  readonly #maxAttempts: number;
  readonly #baseRetryDelayMs: number;
  readonly #maxRetryDelayMs: number;
  readonly #now: () => Date;

  constructor(options: ProviderReconciliationProcessorOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(options.workerId)) {
      throw new Error("Provider reconciliation workerId is invalid.");
    }
    this.#pool = options.pool;
    this.#workerId = options.workerId;
    this.#razorpaySecrets = options.razorpaySecrets;
    this.#createRazorpayClient = options.createRazorpayClient;
    this.#batchSize = boundedInteger(options.batchSize ?? 10, 1, 100, "batchSize");
    this.#leaseMs = boundedInteger(options.leaseMs ?? 60_000, 5_000, 300_000, "leaseMs");
    this.#maxAttempts = MAX_RECONCILIATION_ATTEMPTS;
    this.#baseRetryDelayMs = boundedInteger(
      options.baseRetryDelayMs ?? 5_000,
      1_000,
      300_000,
      "baseRetryDelayMs"
    );
    this.#maxRetryDelayMs = boundedInteger(
      options.maxRetryDelayMs ?? 15 * 60_000,
      this.#baseRetryDelayMs,
      24 * 60 * 60_000,
      "maxRetryDelayMs"
    );
    this.#now = options.now ?? (() => systemClock.now());
  }

  async pollOnce(scope: ProviderReconciliationScope): Promise<ProviderReconciliationPollResult> {
    const normalizedScope = validScope(scope);
    const claimedAt = this.#now();
    const batch = await this.#claim(normalizedScope, claimedAt);
    const counts = {
      claimed: batch.meta.length + batch.razorpay.length,
      matched: 0,
      variances: 0,
      retriesScheduled: 0,
      deadLettered: batch.exhausted,
      manualReview: 0,
      leaseLost: 0
    };

    for (const job of batch.meta) {
      const finalized = await this.#finalizeMetaUnsupported(normalizedScope, job);
      if (finalized) counts.manualReview += 1;
      else counts.leaseLost += 1;
    }
    for (const job of batch.razorpay) {
      const result = await this.#processRazorpay(normalizedScope, job);
      counts.matched += result === "matched" ? 1 : 0;
      counts.variances += result === "variance" ? 1 : 0;
      counts.retriesScheduled += result === "retry_scheduled" ? 1 : 0;
      counts.deadLettered += result === "dead_lettered" ? 1 : 0;
      counts.leaseLost += result === "lease_lost" ? 1 : 0;
    }
    return counts;
  }

  async #claim(scope: ProviderReconciliationScope, at: Date): Promise<ClaimedBatch> {
    const now = at.toISOString();
    const leaseUntil = new Date(at.getTime() + this.#leaseMs).toISOString();
    const metaLeaseOwner = `${this.#workerId}:meta:${randomUUID()}`;
    const razorpayLeaseOwner = `${this.#workerId}:razorpay:${randomUUID()}`;

    return scopedTransaction(this.#pool, scope, async (client) => {
      const exhaustedMeta = await sweepExhaustedMeta(
        client,
        scope,
        now,
        this.#maxAttempts,
        this.#batchSize
      );
      const exhaustedRazorpay = await sweepExhaustedRazorpay(
        client,
        scope,
        now,
        this.#maxAttempts,
        this.#batchSize
      );
      const meta = await client.query<MetaClaimRow>(
        `/* cp15:claim-meta-reconciliation */
         with due as (
           select job.id, registration.id as registration_id
             from meta_whatsapp_reconciliation_jobs job
             join provider_callback_registrations registration
               on registration.tenant_id = job.tenant_id
              and registration.clinic_id = job.clinic_id
              and registration.external_account_id = job.external_account_id
              and registration.provider_key = 'meta_whatsapp_cloud'
            where job.tenant_id = $1 and job.clinic_id = $2
              and job.attempt_count < $5
              and (
                (job.status in ('pending', 'provider_unavailable')
                  and (job.next_attempt_at is null or job.next_attempt_at <= $3::timestamptz))
                or (job.status = 'leased' and job.lease_expires_at <= $3::timestamptz)
              )
            order by job.next_attempt_at nulls first, job.created_at, job.id
            limit $4
            for update of job skip locked
         )
         update meta_whatsapp_reconciliation_jobs job
            set status = 'leased', attempt_count = job.attempt_count + 1,
                lease_owner = $6, lease_expires_at = $7::timestamptz,
                next_attempt_at = null
           from due
          where job.id = due.id
         returning job.id, job.external_account_id, job.reason, job.attempt_count,
                   job.lease_owner, due.registration_id`,
        [
          scope.tenantId,
          scope.clinicId,
          now,
          this.#batchSize,
          this.#maxAttempts,
          metaLeaseOwner,
          leaseUntil
        ]
      );
      const razorpay = await client.query<RazorpayClaimRow>(
        `/* cp15:claim-razorpay-reconciliation */
         with due as (
           select job.id, registration.id as registration_id,
                  registration.activation_state, registration.provider_mode,
                  registration.provider_account_id, registration.api_credential_ref
             from razorpay_reconciliation_jobs job
             join provider_callback_registrations registration
               on registration.tenant_id = job.tenant_id
              and registration.clinic_id = job.clinic_id
              and registration.external_account_id = job.external_account_id
              and registration.provider_key = 'razorpay'
            where job.tenant_id = $1 and job.clinic_id = $2
              and job.attempt_count < $5
              and (
                (job.status = 'pending')
                or (job.status = 'retry_scheduled' and job.next_attempt_at <= $3::timestamptz)
                or (job.status = 'leased' and job.lease_expires_at <= $3::timestamptz)
              )
            order by job.next_attempt_at nulls first, job.created_at, job.id
            limit $4
            for update of job skip locked
         )
         update razorpay_reconciliation_jobs job
            set status = 'leased', attempt_count = job.attempt_count + 1,
                lease_owner = $6, lease_expires_at = $7::timestamptz,
                next_attempt_at = null
           from due
          where job.id = due.id
         returning job.id, job.external_account_id, job.provider_payment_id,
                   job.provider_request_reference, job.invoice_id, job.reason,
                   job.attempt_count, job.created_at::text, job.lease_owner,
                   due.registration_id, due.activation_state, due.provider_mode,
                   due.provider_account_id, due.api_credential_ref`,
        [
          scope.tenantId,
          scope.clinicId,
          now,
          this.#batchSize,
          this.#maxAttempts,
          razorpayLeaseOwner,
          leaseUntil
        ]
      );
      return {
        meta: meta.rows.map(parseMetaClaim),
        razorpay: razorpay.rows.map(parseRazorpayClaim),
        exhausted: exhaustedMeta + exhaustedRazorpay
      };
    });
  }

  async #finalizeMetaUnsupported(
    scope: ProviderReconciliationScope,
    job: MetaClaim
  ): Promise<boolean> {
    const finalizedAt = this.#now().toISOString();
    return scopedTransaction(this.#pool, scope, async (client) => {
      const locked = await lockMetaLeaseAndRegistration(client, scope, job);
      if (!locked) return false;
      const updated = await client.query<{ id: string }>(
        `/* cp15:finalize-meta-unsupported */
         update meta_whatsapp_reconciliation_jobs
            set status = 'unsupported', lease_owner = null, lease_expires_at = null,
                next_attempt_at = null,
                last_safe_error_code = 'authoritative_lookup_unsupported'
          where tenant_id = $1 and clinic_id = $2 and id = $3
            and status = 'leased' and lease_owner = $4
         returning id`,
        [scope.tenantId, scope.clinicId, job.id, job.leaseOwner]
      );
      if (updated.rows.length !== 1) return false;
      await updateRegistration(client, scope, job.registrationId, {
        at: finalizedAt,
        reconciled: true,
        healthChecked: false,
        failureCode: "authoritative_lookup_unsupported"
      });
      return true;
    });
  }

  async #processRazorpay(
    scope: ProviderReconciliationScope,
    job: RazorpayClaim
  ): Promise<"matched" | "variance" | "retry_scheduled" | "dead_lettered" | "lease_lost"> {
    if (!RECONCILIATION_ACTIVE_STATES.has(job.activationState) || !job.apiCredentialRef) {
      return this.#finalizeRazorpayFailure(scope, job, "provider_registration_inactive", false);
    }

    let client: RazorpayReconciliationProviderClient;
    try {
      const credential = parseRazorpayCredential(
        await this.#razorpaySecrets.resolveSecret(job.apiCredentialRef),
        job.providerMode
      );
      client = this.#createRazorpayClient(credential, {
        providerMode: job.providerMode,
        providerAccountId: job.providerAccountId
      });
    } catch {
      return this.#finalizeRazorpayFailure(scope, job, "provider_credential_unavailable", false);
    }

    try {
      let decision: RazorpayDecision;
      if (job.providerPaymentId) {
        const snapshot = validPaymentSnapshot(
          await client.fetchPayment(job.providerPaymentId),
          job.providerPaymentId
        );
        decision = decidePaymentSnapshot(job.reason, snapshot);
      } else {
        if (!job.invoiceId || !job.providerRequestReference) {
          throw new Error("Razorpay creation reconciliation subject is incomplete.");
        }
        const lookup = validCreationLookup(
          await client.findCollectionByInvoiceReference({
            tenantId: scope.tenantId,
            clinicId: scope.clinicId,
            invoiceId: job.invoiceId,
            providerRequestReference: job.providerRequestReference,
            jobCreatedAt: job.createdAt
          }),
          job.invoiceId
        );
        if (lookup.outcome === "not_found" || lookup.outcome === "inconclusive") {
          return this.#finalizeRazorpayFailure(
            scope,
            job,
            lookup.outcome === "not_found"
              ? "provider_result_not_visible"
              : "provider_lookup_inconclusive",
            true
          );
        }
        decision = {
          status: lookup.outcome === "found" ? "matched" : "variance",
          snapshotDigest: sha256(canonicalCreationLookup(lookup)),
          failureCode: lookup.outcome === "found" ? null : "provider_creation_ambiguous"
        };
      }
      const finalized = await this.#finalizeRazorpayDecision(scope, job, decision);
      return finalized ? decision.status : "lease_lost";
    } catch (error) {
      if (
        error instanceof RazorpayBoundaryError &&
        error.code === "PROVIDER_REJECTED" &&
        (error.safeDetails.status === 400 || error.safeDetails.status === 404) &&
        job.providerPaymentId
      ) {
        const decision: RazorpayDecision = {
          status: "variance",
          snapshotDigest: sha256({
            outcome: "provider_payment_not_found",
            providerPaymentId: job.providerPaymentId
          }),
          failureCode: "provider_payment_not_found"
        };
        const finalized = await this.#finalizeRazorpayDecision(scope, job, decision);
        return finalized ? "variance" : "lease_lost";
      }
      return this.#finalizeRazorpayFailure(scope, job, providerFailureCode(error), true);
    }
  }

  async #finalizeRazorpayDecision(
    scope: ProviderReconciliationScope,
    job: RazorpayClaim,
    decision: RazorpayDecision
  ): Promise<boolean> {
    const finalizedAt = this.#now().toISOString();
    return scopedTransaction(this.#pool, scope, async (client) => {
      const locked = await lockRazorpayLeaseAndRegistration(client, scope, job);
      if (!locked) return false;
      const updated = await client.query<{ id: string }>(
        `/* cp15:finalize-razorpay-decision */
         update razorpay_reconciliation_jobs
            set status = $5, provider_snapshot_digest = $6,
                last_error_code = $7, lease_owner = null, lease_expires_at = null,
                next_attempt_at = null
          where tenant_id = $1 and clinic_id = $2 and id = $3
            and status = 'leased' and lease_owner = $4
         returning id`,
        [
          scope.tenantId,
          scope.clinicId,
          job.id,
          job.leaseOwner,
          decision.status,
          decision.snapshotDigest,
          decision.failureCode
        ]
      );
      if (updated.rows.length !== 1) return false;
      await updateRegistration(client, scope, job.registrationId, {
        at: finalizedAt,
        reconciled: true,
        healthChecked: true,
        failureCode: decision.failureCode
      });
      return true;
    });
  }

  async #finalizeRazorpayFailure(
    scope: ProviderReconciliationScope,
    job: RazorpayClaim,
    initialFailureCode: string,
    healthChecked: boolean
  ): Promise<"retry_scheduled" | "dead_lettered" | "lease_lost"> {
    const finalizedAt = this.#now();
    return scopedTransaction(this.#pool, scope, async (client) => {
      const registration = await lockRazorpayLeaseAndRegistration(client, scope, job);
      if (!registration) return "lease_lost";
      const rotated = registration.api_credential_ref !== job.apiCredentialRef;
      const failureCode = safeCode(rotated ? "credential_rotation_race" : initialFailureCode);
      const exhausted = job.attemptCount >= this.#maxAttempts;
      const status = exhausted ? "dead_lettered" : "retry_scheduled";
      const nextAttemptAt = exhausted
        ? null
        : new Date(finalizedAt.getTime() + this.#retryDelay(job)).toISOString();
      const updated = await client.query<{ id: string }>(
        `/* cp15:finalize-razorpay-failure */
         update razorpay_reconciliation_jobs
            set status = $5, last_error_code = $6,
                lease_owner = null, lease_expires_at = null,
                next_attempt_at = $7::timestamptz
          where tenant_id = $1 and clinic_id = $2 and id = $3
            and status = 'leased' and lease_owner = $4
         returning id`,
        [scope.tenantId, scope.clinicId, job.id, job.leaseOwner, status, failureCode, nextAttemptAt]
      );
      if (updated.rows.length !== 1) return "lease_lost";
      await updateRegistration(client, scope, job.registrationId, {
        at: finalizedAt.toISOString(),
        reconciled: exhausted,
        healthChecked: healthChecked && !rotated,
        failureCode
      });
      return status;
    });
  }

  #retryDelay(job: RazorpayClaim): number {
    const exponential = Math.min(
      this.#maxRetryDelayMs,
      this.#baseRetryDelayMs * 2 ** Math.max(0, job.attemptCount - 1)
    );
    const digest = createHash("sha256").update(`${job.id}:${job.attemptCount}`, "utf8").digest();
    const jitter = Math.floor((exponential * (digest.readUInt16BE(0) % 2_001)) / 10_000);
    return Math.min(this.#maxRetryDelayMs, exponential + jitter);
  }
}

interface MetaClaimRow {
  id: string;
  external_account_id: string;
  reason: string;
  attempt_count: number;
  lease_owner: string;
  registration_id: string;
}

interface RazorpayClaimRow {
  id: string;
  external_account_id: string;
  provider_payment_id: string | null;
  provider_request_reference: string | null;
  invoice_id: string | null;
  reason: string;
  attempt_count: number;
  created_at: string;
  lease_owner: string;
  registration_id: string;
  activation_state: string;
  provider_mode: string;
  provider_account_id: string;
  api_credential_ref: string | null;
}

function parseMetaClaim(row: MetaClaimRow): MetaClaim {
  if (
    !UUID.test(row.id) ||
    !UUID.test(row.external_account_id) ||
    !UUID.test(row.registration_id) ||
    ![
      "dispatch_ambiguous",
      "unknown_status",
      "conflicting_terminal_status",
      "webhook_gap",
      "unsupported_change"
    ].includes(row.reason) ||
    !Number.isInteger(row.attempt_count) ||
    row.attempt_count < 1 ||
    !row.lease_owner
  ) {
    throw new Error("Durable Meta reconciliation claim is invalid.");
  }
  return {
    id: row.id,
    externalAccountId: row.external_account_id,
    reason: row.reason as MetaReason,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    registrationId: row.registration_id
  };
}

function parseRazorpayClaim(row: RazorpayClaimRow): RazorpayClaim {
  const reasons: readonly RazorpayReason[] = [
    "missing_local_capture",
    "amount_mismatch",
    "currency_mismatch",
    "refund_mismatch",
    "provider_not_captured",
    "provider_outage",
    "creation_outcome_unknown"
  ];
  if (
    !UUID.test(row.id) ||
    !UUID.test(row.external_account_id) ||
    !UUID.test(row.registration_id) ||
    !reasons.includes(row.reason as RazorpayReason) ||
    !Number.isInteger(row.attempt_count) ||
    row.attempt_count < 1 ||
    !row.lease_owner ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    (row.provider_mode !== "test" && row.provider_mode !== "live") ||
    !/^[A-Za-z0-9_-]{4,128}$/u.test(row.provider_account_id)
  ) {
    throw new Error("Durable Razorpay reconciliation claim is invalid.");
  }
  const reason = row.reason as RazorpayReason;
  if (
    (reason === "creation_outcome_unknown" &&
      (!row.provider_request_reference || !row.invoice_id || row.provider_payment_id)) ||
    (reason !== "creation_outcome_unknown" &&
      (!row.provider_payment_id || row.provider_request_reference))
  ) {
    throw new Error("Durable Razorpay reconciliation subject is invalid.");
  }
  return {
    id: row.id,
    externalAccountId: row.external_account_id,
    providerPaymentId: row.provider_payment_id,
    providerRequestReference: row.provider_request_reference,
    invoiceId: row.invoice_id,
    reason,
    attemptCount: row.attempt_count,
    createdAt: new Date(row.created_at).toISOString(),
    leaseOwner: row.lease_owner,
    registrationId: row.registration_id,
    activationState: row.activation_state,
    providerMode: row.provider_mode,
    providerAccountId: row.provider_account_id,
    apiCredentialRef: row.api_credential_ref
  };
}

async function sweepExhaustedMeta(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  now: string,
  maxAttempts: number,
  limit: number
): Promise<number> {
  const result = await client.query<{ external_account_id: string }>(
    `/* cp15:sweep-exhausted-meta */
     with exhausted as (
       select id from meta_whatsapp_reconciliation_jobs
        where tenant_id = $1 and clinic_id = $2 and attempt_count >= $4
          and (
            (status in ('pending', 'provider_unavailable')
              and (next_attempt_at is null or next_attempt_at <= $3::timestamptz))
            or (status = 'leased' and lease_expires_at <= $3::timestamptz)
          )
        order by created_at, id limit $5 for update skip locked
     )
     update meta_whatsapp_reconciliation_jobs job
        set status = 'dead_lettered', lease_owner = null, lease_expires_at = null,
            next_attempt_at = null,
            last_safe_error_code = 'reconciliation_attempts_exhausted'
       from exhausted
      where job.id = exhausted.id
     returning job.external_account_id`,
    [scope.tenantId, scope.clinicId, now, maxAttempts, limit]
  );
  await finalizeExhaustedRegistrations(
    client,
    scope,
    "meta_whatsapp_cloud",
    result.rows.map((row) => row.external_account_id),
    now
  );
  return result.rows.length;
}

async function sweepExhaustedRazorpay(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  now: string,
  maxAttempts: number,
  limit: number
): Promise<number> {
  const result = await client.query<{ external_account_id: string }>(
    `/* cp15:sweep-exhausted-razorpay */
     with exhausted as (
       select id from razorpay_reconciliation_jobs
        where tenant_id = $1 and clinic_id = $2 and attempt_count >= $4
          and (
            status = 'pending'
            or (status = 'retry_scheduled' and next_attempt_at <= $3::timestamptz)
            or (status = 'leased' and lease_expires_at <= $3::timestamptz)
          )
        order by created_at, id limit $5 for update skip locked
     )
     update razorpay_reconciliation_jobs job
        set status = 'dead_lettered', lease_owner = null, lease_expires_at = null,
            next_attempt_at = null, last_error_code = 'reconciliation_attempts_exhausted'
       from exhausted
      where job.id = exhausted.id
     returning job.external_account_id`,
    [scope.tenantId, scope.clinicId, now, maxAttempts, limit]
  );
  await finalizeExhaustedRegistrations(
    client,
    scope,
    "razorpay",
    result.rows.map((row) => row.external_account_id),
    now
  );
  return result.rows.length;
}

async function finalizeExhaustedRegistrations(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  providerKey: "meta_whatsapp_cloud" | "razorpay",
  externalAccountIds: readonly string[],
  at: string
): Promise<void> {
  const uniqueIds = [...new Set(externalAccountIds)];
  if (uniqueIds.length === 0) return;
  const updated = await client.query<{ id: string }>(
    `/* cp15:finalize-exhausted-registration */
     update provider_callback_registrations
        set last_reconciled_at = case
              when last_reconciled_at is null or last_reconciled_at < $5::timestamptz
              then $5::timestamptz else last_reconciled_at end,
            last_failure_code = 'reconciliation_attempts_exhausted',
            row_version = row_version + 1
      where tenant_id = $1 and clinic_id = $2 and provider_key = $3
        and external_account_id = any($4::uuid[])
     returning id`,
    [scope.tenantId, scope.clinicId, providerKey, uniqueIds, at]
  );
  if (updated.rows.length !== uniqueIds.length) {
    throw new Error("Exhausted provider reconciliation has no unique registration.");
  }
}

async function lockMetaLeaseAndRegistration(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  job: MetaClaim
): Promise<boolean> {
  const result = await client.query<{ registration_id: string }>(
    `/* cp15:lock-meta-reconciliation */
     select registration.id as registration_id
       from meta_whatsapp_reconciliation_jobs job
       join provider_callback_registrations registration
         on registration.tenant_id = job.tenant_id
        and registration.clinic_id = job.clinic_id
        and registration.external_account_id = job.external_account_id
        and registration.provider_key = 'meta_whatsapp_cloud'
      where job.tenant_id = $1 and job.clinic_id = $2 and job.id = $3
        and job.status = 'leased' and job.lease_owner = $4
        and registration.id = $5
      for update of job, registration`,
    [scope.tenantId, scope.clinicId, job.id, job.leaseOwner, job.registrationId]
  );
  return result.rows.length === 1;
}

async function lockRazorpayLeaseAndRegistration(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  job: RazorpayClaim
): Promise<RegistrationLeaseRow | null> {
  const result = await client.query<RegistrationLeaseRow>(
    `/* cp15:lock-razorpay-reconciliation */
     select registration.id as registration_id, registration.api_credential_ref
       from razorpay_reconciliation_jobs job
       join provider_callback_registrations registration
         on registration.tenant_id = job.tenant_id
        and registration.clinic_id = job.clinic_id
        and registration.external_account_id = job.external_account_id
        and registration.provider_key = 'razorpay'
      where job.tenant_id = $1 and job.clinic_id = $2 and job.id = $3
        and job.status = 'leased' and job.lease_owner = $4
        and registration.id = $5
      for update of job, registration`,
    [scope.tenantId, scope.clinicId, job.id, job.leaseOwner, job.registrationId]
  );
  if (result.rows.length > 1) throw new Error("Razorpay reconciliation registration is ambiguous.");
  return result.rows[0] ?? null;
}

async function updateRegistration(
  client: PoolClient,
  scope: ProviderReconciliationScope,
  registrationId: string,
  input: {
    readonly at: string;
    readonly reconciled: boolean;
    readonly healthChecked: boolean;
    readonly failureCode: string | null;
  }
): Promise<void> {
  const failureCode = input.failureCode === null ? null : safeCode(input.failureCode);
  const updated = await client.query<{ id: string }>(
    `/* cp15:update-reconciliation-registration */
     update provider_callback_registrations
        set last_health_check_at = case
              when $4::boolean and (last_health_check_at is null or last_health_check_at < $5::timestamptz)
              then $5::timestamptz else last_health_check_at end,
            last_reconciled_at = case
              when $6::boolean and (last_reconciled_at is null or last_reconciled_at < $5::timestamptz)
              then $5::timestamptz else last_reconciled_at end,
            last_failure_code = $7,
            row_version = row_version + 1
      where tenant_id = $1 and clinic_id = $2 and id = $3
     returning id`,
    [
      scope.tenantId,
      scope.clinicId,
      registrationId,
      input.healthChecked,
      input.at,
      input.reconciled,
      failureCode
    ]
  );
  if (updated.rows.length !== 1) {
    throw new Error("Provider reconciliation registration update failed.");
  }
}

function decidePaymentSnapshot(
  reason: RazorpayReason,
  snapshot: RazorpayPaymentSnapshot
): RazorpayDecision {
  const snapshotDigest = sha256({
    providerPaymentId: snapshot.providerPaymentId,
    amountMinor: snapshot.amountMinor,
    amountRefundedMinor: snapshot.amountRefundedMinor,
    currency: snapshot.currency,
    status: snapshot.status,
    captured: snapshot.captured,
    providerRequestId: snapshot.providerRequestId
  });
  if (reason === "provider_outage") {
    return { status: "matched", snapshotDigest, failureCode: null };
  }
  if (reason === "provider_not_captured") {
    return snapshot.captured
      ? { status: "matched", snapshotDigest, failureCode: null }
      : { status: "variance", snapshotDigest, failureCode: "provider_not_captured" };
  }
  if (reason === "missing_local_capture") {
    return snapshot.captured
      ? { status: "variance", snapshotDigest, failureCode: "missing_local_capture" }
      : { status: "matched", snapshotDigest, failureCode: null };
  }
  if (reason === "currency_mismatch") {
    return snapshot.currency === "INR"
      ? { status: "matched", snapshotDigest, failureCode: null }
      : { status: "variance", snapshotDigest, failureCode: "currency_mismatch" };
  }
  if (reason === "amount_mismatch") {
    return { status: "variance", snapshotDigest, failureCode: "amount_mismatch" };
  }
  if (reason === "refund_mismatch") {
    return { status: "variance", snapshotDigest, failureCode: "refund_mismatch" };
  }
  throw new Error("Creation-outcome reconciliation requires a collection lookup.");
}

function validPaymentSnapshot(
  snapshot: RazorpayPaymentSnapshot,
  expectedPaymentId: string
): RazorpayPaymentSnapshot {
  if (
    snapshot.providerPaymentId !== expectedPaymentId ||
    !boundedProviderId(snapshot.providerPaymentId) ||
    !Number.isSafeInteger(snapshot.amountMinor) ||
    snapshot.amountMinor < 0 ||
    !Number.isSafeInteger(snapshot.amountRefundedMinor) ||
    snapshot.amountRefundedMinor < 0 ||
    snapshot.amountRefundedMinor > snapshot.amountMinor ||
    typeof snapshot.currency !== "string" ||
    !/^[A-Z]{3}$/u.test(snapshot.currency) ||
    typeof snapshot.status !== "string" ||
    !snapshot.status.trim() ||
    snapshot.status.length > 64 ||
    typeof snapshot.captured !== "boolean" ||
    (snapshot.providerRequestId !== null && !boundedProviderId(snapshot.providerRequestId))
  ) {
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: "Razorpay payment reconciliation snapshot is invalid."
    });
  }
  return snapshot;
}

function validCreationLookup(
  lookup: RazorpayCreationLookupResult,
  invoiceId: string
): RazorpayCreationLookupResult {
  if (
    !lookup ||
    !["found", "not_found", "inconclusive", "ambiguous"].includes(lookup.outcome) ||
    !Number.isInteger(lookup.searchedQrPages) ||
    lookup.searchedQrPages < 1 ||
    lookup.searchedQrPages > 5
  ) {
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: "Razorpay creation reconciliation result is invalid."
    });
  }
  if (lookup.outcome === "found") validateCollection(lookup.collection, invoiceId);
  if (lookup.outcome === "ambiguous") {
    if (
      !["multiple_matches", "scope_mismatch"].includes(lookup.reason) ||
      lookup.collections.length > 10
    ) {
      throw new RazorpayBoundaryError({
        code: "PROVIDER_REJECTED",
        message: "Razorpay creation reconciliation ambiguity is invalid."
      });
    }
    for (const collection of lookup.collections) validateCollection(collection, invoiceId);
  }
  return lookup;
}

function validateCollection(
  collection: RazorpayCreationCollectionSnapshot,
  invoiceId: string
): void {
  if (
    !boundedProviderId(collection.providerRequestId) ||
    (collection.kind !== "payment_link" && collection.kind !== "invoice_qr") ||
    collection.referenceId !== invoiceId ||
    !Number.isSafeInteger(collection.amountMinor) ||
    collection.amountMinor < 0 ||
    (collection.currency !== null && !/^[A-Z]{3}$/u.test(collection.currency)) ||
    !collection.status.trim() ||
    collection.status.length > 64 ||
    !Number.isSafeInteger(collection.createdAtEpochSeconds) ||
    collection.createdAtEpochSeconds < 0
  ) {
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: "Razorpay collection reconciliation snapshot is invalid."
    });
  }
}

function canonicalCreationLookup(lookup: RazorpayCreationLookupResult): unknown {
  if (lookup.outcome === "found") {
    return { outcome: lookup.outcome, collection: lookup.collection };
  }
  if (lookup.outcome === "ambiguous") {
    return {
      outcome: lookup.outcome,
      reason: lookup.reason,
      collections: [...lookup.collections].sort((left, right) =>
        `${left.kind}:${left.providerRequestId}`.localeCompare(
          `${right.kind}:${right.providerRequestId}`
        )
      )
    };
  }
  return { outcome: lookup.outcome };
}

function parseRazorpayCredential(
  value: string,
  providerMode: "test" | "live"
): { keyId: string; keySecret: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Razorpay credential material is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Razorpay credential material is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  const expectedPrefix = providerMode === "test" ? "rzp_test_" : "rzp_live_";
  if (
    Object.keys(record).some((key) => !["keyId", "keySecret"].includes(key)) ||
    typeof record.keyId !== "string" ||
    !record.keyId.startsWith(expectedPrefix) ||
    !/^rzp_(?:test|live)_[A-Za-z0-9]{6,128}$/u.test(record.keyId) ||
    typeof record.keySecret !== "string" ||
    record.keySecret.length < 16 ||
    record.keySecret.length > 512
  ) {
    throw new Error("Razorpay credential material is invalid.");
  }
  return { keyId: record.keyId, keySecret: record.keySecret };
}

function providerFailureCode(error: unknown): string {
  if (!(error instanceof RazorpayBoundaryError)) return "provider_client_failure";
  switch (error.code) {
    case "PROVIDER_RATE_LIMITED":
      return "provider_rate_limited";
    case "PROVIDER_UNAVAILABLE":
      return "provider_unavailable";
    case "NOT_CONFIGURED":
      return "provider_not_configured";
    case "PROVIDER_REJECTED":
      return "provider_response_rejected";
    default:
      return "provider_client_failure";
  }
}

async function scopedTransaction<T>(
  pool: Pick<Pool, "connect">,
  scope: ProviderReconciliationScope,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of buildSetLocalRlsStatements({
      tenantId: scope.tenantId as ClinicUuid,
      clinicId: scope.clinicId as ClinicUuid,
      userId: null
    })) {
      await client.query(statement.sql, [...statement.values]);
    }
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function validScope(scope: ProviderReconciliationScope): ProviderReconciliationScope {
  if (!UUID.test(scope.tenantId) || !UUID.test(scope.clinicId)) {
    throw new Error("Provider reconciliation requires valid tenant and clinic scope.");
  }
  return { tenantId: scope.tenantId, clinicId: scope.clinicId };
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedProviderId(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && !/[\s/?#\0\r\n]/u.test(value);
}

function safeCode(value: string): string {
  if (!SAFE_CODE.test(value)) throw new Error("Provider reconciliation failure code is invalid.");
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
