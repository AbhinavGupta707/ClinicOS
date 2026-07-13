import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { RazorpayBoundaryError } from "@clinic-os/integrations";
import {
  ProviderReconciliationProcessor,
  type RazorpayCreationLookupResult,
  type RazorpayReconciliationProviderClient
} from "../cp15/provider-reconciliation-processor.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";
const externalAccountId = "10000000-0000-4000-8000-000000000003";
const metaRegistrationId = "10000000-0000-4000-8000-000000000004";
const razorpayRegistrationId = "10000000-0000-4000-8000-000000000005";
const metaJobId = "10000000-0000-4000-8000-000000000006";
const razorpayJobId = "10000000-0000-4000-8000-000000000007";
const invoiceId = "10000000-0000-4000-8000-000000000008";
const providerRequestReference = "10000000-0000-4000-8000-000000000009";
const credentialRef =
  "arn:aws:secretsmanager:ap-south-1:123456789012:secret:clinicos/razorpay/synthetic";
const fixedNow = "2026-07-13T10:00:00.000Z";

test("claims scoped jobs transactionally, resolves Razorpay GET truth, and leaves Meta manual", async () => {
  const harness = new ProcessorHarness({
    metaClaims: [metaClaim()],
    razorpayClaims: [razorpayClaim({ reason: "provider_not_captured" })]
  });
  const processor = harness.processor({
    async lookupPayment(providerPaymentId) {
      return paymentFound({ providerPaymentId, captured: true, status: "captured" });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.deepEqual(result, {
    claimed: 2,
    matched: 1,
    variances: 0,
    retriesScheduled: 0,
    deadLettered: 0,
    manualReview: 1,
    leaseLost: 0
  });
  assert.equal(harness.secretReferences.length, 1);
  assert.equal(harness.secretReferences[0], credentialRef);
  assert.equal(
    harness.sql("claim-meta-reconciliation").includes("for update of job skip locked"),
    true
  );
  assert.equal(
    harness.sql("claim-razorpay-reconciliation").includes("for update of job skip locked"),
    true
  );
  assert.equal(harness.sql("claim-meta-reconciliation").includes("lease_expires_at <="), true);
  assert.equal(harness.queryValues("finalize-meta-unsupported")[4], undefined);
  assert.equal(
    harness.queries.some((query) =>
      /update\s+(?:invoices|payment_requests|payment_transactions)/iu.test(query.sql)
    ),
    false
  );
  assertScopedTransactions(harness);
  assertRegistrationFinalized(harness, "authoritative_lookup_unsupported", false, true);
  assertRegistrationFinalized(harness, null, true, true);
});

test("authoritative payment snapshots preserve variance without inventing a local payment effect", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "amount_mismatch" })]
  });
  const processor = harness.processor({
    async lookupPayment(providerPaymentId) {
      return paymentFound({ providerPaymentId, amountMinor: 31_000, captured: true });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.variances, 1);
  const values = harness.queryValues("finalize-razorpay-decision");
  assert.equal(values[4], "variance");
  assert.match(String(values[5]), /^[0-9a-f]{64}$/u);
  assert.equal(values[6], "amount_mismatch");
  assert.equal(
    harness.queries.some((query) => query.sql.includes("razorpay_business_effects")),
    false
  );
  assert.equal(
    harness.queries.some((query) => query.sql.includes("payment_transactions")),
    false
  );
});

test("degraded registrations can perform read-only recovery without inventing health", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "provider_outage", activationState: "degraded" })]
  });
  const processor = harness.processor({
    async lookupPayment(providerPaymentId) {
      return paymentFound({ providerPaymentId });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.matched, 1);
  assert.equal(harness.secretReferences.length, 1);
  assertRegistrationFinalized(harness, null, true, true);
});

