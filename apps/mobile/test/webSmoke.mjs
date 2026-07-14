import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.MOBILE_WEB_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 900 }
  ]) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height }
    });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByText("Web is supplemental smoke only.", { exact: false }).waitFor();
    await page.getByText("Live backend unavailable:", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Refresh patient worklist" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Open camera" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Start clinical audio" }).isDisabled(), true);
    const dimensions = await page.locator("html").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    assert.ok(
      dimensions.scrollWidth <= dimensions.clientWidth,
      `${viewport.name} viewport has horizontal overflow: ${JSON.stringify(dimensions)}`
    );
    assert.deepEqual(errors, [], `${viewport.name} console errors: ${errors.join(" | ")}`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`ClinicOS mobile supplemental web smoke passed at ${url}`);
