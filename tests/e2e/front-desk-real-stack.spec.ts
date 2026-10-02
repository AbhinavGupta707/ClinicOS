import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const clinic = "10000000-0000-4000-8000-000000000101";
const headers = { "x-clinic-id": clinic, authorization: "Bearer local-synthetic-acceptance" };
const doctor = "10000000-0000-4000-8000-000000001002";
const type = "10000000-0000-4000-8000-000000003001";
const chair = "10000000-0000-4000-8000-000000004001";
function day(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (name: string) => parts.find((part) => part.type === name)!.value;
  const date = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function identity(label: string) {
  return {
    fullName: `SyntheticDesk${label}-${randomUUID().slice(0, 8)}`,
    phone: `+91${String(Date.now()).slice(-10)}`,
    source: "manual"
  };
}
async function api(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
  version?: number,
  key = randomUUID()
) {
  return page.request.fetch(path, {
    method,
    headers: {
      ...headers,
      ...(method !== "GET" ? { "idempotency-key": key } : {}),
      ...(version ? { "if-match": `"rv-${version}"` } : {})
    },
    data
  });
}
async function open(page: Page) {
  await page.goto("/surface/appointments");
  await expect(page.getByTestId("front-desk-workspace")).toBeVisible();
  await expect(page.getByTestId("cp13-front-office-day")).toBeVisible();
}
async function booking(page: Page, name: string, date: string, time: string) {
  await page.getByRole("button", { name: "Book appointment", exact: true }).click();
  const editor = page.getByRole("region", { name: "Book appointment", exact: true });
  await editor.getByLabel("Search by name or phone").fill(name);
  await editor.getByRole("button", { name: "Search", exact: true }).click();
  await editor.getByRole("button", { name: new RegExp(name) }).click();
  await editor.getByLabel("Doctor", { exact: true }).selectOption(doctor);
  await editor.getByLabel("Visit type", { exact: true }).selectOption(type);
  await editor.getByLabel("Chair", { exact: true }).selectOption(chair);
  await editor.getByLabel("Start date and time").fill(`${date}T${time}`);
  await editor.getByLabel("I checked the patient, clinic time, doctor and duration.").check();
  return editor;
}
async function expand(page: Page, id: string) {
  const card = page.getByTestId(`cp13-clinic-day-appointment-${id}`);
  if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();
  return page.getByTestId("cp13-appointment-detail");
}

test.describe("Front desk real API and PostgreSQL", () => {
  test.skip(
    process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED !== "true",
    "Explicit disposable synthetic stack required."
  );
  test.use({ baseURL });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__clinicOsAccessTokenProvider = () => "local-synthetic-acceptance";
    });
  });

  test("register, book, reschedule, confirm, check in and call a patient using named controls", async ({
    page
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const person = identity("Journey");
    await page.getByRole("button", { name: "Book appointment", exact: true }).click();
    let editor = page.getByRole("region", { name: "Book appointment", exact: true });
    await editor.getByRole("button", { name: "Register a new patient" }).click();
    const registration = editor.getByRole("form", { name: "Register patient" });
    await registration.getByLabel("Patient name").fill(person.fullName);
    await registration.getByLabel("Phone with country code").fill(person.phone);
    await registration.getByRole("button", { name: "Create patient", exact: true }).click();
    await expect(editor.getByText(person.fullName, { exact: true })).toBeVisible();
    await editor.getByLabel("Doctor", { exact: true }).selectOption(doctor);
    await editor.getByLabel("Visit type", { exact: true }).selectOption(type);
    await editor.getByLabel("Chair", { exact: true }).selectOption(chair);
    await editor.getByLabel("Start date and time").fill(`${day()}T09:00`);
    await editor.getByLabel("I checked the patient, clinic time, doctor and duration.").check();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/appointments") && response.request().method() === "POST"
    );
    await editor.getByRole("button", { name: "Confirm booking", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { appointment } = await response.json();
    await expect(page.getByText(/Appointment booked\. A confirmation/)).toBeVisible();
    await expand(page, appointment.id);
    await page.getByRole("button", { name: "Reschedule", exact: true }).click();
    editor = page.getByRole("region", { name: "Reschedule appointment", exact: true });
    await editor.getByLabel("Start date and time").fill(`${day()}T09:30`);
    await editor.getByLabel("Reason for rescheduling").fill("Synthetic patient requested later");
    await editor.getByLabel("I checked the patient, clinic time, doctor and duration.").check();
    await editor.getByRole("button", { name: "Save new appointment time" }).click();
    await expect(page.getByText(/Appointment rescheduled\./)).toBeVisible();
    await expand(page, appointment.id);
    await page.getByRole("button", { name: "Record confirmation", exact: true }).click();
    await page.getByRole("button", { name: "Confirm: record confirmation" }).click();
    await expect(page.getByTestId(`cp13-clinic-day-appointment-${appointment.id}`)).toContainText(
      "Confirmed"
    );
    await expand(page, appointment.id);
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await page.getByRole("button", { name: "Confirm: check in" }).click();
    const queue = page.getByRole("region", { name: "Reception queue", exact: true });
    await expect(queue).toContainText(person.fullName);
    await queue.getByRole("button", { name: "Call patient", exact: true }).click();
    await page
      .getByRole("region", { name: "Update reception queue" })
      .getByRole("button", { name: "Call patient", exact: true })
      .click();
    await expect(queue).toContainText("called");
    await queue.getByRole("button", { name: "Return to waiting", exact: true }).click();
    await page
      .getByRole("region", { name: "Update reception queue" })
      .getByRole("button", { name: "Return to waiting", exact: true })
      .click();
    await expect(queue).toContainText("waiting");
    await queue.getByRole("button", { name: "Call patient", exact: true }).click();
    await page
      .getByRole("region", { name: "Update reception queue" })
      .getByRole("button", { name: "Call patient", exact: true })
      .click();
    await expect(queue).toContainText("called");
    await page.reload();
    await expect(queue).toContainText(person.fullName);
    await expect(queue).toContainText("called");
    const dashboard = await (await api(page, `/v1/dashboard/morning?date=${day()}`)).json();
    const stored = dashboard.dashboard.clinicDayAppointments.find(
      (row: { id: string }) => row.id === appointment.id
    );
    expect(stored.status).toBe("checked_in");
    expect(stored.startAt).toBe(`${day()}T04:00:00.000Z`);
    const profile = await (await api(page, "/v1/me")).json();
    if (!profile.permissions.includes("patient.phi.read")) {
      expect((await api(page, `/v1/patients/${appointment.patientId}`)).status()).toBe(403);
      await expand(page, appointment.id);
      await expect(page.getByRole("button", { name: "Open patient", exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath("frontdesk-desktop.png"), fullPage: true });
    const queueEntry = dashboard.dashboard.queue.find(
      (entry: { appointmentId: string }) => entry.appointmentId === appointment.id
    );
    const [cancel, simultaneousQueueChange] = await Promise.all([
      api(
        page,
        `/v1/appointments/${appointment.id}`,
        "PATCH",
        { status: "cancelled", changeReason: "Synthetic departure after arrival" },
        stored.rowVersion
      ),
      api(page, `/v1/queue/${queueEntry.id}`, "PATCH", { status: "waiting" }, queueEntry.rowVersion)
    ]);
    expect(cancel.status()).toBe(200);
    expect([200, 409]).toContain(simultaneousQueueChange.status());
    const afterCancellation = await (await api(page, `/v1/dashboard/morning?date=${day()}`)).json();
    const endedQueue = afterCancellation.dashboard.queue.find(
      (entry: { id: string }) => entry.id === queueEntry.id
    );
    expect(endedQueue.status).toBe("cancelled");
    expect(endedQueue.rowVersion).toBeGreaterThan(queueEntry.rowVersion);
    expect(
      (
        await api(
          page,
          `/v1/queue/${queueEntry.id}`,
          "PATCH",
          { status: "called" },
          endedQueue.rowVersion
        )
      ).status()
    ).toBe(409);
    await page.reload();
    await expect(queue).not.toContainText(person.fullName);
    expect(errors).toEqual([]);
  });

  test("rejects an overlapping booking, then cancels without removing its history", async ({
    page
  }) => {
    const person = identity("Conflict");
    const patientResponse = await api(page, "/v1/patients", "POST", person);
    expect(patientResponse.status()).toBe(201);
    const { patient } = await patientResponse.json();
    const initial = await api(page, "/v1/appointments", "POST", {
      patientId: patient.id,
      providerUserId: doctor,
      appointmentTypeId: type,
      chairId: chair,
      startAt: `${day(1)}T10:00:00+05:30`,
      durationMinutes: 30,
      source: "manual"
    });
    expect(initial.status()).toBe(201);
    const { appointment } = await initial.json();
    await open(page);
    const editor = await booking(page, person.fullName, day(1), "10:15");
    await editor.getByRole("button", { name: "Confirm booking", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText(/conflict|overlap/i);
    await editor.getByRole("button", { name: "Close editor" }).click();
    await page.getByLabel("Schedule date").fill(day(1));
    await expand(page, appointment.id);
    await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await page
      .getByRole("form", { name: "Cancel appointment" })
      .getByLabel("Reason")
      .fill("Synthetic cancellation");
    await page.getByRole("button", { name: "Confirm: cancel appointment" }).click();
    await expect(page.getByTestId(`cp13-clinic-day-appointment-${appointment.id}`)).toContainText(
      "Cancelled"
    );
    await page.reload();
    await page.getByLabel("Schedule date").fill(day(1));
    await expect(page.getByTestId(`cp13-clinic-day-appointment-${appointment.id}`)).toContainText(
      "Cancelled"
    );
  });

  test("durable API rejects stale reschedules, replays requests and enforces scope and overlaps", async ({
    page
  }) => {
    const response = await api(page, "/v1/patients", "POST", identity("Concurrency"));
    expect(response.status()).toBe(201);
    const { patient } = await response.json();
    const body = {
      patientId: patient.id,
      providerUserId: doctor,
      appointmentTypeId: type,
      chairId: chair,
      startAt: `${day(2)}T11:00:00+05:30`,
      durationMinutes: 30,
      source: "manual"
    };
    const key = randomUUID();
    const first = await api(page, "/v1/appointments", "POST", body, undefined, key);
    expect(first.status()).toBe(201);
    const { appointment } = await first.json();
    expect(
      (
        await api(
          page,
          `/v1/appointments/${appointment.id}`,
          "PATCH",
          { status: "no_show" },
          appointment.rowVersion
        )
      ).status()
    ).toBe(409);
    const replay = await api(page, "/v1/appointments", "POST", body, undefined, key);
    expect((await replay.json()).appointment.id).toBe(appointment.id);
    const schedule = {
      providerUserId: doctor,
      appointmentTypeId: type,
      chairId: chair,
      startAt: `${day(2)}T12:00:00+05:30`,
      durationMinutes: 30
    };
    const updates = await Promise.all(
      [1, 2].map(() =>
        api(
          page,
          `/v1/appointments/${appointment.id}`,
          "PATCH",
          { schedule, changeReason: "Synthetic move" },
          appointment.rowVersion
        )
      )
    );
    expect(updates.map((item) => item.status()).sort()).toEqual([200, 409]);
    const stale = await api(
      page,
      `/v1/appointments/${appointment.id}`,
      "PATCH",
      { status: "cancelled" },
      appointment.rowVersion
    );
    expect(stale.status()).toBe(409);
    const competing = await Promise.all(
      [1, 2].map(() =>
        api(page, "/v1/appointments", "POST", { ...body, startAt: `${day(2)}T14:00:00+05:30` })
      )
    );
    expect(competing.map((item) => item.status()).sort()).toEqual([201, 409]);
    const crossClinic = await page.request.get("/v1/appointments", {
      headers: { ...headers, "x-clinic-id": "20000000-0000-4000-8000-000000000201" }
    });
    expect(crossClinic.status()).toBe(403);
    const invalid = await api(
      page,
      `/v1/appointments/${appointment.id}`,
      "PATCH",
      { schedule, status: "cancelled" },
      2
    );
    expect(invalid.status()).toBe(422);
    const after = await (await api(page, `/v1/appointments?date=${day(2)}`)).json();
    expect(
      after.appointments.filter((item: { patientId: string }) => item.patientId === patient.id)
    ).toHaveLength(2);
  });

  test("records an elapsed missed visit as no-show with a reviewed reason", async ({ page }) => {
    const person = identity("NoShow");
    const { patient } = await (await api(page, "/v1/patients", "POST", person)).json();
    const created = await api(page, "/v1/appointments", "POST", {
      patientId: patient.id,
      providerUserId: doctor,
      appointmentTypeId: type,
      chairId: chair,
      startAt: `${day(-1)}T09:00:00+05:30`,
      durationMinutes: 30,
      source: "manual"
    });
    expect(created.status()).toBe(201);
    const { appointment } = await created.json();
    await open(page);
    await page.getByLabel("Schedule date").fill(day(-1));
    await expand(page, appointment.id);
    await page.getByRole("button", { name: "Mark no-show", exact: true }).click();
    await page
      .getByRole("form", { name: "Mark no-show" })
      .getByLabel("Reason")
      .fill("Synthetic patient did not attend");
    await page.getByRole("button", { name: "Confirm: mark no-show" }).click();
    await expect(page.getByTestId(`cp13-clinic-day-appointment-${appointment.id}`)).toContainText(
      "No show"
    );
    await page.reload();
    await page.getByLabel("Schedule date").fill(day(-1));
    await expect(page.getByTestId(`cp13-clinic-day-appointment-${appointment.id}`)).toContainText(
      "No show"
    );
  });

  test("a disconnected schedule shows an error and recovers without invented appointments", async ({
    page,
    context
  }) => {
    await open(page);
    await context.setOffline(true);
    await page
      .getByRole("region", { name: "Front-office clinic day" })
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await expect(page.getByText("Clinic day could not be loaded")).toBeVisible();
    await expect(page.getByTestId("cp13-clinic-day-appointments")).toHaveCount(0);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry schedule", exact: true }).click();
    await expect(page.getByTestId("cp13-front-office-day")).toBeVisible();
  });

  test("mobile controls remain reachable and duplicate registration fails closed", async ({
    page
  }, info) => {
    const person = identity("Mobile");
    const simultaneousRegistrations = await Promise.all([
      api(page, "/v1/patients", "POST", person),
      api(page, "/v1/patients", "POST", person)
    ]);
    expect(simultaneousRegistrations.map((response) => response.status()).sort()).toEqual([
      201, 409
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole("button", { name: "Book appointment", exact: true }).click();
    const editor = page.getByRole("region", { name: "Book appointment", exact: true });
    await editor.getByRole("button", { name: "Register a new patient" }).click();
    const registration = page.getByRole("form", { name: "Register patient" });
    await registration.getByLabel("Patient name").fill(person.fullName);
    await registration.getByLabel("Phone with country code").fill(person.phone);
    await registration.getByRole("button", { name: "Create patient", exact: true }).click();
    await expect(registration.getByRole("alert")).toContainText(
      "Review these possible matches. Open the existing patient or explicitly confirm a separate person before saving."
    );
    const results = await (
      await api(page, `/v1/patients?query=${encodeURIComponent(person.fullName)}`)
    ).json();
    expect(results.patients).toHaveLength(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    for (const label of [
      "Doctor",
      "Visit type",
      "Chair",
      "Start date and time",
      "Duration (minutes)"
    ]) {
      const bounds = await editor.getByLabel(label, { exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: info.outputPath("frontdesk-mobile.png"), fullPage: true });
  });
});
