import assert from "node:assert/strict";
import test from "node:test";
import { createRepositoryPortTransactionLease } from "../src/modules/core/scoped-repository-port.ts";
import { bindClinicOperationsRepository } from "../src/modules/clinic-operations/index.ts";
import { bindPatientAdministrationRepository } from "../src/modules/patient-administration/index.ts";
import { bindSchedulingRepository } from "../src/modules/scheduling/index.ts";
import type { ClinicOperationsRepository, RepositoryScope } from "../src/repositories.ts";

const scope = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000002",
  actorUserId: "10000000-0000-4000-8000-000000000003"
} as RepositoryScope;

test("front-office ports bind verified scope and do not accept caller authority", async () => {
  const observed: Array<{ operation: string; scope: RepositoryScope; input: unknown }> = [];
  const repositoryTarget = {
    listPatients: async (boundScope: RepositoryScope, input: unknown) => {
      observed.push({ operation: "listPatients", scope: boundScope, input });
      return [];
    },
    listAppointments: async (boundScope: RepositoryScope, input: unknown) => {
      observed.push({ operation: "listAppointments", scope: boundScope, input });
      return [];
    },
    loadDashboardData: async (boundScope: RepositoryScope, date: string) => {
      observed.push({ operation: "loadDashboardData", scope: boundScope, input: date });
      return { appointments: [], leads: [], tasks: [], queue: [], returningPatientIds: new Set() };
    }
  };
  const repository = new Proxy(repositoryTarget, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return async () => null;
    }
  }) as unknown as ClinicOperationsRepository;
  const lease = createRepositoryPortTransactionLease();
  const patients = bindPatientAdministrationRepository(repository, scope, lease);
  const scheduling = bindSchedulingRepository(repository, scope, lease);
  const clinicOperations = bindClinicOperationsRepository(repository, scope, lease);

  await patients.listPatients({ query: "Synthetic" });
  await scheduling.listAppointments({ date: "2026-07-11" });
  await clinicOperations.loadDashboardData("2026-07-11");

  assert.deepEqual(
    observed.map((item) => item.scope),
    [scope, scope, scope]
  );
  assert.deepEqual(
    observed.map((item) => item.input),
    [{ query: "Synthetic" }, { date: "2026-07-11" }, "2026-07-11"]
  );
  await lease.close();
  assert.throws(() => patients.listPatients(), /no longer inside its active unit of work/);
});

test("transaction-bound repository operations are serialized on one SQL client", async () => {
  const lease = createRepositoryPortTransactionLease();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = lease.execute(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return 1;
  });
  const second = lease.execute(async () => {
    events.push("second:start");
    events.push("second:end");
    return 2;
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  await lease.close();
});
