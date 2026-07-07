# Provider Health And Alerting Runbook

Checkpoint 9 uses existing provider-health and observability contracts as alert inputs. This runbook does not activate live providers, register callbacks, or claim simulator readiness as production readiness.

## Signal Sources

- API provider health: `GET /v1/provider-health`.
- Worker health registry checks: outbox repository, registered handlers, Temporal connection, and provider adapters.
- Dead-letter review: `GET /v1/dead-letter-events?status=unreviewed`.
- Future pilot-prod infrastructure signals: CloudWatch alarms, backup job status, RDS saturation, WAF metrics, and Sentry or equivalent error reporting.
- Alert classification helper: `@clinic-os/observability` exports `clinicOsOperationalAlertRules` and `classifyProviderHealthAlert`.

## Layer-Order Diagnosis

When a feature or provider appears missing, unavailable, or unlisted:

1. Confirm registration/discovery state: route registered, provider configured, handler registered, env parsed, and expected live provider list set.
2. Confirm official activation flow: signed webhook URL, account id, template approval, provider dashboard status, and clinic-approved manual workflow where applicable.
3. Confirm permissions and runtime only after the feature is present: auth role, tenant/clinic scope, network, DNS, rate limits, provider outage, and dead-letter state.

Do not debug runtime credentials for a provider that is intentionally `simulator`, `unconfigured`, or not part of the expected live provider set.

## Provider Status Semantics

| Status           | Local/dev action                                         | Pilot-prod action                                                                                         |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `available`      | Healthy for the configured boundary.                     | Healthy only if the provider is expected live and activation evidence exists.                             |
| `degraded`       | Investigate locally, no page.                            | Page if expected live; otherwise keep feature unavailable/manual.                                         |
| `unavailable`    | Investigate before enabling workflows.                   | Page if expected live; do not mark provider actions complete.                                             |
| `not_configured` | Informational. Simulator or unavailable state is honest. | Page only if expected live. Otherwise document deferred activation and keep UI/API unavailable or manual. |

Simulator-backed checks may prove typed contracts, but they do not prove live provider readiness.

## Initial Alert Catalog

The CP9 baseline alert catalog is exported from `packages/observability/src/alerts.ts`.

| Signal                          | Default severity | Initial threshold                                                   | First response                                                                              |
| ------------------------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| API error spike                 | Critical         | 5xx rate above 2% for 5 minutes or synthetic smoke failure          | Check release, route registration, dependency health, and recent errors.                    |
| Worker down                     | Critical         | No healthy worker heartbeat for 5 minutes                           | Check worker process, Temporal, outbox repository, and registered handlers.                 |
| Outbox lag                      | Warning          | Oldest pending event over 15 minutes or dead-letter count increases | Check outbox stats and dead-letter route before replay.                                     |
| Webhook failure spike           | Warning          | More than 5 failures in 10 minutes per provider account             | Check signature verification, raw event ingestion, normalization, and provider dashboard.   |
| Payment reconciliation mismatch | Critical         | Any confirmed paid/provider-paid mismatch                           | Freeze automatic reconciliation, verify signed Razorpay evidence, and preserve audit trail. |
| Database saturation             | Critical         | Connections above 85% for 5 minutes                                 | Check API/worker connection pools and database dashboard.                                   |
| Backup failure                  | Critical         | Any failed backup job or missing backup in RPO window               | Follow `backup-restore-drill.md`.                                                           |
| Provider outage                 | Critical         | Expected live provider degraded/unavailable/not configured          | Confirm activation, provider status, callbacks, and fallback workflow.                      |

## Triage Steps

1. Capture the alert id, timestamp, environment, tenant/clinic scope if present, and correlation id if present.
2. Read `/v1/provider-health` as an authorized owner/admin operator. Do not expose provider credentials in evidence.
3. Check worker health. A provider outage plus worker-down state may indicate local processing failure, not provider failure.
4. Check dead-letter counts before replay. Replay records a request/evidence workflow only; it does not prove WhatsApp delivery, payment capture, or patient state completion.
5. If the provider is `not_configured`, verify whether it is expected live. If not expected live, document the unavailable/manual state and do not page.
6. If the provider is expected live, confirm official activation: signed webhook URL, dashboard callback status, account id, approved templates, and required secrets in managed secret storage.
7. Preserve audit and outbox evidence before retrying external side effects.

## Escalation

Page the pilot operator only when:

- production-like environment is affected;
- the provider is expected live for the current pilot workflow;
- the issue blocks patient communication, payment reconciliation, data safety, backups, or core clinic operations;
- simulator/unconfigured status is unexpected for that environment.

Do not page for local/dev simulator states, intentionally deferred ABDM/Google/telephony activation, or manual import states that are functioning as designed.

## Recovery Rules

- Prefer provider dashboard and official API evidence over UI guesses.
- Never mark provider delivery/read, payment success, or patient workflow completion from alert acknowledgment alone.
- Do not replay dead letters in bulk without reviewing tenant/clinic scope and idempotency keys.
- If secrets are missing, fix registration/secret loading first. Do not print the secret values.
- If a provider has a live outage, switch product surfaces to an honest unavailable/manual workflow where supported.
