import { expect, test } from "@playwright/test";

const cp8Enabled = process.env.CLINICOS_CP8_E2E_ENABLED === "true";
const cp8Route = process.env.CLINICOS_CP8_ROUTE ?? "/surface/ai-review?scenario=cp8-ai-safety";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const devRole = process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE ?? "assistant";

test.describe("Checkpoint 8 AI safety review smoke", () => {
  test.skip(!cp8Enabled, "Set CLINICOS_CP8_E2E_ENABLED=true after Review UX/Mobile lanes expose CP8 routes.");
  test.use({ baseURL });

  test("doctor review surface shows anchored draft and rejection state without fake application", async ({
    page
  }) => {
    test.skip(devRole !== "doctor", "Run with NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor.");

    await page.goto(cp8Route);

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp8-source-anchors")).toContainText("Transcript");
    await expect(page.getByTestId("cp8-warning-list")).toContainText(/draft|review/i);

    await page.getByTestId("cp8-reject-draft").click();
    await expect(page.getByTestId("cp8-selected-status")).toContainText(/rejected/i);

    const workspaceText = await page.getByTestId("cp8-ai-review-workspace").innerText();
    expect(workspaceText).not.toMatch(/\b(applied to record|signed by AI|chart updated by AI)\b/i);
    expect(workspaceText).not.toContain("rawAudioBytes");
  });

  test("390px mobile review keeps primary controls reachable with no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/chart-drafts?scenario=cp8-ai-review-mobile");

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-review-readiness")).toBeVisible();
    await expect(page.getByTestId("cp8-dental-chart-draft")).toBeVisible();
    await expect(page.getByTestId("cp8-source-anchors")).toBeVisible();
    await expect(page.getByTestId("cp8-reject-draft")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});
