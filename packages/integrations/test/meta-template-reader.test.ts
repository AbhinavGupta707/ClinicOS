import test from "node:test";
import assert from "node:assert/strict";
import { MetaTemplateReader } from "../dist/index.js";
test("template reader restricts Graph URL, headers, redirects and response size", async (t) => {
  const input = { templateId: "123456789", apiVersion: "v23.0", accessToken: "synthetic-secret" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, options: RequestInit) => {
    calls++;
    assert.equal(
      url,
      "https://graph.facebook.com/v23.0/123456789?fields=id,name,language,status,components,category"
    );
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(options.headers, { Authorization: "Bearer synthetic-secret" });
    return new Response('{"id":"123456789"}', { status: 200 });
  });
  const reader = new MetaTemplateReader();
  assert.deepEqual(await reader.read(input), { id: "123456789" });
  for (const change of [
    { templateId: "https://localhost" },
    { templateId: "123/../messages" },
    { apiVersion: "v23.0/evil" },
    { accessToken: "secret\nheader" }
  ])
    await assert.rejects(reader.read({ ...input, ...change }), /unavailable/);
  assert.equal(calls, 1);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(262145), { status: 200 }));
  await assert.rejects(reader.read(input), /unavailable/);
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response('{"secret":"never expose provider error"}', { status: 401 })
  );
  await assert.rejects(
    reader.read(input),
    (e) => e instanceof Error && e.message === "Official template details are unavailable."
  );
});
