import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const baseURL = process.env.CLINICOS_WEB_BASE_URL!,
  clinic = "10000000-0000-4000-8000-000000000101";
async function open(browser: Browser, role = "receptionist") {
  const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { authorization: `Bearer local-synthetic-${role}` }
    }),
    page = await context.newPage();
  await page.addInitScript((role) => {
    window.__clinicOsAccessTokenProvider = () => `local-synthetic-${role}`;
  }, role);
  return page;
}
async function command(page: Page, body: unknown, key = randomUUID()) {
  return page.request.post("/v1/communications/commands", {
    data: body,
    headers: { "x-clinic-id": clinic, "idempotency-key": key }
  });
}
async function selectConversation(page: Page) {
  await page.goto("/surface/communications");
  await expect(page.getByRole("heading", { name: "Patient messages", exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "Conversations", exact: true })
    .getByRole("button", { name: /Synthetic Communications Contact/ })
    .click();
  await expect(page.getByRole("region", { name: "Conversation", exact: true })).toBeVisible();
}
test("inbox review, manual evidence and work assignment survive reload through the durable API", async ({
  browser
}, info) => {
  const page = await open(browser),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await selectConversation(page);
    await expect(
      page.getByText("Official WhatsApp sending is not enabled here.", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review exact message", exact: true })
    ).toBeDisabled();
    const note = `Synthetic browser manual-contact evidence ${randomUUID()}`;
    await page.getByLabel("Manual contact or follow-up evidence").fill(note);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/v1/communications/commands") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Record manual contact", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(
      page
        .getByRole("region", { name: "Conversation", exact: true })
        .getByText(note, { exact: true })
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("region", { name: "Conversations", exact: true })
      .getByRole("button", { name: /Synthetic Communications Contact/ })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Conversation", exact: true })
        .getByText(note, { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open enquiries and booking" })).toHaveAttribute(
      "href",
      "/surface/lead-inbox"
    );
    await expect(
      page.getByRole("link", { name: "Open appointments for staff confirmation or changes" })
    ).toHaveAttribute("href", "/surface/appointments");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("communications-desktop.png"), fullPage: true });
  } finally {
    await page.context().close();
  }
});
test("mobile inbox paging and read position are usable without horizontal overflow", async ({
  browser
}, info) => {
  const page = await open(browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await selectConversation(page);
    const conversation = page.getByRole("region", { name: "Conversation", exact: true });
    await conversation.getByRole("button", { name: "Older messages", exact: true }).click();
    await expect(
      conversation.getByRole("button", { name: "Newer messages", exact: true })
    ).toBeEnabled();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/v1/communications/commands") && r.request().method() === "POST"
    );
    await conversation
      .getByRole("button", { name: "Mark displayed messages read", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
    await expect(
      conversation.getByRole("button", { name: "Mark displayed messages read", exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("communications-mobile.png"), fullPage: true });
  } finally {
    await page.context().close();
  }
});
test("API forbids accounting access, rejects stale edits and recovers idempotent manual commands", async ({
  browser
}) => {
  const page = await open(browser),
    accountant = await open(browser, "accountant");
  try {
    const denied = await accountant.request.get("/v1/communications/threads", {
      headers: { "x-clinic-id": clinic }
    });
    expect(denied.status()).toBe(403);
    const threads = await page.request.get("/v1/communications/threads", {
      headers: { "x-clinic-id": clinic }
    });
    expect(threads.ok()).toBe(true);
    const t = (await threads.json()).threads.find(
      (r: any) => r.patientName === "Synthetic Communications Contact"
    );
    expect(t).toBeTruthy();
    const body = {
        kind: "manual_contact",
        threadId: t.id,
        expectedVersion: t.rowVersion,
        evidence: "Synthetic idempotency browser evidence"
      },
      key = randomUUID();
    const first = await command(page, body, key);
    expect(first.ok()).toBe(true);
    const replay = await command(page, body, key);
    expect(replay.ok()).toBe(true);
    expect(await replay.json()).toEqual(await first.json());
    expect((await command(page, body)).status()).toBe(409);
    const blocked = await command(page, { kind: "sync_template", templateId: randomUUID() });
    expect(blocked.status()).toBe(503);
    const forbidden = await command(page, {
      kind: "approve",
      threadId: t.id,
      appointmentId: randomUUID(),
      templateId: randomUUID(),
      expectedDigest: "a".repeat(64),
      recipient: "+919999888877"
    });
    expect(forbidden.status()).toBe(422);
  } finally {
    await page.context().close();
    await accountant.context().close();
  }
});

test("staff review and queue exact appointment text then cancel before any worker dispatch", async ({
  browser
}, info) => {
  const page = await open(browser, "messaging");
  try {
    await page.goto("/surface/communications");
    await page
      .getByRole("region", { name: "Conversations", exact: true })
      .getByRole("button", { name: /Synthetic Message Approval/ })
      .click();
    const composer = page.getByRole("region", { name: "Prepare appointment message", exact: true });
    await expect(composer.getByLabel("Appointment", { exact: true }).locator("option")).toHaveCount(
      2
    );
    await composer.getByLabel("Appointment", { exact: true }).selectOption({ index: 1 });
    await expect(composer.getByLabel("Template", { exact: true }).locator("option")).toHaveCount(2);
    await composer.getByLabel("Template", { exact: true }).selectOption({ index: 1 });
    await composer.getByRole("button", { name: "Review exact message", exact: true }).click();
    const review = composer.getByRole("region", { name: "Exact message review", exact: true });
    await expect(review).toContainText("+919999888899");
    await expect(review).toContainText("Your appointment at Synthetic Dental Clinic");
    await expect(review).toContainText("Asia/Kolkata");
    await expect(review).toContainText("Sending does not confirm attendance");
    await review.screenshot({ path: info.outputPath("communications-exact-review.png") });
    const approval = page.waitForResponse(
      (r) => r.url().endsWith("/v1/communications/commands") && r.request().method() === "POST"
    );
    await review
      .getByRole("button", { name: "Approve and queue this exact message", exact: true })
      .click();
    const response = await approval;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    const conversation = page.getByRole("region", { name: "Conversation", exact: true });
    await expect(conversation).toContainText("Dispatch: queued. Delivery: Not reported.");
    await conversation.getByRole("button", { name: "Cancel queued message", exact: true }).click();
    await expect(conversation).toContainText("Dispatch: cancelled. Delivery: Not reported.");
    await page.reload();
    await page
      .getByRole("region", { name: "Conversations", exact: true })
      .getByRole("button", { name: /Synthetic Message Approval/ })
      .click();
    await expect(conversation).toContainText("Dispatch: cancelled. Delivery: Not reported.");
    const detail = await page.request.get(`/v1/communications/threads/${result.threadId}`, {
      headers: { "x-clinic-id": clinic }
    });
    expect(detail.ok()).toBe(true);
    const messages = (await detail.json()).messages.filter((m: any) => m.requestId === result.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].dispatchStatus).toBe("cancelled");
    expect(messages[0].deliveryStatus).toBeNull();
  } finally {
    await page.context().close();
  }
});
