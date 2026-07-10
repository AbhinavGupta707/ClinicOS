import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundaryError,
  CP14_APPLICATION_RESOURCE_POLICIES,
  assertBrowserMutationRequest,
  assertTrustedRequestBoundary,
  buildBrowserSecurityHeaders,
  buildSensitiveApiHeaders,
  classifyAuditAction,
  createVerifiedTrustedProxyBoundary,
  evaluateCorsRequest,
  normalizeTrustedEdgePolicy
} from "../src/index.ts";

const productionPolicy = normalizeTrustedEdgePolicy({
  productionLike: true,
  trustedHosts: ["app.clinicos.example"],
  trustedOrigins: ["https://app.clinicos.example"],
  proxyBoundary: "verified_alb_adapter_required",
  hsts: "disabled_until_domain_ready"
});

const verifiedProxyBoundary = createVerifiedTrustedProxyBoundary({
  connectionVerified: true,
  forwardingHeadersOverwritten: true,
  forwardedChainLength: 1,
  canonicalHostHeader: "app.clinicos.example",
  canonicalProtoHeader: "https",
  verificationId: "alb-verification-0001",
  productionLike: true
});

test("trusted edge boundary requires exact host, origin, and normalized proxy protocol", () => {
  assert.deepEqual(
    assertTrustedRequestBoundary({
      policy: productionPolicy,
      hostHeader: "internal-alb.local",
      proxyBoundary: verifiedProxyBoundary,
      originHeader: "https://app.clinicos.example"
    }),
    {
      host: "app.clinicos.example",
      origin: "https://app.clinicos.example",
      protocol: "https"
    }
  );
  assert.throws(
    () =>
      assertTrustedRequestBoundary({
        policy: productionPolicy,
        hostHeader: "internal-alb.local",
        untrustedForwardedHostHeader: "attacker.example",
        proxyBoundary: verifiedProxyBoundary,
        originHeader: "https://app.clinicos.example"
      }),
    (error) => error instanceof BoundaryError && error.code === "PERMISSION_DENIED"
  );
  assert.throws(
    () =>
      assertTrustedRequestBoundary({
        policy: productionPolicy,
        hostHeader: "internal-alb.local"
      }),
    /Verified trusted-proxy boundary is required/
  );
  assert.throws(
    () =>
      createVerifiedTrustedProxyBoundary({
        connectionVerified: false,
        forwardingHeadersOverwritten: true,
        forwardedChainLength: 1,
        canonicalHostHeader: "app.clinicos.example",
        canonicalProtoHeader: "https",
        verificationId: "alb-verification-0002",
        productionLike: true
      }),
    /not proven/
  );
  assert.throws(
    () =>
      createVerifiedTrustedProxyBoundary({
        connectionVerified: true,
        forwardingHeadersOverwritten: true,
        forwardedChainLength: 2,
        canonicalHostHeader: "app.clinicos.example",
        canonicalProtoHeader: "https",
        verificationId: "alb-verification-0003",
        productionLike: true
      }),
    /one normalized forwarding hop/
  );
  assert.throws(
    () =>
      createVerifiedTrustedProxyBoundary({
        connectionVerified: true,
        forwardingHeadersOverwritten: true,
        forwardedChainLength: 1,
        canonicalHostHeader: ["app.clinicos.example", "attacker.example"],
        canonicalProtoHeader: "https,http",
        verificationId: "alb-verification-0004",
        productionLike: true
      }),
    /ambiguous/
  );
  assert.throws(
    () =>
      createVerifiedTrustedProxyBoundary({
        connectionVerified: true,
        forwardingHeadersOverwritten: true,
        forwardedChainLength: 1,
        canonicalHostHeader: "app.clinicos.example",
        canonicalProtoHeader: "https,http",
        verificationId: "alb-verification-0005",
        productionLike: true
      }),
    /ambiguous/
  );
  assert.throws(
    () =>
      assertTrustedRequestBoundary({
        policy: productionPolicy,
        hostHeader: "internal-alb.local",
        proxyBoundary: verifiedProxyBoundary,
        untrustedForwardedProtoHeader: "http",
        originHeader: "https://app.clinicos.example"
      }),
    /must be stripped/
  );
});

