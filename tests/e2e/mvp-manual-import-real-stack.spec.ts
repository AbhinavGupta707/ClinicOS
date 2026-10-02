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
      (
        window as Window & { __clinicOsAccessTokenProvider?: () => string }
      ).__clinicOsAccessTokenProvider = () => "local-synthetic-acceptance";
    });
  });

  test("stages, commits, and safely rolls back a synthetic patient import", async ({
    page
  }, testInfo) => {
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
    await expect(page.getByText("Scheduled sync", { exact: true }).locator("..")).toContainText("Not configured");
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
    await page.getByLabel("Find patient",{exact:true}).fill("Rhea Synthetic");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const patientResult = page
      .getByRole("region",{name:"Choose patient"}).getByRole("button")
      .filter({ hasText: "Rhea Synthetic" });
    await expect(patientResult).toBeVisible();
    await patientResult.click();
    await expect(page.getByLabel("Full name",{exact:true})).toHaveValue("Rhea Synthetic");

    await page.getByRole("button", { name: "Open clinical profile" }).click();
    await expect(page).toHaveURL(/\/surface\/patient-profile$/u);
    await expect(page.getByRole("heading",{name:"Rhea Synthetic",exact:true})).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
  });

  test("keeps manual import controls usable on a narrow clinic device", async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/migration-review?scenario=mvp-manual-import-real-stack-mobile");

    await startRun(page, `mobile_manual_${Date.now()}`);
    await expect(page.getByTestId("cp7-migration-operations")).toBeVisible();
    await expect(page.getByTestId("migration-stage-batch")).toBeVisible();
    await expect(page.getByText("Scheduled sync", { exact: true }).locator("..")).toContainText("Not configured");

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("manual-import-mobile.png")
    });
  });

  test("prepares a Practo patient file privately, commits and resumes its limited scope", async ({
    page
  }, testInfo) => {
    const token = `${Date.now()}`;
    const patientName = `Synthetic Ray Patient ${token}`;
    // Independent wire fixture: do not build headers using the implementation.
    const headers =
      "Patient Number,Patient Name,Mobile Number,Contact Number,Email Address,Secondary Mobile,Gender,Address,Locality,City,Pincode,National Id,Date of Birth,Age,Anniversary Date,Blood Group,Remarks,Medical History,Referred By,Groups,Patient Notes";
    const values = [
      `000${token}`,
      patientName,
      "+91 9000000317",
      "",
      `ray.${token}@example.test`,
      "",
      "Female",
      "EXCLUDED_ADDRESS",
      "",
      "",
      "",
      "EXCLUDED_NATIONAL_ID",
      "1992-02-29",
      "",
      "",
      "",
      "",
      "EXCLUDED_HISTORY",
      "",
      "",
      'EXCLUDED_NOTE\nwith "quotes"'
    ];
    const csv =
      headers + "\r\n" + values.map((value) => '"' + value.replaceAll('"', '""') + '"').join(",");
    const stageRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/migration-batches"
      )
        stageRequests.push(request.postData() ?? "");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/migration-review");
    await startRun(page, `practo_patients_trial_${token}`);
    await page.getByTestId("migration-patient-format").selectOption("practo");
    await expect(page.getByTestId("migration-trial-step-appointments")).toHaveCount(0);
    const upload = async (contents: string) =>
      page.getByTestId("migration-file-input").setInputFiles({
        name: "patients.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(contents)
      });
    await upload(
      headers +
        "\n" +
        Array.from({ length: 101 }, () =>
          values.map((value) => '"' + value.replaceAll('"', '""') + '"').join(",")
        ).join("\n")
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "nothing was truncated or sent" })
    ).toBeVisible();
    await expect(page.getByTestId("migration-stage-batch")).toBeDisabled();
    await upload(csv);
    await expect(page.getByTestId("practo-import-preview")).toContainText(
      "1 patient row prepared locally"
    );
    await expect(page.getByTestId("migration-stage-batch")).toBeDisabled();
    expect(stageRequests).toEqual([]);
    const acknowledge = page.getByLabel(/I understand this imports only the six patient fields/u);
    await acknowledge.check();
    // Replacing the file invalidates the acknowledgement, even for an identical file.
    await upload(csv);
    await expect(acknowledge).not.toBeChecked();
    await acknowledge.check();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("practo-patient-preview-mobile.png")
    });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/migration-batches"
    );
    await page.getByTestId("migration-stage-batch").click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const staged = await response.json();
    expect(stageRequests).toHaveLength(1);
    expect(stageRequests[0]).not.toMatch(/EXCLUDED|Medical History|Patient Notes|National Id/u);
    expect(JSON.stringify(staged)).not.toMatch(/EXCLUDED/u);
    expect(staged.rows[0].sourceFormat).toBe("practo_ray_patients_v1");
    expect(staged.rows[0]).not.toHaveProperty("rawPayload");
    const batchId = staged.batch.id;
    await resolvePatientDuplicateIfNeeded(page);
    await commitSelectedBatch(page);
    await page.reload();
    await expect(page.getByTestId("migration-run-summary")).toContainText("Practo patient trial");
    await expect(page.getByTestId("cp7-migration-status")).toContainText("Committed");
    await expect(page.getByTestId("migration-patient-format")).toHaveValue("practo");
    await expect(page.getByTestId("migration-trial-step-appointments")).toHaveCount(0);
    await expect(page.getByTestId("migration-import-type")).toBeDisabled();
    await upload(csv);
    await acknowledge.check();
    const replayPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/migration-batches"
    );
    await page.getByTestId("migration-stage-batch").click();
    const replay = await replayPromise;
    expect(replay.ok()).toBe(true);
    expect((await replay.json()).batch.id).toBe(batchId);
    await expect(page.getByTestId("cp7-action-message")).toContainText("Saved file recovered");
    await expect(page.getByTestId("practo-import-preview")).not.toContainText(
      "Nothing has been uploaded yet"
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("practo-patient-resumed-desktop.png")
    });
    // Search alone creates no clinical dependency; profile access intentionally does.
    const search = await page.request.get(`/v1/patients?query=${encodeURIComponent(patientName)}`);
    expect(search.ok()).toBe(true);
    expect((await search.json()).patients).toEqual([
      expect.objectContaining({ fullName: patientName })
    ]);
    const rollback = await page.request.post(`/v1/migration-batches/${batchId}/rollback`, {
      data: {},
      headers: { "Idempotency-Key": `practo-cleanup-${batchId}` }
    });
    expect(rollback.ok()).toBe(true);
    expect((await rollback.json()).blockedLinks).toEqual([]);
  });

  test("imports 5,000 patients as a recoverable whole file and replays without duplicates", async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const token = Date.now().toString(36);
    const source = `large_patient_file_${token}`;
    const header = "Patient Number,Patient Name,Mobile Number,Contact Number,Email Address,Secondary Mobile,Gender,Address,Locality,City,Pincode,National Id,Date of Birth,Age,Anniversary Date,Blood Group,Remarks,Medical History,Referred By,Groups,Patient Notes";
    const lines = Array.from({ length: 5001 }, (_, index) => [
      `${token}-000${index}`, `Synthetic Scale ${token} Patient ${index}`, `+917${String(index).padStart(9, "0")}`,
      "", "", "", "unknown", "EXCLUDED_ADDRESS", "", "", "", "EXCLUDED_NATIONAL_ID", "", "", "", "", "", "EXCLUDED_HISTORY", "", "", "EXCLUDED_NOTE"
    ].map((value) => '"' + value.replaceAll('"', '""') + '"').join(","));
    const buffer = Buffer.from([header, ...lines.slice(0, 5000)].join("\r\n"));
    const chunks: Array<{ ordinal: number; csv: string }> = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("request", (request) => {
      const match = new URL(request.url()).pathname.match(/patient-file\/chunks\/(\d+)$/u);
      if (request.method() === "POST" && match) {
        expect(request.postData()).not.toMatch(/EXCLUDED_|Patient Notes|Medical History|National Id/);
        chunks.push({ ordinal: Number(match[1]), csv: request.postDataJSON().csv });
      }
    });
    await page.goto("/surface/migration-review");
    await startRun(page, source);
    const runId = await page.getByTestId("migration-run-selector").inputValue();
    await page.getByTestId("migration-workflow").selectOption("patient-file");
    await page.getByTestId("patient-file-input").setInputFiles({ name: "patients.csv", mimeType: "text/csv", buffer: Buffer.from([header, ...lines].join("\n")) });
    await expect(page.getByTestId("patient-file-notice")).toContainText("up to 5,000");
    expect(chunks).toHaveLength(0);
    await page.getByTestId("patient-file-input").setInputFiles({ name: "patients.csv", mimeType: "text/csv", buffer });
    await expect(page.getByTestId("patient-file-preview")).toContainText("5,000 patients");
    await page.getByTestId("patient-file-accept").check();
    const firstReceipt = page.waitForResponse((response) => /patient-file\/chunks\/0$/u.test(new URL(response.url()).pathname), { timeout: 15000 });
    await page.getByTestId("patient-file-upload").click();
    expect((await firstReceipt).ok()).toBe(true);
    await page.getByRole("button", { name: "Pause after current group" }).click();
    await expect(page.getByTestId("patient-file-notice")).toContainText("Upload paused");
    const partial = await (await page.request.get(`/v1/migration-runs/${runId}/patient-file`)).json();
    expect(partial.file.received).toBeGreaterThan(0);
    expect(partial.file.received).toBeLessThan(5000);
    const incompleteCommit = await page.request.post(`/v1/migration-batches/${partial.file.chunks[0].batchId}/commit`, {
      data: {}, headers: { "Idempotency-Key": `incomplete-${runId}` }
    });
    expect(incompleteCommit.status()).toBe(409);
    await page.reload();
    await expect(page.getByTestId("patient-file-summary")).toContainText("Upload incomplete");
    await page.getByTestId("patient-file-input").setInputFiles({ name: "patients.csv", mimeType: "text/csv", buffer });
    await expect(page.getByTestId("patient-file-preview")).toContainText("5,000 patients");
    await page.getByTestId("patient-file-accept").check();
    await page.getByTestId("patient-file-upload").click();
    await expect(page.getByTestId("patient-file-summary")).toContainText("Complete file received", { timeout: 120_000 });
    const staged = await (await page.request.get(`/v1/migration-runs/${runId}/patient-file`)).json();
    expect(staged.file.received).toBe(5000);
    expect(staged.file.chunks).toHaveLength(50);
    expect(staged.file.chunks.reduce((sum: number, chunk: { ready: number }) => sum + chunk.ready, 0)).toBe(5000);
    expect(staged.file.chunks[0].batchId).toBe(partial.file.chunks[0].batchId);
    await page.getByTestId("patient-file-commit-accept").check();
    const commitResponse = page.waitForResponse((response) => /migration-batches\/[^/]+\/commit$/u.test(new URL(response.url()).pathname) );
    await page.getByTestId("patient-file-commit").click();
    const firstCommit = await commitResponse;
    expect(firstCommit.ok(), await firstCommit.text()).toBe(true);
    const searchDuringCommitMs = await Promise.all(Array.from({ length: 3 }, async () => {
      const started = performance.now();
      const response = await page.request.get("/v1/patients?query=Rhea%20Synthetic");
      expect(response.ok()).toBe(true);
      expect((await response.json()).patients.length).toBeGreaterThan(0);
      return Math.round(performance.now() - started);
    }));
    await page.getByRole("button", { name: "Pause after current group" }).click();
    await expect(page.getByTestId("patient-file-notice")).toContainText("Commit paused");
    await page.reload();
    await expect(page.getByTestId("patient-file-summary")).toContainText("Complete file received");
    await page.getByTestId("patient-file-commit-accept").check();
    await page.getByTestId("patient-file-commit").click();
    await expect(page.getByTestId("patient-file-notice")).toContainText("Processing finished", { timeout: 240_000 });
    const final = await (await page.request.get(`/v1/migration-runs/${runId}/patient-file`)).json();
    expect(final.file.chunks.reduce((sum: number, chunk: { committed: number }) => sum + chunk.committed, 0)).toBe(5000);
    expect(final.file.chunks.every((chunk: { ready: number; failed: number }) => chunk.ready === 0 && chunk.failed === 0)).toBe(true);
    await page.getByTestId("patient-file-group").selectOption("49");
    await expect(page.getByTestId("migration-selected-batch")).toContainText(`Synthetic Scale ${token} Patient 4999`);
    await page.screenshot({ path: testInfo.outputPath("patient-file-5000-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Close navigation", exact: true })).not.toBeInViewport();
    const mobileGroup = page.getByTestId("patient-file-group");
    await mobileGroup.scrollIntoViewIfNeeded();
    const mobileGroupBox = await mobileGroup.boundingBox();
    expect(mobileGroupBox!.x).toBeGreaterThanOrEqual(0);
    expect(mobileGroupBox!.x + mobileGroupBox!.width).toBeLessThanOrEqual(391);
    await expect(page.getByTestId("patient-file-commit")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("patient-file-5000-mobile.png"), fullPage: false });

    // A second complete snapshot uses the same source namespace and canonical
    // chunks. The real commit engine must reconcile all 5,000 external identities.
    const replayId = crypto.randomUUID();
    const create = await page.request.post("/v1/migration-runs", { data: { id: replayId, sourceSystem: source }, headers: { "Idempotency-Key": replayId } });
    expect(create.ok()).toBe(true);
    const manifest = { profile: staged.file.profile, rowCount: 5000,
      chunks: staged.file.chunks.map(({ ordinal, rowCount, digest }: { ordinal: number; rowCount: number; digest: string }) => ({ ordinal, rowCount, digest })) };
    const begin = await page.request.post(`/v1/migration-runs/${replayId}/patient-file`, { data: manifest, headers: { "Idempotency-Key": `${replayId}:file` } });
    expect(begin.ok()).toBe(true);
    for (let ordinal = 0; ordinal < 50; ordinal++) {
      const csv = chunks.find((chunk) => chunk.ordinal === ordinal)?.csv;
      expect(csv).toBeTruthy();
      const stage = await page.request.post(`/v1/migration-runs/${replayId}/patient-file/chunks/${ordinal}`, { data: { csv }, headers: { "Idempotency-Key": `${replayId}:chunk:${ordinal}` } });
      expect(stage.ok(), await stage.text()).toBe(true);
    }
    const seal = await page.request.post(`/v1/migration-runs/${replayId}/patient-file/seal`, { data: {}, headers: { "Idempotency-Key": `${replayId}:seal` } });
    expect(seal.ok()).toBe(true);
    const replay = (await seal.json()).file;
    let reconciled = 0;
    for (const chunk of replay.chunks) {
      let committed = await page.request.post(`/v1/migration-batches/${chunk.batchId}/commit`, { data: {}, headers: { "Idempotency-Key": `replay-${chunk.batchId}` } });
      for (let attempt = 0; committed.status() === 429 && attempt < 3; attempt++) {
        const seconds = Number(committed.headers()["retry-after"]);
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(60);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 50));
        committed = await page.request.post(`/v1/migration-batches/${chunk.batchId}/commit`, { data: {}, headers: { "Idempotency-Key": `replay-${chunk.batchId}` } });
      }
      expect(committed.ok(), await committed.text()).toBe(true);
      reconciled += (await committed.json()).commit.summary.reconciledRows;
    }
    expect(reconciled).toBe(5000);
    const assuranceResponse = await page.request.get(`/v1/migration-runs/${replayId}/assurance?comparisonRunId=${runId}`);
    expect(assuranceResponse.ok(), await assuranceResponse.text()).toBe(true);
    const assurance = (await assuranceResponse.json()).report;
    expect(assurance).toMatchObject({received:5000,state:"accounted_for",counterMismatches:0,manifestProblems:0,
      patients:{committedRows:5000,distinctPatients:5000,createdPatients:0,missingLinks:0},
      comparison:{runId,eligibility:"comparable",added:0,changed:0,unchanged:5000,absent:0}});
    expect(JSON.stringify(assurance)).not.toMatch(/Synthetic Scale|EXCLUDED_|\+917/);
    await page.reload();
    await expect(page.getByTestId("migration-run-selector")).toBeEnabled();
    await page.getByTestId("migration-run-selector").selectOption(replayId);
    const assurancePanel = page.getByTestId("migration-assurance");
    await expect(assurancePanel).not.toHaveAttribute("open");
    await expect(assurancePanel.getByLabel("Compare patient file")).not.toBeVisible();
    await assurancePanel.locator("summary").click();
    await expect(assurancePanel.getByLabel("Compare patient file")).toBeEnabled();
    await assurancePanel.getByLabel("Compare patient file").selectOption(runId);
    await assurancePanel.getByRole("button",{name:"Refresh assurance report"}).click();
    await expect(assurancePanel.getByRole("heading",{name:"Selected rows accounted for"})).toBeVisible();
    await expect(assurancePanel).toContainText("unchanged evidence: 5000");
    await expect(assurancePanel).toContainText("Clinic approval: not assessed");
    const downloadPromise = page.waitForEvent("download");
    await assurancePanel.getByRole("button",{name:"Download aggregate report"}).click();
    const downloaded = await downloadPromise;
    expect(downloaded.suggestedFilename()).toBe(`clinicos-migration-assurance-${replayId}.json`);
    const stream = await downloaded.createReadStream();
    const reportBytes = [];
    for await (const chunk of stream!) reportBytes.push(chunk);
    const exported = JSON.parse(Buffer.concat(reportBytes).toString("utf8"));
    expect(exported.patients.createdPatients).toBe(0);
    expect(exported.clinicApproval).toBe("not_assessed");
    expect(JSON.stringify(exported)).not.toMatch(/Synthetic Scale|EXCLUDED_|\+917/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath("migration-assurance-mobile.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await assurancePanel.screenshot({path:testInfo.outputPath("migration-assurance-desktop.png")});
    // An actual failed request clears old evidence; no synthetic success response.
    const assuranceRoute = `**/v1/migration-runs/${replayId}/assurance?**`;
    await page.route(assuranceRoute, route => route.abort("connectionfailed"));
    await assurancePanel.getByRole("button",{name:"Refresh assurance report"}).click();
    await expect(assurancePanel.getByRole("alert")).toContainText("could not be confirmed");
    await expect(assurancePanel.getByRole("button",{name:"Download aggregate report"})).toHaveCount(0);
    await page.unroute(assuranceRoute);
    await assurancePanel.getByRole("button",{name:"Refresh assurance report"}).click();
    await expect(assurancePanel.getByRole("heading",{name:"Selected rows accounted for"})).toBeVisible();

    await page.goto("/surface/patients");
    await page.getByLabel("Find patient",{exact:true}).fill(`Synthetic Scale ${token} Patient 4999`);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByRole("region",{name:"Choose patient"}).getByRole("button").filter({ hasText: `Synthetic Scale ${token} Patient 4999` });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByLabel("Full name",{exact:true})).toHaveValue(`Synthetic Scale ${token} Patient 4999`);
    expect(consoleErrors).toEqual([]);
    await testInfo.attach("scale-acceptance.json", { body: JSON.stringify({ runId, replayId, patients: 5000,
      chunks: 50, reconciled, searchDuringCommitMs, uploadResume: true, commitResume: true, source }), contentType: "application/json" });
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
