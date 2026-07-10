import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { UUID } from "@clinic-os/domain";
import {
  PostgresClinicOperationsRepository,
  createPostgresClinicModuleUnitOfWork,
  type SqlConnectionFactory,
  type SqlQueryClient,
  type SqlQueryResult
} from "../src/index.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const SCOPE = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  actorUserId: "10000000-0000-4000-8000-000000001001"
}) satisfies Readonly<RepositoryScope>;
const PATIENT_ID = "10000000-0000-4000-8000-000000002001" as UUID;
const TASK_ID = "10000000-0000-4000-8000-000000003001" as UUID;
const RECALL_ID = "10000000-0000-4000-8000-000000004001" as UUID;
const POSTGRES_SOURCE = readFileSync(new URL("../src/postgres.ts", import.meta.url), "utf8");

const VERSIONED_ROW_MAPPERS = Object.freeze({
  PatientRow: { mapper: "mapPatientRow", table: "patients" },
  LeadRow: { mapper: "mapLeadRow", table: "leads" },
  AppointmentRow: { mapper: "mapAppointmentRow", table: "appointments" },
  QueueEntryRow: { mapper: "mapQueueEntryRow", table: "queue_entries" },
  EncounterRow: { mapper: "mapEncounterRow", table: "encounters" },
  DentalFindingRow: { mapper: "mapDentalFindingRow", table: "dental_findings" },
  TreatmentPlanRow: { mapper: "mapTreatmentPlanRow", table: "treatment_plans" },
  TaskRow: { mapper: "mapTaskRow", table: "tasks" },
  SopRunRow: { mapper: "mapSopRunRow", table: "sop_runs" },
  LabCaseRow: { mapper: "mapLabCaseRow", table: "lab_cases" },
  InventoryCheckRunRow: {
    mapper: "mapInventoryCheckRunRow",
    table: "inventory_check_runs"
  },
  CorrectiveActionRow: { mapper: "mapCorrectiveActionRow", table: "corrective_actions" }
});

test("CP12 all versioned Postgres record mappers use the strict row-version conversion", () => {
  for (const [rowName, { mapper }] of Object.entries(VERSIONED_ROW_MAPPERS)) {
    const rowBody = new RegExp(`interface ${rowName} \\{(?<body>[\\s\\S]*?)\\n\\}`, "u").exec(
      POSTGRES_SOURCE
    )?.groups?.body;
    const mapperBody = new RegExp(
      `function ${mapper}\\(row: ${rowName}\\)[^{]*\\{(?<body>[\\s\\S]*?)\\n\\}`,
      "u"
    ).exec(POSTGRES_SOURCE)?.groups?.body;

    assert.match(rowBody ?? "", /\n\s+row_version: number \| string;/u, rowName);
    assert.match(mapperBody ?? "", /rowVersion: positiveRowVersion\(row\.row_version\)/u, mapper);
  }
});

test("CP12 mapped versioned-table SQL uses full-row SELECT or RETURNING projections", () => {
  for (const [rowName, { table }] of Object.entries(VERSIONED_ROW_MAPPERS)) {
    const queryPattern = new RegExp(
      `client\\.query<${rowName}>\\(\\s*\\x60(?<sql>[\\s\\S]*?)\\x60`,
      "gu"
    );
    const queries = [...POSTGRES_SOURCE.matchAll(queryPattern)].map(
      (match) => match.groups?.sql ?? ""
    );
    assert.ok(queries.length > 0, `${rowName} must have typed SQL coverage`);

    for (const sql of queries.filter((candidate) =>
      new RegExp(`\\b${table}\\b`, "u").test(candidate)
    )) {
      if (/^\s*select\b/iu.test(sql)) {
        assert.match(
          sql,
          new RegExp(`select\\s+(?:distinct\\s+)?(?:${table}\\.)?\\*`, "iu"),
          `${rowName} mapped SELECT must include row_version through a full-row projection`
        );
      } else if (/^\s*(?:insert into|update)\b/iu.test(sql)) {
        assert.match(
          sql,
          /returning\s+\*/iu,
          `${rowName} mapped mutation must include row_version through RETURNING *`
        );
      }
    }
  }
});

test("CP12 row-version mapping accepts safe Postgres bigint text and rejects invalid values", async () => {
  const validRepository = new PostgresClinicOperationsRepository(new PatientProjectionClient("42"));
  const patient = await validRepository.findPatientById(SCOPE, PATIENT_ID);
  assert.equal(patient?.rowVersion, 42);

  for (const invalid of ["0", "01", "1.5", "9007199254740992", 0, -1, NaN, Infinity, undefined]) {
    const repository = new PostgresClinicOperationsRepository(new PatientProjectionClient(invalid));
    await assert.rejects(
      repository.findPatientById(SCOPE, PATIENT_ID),
      /Database row_version must be a positive safe integer/u,
      String(invalid)
    );
  }
});

