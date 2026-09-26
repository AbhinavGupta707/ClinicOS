import { expect, test, type Page } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("MVP manual import real-stack acceptance", () => {
  test.skip(
    !e2eEnabled,
    "Set CLINICOS_MVP_IMPORT_E2E_ENABLED=true with the local web/API/Postgres stack running."
  );
  test.use({ baseURL });

  // The API explicitly uses its local synthetic identity adapter, with real
  // Postgres repositories. Keep /v1/me and every business response unintercepted.
  // This test-only token hook does not establish production OIDC/session wiring.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __clinicOsAccessTokenProvider?: () => string })
        .__clinicOsAccessTokenProvider = () => "local-synthetic-acceptance";
    });
  });

  test("stages, commits, and safely rolls back a synthetic patient import", async ({ page }, testInfo) => {
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
    await startRun(page, sourceSystem);
    await expect(page.getByText("Scheduled sync").locator("..")).toContainText("Not configured");
    await expect(page.getByText("Source freshness", { exact: true }).locator("..")).toContainText(
      "Unknown"
    );
    await page.getByTestId("migration-input-tab-paste").click();
    await page.getByTestId("migration-csv").fill(csv);
    await page.getByTestId("migration-stage-batch").click();

    await expect(page.getByTestId("cp7-action-message")).toContainText("validated and staged");
    await expect(page.getByTestId("migration-selected-batch")).toContainText(sourceSystem);
    await resolvePatientDuplicateIfNeeded(page);
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
      path: testInfo.outputPath("manual-import-committed.png")
    });

    await page.getByLabel(/I understand rollback is best-effort compensation/u).check();
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

    await expect(page.getByTestId("cp7-action-message")).toContainText("Safe rollback completed");
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
      path: testInfo.outputPath("manual-import-rolled-back.png")
    });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("guides a named doctor mapping and shows the imported appointment on Today", async ({
    page
  }, testInfo) => {
    const token = `${Date.now()}-${test.info().retry}`;
    const sourceSystem = `guided_browser_trial_${token}`;
    const patientExternalReference = `guided-patient-${token}`;
    const practitionerExternalReference = `guided-practitioner-${token}`;
    const appointmentExternalReference = `guided-appointment-${token}`;
    const patientName = `Synthetic Guided Patient ${token}`;
    const phone = `+91 9${Date.now().toString().slice(-9)}`;
    const clinicDateParts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Kolkata",
      year: "numeric"
    })
      .formatToParts(new Date())
      .reduce<Record<string, string>>((parts, part) => {
        if (part.type !== "literal") parts[part.type] = part.value;
        return parts;
      }, {});
    const start = new Date(
      `${clinicDateParts.year}-${clinicDateParts.month}-${clinicDateParts.day}T06:30:00.000Z`
    );
    start.setUTCSeconds(Math.floor(Date.now() / 1000) % 18_000);
    const end = new Date(start.getTime() + 60_000);
    const batchIds: string[] = [];

    const patientCsv = [
      "external_reference,full_name,phone,email,date_of_birth,gender,source_type",
      `${patientExternalReference},${patientName},${phone},guided.patient.${token}@example.test,1991-02-03,unknown,manual`
    ].join("\n");
    const practitionerCsv = [
      "external_reference,display_name,email,phone",
      `${practitionerExternalReference},Synthetic Source Doctor ${token},,`
    ].join("\n");
    const appointmentCsv = [
      "external_reference,patient_external_reference,provider_external_reference,appointment_type_code,chair_code,start_at,end_at,status,source",
      `${appointmentExternalReference},${patientExternalReference},${practitionerExternalReference},consultation,op-1,${start.toISOString()},${end.toISOString()},booked,practo`
    ].join("\n");

    try {
      await page.goto("/surface/migration-review?scenario=mvp-guided-import-real-stack");
      await startRun(page, sourceSystem);

      await stageAndCommitBatch(page, "patients", patientCsv, batchIds);
      await expect(page.locator('.migration-trial-step[data-state="complete"]')).toContainText(
        "Patient"
      );

      await page.getByTestId("migration-trial-step-practitioners").click();
      const practitionerBatchId = await stageBatch(page, practitionerCsv);
      await expect(page.getByTestId("migration-eligible-doctor")).toBeVisible();
      await expect(page.getByTestId("migration-eligible-doctor")).not.toContainText(
        "10000000-0000-4000-8000-000000001002"
      );
      await page.getByTestId("migration-eligible-doctor").selectOption({
        label: "Dr Kabir Doctor"
      });
      await page.getByTestId("cp7-resolve-migration-conflict").click();
      await expect(page.getByTestId("cp7-action-message")).toContainText("Review decision saved");
      await commitSelectedBatch(page, () => batchIds.push(practitionerBatchId));

      await page.getByTestId("migration-trial-step-appointments").click();
      await stageAndCommitBatch(page, "appointments", appointmentCsv, batchIds);
      await expect(page.getByTestId("migration-trial-complete")).toBeVisible();
      await page
        .getByTestId("migration-trial-complete")
        .getByRole("link", { name: "Open Today" })
        .click();

      await expect(page.getByTestId("cp13-front-office-day")).toBeVisible();
      const importedAppointment = page
        .locator(".cp13-appointment-card")
        .filter({ hasText: patientName });
      await expect(importedAppointment).toBeVisible();
      await expect(importedAppointment).toContainText("Dr Kabir Doctor");
      await expect(importedAppointment).toContainText("Consultation");
      await expect(importedAppointment).toContainText("Operatory 1");
      await expect(importedAppointment).toContainText("Practo");
      await expect(importedAppointment).toContainText("Booked");

      const patientSearch = await page.request.get(
        `/v1/patients?query=${encodeURIComponent(patientName)}`
      );
      expect(patientSearch.ok()).toBe(true);
      expect((await patientSearch.json()) as unknown).toMatchObject({
        patients: [expect.objectContaining({ fullName: patientName })]
      });

      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("guided-import-today.png")
      });
    } finally {
      for (const batchId of [...batchIds].reverse()) {
        const rollback = await page.request.post(`/v1/migration-batches/${batchId}/rollback`, {
          data: {},
          headers: { "Idempotency-Key": `guided-cleanup-${batchId}` }
        });
        expect(rollback.ok()).toBe(true);
      }
    }

    const rolledBackPatientSearch = await page.request.get(
      `/v1/patients?query=${encodeURIComponent(patientName)}`
    );
    expect(rolledBackPatientSearch.ok()).toBe(true);
    expect((await rolledBackPatientSearch.json()) as { patients?: unknown[] }).toMatchObject({
      patients: []
    });
  });

  test("carries a searched patient into the clinical profile without URL state", async ({
    page
  }) => {
    await page.goto("/surface/patients?scenario=mvp-patient-navigation-handoff");
    await page.getByLabel("Search by name or phone").fill("Rhea Synthetic");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const patientResult = page
      .locator(".cp13-patient-search > ul button")
      .filter({ hasText: "Rhea Synthetic" });
    await expect(patientResult).toBeVisible();
    await patientResult.click();
    await expect(page.getByTestId("cp13-front-office-patient")).toContainText("Rhea Synthetic");

    await page.getByRole("button", { name: "Open full profile" }).click();
    await expect(page).toHaveURL(/\/surface\/patient-profile$/u);
    await expect(page.getByTestId("cp13-clinical-runtime")).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
  });

  test("keeps manual import controls usable on a narrow clinic device", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/migration-review?scenario=mvp-manual-import-real-stack-mobile");

    await startRun(page, `mobile_manual_${Date.now()}`);
    await expect(page.getByTestId("cp7-migration-operations")).toBeVisible();
    await expect(page.getByTestId("migration-stage-batch")).toBeVisible();
    await expect(page.getByText("Scheduled sync").locator("..")).toContainText("Not configured");

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("manual-import-mobile.png")
    });
  });
});

