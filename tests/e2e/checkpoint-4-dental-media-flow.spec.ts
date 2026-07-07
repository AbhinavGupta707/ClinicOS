import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP4_E2E_ENABLED === "true";
const roleDenialEnabled = process.env.CLINICOS_CP4_ROLE_DENIAL_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const cp4Route = "/surface/clinical?scenario=cp4-dental-chart-media";

test.describe("Checkpoint 4 dental chart and media workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP4_E2E_ENABLED=true for CP4 browser smoke.");
  test.use({ baseURL });

  test("charts a tooth finding, attaches imaging media, opens signed view, and verifies timeline", async ({
    page
  }) => {
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-dental-media-workspace")).toBeVisible();
    await expect(page.getByTestId("cp4-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp4-encounter-context")).toBeVisible();
    await expect(page.getByTestId("cp4-odontogram")).toBeVisible();

    await page.getByTestId("cp4-tooth-16").click();
    await expect(page.getByTestId("cp4-finding-editor")).toBeVisible();
    await page.getByTestId("cp4-create-finding").click();
    await expect(page.getByTestId("cp4-finding-history")).toContainText(/tooth 16/i);
    await expect(page.getByTestId("cp4-chart-snapshots")).toContainText(/snapshot/i);

    await expect(page.getByTestId("cp4-media-gallery")).toBeVisible();
    await page.getByTestId("cp4-request-upload").click();
    await page.getByTestId("cp4-complete-upload").click();
    await page.getByTestId("cp4-import-dicom-metadata").click();
    await page.getByTestId("cp4-link-external-xray").click();
    await page.getByTestId("cp4-attach-media-to-finding").click();

    await page.getByTestId("cp4-request-signed-view").click();
    await expect(page.getByTestId("cp4-signed-media-viewer")).toBeVisible();
    await expect(page.getByTestId("cp4-storage-privacy-guard")).toBeVisible();
    await expect(page.getByTestId("cp4-media-comparison")).toBeVisible();

    const workspaceText = await page.getByTestId("cp4-dental-media-workspace").innerText();
    expect(workspaceText).not.toContain("objectKey");
    expect(workspaceText).not.toContain("rawStoragePath");
    expect(workspaceText).not.toContain("storagePath");

    await expect(page.getByTestId("cp4-patient-timeline")).toContainText(/dental finding/i);
    await expect(page.getByTestId("cp4-patient-timeline")).toContainText(/media linked/i);
    await expect(page.getByTestId("cp4-patient-timeline")).toContainText(/media viewed/i);
  });

  test("mobile dental media workflow shell has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-dental-media-workspace")).toBeVisible();
    await expect(page.getByTestId("cp4-odontogram")).toBeVisible();
    await expect(page.getByTestId("cp4-media-gallery")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Checkpoint 4 dental/media role denial", () => {
  test.skip(!roleDenialEnabled, "Set CLINICOS_CP4_ROLE_DENIAL_ENABLED=true for role denial smoke.");
  test.use({ baseURL });

  test("accountant cannot open the clinical media workflow route", async ({ page }) => {
    await page.goto(cp4Route);

    await expect(page.getByTestId("cp4-clinical-access-denied")).toBeVisible();
    await expect(page.getByTestId("cp4-dental-media-workspace")).toHaveCount(0);
  });
});
