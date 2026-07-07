import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP7_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Checkpoint 7 integration ops workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP7_E2E_ENABLED=true for CP7 browser smoke.");
  test.use({ baseURL });

  test("reviews provider health, failed-event replay, and migration commit honestly", async ({
    page
  }) => {
    await page.goto("/surface/integrations?scenario=cp7-integration-ops");

    await expect(page.getByTestId("cp7-integration-ops-workspace")).toBeVisible();
    await expect(page.getByTestId("cp7-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp7-provider-readiness")).toContainText("Configured/degraded");
    await expect(page.getByTestId("cp7-provider-readiness")).toContainText("Unavailable");
    await expect(page.getByTestId("cp7-provider-readiness")).toContainText("Manual/source only");
    await expect(page.getByTestId("cp7-provider-readiness")).toContainText("Webhook URL missing");

    await expect(page.getByTestId("cp7-provider-whatsapp-cloud")).toContainText(
      "configured/degraded"
    );
    await expect(page.getByTestId("cp7-provider-telephony-exotel")).toContainText("Unavailable");
    await expect(page.getByTestId("cp7-provider-google-business")).toContainText(
      "manual/source only"
    );
    await expect(page.getByTestId("cp7-integration-ops-workspace")).not.toContainText(
      "Provider success confirmed"
    );
    await expect(page.getByTestId("cp7-integration-ops-workspace")).not.toContainText("+91");

    await page.getByRole("tab", { name: /replay/i }).click();
    await expect(page.getByTestId("cp7-dead-letter-replay")).toBeVisible();
    await page.getByTestId("cp7-replay-dead-letter").click();
    await expect(page.getByTestId("cp7-replay-status")).toContainText("Replayed");
    await expect(page.getByTestId("cp7-action-message")).toContainText(
      "No provider-confirmed completion"
    );

    await page.getByRole("tab", { name: /migration/i }).click();
    await expect(page.getByTestId("cp7-migration-review")).toBeVisible();
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Needs review");
    await page.getByTestId("cp7-resolve-migration-conflict").click();
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Ready to commit");
    await page.getByTestId("cp7-commit-migration-batch").click();
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Committed");
    await expect(page.getByTestId("cp7-timeline")).toContainText("migration.batch_committed");

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp7-integration-ops-desktop.png"
    });
  });

  test("mobile integration ops shell has reachable controls and no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/migration-review?scenario=cp7-integration-ops-mobile");

    await expect(page.getByTestId("cp7-integration-ops-workspace")).toBeVisible();
    await expect(page.getByTestId("cp7-provider-readiness")).toBeVisible();
    await expect(page.getByTestId("cp7-migration-review")).toBeVisible();
    await expect(page.getByTestId("cp7-resolve-migration-conflict")).toBeVisible();
    await expect(page.getByTestId("cp7-commit-migration-batch")).toBeDisabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp7-integration-ops-mobile-390.png"
    });
  });
});
