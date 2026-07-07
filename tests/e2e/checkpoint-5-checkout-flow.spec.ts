import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP5_E2E_ENABLED === "true";
const roleDenialEnabled = process.env.CLINICOS_CP5_ROLE_DENIAL_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const cp5Route = "/surface/checkout?scenario=cp5-treatment-checkout";

test.describe("Checkpoint 5 checkout payment clinical output smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP5_E2E_ENABLED=true for CP5 browser smoke.");
  test.use({ baseURL });

  test("creates treatment checkout, verifies payment evidence, and requests clinical outputs", async ({
    page
  }) => {
    await page.goto(cp5Route);

    await expect(page.getByTestId("cp5-checkout-workspace")).toBeVisible();
    await expect(page.getByTestId("cp5-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp5-patient-context")).toBeVisible();
    await expect(page.getByTestId("cp5-pricebook-list")).toContainText("DENT-RCT-ANTERIOR");

    await expect(page.getByTestId("cp5-treatment-plan-builder")).toBeVisible();
    await expect(page.getByTestId("cp5-plan-phase-card")).toBeVisible();
    await page.getByTestId("cp5-add-estimate-item").click();
    await expect(page.getByTestId("cp5-estimate-preview")).toContainText("INR");
    await page.getByTestId("cp5-accept-plan").click();

    await page.getByTestId("cp5-record-procedure").click();
    await page.getByTestId("cp5-create-invoice").click();
    await expect(page.getByTestId("cp5-invoice-summary")).toContainText("1200000");

    await page.getByTestId("cp5-create-payment-request").click();
    await expect(page.getByTestId("cp5-payment-request-evidence")).toContainText(
      "payment_link_qr"
    );
    await expect(page.getByTestId("cp5-bad-webhook-guard")).toContainText("signature");

    await expect(page.getByTestId("cp5-partial-payment-badge")).toContainText("350000");
    await expect(page.getByTestId("cp5-payment-status")).toContainText("partially");
    await expect(page.getByTestId("cp5-replay-guard")).toContainText("duplicate");

    await page.getByTestId("cp5-record-manual-payment").click();
    await expect(page.getByTestId("cp5-payment-status")).toContainText("paid");

    await page.getByTestId("cp5-generate-receipt").click();
    await expect(page.getByTestId("cp5-receipt-panel")).toContainText("CP5-SYNTH-REC-0001");

    await expect(page.getByTestId("cp5-prescription-builder")).toBeVisible();
    await expect(page.getByTestId("cp5-prescription-sign-denied")).toContainText("assistant");
    await page.getByTestId("cp5-sign-prescription").click();

    await expect(page.getByTestId("cp5-instruction-picker")).toBeVisible();
    await page.getByTestId("cp5-request-instruction-print").click();
    await page.getByTestId("cp5-request-instruction-send").click();
    await expect(page.getByTestId("cp5-outbox-evidence")).toContainText(
      "instruction.send_requested"
    );
    await expect(page.getByTestId("cp5-provider-delivery-status")).toContainText("requested");
    await expect(page.getByTestId("cp5-provider-delivery-status")).not.toContainText(/delivered/i);
    await expect(page.getByTestId("cp5-provider-delivery-status")).not.toContainText(/read/i);

    await expect(page.getByTestId("cp5-patient-timeline")).toContainText("receipt.generated");
    await expect(page.getByTestId("cp5-patient-timeline")).toContainText("prescription.signed");
    await expect(page.getByTestId("cp5-patient-timeline")).toContainText(
      "instruction.send_requested"
    );

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp5-web-checkout-desktop.png"
    });
  });

  test("mobile checkout shell has reachable controls and no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp5Route);

    await expect(page.getByTestId("cp5-checkout-workspace")).toBeVisible();
    await expect(page.getByTestId("cp5-treatment-plan-builder")).toBeVisible();
    await expect(page.getByTestId("cp5-create-invoice")).toBeVisible();
    await expect(page.getByTestId("cp5-create-payment-request")).toBeVisible();
    await expect(page.getByTestId("cp5-generate-receipt")).toBeVisible();
    await expect(page.getByTestId("cp5-request-instruction-send")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp5-web-checkout-mobile-390.png"
    });
  });
});

test.describe("Checkpoint 5 checkout role denial", () => {
  test.skip(
    !roleDenialEnabled,
    "Set CLINICOS_CP5_ROLE_DENIAL_ENABLED=true for CP5 role denial smoke."
  );
  test.use({ baseURL });

  test("accountant sees billing summary without clinical output controls", async ({ page }) => {
    await page.goto(cp5Route);

    await expect(page.getByTestId("cp5-accountant-billing-summary")).toBeVisible();
    await expect(page.getByTestId("cp5-clinical-output-access-denied")).toBeVisible();
    await expect(page.getByTestId("cp5-prescription-builder")).toHaveCount(0);
    await expect(page.getByTestId("cp5-instruction-picker")).toHaveCount(0);
  });
});
