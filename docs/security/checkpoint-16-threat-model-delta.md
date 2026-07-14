# Checkpoint 16 threat-model delta

**Scope:** native photo/audio capture and offline delivery, Fireworks AI/STT, protected AI
persistence and the selected FHIR R4 clinical-summary exchange.

**Evidence tier:** local deterministic/durable E3 plus a local official core R4 validator run.
Physical-device, live-provider, deployed-cloud/KMS and ABDM evidence remain open.

## Assets and trust boundaries

- Patient media, transcripts, prompts, model outputs and FHIR documents are PHI. They never enter
  provider keys, URLs, logs, metrics, client diagnostics or unencrypted durable columns.
- Mobile permission, consent and session state are separate authorities. Device permission does not
  imply patient consent; cached consent does not survive a revoked/unauthorized session.
- Mobile plaintext exists only during bounded capture/encryption/upload processing. App-private
  encrypted media and SQLCipher metadata use separately protected key material and verified purge.
- Fireworks is an untrusted external processor. Only the server resolves the secret reference and
  sends minimized bounded data after policy, budget, kill-switch and model-evidence gates.
- Model output is untrusted review-only data. Schema/source anchors, independent safety review,
  uncertainty and human signature boundaries precede any clinical use.
- Imported FHIR JSON is hostile input. The boundary parses under byte/depth/key/string bounds,
  allowlists its graph/URI/profile surface, minimizes it and never auto-merges patient identity.

## Threat and control delta

| Threat                                                        | Production control implemented                                                                                                          | Remaining evidence                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Capture without permission or consent                         | Explicit permission/consent state machines, action-time binding and fail-closed audio policy                                            | Physical permission/revocation matrix        |
| Plaintext mobile PHI or backup leakage                        | App-private authenticated encryption, SQLCipher metadata, SecureStore/native key protection, backup exclusion and safe diagnostics      | Physical storage/backup inspection           |
| Process death, outage or duplicate upload loses/invents state | Durable leased queue, stable three-phase idempotency, bounded retry, uncertain/manual-review state and recovery                         | Physical reboot/network/low-storage exercise |
| Logout or revoked session leaves recoverable PHI              | Token purge, verified DB/WAL/SHM/media deletion before key destruction; failure remains explicit                                        | Lost-device/MDM and forensic device evidence |
| Client/provider key disclosure                                | Server-only Secrets Manager reference, no client key surface, redacted errors/logs and secret scan                                      | Live service-account rotation/audit          |
| Silent model substitution or clinical downgrade               | Exact allowlisted per-task model IDs plus availability/evaluation binding; no fallback                                                  | Live model-list and versioned eval approval  |
| Prompt injection, hallucination or autonomous action          | Delimited source, bounded structured schema, source anchors, uncertainty, independent review and zero mutation/signature/tool authority | Clinical red-team/human-factors E4           |
| Provider retries duplicate spend or effects                   | Durable invocation/usage idempotency, leased claims, conservative budgets and terminal ambiguity reconciliation                         | Live timeout/outage/cost exercise            |
| Revoked consent races AI processing                           | Policy recheck at application and provider stages, persisted evidence digest and transaction-bound result                               | Live revocation race exercise                |
| AI plaintext persists in database or telemetry                | KMS envelope codec, ciphertext/digests only, forced RLS and PHI-free metrics                                                            | Deployed KMS/telemetry inspection            |
| Malformed FHIR graph or arbitrary URL causes confusion/SSRF   | Closed resource/field/URI allowlists, no dereference, bounded parser, exact profiles and official validator                             | Deployed exchange peer evidence              |
| Wrong patient/tenant or stale record is merged                | Exact scoped identifier match, ambiguity quarantine, version/consent recheck and no auto-merge                                          | Authorized peer round-trip/clinical review   |
| Consent/provenance is omitted from export                     | Composition-forward Consent, policy URI, standard disclosure/treatment codes, signed-note digest and Provenance                         | Receiving-system/ABDM review                 |
| ABDM fixture is presented as activation                       | Capability stays unregistered/unavailable without exact package plus sandbox evidence                                                   | Official ABDM activation remains open        |

## Security decision

The selected local CP16 implementation is suitable for promotion as a fail-closed implementation
baseline. PRR-004/005/021/022 are materially implemented at E3 but cannot close at their required
E4 tiers. PRR-023 remains open until signed builds and physical-device controls are evidenced.

The release remains **NO-GO** for real PHI, live AI/audio, national exchange, production provider
traffic or clinical reliance.
