# Checkpoint 16 Evidence — Local Native, AI and Interoperability Baseline

**Status:** Selected CP16 implementation is complete at local E3. The core FHIR R4 document passes
the official HL7 validator locally. Physical-device/signed-distribution, live Fireworks approval and
evaluation, deployed KMS/cloud paths, and ABDM sandbox evidence remain open. The release is
**NO-GO** for PHI, live AI/audio, national exchange or clinical reliance.

**Launch base:** `149a9d5e0dd394e3d53e6f5761da6c1b59b0b94d`

**Integrated implementation candidate:** `1553507e92a5acd701f8e0817d8bb90c65ba98e7`

**Branch:** `codex/integration/checkpoint-16`

**Promotion merge:** `bce3de3870d2156295f7e0e93b0c5cc067c3f7f0` on `main`

## Implemented boundaries

### Native mobile

- Expo Camera and Audio providers use explicit grant/deny/permanent-deny and consent state
  machines. Capture does not start without the required permission, patient/encounter binding and
  action-time consent.
- Access tokens and wrapping keys use SecureStore plus a private native protected-storage module.
  Capture bytes are authenticated-encrypted in the app-private directory; metadata and delivery
  state use SQLCipher with backup exclusion.
- The durable queue has stable idempotency keys, reservation/content/completion phases, leases,
  process-death recovery, bounded retry/backoff, network recovery, outcome-uncertain/manual-review
  states and no false upload-success claim.
- Logout/session revocation deletes tokens, verifies database/WAL/SHM and media deletion, then
  destroys key material. If physical deletion cannot be verified, key destruction fails closed.
- Camera/microphone usage descriptions, privacy manifest, EAS internal build profiles, Android
  backup exclusions, iOS file-protection settings and safe diagnostics are declared. The web build
  is an honest unsupported native surface, not a capture simulator.

### Fireworks AI and speech

- One server-only Fireworks gateway covers structured drafts, independent safety review, bounded
  extraction, long-context summaries, embeddings, reranking and speech transcription. Fireworks
  `whisper-v3`/`whisper-v3-turbo` provide the initial STT boundary, so a second initial STT vendor is
  unnecessary.
- Exact candidate routes are DeepSeek V4 Pro, GLM 5.2, DeepSeek V4 Flash, Kimi K2.6, Qwen3
  Embedding 8B, Qwen3 Reranker 8B, Whisper V3 and Whisper V3 Turbo. There is no silent model,
  quality-tier or vendor fallback.
- Live activation requires exact model availability and versioned per-task evaluation evidence,
  service-account secret reference, healthcare/DPA/no-training/no-retention/residency approvals,
  approved budget and inactive kill switch. A key alone cannot activate the route.
- The gateway uses stateless structured Chat Completions and bounded multipart audio bytes, rejects
  public audio URLs/tools/chain-of-thought, rechecks consent, validates anchored review-only output,
  persists exact model/prompt/schema provenance, emits PHI-free metrics and never signs or mutates a
  clinical record.
- Migration `0022` provides forced-RLS invocation, protected result, usage reservation/counter and
  FHIR reconciliation storage. Claim/replay, result persistence, audit/outbox and usage accounting
  are transaction-bound; payloads use KMS envelope protection and no plaintext database column.

### FHIR R4 and ABDM

- A versioned FHIR `4.0.1` clinical-summary document contains a closed, consented graph with
  Composition, Patient, Encounter, Practitioner, Organizations, Consent, signed-note
  DocumentReference, MedicationRequests and Provenance. Internal references are document URNs,
  resources have generated narratives and standard HL7 disclosure/treatment/create terminology.
- Export requires server-loaded exact-scope/version source rows, action-time consent, strong ETag
  and idempotency. Import rejects arbitrary URLs, unknown fields/resources, extensions, unresolved
  graphs and unsafe identity matches; it stages only a minimized bounded reconciliation payload.
- Missing, ambiguous, cross-patient or stale patient/encounter matches quarantine. Review rechecks
  identity, version and consent; `applied` is accepted only with atomic clinical/audit/outbox proof.
