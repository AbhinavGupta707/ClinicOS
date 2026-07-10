# Workflow Package

Temporal workflow and activity contracts for durable clinic operations.

Checkpoint 1 includes a production-style approval/timer workflow for future action proposals,
recalls, reminders, migration commits, and other human-in-the-loop processes.

Checkpoint 13 adds durable clinic-day workflows for bounded continuity/SOP generation,
patient-instruction send requests, and provider payment-request recovery. The package contains
workflow-safe contracts and typed activity boundaries only. PostgreSQL, clinic APIs, provider
SDKs, credentials, and other side effects belong in injected activity implementations.

Rules captured in this package:

- workflow state stores tenant/clinic/domain references, not PHI-heavy payloads,
- workflow code imports only Temporal workflow-safe APIs plus pure state helpers,
- side effects are activities behind typed ports,
- approval, timeout, cancellation, retries, and action execution are explicit states,
- Temporal workers use the `clinic-os-default` task queue locally unless overridden.

## CP13 Durable Clinic-Day Contracts

### Due generation

`durableContinuityDueGenerationWorkflow` and `durableSopDueGenerationWorkflow` freeze `asOf`,
tenant, clinic, originating user, batch size, and the initial signed cursor when the workflow
starts. A batch is limited to 25 candidates. The cursor remains opaque workflow data: workflow code
passes it to an activity and never decodes or rewrites it.

Each activity result reports processed/created/skipped counts, completion, the next opaque cursor,
and durable evidence identity. An incomplete batch must process at least one candidate and advance
to a different non-empty cursor. Otherwise the workflow fails closed with
`DUE_GENERATION_NO_PROGRESS`. Workflow history continues as new every 20 batches while cumulative
progress remains queryable through `cp13.due_generation.progress`.

### Patient-instruction send request

`durablePatientInstructionSendRequestWorkflow` carries only tenant, clinic, originating user,
patient, instruction, event, correlation, and idempotency identities. Provider submission happens only in
`requestPatientInstructionSend`. Its terminal result is `requested` or `failed`; it has no
delivered/read fields. `recordPatientInstructionSendTerminal` persists the request/failure
evidence separately.

### Payment-request recovery

`durablePaymentRequestRecoveryWorkflow` starts only from a pre-existing durable intent ID and
canonical SHA-256 intent digest. It calls, in order:

1. `claimPaymentRequestIntent` to load and claim authoritative intent state;
2. `createOrRecoverProviderPaymentRequest` for official provider I/O;
3. `finalizeOrReconcilePaymentRequestIntent` to persist requested, failed, or reconciliation truth.

The workflow never marks an invoice paid. Payment-link and invoice-QR artifacts are distinct typed
results. Scope/digest/provider/artifact mismatch and ambiguous provider recovery reconcile or fail
closed.

The claim activity returns the digest-bound original provider request: request kind, amount in minor
units, currency, nullable description/expiry/customer, and bounded metadata. The workflow validates
that snapshot and passes it unchanged to provider recovery. It never reconstructs provider input
from a later invoice read, and the outbox payload cannot supply these fields. Metadata rejects
authority fields, prototype keys, and provider credential/secret fields.

All three workflow families use Temporal `patched` version markers and bounded activity retry
policies. Incompatible future changes must add a new marker and preserve replay behavior for the
existing marker before deprecating it.

## CP13 Outbox Start Events

The worker composition registers only action/request events that can legitimately start work:

- `workflow.cp13.continuity_due_generation.requested`
- `workflow.cp13.sop_due_generation.requested`
- `instruction.send_requested`
- `workflow.cp13.payment_request_recovery.requested`

It deliberately does not register `task.due`, `sop_run.created`, or `payment.requested`. Those are
observations of work already performed and must not be treated as commands. The payment recovery
request event must be written atomically with the future durable intent; the current observational
`payment.requested` event is not a substitute.

Starter payloads contain only operation-specific fields. Workflow schema, tenant, clinic,
originating user, outbox event ID, correlation, idempotency key, and requested time derive from the
persisted outbox envelope; workflow implementation version comes from the trusted worker contract.
CP13 handlers require a trusted `user` actor and reject payload authority fields, so a producer does
not need or receive the database-generated outbox row ID.

Data/Auth integration supplies persistent workflow/evidence ports. CP13 additionally requires
transaction-bound adapters for due-generation batches, patient-instruction request evidence, and
payment intent claim/provider recovery/finalization. No adapter may infer tenant or clinic from
activity payload content without verifying the persisted scoped record.

## Data/Auth Contract

Activities require ports for:

- recording workflow start/waiting/terminal states,
- creating an approval task visible to the future action proposal/admin surface,
- executing an approved action idempotently.

Those ports should write audit/domain events with the same tenant, clinic, correlation ID, and
idempotency key carried by the workflow input. They should not persist PHI-heavy payloads in
Temporal workflow state.
