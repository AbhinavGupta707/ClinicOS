import { expect, test } from "@playwright/test";

const cp9Enabled = process.env.CLINICOS_CP9_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const devRole = process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE ?? "assistant";

test.describe("Checkpoint 9 performance QA registered-surface smoke", () => {
  test.skip(!cp9Enabled, "Set CLINICOS_CP9_E2E_ENABLED=true for CP9 browser smoke.");
  test.use({ baseURL });

  test("owner compliance surface stays honestly unavailable until CP9 APIs activate", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    await page.goto("/surface/compliance");

    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Compliance" })
    ).toBeVisible();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByText("Required API boundary")).toBeVisible();
    await expect(page.getByText("No product data is rendered")).toBeVisible();
    await expect(page.getByRole("button", { name: "Awaiting API activation" })).toBeDisabled();
    await expect(page.getByText("GET /v1/audit-events")).toBeVisible();
    await expect(page.getByText("POST /v1/patients/{patientId}/record-exports")).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\b(Export complete|Audit approved|FHIR exchange active)\b/i);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp9-compliance-unavailable-desktop.png"
    });
  });

  test("390px compliance shell has reachable unavailable state with no horizontal overflow", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/compliance");

    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Compliance" })
    ).toBeVisible();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Awaiting API activation" })).toBeDisabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp9-compliance-unavailable-mobile-390.png"
    });
  });

  test("platform-support shell does not claim break-glass or tenant diagnostics are active", async ({
    page
  }) => {
    test.skip(
      devRole !== "platform_admin",
      "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=platform_admin."
    );

    await page.goto("/surface/platform-support");

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
