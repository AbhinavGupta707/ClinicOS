import assert from "node:assert/strict";
import test from "node:test";
import { TemporalOAuthTokenProvider } from "../runtime/temporal-oauth.js";

const tokenUrl =
  "https://auth.staging.example.invalid/realms/clinic-os/protocol/openid-connect/token";

test("Temporal OAuth obtains a bounded worker/write JWT without exposing credentials in the URL", async () => {
  let requestBody = "";
  const provider = new TemporalOAuthTokenProvider({
    tokenUrl,
    clientId: "clinic-os-temporal-worker",
    clientSecret: "s".repeat(48),
    fetchImpl: async (input, init) => {
      assert.equal(String(input), tokenUrl);
      assert.equal(String(input).includes("s".repeat(48)), false);
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({ access_token: jwt(), token_type: "Bearer", expires_in: 300 }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    now: () => 1_000
  });

  const token = await provider.refresh();
  assert.equal(provider.currentToken, token);
  assert.match(requestBody, /grant_type=client_credentials/u);
  assert.match(requestBody, /client_id=clinic-os-temporal-worker/u);
  assert.match(requestBody, /client_secret=/u);
});

test("Temporal OAuth rejects the wrong audience, permissions, lifetime, and endpoint failures", async () => {
  const create = (body: object, status = 200) =>
    new TemporalOAuthTokenProvider({
      tokenUrl,
      clientId: "clinic-os-temporal-worker",
      clientSecret: "s".repeat(48),
      fetchImpl: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" }
        })
    });

  await assert.rejects(
    create({
      access_token: jwt({ aud: "other" }),
      token_type: "Bearer",
      expires_in: 300
    }).refresh(),
    /exact issuer, client, audience, or permissions/u
  );
  await assert.rejects(
    create({
      access_token: jwt({ iss: "https://attacker.example.invalid/realms/clinic-os" }),
      token_type: "Bearer",
      expires_in: 300
    }).refresh(),
    /exact issuer, client, audience, or permissions/u
  );
  await assert.rejects(
    create({
      access_token: jwt({ azp: "other-client" }),
      token_type: "Bearer",
      expires_in: 300
    }).refresh(),
    /exact issuer, client, audience, or permissions/u
  );
  await assert.rejects(
    create({ access_token: jwt(), token_type: "Bearer", expires_in: 3600 }).refresh(),
    /bounded lifetime/u
  );
  await assert.rejects(
    create({ error: "temporarily_unavailable" }, 503).refresh(),
    /returned 503/u
  );
});

function jwt(overrides: Record<string, unknown> = {}): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${encode({
    sub: "service-account-clinic-os-temporal-worker",
    iss: "https://auth.staging.example.invalid/realms/clinic-os",
    azp: "clinic-os-temporal-worker",
    aud: ["clinic-os-temporal"],
    permissions: ["default:worker", "default:write"],
    exp: 4_102_444_800,
    ...overrides
  })}.${"a".repeat(64)}`;
}