test("browser mutations require same-origin fetch metadata, a CSRF token, and no bearer header", () => {
  const input = {
    policy: productionPolicy,
    method: "POST",
    hostHeader: "internal-alb.local",
    proxyBoundary: verifiedProxyBoundary,
    originHeader: "https://app.clinicos.example",
    csrfHeader: "csrf-token-00000000000000000000000000000000",
    contentTypeHeader: "application/json; charset=utf-8",
    secFetchSiteHeader: "same-origin",
    verifyCsrfToken: (token: string) => token.startsWith("csrf-token-")
  };
  assert.equal(assertBrowserMutationRequest(input).protocol, "https");
  assert.throws(() => assertBrowserMutationRequest({ ...input, csrfHeader: "wrong" }), /CSRF/);
  assert.throws(
    () => assertBrowserMutationRequest({ ...input, originHeader: "https://attacker.example" }),
    /origin/
  );
  assert.throws(
    () => assertBrowserMutationRequest({ ...input, authorizationHeader: "Bearer browser-leak" }),
    /cannot supply bearer/
  );
  assert.throws(
    () => assertBrowserMutationRequest({ ...input, secFetchSiteHeader: "cross-site" }),
    /Cross-site/
  );
});

test("CORS is exact, credential-safe, and rejects unapproved preflights", () => {
  const allowed = evaluateCorsRequest({
    policy: productionPolicy,
    originHeader: "https://app.clinicos.example",
    requestMethod: "POST",
    requestHeaders: "content-type, x-csrf-token",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["content-type", "x-csrf-token"],
    credentialed: true
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://app.clinicos.example");
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.notEqual(allowed.headers["access-control-allow-origin"], "*");

  assert.equal(
    evaluateCorsRequest({
      policy: productionPolicy,
      originHeader: "https://attacker.example",
      requestMethod: "POST",
      allowMethods: ["POST"],
      allowHeaders: ["content-type"],
      credentialed: true
    }).allowed,
    false
  );
});

test("CSP and sensitive response headers deny framing, sniffing, caching, and browser capabilities", () => {
  const headers = buildBrowserSecurityHeaders({
    policy: productionPolicy,
    nonce: "nonce-00000000000000000000000000000000"
  });
  assert.match(headers["content-security-policy"]!, /script-src 'self' 'nonce-/);
  assert.match(headers["content-security-policy"]!, /frame-ancestors 'none'/);
  assert.equal(headers["content-security-policy"]!.includes("'unsafe-inline'"), false);
  assert.equal(headers["content-security-policy"]!.includes("'unsafe-eval'"), false);
  assert.equal(headers["cache-control"], "private, no-store, max-age=0, must-revalidate");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["strict-transport-security"], undefined);

  const apiHeaders = buildSensitiveApiHeaders();
  assert.match(apiHeaders["cache-control"]!, /no-store/);
  assert.equal(apiHeaders["referrer-policy"], "no-referrer");

  const reportingPolicy = normalizeTrustedEdgePolicy({
    ...productionPolicy,
    cspReportUri: "https://app.clinicos.example/security/csp-reports"
  });
  assert.match(
    buildBrowserSecurityHeaders({
      policy: reportingPolicy,
      nonce: "nonce-00000000000000000000000000000000"
    })["content-security-policy"]!,
    /report-uri https:\/\/app\.clinicos\.example\/security\/csp-reports/
  );
  assert.throws(
    () =>
      normalizeTrustedEdgePolicy({
        ...productionPolicy,
        cspReportUri: "https://reports.attacker.example/csp"
      }),
    /explicitly trusted/
  );
});

test("identity and privileged application resource policies are bounded and no-store", () => {
  assert.equal(CP14_APPLICATION_RESOURCE_POLICIES.login.rate.scope, "ip");
  assert.equal(CP14_APPLICATION_RESOURCE_POLICIES.login.rate.limit, 10);
  assert.equal(CP14_APPLICATION_RESOURCE_POLICIES.privileged.maximumConcurrencyPerActor, 1);
  assert.equal(CP14_APPLICATION_RESOURCE_POLICIES.privileged.cache, "no-store");
  assert.ok(CP14_APPLICATION_RESOURCE_POLICIES.mutation.maximumBodyBytes <= 1_048_576);
});

test("session, refresh replay, MFA, and JML audit actions are security-classified", () => {
  assert.equal(classifyAuditAction("auth.session.created").category, "security");
  assert.equal(classifyAuditAction("auth.session.rotated").riskLevel, "medium");
  assert.equal(classifyAuditAction("auth.session.revoked").riskLevel, "high");
  assert.equal(classifyAuditAction("auth.refresh.replay_detected").riskLevel, "critical");
  assert.equal(classifyAuditAction("auth.mfa.denied").riskLevel, "high");
  assert.equal(classifyAuditAction("identity.joiner.completed").category, "administration");
  assert.equal(classifyAuditAction("identity.mover.completed").riskLevel, "critical");
  assert.equal(classifyAuditAction("identity.leaver.completed").riskLevel, "critical");
});
