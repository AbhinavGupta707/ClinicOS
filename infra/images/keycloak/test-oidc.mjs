// Synthetic protocol acceptance, executed only inside the owned CI smoke network.
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";

const [origin, realm] = process.argv.slice(2);
assert.match(origin ?? "", /^http:\/\/clinicos-keycloak-runtime-[a-zA-Z0-9-]+:8080$/u);
assert.equal(realm, "clinic-os-staging");
const adminPassword = process.env.KEYCLOAK_SMOKE_ADMIN_PASSWORD;
assert.ok(adminPassword?.length >= 32);
const issuer = `${origin}/realms/${realm}`;
const clientId = "clinic-os-mobile";
const redirectUri = "https://mobile.staging.example.invalid/auth/callback";
const username = `oidc-smoke-${randomBytes(8).toString("hex")}`;
const password = `S!${randomBytes(24).toString("hex")}a9`;
const cookies = new Map();

async function request(url, options = {}) {
  // Callback locations are inspected but never followed off the private network.
  assert.equal(new URL(url).origin, origin);
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000)
  });
  return response;
}

async function form(url, values) {
  return request(url, {
    method: "POST",
    body: new URLSearchParams(values)
  });
}

const adminResponse = await form(`${origin}/realms/master/protocol/openid-connect/token`, {
  client_id: "admin-cli", username: "smoke-admin", password: adminPassword, grant_type: "password"
});
assert.equal(adminResponse.status, 200, "Synthetic admin login failed");
const { access_token: adminToken } = await adminResponse.json();
const created = await request(`${origin}/admin/realms/${realm}/users`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    username, email: `${username}@example.invalid`, emailVerified: true,
    firstName: "Synthetic", lastName: "OIDC", enabled: true,
    credentials: [{ type: "password", value: password, temporary: false }]
  })
});
assert.equal(created.status, 201, "Synthetic user provisioning failed");
const userUrl = created.headers.get("location");
assert.ok(userUrl?.startsWith(`${origin}/admin/realms/${realm}/users/`));

try {
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(16).toString("hex");
  const state = randomBytes(16).toString("hex");
  const auth = new URL(`${issuer}/protocol/openid-connect/auth`);
  auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", scope: "openid", state, nonce }).toString();
  const noPkce = await request(auth.href);
  assert.equal(noPkce.status, 400, "The public client must require PKCE");
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  const page = await request(auth.href);
  assert.equal(page.status, 200, "Expected an interactive login page");
  for (const value of page.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0];
    cookies.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  const html = await page.text();
  const formTag = html.match(/<form\b[^>]*\bid="kc-form-login"[^>]*>/u)?.[0];
  const action = formTag?.match(/\baction="([^"]+)"/u)?.[1].replaceAll("&amp;", "&");
  assert.ok(action, "Missing Keycloak interactive login form");
  const login = await request(action, {
    method: "POST", headers: { Cookie: [...cookies.values()].join("; ") },
    body: new URLSearchParams({ username, password, credentialId: "" })
  });
  assert.equal(login.status, 302, "Interactive login did not complete");
  const callback = new URL(login.headers.get("location"));
  assert.equal(`${callback.origin}${callback.pathname}`, redirectUri);
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code && !callback.searchParams.has("error"));
  const tokenUrl = `${issuer}/protocol/openid-connect/token`;
  const exchange = { grant_type: "authorization_code", client_id: clientId,
    redirect_uri: redirectUri, code, code_verifier: verifier };
  const tokensResponse = await form(tokenUrl, exchange);
  assert.equal(tokensResponse.status, 200, "PKCE exchange failed");
  const tokens = await tokensResponse.json();
  const jwksResponse = await request(`${issuer}/protocol/openid-connect/certs`);
  assert.equal(jwksResponse.status, 200);
  const { keys } = await jwksResponse.json();
  for (const token of [tokens.id_token, tokens.access_token]) {
    const [header64, body64, signature64] = token.split(".");
    const header = JSON.parse(Buffer.from(header64, "base64url"));
    const claims = JSON.parse(Buffer.from(body64, "base64url"));
    assert.equal(header.alg, "RS256");
    const key = keys.find((candidate) => candidate.kid === header.kid);
    assert.ok(key, "Token signing key not published");
    assert.ok(verify("RSA-SHA256", Buffer.from(`${header64}.${body64}`),
      createPublicKey({ key, format: "jwk" }), Buffer.from(signature64, "base64url")));
    assert.equal(claims.iss, issuer);
    assert.equal(claims.sub, userUrl.split("/").at(-1));
    assert.ok(claims.exp > Math.floor(Date.now() / 1000));
    if (token === tokens.id_token) {
      assert.equal(claims.aud, clientId);
      assert.equal(claims.nonce, nonce);
    }
  }
  assert.equal((await form(tokenUrl, exchange)).status, 400, "Authorization code replay accepted");
  const refreshedResponse = await form(tokenUrl, {
    grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token
  });
  assert.equal(refreshedResponse.status, 200, "Refresh failed");
  const refreshed = await refreshedResponse.json();
  assert.ok(refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token);
  const logout = await form(`${issuer}/protocol/openid-connect/logout`, {
    client_id: clientId, refresh_token: refreshed.refresh_token
  });
  assert.equal(logout.status, 204, "Session logout failed");
  for (const refreshToken of [tokens.refresh_token, refreshed.refresh_token]) {
    const denied = await form(tokenUrl, {
      grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken
    });
    assert.equal(denied.status, 400, "Logged-out refresh token accepted");
    assert.equal((await denied.json()).error, "invalid_grant");
  }
  console.log("Keycloak OIDC passed: PKCE required, interactive login, JWKS signatures, code replay rejected, refresh rotation, logout/revocation");
} finally {
  const removed = await request(userUrl, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(removed.status, 204, "Synthetic user cleanup failed");
}
