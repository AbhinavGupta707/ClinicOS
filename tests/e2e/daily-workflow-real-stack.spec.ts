import { renderPatientDocumentV1 } from "@clinic-os/domain";
import { readFile } from "node:fs/promises";
import { test, expect, type Page, type Browser } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
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

const generatedDocuments: Array<{ kind: string; path: string; document: any }> = [];
async function exerciseDocument(
  page: Page,
  kind: string,
  label: string,
  expected: string,
  info: any
) {
  const region = page
    .getByRole("region", { name: `${kind.replaceAll("_", " ")} documents`, exact: true })
    .first();
  await region.getByRole("button", { name: label, exact: true }).click();
  const preview = region.locator("iframe").contentFrame();
  await expect(preview.locator("body")).toContainText(expected);
  await expect(preview.locator("body")).toContainText("PREVIEW ONLY");
  await region.getByLabel("I reviewed this source", { exact: false }).check();
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /document-sources\/[^/]+\/[^/]+\/documents$/.test(new URL(r.url()).pathname)
  );
  await region.getByRole("button", { name: "Generate reviewed copy", exact: true }).click();
  const issued = await response;
  expect(issued.ok(), await issued.text()).toBe(true);
  const issuedBody = await issued.json();
  const path = new URL(issued.url()).pathname;
  await expect(
    region.getByRole("button", { name: "Download printable HTML", exact: true })
  ).toBeEnabled();
  const doc = (await api(page, `${path}/${issuedBody.documentId}`)).document;
  expect(doc.html).toContain(expected);
  expect(doc.html).not.toContain("PREVIEW ONLY");
  const downloading = page.waitForEvent("download");
  await region.getByRole("button", { name: "Download printable HTML", exact: true }).click();
  const download = await downloading;
  const local = info.outputPath(`${kind}.html`);
  await download.saveAs(local);
  expect(
    createHash("sha256")
      .update(await readFile(local))
      .digest("hex")
  ).toBe(doc.htmlDigest);
  // Observe from the parent realm: document scripts are intentionally sandboxed.
  await region.locator("iframe").evaluate((frame: HTMLIFrameElement) => {
    frame.contentWindow!.addEventListener("beforeprint", () => {
      frame.dataset.printRequested = "yes";
    });
  });
  await region.getByRole("button", { name: "Print / Save as PDF", exact: true }).click();
  await expect(region.locator("iframe")).toHaveAttribute("data-print-requested", "yes");
  const printPage = await page.context().newPage();
  await printPage.setContent(doc.html);
  await printPage.pdf({
    path: info.outputPath(`${kind}.pdf`),
    preferCSSPageSize: true,
    printBackground: true
  });
  await printPage.close();
  generatedDocuments.push({ kind, path, document: doc });
  if (kind !== "invoice")
    await region.getByRole("button", { name: "Close document preview", exact: true }).click();
  return doc;
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
    // Commit to real PostgreSQL, then lose only the first response. Recovery must
    // reuse the request and select the actual created patient, not leave a fresh form.
    let registered: { patient: { id: string; dateOfBirth: string } };
    let firstKey: string | undefined;
    await page.route("**/v1/patients", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const key = route.request().headers()["idempotency-key"];
      if (firstKey) {
        expect(key).toBe(firstKey);
        return route.continue();
      }
      firstKey = key;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      registered = await response.json();
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Create patient", exact: true }).click();
    await page.getByRole("button", { name: "Retry previous request", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save demographics", exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(patientName);
    await expect(page.getByRole("button", { name: "Create patient", exact: true })).toHaveCount(0);
    await page.unroute("**/v1/patients");
    expect(firstKey).toBeTruthy();
    patientId = registered!.patient.id;
    expect(registered!.patient.dateOfBirth).toBe("1991-06-15");
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
    await exerciseDocument(
      page,
      "prescription",
      "Review prescription document",
      "SyntheticTestMedication",
      info
    );
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
    await exerciseDocument(page, "estimate", "Review estimate document", planName, info);
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
    // Establish real SPA history for Back/Forward recovery, not a page reload.
    await page.locator('a.nav-item[href="/"]').click();
    await page.locator('a.nav-item[href="/surface/encounter"]').click();
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
    // Ordinary navigation must not silently drop a clinical draft. All records
    // below are committed through the real API; only the save latency is injected.
    await api(page, "/v1/encounters", "POST", {
      patientId,
      providerUserId: doctor,
      reason: "Synthetic alternate visit"
    });
    await page
      .getByRole("heading", { name: "Visits", exact: true })
      .locator("..")
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await page.getByRole("button", { name: /Synthetic alternate visit/ }).click();
    const guardMessage = "Save or explicitly discard the unsaved clinical note";
    await expect(page.getByRole("alert").filter({ hasText: guardMessage })).toBeVisible();
    await expect(note.locator("textarea").first()).toHaveValue(
      "Synthetic clinical examination for workflow testing only"
    );
    const alternateName = `SyntheticAlternate-${tag}`;
    await api(page, "/v1/patients", "POST", {
      fullName: alternateName,
      phone: "+919001119977",
      source: "manual"
    });
    await page.getByLabel("Find patient", { exact: true }).fill(alternateName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(alternateName) }).click();
    await expect(page.getByRole("heading", { name: patientName, exact: true })).toBeVisible();
    await page.locator('a.nav-item[href="/"]').click();
    await expect(note.locator("textarea").first()).toHaveValue(
      "Synthetic clinical examination for workflow testing only"
    );
    await page.goBack();
    await expect(note).toHaveCount(0);
    await page.goForward();
    await expect(note.locator("textarea").first()).toHaveValue(
      "Synthetic clinical examination for workflow testing only"
    );
    await expect(note.getByText("Your unsaved note was recovered", { exact: false })).toBeVisible();
    await page.route("**/v1/me", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "SERVER_ERROR", message: "Synthetic outage" } })
      })
    );
    await page.getByRole("button", { name: "Refresh session context" }).click();
    await expect(page.getByRole("heading", { name: "Staff access unavailable" })).toBeVisible();
    await page.unroute("**/v1/me");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(note.locator("textarea").first()).toHaveValue(
      "Synthetic clinical examination for workflow testing only"
    );
    const concurrentVisit = await api(page, `/v1/encounters/${encounterId}`);
    await api(
      page,
      `/v1/encounters/${encounterId}`,
      "PATCH",
      {
        content: { chiefComplaint: "Synthetic concurrently saved note" },
        readyForSign: false
      },
      "doctor",
      concurrentVisit.encounter.rowVersion
    );
    await page
      .getByRole("heading", { name: "Selected visit", exact: true })
      .locator("..")
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await expect(note.getByRole("button", { name: "Save note draft" })).toBeDisabled();
    await expect(note.locator("textarea").first()).toHaveValue(
      "Synthetic clinical examination for workflow testing only"
    );
    // Explicit discard clears only unsaved content; save remains reachable.
    await note.getByRole("button", { name: "Discard unsaved note changes" }).click();
    await expect(note.locator("textarea").first()).toHaveValue("Synthetic concurrently saved note");
    await expect(page.getByRole("alert").filter({ hasText: guardMessage })).toHaveCount(0);
    await note
      .locator("textarea")
      .first()
      .fill("Synthetic clinical examination for workflow testing only");
    await note.getByLabel("Ready for assigned doctor", { exact: false }).check();
    let releaseSave!: () => void;
    let observedSave!: () => void;
    const holdSave = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const saving = new Promise<void>((resolve) => {
      observedSave = resolve;
    });
    const notePath = `**/v1/encounters/${encounterId}`;
    await page.route(notePath, async (route) => {
      if (route.request().method() === "GET") return route.continue();
      const response = await route.fetch();
      observedSave();
      await holdSave;
      await route.fulfill({ response });
    });
    const saveNote = save(page, `/v1/encounters/${encounterId}`, "Save note draft");
    await saving;
    try {
      for (const field of await note.locator("textarea").all()) await expect(field).toBeDisabled();
      await expect(note.getByLabel("Ready for assigned doctor to review and sign")).toBeDisabled();
    } finally {
      releaseSave();
    }
    await saveNote;
    await page.unroute(notePath);
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
    await exerciseDocument(
      page,
      "instruction",
      "Review instruction document",
      "Synthetic test instruction only",
      info
    );
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
    await exerciseDocument(page, "invoice", "Review invoice document", patientName, info);
    await page.getByLabel("Amount received (INR)").fill("400.00");
    await page.getByLabel("Clinic payment reference").fill(`synthetic-cash-${tag}`);
    await page.getByLabel("Audit reason").fill("Synthetic received cash evidence");
    await page.getByLabel("Evidence location", { exact: true }).fill("Synthetic cash register");
    await save(page, `/v1/invoices/${invoiceId}/manual-payments`, "Record received payment");
    const invoiceDocument = page.getByRole("region", { name: "invoice documents", exact: true });
    await expect(
      invoiceDocument.getByLabel("Source or display details have changed", { exact: false })
    ).toBeVisible();
    await expect(
      invoiceDocument.getByRole("button", { name: "Download printable HTML", exact: true })
    ).toBeDisabled();
    await invoiceDocument
      .getByLabel("Source or display details have changed", { exact: false })
      .check();
    await expect(
      invoiceDocument.getByRole("button", { name: "Download printable HTML", exact: true })
    ).toBeEnabled();
    const receipt = page.getByRole("region", { name: "Generate receipt", exact: true });
    await receipt.getByRole("checkbox").first().check();
    await save(
      page,
      `/v1/invoices/${invoiceId}/receipts`,
      "Generate receipt for selected payments"
    );
    await exerciseDocument(page, "receipt", "Review receipt document", patientName, info);
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
    await exerciseDocument(page, "lab_slip", "Review lab slip document", patientName, info);
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
  test("financial account preserves deposits, allocations, credits, refunds and corrections", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    await choose(page, "checkout");
    await page.getByRole("button", { name: "Accounts and reconciliation", exact: true }).click();
    await expect(page.getByTestId("financial-operations")).toBeVisible();
    const invoices = await api(page, `/v1/patients/${patientId}/invoices`);
    const invoiceId = invoices.invoices[0].id;
    async function command(kind: string, amount: string, target?: string) {
      await page
        .getByRole("combobox", { name: "Financial action", exact: true })
        .selectOption(kind);
      if (
        [
          "advance_allocated",
          "allocation_reversed",
          "invoice_credit",
          "payment_refund",
          "payment_reversal"
        ].includes(kind)
      )
        await page
          .getByRole("combobox", { name: "Invoice to adjust", exact: true })
          .selectOption(invoiceId);
      if (target)
        await page
          .getByRole("combobox", { name: "Original financial evidence", exact: true })
          .selectOption(target);
      if (["payment_refund", "advance_returned"].includes(kind))
        await page
          .getByRole("combobox", { name: "Financial payment method", exact: true })
          .selectOption("bank_transfer");
      if (!["invoice_credit", "expense_reversal"].includes(kind))
        await page.getByLabel("Financial amount in INR").fill(amount);
      await page
        .getByLabel("Financial reference", { exact: true })
        .fill(`SyntheticFinance-${kind}-${randomUUID()}`);
      await page
        .getByLabel("Financial reason", { exact: true })
        .fill("Synthetic reviewed evidence only");
      await page
        .getByLabel("I reviewed the account, original evidence and actual money movement.")
        .check();
      return (await save(page, "/v1/financial-operations", "Save financial evidence")).entry;
    }
    const advance = await command("advance_received", "300");
    const allocation = await command("advance_allocated", "200", advance.id);
    await command("allocation_reversed", "50", allocation.id);
    let invoice = (await api(page, `/v1/invoices/${invoiceId}`)).invoice;
    expect(invoice.paidMinor).toBe(55000);
    expect(invoice.balanceMinor).toBe(45000);
    await command("invoice_credit", "", invoice.items[0].id);
    const payment = invoice.payments.find(
      (p: { method: string }) => p.method !== "advance_allocation"
    );
    await command("payment_refund", "100", payment.id);
    await command("payment_reversal", "50", payment.id);
    await command("advance_returned", "100", advance.id);
    const expense = await command("expense", "25");
    await command("expense_reversal", "", expense.id);
    invoice = (await api(page, `/v1/invoices/${invoiceId}`)).invoice;
    expect({
      total: invoice.totalMinor,
      credit: invoice.creditedMinor,
      paid: invoice.paidMinor,
      refund: invoice.refundedMinor,
      due: invoice.balanceMinor
    }).toEqual({ total: 100000, credit: 100000, paid: 50000, refund: 10000, due: 0 });
    expect(invoice.receipts).toHaveLength(1);
    expect(invoice.receipts[0].amountMinor).toBe(40000);
    const account = (await api(page, `/v1/patients/${patientId}/financial-account`)).account;
    expect(account.advances.find((a: { id: string }) => a.id === advance.id).availableMinor).toBe(
      5000
    );
    expect(account.totals.refundableMinor).toBe(40000);
    expect(
      account.entries
        .filter((e: any) => ["payment_refund", "advance_returned"].includes(e.kind))
        .every((e: any) => e.method === "bank_transfer")
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("financial-account-mobile.png"),
      fullPage: true
    });
    await page.context().close();
  });
  test("financial retries, concurrent returns and permissions preserve one durable outcome", async ({
    browser
  }) => {
    const page = await rolePage(browser, "owner");
    const headers = {
      authorization: "Bearer local-synthetic-owner",
      "x-clinic-id": clinic,
      "idempotency-key": randomUUID()
    };
    const body = {
      kind: "advance_received",
      patientId,
      amountMinor: 10000,
      method: "cash",
      reason: "Synthetic concurrency trial",
      reference: `SyntheticConcurrent-${tag}`
    };
    const a = await page.request.post("/v1/financial-operations", { headers, data: body });
    expect(a.status(), await a.text()).toBe(201);
    const entry = (await a.json()).entry;
    const replay = await page.request.post("/v1/financial-operations", { headers, data: body });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).entry.id).toBe(entry.id);
    const duplicateReference = await page.request.post("/v1/financial-operations", {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: body
    });
    expect(duplicateReference.status()).toBe(409);

    const returns = await Promise.all(
      [0, 1].map((n) =>
        page.request.post("/v1/financial-operations", {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            kind: "advance_returned",
            method: "bank_transfer",
            patientId,
            targetEntryId: entry.id,
            amountMinor: 7000,
            reason: "Synthetic return",
            reference: `SyntheticReturn-${tag}-${n}`
          }
        })
      )
    );
    expect(returns.map((r) => r.status()).sort()).toEqual([201, 409]);
    const denied = await page.request.post("/v1/financial-operations", {
      headers: {
        ...headers,
        authorization: "Bearer local-synthetic-receptionist",
        "idempotency-key": randomUUID()
      },
      data: {
        kind: "expense",
        amountMinor: 100,
        method: "cash",
        reason: "Denied synthetic expense",
        reference: randomUUID()
      }
    });
    expect(denied.status()).toBe(403);
    const cross = await page.request.get(`/v1/patients/${patientId}/financial-account`, {
      headers: { ...headers, "x-clinic-id": "20000000-0000-4000-8000-000000000101" }
    });
    expect(cross.status()).toBe(403);

    const invoices = (await api(page, `/v1/patients/${patientId}/invoices`)).invoices;
    const invoice = (await api(page, `/v1/invoices/${invoices[0].id}`)).invoice;
    const payment = invoice.payments.find((p: any) => p.method !== "advance_allocation");
    for (const deniedBody of [
      {
        kind: "invoice_credit",
        invoiceItemId: invoice.items[0].id,
        expectedVersion: invoice.financialVersion
      },
      {
        kind: "payment_refund",
        method: "bank_transfer",
        paymentTransactionId: payment.id,
        amountMinor: 40001,
        expectedVersion: invoice.financialVersion
      },
      {
        kind: "payment_reversal",
        paymentTransactionId: payment.id,
        amountMinor: 1,
        expectedVersion: 1
      }
    ]) {
      const r = await page.request.post("/v1/financial-operations", {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: {
          patientId,
          invoiceId: invoice.id,
          reason: "Rejected synthetic adjustment",
          reference: randomUUID(),
          ...deniedBody
        }
      });
      expect(r.status(), await r.text()).toBe(409);
    }
    const allocation = invoice.payments.find((p: any) => p.method === "advance_allocation");
    const duplicateReceipt = await page.request.post(`/v1/invoices/${invoice.id}/receipts`, {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: { paymentTransactionIds: [allocation.id] }
    });
    expect(duplicateReceipt.status()).toBe(409);
    const account = (await api(page, `/v1/patients/${patientId}/financial-account`)).account;
    expect(account.advances.find((a: { id: string }) => a.id === entry.id).availableMinor).toBe(
      3000
    );
    await page.context().close();
  });
  test("Practo observations require human review and create or link one actual booking", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    await page.goto("/surface/migration-review");
    const panel = page.getByTestId("appointment-import-workspace");
    await expect(panel).toBeVisible();
    const future = new Date(`${date()}T00:00:00Z`);
    future.setUTCDate(future.getUTCDate() + 7);
    const day = future.toISOString().slice(0, 10);
    const csv = `Date,Patient Number,Patient Name,Notes,DoctorName,Status,Checked In At,Checked Out At\n'${day} 10:30:00',P-001,${patientName},NEVER_TRANSFER,Source Doctor,'Scheduled',EXCLUDED,EXCLUDED\n'${day} 10:30:00',P-001,${patientName},NEVER_TRANSFER,Source Doctor,'Scheduled',,\n'2015-11-20 11:00:00',P-001,${patientName},NEVER_TRANSFER,Source Doctor,'Cancelled',,\n`;
    await panel.getByLabel("Appointment source name").fill(`Synthetic Ray ${tag}`);
    await panel
      .getByLabel("Practo appointments.csv")
      .setInputFiles({ name: "appointments.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(panel.getByText("3 observations prepared.", { exact: false })).toBeVisible();
    await panel.getByLabel("I approve these fields", { exact: false }).check();
    await panel.getByRole("button", { name: "Save appointment evidence" }).click();
    await expect(panel.getByText("Source file complete.", { exact: false })).toBeVisible();
    await expect(
      panel.getByRole("combobox", { name: "Saved appointment import", exact: true })
    ).toHaveValue(/[a-f0-9-]{36}/);
    const runId = await panel
      .getByRole("combobox", { name: "Saved appointment import", exact: true })
      .inputValue();
    const detail = await api(page, `/v1/appointment-imports/${runId}`);
    expect(detail.rows).toHaveLength(3);
    expect(JSON.stringify(detail)).not.toContain("NEVER_TRANSFER");
    expect(JSON.stringify(detail)).not.toContain("EXCLUDED");
    await panel.getByRole("button", { name: /^Observation 1:/ }).click();
    await panel
      .getByRole("combobox", { name: "Observation decision", exact: true })
      .selectOption("create");
    await panel.getByLabel("Find patient", { exact: true }).fill(patientName);
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await panel
      .getByRole("region", { name: "Choose patient", exact: true })
      .getByRole("button", { name: new RegExp(patientName) })
      .click();
    await panel
      .getByRole("combobox", { name: "Reviewed doctor", exact: true })
      .selectOption(doctor);
    await panel
      .getByRole("combobox", { name: "Reviewed visit type", exact: true })
      .selectOption("10000000-0000-4000-8000-000000003001");
    await panel.getByLabel("Reviewed start").fill(`${day}T10:30`);
    await panel.getByLabel("Reviewed end").fill(`${day}T11:00`);
    await panel.getByLabel("I verified the patient, source timezone", { exact: false }).check();
    await panel
      .getByLabel("Observation review reason")
      .fill("Synthetic operator confirmed exact planned booking");
    const reviewed = await save(
      page,
      `/v1/appointment-imports/${runId}/rows/${detail.rows[0].id}/review`,
      "Confirm observation review"
    );
    const createdId = reviewed.observation.appointmentId;
    const replay = await page.request.post(
      `/v1/appointment-imports/${runId}/rows/${detail.rows[0].id}/review`,
      {
        headers: {
          authorization: "Bearer local-synthetic-owner",
          "x-clinic-id": clinic,
          "idempotency-key": randomUUID()
        },
        data: { decision: "history", reason: "Must not replace prior review" }
      }
    );
    expect(replay.status()).toBe(409);
    const linked = await api(
      page,
      `/v1/appointment-imports/${runId}/rows/${detail.rows[1].id}/review`,
      "POST",
      {
        decision: "link",
        reason: "Same booking reviewed explicitly",
        appointmentId: createdId,
        patientId,
        confirmedDetails: true
      }
    );
    expect(linked.observation.appointmentId).toBe(createdId);
    await panel.getByRole("button", { name: /^Observation 3:/ }).click();
    await panel
      .getByLabel("Observation review reason")
      .fill("Historical cancellation, no attendance inferred");
    await save(
      page,
      `/v1/appointment-imports/${runId}/rows/${detail.rows[2].id}/review`,
      "Confirm observation review"
    );
    const schedule = await api(page, `/v1/appointments?date=${day}&limit=100`);
    expect(schedule.appointments.filter((a: { id: string }) => a.id === createdId)).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    expect(
      await panel.evaluate((element) =>
        Array.from(element.querySelectorAll("input,select,textarea,button"))
          .filter((e) => e.getBoundingClientRect().width > 0)
          .every((e) => {
            const r = e.getBoundingClientRect();
            return r.left >= 0 && r.right <= window.innerWidth + 1;
          })
      )
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("appointment-review-mobile.png"),
      fullPage: true
    });
    await page.context().close();
  });
  test("doctor reviews paginated history, exact signed notes and saved dental differences", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "doctor");
    const chart = await api(
      page,
      `/v1/patients/${patientId}/dental-chart`,
      "GET",
      undefined,
      "doctor"
    );
    await api(
      page,
      "/v1/encounters",
      "POST",
      { patientId, providerUserId: doctor, reason: "Synthetic returning visit" },
      "doctor"
    );
    const first = chart.snapshots[0];
    const finding = chart.findings[0];
    await api(
      page,
      `/v1/dental-findings/${finding.id}`,
      "PATCH",
      { status: "watch", changeReason: "Synthetic returning-visit review" },
      "doctor",
      finding.rowVersion
    );
    let second: { id: string } | undefined;
    for (let i = 0; i < 21; i++) {
      const result = await api(
        page,
        `/v1/patients/${patientId}/dental-chart/snapshots`,
        "POST",
        { reason: `Synthetic returning chart ${i + 2}` },
        "doctor"
      );
      if (i === 0) second = result.snapshot;
    }
    await choose(page, "patient-profile");
    const history = page.getByRole("region", { name: "Patient history", exact: true });
    await expect(history.getByText("Page 1", { exact: false })).toBeVisible();
    await history.getByRole("button", { name: "Older records", exact: true }).click();
    await expect(history.getByText("Page 2", { exact: false })).toBeVisible();
    await history.getByRole("button", { name: "Newer records", exact: true }).click();
    await history.getByLabel("History category").selectOption("visits");
    await expect(history.getByRole("button", { name: /Open record:.*signed/i })).toBeVisible();
    await history.getByRole("button", { name: /Open record:.*signed/i }).click();
    const source = page.getByRole("region", { name: "Source record", exact: true });
    await expect(source.getByRole("heading", { name: /Note version.*signed/ })).toBeVisible();
    await expect(source.getByText(/Signed by/)).not.toContainText("unavailable");
    await source.getByRole("button", { name: "Close record" }).click();
    const comparison = page.getByRole("region", { name: "Dental snapshot comparison" });
    await comparison.getByRole("button", { name: "Load older snapshots" }).click();
    await expect(
      comparison.getByLabel("Earlier snapshot").locator("option", { hasText: "Version 1 ·" })
    ).toHaveCount(1);
    await comparison.getByLabel("Earlier snapshot").selectOption(first.id);
    await comparison.getByLabel("Later snapshot").selectOption(second!.id);
    await comparison.getByRole("button", { name: "Compare saved snapshots" }).click();
    await expect(comparison.getByText("Changed fields: status")).toBeVisible();
    await expect(comparison.getByText("watch", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("returning-patient-desktop.png"),
      fullPage: true
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("returning-patient-mobile.png"),
      fullPage: true
    });
    // The actual durable route fails: retain the old view with an explicit stale/error message.
    await page.route(`**/v1/patients/${patientId}/timeline?**`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "Synthetic database outage",
            details: {},
            request_id: "synthetic"
          }
        })
      })
    );
    await history.getByRole("button", { name: "Refresh patient history" }).click();
    await expect(history.getByRole("alert")).toContainText("previously loaded view");
    await page.unroute(`**/v1/patients/${patientId}/timeline?**`);
    const emptyName = `SyntheticHistory-empty-${tag}`;
    const empty = await api(page, "/v1/patients", "POST", {
      fullName: emptyName,
      phone: "+919555333998",
      source: "manual"
    });
    const foreign = await page.request.get(
      `/v1/patients/${empty.patient.id}/dental-snapshots/${first.id}`,
      { headers: { authorization: "Bearer local-synthetic-doctor", "x-clinic-id": clinic } }
    );
    expect(foreign.status()).toBe(404);
    await page.getByLabel("Find patient", { exact: true }).fill(emptyName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(emptyName) }).click();
    await expect(
      page.getByText("No intake is recorded. Medical history is unknown.", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Synthetic prior evidence", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Snapshot differences" })).toHaveCount(0);
    await expect(history.getByRole("button", { name: /Open record:/ })).toHaveCount(0);
    await page.context().close();
    const reception = await rolePage(browser, "receptionist");
    const denied = await reception.request.get(`/v1/patients/${patientId}/dental-snapshots`, {
      headers: { authorization: "Bearer local-synthetic-receptionist", "x-clinic-id": clinic }
    });
    expect(denied.status()).toBe(403);
    await reception.context().close();
  });
  test("patient files preserve historical context, recover interrupted uploads and open exact history metadata", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "doctor");
    await api(
      page,
      `/v1/patients/${patientId}/consents`,
      "POST",
      {
        purpose: "photo_capture",
        templateCode: "synthetic-photo",
        provenance: { source: "automated_test" },
        templateVersion: 1,
        captureMethod: "clinic_staff",
        evidence: { recorded: true }
      },
      "doctor"
    );
    await choose(page, "dental-media");
    const files = page.getByRole("region", { name: "Patient files", exact: true });
    const form = files.getByRole("form", { name: "Add patient file" });
    await form.getByLabel("Source clinic or system").fill("Synthetic former clinic");
    await form.getByLabel("Clinical file", { exact: true }).setInputFiles({
      name: "scan.jfif",
      mimeType: "image/jpeg",
      buffer: Buffer.from("synthetic-image")
    });
    await form.getByRole("button", { name: "Upload securely" }).click();
    await expect(form.getByRole("status")).toContainText("filename extension");
    await expect(page.getByRole("button", { name: "Retry previous request" })).toHaveCount(0);
    await expect(form.getByLabel("Clinical file", { exact: true })).toBeEnabled();
    await form.getByLabel("Clinical file", { exact: true }).setInputFiles({
      name: "synthetic-history.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nSynthetic historical record\n%%EOF")
    });
    await form.getByLabel("Date on source record, if known").fill("2015-11-20");
    let interrupted = false;
    const keys: string[] = [];
    await page.route("**/v1/media/uploads/*/complete", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (!interrupted) {
        interrupted = true;
        const result = await route.fetch();
        expect(result.ok(), await result.text()).toBeTruthy();
        await route.abort("failed");
      } else await route.continue();
    });
    await form.getByRole("button", { name: "Upload securely" }).click();
    await expect(page.getByRole("button", { name: "Retry previous request" })).toBeVisible();
    await page.getByRole("button", { name: "Retry previous request" }).click();
    await expect(files.getByText("Synthetic former clinic", { exact: true })).toBeVisible();
    expect(keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);
    await page.unroute("**/v1/media/uploads/*/complete");
    const listed = await api(page, `/v1/patients/${patientId}/media`, "GET", undefined, "doctor");
    expect(listed.mediaAssets).toHaveLength(1);
    const asset = listed.mediaAssets[0];
    expect(asset.provenance.clinicalFile.recordDate).toBe("2015-11-20");
    expect(asset.scanStatus).toBe("pending");
    await expect(
      files.getByText("Content unavailable until scanning clears this file.")
    ).toBeVisible();
    const denied = await page.request.post(`/v1/media/assets/${asset.id}/signed-url`, {
      headers: {
        authorization: "Bearer local-synthetic-doctor",
        "x-clinic-id": clinic,
        "idempotency-key": randomUUID()
      },
      data: { expiresInSeconds: 300 }
    });
    expect(denied.status()).toBe(409);
    await files.getByLabel("File type filter").selectOption("xray");
    await expect(files.getByText("No files match this patient and filter.")).toBeVisible();
    await files.getByLabel("File type filter").selectOption("document");
    await expect(files.getByText("2015-11-20", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath("patient-files-mobile.png"), fullPage: true });
    // A typed response fixture exercises link expiry only. It does not clear the
    // durable pending asset or claim that a real scanner/storage is activated.
    const listPath = `/v1/patients/${patientId}/media`;
    const listMatcher = (url: URL) => url.pathname === listPath;
    await page.route(listMatcher, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.mediaAssets = body.mediaAssets.map((item: any) => ({
        ...item,
        status: "scan_clean",
        scanStatus: "clean"
      }));
      await route.fulfill({ response, json: body });
    });
    const accessPath = `**/v1/media/assets/${asset.id}/signed-url`;
    await page.route(accessPath, async (route) =>
      route.fulfill({
        json: {
          mediaAsset: { ...asset, status: "scan_clean", scanStatus: "clean" },
          access: {
            signedUrl: "https://media.example.invalid/synthetic",
            expiresAt: new Date(Date.now() + 1500).toISOString()
          }
        }
      })
    );
    await files.getByRole("button", { name: "Refresh files", exact: true }).click();
    await files.getByRole("button", { name: "Prepare file access", exact: true }).click();
    await expect(files.getByRole("link", { name: "Open authorized file" })).toBeVisible();
    await expect(files.getByRole("link", { name: "Open authorized file" })).toHaveCount(0);
    await page.unroute(accessPath);
    await page.unroute(listMatcher);

    await choose(page, "patient-profile");
    const history = page.getByRole("region", { name: "Patient history", exact: true });
    await history.getByLabel("History category").selectOption("media");
    await history.getByRole("button", { name: /Open record:/ }).click();
    await expect(page.getByText("Synthetic former clinic", { exact: true })).toBeVisible();
    await expect(page.getByText("2015-11-20", { exact: true })).toBeVisible();
    const bytes = Buffer.from("%PDF-1.4\nSynthetic paging evidence\n%%EOF");
    const digest = createHash("sha256").update(bytes).digest("hex");
    for (let i = 0; i < 51; i++) {
      const reserved = await api(
        page,
        "/v1/media/upload-urls",
        "POST",
        {
          patientId,
          mediaType: "document",
          originalFilename: "synthetic.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: bytes.length,
          sha256Digest: digest,
          tags: [],
          provenance: { clinicalFile: { source: `Synthetic paging ${i}`, recordDate: null } }
        },
        "doctor"
      );
      await api(page, `/v1/media/uploads/${reserved.upload.id}/content`, "PUT", bytes, "doctor");
      await api(
        page,
        `/v1/media/uploads/${reserved.upload.id}/complete`,
        "POST",
        {
          patientId,
          contentLength: bytes.length,
          sha256Digest: digest,
          mimeType: "application/pdf"
        },
        "doctor"
      );
    }
    await choose(page, "dental-media");
    await expect(files.getByRole("listitem")).toHaveCount(50);
    await expect(files.getByText("Synthetic former clinic", { exact: true })).toHaveCount(0);
    await files.getByRole("button", { name: "Load older files" }).click();
    await expect(files.getByRole("listitem")).toHaveCount(52);
    await expect(files.getByText("Synthetic former clinic", { exact: true })).toBeVisible();
    const exact = await api(
      page,
      `/v1/patients/${patientId}/media/${asset.id}`,
      "GET",
      undefined,
      "doctor"
    );
    expect(exact.mediaAsset.id).toBe(asset.id);
    const restricted = await page.request.get(`/v1/patients/${patientId}/media/${asset.id}`, {
      headers: { authorization: "Bearer local-synthetic-receptionist", "x-clinic-id": clinic }
    });
    expect(restricted.status()).toBe(403);
    const emptyName = `SyntheticFiles-empty-${tag}`;
    const empty = await api(page, "/v1/patients", "POST", {
      fullName: emptyName,
      phone: "+919555333997",
      source: "manual"
    });
    const foreign = await page.request.get(`/v1/patients/${empty.patient.id}/media/${asset.id}`, {
      headers: { authorization: "Bearer local-synthetic-doctor", "x-clinic-id": clinic }
    });
    expect(foreign.status()).toBe(404);

    await form.getByLabel("File kind").selectOption("xray");
    await form.getByLabel("Source clinic or system").fill("Synthetic X-ray source");
    await form.getByLabel("Clinical file", { exact: true }).setInputFiles({
      name: "scan.dcm",
      mimeType: "",
      buffer: Buffer.concat([Buffer.alloc(128), Buffer.from("DICMSynthetic only")])
    });
    await form.getByRole("button", { name: "Upload securely" }).click();
    await expect(form.getByRole("status")).toContainText("File recorded");
    await files.getByLabel("File type filter").selectOption("xray");
    await expect(files.getByRole("listitem")).toHaveCount(1);
    await expect(files.getByText("Synthetic X-ray source", { exact: true })).toBeVisible();
    await expect(files.getByRole("definition").filter({ hasText: /^Unknown$/ })).toHaveCount(1);
    await page.getByLabel("Find patient", { exact: true }).fill(emptyName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(emptyName) }).click();
    await expect(files.getByText("No files match this patient and filter.")).toBeVisible();
    await expect(files.getByText("Synthetic X-ray source", { exact: true })).toHaveCount(0);

    await noOverflow(page);
    await page.context().close();
  });
  test("generated documents preserve exact copies, enforce source authority and reject stale previews", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    expect(generatedDocuments.map((d) => d.kind).sort()).toEqual([
      "estimate",
      "instruction",
      "invoice",
      "lab_slip",
      "prescription",
      "receipt"
    ]);
    for (const entry of generatedDocuments) {
      const reread = (await api(page, `${entry.path}/${entry.document.id}`)).document;
      expect(reread.htmlDigest).toBe(entry.document.htmlDigest);
      expect(reread.html).toBe(entry.document.html);
      const wrong = await page.request.get(
        `${entry.path.replace(patientId, doctor)}/${entry.document.id}`,
        { headers: { authorization: "Bearer local-synthetic-owner", "x-clinic-id": clinic } }
      );
      expect(wrong.status()).toBe(404);
    }
    const rx = generatedDocuments.find((d) => d.kind === "prescription")!;
    const forbidden = await page.request.get(`${rx.path}/${rx.document.id}`, {
      headers: { authorization: "Bearer local-synthetic-receptionist", "x-clinic-id": clinic }
    });
    expect(forbidden.status()).toBe(403);
    const invoice = generatedDocuments.find((d) => d.kind === "invoice")!;
    const headers = {
      authorization: "Bearer local-synthetic-owner",
      "x-clinic-id": clinic,
      "idempotency-key": randomUUID()
    };
    const stale = await page.request.post(invoice.path, {
      headers,
      data: { expectedSourceDigest: invoice.document.sourceDigest }
    });
    expect(stale.status()).toBe(409);
    const current = await api(page, invoice.path.replace(/\/documents$/, ""));
    const body = { expectedSourceDigest: current.preview.sourceDigest };
    const together = await Promise.all([
      page.request.post(invoice.path, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: body
      }),
      page.request.post(invoice.path, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: body
      })
    ]);
    for (const response of together) expect(response.ok(), await response.text()).toBe(true);
    const copies = await Promise.all(together.map((r) => r.json()));
    expect(copies[0].documentId).toBe(copies[1].documentId);
    const retry = await page.request.post(invoice.path, { headers, data: body });
    expect(retry.ok(), await retry.text()).toBe(true);
    const same = await page.request.post(invoice.path, { headers, data: body });
    expect(await same.json()).toEqual(await retry.json());
    const altered = await page.request.post(invoice.path, {
      headers,
      data: { expectedSourceDigest: "0".repeat(64) }
    });
    expect(altered.status()).toBe(409);
    const longText =
      "Synthetic guidance नमस्ते.\nPreserve text <script>literal</script>.\n".repeat(45) +
      "END-OF-SYNTHETIC-INSTRUCTIONS";
    const instruction = (
      await api(page, `/v1/patients/${patientId}/instructions`, "POST", {
        channel: "print",
        templateId: "synthetic-pagination",
        title: "Synthetic long instructions",
        body: longText
      })
    ).instruction;
    const sourcePath = `/v1/patients/${patientId}/document-sources/instruction/${instruction.id}`;
    const preview = await api(page, sourcePath);
    const issued = await api(page, `${sourcePath}/documents`, "POST", {
      expectedSourceDigest: preview.preview.sourceDigest
    });
    const longDoc = (await api(page, `${sourcePath}/documents/${issued.documentId}`)).document;
    expect(longDoc.html).toContain("END-OF-SYNTHETIC-INSTRUCTIONS");
    expect(longDoc.html).not.toContain("<script>");
    const printed = await page.context().newPage();
    await printed.setContent(longDoc.html);
    await printed.pdf({
      path: info.outputPath("long-instructions.pdf"),
      preferCSSPageSize: true,
      printBackground: true
    });
    // Renderer stress fixture only; the six source documents above use the durable API.
    await printed.setContent(
      renderPatientDocumentV1({
        kind: "estimate",
        patientId,
        sourceId: randomUUID(),
        sourceVersion: "synthetic-stress-only",
        sourceStatus: "draft",
        title: "Synthetic long table",
        clinicName: "Synthetic Clinic",
        patientName: "Synthetic नमस्ते",
        facts: [],
        notices: ["TEST FIXTURE ONLY"],
        sections: [
          {
            title: "Synthetic rows",
            paragraphs: [],
            columns: ["Item", "Description", "Amount"],
            rows: Array.from({ length: 90 }, (_, i) => [
              String(i + 1),
              `Synthetic table row ${i + 1} नमस्ते ${i === 89 ? "END-OF-SYNTHETIC-TABLE" : ""}`,
              "INR 1,000.00"
            ])
          }
        ]
      })
    );
    await expect(printed.locator("tbody tr")).toHaveCount(90);
    await printed.pdf({
      path: info.outputPath("long-table.pdf"),
      preferCSSPageSize: true,
      printBackground: true
    });
    await printed.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await choose(page, "checkout");
    const region = page.getByRole("region", { name: "instruction documents", exact: true }).first();
    await region.getByRole("button", { name: "Review instruction document" }).click();
    await expect(region.locator("iframe")).toBeVisible();
    await noOverflow(page);
    await region.screenshot({ path: info.outputPath("documents-mobile.png") });
    await region.getByRole("button", { name: /^Open copy 1 / }).click();
    const mobileDownload = region.getByRole("button", {
      name: "Download printable HTML",
      exact: true
    });
    await expect(mobileDownload).toBeEnabled();
    await mobileDownload.scrollIntoViewIfNeeded();
    const mobileFile = page.waitForEvent("download");
    await mobileDownload.click();
    await (await mobileFile).saveAs(info.outputPath("mobile-saved-copy.html"));
    await page.screenshot({
      path: info.outputPath("document-mobile-controls.png"),
      fullPage: false
    });
    await page.context().close();
  });
  test("context patient import and exact clinician review preserve source text on mobile", async ({
    browser
  }, info) => {
    const page = await rolePage(browser, "owner");
    const name = `SyntheticContext-${tag}`,
      source = `context_browser_${tag}`;
    const headers = [
      "Patient Number",
      "Patient Name",
      "Mobile Number",
      "Contact Number",
      "Email Address",
      "Secondary Mobile",
      "Gender",
      "Address",
      "Locality",
      "City",
      "Pincode",
      "National Id",
      "Date of Birth",
      "Age",
      "Anniversary Date",
      "Blood Group",
      "Remarks",
      "Medical History",
      "Referred By",
      "Groups",
      "Patient Notes"
    ];
    const values = headers.map(() => "");
    values[0] = `context-${tag}`;
    values[1] = name;
    values[11] = "NEVER_SEND_NATIONAL_ID";
    values[17] = "  Historical source, unverified\nनमस्ते  ";
    values[20] = "<script>must remain text</script>";
    const csv = [headers, values]
      .map((row) => row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","))
      .join("\n");
    await page.goto("/surface/migration-review");
    await page.getByTestId("migration-new-source-system").fill(source);
    await page.getByTestId("migration-create-run").click();
    await expect(page.getByTestId("migration-source-system")).toHaveValue(source);
    await page.getByTestId("migration-workflow").selectOption("patient-file");
    await page.getByTestId("patient-file-profile").selectOption("practo_ray_patients_context_v2");
    await page
      .getByTestId("patient-file-input")
      .setInputFiles({ name: "patients.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("patient-file-preview")).toContainText("1 patients");
    await page.getByTestId("patient-file-accept").check();
    const upload = page.waitForRequest(
      (r) => r.method() === "POST" && /patient-file\/chunks\/0$/.test(new URL(r.url()).pathname)
    );
    await page.getByTestId("patient-file-upload").click();
    expect((await upload).postData()).not.toContain("NEVER_SEND_NATIONAL_ID");
    await expect(page.getByTestId("patient-file-summary")).toContainText("Complete file received");
    // Inject only progress-read failure; all imports/commits still use the real API.
    // Recovery must restore the saved profile's immutable-retention disclosure.
    const progressRoute = "**/v1/migration-runs/*/patient-file";
    await page.route(progressRoute, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ message: "Synthetic progress unavailable" })
          })
        : route.continue()
    );
    await page.getByRole("button", { name: "Refresh file progress" }).click();
    await expect(page.getByTestId("patient-file-notice")).toContainText(
      "Saved progress is unavailable"
    );
    await page.getByTestId("patient-file-profile").selectOption("practo_ray_patients_v1");
    await page.unroute(progressRoute);
    await page.getByRole("button", { name: "Refresh file progress" }).click();
    await expect(page.getByTestId("patient-file-profile")).toHaveValue(
      "practo_ray_patients_context_v2"
    );
    await expect(
      page.getByText("Committing retains immutable clinical source evidence.", { exact: false })
    ).toBeVisible();
    await expect(page.getByTestId("patient-file-commit-accept")).not.toBeChecked();
    await page.getByTestId("patient-file-commit-accept").check();
    await page.getByTestId("patient-file-commit").click();
    await expect(page.getByTestId("patient-file-notice")).toContainText("Processing finished");
    const patient = (await api(page, `/v1/patients?query=${name}`)).patients[0];
    expect(patient.phone).toBeNull();
    const denied = await page.request.get(`/v1/patients/${patient.id}/source-contexts`, {
      headers: { authorization: "Bearer local-synthetic-receptionist", "x-clinic-id": clinic }
    });
    expect(denied.status()).toBe(403);
    const clinician = await rolePage(browser, "doctor");
    await clinician.setViewportSize({ width: 390, height: 844 });
    await choose(clinician, "patient-profile", name);
    const history = clinician.getByRole("region", {
      name: "Historical source context",
      exact: true
    });
    await expect(
      history.getByText("Historical source, unverified", { exact: false })
    ).toBeVisible();
    await expect(
      history.getByText("<script>must remain text</script>", { exact: true })
    ).toBeVisible();
    await history
      .getByLabel("Review evidence")
      .fill("Reviewed synthetic source; clarify before treatment.");
    await history.getByLabel("Review outcome").selectOption("needs_clarification");
    await history.getByRole("button", { name: "Save review of version 1" }).click();
    await expect(history.getByText("Review: needs clarification")).toBeVisible();
    const saved = (
      await api(clinician, `/v1/patients/${patient.id}/source-contexts`, "GET", undefined, "doctor")
    ).records[0];
    expect(saved.fields["Medical History"]).toBe(values[17]);
    expect(saved.review.decision).toBe("needs_clarification");
    expect(saved.sourceRecordDate).toBeNull();
    const reviewUrl = `/v1/patients/${patient.id}/source-contexts/${saved.id}/reviews`;
    const ownerReview = await page.request.post(reviewUrl, {
      headers: {
        authorization: "Bearer local-synthetic-owner",
        "x-clinic-id": clinic,
        "idempotency-key": randomUUID()
      },
      data: { decision: "reviewed", note: "Owner alone is not a clinician" }
    });
    expect(ownerReview.status()).toBe(403);
    const reviewHeaders = {
      authorization: "Bearer local-synthetic-doctor",
      "x-clinic-id": clinic,
      "idempotency-key": randomUUID()
    };
    const reviewBody = { decision: "needs_clarification", note: "Synthetic exact retry evidence" };
    const firstReview = await clinician.request.post(reviewUrl, {
      headers: reviewHeaders,
      data: reviewBody
    });
    expect(firstReview.ok()).toBe(true);
    const repeatedReview = await clinician.request.post(reviewUrl, {
      headers: reviewHeaders,
      data: reviewBody
    });
    expect(repeatedReview.ok()).toBe(true);
    expect(await repeatedReview.json()).toEqual(await firstReview.json());
    const differentReview = await clinician.request.post(reviewUrl, {
      headers: reviewHeaders,
      data: { ...reviewBody, note: "Different content under old key" }
    });
    expect(differentReview.status()).toBe(409);

    const unknown = await clinician.request.post(
      `/v1/patients/${patientId}/source-contexts/${saved.id}/reviews`,
      {
        headers: {
          authorization: "Bearer local-synthetic-doctor",
          "x-clinic-id": clinic,
          "idempotency-key": randomUUID()
        },
        data: { decision: "reviewed", note: "Must reject wrong patient" }
      }
    );
    expect(unknown.status()).toBe(404);
    await noOverflow(clinician);
    await history.screenshot({ path: info.outputPath("historical-context-mobile.png") });
    await clinician.context().close();
    await page.context().close();
  });
});
