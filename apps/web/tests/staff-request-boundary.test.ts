import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRawLocalRequest, readBody } from "../server/request-handler.mts";
import { BoundedApiTransport, STAFF_API_PREFIXES } from "../server/identity-runtime.mts";

const origin = "http://127.0.0.1:3000";
const incoming = (changes: object = {}) =>
  ({
    socket: { remoteAddress: "127.0.0.1" },
    url: "/auth/login",
    rawHeaders: ["Host", "127.0.0.1:3000"],
    headers: { host: "127.0.0.1:3000" },
    ...changes
  }) as IncomingMessage;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("raw direct-loopback request boundary", () => {
  it("accepts socket evidence and rejects forged proxy/duplicate credential headers", () => {
    expect(assertRawLocalRequest(incoming(), origin).protocol).toBe("http");
    for (const header of ["Forwarded", "X-Forwarded-For", "X-Forwarded-Proto", "Authorization"])
      expect(() =>
        assertRawLocalRequest(incoming({ rawHeaders: [header, "forged"] }), origin)
      ).toThrow();
    for (const header of [
      "Host",
      "Origin",
      "Cookie",
      "Content-Length",
      "Content-Type",
      "X-CSRF-Token"
    ])
      expect(() =>
        assertRawLocalRequest(
          incoming({ rawHeaders: [header, "first", header.toLowerCase(), "second"] }),
          origin
        )
      ).toThrow();
    expect(() =>
      assertRawLocalRequest(incoming({ socket: { remoteAddress: "192.0.2.1" } }), origin)
    ).toThrow();
    expect(() =>
      assertRawLocalRequest(incoming({ headers: { host: "attacker.test" } }), origin)
    ).toThrow();
    for (const url of [
      "//attacker.test/auth/login",
      "https://attacker.test/",
      "/a\\b",
      "/".repeat(8193)
    ])
      expect(() => assertRawLocalRequest(incoming({ url }), origin)).toThrow();
  });
  it("bounds streamed bodies and removes listeners after a byte violation", async () => {
    const request = Object.assign(new PassThrough(), { headers: {} });
    const body = readBody(request as unknown as IncomingMessage, 4);
    request.write("12345");
    await expect(body).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(request.listenerCount("data")).toBe(0);
    request.destroy();
  });
  it("stops accepting a body after its deadline", async () => {
    vi.useFakeTimers();
    const request = Object.assign(new PassThrough(), { headers: {} });
    const body = expect(readBody(request as unknown as IncomingMessage, 10)).rejects.toThrow(
      /deadline/
    );
    await vi.advanceTimersByTimeAsync(10_001);
    await body;
    expect(request.listenerCount("data")).toBe(0);
    request.destroy();
  });
  it("allowlists exactly the registered bearer route families", () => {
    const inventory = JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/api-contracts/generated/native-route-inventory.json",
          import.meta.url
        ),
        "utf8"
      )
    );
    const expected = [
      ...new Set(
        inventory.active
          .filter(
            (op: { auth: string; path: string }) =>
              op.auth === "bearer" && op.path.startsWith("/v1/")
          )
          .map((op: { path: string }) => op.path.split("/").slice(0, 3).join("/"))
      )
    ].sort();
    expect(STAFF_API_PREFIXES).toEqual(expected);
  });
  it("rejects redirects and oversized API responses without forwarding cookies", async () => {
    const transport = new BoundedApiTransport(origin);
    const input = {
      url: `${origin}/v1/me`,
      method: "GET",
      headers: {},
      body: null,
      timeoutMs: 1000,
      maximumResponseBytes: 4
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: "https://other.test/" } })
      )
    );
    await expect(transport.send(input)).rejects.toThrow(/redirects/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("12345"))
    );
    await expect(transport.send(input)).rejects.toThrow(/exceeds/);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("ok", { headers: { "set-cookie": "bad", "content-type": "text/plain" } })
      )
    );
    expect((await transport.send(input)).headers).toEqual({ "content-type": "text/plain" });
  });
  it("pins outbound authority to configured loopback and rejects URL credentials or fragments", async () => {
    expect(() => new BoundedApiTransport("https://attacker.test")).toThrow();
    const transport = new BoundedApiTransport(origin);
    const destinations: string[] = [];
    const fetcher = vi.fn(async (url: URL) => { destinations.push(String(url)); return new Response("ok"); });
    vi.stubGlobal("fetch", fetcher);
    const input = { url: `${origin}/v1/patients?query=Rhea`, method: "GET", headers: {},
      body: null, timeoutMs: 1000, maximumResponseBytes: 4 };
    for (const url of ["http://attacker.test/v1/me", "http://127.0.0.1:3001/v1/me",
      "http://user:pass@127.0.0.1:3000/v1/me", `${origin}/v1/me#fragment`]) {
      await expect(transport.send({ ...input, url })).rejects.toThrow(/destination/);
    }
    expect(fetcher).not.toHaveBeenCalled();
    await transport.send(input);
    expect(destinations).toEqual([input.url]);
  });
});
