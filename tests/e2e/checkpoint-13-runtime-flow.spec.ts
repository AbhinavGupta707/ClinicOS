import { expect, test, type Page, type Route } from "@playwright/test";
import { createFixtureCp7IntegrationOpsData } from "../../apps/web/lib/cp7-integration-ops";

const enabled = process.env.CLINICOS_CP13_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3013";
const clinicId = "00000000-0000-4000-8000-000000000002";
const patientId = "00000000-0000-4000-8000-000000000004";
const invoiceId = "00000000-0000-4000-8000-000000000013";

test.describe("Checkpoint 13 durable web runtime", () => {
  test.skip(!enabled, "Set CLINICOS_CP13_E2E_ENABLED=true for CP13 browser smoke.");
  test.use({ baseURL });

  test("assistant uses generated front-office routes without leaking selected record ids", async ({
    page
  }) => {
    const { observed, consoleErrors } = await installRuntimeBoundary(page, "assistant");
    await page.goto("/surface/patients");

    await expect(page.getByTestId("cp13-front-office-runtime")).toBeVisible();
    await expect(page.getByTestId("cp13-patient-welcome")).toBeVisible();
    await page.getByRole("search").getByRole("textbox").fill("Authorized");
    await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByTestId("cp13-patient-search")
      .getByRole("button", { name: /Authorized CP13 Patient/ })
      .click();
    await expect(page.getByTestId("cp13-front-office-patient")).toContainText(
      "Authorized CP13 Patient"
    );

    await expect(page.getByRole("search").getByRole("textbox")).toHaveValue("Authorized");
    await expect(
      page
        .getByTestId("cp13-patient-search")
        .getByRole("button", { name: /Authorized CP13 Patient/ })
    ).toBeVisible();
    expect(page.url()).not.toContain(patientId);
    expect(await browserStorage(page)).toEqual({ local: {}, session: {} });
    expectGeneratedAuthorization(observed);

    await page.reload();
    await expect(page.getByTestId("cp13-patient-welcome")).toBeVisible();
    await expect(page.getByTestId("cp13-front-office-patient")).toHaveCount(0);
    expect(page.url()).not.toContain(patientId);
    expect(consoleErrors).toEqual([]);
  });

  test("a slower earlier patient search cannot replace newer results", async ({ page }) => {
    await installRuntimeBoundary(page, "assistant");
    let releaseEarlier!: () => void;
    const earlierReady = new Promise<void>((resolve) => {
      releaseEarlier = resolve;
    });
    let earlierStarted = false;
    let earlierFinished = false;
    await page.route("**/v1/patients?*", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("query");
      if (query === "Earlier") {
        earlierStarted = true;
        await earlierReady;
      }
      await json(route, {
        patients: [
          {
            id: patientId,
            fullName: `${query} Synthetic Patient`,
            phone: "+919999997001",
            gender: "unknown",
            source: "manual",
            status: "active"
          }
        ]
      });
      if (query === "Earlier") earlierFinished = true;
    });
    await page.goto("/surface/patients");
    const query = page.getByRole("search").getByRole("textbox");
    await query.fill("Earlier");
    await page.getByRole("search").dispatchEvent("submit");
    await expect.poll(() => earlierStarted).toBe(true);
    await query.fill("Newer");
    await page.getByRole("search").dispatchEvent("submit");
    await expect(page.getByTestId("cp13-patient-search")).toContainText("Newer Synthetic Patient");
    releaseEarlier();
    await expect.poll(() => earlierFinished).toBe(true);
    await expect(page.getByTestId("cp13-patient-search")).not.toContainText(
      "Earlier Synthetic Patient"
    );
    await expect(page.getByTestId("cp13-patient-search")).toContainText("Newer Synthetic Patient");
  });

  test("patient details keep an unavailable clinic-day dependency visible", async ({ page }) => {
    await installRuntimeBoundary(page, "assistant");
    await page.route("**/v1/dashboard/morning", (route) =>
      json(
        route,
        {
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "Synthetic day outage",
            details: {},
            request_id: "day-outage"
          }
        },
        503
      )
    );
    await page.goto("/surface/patients");
    await page.getByRole("search").getByRole("textbox").fill("Authorized");
    await page.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByTestId("cp13-patient-search")
      .getByRole("button", { name: /Authorized CP13 Patient/ })
      .click();
    const details = page.getByTestId("cp13-front-office-patient");
    await expect(details).toContainText("Front-office data is temporarily unavailable");
    await expect(details).not.toContainText("No appointment on");
    await expect(details).not.toContainText("No open tasks");
    await expect(details).not.toContainText("No queue entry");
  });

  test("operator deliberately chooses between shared-phone duplicate patients", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installRuntimeBoundary(page, "assistant");
    const fixture = createFixtureCp7IntegrationOpsData("2026-09-20");
    const batch = fixture.migrationBatches[0]!;
    const conflict = batch.conflicts[0]!;
    conflict.candidatePatient = { fullName: "Synthetic Parent", phone: "+919999997002" };
    batch.conflicts.push({
      ...conflict,
      id: "second-candidate",
      targetRecordId: "second-patient",
      candidatePatient: { fullName: "Synthetic Child", phone: "+919999997002" }
    });
    let selectedTarget: string | null = null;
    await page.route("**/v1/provider-health", (route) =>
      json(route, { providers: fixture.providers })
    );
    await page.route("**/v1/clinic-doctors", (route) => json(route, { clinicDoctors: [] }));
    await page.route("**/v1/dead-letter-events?*", (route) =>
      json(route, { deadLetterEvents: [] })
    );
    await page.route("**/v1/migration-batches**", async (route) => {
      if (route.request().method() === "GET") return json(route, { migrationBatches: [batch] });
      expect(new URL(route.request().url()).pathname).toBe(
        `/v1/migration-batches/${batch.id}/rows/${conflict.rowId}/resolve`
      );
      const body = route.request().postDataJSON();
      expect(body.action).toBe("link_existing");
      selectedTarget = body.targetRecordId;
      batch.conflicts.forEach((item) => {
        item.status = "resolved";
      });
      return json(route, { row: { status: "ready_to_commit" } });
    });
    await page.goto("/surface/migration-review");
    const candidates = page.getByTestId("migration-patient-candidate");
    await expect(candidates).toBeVisible();
    await expect(candidates.locator("option")).toHaveText([
      "Select a patient after checking their identity",
      "Synthetic Parent · +919999997002",
      "Synthetic Child · +919999997002"
    ]);
    await expect(page.getByTestId("cp7-resolve-migration-conflict")).toBeDisabled();
    await candidates.selectOption("second-patient");
    await candidates.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/clinicos-pr1-candidate-selection-mobile.png" });
    await page.getByTestId("cp7-resolve-migration-conflict").click();
    await expect.poll(() => selectedTarget).toBe("second-patient");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      fullPage: true,
      path: "/tmp/clinicos-pr1-duplicate-review-mobile.png"
    });
  });

  test("accountant billing records provider intent without claiming payment", async ({ page }) => {
    const { observed, consoleErrors } = await installRuntimeBoundary(page, "accountant");
    await page.goto("/surface/accounting");

    await expect(page.getByTestId("cp13-treatment-billing-workspace")).toBeVisible();
    await page.getByLabel("Invoice ID").fill(invoiceId);
    await page.getByRole("button", { name: "Open invoice" }).click();
    await expect(page.getByTestId("cp13-invoice-summary")).toBeVisible();
    await page.getByRole("button", { name: "Request payment link" }).click();
    await expect(page.locator('[data-payment-intent-state="pending"]')).toContainText(
      "This is not payment confirmation"
    );

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/payment (confirmed|received|successful)/i);
    expect(page.url()).not.toContain(invoiceId);
    expect(await browserStorage(page)).toEqual({ local: {}, session: {} });
    expectGeneratedAuthorization(observed);
    expect(consoleErrors).toEqual([]);
  });

  test("owner receives scoped operational reads and mobile controls do not overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { observed, consoleErrors } = await installRuntimeBoundary(page, "owner");
    await page.goto("/surface/owner-control");

    await expect(page.getByTestId("cp13-operations-runtime")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Continuity and operations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh durable data" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    expectGeneratedAuthorization(observed);
    expect(observed.map((request) => request.path)).toEqual(
      expect.arrayContaining([
        "/v1/owner-dashboard",
        "/v1/tasks",
        "/v1/recalls",
        "/v1/sop-runs",
        "/v1/lab-cases",
        "/v1/inventory/items",
        "/v1/inventory/exceptions",
        "/v1/incidents",
        "/v1/corrective-actions"
      ])
    );
    expect(consoleErrors).toEqual([]);
  });

  test("accountant is denied a clinical surface before clinical API access", async ({ page }) => {
    const { observed, consoleErrors } = await installRuntimeBoundary(page, "accountant");
    await page.goto("/surface/encounter");

    await expect(
      page.getByRole("heading", { name: "This surface is outside the current role scope." })
    ).toBeVisible();
    await expect(
      page.getByText("No clinic data, PHI, workflow controls, or provider actions")
    ).toBeVisible();
    expect(observed).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

interface ObservedRequest {
  readonly authorization: string | null;
  readonly clinic: string | null;
  readonly method: string;
  readonly path: string;
}

async function installRuntimeBoundary(
  page: Page,
  role: "accountant" | "assistant" | "owner"
): Promise<{ observed: ObservedRequest[]; consoleErrors: string[] }> {
  const observed: ObservedRequest[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__clinicOsAccessTokenProvider = async () => "cp13-browser-memory-token";
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/me") {
      await json(route, mePayload(role));
      return;
    }
    observed.push({
      authorization: request.headers()["authorization"] ?? null,
      clinic: request.headers()["x-clinic-id"] ?? null,
      method: request.method(),
      path: url.pathname
    });
    await respondToGeneratedRoute(route, url.pathname);
  });
  return { observed, consoleErrors };
}