- ABDM `ndhm.in#6.5.0` remains unregistered and unavailable. Neither credentials nor the local core
  validator result activates a national exchange path.

## Verification record

Commands ran on 2026-07-14 with synthetic data only.

| Evidence                                             | Result                                                                                                                                    | Tier / limitation                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run check`                                      | Pass: workspace, clock, compiler-gate, environment and format checks                                                                      | Local E1/E3                                                         |
| `npm run typecheck`                                  | Pass across all 16 production TypeScript workspaces                                                                                       | Local E1/E3                                                         |
| `npm run lint`                                       | Pass across all workspaces                                                                                                                | Local E1                                                            |
| `npm run test`                                       | Pass across all workspaces; sandbox socket tests retain their explicit environment skips                                                  | Local deterministic/E3                                              |
| `npm run build`                                      | Pass, including Expo web export and optimized Next production build                                                                       | Local build evidence                                                |
| `npm run security:secrets`                           | Pass; user-owned research paths excluded by the governed scanner                                                                          | No secret file read                                                 |
| `npm run security:audit`                             | Pass at high-severity threshold; 12 moderate transitive Next/Expo advisories remain                                                       | No forced breaking downgrade                                        |
| `npm run db:test:migrations`                         | Pass: concurrent runners, drift rejection, rollback, CP16 AI durability and canonical migrations unchanged                                | Real local PostgreSQL E3                                            |
| FHIR package                                         | Typecheck and 16/16 tests pass                                                                                                            | Deterministic round-trip/negative evidence                          |
| Official HL7 Validator CLI `6.9.11`, R4 core `4.0.1` | `Success: 0 errors, 0 warnings, 4 notes` on synthetic document SHA-256 `7dcccf6d4525401d3f4982efc3b4f806dbb98df166389a4307ba00207730d8d7` | Official core validator, local artifact; not ABDM/deployed exchange |
| Integrations package                                 | 199 tests pass, including Fireworks routing, structured output, consent, retry, budget, circuit and STT negatives                         | Typed provider contracts, no live provider traffic                  |
| API package                                          | CP16 AI/FHIR handler, durable replay, KMS envelope and reconciliation tests pass in the full suite                                        | No live KMS/Fireworks call                                          |
| Mobile package                                       | Typecheck, 14/14 tests, Expo config/dependency checks and web export pass                                                                 | No physical-device evidence                                         |
| Native build lane                                    | iOS/Android prebuild, podspec validation, unsigned arm64 iOS simulator build and cold launch passed                                       | Supplemental only; not signed/physical                              |
| Mobile Playwright                                    | Phone `390x844` and desktop `1280x900` pass with no overflow and honest native-unavailable state                                          | Rendered web boundary only                                          |

The official validator notes are informational references to the ClinicOS-owned policy/code/document
URIs. They are not profile, terminology, graph or cardinality warnings.

## External exit gates still open

1. No representative physical iOS/Android devices or signed TestFlight/internal Play/EAS builds
   were available. Permission, interruption, process death, reboot, low-storage, storage inspection,
   revocation/lost-device and purge matrices require physical evidence.
2. No Fireworks service-account key was read or used. Vendor/DPA/healthcare terms,
   no-training/no-retention posture, residency/cross-border decision, exact model availability,
   versioned clinical evaluations, human-factors review, live cost/latency and kill-switch exercises
   remain required before live AI or audio.
3. CP14 AWS/KMS deployment is owner-deferred. The production codec and secret resolver are wired,
   but deployed KMS key policy, secret rotation, telemetry and paging evidence do not exist.
4. No ABDM credential, official registration, `ndhm.in#6.5.0` package run or sandbox exchange was
   authorized. ABDM remains unregistered/unavailable.
5. No real PHI, patient audio, provider dashboard, external message/payment/call or national-health
   exchange action occurred.

The candidate was promoted locally under the existing owner deferral because every external
boundary fails closed and later code may consume the stable contracts. The complete check,
typecheck, lint, test, build and secret-scan sequence passed again after promotion. Promotion does
not close the CP16 E4/full exit gate or authorize CP17.
