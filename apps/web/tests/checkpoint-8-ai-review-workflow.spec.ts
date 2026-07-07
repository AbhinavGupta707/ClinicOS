import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP8_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Checkpoint 8 AI review workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP8_E2E_ENABLED=true for CP8 browser smoke.");
  test.use({ baseURL });

  test("doctor reviews note drafts with anchors and no fake application", async ({ page }) => {
    await page.goto("/surface/note-drafts?scenario=cp8-ai-review-doctor");

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp8-clinical-note-draft")).toBeVisible();
    await expect(page.getByTestId("cp8-warning-list")).toContainText("Assessment is a draft");
    await expect(page.getByTestId("cp8-source-anchors")).toContainText("Transcript");

    await page.getByTestId("cp8-approve-draft").click();
    await expect(page.getByTestId("cp8-selected-status")).toContainText("Approval recorded");
    await expect(page.getByTestId("cp8-action-message")).toContainText("No clinical note");
    await expect(page.getByTestId("cp8-ai-review-workspace")).not.toContainText(
      "Provider success confirmed"
    );

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp8-ai-review-doctor-desktop.png"
    });
  });

  test("assistant sees doctor boundary and can review assistant-owned proposals", async ({ page }) => {
    await page.goto("/surface/note-drafts?scenario=cp8-ai-review-assistant");

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-role-boundary")).toContainText("Doctor review required");
    await expect(page.getByTestId("cp8-approve-draft")).toBeDisabled();

    await page.getByRole("tab", { name: /actions/i }).click();
    await expect(page.getByTestId("cp8-action-proposal-draft")).toContainText(
      "post op instruction"
    );
    await page.getByTestId("cp8-reject-draft").click();
    await expect(page.getByTestId("cp8-selected-status")).toContainText("Rejected");
    await expect(page.getByTestId("cp8-action-message")).toContainText("retained");

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp8-ai-review-assistant-desktop.png"
    });
  });

  test("mobile AI review shell has reachable controls and no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/chart-drafts?scenario=cp8-ai-review-mobile");

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-review-readiness")).toBeVisible();
    await expect(page.getByTestId("cp8-dental-chart-draft")).toBeVisible();
    await expect(page.getByTestId("cp8-edit-draft")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp8-ai-review-mobile-390.png"
    });
  });
});
