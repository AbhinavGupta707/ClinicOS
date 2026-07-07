import { expect, test } from "@playwright/test";

const cp8Enabled = process.env.CLINICOS_CP8_E2E_ENABLED === "true";
const cp8Route = process.env.CLINICOS_CP8_ROUTE ?? "/surface/ai-review?scenario=cp8-ai-safety";

test.describe("Checkpoint 8 AI safety review smoke", () => {
  test.skip(!cp8Enabled, "Set CLINICOS_CP8_E2E_ENABLED=true after Review UX/Mobile lanes expose CP8 routes.");

  test("doctor review surface shows anchored draft and rejection state without fake application", async ({
    page
  }) => {
    await page.goto(cp8Route);

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp8-source-anchors")).toContainText("seg-cp8-002");
    await expect(page.getByTestId("cp8-ai-warnings")).toContainText(/draft|review/i);

    await page.getByTestId("cp8-reject-output").click();
    await expect(page.getByTestId("cp8-review-decision-status")).toContainText(/rejected/i);

    const workspaceText = await page.getByTestId("cp8-ai-review-workspace").innerText();
    expect(workspaceText).not.toMatch(/\b(applied to record|signed by AI|chart updated by AI)\b/i);
    expect(workspaceText).not.toContain("rawAudioBytes");
  });

  test("390px mobile review keeps primary controls reachable with no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(cp8Route);

    await expect(page.getByTestId("cp8-ai-review-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-consent-status")).toBeVisible();
    await expect(page.getByTestId("cp8-source-anchors")).toBeVisible();
    await expect(page.getByTestId("cp8-reject-output")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});

test.describe("Checkpoint 8 mobile capture consent smoke", () => {
  test.skip(!cp8Enabled, "Set CLINICOS_CP8_E2E_ENABLED=true after Mobile Capture lane exposes CP8 routes.");

  test("mobile capture route disables audio controls without active consent", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/mobile-capture?scenario=cp8-no-consent");

    await expect(page.getByTestId("cp8-mobile-capture-workspace")).toBeVisible();
    await expect(page.getByTestId("cp8-consent-status")).toContainText(/no active|revoked/i);
    await expect(page.getByTestId("cp8-capture-disabled")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});
