import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP3_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const assistantStorageState = process.env.CLINICOS_CP3_ASSISTANT_STORAGE_STATE;
const doctorStorageState = process.env.CLINICOS_CP3_DOCTOR_STORAGE_STATE;
const accountantStorageState = process.env.CLINICOS_CP3_ACCOUNTANT_STORAGE_STATE;
const cp3Route = "/surface/clinical?scenario=cp3-intake-consent-encounter";

test.describe("Checkpoint 3 assistant intake, consent, and denial workflow", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_CP3_E2E_ENABLED=true after CP3 backend/frontend integration."
  );
  test.use({ baseURL, storageState: assistantStorageState });

  test("submits intake, captures consents, drafts a note, and cannot sign clinical artifacts", async ({
    page
  }) => {
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-workspace")).toBeVisible();
    await expect(page.getByTestId("cp3-patient-profile-newPatient")).toContainText(
      "Anya Synthetic"
    );

    await expect(page.getByTestId("cp3-new-patient-intake-form")).toBeVisible();
    await page.getByTestId("cp3-submit-new-patient-intake").click();
    await expect(page.getByTestId("cp3-intake-status-newPatient")).toContainText(
      /submitted|complete/i
    );

    await page.getByTestId("cp3-consent-treatment-toggle").click();
    await page.getByTestId("cp3-consent-ai-audio-toggle").click();
    await page.getByTestId("cp3-save-new-patient-consents").click();
    await expect(page.getByTestId("cp3-ai-audio-readiness-newPatient")).toContainText(/ready/i);

    await page.getByTestId("cp3-note-draft-editor").fill("Synthetic assistant draft for CP3.");
    await page.getByTestId("cp3-save-note-draft-newPatientEncounter").click();
    await expect(page.getByTestId("cp3-note-status-newPatientEncounter")).toContainText(
      /draft|ready/i
    );

    await page.getByTestId("cp3-sign-note-newPatientEncounter").click();
    await expect(page.getByTestId("cp3-note-sign-denied")).toContainText(/doctor|permission/i);

    await page.getByTestId("cp3-sign-prescription-newPatientPrescription").click();
    await expect(page.getByTestId("cp3-prescription-sign-denied")).toContainText(
      /doctor|permission/i
    );

    await page.getByTestId("cp3-revoke-ai-audio-consent-newPatient").click();
    await expect(page.getByTestId("cp3-ai-audio-readiness-newPatient")).toContainText(
      /blocked|revoked|not ready/i
    );
  });

  test("mobile clinical workflow has no horizontal overflow and keeps controls reachable", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-workspace")).toBeVisible();
    await expect(page.getByTestId("cp3-new-patient-intake-form")).toBeVisible();
    await expect(page.getByTestId("cp3-submit-new-patient-intake")).toBeVisible();
    await expect(page.getByTestId("cp3-doctor-prep-returningPatient")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Checkpoint 3 doctor encounter, signing, amendment, and returning prep workflow", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_CP3_E2E_ENABLED=true after CP3 backend/frontend integration."
  );
  test.use({ baseURL, storageState: doctorStorageState });

  test("starts encounters, signs note and prescription, and creates a linked amendment", async ({
    page
  }) => {
    await page.goto(cp3Route);

    await page.getByTestId("cp3-start-encounter-newPatient").click();
    await expect(page.getByTestId("cp3-note-status-newPatientEncounter")).toContainText(
      /draft|ready/i
    );

    await page.getByTestId("cp3-sign-note-newPatientEncounter").click();
    await expect(page.getByTestId("cp3-note-status-newPatientEncounter")).toContainText(/signed/i);

    await page.getByTestId("cp3-create-prescription-newPatientEncounter").click();
    await page.getByTestId("cp3-sign-prescription-newPatientPrescription").click();
    await expect(page.getByTestId("cp3-sign-prescription-newPatientPrescription")).toContainText(
      /signed/i
    );

    await page.getByTestId("cp3-amend-note-newPatientNote").click();
    await page
      .getByTestId("cp3-amendment-reason-newPatientNote")
      .fill("Synthetic correction to clarify treatment-performed wording.");
    await page.getByTestId("cp3-submit-amendment-newPatientNote").click();
    await expect(page.getByTestId("cp3-note-version-timeline-newPatientNote")).toContainText(
      /v1|version 1/i
    );
    await expect(page.getByTestId("cp3-note-version-timeline-newPatientNote")).toContainText(
      /v2|version 2|amend/i
    );

    await expect(page.getByTestId("cp3-doctor-prep-returningPatient")).toContainText(
      /prior|history|returning/i
    );
    await page.getByTestId("cp3-submit-returning-paper-card-intake").click();
    await page.getByTestId("cp3-start-encounter-returningPatient").click();
    await expect(page.getByTestId("cp3-doctor-prep-returningPatient")).toContainText(
      /encounter started|started/i
    );
  });
});

test.describe("Checkpoint 3 accountant clinical denial smoke", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_CP3_E2E_ENABLED=true after CP3 backend/frontend integration."
  );
  test.skip(
    !accountantStorageState,
    "Set CLINICOS_CP3_ACCOUNTANT_STORAGE_STATE to run web role denial smoke."
  );
  test.use({ baseURL, storageState: accountantStorageState });

  test("accountant cannot access clinical note signing or encounter controls", async ({ page }) => {
    await page.goto(cp3Route);

    await expect(page.getByTestId("cp3-clinical-access-denied")).toBeVisible();
    await expect(page.getByTestId("cp3-sign-note-newPatientEncounter")).toHaveCount(0);
    await expect(page.getByTestId("cp3-sign-prescription-newPatientPrescription")).toHaveCount(0);
  });
});
