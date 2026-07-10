# CP13 Wave 2 — Durable Workflow, Replay and Reconciliation

## Lane identity and scope

- Frozen integration revision: `a01e8f453bcaea1b973ef43f6f594cfcf66965be`.
- Start state: clean detached Codex worktree at that exact revision.
- Owned implementation: `packages/workflow/src/**`, workflow package README/tests, lane-named CP13
  worker handlers/composition/tests, exact worker barrel exports, and this evidence file.
- External actions: none. The lane used no credentials, live provider, cloud, dashboard, real PHI,
  or live Temporal server.

This is deterministic contract and local automation evidence. It does not claim a live Temporal
execution, PostgreSQL adapter, worker restart, provider recovery, or checkpoint-wide E3 result.

## Implemented workflow contracts

### Continuity and SOP due generation

- Separate Temporal workflow exports share one typed due-generation state machine.
- Tenant, clinic, trusted originating user, event, correlation, idempotency, frozen `asOf`,
  generation kind, and batch size are part of the workflow input. Scope/user/domain identity form
  the deterministic workflow ID.
- Batch size is a positive integer no larger than 25 in both worker event validation and workflow
  state validation.
- Signed cursors are opaque activity data. Workflow code compares only null/empty/equality for the
  no-progress guard; it never parses, signs, decodes, or derives authority from a cursor.
- Every batch has bounded retry policy and must return processed/created/skipped counts, completion,
  next cursor, and evidence ID.
- Incomplete zero-progress, absent-cursor, or unchanged-cursor results fail closed. Invalid activity
  result shapes also terminate as failed rather than loop.
- History continues as new every 20 batches with cumulative counts and cursor carried forward.
- `cp13.due_generation.progress` reports kind, scope, frozen time, cursor, counts, continuation
  count, status, and safe failure code.
- Terminal completed/failed results are passed to a typed evidence activity.

### Patient-instruction send request

- The existing actionable `instruction.send_requested` event starts one workflow per exact
  tenant/clinic/patient/instruction identity.
- The handler requires `whatsapp`, `send_requested`, false provider confirmation, and null provider
  delivery/delivered/read evidence. Print-ready or delivery/read-authoritative payloads fail
  permanently before Temporal start.
- Provider work exists only behind `requestPatientInstructionSend`; Temporal retries transient
  activity failure and treats explicit permanent activity failure as non-retryable.
- The durable result is only `requested` or `failed`. It has no delivered/read projection.
- `recordPatientInstructionSendTerminal` is the explicit evidence activity.

### Provider payment-request recovery

- A new action event, `workflow.cp13.payment_request_recovery.requested`, requires a pre-existing
  durable intent ID, exact tenant/clinic/patient/invoice identity, canonical lowercase SHA-256 intent
  digest, pending intent state, and payment-link versus invoice-QR request kind.
- The workflow calls typed claim/load, provider create-or-recover, and finalize/reconcile activities.
  It imports no API, DB, or provider package.
- The claim result carries the exact digest-bound original provider request: request kind, amount,
  currency, nullable description/expiry/customer, and bounded metadata. Workflow validation rejects
  unsafe authority/secret metadata and passes the canonical claim snapshot to provider recovery
  without reconstructing it from a later invoice.
- Claim results and final results must match the full expected scope, intent identity, digest, and
  request kind.
- Payment-link artifacts require usable HTTPS URLs. Invoice-QR artifacts require a non-empty QR
  string or usable HTTPS QR image URL. Kind/provider/scope/digest mismatch and ambiguous recovery
  reconcile or fail closed.
- Terminal states are `requested`, `reconciliation_required`, or `failed`; `paid` is not a workflow
  state and cannot be returned by the typed contract.

For due and payment starters, payloads contain operation-specific fields only. Workflow schema,
tenant, clinic, originating user, database-generated event ID, correlation, idempotency key, and
requested time derive exclusively from the persisted outbox envelope; workflow implementation
version comes from the trusted worker contract. The handlers require a trusted `user` actor and
reject payload authority keys or wrapper siblings.

## Outbox and composition behavior

The CP13 composition helper returns the existing approval handler plus exactly these CP13 starters:

1. `workflow.cp13.continuity_due_generation.requested`;
2. `workflow.cp13.sop_due_generation.requested`;
3. `instruction.send_requested`;
4. `workflow.cp13.payment_request_recovery.requested`.

