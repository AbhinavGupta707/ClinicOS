# Checkpoint 16 — Native Mobile, AI/Scribe and Interoperability

**Status:** Local implementation candidate complete at E3; official core R4 validator passes; device/live-provider/ABDM E4 evidence remains separately gated
**Evidence target:** E4 physical-device/provider/validator
**Workers:** provisionally two to three initial boundary worktrees; only activated, independently progressable boundaries launch
**Primary findings:** PRR-004, 005, 021-023

## 1. Outcome

Complete the selected native capture, AI/STT and FHIR/ABDM boundaries without exposing partial clinical behavior. The CP14 cloud deferral does not block local mobile/offline, consent, AI safety or FHIR implementation, but it does block deployed telemetry/media paths and may block provider callbacks. Each boundary ships complete at E4 or remains disabled/unregistered.

## 2. Lanes

### Active launch decision — 2026-07-14

- Launch base is local `main` at `149a9d5e0dd394e3d53e6f5761da6c1b59b0b94d`; integration branch is
  `codex/integration/checkpoint-16`. `main` remains on the promoted CP15 baseline until the CP16
  candidate passes integration and promotion gates.
- CP15 invalidation-sensitive preflight is clean: workspace/config/clock/format checks pass and the
  real PostgreSQL provider-persistence gate passes with zero skips.
- Fireworks is the selected initial AI and transcription provider. No provider credential is
  present or required for this local wave. All live Fireworks calls remain fail closed until the
  service account/key, data-processing and healthcare contract, no-training/no-retention posture,
  data-residency route, model evaluation thresholds and activation authority are recorded.
- Fireworks' official Audio API provides `whisper-v3` and `whisper-v3-turbo`, so a second STT vendor
  is not required for the initial adapter. The quality route uses `whisper-v3`; turbo is an explicit
  separately evaluated low-latency route and is never an automatic clinical-quality downgrade.
- The AI catalogue maps logical task classes to exact configurable model identifiers. The initial
  candidates are DeepSeek V4 Pro for structured clinical drafts, GLM 5.2 for independent safety
  review, DeepSeek V4 Flash for bounded extraction/classification, Kimi K2.6 for long-context
  summarization, Qwen3 Embedding 8B and Qwen3 Reranker 8B for retrieval. These are candidates, not
  clinical approval: a route cannot activate until its versioned per-task evaluation gate passes.
- Physical-device, signed distribution, live Fireworks and ABDM sandbox evidence cannot be
  fabricated. The integrated synthetic core document now passes the official HL7 R4 validator with
  zero errors/warnings; deployed peer and ABDM evidence remain open while every unavailable path
  stays fail closed.
- User-owned untracked `research/` and `scripts/research/` are out of scope and must remain
  untouched.

The detailed provider and routing decision is frozen in
`docs/implementation/CP16_FIREWORKS_PROVIDER_DECISION.md`.

### Lane A — Native Mobile Capture and Secure Offline (`gpt-5.6-sol`, `xhigh`)

**Owns:** `apps/mobile/**` including its app manifest, tests and app-local release configuration.

**Goal:** approved Expo camera/audio providers, permission and consent transitions, SecureStore tokens/keys, encrypted app-private media/metadata, durable offline queue, process-death/reboot recovery, retry/backoff, post-upload/logout/revocation purge, backup exclusion, crash diagnostics and signed internal builds.

**Verification:** iOS/Android physical-device matrix, denied/revoked permissions, low storage, poor/offline network, background/foreground and lost-device/logout behavior. Simulator/web remains supplemental only.

### Lane B — AI/STT Gateway and Clinical Safety (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced AI/STT integration/API/domain/eval paths and tests.

**Goal:** approved vendor/region/no-training/retention path, data minimization, consent at capture/process time, structured schemas, prompt/model/version provenance, evaluation/red-team suite, human review/signature, failure fallback, kill switch and cost/token/duration controls.

**Invariant:** AI never signs notes, prescribes, bills, merges patients, releases exports or sends patient communications.

**Fireworks transport constraint:** use the stateless Chat Completions and Audio Transcriptions
interfaces through injectable typed transports. Do not use the Responses API's default retained
state, public audio URLs, provider tools, browser credentials or client-side keys. Persist bounded
ClinicOS provenance and digests, never provider chain-of-thought or raw PHI logs.

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

### Conflict and ownership matrix

| Surface        | Worker ownership                                                                | Master-only integration                                                                                           |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Native capture | `apps/mobile/**`                                                                | root lockfile/workspace scripts, evidence truth and signed external distribution                                  |
| AI/STT         | new namespaced CP16 AI/STT domain/integration/API/eval files and focused tests  | shared barrels, config/env, canonical migrations, route registry/bootstrap, provider secret wiring and activation |
| FHIR/ABDM      | `packages/fhir/**`, new namespaced interoperability API files and focused tests | shared contracts/bootstrap, canonical migration, consent/audit registry and external validator/sandbox evidence   |

Workers cannot edit root manifests, `package-lock.json`, shared environment/configuration,
canonical migrations, generated contracts, API bootstrap/route registry, security/readiness
registers, checkpoint evidence or release truth. The mobile lane may edit its owned
`apps/mobile/package.json` and `apps/mobile/app.json`; the master reconciles the root lockfile. Any
other dependency proposal is handed back to the master. Each worktree uses native dependencies; if absent it may run
`npm ci --prefer-offline --no-audit` inside its own worktree and must never resolve package types
from the primary checkout.

## 4. Exit Gate

- signed internal iOS and Android builds pass physical-device camera/audio/secure-storage/offline/recovery tests;
- approved AI/STT data path and evaluation thresholds pass with clinical safety review, or AI/audio remains wholly disabled and the corresponding blue-sky finding stays open;
- selected FHIR scope passes official validator and round-trip reconciliation;
- ABDM passes official sandbox and compliance review if enabled, otherwise remains unavailable and open;
- audit/provenance/consent/retention/deletion and tenant tests pass across all enabled boundaries;
- Browser/Computer Use/device evidence is sanitized and recorded;
- full repository/security/build gates pass;
- CP16 threat/register/evidence/memory/log/final report complete and integration promoted.
