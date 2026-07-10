import { describe, expect, it, vi } from "vitest";
import {
  loadTreatmentBillingWorkspace,
  type TreatmentBillingGeneratedReadClient
} from "../features/cp13/treatment-billing/loaders";

const FIXED_NOW = "2026-07-10T12:00:00.000Z";

describe("CP13 treatment billing generated-client loader", () => {
  it("loads independent pricebook and invoice reads without a fixture fallback", async () => {
    const listPricebookProcedures = vi.fn(async () => ({
      procedures: [
        {
          id: "10000000-0000-4000-8000-000000000501",
          displayName: "Synthetic procedure",
          defaultUnitPriceMinor: 12_500,
          currency: "INR"
        }
      ]
    }));
    const getInvoice = vi.fn(async () => ({
      invoice: {
        id: "10000000-0000-4000-8000-000000000601",
        invoiceNumber: "SYN-INV-001",
        totalMinor: 12_500,
        paidMinor: 5_000,
        balanceMinor: 7_500,
        paymentStatus: "partially_paid",
        currency: "INR"
      }
    }));
    const client: TreatmentBillingGeneratedReadClient = {
      listPricebookProcedures,
      getInvoice
    };

    await expect(
      loadTreatmentBillingWorkspace(client, {
        invoiceId: "10000000-0000-4000-8000-000000000601",
        now: () => new Date(FIXED_NOW)
      })
    ).resolves.toMatchObject({
      status: "ready",
      loadedAt: FIXED_NOW,
      invoice: { invoiceNumber: "SYN-INV-001" }
    });
    expect(listPricebookProcedures).toHaveBeenCalledOnce();
    expect(getInvoice).toHaveBeenCalledWith({
      path: { invoiceId: "10000000-0000-4000-8000-000000000601" }
    });
  });

  it("shows an honest durable dependency unavailable state", async () => {
    const unavailable = Object.assign(new Error("PostgreSQL unavailable"), {
      name: "ClinicOsApiError",
      code: "DEPENDENCY_UNAVAILABLE",
      requestId: "cp13-request-unavailable"
    });
    const client: TreatmentBillingGeneratedReadClient = {
      listPricebookProcedures: vi.fn(async () => {
        throw unavailable;
      }),
      getInvoice: vi.fn()
    };
    const state = await loadTreatmentBillingWorkspace(client);
    expect(state).toEqual({
      status: "unavailable",
      code: "DEPENDENCY_UNAVAILABLE",
      message:
        "Treatment and billing data is temporarily unavailable. No fixture data was substituted.",
      requestId: "cp13-request-unavailable"
    });
  });
});
