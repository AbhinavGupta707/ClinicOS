import { expect, test } from "@playwright/test";

const cp10Enabled = process.env.CLINICOS_CP10_UX_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const devRole = process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE ?? "assistant";

test.describe("Checkpoint 10 UX polish smoke", () => {
  test.skip(!cp10Enabled, "Set CLINICOS_CP10_UX_E2E_ENABLED=true for CP10 UX smoke.");
  test.use({ baseURL });

  test("owner settings surface is registered unavailable without fake pilot readiness", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    await page.goto("/surface/settings");

    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expect(page.getByLabel("Surface state").getByText("Registered unavailable")).toBeVisible();
    await expect(page.getByText("Registered, not activated")).toBeVisible();
    await expect(page.getByText("Required API boundary")).toBeVisible();
    await expect(page.getByText("GET /v1/users")).toBeVisible();
    await expect(page.getByText("GET /external-systems/accounts")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registered unavailable" })).toBeDisabled();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(
      /\b(Pilot ready|Provider activated|Live ABDM exchange|Clinic setup complete)\b/i
    );

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-settings-unavailable-desktop.png"
    });
  });

  test("390px settings unavailable state keeps controls reachable without horizontal overflow", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/settings");

    await expect(
      page.locator("main").getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    await expect(page.getByLabel("Surface state").getByText("Registered unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registered unavailable" })).toBeDisabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-settings-unavailable-mobile-390.png"
    });
  });

  test("accountant direct clinical route shows role boundary and no clinical workflow controls", async ({
    page
  }) => {
    test.skip(devRole !== "accountant", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant.");

    await page.goto("/surface/encounter");

    await expect(page.getByText("Role boundary")).toBeVisible();
    await expect(page.getByText("This surface is outside the current role scope.")).toBeVisible();
    await expect(page.getByText("Required roles: Owner, Doctor, Assistant.")).toBeVisible();
    await expect(page.getByText("No clinic data, PHI, workflow controls")).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\b(Sign note|Save prescription draft|Start encounter)\b/i);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp10-accountant-role-boundary.png"
    });
  });
});
