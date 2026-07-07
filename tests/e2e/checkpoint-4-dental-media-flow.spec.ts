import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP4_E2E_ENABLED === "true";
const roleDenialEnabled = process.env.CLINICOS_CP4_ROLE_DENIAL_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const cp4Route = "/surface/dental-media?scenario=cp4-dental-media";

test.describe("Checkpoint 4 dental media workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP4_E2E_ENABLED=true for CP4 browser smoke.");
  test.use({ baseURL });

  test("adds a dental finding, attaches and views media, compares media, and sees history", async ({
    page
  }) => {
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-dental-media-workspace")).toBeVisible();
    await expect(page.getByTestId("cp4-workflow")).toBeVisible();
    await expect(page.getByTestId("cp4-fixture-alert")).toBeVisible();

    await page.getByTestId("cp4-tooth-36").click();
    await page
      .getByTestId("cp4-finding-note")
      .fill("Synthetic CP4 caries finding for root browser smoke.");
    await page.getByTestId("cp4-add-finding").click();
    await expect(page.getByTestId("cp4-finding-list")).toContainText("Caries");

    await page.getByRole("tab", { name: /media/i }).click();
    await page
      .getByTestId("cp4-media-reference")
      .fill("Synthetic intraoral photo reference for root browser smoke");
    await page.getByTestId("cp4-attach-media").click();
    await page.getByTestId("cp4-open-signed-view").click();
    await expect(page.getByTestId("cp4-signed-media-view")).toContainText("Signed access expires");

    await page.getByTestId("cp4-open-comparison").click();
    await expect(page.getByTestId("cp4-comparison-view")).toBeVisible();

    await page.getByRole("tab", { name: /history/i }).click();
    await expect(page.getByTestId("cp4-chart-history")).toContainText("Finding added");
    await expect(page.getByTestId("cp4-timeline")).toContainText("Media viewed");
  });

  test("mobile dental media workflow shell has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-dental-media-workspace")).toBeVisible();
    await expect(page.getByTestId("cp4-odontogram")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Checkpoint 4 dental media role denial", () => {
  test.skip(
    !roleDenialEnabled,
    "Set CLINICOS_CP4_ROLE_DENIAL_ENABLED=true for CP4 role denial smoke."
  );
  test.use({ baseURL });

  test("accountant cannot open the dental media workflow route", async ({ page }) => {
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-dental-media-access-denied")).toBeVisible();
    await expect(page.getByTestId("cp4-dental-media-workspace")).toHaveCount(0);
  });
});
