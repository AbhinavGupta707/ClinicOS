# Worker App

Owner: platform/runtime workstream.

The worker app owns the Checkpoint 1 runtime foundation:

- outbox polling and idempotent handler dispatch,
- attempt recording for every event processing try,
- exponential retry scheduling for transient failures,
- dead-letter creation for permanent or exhausted failures,
- Temporal client wiring for durable workflow starts,
- worker liveness/readiness health surfaces.

## Runtime Commands

```sh
npm run build --workspace apps/worker
npm run test --workspace apps/worker
npm run dev --workspace apps/worker
```

`npm run dev` expects the Data/Auth lane tables and local Temporal to exist. It starts:

- `GET /health/live`
- `GET /health/ready`
- the outbox polling loop

## Environment

Required:

- `DATABASE_URL`

Optional:

- `TEMPORAL_ADDRESS`, default omitted. When set, the worker registers the
  `workflow.approval.requested` handler and starts Temporal workflows.
- `TEMPORAL_NAMESPACE`, default `default`.
- `TEMPORAL_TASK_QUEUE`, default `clinic-os-default`.
- `WORKER_HEALTH_PORT`, default `8082`.
- `OUTBOX_BATCH_SIZE`, default `25`.
- `OUTBOX_POLL_INTERVAL_MS`, default `1000`.
- `OUTBOX_MAX_ATTEMPTS`, default `8`.

## Data/Auth Table Contract

This lane intentionally does not edit database migrations. The Postgres repository expects these
tables and columns:

### `outbox_events`

- `event_id uuid primary key`
- `event_type text not null`
- `schema_version text not null`
- `tenant_id uuid not null`
- `clinic_id uuid not null`
- `aggregate_type text not null`
- `aggregate_id text not null`
- `actor jsonb not null`
- `correlation_id text not null`
- `idempotency_key text not null`
- `source jsonb`
- `payload jsonb not null`
- `occurred_at timestamptz not null`
- `status text not null`
- `attempt_count int not null default 0`
- `next_attempt_at timestamptz`
- `locked_by text`
- `locked_until timestamptz`
- `processed_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Recommended indexes:

- `(status, next_attempt_at, occurred_at)`
- `(tenant_id, clinic_id, event_type)`
- unique `(idempotency_key)` where product semantics require one event per idempotent action

### `outbox_attempts`

- `attempt_id uuid primary key`
- `event_id uuid not null references outbox_events(event_id)`
- `attempt_number int not null`
- `worker_id text not null`
- `status text not null`
- `started_at timestamptz not null`
- `finished_at timestamptz`
- `error_code text`
- `error_message text`
- `next_attempt_at timestamptz`

Recommended index:

- `(event_id, attempt_number)`

### `dead_letter_events`

- `dead_letter_id uuid primary key`
- `event_id uuid not null unique references outbox_events(event_id)`
- `event_type text not null`
- `tenant_id uuid not null`
- `clinic_id uuid not null`
- `aggregate_type text not null`
- `aggregate_id text not null`
- `correlation_id text not null`
- `idempotency_key text not null`
- `failed_attempt_id uuid not null`
- `failed_at timestamptz not null`
- `failure_code text not null`
- `failure_message text not null`
- `review_status text not null default 'unreviewed'`
- `event jsonb not null`

Dead letters are reviewable records, not discarded failures. Later admin tooling can replay,
ignore, or investigate these rows without changing the processing contract.

## Canonical Event For Sample Temporal Workflow

`workflow.approval.requested` starts the durable approval/timer workflow. Its payload must be an
`ApprovalWorkflowInput` from `@clinic-os/workflow`, either directly or under a top-level
`workflow` key. The outbox envelope tenant/clinic must match the workflow input tenant/clinic.

Reserved root command: `npm run dev:worker`.
