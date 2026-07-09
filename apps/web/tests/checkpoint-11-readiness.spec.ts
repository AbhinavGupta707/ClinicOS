import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP11_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const devRole = process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE ?? "assistant";

test.describe("Checkpoint 11 truthful pilot readiness", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP11_E2E_ENABLED=true for CP11 browser smoke.");
  test.use({ baseURL });

  test("owner sees blocked external gates and refresh cannot manufacture success", async ({
    page
  }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
    });

    await page.goto("/surface/pilot-readiness?scenario=cp10");

    await expect(page.getByRole("heading", { name: "Pilot readiness", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Synthetic CP10 pilot readiness fixture")).toBeVisible();
    await expect(
      page.getByText("Go-live is blocked until external activation evidence is recorded.")
    ).toBeVisible();
    await expect(
      page.getByTestId("cp10-live-gaps").getByText("Physical-device smoke is an")
    ).toBeVisible();
    await expect(
      page.getByTestId("cp10-live-gaps").getByText("Terraform apply and cloud resource creation")
    ).toBeVisible();

    await page.getByRole("button", { name: "Refresh pilot readiness" }).click();
    await expect(
      page.getByText("Go-live is blocked until external activation evidence is recorded.")
    ).toBeVisible();
    await expect(page.getByText("Provider success confirmed")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("owner mobile view has reachable controls and no horizontal overflow", async ({ page }) => {
    test.skip(devRole !== "owner", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/pilot-readiness?scenario=cp10");

    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh pilot readiness" })).toBeVisible();
    await expect(
      page.getByText("Go-live is blocked until external activation evidence is recorded.")
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("assistant is denied the owner readiness surface without clinic data", async ({ page }) => {
    test.skip(devRole !== "assistant", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant.");
    await page.goto("/surface/pilot-readiness?scenario=cp10");

    await expect(
      page.getByRole("heading", { name: "This surface is outside the current role scope." })
    ).toBeVisible();
    await expect(page.getByText("Required roles: Owner.")).toBeVisible();
    await expect(
      page.getByText("No clinic data, PHI, workflow controls, or provider actions")
    ).toBeVisible();
    await expect(page.getByLabel("Synthetic CP10 pilot readiness fixture")).toHaveCount(0);
  });
});