function expectGeneratedAuthorization(requests: readonly ObservedRequest[]) {
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every((request) => request.authorization === "Bearer cp13-browser-memory-token")
  ).toBe(true);
  expect(requests.every((request) => request.clinic === clinicId)).toBe(true);
}

async function respondToGeneratedRoute(route: Route, path: string) {
  if (path === "/v1/dashboard/morning") {
    await json(route, {
      dashboard: {
        date: "2026-07-10",
        totalAppointments: 0,
        clinicDayAppointments: [],
        dataAsOf: null,
        appointmentsTruncated: false,
        appointmentCounts: {},
        unconfirmedAppointments: [],
        todaysAppointments: [],
        openLeads: [],
        openTasks: [],
        queue: [],
        newPatientAppointmentIds: [],
        returningPatientAppointmentIds: []
      }
    });
    return;
  }
  if (path === "/v1/queue") return json(route, { queue: [] });
  if (path === "/v1/leads") return json(route, { leads: [] });
  if (path === "/v1/form-templates") return json(route, { templates: [] });
  if (path === "/v1/patients")
    return json(route, {
      patients: [
        {
          id: patientId,
          rowVersion: 1,
          fullName: "Authorized CP13 Patient",
          phone: null,
          source: "manual"
        }
      ]
    });
  if (path === `/v1/patients/${patientId}`) {
    return json(route, {
      patient: { id: patientId, rowVersion: 1, fullName: "Authorized CP13 Patient" }
    });
  }
  if (path === `/v1/patients/${patientId}/timeline`) {
    return json(route, { timeline: [], items: [] });
  }
  if (path === `/v1/patients/${patientId}/prep-summary`) {
    const summary = {
      patient: {
        id: patientId,
        fullName: "Authorized CP13 Patient",
        phone: null,
        dateOfBirth: null,
        gender: "unknown"
      },
      appointment: null,
      generatedAt: "2026-07-10T12:00:00.000Z",
      latestIntakeResponse: null,
      consentEnforcementState: {},
      activeConsentPurposes: [],
      timelineHighlights: [],
      priorClinicalTimeline: [],
      medicalHistoryChangePromptRequired: true,
      dataCoverage: {}
    };
    return json(route, { prepSummary: summary, summary });
  }
  if (path === "/v1/pricebook/procedures") {
    return json(route, {
      procedures: [
        {
          id: "procedure",
          displayName: "Consultation",
          defaultUnitPriceMinor: 100000,
          currency: "INR"
        }
      ]
    });
  }
  if (path === `/v1/invoices/${invoiceId}`) {
    return json(route, {
      invoice: {
        id: invoiceId,
        invoiceNumber: "INV-CP13-001",
        totalMinor: 100000,
        paidMinor: 0,
        balanceMinor: 100000,
        currency: "INR",
        paymentStatus: "unpaid"
      }
    });
  }
  if (path === `/v1/invoices/${invoiceId}/payment-requests`) {
    return json(
      route,
      {
        invoice: { id: invoiceId },
        paymentIntent: { id: "payment-intent", status: "pending_provider_request" },
        provider: { provider: "simulator" }
      },
      202
    );
  }
  if (path === "/v1/owner-dashboard") {
    return json(route, {
      dashboard: {
        freshness: {
          status: "fresh",
          generatedAt: new Date().toISOString(),
          staleAfterSeconds: 300,
          unavailableSources: []
        }
      }
    });
  }
  if (path === "/v1/tasks") return json(route, { tasks: [] });
  if (path === "/v1/recalls") return json(route, { recalls: [] });
  if (path === "/v1/sop-runs") return json(route, { sopRuns: [] });
  if (path === "/v1/lab-cases") return json(route, { labCases: [] });
  if (path === "/v1/inventory/items") return json(route, { items: [] });
  if (path === "/v1/inventory/exceptions") return json(route, { exceptions: [] });
  if (path === "/v1/incidents") return json(route, { incidents: [] });
  if (path === "/v1/corrective-actions") return json(route, { correctiveActions: [] });
  await json(
    route,
    {
      error: {
        code: "NOT_FOUND",
        message: "Unregistered CP13 test route",
        details: {},
        request_id: "cp13-route-miss"
      }
    },
    404
  );
}

function mePayload(role: "accountant" | "assistant" | "owner") {
  return {
    user: { id: `user-${role}`, displayName: `CP13 ${role}` },
    tenant: { id: "tenant-cp13", name: "CP13 Tenant" },
    clinic: { id: clinicId, name: "CP13 Clinic", timezone: "Asia/Kolkata" },
    roles: [role],
    permissions: [],
    featureFlags: {}
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "x-request-id": "cp13-browser-request" },
    body: JSON.stringify(body)
  });
}

function browserStorage(
  page: Page
): Promise<{ local: Record<string, string>; session: Record<string, string> }> {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage))
  }));
}
