# CP16 Fireworks AI and Speech Provider Decision

**Decision date:** 2026-07-14  
**Decision state:** implementation-approved, live processing disabled pending external approval  
**Initial provider:** Fireworks AI

## Decision

ClinicOS will implement one server-side, typed Fireworks provider boundary for text inference and
speech transcription. The boundary is credential-ready but fail closed by default. Mobile and web
clients never receive the Fireworks key and never call Fireworks directly.

Fireworks' official Audio API already exposes `whisper-v3` and `whisper-v3-turbo`, word/segment
timestamps, multilingual alignment and optional diarization. The initial ClinicOS STT route
therefore does not need a second vendor. The provider accepts public audio URLs, but ClinicOS must
reject that mode and upload only bounded bytes read from its authorized private-media path.

## Initial task catalogue

| Logical task | Initial exact model candidate | Serving intent | Activation rule |
| --- | --- | --- | --- |
| `clinical_structured_draft` | `accounts/fireworks/models/deepseek-v4-pro` | quality-first structured draft | versioned clinical eval and schema-conformance thresholds pass |
| `clinical_safety_review` | `accounts/fireworks/models/glm-5p2` | independent model-family review | independent safety eval passes; never treated as a signature |
| `bounded_extraction` | `accounts/fireworks/models/deepseek-v4-flash` | efficient extraction/classification | task-specific precision/recall and abstention gates pass |
| `long_context_summary` | `accounts/fireworks/models/kimi-k2p6` | quality-first long-context summary | source-grounding and omission thresholds pass |
| `retrieval_embedding` | `fireworks/qwen3-embedding-8b` | serverless semantic retrieval | retrieval privacy and recall evaluation passes |
| `retrieval_rerank` | `fireworks/qwen3-reranker-8b` | serverless reranking | ranking evaluation passes |
| `speech_quality` | `whisper-v3` | default clinical transcription candidate | physical-device multilingual WER/safety review passes |
| `speech_low_latency` | `whisper-v3-turbo` | explicit latency-optimized route | separately meets the same clinical threshold |

Every mapping is configuration, not application logic. Exact identifiers are allowlisted at
startup and persisted with request provenance. A missing, removed, unapproved or changed model
fails the route closed; it never silently falls back to a cheaper or lower-quality model. Model
recommendations and prices are temporally mutable and must be revalidated during activation.

## Provider contract

- Text uses the stateless Chat Completions endpoint with `json_schema` structured output, bounded
  input/output tokens and no tool definitions. The schema is included in both the prompt and
  response format because Fireworks documents that requirement.
- ClinicOS does not use Fireworks Responses API storage. Fireworks documents `store=true` as the
  Responses API default with 30-day conversation retention, which is incompatible with the default
  ClinicOS posture.
- Audio uses the official transcription endpoints, `verbose_json`, word and segment timestamps,
  multilingual `mms_fa` alignment, diarization off by default and a configured maximum duration and
  byte size far below the provider's 1 GB ceiling.
- No autonomous tools, prescriptions, diagnoses, signatures, billing actions, patient messaging,
  patient merges or record mutations are exposed to a model. Outputs are schema-validated drafts
  with source anchors, warnings, uncertainty and mandatory human review.
- Retry is limited to provider-documented transient statuses with bounded exponential backoff and
  jitter. Authentication, validation, model-not-found and policy errors are terminal. A provider
  outage yields an honest unavailable/manual workflow rather than unsafe model substitution.
- The API key is resolved from an approved backend secret reference for a least-privilege Fireworks
  service account. It is never stored in source, mobile storage, logs, database payloads or worker
  handoffs.
- Logs contain task class, tenant-safe correlation, exact model identifier, prompt/schema version,
  request/response digests, token/audio-duration counts, latency, status and cost attribution—never
  raw prompt, transcript, output or provider reasoning.
- Per-request and per-clinic quotas, token/audio-duration ceilings, concurrency limits, circuit
  breaking and a global kill switch are mandatory. Budget exhaustion fails closed.

## Data and legal activation gate

Fireworks states zero persistent storage for open-model prompts/outputs unless a customer opts in,
and publishes security/compliance claims including HIPAA support. Those statements do not by
themselves establish a ClinicOS data-processing agreement, BAA, Indian health-data approval or a
permitted region.

The documented deployment regions currently include `APAC` multi-region and Tokyo single regions,
but no India single region is listed. Serverless placement is not treated as India residency.
Production PHI processing therefore remains disabled until the owner/legal/security team records:

1. a signed vendor/DPA/BAA and controller-processor decision;
2. no-training/no-retention and subprocessors evidence for the exact products used;
3. an approved deployment/serving region and cross-border transfer decision;
4. a least-privilege service account, key rotation and audit-log process;
5. model/version availability and per-task evaluation approval;
6. approved monthly budget, alerting and operational owner;
7. a live sanitized activation test followed by controlled clinical validation.

Until all seven pass, production-like startup exposes `not_configured` or `policy_blocked`; local
tests use typed deterministic transports only.

## Official sources

- [Recommended models](https://docs.fireworks.ai/guides/recommended-models)
- [Serverless pricing and serving tiers](https://docs.fireworks.ai/serverless/pricing)
- [Serverless overview](https://docs.fireworks.ai/serverless/overview)
- [Structured outputs](https://docs.fireworks.ai/structured-responses/structured-response-formatting)
- [Audio transcriptions](https://docs.fireworks.ai/api-reference/audio-transcriptions)
- [Zero Data Retention](https://docs.fireworks.ai/guides/security_compliance/data_handling)
- [Regions](https://docs.fireworks.ai/deployments/regions)
- [Reliability and error handling](https://docs.fireworks.ai/guides/reliability)
- [Service accounts](https://docs.fireworks.ai/accounts/service-accounts)
- [Embeddings and reranking](https://docs.fireworks.ai/guides/querying-embeddings-models)
