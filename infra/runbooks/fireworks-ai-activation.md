# Fireworks AI and Speech Activation Runbook

This runbook governs activation of the CP16 Fireworks AI and speech-to-text boundary. It does not
authorize live provider traffic, production PHI, a Fireworks purchase, an AWS deployment, or a
clinical-safety approval. ClinicOS remains fail closed until every applicable control and external
evidence item below is complete. Local deterministic transport tests prove the adapter contract;
they do not prove Fireworks availability, privacy posture, residency, clinical quality, or cost.

The reviewed provider decision and exact candidate routing live in
`docs/implementation/CP16_FIREWORKS_PROVIDER_DECISION.md`. Model identifiers are configuration,
not permanent provider capabilities. Never substitute another model automatically when an
allowlisted model is absent, deprecated, rate limited, or fails an evaluation.

## Authority and secrets

Use a dedicated Fireworks service account with the least-privilege `inference-user` role. A
Fireworks administrator creates or updates the service account and creates its API key; a secrets
operator stores the value directly in the approved secret manager. The application configuration,
database, tickets, screenshots, shell history, logs, and this repository receive only an opaque
secret reference and the non-secret service-account identifier.

Official Fireworks instructions:

- create a service account: `firectl user create --user-id "clinicos-<environment>-inference" --service-account --role=inference-user`;
- create a named, expiring key for it: `firectl api-key create --key-name "ClinicOS <environment> inference" --service-account "clinicos-<environment>-inference" --expire-time "<approved-expiry>"`;
- list accounts for audit: `firectl user list --filter 'service_account=true'`.

Do not pass the key on a command line after creation, paste it into `.env`, or configure it in a
mobile/web client. Store it once through the secret manager's protected input. Set
`FIREWORKS_API_KEY_SECRET_REF` to that secret reference and `FIREWORKS_SERVICE_ACCOUNT_ID` to the
service account identifier. Runtime resolves the secret in memory at the backend boundary only.

References:

- <https://docs.fireworks.ai/accounts/service-accounts>
- <https://docs.fireworks.ai/accounts/users>
- <https://docs.fireworks.ai/tools-sdks/firectl/commands/api-key-create>

## Contract, privacy, and residency gate

Before any live call, the accountable legal/privacy owner must record the applicable Fireworks
contract and data-processing terms, healthcare/regulated-data acceptance, no-training and
zero-retention posture, subprocessors, deletion behavior, breach/support path, and the approved
data path. Fireworks documents that open-model inference does not persist prompts or responses by
default unless the customer opts in; ClinicOS therefore uses stateless Chat Completions and never
the stateful Responses API. This documentation is not a substitute for the required contract.

Fireworks advertises deployment region groups including APAC, but its published single-region list
does not currently establish an India region. Do not infer Indian data residency from `APAC`.
`CLINIC_OS_AI_DATA_RESIDENCY_APPROVED` stays false until the accountable owner approves the exact
serving path in writing. No real patient audio or clinical text may be used for activation tests.

References:

- <https://docs.fireworks.ai/guides/security_compliance/data_handling>
- <https://docs.fireworks.ai/deployments/regions>

## Model availability and routing gate

Immediately before evaluation and again before each release, use the authenticated List Models API
to prove every configured text/embedding/reranking candidate is still present and serverless (or
is bound to a separately approved dedicated deployment). Paginate the complete result; do not rely
on a dashboard screenshot alone. For public serverless models the official query is:

```text
GET https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue
Authorization: Bearer <resolved-service-account-key>
```

Compare exact returned `name`, `supportsServerless`, state/status, and deprecation metadata against
the configured catalogue. Record digests and non-secret metadata only. A missing or changed model
keeps that task unavailable until the catalogue, evaluation, and approval are deliberately updated.

References:

- <https://docs.fireworks.ai/api-reference/list-models>
- <https://docs.fireworks.ai/faq-new/models-inference/how-to-check-if-a-model-is-available-on-serverless>

## Clinical and speech evaluation gate

Use a versioned, synthetic and de-identified evaluation corpus that includes:

