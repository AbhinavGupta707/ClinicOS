import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("MVP manual import real-stack acceptance", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_MVP_IMPORT_E2E_ENABLED=true with the local web/API/Postgres stack running."
  );
  test.use({ baseURL });

  test("stages, commits, and safely rolls back a synthetic patient import", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const token = `${Date.now()}-${test.info().retry}`;
    const sourceSystem = `manual_browser_acceptance_${token}`;
    const externalReference = `browser-patient-${token}`;
    const patientName = `Synthetic Browser Patient ${token}`;
    const phone = `+91 9${Date.now().toString().slice(-9)}`;
    const csv = [
      "external_reference,full_name,phone,email,date_of_birth,gender,source_type",
      `${externalReference},${patientName},${phone},browser.patient.${token}@example.test,1992-03-04,unknown,manual`
    ].join("\n");

    await page.goto("/surface/migration-review?scenario=mvp-manual-import-real-stack");

    await expect(page).toHaveTitle(/ClinicOS/u);
    await expect(page.getByTestId("cp7-integration-ops-workspace")).toBeVisible();
    await expect(page.getByTestId("cp7-fixture-alert")).toHaveCount(0);
    await expect(page.getByLabel("Workflow API mode")).toContainText("Live boundary");
    await expect(page.getByText("Scheduled sync").locator("..")).toContainText("Not configured");
    await expect(page.getByText("Source freshness").locator("..")).toContainText("Unknown");

    await page.getByTestId("migration-source-system").fill(sourceSystem);
    await page.getByTestId("migration-csv").fill(csv);
    await page.getByTestId("migration-stage-batch").click();

    await expect(page.getByTestId("cp7-action-message")).toContainText(
      "validated and staged"
    );
    await expect(page.getByTestId("migration-selected-batch")).toContainText(sourceSystem);
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Ready to commit");

    const commitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/migration-batches\/[^/]+\/commit$/u.test(new URL(response.url()).pathname)
    );
    await page.getByTestId("cp7-commit-migration-batch").click();
    const commitResponse = await commitResponsePromise;
    expect(commitResponse.ok()).toBe(true);
    const commitBody = (await commitResponse.json()) as {
      importedRecordLinks?: Array<{
        id?: string;
        targetRecordId?: string;
        verificationStatus?: string;
      }>;
    };
    const committedLink = commitBody.importedRecordLinks?.[0];
    expect(committedLink).toMatchObject({ verificationStatus: "imported_unverified" });
    expect(committedLink?.id).toBeTruthy();
    expect(committedLink?.targetRecordId).toBeTruthy();
    await expect(page.getByTestId("cp7-action-message")).toContainText(
      "Reviewed rows were committed"
    );
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Committed");
    await expect(page.getByLabel("Import row counts")).toContainText("1");

    const committedPatientSearch = await page.request.get(
      `/v1/patients?query=${encodeURIComponent(patientName)}`
    );
    expect(committedPatientSearch.ok()).toBe(true);
    const committedPatients = (await committedPatientSearch.json()) as {
      patients?: Array<{ fullName?: string; id?: string }>;
    };
    expect(committedPatients.patients).toEqual([
      expect.objectContaining({
        fullName: patientName,
        id: committedLink?.targetRecordId
      })
    ]);

    await page.screenshot({
      fullPage: true,
      path: "/tmp/clinicos-mvp-manual-import-committed.png"
    });

    await page
      .getByLabel(/I understand rollback is best-effort compensation/u)
      .check();
    const rollbackResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/migration-batches\/[^/]+\/rollback$/u.test(new URL(response.url()).pathname)
    );
    await page.getByTestId("cp7-rollback-migration-batch").click();
    const rollbackResponse = await rollbackResponsePromise;
    expect(rollbackResponse.ok()).toBe(true);
    const rollbackBody = (await rollbackResponse.json()) as {
      blockedLinks?: unknown[];
      importedRecordLinks?: Array<{ id?: string; verificationStatus?: string }>;
    };
    expect(rollbackBody.blockedLinks).toEqual([]);
    expect(rollbackBody.importedRecordLinks).toContainEqual(
      expect.objectContaining({
        id: committedLink?.id,
        verificationStatus: "rolled_back"
      })
    );

    await expect(page.getByTestId("cp7-action-message")).toContainText(
      "Safe rollback completed"
    );
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Rolled back");

    const rolledBackPatientSearch = await page.request.get(
      `/v1/patients?query=${encodeURIComponent(patientName)}`
    );
    expect(rolledBackPatientSearch.ok()).toBe(true);
    const rolledBackPatients = (await rolledBackPatientSearch.json()) as {
      patients?: unknown[];
    };
    expect(rolledBackPatients.patients).toEqual([]);

    await page.screenshot({
      fullPage: true,
      path: "/tmp/clinicos-mvp-manual-import-rolled-back.png"
    });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("keeps manual import controls usable on a narrow clinic device", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/migration-review?scenario=mvp-manual-import-real-stack-mobile");

    await expect(page.getByTestId("cp7-migration-operations")).toBeVisible();
    await expect(page.getByTestId("migration-stage-batch")).toBeVisible();
    await expect(page.getByText("Scheduled sync").locator("..")).toContainText("Not configured");

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/tmp/clinicos-mvp-manual-import-mobile.png"
    });
  });
});
