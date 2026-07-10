import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { UUID } from "@clinic-os/domain";
import {
  DueGenerationInputError,
  PostgresClinicOperationsRepository,
  type SqlConnectionFactory,
  type SqlQueryResult
} from "../src/index.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const SCOPE = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  actorUserId: "10000000-0000-4000-8000-000000001001"
}) satisfies Readonly<RepositoryScope>;
const FIRST_SCHEDULE = "13000000-0000-4000-8000-000000000101" as UUID;
const SECOND_SCHEDULE = "13000000-0000-4000-8000-000000000102" as UUID;
const TEMPLATE = "13000000-0000-4000-8000-000000000103" as UUID;
const AS_OF = "2026-07-10T12:00:00.000Z";
const SNAPSHOT = new Date("2026-07-10T11:00:00.000Z");
const POSTGRES_SOURCE = readFileSync(new URL("../src/postgres.ts", import.meta.url), "utf8");
const MIGRATION = readFileSync(
  new URL("../migrations/0016_cp13_bounded_due_generation.sql", import.meta.url),
  "utf8"
);

test("CP13 SOP due generation scans a bounded snapshot page and resumes from its opaque cursor", async () => {
  const client = new SopSchedulePageClient();
  const repository = new PostgresClinicOperationsRepository(client, {
    clock: { now: () => new Date(SNAPSHOT) }
  });

  const first = await repository.generateDueSopRuns(SCOPE, {
    asOf: AS_OF,
    batchSize: 1
  });
  assert.deepEqual(first.runsCreated, []);
  assert.equal(first.processedCount, 1);
  assert.equal(first.complete, false);
  assert.ok(first.nextCursor);

  const second = await repository.generateDueSopRuns(SCOPE, {
    asOf: AS_OF,
    batchSize: 1,
    cursor: first.nextCursor
  });
  assert.deepEqual(second.runsCreated, []);
  assert.equal(second.processedCount, 1);
  assert.equal(second.complete, false);
  assert.ok(second.nextCursor);

  const third = await repository.generateDueSopRuns(SCOPE, {
    asOf: AS_OF,
    batchSize: 1,
    cursor: second.nextCursor
  });
  assert.equal(third.processedCount, 0);
  assert.equal(third.complete, true);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(client.schedulePositions, [null, FIRST_SCHEDULE, SECOND_SCHEDULE]);
});

test("CP13 due generation rejects oversized batches and cross-pass cursor reuse", async () => {
  const repository = new PostgresClinicOperationsRepository(new SopSchedulePageClient(), {
    clock: { now: () => new Date(SNAPSHOT) }
  });
  await assert.rejects(
    repository.generateDueSopRuns(SCOPE, { asOf: AS_OF, batchSize: 26 }),
    (error) => error instanceof DueGenerationInputError
  );

  const first = await repository.generateDueSopRuns(SCOPE, { asOf: AS_OF, batchSize: 1 });
  assert.ok(first.nextCursor);
  await assert.rejects(
    repository.generateDueSopRuns(SCOPE, {
      asOf: "2026-07-11T12:00:00.000Z",
      cursor: first.nextCursor
    }),
    (error) => error instanceof DueGenerationInputError && /same asOf instant/u.test(error.message)
  );
  await assert.rejects(
    repository.generateDueContinuityTasks(SCOPE, {
      asOf: AS_OF,
      cursor: first.nextCursor
    }),
    (error) =>
      error instanceof DueGenerationInputError && /wrong type or version/u.test(error.message)
  );
});

test("CP13 SOP catch-up resumes within one schedule and preserves clinic-local due time", async () => {
  const client = new SopCatchUpClient();
  const repository = new PostgresClinicOperationsRepository(client, {
    clock: { now: () => new Date(SNAPSHOT) }
  });

  const first = await repository.generateDueSopRuns(SCOPE, { asOf: AS_OF, batchSize: 2 });
  assert.equal(first.processedCount, 2);
  assert.equal(first.runsCreated.length, 2);
  assert.equal(first.complete, false);
  assert.ok(first.nextCursor);

  const second = await repository.generateDueSopRuns(SCOPE, {
    asOf: AS_OF,
    batchSize: 2,
    cursor: first.nextCursor
  });
  assert.equal(second.processedCount, 1);
  assert.equal(second.runsCreated.length, 1);
  assert.equal(second.complete, true);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(client.generatedDueInstants, [
    "2026-07-08T03:30:00.000Z",
    "2026-07-09T03:30:00.000Z",
    "2026-07-10T03:30:00.000Z"
  ]);
});

test("CP13 continuity SQL and migration enforce bounded keyset pages and checkout idempotency", () => {
  assert.match(
    POSTGRES_SOURCE,
    /anchor = 'procedure_completed'[\s\S]*order by recall_rules\.id, procedure_performed_records\.id[\s\S]*limit \$7/u
  );
  assert.match(
    POSTGRES_SOURCE,
    /anchor = 'checkout_completed'[\s\S]*order by recall_rules\.id, invoices\.id[\s\S]*limit \$7/u
  );
  assert.match(
    POSTGRES_SOURCE,
    /created_at <= \$4[\s\S]*\(\$5::uuid is null or id > \$5\)[\s\S]*limit \$6/u
  );
  assert.match(
    MIGRATION,
    /create unique index if not exists recalls_generated_invoice_unique_idx[\s\S]*source_invoice_id is not null/u
  );
  assert.match(
    POSTGRES_SOURCE,
    /returning \*, \(xmax = 0\) as was_inserted/u,
    "task retries must distinguish the inserted row from the conflict row"
  );
});

