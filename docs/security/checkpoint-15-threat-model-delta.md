# Checkpoint 15 threat-model delta

**Scope:** official Meta WhatsApp Cloud and Razorpay boundaries, durable callback registration,
provider operations truth and background reconciliation.

**Evidence tier:** local deterministic and durable PostgreSQL evidence only. Deployed/public-edge and
official sandbox evidence remain open under the CP14 cloud deferral.

## Assets and trust boundaries

- Provider credentials, webhook secrets and verification tokens remain in the authorized secret
  manager. PostgreSQL stores only validated secret references and bounded secret-version labels.
- Public callback registration keys are opaque high-entropy values. Only SHA-256 digests are stored;
  the route index is forced-RLS and cannot be listed by the API runtime.
- Provider raw bytes cross an untrusted public boundary. Signature verification happens over bounded
  raw bytes before JSON parsing or domain effects.
- Signed provider evidence becomes tenant/clinic-scoped durable state, audit and outbox evidence in
  one transaction. A callback response is not equivalent to message delivery/read or payment
  settlement.
- Background workers may discover only due tenant/clinic identifiers through a dedicated forced-RLS
  scheduler. Job/provider rows are read and changed only after transaction-local scope binding.

## Threat and control delta

| Threat                                                    | Production control implemented                                                                                                                                                                 | Remaining evidence                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Callback-key enumeration or cross-account routing         | Opaque registration keys, digest-only exact lookup, non-listable route index, provider-key binding and forced RLS                                                                              | Public WAF/rate and deployed edge tests deferred          |
| Forged, changed or oversized callbacks                    | Raw-body size/content checks; Meta HMAC and Razorpay signature verification before parse; invalid signatures have no domain/audit/outbox effect                                                | Official sandbox invalid-signature evidence deferred      |
| Duplicate or reordered provider events                    | Provider event identifiers/digests, unique receipts/business effects, monotonic state transitions and replay-safe atomic commit                                                                | Deployed retry/out-of-order exercise deferred             |
| Secret disclosure or unsafe rotation                      | Secret-manager references only, bounded versions, current/previous secret acceptance window, no secret fields in API/UI/health/log evidence                                                    | Applied secret policy and live rotation deferred          |
| Tenant/clinic confusion                                   | Callback registration binds provider account to tenant/clinic; normalized notes/account checks; forced RLS and scoped transaction helpers; worker-only scope queue carries no provider payload | Deployed multi-tenant negative remains open               |
| Client or unsigned event invents paid/sent/delivered/read | Signed server evidence is required; ambiguous sends and payment creation outcomes enter reconciliation; UI explicitly shows configured/unverified/disabled truth                               | Official send/payment lifecycle evidence deferred         |
| Retry duplicates an uncertain outbound side effect        | POST transport uncertainty becomes an explicit reconciliation job; automatic replay is prohibited where outcome is ambiguous                                                                   | Official outage/recovery evidence deferred                |
| Reconciliation races credential/account changes           | Lease-owner conditional updates; registration identity, activation state, mode, account and credential are re-locked and compared before finalization                                          | Deployed credential-rotation race exercise deferred       |
| Reconciliation workers collide, crash or exhaust attempts | Durable scope/job leases, `FOR UPDATE SKIP LOCKED`, stale-lease recovery, deterministic backoff, fixed attempt ceiling and dead-letter/manual-review truth                                     | Multi-task deployed crash/restart remains open            |
| A provider read exceeds the job lease                     | One job per provider/scope, five-minute lease, declared worst-case official GET budgets and a finalization reserve; later calls do not start without sufficient remaining lease                | Provider latency/fault evidence deferred                  |
| Unsupported Meta lookup is guessed                        | Meta reconciliation closes only as unsupported/manual review; it never manufactures an authoritative message state                                                                             | Manual-review operational exercise deferred               |
| Telephony partial activation creates unsafe callbacks     | No provider selected: the entire telephony workflow remains disabled and no callback route or provider result is claimed                                                                       | Provider selection and complete official lane remain open |

## Security decision

The local CP15 implementation is suitable for promotion as a fail-closed implementation baseline.
It is not provider-activation evidence. PRR-008 stays open and PRR-026 is only locally implemented:
Meta/Razorpay require deployed signed HTTPS endpoints plus official sandbox exercises, and telephony
remains disabled until one official provider is selected and implemented as a complete workflow.

The ClinicOS release remains **NO-GO** for real PHI, patient messages/calls, payments or clinical
reliance.
