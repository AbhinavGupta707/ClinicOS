// Invoked only after test-staff-sign-in's disposable database and real identity guards.
// Every business response comes from the real API/Postgres. The single route hook
// deliberately loses a completed response; it never supplies a fabricated payload.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { join } from "node:path";

export async function staffImportAcceptance({
  page,
  context,
  webOrigin,
  clinicId,
  runId,
  artifacts,
  restartApi,
  mark
}) {
  const source = `manual_staff_trial_${runId}`;
  const patientName = `Synthetic Import ${runId}`;
  const patientRef = `patient-${runId}`;
  const providerRef = `doctor-${runId}`;
  const appointmentRef = `appointment-${runId}`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value])
  );
  const start = `${parts.year}-${parts.month}-${parts.day}T12:40:00.000Z`;
  const end = `${parts.year}-${parts.month}-${parts.day}T12:45:00.000Z`;
  const patientCsv = `external_reference,full_name,phone,email,date_of_birth,gender,source_type\n${patientRef},${patientName},+919${Date.now().toString().slice(-9)},${runId}@example.test,1992-03-04,unknown,manual`;
  const doctorCsv = `external_reference,display_name,email,phone\n${providerRef},Synthetic Source Doctor,,`;
  const appointmentCsv = `external_reference,patient_external_reference,provider_external_reference,appointment_type_code,chair_code,start_at,end_at,status,source\n${appointmentRef},${patientRef},${providerRef},consultation,op-1,${start},${end},booked,manual`;
  const get = async (path) => {
    const response = await context.request.get(`${webOrigin}/bff${path}`, {
      headers: { "X-Clinic-Id": clinicId }
    });
    assert.equal(response.status(), 200);
    return response.json();
  };
  const post = async (path) => {
    const session = await (await context.request.get(`${webOrigin}/auth/session`)).json();
    const response = await context.request.post(`${webOrigin}/bff${path}`, {
      data: {},
      headers: {
        Origin: webOrigin,
        "X-Clinic-Id": clinicId,
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": crypto.randomUUID()
      }
    });
    assert.equal(response.status(), 202);
    return response.json();
  };
  const startRun = async () => {
    await page.getByTestId("migration-new-source-system").fill(source);
    await page.getByTestId("migration-create-run").click();
    await expect(page.getByTestId("migration-source-system")).toHaveValue(source);
    await expect(page.getByTestId("migration-create-run")).toBeEnabled();
    return page.getByTestId("migration-run-selector").inputValue();
  };
  const stage = async (type, csv) => {
    await page.getByTestId(`migration-trial-step-${type}`).click();
    await page.getByTestId("migration-input-tab-paste").click();
    await page.getByTestId("migration-csv").fill(csv);
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && new URL(r.url()).pathname === "/bff/v1/migration-batches"
    );
    await page.getByTestId("migration-stage-batch").click();
    assert.ok((await response).ok());
    await expect(page.getByTestId("cp7-action-message")).toContainText("validated and staged");
  };
  const commit = async () => {
    await expect(page.getByTestId("cp7-commit-migration-batch")).toBeEnabled();
    await page.getByTestId("cp7-commit-migration-batch").click();
    await expect(page.getByTestId("cp7-action-message")).toContainText(
      "Reviewed rows were committed"
    );
    await expect(page.getByTestId("cp7-migration-status")).toHaveText("Committed");
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webOrigin}/surface/migration-review`);
  const firstRunId = await startRun();
  // The server persists the real file, then the browser loses only its response.
  const stageUrl = `${webOrigin}/bff/v1/migration-batches`;
  await page.route(stageUrl, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.abort("failed");
  });
  await page.getByTestId("migration-input-tab-paste").click();
  await page.getByTestId("migration-csv").fill(patientCsv);
  await page.getByTestId("migration-stage-batch").click();
  await expect(page.getByTestId("cp7-action-message")).toContainText(
    "Saved progress has been reloaded"
  );
  await page.unroute(stageUrl);
  const saved = await get(`/v1/migration-runs/${firstRunId}`);
  assert.equal(saved.batches.length, 1);
  await stage("patients", patientCsv);
  assert.equal(
    (await get(`/v1/migration-runs/${firstRunId}`)).batches[0].batch.id,
    saved.batches[0].batch.id
  );
  await commit();
  await page.reload();
  await expect(page.getByTestId("migration-run-selector")).toHaveValue(firstRunId);
  await page.getByTestId("migration-trial-step-patients").click();
  await expect(page.getByTestId("cp7-migration-status")).toHaveText("Committed");
  // Stop/recreate only the in-process API owned by the guarded CI runner.
  await restartApi(async () => {
    await page.getByRole("button", { name: "Refresh saved progress", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Saved import progress unavailable" })
    ).toBeVisible();
    await expect(page.getByTestId("cp7-commit-migration-batch")).toHaveCount(0);
  });
  await page.getByRole("button", { name: "Refresh saved progress", exact: true }).click();
  await expect(page.getByTestId("migration-run-selector")).toHaveValue(firstRunId);
  await expect(page.getByTestId("migration-run-summary")).toContainText("Map practitioners");
  mark("cookie BFF import: lost response, identical retry, reload and owned API restart");

  await stage("practitioners", doctorCsv);
  await page.getByTestId("migration-eligible-doctor").selectOption({ label: "Dr Kabir Doctor" });
  await page.getByTestId("cp7-resolve-migration-conflict").click();
  await expect(page.getByTestId("cp7-action-message")).toContainText("Review decision saved");
  await commit();
  await stage("appointments", appointmentCsv);
  await commit();
  await expect(page.getByTestId("migration-run-summary")).toContainText(
    "All staged rows committed"
  );
  const first = await get(`/v1/migration-runs/${firstRunId}`);
  assert.equal(first.reconciliation.received, 3);
  assert.equal(first.reconciliation.committed, 3);
  assert.equal(first.reconciliation.missingSourceAssessment, "unknown");
  const patientId = first.batches.find((d) => d.batch.importType === "patients").rows[0]
    .committedRecordId;
  const appointmentId = first.batches.find((d) => d.batch.importType === "appointments").rows[0]
    .committedRecordId;
  await page.goto(webOrigin);
  await expect(page.getByTestId("cp13-front-office-day")).toContainText(patientName);
  await page.goto(`${webOrigin}/surface/patients`);
  await page.getByLabel("Search by name or phone").fill(patientName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".cp13-patient-search > ul button").filter({ hasText: patientName }).click();
  await expect(page.getByTestId("cp13-front-office-patient")).toContainText(patientName);
  mark("cookie BFF import: three files, named doctor, Today and patient search");

  await page.goto(`${webOrigin}/surface/migration-review`);
  const replayRunId = await startRun();
  for (const [type, csv] of [
    ["patients", patientCsv],
    ["practitioners", doctorCsv],
    ["appointments", appointmentCsv]
  ]) {
    await stage(type, csv);
    await commit();
  }
  const replay = await get(`/v1/migration-runs/${replayRunId}`);
  assert.equal(replay.status, "complete");
  assert.equal(replay.reconciliation.reconciled, 3);
  assert.equal(
    replay.batches.find((d) => d.batch.importType === "patients").rows[0].committedRecordId,
    patientId
  );
  assert.equal(
    replay.batches.find((d) => d.batch.importType === "appointments").rows[0].committedRecordId,
    appointmentId
  );
  assert.equal(
    (await get(`/v1/patients?query=${encodeURIComponent(patientName)}`)).patients.filter(
      (p) => p.id === patientId
    ).length,
    1
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page
    .getByRole("button", { name: "Refresh saved progress", exact: true })
    .click({ trial: true });
  await page.screenshot({
    path: join(artifacts, "import-run-replayed-mobile.png"),
    fullPage: true,
    animations: "disabled"
  });
  mark("cookie BFF import: repeat cycle reuses identities and mobile controls remain reachable");

  const changedRunId = await startRun();
  await stage("patients", patientCsv.replace(patientName, `${patientName} Changed`));
  const changed = await get(`/v1/migration-runs/${changedRunId}`);
  assert.equal(changed.status, "review_required");
  assert.equal(changed.reconciliation.needsReview, 1);
  assert.equal(changed.reconciliation.committed, 0);
  assert.equal(
    (await get(`/v1/patients?query=${encodeURIComponent(patientName)}`)).patients.find(
      (p) => p.id === patientId
    ).fullName,
    patientName
  );
  const originPatientBatch = first.batches.find((d) => d.batch.importType === "patients").batch.id;
  const blocked = await post(`/v1/migration-batches/${originPatientBatch}/rollback`);
  assert.ok(blocked.blockedLinks.length > 0);
  assert.ok(
    (await get(`/v1/patients?query=${encodeURIComponent(patientName)}`)).patients.some(
      (p) => p.id === patientId
    )
  );
  for (const run of [replay, first]) {
    for (const type of ["appointments", "practitioners", "patients"]) {
      const batch = run.batches.find((d) => d.batch.importType === type).batch;
      const result = await post(`/v1/migration-batches/${batch.id}/rollback`);
      // Opening the profile above creates durable patient-linked access audit.
      // That is a real downstream dependency: rollback must preserve the patient.
      if (run === first && type === "patients") {
        assert.equal(result.blockedLinks.length, 1);
        assert.equal(result.rows[0].status, "committed");
      } else assert.equal(result.blockedLinks.length, 0);
    }
  }
  const retained = await get(`/v1/migration-runs/${firstRunId}`);
  assert.equal(retained.status, "partial");
  assert.equal(retained.reconciliation.committed, 1);
  assert.equal(retained.reconciliation.rolledBack, 2);
  assert.ok(
    (await get(`/v1/patients?query=${encodeURIComponent(patientName)}`)).patients.some(
      (patient) => patient.id === patientId
    )
  );
  mark(
    "cookie BFF import: changed evidence quarantined and audited patient preserved during rollback"
  );

  // A separate untouched record proves safe compensation is still available.
  // Do not open its profile (which would create the audit dependency tested above).
  const untouchedId = await startRun();
  const untouchedName = `UnviewedRecovery ${runId}`;
  await stage(
    "patients",
    `external_reference,full_name,phone\nuntouched-${runId},${untouchedName},+918${Date.now().toString().slice(-9)}`
  );
  await commit();
  const untouched = await get(`/v1/migration-runs/${untouchedId}`);
  const compensated = await post(`/v1/migration-batches/${untouched.batches[0].batch.id}/rollback`);
  assert.equal(compensated.blockedLinks.length, 0);
  assert.equal((await get(`/v1/migration-runs/${untouchedId}`)).status, "rolled_back");
  assert.equal(
    (await get(`/v1/patients?query=${encodeURIComponent(untouchedName)}`)).patients.length,
    0
  );
  mark("cookie BFF import: untouched record safely rolled back");
}
