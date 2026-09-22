# Real API/Postgres import acceptance

`npm run mvp:test:real-stack` builds a separate Next output and runs all four
guarded import/Today/patient-search browser scenarios against the actual Nest
API, PostgreSQL repositories and Redis budgets. No API response is intercepted.
The browser reads `/v1/me` from the API. Only authentication uses the existing
local synthetic identity adapter and a test-only in-memory token callback;
this does not verify production OIDC login, refresh, logout or session wiring.
The web shell currently opens the canonical single-clinic membership returned by
`/v1/me`; multiple memberships remain unavailable until explicit clinic selection
is implemented. Token roles are not substituted for clinic membership roles.

## Prerequisites and safety boundary

- Existing Node 22 dependencies and Playwright Chromium; this runner never
  installs packages or downloads a browser.
- An explicitly disposable, local PostgreSQL cluster with all canonical
  migrations, runtime grants and the synthetic seed, plus an isolated Redis.
- `DATABASE_URL` must target `/clinic_os` as `clinic_os_runtime` on `127.0.0.1`;
  `REDIS_URL` must also use `127.0.0.1`. Both must be supplied explicitly.
  Connection query overrides and URL fragments are rejected.
- Set `CLINICOS_MVP_IMPORT_E2E_ENABLED=true`,
  `CLINICOS_MVP_TEST_DATABASE_DISPOSABLE=true`, and
  `PILOT_SYNTHETIC_DATA_ONLY=true` only after confirming that environment.
- The fresh-cluster provisioner must also create a random 32-character hex token,
  mark the database comment as `ClinicOS disposable MVP acceptance <token>`, and
  pass that same value as `CLINICOS_MVP_DATABASE_TOKEN`. The runner checks this
  marker through the least-privilege runtime connection before starting the API.
  Never add this marker to an existing valuable database to bypass the guard.
- Do not point these tests at a development database containing valuable data.
  The scenarios commit and roll back synthetic records. An interrupted or failed
  test may retain synthetic data, so the backing cluster must be disposable.
- The runner does not start, reset, stop or remove PostgreSQL, Redis or Docker.
  Provisioning those services requires the separate applicable authorization.
  It stops only the API/web processes it owns.
- The web app must have no ambient `.env`, `.env.local`, `.env.production`, or
  `.env.production.local`; the runner supplies a minimal synthetic environment
  and refuses those files rather than reading or modifying them.

For an approved isolated environment, export the two loopback connection URLs
and the provenance token and three opt-in flags above, then run:

```sh
npm run mvp:test:real-stack
```

Set `CLINICOS_MVP_ARTIFACTS_DIR` and `TMPDIR` to directories on the desired data
drive to keep logs, screenshots, browser traces, and temporary data there. The
default artifact parent is `artifacts/mvp-real-stack/` in the checkout. Each run
gets a unique child directory. Next output goes to the ignored
`apps/web/.next-mvp-acceptance/`, with its own generated TypeScript config; the
ordinary `.next` build and source TypeScript config are preserved. Do not run
two acceptance builds concurrently in the same checkout.

The runner fails if any browser scenario fails, is skipped, is flaky, or fewer
than the four required scenarios execute. It records readiness, the identity
test boundary, browser JSON, screenshots/traces and process cleanup. Inspect
`result.json` and `browser-results.json`; an existing artifact directory alone
is not passing evidence.

## Continuous integration

The quality workflow runs acceptance after its fresh synthetic database setup
and workspace build. Chromium is installed only on that disposable CI runner.
The workflow uploads the acceptance evidence even on failure. Its existing
dependency and secret gates remain required. Passing this development-identity
test does not replace real OIDC, clinic-source, image-security or release gates.
