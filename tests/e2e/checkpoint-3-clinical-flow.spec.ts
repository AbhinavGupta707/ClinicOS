import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP3_E2E_ENABLED === "true";
const roleDenialEnabled = process.env.CLINICOS_CP3_ROLE_DENIAL_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const cp3Route = "/surface/clinical?scenario=cp3-intake-consent-encounter";

test.describe("Checkpoint 3 clinical workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP3_E2E_ENABLED=true for CP3 browser smoke.");
  test.use({ baseURL });

  test("captures intake and consent state, signs note, amends note, and signs prescription", async ({
    page
  }) => {
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-workspace")).toBeVisible();
    await expect(page.getByTestId("cp3-workflow")).toBeVisible();
    await expect(page.getByTestId("cp3-fixture-alert")).toBeVisible();

    await page.getByRole("tab", { name: /intake/i }).click();
    await expect(page.getByTestId("cp3-new-patient-intake-form")).toBeVisible();
    await page.getByTestId("cp3-submit-intake").click();

    await page.getByRole("tab", { name: /consent/i }).click();
    await page.getByTestId("cp3-capture-consent-ai_audio_capture").click();
    await expect(page.getByTestId("cp3-consent-ai_audio_capture-status")).toContainText(
      /granted/i
    );
    await page.getByTestId("cp3-revoke-consent-ai_audio_capture").click();
    await expect(page.getByTestId("cp3-consent-ai_audio_capture-status")).toContainText(
      /revoked/i
    );
    await expect(page.getByTestId("cp3-ai-audio-readiness-blocked")).toBeVisible();

    await page.getByRole("tab", { name: /^encounter$/i }).click();
    await page.getByTestId("cp3-start-encounter-newPatientEncounter").click();
    await page.getByTestId("cp3-save-note-draft").click();
    await page.getByTestId("cp3-sign-note-newPatientEncounter").click();
    await expect(page.getByTestId("cp3-note-signed-immutable")).toBeVisible();
    await expect(page.getByTestId("cp3-save-note-draft")).toBeDisabled();

    await page.getByLabel("Reason").fill("Synthetic doctor correction for browser smoke");
    await page.locator(".amendment-panel textarea").first().fill("Amended synthetic history");
    await page.getByTestId("cp3-amend-note").click();
    await page.getByRole("tab", { name: /profile/i }).click();
    await expect(page.getByTestId("cp3-timeline")).toContainText("Clinical note amended");

    await page.getByRole("tab", { name: /^encounter$/i }).click();
    await page.getByTestId("cp3-save-prescription-draft").click();
    await page.getByTestId("cp3-sign-prescription-newPatientEncounter").click();
    await expect(page.getByTestId("cp3-sign-prescription")).toBeDisabled();
  });

  test("mobile clinical workflow shell has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-workspace")).toBeVisible();
    await expect(page.getByTestId("cp3-workflow")).toBeVisible();
    await expect(page.getByTestId("cp3-patient-selector")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Checkpoint 3 clinical role denial", () => {
  test.skip(!roleDenialEnabled, "Set CLINICOS_CP3_ROLE_DENIAL_ENABLED=true for role denial smoke.");
  test.use({ baseURL });

  test("accountant cannot open the clinical workflow route", async ({ page }) => {
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-access-denied")).toBeVisible();
    await expect(page.getByTestId("cp3-clinical-workspace")).toHaveCount(0);
  });
});
