import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TreatmentBillingWorkspace } from "../features/cp13/treatment-billing/components";

describe("CP13 treatment billing components", () => {
  it("renders reconciliation and request-only instruction truth", () => {
    const html = renderToStaticMarkup(
      createElement(TreatmentBillingWorkspace, {
        state: {
          status: "ready",
          loadedAt: "2026-07-10T12:00:00.000Z",
          procedures: [],
          invoice: {
            id: "10000000-0000-4000-8000-000000000601",
            invoiceNumber: "SYN-INV-001",
            totalMinor: 10_000,
            paidMinor: 10_000,
            balanceMinor: 0,
            paymentStatus: "reconciliation_required",
            currency: "INR"
          }
        },
        instructionRequest: {
          id: "10000000-0000-4000-8000-000000000701",
          channel: "whatsapp",
          status: "send_requested",
          providerConfirmationReceived: false,
          deliveredAt: null,
          readAt: null
        }
      })
    );

    expect(html).toContain("requires accountant reconciliation");
    expect(html).toContain("Provider delivery and patient read are not confirmed");
    expect(html).not.toMatch(/delivered to patient/iu);
  });

  it("renders permission denial without workflow data", () => {
    const html = renderToStaticMarkup(
      createElement(TreatmentBillingWorkspace, {
        state: {
          status: "denied",
          code: "PERMISSION_DENIED",
          message: "Your verified clinic role cannot access treatment and billing data.",
          requestId: "cp13-denied"
        }
      })
    );
    expect(html).toContain("cannot access treatment and billing data");
    expect(html).not.toContain("Active pricebook");
  });
});
