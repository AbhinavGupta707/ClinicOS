# Checkpoint 16 — Native Mobile, AI/Scribe and Interoperability

**Status:** Selected local implementation may follow CP15 implementation; device/provider/validator evidence remains separately gated
**Evidence target:** E4 physical-device/provider/validator
**Workers:** provisionally two to three initial boundary worktrees; only activated, independently progressable boundaries launch
**Primary findings:** PRR-004, 005, 021-023

## 1. Outcome

Complete the selected native capture, AI/STT and FHIR/ABDM boundaries without exposing partial clinical behavior. The CP14 cloud deferral does not block local mobile/offline, consent, AI safety or FHIR implementation, but it does block deployed telemetry/media paths and may block provider callbacks. Each boundary ships complete at E4 or remains disabled/unregistered.

## 2. Lanes

### Lane A — Native Mobile Capture and Secure Offline (`gpt-5.6-sol`, `xhigh`)

**Owns:** `apps/mobile/**` including its app manifest, tests and app-local release configuration.

**Goal:** approved Expo camera/audio providers, permission and consent transitions, SecureStore tokens/keys, encrypted app-private media/metadata, durable offline queue, process-death/reboot recovery, retry/backoff, post-upload/logout/revocation purge, backup exclusion, crash diagnostics and signed internal builds.

**Verification:** iOS/Android physical-device matrix, denied/revoked permissions, low storage, poor/offline network, background/foreground and lost-device/logout behavior. Simulator/web remains supplemental only.

### Lane B — AI/STT Gateway and Clinical Safety (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced AI/STT integration/API/domain/eval paths and tests.

**Goal:** approved vendor/region/no-training/retention path, data minimization, consent at capture/process time, structured schemas, prompt/model/version provenance, evaluation/red-team suite, human review/signature, failure fallback, kill switch and cost/token/duration controls.

**Invariant:** AI never signs notes, prescribes, bills, merges patients, releases exports or sends patient communications.

### Lane C — FHIR and ABDM (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/fhir/**`, namespaced interoperability API module and tests.

**Goal:** selected complete FHIR document/export/exchange route, terminology/profile/reference validation, identity/patient matching, consent/provenance, idempotency, retry/reconciliation and official ABDM sandbox path if credentials/approval exist.

**Invariant:** fixture projection cannot be presented as live conformance; ABDM stays unavailable without official activation.

### Optional second wave — Safety, Device and Boundary QA (`gpt-5.6-sol`, `high`)

**Launch condition:** the selected mobile, AI/STT and interoperability boundaries are reviewed and merged with stable consent, provenance and unavailable-state contracts. Otherwise the master owns this work.

**Owns:** CP16 acceptance/e2e/eval orchestration, device/provider evidence templates, privacy manifests/release runbooks and CP16 QA/security delta.

**Goal:** independent adversarial and human-factors coverage across consent/revocation, wrong patient/tenant, offline/corruption, unsafe AI output, provider outage, FHIR invalid graph and unavailable states. No product-code edits.

## 3. Master Integration

Master owns root manifests/lockfile/env, API route/bootstrap composition, shared consent/audit/capability registry integration, signing/distribution external actions and final physical-device/provider tests.

Launch only the mobile, AI/STT and FHIR/ABDM candidates that can make material progress with the available activation, provider and device inputs. Merge those namespaces, freeze the shared consent/provenance boundary, then optionally launch QA from that integration commit. Reconcile any shared consent/audit contract centrally; do not let lanes create parallel consent models.

## 4. Exit Gate

- signed internal iOS and Android builds pass physical-device camera/audio/secure-storage/offline/recovery tests;
- approved AI/STT data path and evaluation thresholds pass with clinical safety review, or AI/audio remains wholly disabled and the corresponding blue-sky finding stays open;
- selected FHIR scope passes official validator and round-trip reconciliation;
- ABDM passes official sandbox and compliance review if enabled, otherwise remains unavailable and open;
- audit/provenance/consent/retention/deletion and tenant tests pass across all enabled boundaries;
- Browser/Computer Use/device evidence is sanitized and recorded;
- full repository/security/build gates pass;
- CP16 threat/register/evidence/memory/log/final report complete and integration promoted.
