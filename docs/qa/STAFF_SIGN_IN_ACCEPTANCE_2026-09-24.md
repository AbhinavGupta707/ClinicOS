# Staff sign-in acceptance — 24 September 2026

Status: implementation under verification. This document does not approve a live
clinic deployment. The current slice composes the identity foundations merged in
PRs #3 and #4 on `mac-latest-20260829`.

## Supported boundary

The custom Node web entrypoint owns `/auth/login`, `/auth/callback`,
`/auth/session`, `/auth/logout`, `/auth/health` and `/bff/v1/*`. It inspects the
connection peer and original headers before Next.js can normalize forwarding
headers. Interactive activation is restricted to direct-loopback synthetic local
use. Cloud proxy activation is rejected until an independently verified proxy
adapter exists. Browser bearer injection is restricted to the separately marked
synthetic legacy acceptance transport.

The web session stores encrypted tokens in Redis. The browser receives an opaque
HttpOnly cookie and a CSRF value, never bearer/refresh/ID tokens. The BFF forwards
only authenticated API route families. API/database authority remains canonical;
Keycloak does not assign ClinicOS clinical permissions.

The worker delivers required identity events to the global append-only PostgreSQL
audit sink. Its expiring readiness lease gates login and clinic API admission.
Session inspection and sign-out still require the durable stores and required
audit writes, but can revoke access while delivery is temporarily stopped. It also reaps
expired session and revocation state in bounded batches. Clinical audit events
retain their existing path.

Migration 0026 records a monotonic authentication cutoff alongside transactional
authority generations. A refreshed old login cannot become current solely because
roles were restored. This cutoff describes the authority mutation instant, not a
PostgreSQL commit timestamp. It requires synchronized clocks; Keycloak timestamps
have second precision, so immediate same-second login can require retrying.

App-cookie replacement does not revoke the shared Keycloak SSO session. Logout
and security invalidation deny the old SID for 24 hours; the accepted synthetic
realm caps SSO/client sessions at eight hours. Explicit logout also uses the
official Keycloak session logout endpoint. Unconfirmed provider logout is reported
as such, without restoring patient content.

## Configuration contract

Default activation is unavailable. Do not use these settings with live patient
data or behind an unverified proxy. All processes require the same stable
server-only settings:

| Setting | Contract |
| --- | --- |
| `CLINICOS_STAFF_SIGN_IN_ENABLED` | `true`, explicitly |
| `CLINIC_OS_ENV`, `PILOT_SYNTHETIC_DATA_ONLY` | `local`, `true` |
| `KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM` | exact HTTP loopback origin and registered realm |
| `KEYCLOAK_CLIENT_ID` | confidential `clinic-os-web-bff` |
| `REDIS_URL` | loopback non-cluster writable primary |
| `CLINICOS_SESSION_KEY` | stable, randomly generated 32-byte canonical base64 secret |
| `CLINICOS_SESSION_KEY_ID` | encryption-key identifier, default `initial` |
| `CLINICOS_IDENTITY_NAMESPACE` | shared isolated namespace, default `clinicos:staff:v1` |
| `CLINICOS_SESSION_IDLE_SECONDS` | 300–1800; default 900 |
| `DATABASE_URL` | loopback `clinic_os_runtime` role on `clinic_os` |
| Worker `WORKER_DATABASE_URL` | loopback `clinic_os_worker` role |
| Web `CLINICOS_WEB_ORIGIN` | exact loopback origin matching the listener port |
| Web `CLINIC_OS_API_INTERNAL_URL` | exact API loopback origin |
| Web `CLINICOS_OIDC_CLIENT_SECRET` | confidential-client secret, server only |

Both fixture identity/repository flags must be false. Public environment variables
must contain no secrets. Register an exact callback, S256 PKCE, API audience,
refresh rotation, bounded eight-hour SSO/client lifetime, real password/OTP AMR
execution references and the AMR mapper. Do not copy synthetic credentials into a
real environment. Do not rotate the shared root key as an ordinary config change:
retained-key/namespace migration and recovery verification remain an activation
gate beyond this synthetic slice.

The normal web commands use `server/start.mts`; build shared packages first.
Next's standalone launcher cannot wrap a custom server. The web image therefore
packages the custom entrypoint, generated web output, required workspaces and
focused production dependencies together.

## Verification and remaining gates

Local regression: 1,064 workspace tests passed, followed by affected auth/web
reruns after review fixes (73 auth and 137 web tests; 1,068 total at this revision).
Typecheck, lint, workspace checks, secret scan and optimized web build passed.
Three image-contract checks also passed. Native browser inspection verified the
built unavailable state and Retry. The older Browser Use backend was unavailable;
the in-app Computer Use browser provided this inspection. No local Docker or
database services were started.