Every start uses a deterministic scoped workflow ID and `REJECT_DUPLICATE`. Temporal
`WorkflowExecutionAlreadyStartedError` is an idempotent replay success. Invalid payload/scope is a
permanent outbox failure; other Temporal start errors remain transient for the existing bounded
outbox retry/dead-letter path.

`task.due`, `sop_run.created`, and current `payment.requested` are deliberately not registered.
They are observational results, not commands, and registering them would pretend already-performed
work initiated a durable side effect.

## Deterministic verification

Focused verification after implementation:

| Command                                             | Result                                                                            |              Skips |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | -----------------: |
| `npm --workspace @clinic-os/workflow run typecheck` | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/workflow run build`     | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/workflow run lint`      | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/workflow test`          | Pass, 10/10; includes deterministic Temporal bundle construction without a server |                  0 |
| `npm --workspace @clinic-os/worker run typecheck`   | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/worker run build`       | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/worker run lint`        | Pass                                                                              |                  0 |
| `npm --workspace @clinic-os/worker test`            | Pass, 12/12 including existing outbox regression tests                            |                  0 |
| `npm run test`                                      | Pass across all workspaces; API 102/102 runnable tests pass                       | 17 API socket-only |
| workspace/clock/env/root format checks              | Pass; 16 contiguous migrations and clock/env guards clean                         |                  0 |
| exact lane Prettier check                           | Pass                                                                              |                  0 |
| `npm run security:secrets`                          | Pass for tracked and untracked release scope                                      |                  0 |
| `git diff --check`                                  | Pass                                                                              |                  0 |

The root-wide `npm run typecheck`, `npm run lint`, and `npm run build` were also attempted with the
isolated worktree's temporary read-only dependency links. Lane workspaces passed, but the aggregate
commands could not be claimed: API branded UUID types resolved simultaneously from the primary
checkout and this worktree; web picked up the primary checkout's newer TypeScript/ESLint toolchain,
which rejected its existing `baseUrl`, `next/core-web-vitals`, and CSS side-effect import setup.
These are dependency-resolution environment failures outside this lane, not CP13 workflow errors.
The temporary links are removed before commit. Master must rerun aggregate typecheck/lint/build after
normal integration dependency reconciliation.

## Exact master integration requirements

1. Extend the canonical event taxonomy and atomic evidence repository for
   `workflow.cp13.continuity_due_generation.requested`,
   `workflow.cp13.sop_due_generation.requested`, and
   `workflow.cp13.payment_request_recovery.requested`. Do not reuse observational `task.due`,
   `sop_run.created`, or `payment.requested`.
2. Add an authorized clinic-day scheduler/control transaction that writes continuity and SOP request
   events with operation-only payloads: generation kind, frozen `asOf`, batch size no larger than
   25, and null/opaque initial cursor. The outbox envelope must carry the authoritative tenant,
   clinic, user actor, correlation, idempotency, and occurrence time; the database-generated event
   ID is derived by the handler after claim and is never self-referenced by the producer.
3. Reconcile a canonical durable payment-intent migration/port. Claim the intent and write the
   recovery request event in the same transaction before provider I/O. The current treatment lane
   calls its provider synchronously and emits `payment.requested` afterward; that path must not be
   wired to the recovery handler or represented as crash-safe recovery.
4. Implement `Cp13ActivityPorts` against transaction-bound tenant/clinic adapters:
   - map continuity and SOP repository results to bounded batch/evidence results;
   - load and verify instruction state before official provider submission, then persist request-only
     terminal evidence without delivery/read claims;
   - atomically claim/load payment intents, use official provider create/recover idempotency, and
     return the digest-bound original request fields (kind, amount, currency, description, expiry,
     customer, bounded metadata) before provider I/O;
   - finalize requested/failed/reconciliation evidence while never marking paid.
5. Update master-owned `apps/worker/src/main.ts` to build `createCp13WorkerComposition`, use its
   complete handler list (which preserves approval), pass its complete activity map to
   `createClinicTemporalWorker`, run the Temporal worker alongside the outbox processor, and include
   Temporal shutdown in the existing signal-safe lifecycle. Keep the runtime honestly unavailable
   when required adapters are not configured.
6. Run live local E3 with the canonical Postgres adapters and Temporal: crash after domain/outbox
   commit, duplicate delivery, activity retry/exhaustion, worker/Temporal restart, workflow
   replay/version marker, continue-as-new, stale outbox lease, dead letter, and domain/audit/outbox/
   workflow reconciliation. This lane's deterministic bundle test is not that live evidence.
