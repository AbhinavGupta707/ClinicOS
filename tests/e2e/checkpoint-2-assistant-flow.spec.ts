import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP2_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const assistantStorageState = process.env.CLINICOS_CP2_ASSISTANT_STORAGE_STATE;
const accountantStorageState = process.env.CLINICOS_CP2_ACCOUNTANT_STORAGE_STATE;

test.describe("Checkpoint 2 assistant lead to appointment flow", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_CP2_E2E_ENABLED=true after CP2 backend/frontend integration."
  );
  test.use({ baseURL, storageState: assistantStorageState });

  test("matches returning patient, creates new patient, confirms, checks in, and updates queue/dashboard", async ({
    page
  }) => {
    await page.goto("/surface/day-start?scenario=cp2-lead-patient-appointment");

    await expect(page.getByTestId("cp2-morning-dashboard")).toBeVisible();
    await expect(page.getByTestId("cp2-lead-inbox")).toBeVisible();

    await page.getByTestId("cp2-lead-card-whatsappReturningLead").click();
    await expect(page.getByTestId("cp2-duplicate-suggestion-returningPatient")).toContainText(
      "Riya Synthetic"
    );
    await page.getByTestId("cp2-match-returning-patient").click();
    await expect(page.getByTestId("cp2-lead-status-whatsappReturningLead")).toContainText(
      /matched/i
    );

    await page.getByTestId("cp2-lead-card-googleNewPatientLead").click();
    await expect(page.getByTestId("cp2-no-duplicate-suggestions")).toBeVisible();
    await page.getByTestId("cp2-create-patient-from-lead").click();
    await expect(page.getByTestId("cp2-patient-chip-expectedNewPatient")).toContainText(
      "Ira Synthetic"
    );

    await page.getByTestId("cp2-convert-lead-to-appointment").click();
    await expect(page.getByTestId("cp2-appointment-status-newPatientAppointment")).toContainText(
      /booked/i
    );

    await page.getByTestId("cp2-confirm-appointment-newPatientAppointment").click();
    await expect(page.getByTestId("cp2-appointment-status-newPatientAppointment")).toContainText(
      /confirmed/i
    );

    await page.getByTestId("cp2-check-in-newPatientAppointment").click();
    await expect(page.getByTestId("cp2-appointment-status-newPatientAppointment")).toContainText(
      /checked in|checked_in/i
    );
    await expect(page.getByTestId("cp2-queue-entry-newPatientAppointment")).toContainText(
      "Ira Synthetic"
    );

    await expect(page.getByTestId("cp2-dashboard-queue-waiting-count")).toContainText("1");
    await expect(page.getByTestId("cp2-dashboard-new-returning-flags")).toContainText(/new/i);
    await expect(page.getByTestId("cp2-dashboard-new-returning-flags")).toContainText(/returning/i);
  });

  test("mobile CP2 workflow shell has no horizontal overflow and keeps primary controls reachable", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/day-start?scenario=cp2-lead-patient-appointment");

    await expect(page.getByTestId("cp2-morning-dashboard")).toBeVisible();
    await expect(page.getByTestId("cp2-lead-inbox")).toBeVisible();
    await expect(page.getByTestId("cp2-lead-card-googleNewPatientLead")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Checkpoint 2 web role denial smoke", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_CP2_E2E_ENABLED=true after CP2 backend/frontend integration."
  );
  test.skip(
    !accountantStorageState,
    "Set CLINICOS_CP2_ACCOUNTANT_STORAGE_STATE to run web role denial smoke."
  );
  test.use({ baseURL, storageState: accountantStorageState });

  test("accountant cannot access patient creation controls", async ({ page }) => {
    await page.goto("/surface/day-start?scenario=cp2-lead-patient-appointment");

    await expect(page.getByTestId("cp2-patient-create-denied")).toBeVisible();
    await expect(page.getByTestId("cp2-create-patient-from-lead")).toHaveCount(0);
  });
});
