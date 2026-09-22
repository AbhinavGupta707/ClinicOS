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

const tokenUrl = `${issuer}/protocol/openid-connect/token`;

async function authenticate() {
  const cookies = new Map();
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(16).toString("hex");
  const state = randomBytes(16).toString("hex");
  const auth = new URL(`${issuer}/protocol/openid-connect/auth`);
  auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", scope: "openid", state, nonce }).toString();
  const noPkce = await request(auth.href);
  assert.equal(noPkce.status, 302, "Missing PKCE must return an OAuth error callback");
  const rejectedCallback = new URL(noPkce.headers.get("location"));
  assert.equal(`${rejectedCallback.origin}${rejectedCallback.pathname}`, redirectUri);
  assert.equal(rejectedCallback.searchParams.get("state"), state);
  assert.equal(rejectedCallback.searchParams.get("error"), "invalid_request");
  assert.equal(rejectedCallback.searchParams.has("code"), false);
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
    assert.ok(Number.isInteger(claims.auth_time) && claims.auth_time > 0);
    if (token === tokens.id_token) {
      assert.equal(claims.aud, clientId);
      assert.equal(claims.nonce, nonce);
    } else {
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      assert.ok(audiences.includes("clinic-os-api"), "Access token must address the ClinicOS API");
    }
  }
  return { tokens, exchange };
}

async function refresh(refreshToken, expectedStatus, message) {
  const response = await form(tokenUrl, {
    grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken
  });
  assert.equal(response.status, expectedStatus, message);
  const result = await response.json();
  if (expectedStatus === 400) assert.equal(result.error, "invalid_grant");
  return result;
}

try {
  // Replay detection revokes the affected client session in Keycloak. Each
  // negative scenario needs a fresh login, otherwise a previous revocation
  // could make a later assertion pass for the wrong reason.
  const { tokens } = await authenticate();
  const refreshed = await refresh(tokens.refresh_token, 200, "Refresh failed");
  assert.ok(refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token);
  const logout = await form(`${issuer}/protocol/openid-connect/logout`, {
    client_id: clientId, refresh_token: refreshed.refresh_token
  });
  assert.equal(logout.status, 204, "Session logout failed");
  for (const refreshToken of [tokens.refresh_token, refreshed.refresh_token]) {
    await refresh(refreshToken, 400, "Logged-out refresh token accepted");
  }

  const rotationCase = await authenticate();
  const rotated = await refresh(rotationCase.tokens.refresh_token, 200, "Replay-case refresh failed");
  assert.ok(rotated.refresh_token && rotated.refresh_token !== rotationCase.tokens.refresh_token);
  await refresh(rotationCase.tokens.refresh_token, 400, "Original refresh token replay accepted before logout");

  const codeCase = await authenticate();
  const replay = await form(tokenUrl, codeCase.exchange);
  assert.equal(replay.status, 400, "Authorization code replay accepted");
  assert.equal((await replay.json()).error, "invalid_grant");
  await refresh(codeCase.tokens.refresh_token, 400, "Code replay did not revoke the affected client session");
  console.log("Keycloak OIDC passed: PKCE required, interactive login, JWKS signatures, code replay rejected, refresh rotation, logout/revocation");
} finally {
  const removed = await request(userUrl, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(removed.status, 204, "Synthetic user cleanup failed");
}