test("provider outages schedule bounded backoff and exhaust exactly at the frozen attempt ceiling", async () => {
  const retryHarness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ attemptCount: 2, reason: "provider_outage" })]
  });
  const retryProcessor = retryHarness.processor({
    async lookupPayment() {
      throw new RazorpayBoundaryError({
        code: "PROVIDER_UNAVAILABLE",
        message: "synthetic outage",
        retryable: true
      });
    }
  });
  const retryResult = await retryProcessor.pollOnce({ tenantId, clinicId });
  assert.equal(retryResult.retriesScheduled, 1);
  const retryValues = retryHarness.queryValues("finalize-razorpay-failure");
  assert.equal(retryValues[4], "retry_scheduled");
  assert.equal(retryValues[5], "provider_unavailable");
  const nextAttemptAt = Date.parse(String(retryValues[6]));
  assert.equal(nextAttemptAt > Date.parse(fixedNow) + 10_000, true);
  assert.equal(nextAttemptAt <= Date.parse(fixedNow) + 12_000, true);
  assertRegistrationFinalized(retryHarness, "provider_unavailable", true, false);

  const exhaustedHarness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ attemptCount: 8, reason: "provider_outage" })]
  });
  const exhaustedProcessor = exhaustedHarness.processor({
    async lookupPayment() {
      throw new RazorpayBoundaryError({
        code: "PROVIDER_RATE_LIMITED",
        message: "synthetic rate limit",
        retryable: true
      });
    }
  });
  const exhaustedResult = await exhaustedProcessor.pollOnce({ tenantId, clinicId });
  assert.equal(exhaustedResult.deadLettered, 1);
  const exhaustedValues = exhaustedHarness.queryValues("finalize-razorpay-failure");
  assert.equal(exhaustedValues[4], "dead_lettered");
  assert.equal(exhaustedValues[5], "provider_rate_limited");
  assert.equal(exhaustedValues[6], null);
  assertRegistrationFinalized(exhaustedHarness, "provider_rate_limited", true, true);
});

test("only the typed authoritative missing-payment outcome becomes variance", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "missing_local_capture" })]
  });
  const processor = harness.processor({
    async lookupPayment() {
      return { outcome: "not_found" };
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.variances, 1);
  const values = harness.queryValues("finalize-razorpay-decision");
  assert.equal(values[4], "variance");
  assert.equal(values[6], "provider_payment_not_found");
  assertRegistrationFinalized(harness, "provider_payment_not_found", true, true);
});

test("non-authoritative payment 400/404 errors retry without becoming absence", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "missing_local_capture" })]
  });
  const processor = harness.processor({
    async lookupPayment() {
      throw new RazorpayBoundaryError({
        code: "PROVIDER_REJECTED",
        message: "synthetic bounded rejection",
        safeDetails: { status: 400, operation: "fetch_payment_by_id" }
      });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.variances, 0);
  assert.equal(result.retriesScheduled, 1);
  assert.equal(harness.indexOf("finalize-razorpay-decision"), -1);
  assert.equal(harness.queryValues("finalize-razorpay-failure")[5], "provider_response_rejected");
});

test("creation-outcome lookup confirms only collection creation, never paid or captured state", async () => {
  let lookupInput: Record<string, unknown> | undefined;
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ creationOutcome: true })]
  });
  const processor = harness.processor({
    async findCollectionByInvoiceReference(input) {
      lookupInput = { ...input };
      return creationFound({ status: "paid" });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.matched, 1);
  assert.deepEqual(lookupInput, {
    tenantId,
    clinicId,
    invoiceId,
    providerRequestReference,
    jobCreatedAt: fixedNow
  });
  const values = harness.queryValues("finalize-razorpay-decision");
  assert.equal(values[4], "matched");
  assert.equal(values[6], null);
  assert.equal(
    harness.queries.some((query) => /\bpaid\b|\bcaptured\b/iu.test(query.sql)),
    false
  );
});

test("creation absence stays retryable while duplicate official evidence is variance", async () => {
  const missingHarness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ creationOutcome: true })]
  });
  const missingProcessor = missingHarness.processor({
    async findCollectionByInvoiceReference() {
      return { outcome: "not_found", searchedQrPages: 1 };
    }
  });
  const missingResult = await missingProcessor.pollOnce({ tenantId, clinicId });
  assert.equal(missingResult.retriesScheduled, 1);
  assert.equal(
    missingHarness.queryValues("finalize-razorpay-failure")[5],
    "provider_result_not_visible"
  );

  const duplicateHarness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ creationOutcome: true })]
  });
  const duplicateProcessor = duplicateHarness.processor({
    async findCollectionByInvoiceReference() {
      return {
        outcome: "ambiguous",
        reason: "multiple_matches",
        searchedQrPages: 1,
        collections: [
          creationCollection({ providerRequestId: "plink_synthetic_1" }),
          creationCollection({ providerRequestId: "qr_synthetic_2", kind: "invoice_qr" })
        ]
      };
    }
  });
  const duplicateResult = await duplicateProcessor.pollOnce({ tenantId, clinicId });
  assert.equal(duplicateResult.variances, 1);
  assert.equal(
    duplicateHarness.queryValues("finalize-razorpay-decision")[6],
    "provider_creation_ambiguous"
  );
});

