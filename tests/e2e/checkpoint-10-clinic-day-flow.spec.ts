import { expect, test, type Page } from "@playwright/test";

const cp10Enabled = process.env.CLINICOS_CP10_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const devRole = process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE ?? "assistant";

test.describe("Checkpoint 10 release-candidate clinic-day smoke", () => {
  test.skip(!cp10Enabled, "Set CLINICOS_CP10_E2E_ENABLED=true for CP10 browser smoke.");
  test.use({ baseURL });

  test("assistant can traverse implemented fixture surfaces without fake completion claims", async ({
    page
  }) => {
    test.skip(devRole !== "assistant", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant.");

    await expectSurface(page, "/surface/day-start?scenario=cp10", "cp2-morning-dashboard");
    await expectSurface(page, "/surface/clinical?scenario=cp10", "cp3-clinical-workspace");
    await expect(page.getByTestId("cp3-fixture-alert")).toBeVisible();

    await expectSurface(page, "/surface/dental-media?scenario=cp10", "cp4-dental-media-workspace");
    await expect(page.getByTestId("cp4-fixture-alert")).toBeVisible();

    await expectSurface(page, "/surface/checkout?scenario=cp10", "cp5-checkout-workspace");
    await expect(page.getByTestId("cp5-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp5-provider-readiness")).toContainText("Not configured");

    await expectSurface(page, "/surface/tasks?scenario=cp10", "cp6-operations-workspace");
    await expect(page.getByTestId("cp6-readiness")).toContainText("no sent/delivered state");

    await expectSurface(
      page,
      "/surface/integrations?scenario=cp10",
      "cp7-integration-ops-workspace"
    );
    await expect(page.getByTestId("cp7-provider-readiness")).toContainText("Unavailable");
    await expect(page.getByTestId("cp7-integration-ops-workspace")).not.toContainText(
      "Provider success confirmed"
    );

    await expectSurface(page, "/surface/ai-review?scenario=cp10", "cp8-ai-review-workspace");
    const aiText = await page.getByTestId("cp8-ai-review-workspace").innerText();
    expect(aiText).not.toMatch(/\b(applied to record|signed by AI|chart updated by AI)\b/i);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-assistant-clinic-day-desktop.png"
    });
  });

  test("390px assistant smoke keeps key controls reachable without horizontal overflow", async ({
    page
  }) => {
    test.skip(devRole !== "assistant", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant.");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectSurface(page, "/surface/checkout?scenario=cp10-mobile", "cp5-checkout-workspace");
    await expect(page.getByTestId("cp5-provider-readiness")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await expectSurface(
      page,
      "/surface/operations?scenario=cp10-mobile",
      "cp6-operations-workspace"
    );
    await expect(page.getByTestId("cp6-readiness")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-assistant-mobile-390.png"
    });
  });

  test("owner sees aggregate dashboard and compliance remains honestly unavailable", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    await expectSurface(page, "/surface/owner-control?scenario=cp10", "cp6-owner-control");
    await expect(page.getByTestId("cp6-owner-control")).toContainText("Open tasks");
    await expect(page.getByTestId("cp6-owner-control")).not.toContainText("medicalHistory");

    await page.goto("/surface/compliance?scenario=cp10");
    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Compliance" })
    ).toBeVisible();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByText("Required API boundary")).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\b(Export complete|FHIR exchange active|Audit approved)\b/i);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-owner-dashboard-compliance.png"
    });
  });

  test("platform-support shell does not claim live break-glass or tenant diagnostics", async ({
    page
  }) => {
    test.skip(
      devRole !== "platform_admin",
      "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=platform_admin."
    );

    await page.goto("/surface/platform-support?scenario=cp10");

    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Platform support" })
    ).toBeVisible();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByText("GET /v1/provider-health")).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(
      /\b(Break-glass approved|Tenant data exported|Provider success confirmed)\b/i
    );
  });
});

async function expectSurface(page: Page, path: string, testId: string) {
  await page.goto(path);
  await expect(page.getByTestId(testId)).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}
