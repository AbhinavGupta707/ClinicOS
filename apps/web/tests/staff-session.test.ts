import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffFetch, signOut, usesSyntheticBearerTransport } from "../lib/staff-session";
import { createCp13ApiClient, registerClinicOsAccessTokenProvider } from "../lib/cp13-api-client";

const origin = "http://127.0.0.1:3000";
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT", "");
  vi.stubGlobal("window", { location: { origin }, dispatchEvent: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("default staff browser transport", () => {
  it("sends generated reads through the same-origin BFF without bearer material", async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify({ procedures: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", request);
    await createCp13ApiClient("clinic-123").listPricebookProcedures();
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`${origin}/bff/v1/`);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).get("x-clinic-id")).toBe("clinic-123");
    expect(init.credentials).toBe("same-origin");
    expect(init.redirect).toBe("error");
    expect(() => registerClinicOsAccessTokenProvider(() => "token")).toThrow(/restricted/);
  });

  it("reads a fresh CSRF token for each mutation and never retries a write", async () => {
    const request = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/auth/session")
        ? Response.json({ csrfToken: "c".repeat(43) })
        : Response.json({ ok: true })
    );
    vi.stubGlobal("fetch", request);
    await staffFetch("/v1/migration-batches", { method: "POST", body: "{}" });
    await staffFetch("/v1/migration-batches", { method: "POST", body: "{}" });
    expect(request).toHaveBeenCalledTimes(4);
    for (const index of [1, 3]) {
      const [, init] = request.mock.calls[index] as unknown as [string, RequestInit];
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("c".repeat(43));
    }
  });

  it("does not send a mutation when session inspection fails", async () => {
    const request = vi.fn(async () =>
      Response.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 })
    );
    vi.stubGlobal("fetch", request);
    expect((await staffFetch("/v1/patients", { method: "POST", body: "{}" })).status).toBe(401);
    expect(request).toHaveBeenCalledOnce();
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("rejects alternate origins, authorization headers, and encoded route confusion", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const target of [
      "https://other.test/v1/me",
      "/auth/login",
      "/v1/%2fwebhooks",
      "/v1/me#token"
    ])
      await expect(staffFetch(target)).rejects.toThrow(/destination/);
    await expect(
      staffFetch("/v1/me", { headers: { Authorization: "Bearer secret" } })
    ).rejects.toThrow(/bearer/);
    expect(request).not.toHaveBeenCalled();
  });

  it("never enables synthetic bearer transport in a production environment", () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT", "synthetic_bearer");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "production");
    expect(usesSyntheticBearerTransport()).toBe(false);
  });

  it("reports uncertain logout without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).endsWith("/auth/session")
          ? Response.json({ csrfToken: "c".repeat(43) })
          : new Response(null, { status: 503 })
      )
    );
    await expect(signOut()).rejects.toThrow(/fully confirmed/);
  });

  it("distinguishes unconfirmed provider logout from a cookie that is already gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).endsWith("/auth/session")
          ? Response.json({ csrfToken: "c".repeat(43) })
          : Response.json({ error: { code: "IDENTITY_REVOCATION_UNCONFIRMED" } }, { status: 503 })
      )
    );
    expect(await signOut()).toBe("provider_unconfirmed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 }))
    );
    expect(await signOut()).toBe("local_closed");
  });
});