test("concurrent lease replacement rejects stale finalization without touching registration truth", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "provider_outage" })],
    razorpayLeasePresent: false
  });
  const processor = harness.processor({
    async lookupPayment(providerPaymentId) {
      return paymentFound({ providerPaymentId });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.leaseLost, 1);
  const lockIndex = harness.indexOf("lock-razorpay-reconciliation");
  assert.notEqual(lockIndex, -1);
  const afterRejectedLock = harness.queries
    .slice(lockIndex + 1)
    .map((query) => query.sql)
    .join("\n");
  assert.doesNotMatch(afterRejectedLock, /update\s+razorpay_reconciliation_jobs/iu);
  assert.doesNotMatch(afterRejectedLock, /update\s+provider_callback_registrations/iu);
});

test("every claimed registration field is revalidated before a provider decision finalizes", async (t) => {
  const changedRegistrationId = "20000000-0000-4000-8000-000000000005";
  const cases: readonly [string, NonNullable<HarnessOptions["currentRegistration"]>, string][] = [
    ["registration id", { id: changedRegistrationId }, changedRegistrationId],
    ["activation", { activationState: "disabled" }, razorpayRegistrationId],
    ["provider mode", { providerMode: "live" }, razorpayRegistrationId],
    ["provider account", { providerAccountId: "rzp_live_account" }, razorpayRegistrationId],
    [
      "credential reference",
      {
        apiCredentialRef:
          "arn:aws:secretsmanager:ap-south-1:123456789012:secret:clinicos/razorpay/rotated"
      },
      razorpayRegistrationId
    ]
  ];

  for (const [name, currentRegistration, expectedRegistrationId] of cases) {
    await t.test(name, async () => {
      const harness = new ProcessorHarness({
        razorpayClaims: [razorpayClaim({ reason: "provider_outage" })],
        currentRegistration
      });
      const result = await harness.processor().pollOnce({ tenantId, clinicId });

      assert.equal(result.matched, 0);
      assert.equal(result.retriesScheduled, 1);
      assert.equal(harness.indexOf("finalize-razorpay-decision"), -1);
      assert.equal(
        harness.queryValues("finalize-razorpay-failure")[5],
        "provider_registration_changed"
      );
      const registrationUpdate = harness.queries.find((query) =>
        query.sql.includes("update-reconciliation-registration")
      );
      assert.ok(registrationUpdate);
      assert.equal(registrationUpdate.values[2], expectedRegistrationId);
      assert.equal(registrationUpdate.values[3], false);
    });
  }
});

test("registration drift replaces a provider failure without claiming stale health", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "provider_outage" })],
    currentRegistration: { providerAccountId: "rzp_changed_account" }
  });
  const processor = harness.processor({
    async lookupPayment() {
      throw new RazorpayBoundaryError({
        code: "PROVIDER_UNAVAILABLE",
        message: "synthetic outage",
        retryable: true
      });
    }
  });

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.retriesScheduled, 1);
  assert.equal(
    harness.queryValues("finalize-razorpay-failure")[5],
    "provider_registration_changed"
  );
  assertRegistrationFinalized(harness, "provider_registration_changed", false, false);
});

test("sequential batches stop provider reads when the remaining lease cannot cover the declared budget", async () => {
  let nowMs = Date.parse(fixedNow);
  let providerCalls = 0;
  const harness = new ProcessorHarness({
    razorpayClaims: [
      razorpayClaim({ creationOutcome: true }),
      razorpayClaim({
        id: "20000000-0000-4000-8000-000000000007",
        creationOutcome: true,
        providerRequestReference: "20000000-0000-4000-8000-000000000009"
      })
    ]
  });
  const processor = harness.processor(
    {
      async findCollectionByInvoiceReference() {
        providerCalls += 1;
        nowMs += 114_000;
        return creationFound();
      }
    },
    { now: () => new Date(nowMs) }
  );

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.claimed, 2);
  assert.equal(result.matched, 1);
  assert.equal(result.retriesScheduled, 1);
  assert.equal(providerCalls, 1);
  const failures = harness.queries.filter((query) =>
    query.sql.includes("finalize-razorpay-failure")
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.values[5], "provider_lease_budget_insufficient");
});