- Indian-English and supported Indian-language clinical speech, accents, code-switching, dental
  terminology, numbers, medicine names, negation, silence, overlapping speakers, noise, truncated
  audio and unsupported media;
- prompt-injection and data-exfiltration attempts embedded in transcript/source material;
- incorrect-patient, tenant, encounter, consent-revoked and stale-consent inputs;
- missing evidence anchors, contradictions, uncertainty, hallucination, unsafe recommendations,
  schema truncation and malformed provider responses;
- model outage, timeout, rate limit, retry exhaustion, circuit breaker, kill switch, and budget
  exhaustion.

Evaluate `whisper-v3` and `whisper-v3-turbo` separately. The quality route is the default candidate;
the turbo route cannot be used merely because it is cheaper or faster. Evaluate each text task on
its configured model independently. Every result remains review-only: AI cannot sign, prescribe,
bill, merge patients, release exports, message patients, call tools, or mutate records.

An accountable clinician and safety reviewer approve the versioned thresholds and failure review.
Only then may `CLINIC_OS_AI_CLINICAL_EVAL_APPROVED=true` be considered. Provider tests use
synthetic data until the later production-governance gates authorize otherwise.

## Runtime activation

Keep these defaults while credentials or approvals are incomplete:

```text
CLINIC_OS_AI_LIVE_CALLS_ENABLED=false
CLINIC_OS_AI_KILL_SWITCH=true
CLINIC_OS_AI_MONTHLY_BUDGET_CENTS=0
CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS=0
```

After independent review, set both `LLM_PROVIDER=fireworks` and
`TRANSCRIPTION_PROVIDER=fireworks`, configure the reviewed exact models/endpoints, set a non-zero
account monthly ceiling and per-clinic daily ceiling, and mark each contract/privacy/residency/eval
approval true. The final deliberate activation is:

```text
CLINIC_OS_AI_KILL_SWITCH=false
CLINIC_OS_AI_LIVE_CALLS_ENABLED=true
```

Startup must reject missing secret references, missing service-account identity, unreviewed
endpoints, partial provider selection, zero budgets, an active kill switch, or any false approval.
After startup, verify authenticated readiness without exposing keys, secret references, PHI, raw
prompts, audio, outputs, provider request IDs, or chain-of-thought.

## Reliability, cost, and monitoring

Retry only documented transient statuses `429`, `500`, `502`, `503`, and `504`, with bounded
exponential backoff and jitter. Treat request/auth/schema/not-found errors as terminal. Enforce
request byte, audio-duration, token, output, attempt, account-budget, and per-clinic-budget limits
before calls. Do not retry after a consent revocation, kill switch, budget denial, or policy failure.

Telemetry contains only provider/task/model, prompt/schema versions, digests, bounded token/audio
usage, latency, attempts, outcome, and sanitized reason codes. Alert on expected-live capability
failure, model disappearance/deprecation, budget pressure, circuit opening, safety-eval drift, and
repeated invalid responses. Provider raw bodies and reasoning are never logs or evidence.

References:

- <https://docs.fireworks.ai/guides/reliability>
- <https://docs.fireworks.ai/serverless/rate-limits>
- <https://docs.fireworks.ai/serverless/pricing>

## Rotation, rollback, and evidence

Rotate by creating a new named key for the same service account, updating the secret manager
version, restarting/reloading through the approved deployment path, and proving synthetic calls
before revoking the old key. Do not retain old keys in configuration or logs.

Rollback sets the kill switch true, disables live calls, stops new provider work, lets in-flight
operations fail safely, and preserves ClinicOS audit/provenance and review state. It never deletes
clinical evidence or rewrites provider history. Re-enable only after the triggering incident and
all affected evaluations are independently closed.

Required E4 evidence includes the exact code/image revision, non-secret service-account identity,
redacted contract/privacy/residency approvals, model-list result and deprecation review, per-task
and per-language evaluation report, budget and rate-limit tests, invalid-schema/prompt-injection
results, consent/tenant negatives, retry/circuit/kill-switch behavior, sanitized telemetry/alerts,
key rotation, and rollback/re-enable. Until that evidence exists, Fireworks remains configured for
later activation but operationally disabled, and CP16 must not claim live provider readiness.
