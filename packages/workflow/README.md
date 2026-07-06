# Workflow Package

Temporal workflow and activity contracts for durable clinic operations.

Checkpoint 1 includes a production-style approval/timer workflow for future action proposals,
recalls, reminders, migration commits, and other human-in-the-loop processes.

Rules captured in this package:

- workflow state stores tenant/clinic/domain references, not PHI-heavy payloads,
- workflow code imports only Temporal workflow-safe APIs plus pure state helpers,
- side effects are activities behind typed ports,
- approval, timeout, cancellation, retries, and action execution are explicit states,
- Temporal workers use the `clinic-os-default` task queue locally unless overridden.

Data/Auth integration still needs persistent tables for workflow runs, approval tasks, and audit
events. This package defines the activity contracts those repositories must satisfy.

## Data/Auth Contract

Activities require ports for:

- recording workflow start/waiting/terminal states,
- creating an approval task visible to the future action proposal/admin surface,
- executing an approved action idempotently.

Those ports should write audit/domain events with the same tenant, clinic, correlation ID, and
idempotency key carried by the workflow input. They should not persist PHI-heavy payloads in
Temporal workflow state.
