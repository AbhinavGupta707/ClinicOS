import { expect, test } from "@playwright/test";

const e2eEnabled = process.env.CLINICOS_CP6_E2E_ENABLED === "true";
const ownerEnabled = process.env.CLINICOS_CP6_OWNER_SMOKE_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("Checkpoint 6 operations workflow smoke", () => {
  test.skip(!e2eEnabled, "Set CLINICOS_CP6_E2E_ENABLED=true for CP6 browser smoke.");
  test.use({ baseURL });

  test("runs recalls, tasks, SOPs, lab, inventory, incident, and CAPA fixture flows honestly", async ({
    page
  }) => {
    await page.goto("/surface/tasks?scenario=cp6-operations");

    await expect(page.getByTestId("cp6-operations-workspace")).toBeVisible();
    await expect(page.getByTestId("cp6-fixture-alert")).toBeVisible();
    await expect(page.getByTestId("cp6-readiness")).toContainText("no sent/delivered state");

    await page.getByTestId("cp6-complete-recall").click();
    await expect(page.getByTestId("cp6-recall-status")).toContainText("action completed");
    await expect(page.getByTestId("cp6-recall-status")).not.toContainText(/\b(delivered|sent)\b/i);

    await page.getByRole("tab", { name: /tasks/i }).click();
    await page.getByTestId("cp6-assign-task").click();
    await expect(page.getByTestId("cp6-task-status")).toContainText("assigned");
    await page.getByTestId("cp6-complete-task").click();
    await expect(page.getByTestId("cp6-task-status")).toContainText("completed");

    await page.getByRole("tab", { name: /sops/i }).click();
    await page.getByTestId("cp6-complete-sop-item-cp6SopSwitches").click();
    await page.getByTestId("cp6-complete-sop-item-cp6SopCuringLight").click();
    await page.getByTestId("cp6-complete-sop-run").click();
    await expect(page.getByTestId("cp6-sop-runner")).toContainText("completed");

    await page.goto("/surface/lab?scenario=cp6-operations");
    await page.getByTestId("cp6-lab-mark-sent").click();
    await expect(page.getByTestId("cp6-lab-status")).toContainText("sent to lab");
    await page.getByTestId("cp6-lab-mark-returned").click();
    await expect(page.getByTestId("cp6-lab-status")).toContainText("returned");
    await page.getByTestId("cp6-lab-mark-completed").click();
    await expect(page.getByTestId("cp6-lab-status")).toContainText("completed");
    await page.getByTestId("cp6-create-lab-reconciliation").click();
    await expect(page.getByTestId("cp6-lab-reconciliation")).toContainText("created, not paid");

    await page.goto("/surface/operations?scenario=cp6-operations");
    await page.getByTestId("cp6-inventory-count-cp6CompositeItem").fill("2");
    await page.getByTestId("cp6-record-inventory-count").click();
    await expect(page.getByTestId("cp6-inventory-exceptions")).toContainText("low stock");
    await page.getByTestId("cp6-request-procurement").click();
    await expect(page.getByTestId("cp6-inventory-exceptions")).toContainText("Task requested");
    await expect(page.getByTestId("cp6-inventory-exceptions")).not.toContainText(/\bpurchased\b/i);

    await page.getByRole("tab", { name: /incidents/i }).click();
    await page.getByTestId("cp6-create-incident").click();
    await expect(page.getByTestId("cp6-incident-diary")).toContainText("open");
    await page.getByTestId("cp6-create-capa").click();
    await expect(page.getByTestId("cp6-capa-list")).toContainText("assigned");
    await page.getByTestId("cp6-complete-capa").click();
    await expect(page.getByTestId("cp6-capa-list")).toContainText("completed");
    await expect(page.getByTestId("cp6-timeline")).toContainText("corrective_action.completed");

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp6-operations-desktop.png"
    });
  });

  test("mobile operations shell has reachable controls and no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/surface/operations?scenario=cp6-operations-mobile");

    await expect(page.getByTestId("cp6-operations-workspace")).toBeVisible();
    await expect(page.getByTestId("cp6-inventory-runner")).toBeVisible();
    await expect(page.getByTestId("cp6-record-inventory-count")).toBeVisible();
    await page.getByRole("tab", { name: /incidents/i }).click();
    await expect(page.getByTestId("cp6-create-incident")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp6-operations-mobile-390.png"
    });
  });
});

test.describe("Checkpoint 6 owner operations status", () => {
  test.skip(!ownerEnabled, "Set CLINICOS_CP6_OWNER_SMOKE_ENABLED=true for CP6 owner smoke.");
  test.use({ baseURL });

  test("owner sees role-gated operational status and source revenue deferred honestly", async ({
    page
  }) => {
    await page.goto("/surface/owner-control?scenario=cp6-owner-control");

    await expect(page.getByTestId("cp6-owner-control")).toBeVisible();
    await expect(page.getByTestId("cp6-owner-control")).toContainText("Open tasks");
    await expect(page.getByTestId("cp6-owner-source-revenue-deferred")).toContainText(
      "Source-attributed revenue waits"
    );

    await page.screenshot({
      fullPage: true,
      path: "/private/tmp/clinicos-cp6-owner-control.png"
    });
  });
});
