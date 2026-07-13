import { expect, test, type Page, type Route } from "@playwright/test";

const enabled = process.env.CLINICOS_CP15_E2E_ENABLED === "true";
const baseURL = process.env.CLINICOS_WEB_BASE_URL ?? "http://127.0.0.1:3015";

test.describe("Checkpoint 15 provider operations truth", () => {
  test.skip(!enabled, "Set CLINICOS_CP15_E2E_ENABLED=true for CP15 browser smoke.");
  test.use({ baseURL });

  test("owner sees configured-but-unverified providers and disabled telephony without secret leakage", async ({
    page
  }) => {
    const consoleErrors = await installProviderBoundary(page);
    await page.goto("/surface/integrations");

    await expect(page.getByTestId("cp7-integration-ops-workspace")).toBeVisible();
    await expect(page.getByTestId("cp15-provider-activation-whatsapp-cloud")).toHaveText(
      "Activation: Configured"
    );
    await expect(page.getByTestId("cp15-provider-activation-razorpay")).toHaveText(
      "Activation: Configured"
    );
    await expect(page.getByTestId("cp15-provider-activation-telephony-exotel")).toHaveText(
      "Activation: Disabled"
    );
    await expect(page.getByTestId("cp7-provider-whatsapp-cloud")).toContainText("Not verified");
    await expect(page.getByTestId("cp7-provider-razorpay")).toContainText("Not reconciled");
    await expect(page.getByTestId("cp7-provider-telephony-exotel")).toContainText("Unavailable");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/sandbox verified|production verified/i);
    expect(body).not.toMatch(
      /arn:aws|registration[_ -]?key|webhook[_ -]?secret|api[_ -]?credential/i
    );
    expect(body).not.toMatch(/\+91|invoice_[A-Za-z0-9]|pay_[A-Za-z0-9]|wamid\./i);
    expect(consoleErrors).toEqual([]);
  });

  test("provider operations remain usable at 390px with no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const consoleErrors = await installProviderBoundary(page);
    await page.goto("/surface/provider-health");

    await expect(page.getByTestId("cp7-provider-dashboard")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Providers" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Replay" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Migration" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    expect(consoleErrors).toEqual([]);
  });
});

async function installProviderBoundary(page: Page): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/me") {
      await json(route, {
        clinic: { id: "15000000-0000-4000-8000-000000000101", name: "Synthetic Clinic" },
        featureFlags: {},
        permissions: ["integrations.read", "integrations.manage"],
        roles: ["owner"],
        tenant: { id: "15000000-0000-4000-8000-000000000001", name: "Synthetic Tenant" },
        user: { displayName: "Synthetic Owner", id: "15000000-0000-4000-8000-000000001001" }
      });
      return;
    }
    if (path === "/v1/provider-health") {
      await json(route, { providers: providerCards() });
      return;
    }
    if (path === "/v1/dead-letter-events") {
      await json(route, { deadLetterEvents: [] });
      return;
    }
    if (path === "/v1/migration-batches") {
      await json(route, { migrationBatches: [] });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  return consoleErrors;
}

function providerCards() {
  const checkedAt = "2026-07-13T12:00:00.000Z";
  return [
    {
      activationChecks: ["A deployed signed HTTPS callback is still required."],
      activationState: "configured",
      capabilities: [
        {
          detail: "Provider acceptance never implies delivery or read.",
          key: "signed_callbacks",
          label: "Signed callbacks",
          status: "degraded"
        }
      ],
      category: "messaging",
      checkedAt,
      evidence: "Local durable boundary configured; official sandbox callback is not verified.",
      id: "whatsapp-cloud",
      label: "WhatsApp Cloud",
      lastFailureCode: null,
      lastReconciledAt: null,
      lastVerifiedCallbackAt: null,
      mode: "test / external activation deferred",
      productionVerifiedAt: null,
      providerKey: "whatsapp_cloud",
      sandboxVerifiedAt: null,
      status: "degraded"
    },
    {
      activationChecks: ["A deployed signed HTTPS callback is still required."],
      activationState: "configured",
      capabilities: [
        {
          detail: "Payment state waits for verified signed callback evidence.",
          key: "signed_callbacks",
          label: "Signed callbacks",
          status: "degraded"
        }
      ],
      category: "payments",
      checkedAt,
      evidence: "Local durable boundary configured; official sandbox payment is not verified.",
      id: "razorpay",
      label: "Razorpay",
      lastFailureCode: null,
      lastReconciledAt: null,
      lastVerifiedCallbackAt: null,
      mode: "test / external activation deferred",
      productionVerifiedAt: null,
      providerKey: "razorpay",
      sandboxVerifiedAt: null,
      status: "degraded"
    },
    {
      activationChecks: ["No official telephony provider is selected."],
      activationState: "disabled",
      capabilities: [
        {
          detail: "No callback, recording, or missed-call provider state is active.",
          key: "missed_calls",
          label: "Missed-call capture",
          status: "unavailable"
        }
      ],
      category: "telephony",
      checkedAt,
      evidence: "Telephony remains disabled as one complete unavailable workflow.",
      id: "telephony-exotel",
      label: "Telephony",
      lastFailureCode: null,
      lastReconciledAt: null,
      lastVerifiedCallbackAt: null,
      mode: "provider not selected",
      productionVerifiedAt: null,
      providerKey: "exotel",
      sandboxVerifiedAt: null,
      status: "unavailable"
    }
  ];
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: { "x-request-id": "cp15-browser-synthetic-request" },
    status: 200
  });
}
