import { test, expect, type Page, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
const baseURL = process.env.CLINICOS_WEB_BASE_URL!;
const clinic = "10000000-0000-4000-8000-000000000101",
  doctor = "10000000-0000-4000-8000-000000001002";
const tag = randomUUID().slice(0, 8),
  patientName = `SyntheticDaily-${tag}`,
  planName = `Synthetic plan ${tag}`;
let patientId = "",
  appointmentId = "",
  encounterId = "",
  priceId = "",
  templateId = "";
const date = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
async function rolePage(browser: Browser, role: string) {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer local-synthetic-${role}` }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript((role) => {
    window.__clinicOsAccessTokenProvider = () => `local-synthetic-${role}`;
  }, role);
  return page;
}
async function api(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
  role = "owner",
  version?: number
) {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: {
      authorization: `Bearer local-synthetic-${role}`,
      "x-clinic-id": clinic,
      ...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}),
      ...(version ? { "if-match": `"rv-${version}"` } : {})
    }
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function save(page: Page, path: string, button: string) {
  console.log(`Saving ${button} to ${path}`);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() !== "GET"
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
async function choose(page: Page, surface: string, name = patientName) {
  console.log(`Opening ${surface}`);
  await page.goto(`/surface/${surface}`);
  await page.getByLabel("Find patient", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
}

test.describe.serial("Native daily workflows with synthetic PostgreSQL", () => {
  test.skip(
    process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED !== "true",
    "Disposable synthetic stack only"
  );
  test("owner configures clinic forms, prices, chairs and reviews staff with version protection", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    await page.goto("/surface/settings");
    await expect(page.getByTestId("clinic-setup")).toBeVisible();
    await page.getByRole("button", { name: "Chairs and rooms", exact: true }).click();
    await page.getByRole("button", { name: "Add chairs and rooms" }).click();
    await page.getByLabel("Display name", { exact: true }).fill(`Synthetic chair ${tag}`);
    await page.getByLabel("Stable code").fill(`daily-chair-${tag}`);
    const chair = await save(page, "/v1/clinic-setup/chair", "Save configuration");
    expect(chair.record.rowVersion).toBe(1);
    const conflict = await page.request.post("/v1/clinic-setup/chair", {
      headers: {
        authorization: "Bearer local-synthetic-owner",
        "x-clinic-id": clinic,
        "idempotency-key": randomUUID()
      },
      data: {
        recordId: chair.record.id,
        expectedVersion: 99,
        configuration: { ...chair.record.configuration, displayName: "must not save" }
      }
    });
    expect(conflict.status()).toBe(409);
    await page.getByRole("button", { name: "Treatments and prices", exact: true }).click();
    await page.getByRole("button", { name: "Add treatments and prices" }).click();
    await page.getByLabel("Display name", { exact: true }).fill(`Synthetic procedure ${tag}`);
    await page.getByLabel("Stable code").fill(`daily-procedure-${tag}`);
    await page.getByLabel("Category", { exact: true }).fill("synthetic");
    await page.getByLabel("Unit price in INR").fill("1000.00");
    priceId = (await save(page, "/v1/clinic-setup/pricebook", "Save configuration")).record.id;
    await page.getByRole("button", { name: "Intake templates", exact: true }).click();
    await page.getByLabel("Template code", { exact: true }).fill(`daily-intake-${tag}`);
    await page.getByLabel("Template name").fill(`Synthetic history ${tag}`);
    await page
      .getByRole("combobox", { name: "Form purpose", exact: true })
      .selectOption("medical_history");
    await page.getByLabel("Field code").fill("allergies");
    await page.getByLabel("Field label").fill("Reported allergies");
    await page.getByLabel("Required", { exact: true }).check();
    templateId = (await save(page, "/v1/form-templates", "Publish intake template")).template.id;
    await page.getByRole("button", { name: "Staff access", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Registered staff", exact: true })
      .selectOption(doctor);
    await expect(page.getByText("Access for", { exact: false })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Registered staff", exact: true })
      .selectOption("10000000-0000-4000-8000-000000001003");
    await page
      .getByRole("combobox", { name: "Clinic access", exact: true })
      .selectOption("suspended");
    await page
      .getByRole("checkbox", { name: "I reviewed these roles and access status.", exact: true })
      .check();
    await save(page, "/v1/clinic-access", "Save staff access");
    await expect(page.getByRole("combobox", { name: "Clinic access", exact: true })).toHaveValue(
      "suspended"
    );
    await page.getByRole("combobox", { name: "Clinic access", exact: true }).selectOption("active");
    await page
      .getByRole("checkbox", { name: "I reviewed these roles and access status.", exact: true })
      .check();
    await save(page, "/v1/clinic-access", "Save staff access");
    await page.screenshot({ path: info.outputPath("setup.png"), fullPage: true });
    await page.context().close();
  });
  test("reception registers, edits and reviews shared-phone duplicates and leads", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "receptionist");
    await page.goto("/surface/patients");
    await page.getByRole("button", { name: "Register patient", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill(patientName);
    await page.getByLabel("Phone with country code").fill("+919555123451");
    await page.getByLabel("Date of birth", { exact: true }).fill("1991-06-15");
    const registered = await save(page, "/v1/patients", "Create patient");
    patientId = registered.patient.id;
    expect(registered.patient.dateOfBirth).toBe("1991-06-15");
    await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid");
    const updated = await save(page, `/v1/patients/${patientId}`, "Save demographics");
    expect(updated.patient.email).toBe("synthetic@example.invalid");
    expect(updated.patient.dateOfBirth).toBe("1991-06-15");
    await page.getByRole("button", { name: "Register patient", exact: true }).click();
    await page.getByLabel("Full name", { exact: true }).fill(`Synthetic sibling ${tag}`);
    await page.getByLabel("Phone with country code").fill("+919555123451");
    await page.getByRole("button", { name: "Create patient", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Review possible duplicate patients" })
    ).toBeVisible();
    await page
      .getByLabel("Reason this is a separate person")
      .fill("Synthetic sibling shares a family contact; different person verified.");
    await page.getByLabel("I checked every match", { exact: false }).check();
    await save(page, "/v1/patients", "Create patient");
    await page.goto("/surface/lead-inbox");
    await page.getByLabel("Name if provided").fill(`Synthetic enquiry ${tag}`);
    await page.getByLabel("Contact number", { exact: true }).fill("+919555123451");
    await save(page, "/v1/leads", "Save enquiry");
    await page.getByRole("button", { name: new RegExp(`Synthetic enquiry ${tag}`) }).click();
    await page.getByLabel("Find patient", { exact: true }).fill(patientName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(patientName) }).click();
    await page.getByLabel("I verified this enquiry", { exact: false }).check();
    await page.getByRole("button", { name: "Confirm patient match" }).click();
    await page.goto("/surface/appointments");
    await page.getByRole("button", { name: "Week view", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Week schedule" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await expect(
      page.getByRole("complementary", { name: "ClinicOS navigation", includeHidden: true })
    ).toBeHidden();
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "ClinicOS navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "ClinicOS navigation", includeHidden: true })
    ).toBeHidden();
    await page.screenshot({ path: info.outputPath("mobile-week.png"), fullPage: true });
    await page.context().close();
  });
  test("doctor completes intake, consent, consultation, treatment and clinical signature", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "doctor");
    const booked = await api(
      page,
      "/v1/appointments",
      "POST",
      {
        patientId,
        providerUserId: doctor,
        appointmentTypeId: "10000000-0000-4000-8000-000000003001",
        startAt: `${date()}T06:30:00.000Z`,
        durationMinutes: 30,
        source: "manual"
      },
      "receptionist"
    );
    appointmentId = booked.appointment.id;
    await api(
      page,
      `/v1/appointments/${appointmentId}/check-in`,
      "POST",
      undefined,
      "receptionist"
    );
    await choose(page, "intake");
    await page
      .getByRole("combobox", { name: "Approved form template", exact: true })
      .selectOption(templateId);
    await page
      .getByLabel("Paper record location or reference")
      .fill("Synthetic rehearsal paper card");
    await page.getByLabel("Reported allergies").fill("Synthetic: no allergies reported");
    await save(page, `/v1/patients/${patientId}/form-responses`, "Record response");
    await expect(page.getByText("Saved intake history")).toBeVisible();
    await choose(page, "consent");
    await page.getByLabel("Approved template code").fill("synthetic-treatment");
    await page.getByLabel("Approved template version").fill("1");
    await page.getByLabel("Person who granted consent").fill(patientName);
    await page.getByLabel("Signed evidence location or reference").fill("Synthetic signed card");
    await page.getByLabel("Date on the evidence").fill(date());
    await page.getByLabel("I checked that this exact", { exact: false }).check();
    await save(page, `/v1/patients/${patientId}/consents`, "Record consent evidence");
    await choose(page, "encounter");
    await page.getByRole("combobox", { name: "Assigned doctor", exact: true }).selectOption(doctor);
    await page
      .getByRole("combobox", { name: "Today’s appointment, if linked", exact: true })
      .selectOption(appointmentId);
    await page.getByLabel("Reason for visit").fill("Synthetic routine check");
    encounterId = (await save(page, "/v1/encounters", "Create visit")).encounter.id;
    await save(page, `/v1/encounters/${encounterId}/start`, "Start consultation");
    await page.getByLabel("Medication", { exact: true }).fill("SyntheticTestMedication");
    await page.getByLabel("Frequency", { exact: true }).fill("Synthetic frequency");
    await page.getByLabel("Duration", { exact: true }).fill("Synthetic duration");
    const rx = (
      await save(page, `/v1/encounters/${encounterId}/prescriptions`, "Save prescription draft")
    ).prescription;
    await page
      .getByRole("checkbox", { name: "I reviewed every medication in this draft.", exact: true })
      .check();
    await save(page, `/v1/prescriptions/${rx.id}/sign`, "Sign prescription");
    await choose(page, "checkout");
    await page.getByRole("button", { name: "Create treatment plan", exact: true }).click();
    await page.getByLabel("Plan title").fill(planName);
    await page.getByLabel("Phase title").fill("Synthetic single phase");
    await page
      .getByRole("combobox", { name: "Catalog procedure", exact: true })
      .selectOption(priceId);
    await page
      .getByRole("combobox", { name: "Related visit, if any", exact: true })
      .selectOption(encounterId);
    await save(page, `/v1/patients/${patientId}/treatment-plans`, "Save draft plan");
    await page.getByRole("button", { name: /Mark presented to patient/ }).click();
    await expect(
      page.getByRole("button", { name: new RegExp(`${planName} · presented`) })
    ).toBeVisible();
    await page.getByLabel("Person accepting").fill(patientName);
    await page
      .getByLabel("Signed evidence location or reference")
      .fill("Synthetic accepted estimate");
    await page.getByLabel("Date on evidence").fill(date());
    await page.getByLabel("I verified this specific estimate", { exact: false }).check();
    await page.getByRole("button", { name: "Record acceptance", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Accepted incomplete plan item", exact: true })
      .selectOption({ index: 1 });
    await page
      .getByRole("combobox", { name: "Assigned active visit", exact: true })
      .selectOption(encounterId);
    await save(page, `/v1/encounters/${encounterId}/procedures`, "Record completed procedure");
    await choose(page, "encounter");
    await page
      .getByRole("button", { name: /drafting|in progress|in consultation/ })
      .first()
      .click();
    const note = page.getByRole("region", { name: "Clinical note", exact: true });
    await note
      .locator("textarea")
      .first()
      .fill("Synthetic clinical examination for workflow testing only");
    await note.getByLabel("Ready for assigned doctor", { exact: false }).check();
    await save(page, `/v1/encounters/${encounterId}`, "Save note draft");
    await page.getByLabel("I reviewed this exact draft", { exact: false }).check();
    await save(page, `/v1/encounters/${encounterId}/sign-note`, "Sign reviewed note");
    await save(
      page,
      `/v1/encounters/${encounterId}/close`,
      "Finish visit and complete linked appointment"
    );
    const final = await api(page, `/v1/encounters/${encounterId}`, "GET", undefined, "doctor");
    expect(final.encounter.status).toBe("closed");
    const day = await api(page, `/v1/dashboard/morning?date=${date()}`);
    expect(
      day.dashboard.clinicDayAppointments.find((a: any) => a.id === appointmentId).status
    ).toBe("completed");
    await note
      .getByLabel("Reason for correction", { exact: true })
      .fill("Synthetic correction preserves signed history");
    await save(page, `/v1/encounters/${encounterId}/amend-note`, "Sign correction");
    const amended = await api(page, `/v1/encounters/${encounterId}`, "GET", undefined, "doctor");
    expect(amended.encounter.status).toBe("closed");
    await page.screenshot({ path: info.outputPath("consultation.png"), fullPage: true });
    await choose(page, "dental-media");
    await page.getByLabel("FDI tooth number", { exact: true }).fill("16");
    await page
      .getByLabel("Clinical notes", { exact: true })
      .fill("Synthetic chart finding for workflow verification");
    await save(page, `/v1/patients/${patientId}/dental-findings`, "Record finding");
    await page
      .getByLabel("Snapshot reason", { exact: true })
      .fill("Synthetic baseline chart record");
    await save(page, `/v1/patients/${patientId}/dental-chart/snapshots`, "Save snapshot");
    await choose(page, "checkout");
    await page
      .getByLabel("Clinic-approved template or protocol reference", { exact: true })
      .fill("Synthetic rehearsal instruction reference");
    await page.getByLabel("Title", { exact: true }).fill("Synthetic care instruction");
    await page
      .getByLabel("Clinician-entered instruction text", { exact: true })
      .fill("Synthetic test instruction only; no clinical advice");
    await page.getByLabel("I checked this text against", { exact: false }).check();
    await save(page, `/v1/patients/${patientId}/instructions`, "Save print instruction request");
    const instructionPopup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Print saved instruction", exact: true }).click();
    const print = await instructionPopup;
    await expect(print.locator("body")).toContainText("Synthetic test instruction only");
    await print.close();
    await page.context().close();
  });
  test("reception invoices completed work, receives partial payment and prints a receipt", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "receptionist");
    await choose(page, "checkout");
    const issue = page.locator("form").filter({
      has: page.getByRole("button", { name: "Issue invoice for selected completed work" })
    });
    await issue.getByRole("checkbox").first().check();
    const created = await save(page, "/v1/invoices", "Issue invoice for selected completed work");
    const invoiceId = created.invoice.id;
    await page.getByLabel("Amount received (INR)").fill("400.00");
    await page.getByLabel("Clinic payment reference").fill(`synthetic-cash-${tag}`);
    await page.getByLabel("Audit reason").fill("Synthetic received cash evidence");
    await page.getByLabel("Evidence location", { exact: true }).fill("Synthetic cash register");
    await save(page, `/v1/invoices/${invoiceId}/manual-payments`, "Record received payment");
    const receipt = page.getByRole("region", { name: "Generate receipt", exact: true });
    await receipt.getByRole("checkbox").first().check();
    await save(
      page,
      `/v1/invoices/${invoiceId}/receipts`,
      "Generate receipt for selected payments"
    );
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Print saved receipt", exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.locator("body")).toContainText(patientName);
    await popup.close();
    const detail = await api(page, `/v1/invoices/${invoiceId}`);
    expect(detail.invoice.paidMinor).toBe(40000);
    expect(detail.invoice.balanceMinor).toBe(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath("checkout-mobile.png"), fullPage: true });
    await page.context().close();
  });
  test("staff operations persist tasks and restricted roles cannot edit clinic or clinical records", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    await page.goto("/surface/tasks");
    const form = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create task", exact: true }) });
    await form.getByLabel("Title", { exact: true }).fill(`Synthetic daily task ${tag}`);
    await form.getByLabel("Instructions", { exact: true }).fill("Synthetic workflow verification");
    const task = (await save(page, "/v1/tasks", "Create task")).task;
    const progress = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Progress task" }) });
    await progress.getByRole("combobox", { name: "Task", exact: true }).selectOption(task.id);
    await progress.getByRole("combobox", { name: "New state", exact: true }).selectOption("done");
    await progress.getByLabel("Completion evidence").fill("Synthetic task completed and reviewed");
    await save(page, `/v1/tasks/${task.id}`, "Record task state");
    const recallRule = page.locator("form").filter({
      has: page.getByRole("heading", { name: "Create recall rule", exact: true })
    });
    await recallRule.getByLabel("Code", { exact: true }).fill(`daily-recall-${tag}`);
    await recallRule.getByLabel("Rule title", { exact: true }).fill(`Synthetic recall ${tag}`);
    await recallRule.getByLabel("Days after procedure").fill("180");
    await save(page, "/v1/recall-rules", "Create rule");
    const due = await save(page, "/v1/tasks/generate-due", "Generate due recalls and follow-ups");
    expect(due.processedCount).toBeLessThanOrEqual(25);
    expect(
      due.recallsCreated.some((row: { patientId: string }) => row.patientId === patientId)
    ).toBe(false);
    const sopForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create SOP template", exact: true }) });
    await sopForm.getByLabel("Code", { exact: true }).fill(`daily-sop-${tag}`);
    await sopForm.getByLabel("Title", { exact: true }).fill(`Synthetic daily SOP ${tag}`);
    await sopForm.getByLabel("Checklist item 1", { exact: true }).fill("Synthetic required check");
    const sopTemplate = (await save(page, "/v1/sop-templates", "Create template")).sopTemplate;
    const scheduleForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Recurring SOP schedule", exact: true }) });
    await scheduleForm
      .getByRole("combobox", { name: "Template", exact: true })
      .selectOption(sopTemplate.id);
    await scheduleForm
      .getByLabel("Schedule title", { exact: true })
      .fill(`Synthetic daily schedule ${tag}`);
    await scheduleForm.getByLabel("Start date", { exact: true }).fill(date());
    await scheduleForm.getByLabel("Clinic local due time", { exact: true }).fill("00:00");
    await save(page, "/v1/sop-schedules", "Create schedule");
    const generation = await save(page, "/v1/sop-runs/generate-due", "Generate due SOP runs");
    expect(generation.sopRunsCreated).toHaveLength(1);
    const runId = generation.sopRunsCreated[0].id;
    await page.getByRole("combobox", { name: "SOP run", exact: true }).selectOption(runId);
    await page
      .getByRole("combobox", { name: "Checklist item or complete entire run", exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("Observed completion evidence", { exact: true })
      .fill("Synthetic checklist item verified");
    const itemUpdate = await save(page, `/v1/sop-runs/${runId}`, "Record SOP evidence");
    expect(
      itemUpdate.sopRun.items.every((item: { status: string }) => item.status === "done")
    ).toBe(true);
    await page
      .getByRole("combobox", { name: "Checklist item or complete entire run", exact: true })
      .selectOption("");
    await page
      .getByLabel("Observed completion evidence", { exact: true })
      .fill("Synthetic full run verified");
    const completedRun = await save(page, `/v1/sop-runs/${runId}`, "Record SOP evidence");
    expect(completedRun.sopRun.status).toBe("completed");
    const persistedRuns = await api(page, "/v1/sop-runs");
    expect(persistedRuns.sopRuns.find((row: { id: string }) => row.id === runId).status).toBe(
      "completed"
    );
    const ownerDashboard = await api(page, "/v1/owner-dashboard");
    expect(ownerDashboard.dashboard.sops).toMatchObject({ due: 1, completed: 1, overdue: 0 });
    await page.goto("/surface/operations");
    const categoryForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create category", exact: true }) });
    await categoryForm.getByLabel("Code", { exact: true }).fill(`daily-category-${tag}`);
    await categoryForm.getByLabel("Name", { exact: true }).fill(`Synthetic materials ${tag}`);
    const category = (await save(page, "/v1/inventory/categories", "Create category")).category;
    const itemForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create inventory item", exact: true }) });
    await itemForm
      .getByRole("combobox", { name: "Category", exact: true })
      .selectOption(category.id);
    await itemForm.getByLabel("SKU", { exact: true }).fill(`daily-sku-${tag}`);
    await itemForm.getByLabel("Item name").fill(`Synthetic item ${tag}`);
    await itemForm.getByLabel("Unit of measure").fill("unit");
    await itemForm.getByLabel("Storage location").fill("Synthetic drawer");
    const item = (await save(page, "/v1/inventory/items", "Create item")).item;
    const checkForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create check template", exact: true }) });
    await checkForm.getByLabel("Code", { exact: true }).fill(`daily-check-${tag}`);
    await checkForm.getByLabel("Name", { exact: true }).fill(`Synthetic stock check ${tag}`);
    await checkForm.getByRole("combobox", { name: "Item 1", exact: true }).selectOption(item.id);
    await checkForm.getByLabel("Drawer or location").fill("Synthetic drawer");
    const checkTemplate = (await save(page, "/v1/inventory/check-templates", "Create template"))
      .template;
    const start = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Start check", exact: true }) });
    await start
      .getByRole("combobox", { name: "Template", exact: true })
      .selectOption(checkTemplate.id);
    const check = (await save(page, "/v1/inventory/check-runs", "Start check run")).checkRun;
    await page.getByRole("combobox", { name: "Check run", exact: true }).selectOption(check.run.id);
    await page.getByLabel(`Synthetic item ${tag}`, { exact: true }).fill("5");
    await save(page, `/v1/inventory/check-runs/${check.run.id}`, "Complete count");
    const incidentForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Report incident" }) });
    await incidentForm.getByLabel("Clinic local occurrence time").fill(`${date()}T09:00`);
    await incidentForm.getByLabel("Summary", { exact: true }).fill(`Synthetic incident ${tag}`);
    await incidentForm
      .getByLabel("Description", { exact: true })
      .fill("Synthetic process issue for verification");
    const incident = (await save(page, "/v1/incidents", "Record incident")).incident;
    const capa = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Assign corrective action" }) });
    await capa
      .getByRole("combobox", { name: "Related incident", exact: true })
      .selectOption(incident.id);
    await capa.getByLabel("Title", { exact: true }).fill(`Synthetic correction ${tag}`);
    await capa.getByLabel("Description", { exact: true }).fill("Synthetic corrective process");
    await capa.getByLabel("Clinic local due time").fill(`${date()}T23:00`);
    const corrective = (await save(page, "/v1/corrective-actions", "Create action"))
      .correctiveAction;
    const capaProgress = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Progress action" }) });
    await capaProgress
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption(corrective.id);
    await capaProgress
      .getByRole("combobox", { name: "New state", exact: true })
      .selectOption("completed");
    await capaProgress
      .getByLabel("Completion or progress evidence")
      .fill("Synthetic corrective work completed");
    await capaProgress
      .getByLabel("Independent verification evidence")
      .fill("Synthetic independent review recorded");
    await save(page, `/v1/corrective-actions/${corrective.id}`, "Record action state");
    await page.goto("/surface/lab");
    await page.getByLabel("Vendor name").fill(`Synthetic lab ${tag}`);
    const vendor = (await save(page, "/v1/lab-vendors", "Add vendor")).labVendor;
    await page.getByLabel("Patient name or phone").fill(patientName);
    await page.getByRole("button", { name: "Search patients", exact: true }).click();
    await page.getByRole("combobox", { name: "Patient", exact: true }).selectOption(patientId);
    const labForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create lab case and slip" }) });
    await labForm.getByRole("combobox", { name: "Vendor", exact: true }).selectOption(vendor.id);
    await labForm.getByLabel("Case title").fill(`Synthetic lab case ${tag}`);
    await labForm.getByLabel("Clinic local due time").fill(`${date()}T23:00`);
    await labForm.getByLabel("Item type").fill("Synthetic dental item");
    await labForm.getByLabel("Agreed lab cost in INR (optional)").fill("500.00");
    const lab = (await save(page, "/v1/lab-cases", "Create case")).labCase.labCase;
    const labProgress = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Record lab progress", exact: true }) });
    await labProgress.getByRole("combobox", { name: "Case", exact: true }).selectOption(lab.id);
    await labProgress
      .getByRole("combobox", { name: "New state", exact: true })
      .selectOption({ index: 0 });
    await labProgress
      .getByLabel("Evidence observed", { exact: true })
      .fill("Synthetic lab handoff evidence");
    await save(page, `/v1/lab-cases/${lab.id}`, "Record progress");
    const reconcile = page.locator("section.work-panel").filter({
      has: page.getByRole("heading", { name: "Lab invoice reconciliation", exact: true })
    });
    await reconcile.getByRole("combobox", { name: "Vendor", exact: true }).selectOption(vendor.id);
    await reconcile.getByLabel("Period start", { exact: true }).fill(date());
    await reconcile.getByLabel("Period end", { exact: true }).fill(date());
    await reconcile
      .getByLabel("Invoice reference (if received)", { exact: true })
      .fill(`synthetic-lab-invoice-${tag}`);
    await reconcile
      .getByRole("checkbox", { name: new RegExp(`Synthetic lab case ${tag}`) })
      .check();
    await reconcile
      .getByLabel(`Invoice amount (INR) for Synthetic lab case ${tag}`, { exact: true })
      .fill("500.00");
    await reconcile.getByLabel("Invoice total (INR)", { exact: true }).fill("500.00");
    await reconcile
      .getByRole("combobox", { name: "Reconciliation state", exact: true })
      .selectOption("matched");
    await reconcile
      .getByLabel("Reconciliation evidence", { exact: true })
      .fill("Synthetic vendor invoice reviewed against case");
    await save(page, "/v1/lab-reconciliations", "Create reconciliation");
    for (const [path, key] of [
      ["leads", "leads"],
      ["tasks", "tasks"],
      ["sop-runs", "sopRuns"],
      ["lab-vendors", "labVendors"],
      ["lab-cases", "labCases"],
      ["inventory/categories", "categories"],
      ["inventory/items", "items"],
      ["inventory/check-templates", "templates"],
      ["pricebook/procedures", "procedures"],
      ["incidents", "incidents"],
      ["corrective-actions", "correctiveActions"]
    ]) {
      const first = await api(page, `/v1/${path}?limit=1`);
      expect(first[key]).toHaveLength(1);
      expect(first.nextCursor).toBe(first[key][0].labCase?.id ?? first[key][0].id);
      const second = await api(page, `/v1/${path}?limit=1&cursor=${first.nextCursor}`);
      expect(second[key].some((row: any) => (row.labCase?.id ?? row.id) === first.nextCursor)).toBe(
        false
      );
    }
    for (const surface of ["lab", "operations", "owner-control"]) {
      console.log(`Opening ${surface}`);
      await page.goto(`/surface/${surface}`);
      await expect(page.locator(".operations-forms")).toBeVisible();
      await expect(page.locator(".operations-forms")).toBeEnabled();
      await expect(page.locator("main")).not.toContainText("Unhandled");
      if (surface === "owner-control") {
        await expect(
          page
            .locator("dt")
            .filter({ hasText: /^invoiced$/ })
            .locator("..")
        ).toContainText("₹");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`${surface}.png`), fullPage: true });
    }
    const forbidden = await page.request.post("/v1/clinic-setup/chair", {
      headers: {
        authorization: "Bearer local-synthetic-receptionist",
        "x-clinic-id": clinic,
        "idempotency-key": randomUUID()
      },
      data: { configuration: { code: "denied", displayName: "denied", active: true } }
    });
    expect(forbidden.status()).toBe(403);
    const clinical = await page.request.get(`/v1/encounters/${encounterId}`, {
      headers: { authorization: "Bearer local-synthetic-accountant", "x-clinic-id": clinic }
    });
    expect(clinical.status()).toBe(403);
    await page.context().close();
  });
});
