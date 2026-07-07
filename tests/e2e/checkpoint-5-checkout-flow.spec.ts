import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP5_E2E_ENABLED === "true";
const accountantEnabled = process.env.CLINICOS_CP5_ACCOUNTANT_SMOKE_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const cp5Route = "/surface/checkout?scenario=cp5-checkout";

test.describe("Checkpoint 5 checkout workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP5_E2E_ENABLED=true for CP5 browser smoke.");
  test.use({ baseURL });

  test("creates an invoice, requests payment honestly, records manual payment, and generates outputs", async ({
    page
  }) => {
    await page.goto(cp5Route);

    await expect(page.getByTestId("cp5-checkout-workspace")).toBeVisible();
    await expect(page.getByTestId("cp5-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp5-provider-readiness")).toContainText("Not configured");

    await page.getByTestId("cp5-record-procedure").click();
    await expect(page.getByTestId("cp5-procedure-ledger")).toContainText("completed");

    await page.getByRole("tab", { name: /invoice/i }).click();
    await page.getByTestId("cp5-create-invoice").click();
    await expect(page.getByTestId("cp5-invoice-panel")).toContainText("Invoice");
    await page.getByTestId("cp5-read-invoice").click();
    await expect(page.getByTestId("cp5-invoice-panel")).toContainText("Last read");

    await page.getByRole("tab", { name: /payment/i }).click();
    await page.getByTestId("cp5-request-payment").click();
    await expect(page.getByTestId("cp5-payment-status")).toContainText("No provider key");
    await expect(page.getByTestId("cp5-payment-status")).not.toContainText(
      "Paid by verified provider"
    );

    await page.getByTestId("cp5-record-manual-payment").click();
    await expect(page.getByTestId("cp5-payment-status")).toContainText("Manual payment recorded");
    await page.getByTestId("cp5-generate-receipt").click();
    await expect(page.getByTestId("cp5-receipts")).toContainText("print ready");

    await page.getByRole("tab", { name: /outputs/i }).click();
    await expect(page.getByTestId("cp5-prescription-gate")).toContainText("doctor role");
    await page.getByTestId("cp5-generate-instruction").click();
    await expect(page.getByTestId("cp5-instructions")).toContainText("print ready");
    await page.getByTestId("cp5-request-instruction-send").click();
    await expect(page.getByTestId("cp5-instructions")).toContainText("provider unavailable");
    await expect(page.getByTestId("cp5-instructions")).not.toContainText(/delivered|read/i);
    await expect(page.getByTestId("cp5-timeline")).toContainText("receipt.generated");

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp5-web-checkout-desktop.png"
    });
  });

  test("mobile checkout workflow shell has reachable controls and no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp5Route);

    await expect(page.getByTestId("cp5-checkout-workspace")).toBeVisible();
    await expect(page.getByTestId("cp5-plan-builder")).toBeVisible();
    await expect(page.getByTestId("cp5-provider-readiness")).toBeVisible();
    await page.getByRole("tab", { name: /payment/i }).click();
    await expect(page.getByTestId("cp5-payment-status")).toBeVisible();

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

test.describe("Checkpoint 5 accountant checkout safe view", () => {
  test.skip(
    !accountantEnabled,
    "Set CLINICOS_CP5_ACCOUNTANT_SMOKE_ENABLED=true for CP5 accountant smoke."
  );
  test.use({ baseURL });

  test("accountant sees billing controls without default clinical PHI", async ({ page }) => {
    await page.goto("/surface/accounting?scenario=cp5-accounting");

    await expect(page.getByTestId("cp5-checkout-workspace")).toBeVisible();
    await expect(page.getByTestId("cp5-accountant-safe-view")).toBeVisible();
    await expect(page.getByTestId("cp5-checkout-workspace")).toContainText("CP5 account SYN-001");
    await expect(page.getByTestId("cp5-checkout-workspace")).not.toContainText(
      "Synthetic checkout patient"
    );

    await page.getByRole("tab", { name: /outputs/i }).click();
    await expect(page.getByTestId("cp5-clinical-output-hidden")).toBeVisible();
  });
});