test("credential rotation is a registration-change race without false health", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "provider_outage" })],
    currentRegistration: {
      apiCredentialRef:
        "arn:aws:secretsmanager:ap-south-1:123456789012:secret:clinicos/razorpay/rotated"
    },
    secretFailure: true
  });
  const processor = harness.processor();

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.retriesScheduled, 1);
  assert.equal(
    harness.queryValues("finalize-razorpay-failure")[5],
    "provider_registration_changed"
  );
  assertRegistrationFinalized(harness, "provider_registration_changed", false, false);
});

test("stale max-attempt jobs are swept to dead letter atomically with registration truth", async () => {
  const harness = new ProcessorHarness({ exhaustedMetaAccounts: [externalAccountId] });
  const processor = harness.processor();

  const result = await processor.pollOnce({ tenantId, clinicId });
  assert.equal(result.deadLettered, 1);
  const sweepSql = harness.sql("sweep-exhausted-meta");
  assert.match(sweepSql, /status = 'leased' and lease_expires_at <=/u);
  assert.match(sweepSql, /status = 'dead_lettered'/u);
  const registrationValues = harness.queryValues("finalize-exhausted-registration");
  assert.equal(registrationValues[2], "meta_whatsapp_cloud");
  assert.deepEqual(registrationValues[3], [externalAccountId]);
});

test("registration update failure rolls back the job finalization transaction", async () => {
  const harness = new ProcessorHarness({
    razorpayClaims: [razorpayClaim({ reason: "provider_outage" })],
    registrationUpdateSucceeds: false
  });
  const processor = harness.processor({
    async lookupPayment(providerPaymentId) {
      return paymentFound({ providerPaymentId });
    }
  });

  await assert.rejects(processor.pollOnce({ tenantId, clinicId }), /registration update failed/u);
  const finalizationIndex = harness.indexOf("finalize-razorpay-decision");
  assert.equal(
    harness.queries.slice(finalizationIndex).some((query) => query.sql === "rollback"),
    true
  );
  assert.equal(
    harness.queries.slice(finalizationIndex).some((query) => query.sql === "commit"),
    false
  );
});

test("scope and worker bounds fail before any durable or provider access", async () => {
  const harness = new ProcessorHarness();
  assert.throws(
    () => harness.processor({}, { workerId: "unsafe worker id" }),
    /workerId is invalid/u
  );
  await assert.rejects(
    harness.processor().pollOnce({ tenantId: "not-a-uuid", clinicId }),
    /valid tenant and clinic scope/u
  );
  assert.equal(harness.queries.length, 0);
});

interface HarnessOptions {
  readonly metaClaims?: readonly Record<string, unknown>[];
  readonly razorpayClaims?: readonly Record<string, unknown>[];
  readonly exhaustedMetaAccounts?: readonly string[];
  readonly exhaustedRazorpayAccounts?: readonly string[];
  readonly metaLeasePresent?: boolean;
  readonly razorpayLeasePresent?: boolean;
  readonly currentRegistration?: Partial<{
    readonly id: string;
    readonly activationState: string;
    readonly providerMode: string;
    readonly providerAccountId: string;
    readonly apiCredentialRef: string | null;
  }>;
  readonly secretFailure?: boolean;
  readonly registrationUpdateSucceeds?: boolean;
}

interface QueryRecord {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class ProcessorHarness {
  readonly queries: QueryRecord[] = [];
  readonly secretReferences: string[] = [];
  readonly #options: HarnessOptions;

  constructor(options: HarnessOptions = {}) {
    this.#options = options;
  }