test("CP12 recall action advances its indirect linked task version exactly once", async () => {
  const database = new RecallTaskDatabase();
  const unitOfWork = recallUnitOfWork(database);

  const first = await unitOfWork.run({ scope: SCOPE }, async ({ repositories }) => {
    const recall = await repositories.continuity.recordRecallAction(RECALL_ID, {
      actionType: "completed",
      evidence: { synthetic: true }
    });
    const task = await repositories.continuity.findTaskById(TASK_ID);
    return { recall, task };
  });
  assert.equal(first.recall?.status, "completed");
  assert.equal(first.task?.status, "done");
  assert.equal(first.task?.rowVersion, 2);

  const repeated = await unitOfWork.run({ scope: SCOPE }, async ({ repositories }) => {
    await repositories.continuity.recordRecallAction(RECALL_ID, {
      actionType: "completed",
      evidence: { synthetic: true }
    });
    return repositories.continuity.findTaskById(TASK_ID);
  });
  assert.equal(repeated?.rowVersion, 2, "an already-completed task must not double increment");
  assert.equal(database.taskVersionAdvances, 1);
  assert.ok(
    database.queries
      .filter((sql) => /update tasks/u.test(sql))
      .every(
        (sql) =>
          /row_version = row_version \+ 1/u.test(sql) &&
          /status <> 'done'/u.test(sql) &&
          /returning row_version/u.test(sql)
      )
  );
});

test("CP12 recall-linked task version advancement rolls back with repository failure", async () => {
  const database = new RecallTaskDatabase();
  const unitOfWork = recallUnitOfWork(database);
  const forcedRollback = new Error("CP12_RECALL_TASK_VERSION_ROLLBACK");

  await assert.rejects(
    unitOfWork.run({ scope: SCOPE }, async ({ repositories }) => {
      await repositories.continuity.recordRecallAction(RECALL_ID, {
        actionType: "completed",
        evidence: { synthetic: true }
      });
      const task = await repositories.continuity.findTaskById(TASK_ID);
      assert.equal(task?.rowVersion, 2);
      throw forcedRollback;
    }),
    (error) => error === forcedRollback
  );

  const persisted = await unitOfWork.run({ scope: SCOPE }, ({ repositories }) =>
    repositories.continuity.findTaskById(TASK_ID)
  );
  assert.equal(persisted?.status, "open");
  assert.equal(persisted?.rowVersion, 1);
  assert.equal(database.recall.status, "due");
  assert.equal(database.taskVersionAdvances, 0);
});

test("CP12 recall-linked task overflow fails validation and rolls the transaction back", async () => {
  const database = new RecallTaskDatabase();
  database.task = { ...database.task, row_version: Number.MAX_SAFE_INTEGER };
  const unitOfWork = recallUnitOfWork(database);

  await assert.rejects(
    unitOfWork.run({ scope: SCOPE }, ({ repositories }) =>
      repositories.continuity.recordRecallAction(RECALL_ID, {
        actionType: "completed",
        evidence: { synthetic: true }
      })
    ),
    /Database row_version must be a positive safe integer/u
  );

  assert.equal(database.task.status, "open");
  assert.equal(database.task.row_version, Number.MAX_SAFE_INTEGER);
  assert.equal(database.recall.status, "due");
  assert.equal(database.taskVersionAdvances, 0);
});

class PatientProjectionClient implements SqlConnectionFactory {
  readonly inTransaction = true;
  readonly #rowVersion: unknown;

  constructor(rowVersion: unknown) {
    this.#rowVersion = rowVersion;
  }

