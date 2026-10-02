import { describe, expect, it } from "vitest";
import {
  acceptedIncompleteItems,
  formatInrMinor,
  parseInrMinor,
  planDraftFromResource,
  planPhases,
  receiptablePayments
} from "../features/cp13/treatment-billing/billing-workflow";

describe("treatment plan editor contract", () => {
  it("sends multiple phases and items with catalog IDs, never typed prices", () => {
    const phases = planPhases(
      [
        {
          title: "Stabilise",
          description: "",
          estimatedStartAfterDays: "0",
          items: [
            {
              pricebookProcedureId: "catalog-a",
              toothNumber: "16",
              quantity: "1",
              estimatedVisits: "2",
              notes: "First"
            },
            {
              pricebookProcedureId: "catalog-b",
              toothNumber: "",
              quantity: "2",
              estimatedVisits: "1",
              notes: ""
            }
          ]
        },
        {
          title: "Restore",
          description: "Review",
          estimatedStartAfterDays: "30",
          items: [
            {
              pricebookProcedureId: "catalog-a",
              toothNumber: "46",
              quantity: "1",
              estimatedVisits: "1",
              notes: ""
            }
          ]
        }
      ],
      new Set(["catalog-a", "catalog-b"])
    );
    expect(phases).toHaveLength(2);
    expect(phases[0]?.items).toHaveLength(2);
    expect(phases[1]?.estimatedStartAfterDays).toBe(30);
    expect("unitPriceMinor" in phases[0]!.items[0]!).toBe(false);
    expect(() =>
      planPhases(
        [
          {
            title: "x",
            description: "",
            estimatedStartAfterDays: "",
            items: [
              {
                pricebookProcedureId: "catalog-a",
                toothNumber: "19",
                quantity: "1",
                estimatedVisits: "1",
                notes: ""
              }
            ]
          }
        ],
        new Set(["catalog-a"])
      )
    ).toThrow("FDI");
  });
  it("preserves saved phase/item structure when reopening a plan", () => {
    const plan = {
      id: "plan",
      rowVersion: 2,
      title: "Care",
      clinicalSummary: "Reviewed",
      status: "accepted",
      phases: [
        {
          title: "Phase",
          description: "First",
          estimatedStartAfterDays: 7,
          estimateItems: [
            {
              id: "item",
              pricebookProcedureId: "catalog-a",
              toothNumber: "16",
              quantity: 2,
              estimatedVisits: 2,
              notes: "Note",
              status: "accepted"
            }
          ]
        }
      ]
    };
    const restored = planDraftFromResource(plan);
    expect(restored.phases[0]?.items[0]?.quantity).toBe("2");
    expect(acceptedIncompleteItems(plan).map((item) => item.id)).toEqual(["item"]);
    expect(acceptedIncompleteItems({ ...plan, status: "draft" })).toEqual([]);
  });
});

describe("payment and receipt evidence", () => {
  it("converts INR strings to exact integer minor units", () => {
    expect(parseInrMinor("1")).toBe(100);
    expect(parseInrMinor("1.2")).toBe(120);
    expect(parseInrMinor("1.23")).toBe(123);
    expect(parseInrMinor("0.00", true)).toBe(0);
    expect(parseInrMinor("500.25", true)).toBe(50025);
    expect(() => parseInrMinor("-0.01", true)).toThrow();
    expect(formatInrMinor(123)).toBe("₹1.23");
    for (const invalid of ["0", "1.234", "1e2", "-1", "1,000", "90071992547410.00"]) {
      expect(() => parseInrMinor(invalid)).toThrow();
    }
  });
  it("offers receipts only for settled, verified, unreceipted payments", () => {
    const invoice = {
      payments: [
        {
          id: "manual",
          status: "manually_recorded",
          verificationStatus: "not_required_manual",
          receiptId: null
        },
        { id: "provider", status: "succeeded", verificationStatus: "verified", receiptId: null },
        { id: "pending", status: "pending", verificationStatus: "verified", receiptId: null },
        {
          id: "unverified",
          status: "succeeded",
          verificationStatus: "requires_review",
          receiptId: null
        },
        {
          id: "receipted",
          status: "manually_recorded",
          verificationStatus: "not_required_manual",
          receiptId: "receipt"
        }
      ]
    };
    expect(receiptablePayments(invoice).map((payment) => payment.id)).toEqual([
      "manual",
      "provider"
    ]);
  });
});