  processor(
    clientOverrides: Partial<RazorpayReconciliationProviderClient> = {},
    optionOverrides: Partial<{
      workerId: string;
      leaseMs: number;
      now: () => Date;
    }> = {}
  ): ProviderReconciliationProcessor {
    const defaultClient: RazorpayReconciliationProviderClient = {
      maximumPaymentLookupDurationMs: 19_000,
      maximumCreationLookupDurationMs: 114_000,
      async lookupPayment(providerPaymentId) {
        return paymentFound({ providerPaymentId });
      },
      async findCollectionByInvoiceReference() {
        return creationFound();
      },
      ...clientOverrides
    };
    return new ProviderReconciliationProcessor({
      pool: this.pool(),
      workerId: optionOverrides.workerId ?? "cp15-reconciliation-worker",
      razorpaySecrets: {
        resolveSecret: async (reference) => {
          this.secretReferences.push(reference);
          if (this.#options.secretFailure) throw new Error("synthetic secret failure");
          return JSON.stringify({
            keyId: "rzp_test_synthetic123",
            keySecret: "synthetic-key-secret-value"
          });
        }
      },
      createRazorpayClient: () => defaultClient,
      leaseMs: optionOverrides.leaseMs,
      baseRetryDelayMs: 5_000,
      maxRetryDelayMs: 60_000,
      now: optionOverrides.now ?? (() => new Date(fixedNow))
    });
  }

  pool(): Pick<Pool, "connect"> {
    return {
      connect: async () =>
        ({
          query: async (sql: string, values: readonly unknown[] = []) => {
            const normalized = sql.trim();
            this.queries.push({ sql: normalized, values });
            return { rows: this.rowsFor(normalized) };
          },
          release() {}
        }) as never
    };
  }

  rowsFor(sql: string): readonly Record<string, unknown>[] {
    if (sql === "begin" || sql === "commit" || sql === "rollback") return [];
    if (sql.includes("set_config(")) return [];
    if (sql.includes("sweep-exhausted-meta")) {
      return (this.#options.exhaustedMetaAccounts ?? []).map((id) => ({ external_account_id: id }));
    }
    if (sql.includes("sweep-exhausted-razorpay")) {
      return (this.#options.exhaustedRazorpayAccounts ?? []).map((id) => ({
        external_account_id: id
      }));
    }
    if (sql.includes("finalize-exhausted-registration")) {
      const count =
        (this.#options.exhaustedMetaAccounts?.length ?? 0) +
        (this.#options.exhaustedRazorpayAccounts?.length ?? 0);
      return Array.from({ length: count }, (_, index) => ({ id: `registration-${index}` }));
    }
    if (sql.includes("claim-meta-reconciliation")) return this.#options.metaClaims ?? [];
    if (sql.includes("claim-razorpay-reconciliation")) return this.#options.razorpayClaims ?? [];
    if (sql.includes("lock-meta-reconciliation")) {
      return this.#options.metaLeasePresent === false
        ? []
        : [{ registration_id: metaRegistrationId }];
    }
    if (sql.includes("lock-razorpay-reconciliation")) {
      const claimed = this.#options.razorpayClaims?.[0];
      return this.#options.razorpayLeasePresent === false
        ? []
        : [
            {
              registration_id:
                this.#options.currentRegistration?.id ??
                String(claimed?.registration_id ?? razorpayRegistrationId),
              activation_state:
                this.#options.currentRegistration?.activationState ??
                String(claimed?.activation_state ?? "sandbox_verified"),
              provider_mode:
                this.#options.currentRegistration?.providerMode ??
                String(claimed?.provider_mode ?? "test"),
              provider_account_id:
                this.#options.currentRegistration?.providerAccountId ??
                String(claimed?.provider_account_id ?? "rzp_test_account"),
              api_credential_ref:
                this.#options.currentRegistration?.apiCredentialRef ?? credentialRef
            }
          ];
    }
    if (
      sql.includes("finalize-meta-unsupported") ||
      sql.includes("finalize-razorpay-decision") ||
      sql.includes("finalize-razorpay-failure")
    ) {
      return [{ id: "updated-job" }];
    }
    if (sql.includes("update-reconciliation-registration")) {
      return this.#options.registrationUpdateSucceeds === false
        ? []
        : [{ id: "updated-registration" }];
    }
    throw new Error(`Unexpected processor SQL: ${sql}`);
  }

  sql(marker: string): string {
    const query = this.queries.find((candidate) => candidate.sql.includes(marker));
    assert.ok(query, `Expected SQL marker ${marker}`);
    return query.sql;
  }

  queryValues(marker: string): readonly unknown[] {
    const query = this.queries.find((candidate) => candidate.sql.includes(marker));
    assert.ok(query, `Expected query marker ${marker}`);
    return query.values;
  }

  indexOf(marker: string): number {
    return this.queries.findIndex((candidate) => candidate.sql.includes(marker));
  }
}

function metaClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: metaJobId,
    external_account_id: externalAccountId,
    reason: "dispatch_ambiguous",
    attempt_count: 1,
    lease_owner: "cp15-reconciliation-worker:meta:synthetic",
    registration_id: metaRegistrationId,
    ...overrides
  };
}

function razorpayClaim(
  input: {
    readonly attemptCount?: number;
    readonly reason?: string;
    readonly creationOutcome?: boolean;
    readonly activationState?: string;
    readonly id?: string;
    readonly leaseExpiresAt?: string;
    readonly providerRequestReference?: string;
  } = {}
): Record<string, unknown> {
  return {
    id: input.id ?? razorpayJobId,
    external_account_id: externalAccountId,
    provider_payment_id: input.creationOutcome ? null : "pay_synthetic_1",
    provider_request_reference: input.creationOutcome
      ? (input.providerRequestReference ?? providerRequestReference)
      : null,
    invoice_id: invoiceId,
    reason: input.creationOutcome
      ? "creation_outcome_unknown"
      : (input.reason ?? "provider_outage"),
    attempt_count: input.attemptCount ?? 1,
    created_at: fixedNow,
    lease_owner: "cp15-reconciliation-worker:razorpay:synthetic",
    lease_expires_at:
      input.leaseExpiresAt ?? new Date(Date.parse(fixedNow) + 180_000).toISOString(),
    registration_id: razorpayRegistrationId,
    activation_state: input.activationState ?? "sandbox_verified",
    provider_mode: "test",
    provider_account_id: "rzp_test_account",
    api_credential_ref: credentialRef
  };
}

function paymentSnapshot(
  overrides: Partial<{
    providerPaymentId: string;
    amountMinor: number;
    amountRefundedMinor: number;
    currency: string;
    status: string;
    captured: boolean;
    providerRequestId: string | null;
  }> = {}
) {
  return {
    providerPaymentId: overrides.providerPaymentId ?? "pay_synthetic_1",
    amountMinor: overrides.amountMinor ?? 25_000,
    amountRefundedMinor: overrides.amountRefundedMinor ?? 0,
    currency: overrides.currency ?? "INR",
    status: overrides.status ?? "authorized",
    captured: overrides.captured ?? false,
    providerRequestId: overrides.providerRequestId ?? "plink_synthetic_1"
  };
}

function paymentFound(overrides: Parameters<typeof paymentSnapshot>[0] = {}): {
  readonly outcome: "found";
  readonly payment: ReturnType<typeof paymentSnapshot>;
} {
  return { outcome: "found", payment: paymentSnapshot(overrides) };
}

function creationFound(
  overrides: Partial<{ status: string }> = {}
): Extract<RazorpayCreationLookupResult, { outcome: "found" }> {
  return { outcome: "found", collection: creationCollection(overrides), searchedQrPages: 1 };
}

function creationCollection(
  overrides: Partial<{
    providerRequestId: string;
    kind: "payment_link" | "invoice_qr";
    status: string;
  }> = {}
) {
  return {
    providerRequestId: overrides.providerRequestId ?? "plink_synthetic_1",
    kind: overrides.kind ?? ("payment_link" as const),
    referenceId: invoiceId,
    amountMinor: 25_000,
    currency: "INR",
    status: overrides.status ?? "created",
    createdAtEpochSeconds: 1_783_936_800
  };
}

function assertScopedTransactions(harness: ProcessorHarness): void {
  const tenantContext = harness.queries.filter((query) => query.sql.includes("app.tenant_id"));
  const clinicContext = harness.queries.filter((query) => query.sql.includes("app.clinic_id"));
  const begins = harness.queries.filter((query) => query.sql === "begin");
  const commits = harness.queries.filter((query) => query.sql === "commit");
  assert.equal(tenantContext.length, begins.length);
  assert.equal(clinicContext.length, begins.length);
  assert.equal(commits.length, begins.length);
  assert.equal(
    tenantContext.every((query) => query.values[0] === tenantId),
    true
  );
  assert.equal(
    clinicContext.every((query) => query.values[0] === clinicId),
    true
  );
}

function assertRegistrationFinalized(
  harness: ProcessorHarness,
  failureCode: string | null,
  healthChecked: boolean,
  reconciled: boolean
): void {
  const matching = harness.queries.find(
    (query) =>
      query.sql.includes("update-reconciliation-registration") &&
      query.values[3] === healthChecked &&
      query.values[5] === reconciled &&
      query.values[6] === failureCode
  );
  assert.ok(
    matching,
    `Expected registration finalization ${JSON.stringify({ failureCode, healthChecked, reconciled })}`
  );
}
