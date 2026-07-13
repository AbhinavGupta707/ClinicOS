import assert from "node:assert/strict";
import test from "node:test";
import {
  RazorpayCollectionReconciliationClient,
  type RazorpayCollectionLookupResult
} from "../dist/cp15/razorpay/reconciliation-client.js";
import { RazorpayBoundaryError } from "../dist/cp15/razorpay/errors.js";

const scope = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000002",
  invoiceId: "10000000-0000-4000-8000-000000000003",
  providerRequestReference: "10000000-0000-4000-8000-000000000004",
  jobCreatedAt: "2026-07-13T10:00:00.000Z"
} as const;

test("creation recovery uses exact Payment Link reference and never infers settlement", async () => {
  const urls: string[] = [];
  const client = createClient(async (url) => {
    urls.push(url);
    if (url.includes("/payment_links/")) {
      return ok({
        payment_links: [
          {
            id: "plink_synthetic_1",
            reference_id: scope.invoiceId,
            amount: 25_000,
            currency: "INR",
            status: "paid",
            created_at: 1_783_936_795,
            notes: notes()
          }
        ]
      });
    }
    return ok({ entity: "collection", count: 0, items: [] });
  });

  const result = await client.findCollectionByInvoiceReference(scope);
  assert.equal(result.outcome, "found");
  if (result.outcome !== "found") return;
  assert.equal(result.collection.providerRequestId, "plink_synthetic_1");
  assert.equal(result.collection.status, "paid");
  assert.equal("captured" in result.collection, false);
  assert.equal("paid" in result.collection, false);
  assert.match(urls[0]!, /payment_links\/\?reference_id=10000000-0000-4000-8000-000000000003/u);
  assert.match(urls[1]!, /payments\/qr_codes\?from=1783935900&to=1783937700&count=100&skip=0/u);
});

test("QR recovery paginates official time-bounded listing and binds exact scope notes", async () => {
  const urls: string[] = [];
  const client = createClient(async (url) => {
    urls.push(url);
    if (url.includes("/payment_links/")) return ok({ payment_links: [] });
    if (url.endsWith("skip=0")) {
      return ok({ items: Array.from({ length: 100 }, (_, index) => unrelatedQr(index)) });
    }
    return ok({
      items: [
        {
          id: "qr_synthetic_match",
          entity: "qr_code",
          payment_amount: 25_000,
          status: "active",
          created_at: 1_783_936_805,
          notes: notes()
        }
      ]
    });
  });

  const result = await client.findCollectionByInvoiceReference(scope);
  assert.equal(result.outcome, "found");
  if (result.outcome !== "found") return;
  assert.equal(result.collection.kind, "invoice_qr");
  assert.equal(result.searchedQrPages, 2);
  assert.equal(
    urls.some((url) => url.endsWith("skip=100")),
    true
  );
});

test("duplicate or cross-scope creation evidence remains ambiguous", async () => {
  const client = createClient(async (url) => {
    if (url.includes("/payment_links/")) {
      return ok({
        payment_links: [
          {
            id: "plink_wrong_scope",
            reference_id: scope.invoiceId,
            amount: 25_000,
            currency: "INR",
            status: "created",
            created_at: 1_783_936_800,
            notes: { ...notes(), clinic_os_clinic_id: "20000000-0000-4000-8000-000000000002" }
          }
        ]
      });
    }
    return ok({
      items: [
        {
          id: "qr_right_scope",
          payment_amount: 25_000,
          status: "active",
          created_at: 1_783_936_801,
          notes: notes()
        }
      ]
    });
  });

  const result = await client.findCollectionByInvoiceReference(scope);
  assert.deepEqual(pickAmbiguity(result), {
    outcome: "ambiguous",
    reason: "scope_mismatch",
    ids: ["qr_right_scope"]
  });
});

test("a saturated bounded QR search is inconclusive rather than invented not-found truth", async () => {
  let qrPages = 0;
  const client = createClient(async (url) => {
    if (url.includes("/payment_links/")) return ok({ payment_links: [] });
    qrPages += 1;
    return ok({ items: Array.from({ length: 100 }, (_, index) => unrelatedQr(index)) });
  });

  const result = await client.findCollectionByInvoiceReference(scope);
  assert.deepEqual(result, { outcome: "inconclusive", searchedQrPages: 5 });
  assert.equal(qrPages, 5);
});