class SopSchedulePageClient implements SqlConnectionFactory {
  readonly inTransaction = true;
  readonly schedulePositions: Array<UUID | null> = [];

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.replace(/\s+/gu, " ").trim().toLowerCase();
    if (/set_config\('/u.test(sql)) return { rows: [] };
    if (/from sop_schedules/u.test(sql)) {
      const position = (values[3] ?? null) as UUID | null;
      const continueCurrent = values[4] === true;
      this.schedulePositions.push(position);
      const records =
        continueCurrent && position
          ? [scheduleRow(position)]
          : position === null
            ? [scheduleRow(FIRST_SCHEDULE)]
            : position === FIRST_SCHEDULE
              ? [scheduleRow(SECOND_SCHEDULE)]
              : [];
      return { rows: records as TResult[] };
    }
    throw new Error(`Unexpected CP13 due-generation SQL: ${sql}`);
  }
}

class SopCatchUpClient implements SqlConnectionFactory {
  readonly inTransaction = true;
  readonly generatedDueInstants: string[] = [];
  readonly #runs = new Map<UUID, Record<string, unknown>>();

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.replace(/\s+/gu, " ").trim().toLowerCase();
    if (/set_config\('/u.test(sql)) return { rows: [] };
    if (/from sop_schedules/u.test(sql)) {
      const position = (values[3] ?? null) as UUID | null;
      const continueCurrent = values[4] === true;
      if (position === null || (continueCurrent && position === FIRST_SCHEDULE)) {
        const latestDueAt = [...this.#runs.values()].at(-1)?.due_at ?? null;
        return {
          rows: [
            {
              ...scheduleRow(FIRST_SCHEDULE),
              starts_on: "2026-07-08",
              latest_due_at: latestDueAt
            } as TResult
          ]
        };
      }
      return { rows: [] };
    }
    if (/insert into sop_runs/u.test(sql)) {
      const runId =
        `13000000-0000-4000-8000-${String(this.#runs.size + 201).padStart(12, "0")}` as UUID;
      const dueAt = String(values[4]);
      this.generatedDueInstants.push(dueAt);
      const row = sopRunRow(runId, dueAt, String(values[6]));
      this.#runs.set(runId, row);
      return { rows: [row as TResult] };
    }
    if (/from sop_template_items/u.test(sql) || /from sop_run_items/u.test(sql)) {
      return { rows: [] };
    }
    if (/insert into tasks/u.test(sql)) {
      return { rows: [{ ...taskRow(String(values[20])), was_inserted: true } as TResult] };
    }
    if (/update sop_runs/u.test(sql)) {
      const run = this.#runs.get(String(values[2]) as UUID);
      if (run) run.task_id = values[3];
      return { rows: [] };
    }
    if (/from sop_runs/u.test(sql)) {
      const run = this.#runs.get(String(values[2]) as UUID);
      return { rows: run ? [run as TResult] : [] };
    }
    throw new Error(`Unexpected CP13 SOP catch-up SQL: ${sql}`);
  }
}

function scheduleRow(id: UUID) {
  return {
    id,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    template_id: TEMPLATE,
    title: "Future synthetic SOP",
    status: "active",
    recurrence_type: "daily",
    interval_days: null,
    day_of_week: null,
    day_of_month: null,
    due_time: "09:00:00",
    timezone: "Asia/Kolkata",
    starts_on: "2027-01-01",
    ends_on: null,
    assigned_to_user_id: null,
    default_task_priority: "normal",
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    latest_due_at: null
  };
}

function sopRunRow(id: UUID, dueAt: string, generatedFromKey: string) {
  return {
    id,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    row_version: 1,
    template_id: TEMPLATE,
    schedule_id: FIRST_SCHEDULE,
    task_id: null,
    due_at: dueAt,
    status: "due",
    assigned_to_user_id: null,
    started_by_user_id: null,
    started_at: null,
    completed_by_user_id: null,
    completed_at: null,
    completion_evidence: {},
    generated_from_key: generatedFromKey,
    created_at: SNAPSHOT.toISOString(),
    updated_at: SNAPSHOT.toISOString()
  };
}

function taskRow(idempotencyKey: string) {
  return {
    id: "13000000-0000-4000-8000-000000000301" as UUID,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    row_version: 1,
    patient_id: null,
    lead_id: null,
    appointment_id: null,
    invoice_id: null,
    encounter_id: null,
    treatment_plan_id: null,
    procedure_performed_id: null,
    task_type: "sop",
    source_workflow: "sop_run",
    source_record_type: "sop_run",
    source_record_id: null,
    title: "Future synthetic SOP",
    description: "Recurring SOP checklist run.",
    priority: "normal",
    status: "open",
    due_at: null,
    assigned_to_user_id: null,
    assigned_by_user_id: null,
    completed_by_user_id: null,
    completed_at: null,
    completion_evidence: {},
    cancelled_reason: null,
    idempotency_key: idempotencyKey,
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId,
    status_changed_at: SNAPSHOT.toISOString(),
    created_at: SNAPSHOT.toISOString(),
    updated_at: SNAPSHOT.toISOString()
  };
}