The first CI candidate `c136d1a5` passed shared build, workspace/type checks,
migrations, real Redis OAuth/audit, repository/worker tests, API fault recovery,
workspace tests/build, and legacy real-stack import acceptance. The new identity
trial stopped at worker readiness. Previous repository fault fixtures leave old
outbox rows, so the next candidate reinitializes the job's disposable database
before identity acceptance and records bounded health-component diagnostics. It
does not weaken worker health. Candidate `0b6e7725` then passed worker/API/BFF
readiness and auth-route negatives, but timed out in its first browser sign-in.
Its security workflow passed all image, SCA and CodeQL jobs. The trial now runs
on its own disposable runner, independent of the fault-fixture database, and
records only fixed route/status labels and bounded callback failure classifications.
Candidate `98c2660f` narrowed the failure to token verification after a successful
provider browser round trip. Review found that the OIDC JWKS parser rejected a
whole set when Keycloak also published encryption or other-algorithm public keys.
It now selects only the fixed RS256 signing-key class, rejects malformed or
ambiguous eligible keys, and retains all token signature/issuer/audience checks.
A mixed-key regression and negative key-use cases cover this compatibility fix.
Candidate `8b961cab` then completed the provider round trip and correctly denied
an unregistered identity. Its next test stopped because Keycloak legitimately
remembers the account on `prompt=login` and shows only a password field. The runner
now verifies that displayed account before submitting its password, while retaining
fresh authentication. Full sign-in acceptance remains pending.

Review also found a shutdown race between in-flight audit delivery/final lease
withdrawal and adapter closure. The worker now drains its own audit loop before
closing adapters, with a bounded process shutdown deadline. The deferred-delivery
regression and all 60 worker tests pass; real graceful termination is an explicit
acceptance assertion.

CodeQL reported five new findings on that first candidate. Outbound API transport
now constructs authority solely from validated server configuration, with tests
rejecting foreign hosts/ports, URL credentials, fragments and redirects. Two
password-hash findings concern HMAC-SHA256 over a 256-bit random session ID with
independent lookup/CSRF keys, not human passwords. Two bypass findings concern
exact public login/callback route dispatch; method, boundary, OAuth state/PKCE,
nonce, subject, current authority and MFA checks still execute inside those routes.
Independent review found no bypass. Negative method and real route probes support
the narrowly scoped false-positive assessment; no query is disabled globally.

Exact-head identity acceptance, image runtime/security and final CodeQL disposition
must be checked on PR #5 before merge approval. The packaged web image is also
started without a network or credentials in CI to verify generated output,
unconfigured identity rejection, non-root execution and graceful shutdown.

`scripts/test-staff-sign-in.mjs` refuses to run outside a marked disposable GitHub
Actions database. It registers its own synthetic realm/user/client through the
official local Admin API, runs the actual worker/API/BFF, and drives real browser
password and TOTP authentication. It retains safe result summaries and dashboard
screenshots; it does not retain token-bearing traces, HTML or enrollment screens.

The existing four import browser scenarios still provide synthetic-auth evidence;
they do not replace this real OIDC gate. Schema/Redis/provider/browser checks,
image builds and image security must pass on the final reviewed commit.

Separate gates remain: production proxy/HTTPS and cookies, managed Redis recovery
and key rotation, production realm/MFA policy review, retained audit export and
alerts, authorized real staff onboarding, and the Practo export contract/sample.
No AI API key, email provider, WhatsApp integration or Clerk installation is needed
for this identity slice. It does not complete the broader blue-sky programme.

## Official behavior references

- [Next.js custom server packaging](https://nextjs.org/docs/app/guides/custom-server).
- [Keycloak 25 AMR execution references](https://raw.githubusercontent.com/keycloak/keycloak/25.0.6/services/src/main/java/org/keycloak/protocol/oidc/utils/AmrUtils.java).
- [Keycloak authenticator registration](https://raw.githubusercontent.com/keycloak/keycloak/25.0.6/services/src/main/java/org/keycloak/services/resources/admin/AuthenticationManagementResource.java).
- [Keycloak session logout](https://raw.githubusercontent.com/keycloak/keycloak/25.0.6/services/src/main/java/org/keycloak/protocol/oidc/endpoints/LogoutEndpoint.java).

- [Keycloak 25 mixed public-key publication](https://github.com/keycloak/keycloak/blob/25.0.6/services/src/main/java/org/keycloak/protocol/oidc/utils/JWKSServerUtils.java).