test("read-only lookup retries bounded outages and rejects oversized provider responses", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const retrying = new RazorpayCollectionReconciliationClient({
    keyId: "rzp_test_synthetic",
    keySecret: "synthetic-secret-value",
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    transport: async () => {
      calls += 1;
      return { status: 503, headers: {}, body: "unavailable" };
    }
  });
  await assert.rejects(retrying.findCollectionByInvoiceReference(scope), (error: unknown) => {
    assert.ok(error instanceof RazorpayBoundaryError);
    assert.equal(error.code, "PROVIDER_UNAVAILABLE");
    assert.deepEqual(error.safeDetails, {
      status: 503,
      operation: "fetch_payment_links_by_reference"
    });
    assert.equal(JSON.stringify(error.safeDetails).includes(scope.invoiceId), false);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 200]);

  const oversized = createClient(async () => ({
    status: 200,
    headers: {},
    body: "x".repeat(512 * 1024 + 1)
  }));
  await assert.rejects(
    oversized.findCollectionByInvoiceReference(scope),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "PROVIDER_REJECTED"
  );
});

test("payment lookup returns a typed snapshot or exact authoritative absence only", async () => {
  const found = createClient(async () =>
    ok({
      id: "pay_synthetic1",
      amount: 25_000,
      amount_refunded: 500,
      currency: "INR",
      status: "captured",
      captured: true,
      invoice_id: "inv_synthetic1"
    })
  );
  assert.deepEqual(await found.lookupPayment("pay_synthetic1"), {
    outcome: "found",
    payment: {
      providerPaymentId: "pay_synthetic1",
      amountMinor: 25_000,
      amountRefundedMinor: 500,
      currency: "INR",
      status: "captured",
      captured: true,
      providerRequestId: "inv_synthetic1"
    }
  });

  const missing = createClient(async () => ({
    status: 400,
    headers: {},
    body: JSON.stringify({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "The id provided does not exist."
      }
    })
  }));
  assert.deepEqual(await missing.lookupPayment("pay_synthetic1"), { outcome: "not_found" });
  assert.equal(missing.maximumPaymentLookupDurationMs, 19_000);
  assert.equal(missing.maximumCreationLookupDurationMs, 114_000);
});

test("other payment 400/404 responses stay bounded provider rejection, never not-found", async () => {
  for (const [status, body] of [
    [
      400,
      JSON.stringify({
        error: { code: "BAD_REQUEST_ERROR", description: "A different client error." }
      })
    ],
    [404, "not-json"]
  ] as const) {
    const client = createClient(async () => ({ status, headers: {}, body }));
    await assert.rejects(client.lookupPayment("pay_synthetic1"), (error: unknown) => {
      assert.ok(error instanceof RazorpayBoundaryError);
      assert.equal(error.code, "PROVIDER_REJECTED");
      assert.equal(error.safeDetails.operation, "fetch_payment_by_id");
      assert.equal(error.safeDetails.status, status);
      const details = JSON.stringify(error.safeDetails);
      assert.equal(details.includes("pay_synthetic1"), false);
      assert.equal(details.includes("different client error"), false);
      return true;
    });
  }
});

test("credentials and API origin are bounded before any read-only request", () => {
  assert.throws(
    () =>
      new RazorpayCollectionReconciliationClient({
        keyId: "rzp_test_synthetic",
        keySecret: "synthetic-secret-value",
        baseUrl: "https://example.invalid/v1"
      }),
    /official API base URL/u
  );
  assert.throws(
    () =>
      new RazorpayCollectionReconciliationClient({
        keyId: "malformed",
        keySecret: "synthetic-secret-value"
      }),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "NOT_CONFIGURED"
  );
});

function createClient(
  responder: (url: string) => Promise<{ status: number; headers: {}; body: string }>
): RazorpayCollectionReconciliationClient {
  return new RazorpayCollectionReconciliationClient({
    keyId: "rzp_test_synthetic",
    keySecret: "synthetic-secret-value",
    transport: async (request) => responder(request.url),
    sleep: async () => undefined
  });
}

function ok(value: unknown): { status: number; headers: {}; body: string } {
  return { status: 200, headers: {}, body: JSON.stringify(value) };
}

function notes(): Record<string, string> {
  return {
    clinic_os_tenant_id: scope.tenantId,
    clinic_os_clinic_id: scope.clinicId,
    clinic_os_invoice_id: scope.invoiceId
  };
}

function unrelatedQr(index: number): Record<string, unknown> {
  return {
    id: `qr_unrelated_${index}`,
    payment_amount: 100,
    status: "active",
    created_at: 1_783_936_800,
    notes: {
      ...notes(),
      clinic_os_invoice_id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    }
  };
}

function pickAmbiguity(result: RazorpayCollectionLookupResult): {
  outcome: string;
  reason?: string;
  ids?: readonly string[];
} {
  return result.outcome === "ambiguous"
    ? {
        outcome: result.outcome,
        reason: result.reason,
        ids: result.collections.map((collection) => collection.providerRequestId)
      }
    : { outcome: result.outcome };
}