async function stageAndCommitBatch(
  page: Page,
  importType: "appointments" | "patients" | "practitioners",
  csv: string,
  committedBatchIds: string[]
) {
  await page.getByTestId("migration-trial-step-" + importType).click();
  const batchId = await stageBatch(page, csv);
  if (importType === "patients") await resolvePatientDuplicateIfNeeded(page);
  await commitSelectedBatch(page, () => committedBatchIds.push(batchId));
}

async function stageBatch(page: Page, csv: string) {
  await page.getByTestId("migration-input-tab-paste").click();
  await page.getByTestId("migration-csv").fill(csv);
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/v1/migration-batches"
  );
  await page.getByTestId("migration-stage-batch").click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBe(true);
  const body = (await createResponse.json()) as { batch?: { id?: string } };
  expect(body.batch?.id).toBeTruthy();
  await expect(page.getByTestId("cp7-action-message")).toContainText("validated and staged");
  return body.batch!.id!;
}

async function resolvePatientDuplicateIfNeeded(page: Page) {
  const status = page.getByTestId("cp7-migration-status");
  if ((await status.textContent())?.includes("Needs review")) {
    const createSeparatePatient = page.getByRole("button", {
      name: "Create separate patient"
    });
    await expect(createSeparatePatient).toBeVisible();
    await createSeparatePatient.click();
    await expect(page.getByTestId("cp7-action-message")).toContainText("Review decision saved");
  }
}

async function commitSelectedBatch(page: Page, onCommitAccepted?: () => void) {
  await expect(page.getByTestId("cp7-migration-status")).toContainText("Ready to commit");
  const commitResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/v1\/migration-batches\/[^/]+\/commit$/u.test(new URL(response.url()).pathname)
  );
  await page.getByTestId("cp7-commit-migration-batch").click();
  const commitResponse = await commitResponsePromise;
  expect(commitResponse.ok()).toBe(true);
  onCommitAccepted?.();
  await expect(page.getByTestId("cp7-migration-status")).toContainText("Committed");
}

async function startRun(page: Page, sourceSystem: string) {
  await page.getByTestId("migration-new-source-system").fill(sourceSystem);
  await page.getByTestId("migration-create-run").click();
  await expect(page.getByTestId("migration-source-system")).toHaveValue(sourceSystem);
}