  async query<TResult = Record<string, unknown>>(rawSql: string): Promise<SqlQueryResult<TResult>> {
    const sql = normalizeSql(rawSql);
    if (/set_config\('/u.test(sql)) return { rows: [] };
    if (/select \* from patients/u.test(sql)) {
      return {
        rows: [
          {
            id: PATIENT_ID,
            tenant_id: SCOPE.tenantId,
            clinic_id: SCOPE.clinicId,
            row_version: this.#rowVersion,
            full_name: "CP12 Projection Synthetic",
            phone: "+919999000001",
            email: null,
            date_of_birth: null,
            gender: "unknown",
            abha_address: null,
            source: "manual",
            created_at: "2026-07-10T12:00:00.000Z",
            updated_at: "2026-07-10T12:00:00.000Z"
          } as TResult
        ]
      };
    }
    throw new Error(`Unexpected projection SQL: ${sql}`);
  }
}

function recallUnitOfWork(database: RecallTaskDatabase) {
  return createPostgresClinicModuleUnitOfWork<{ readonly scope: Readonly<RepositoryScope> }>({
    client: new RecallTaskPool(database),
    resolveScope: (context) => context.scope
  });
}

class RecallTaskDatabase {
  readonly queries: string[] = [];
  task = taskRow();
  recall = recallRow();
  taskVersionAdvances = 0;
}

class RecallTaskPool implements SqlConnectionFactory {
  readonly #database: RecallTaskDatabase;

  constructor(database: RecallTaskDatabase) {
    this.#database = database;
  }

  async connect(): Promise<SqlQueryClient> {
    return new RecallTaskClient(this.#database);
  }

  query<TResult = Record<string, unknown>>(): Promise<SqlQueryResult<TResult>> {
    throw new Error("Recall task tests require a checked-out transaction client.");
  }
}

class RecallTaskClient implements SqlQueryClient {
  readonly #database: RecallTaskDatabase;
  #snapshot:
    | {
        readonly task: ReturnType<typeof taskRow>;
        readonly recall: ReturnType<typeof recallRow>;
        readonly taskVersionAdvances: number;
      }
    | undefined;

  constructor(database: RecallTaskDatabase) {
    this.#database = database;
  }

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = normalizeSql(rawSql);
    this.#database.queries.push(sql);
    if (sql === "begin") {
      this.#snapshot = structuredClone({
        task: this.#database.task,
        recall: this.#database.recall,
        taskVersionAdvances: this.#database.taskVersionAdvances
      });
      return { rows: [] };
    }
    if (sql === "commit") {
      this.#snapshot = undefined;
      return { rows: [] };
    }
    if (sql === "rollback") {
      assert.ok(this.#snapshot);
      this.#database.task = this.#snapshot.task;
      this.#database.recall = this.#snapshot.recall;
      this.#database.taskVersionAdvances = this.#snapshot.taskVersionAdvances;
      this.#snapshot = undefined;
      return { rows: [] };
    }
    if (/set_config\('/u.test(sql)) return { rows: [] };
    if (/update recalls/u.test(sql)) {
      if (values[2] !== this.#database.recall.id) return { rows: [] };
      this.#database.recall = {
        ...this.#database.recall,
        status: values[3] as ReturnType<typeof recallRow>["status"],
        appointment_id: (values[4] as UUID | null) ?? this.#database.recall.appointment_id,
        action_evidence: JSON.parse(String(values[5])) as Record<string, unknown>,
        last_action_at: "2026-07-10T12:01:00.000Z",
        updated_by_user_id: values[6] as UUID,
        updated_at: "2026-07-10T12:01:00.000Z"
      };
      return { rows: [structuredClone(this.#database.recall) as TResult] };
    }
    if (/update tasks/u.test(sql)) {
      if (values[2] === this.#database.task.id && this.#database.task.status !== "done") {
        this.#database.task = {
          ...this.#database.task,
          status: "done",
          completed_by_user_id: values[3] as UUID,
          completed_at: "2026-07-10T12:01:00.000Z",
          completion_evidence: JSON.parse(String(values[4])) as Record<string, unknown>,
          updated_by_user_id: values[3] as UUID,
          status_changed_at: "2026-07-10T12:01:00.000Z",
          updated_at: "2026-07-10T12:01:00.000Z",
          row_version: Number(this.#database.task.row_version) + 1
        };
        this.#database.taskVersionAdvances += 1;
        return { rows: [{ row_version: this.#database.task.row_version } as TResult] };
      }
      return { rows: [] };
    }
    if (/select \* from tasks/u.test(sql)) {
      return values[2] === this.#database.task.id
        ? { rows: [structuredClone(this.#database.task) as TResult] }
        : { rows: [] };
    }
    throw new Error(`Unexpected recall-task SQL: ${sql}`);
  }

  release(): void {}
}

function taskRow() {
  return {
    id: TASK_ID,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    row_version: 1,
    patient_id: PATIENT_ID,
    lead_id: null,
    appointment_id: null,
    invoice_id: null,
    encounter_id: null,
    treatment_plan_id: null,
    procedure_performed_id: null,
    task_type: "recall" as const,
    source_workflow: "recall" as const,
    source_record_type: "recall",
    source_record_id: RECALL_ID,
    title: "CP12 recall follow-up",
    description: null,
    priority: "normal" as const,
    status: "open" as "done" | "open",
    due_at: "2026-07-10T12:00:00.000Z",
    assigned_to_user_id: null,
    assigned_by_user_id: null,
    completed_by_user_id: null as UUID | null,
    completed_at: null as string | null,
    completion_evidence: {} as Record<string, unknown>,
    cancelled_reason: null,
    idempotency_key: null,
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId as UUID | null,
    status_changed_at: "2026-07-10T12:00:00.000Z",
    created_at: "2026-07-10T12:00:00.000Z",
    updated_at: "2026-07-10T12:00:00.000Z"
  };
}

function recallRow() {
  return {
    id: RECALL_ID,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    recall_rule_id: "10000000-0000-4000-8000-000000005001" as UUID,
    patient_id: PATIENT_ID,
    source_procedure_performed_id: null,
    source_invoice_id: null,
    task_id: TASK_ID,
    appointment_id: null as UUID | null,
    status: "due" as "booked" | "completed" | "due" | "skipped",
    due_at: "2026-07-10T12:00:00.000Z",
    last_action_at: null as string | null,
    action_evidence: {} as Record<string, unknown>,
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId as UUID | null,
    created_at: "2026-07-10T12:00:00.000Z",
    updated_at: "2026-07-10T12:00:00.000Z"
  };
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/gu, " ");
}
