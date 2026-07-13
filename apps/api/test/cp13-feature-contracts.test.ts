import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { ACTIVE_NATIVE_HTTP_OPERATIONS } from "@clinic-os/api-contracts";
import type {
  ClinicOperationsRepository,
  ClinicModuleTransactionContext,
  ScopedApiRequestGuardsPort
} from "@clinic-os/db";
import { FixedClock, type UUID } from "@clinic-os/domain";
import type { ClinicFeatureOperationHandler } from "../src/features/contracts.ts";
import {
  ALL_CP13_CLINIC_DAY_OPERATION_IDS,
  ALL_CP13_CLINIC_FEATURE_OPERATION_IDS,
  CP13_CLINIC_DAY_OPERATION_OWNERS,
  CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS,
  CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS
} from "../src/features/cp13-operation-ownership.ts";
import { runClinicFeatureOperation } from "../src/features/runtime.ts";

test("CP13 clinic-day ownership covers CP2-CP6 exactly once", () => {
  const expected = ACTIVE_NATIVE_HTTP_OPERATIONS.filter((operation) =>
    ["CP2", "CP3", "CP4", "CP5", "CP6"].includes(operation.checkpoint)
  ).map((operation) => operation.operationId);
  const owned = Object.values(CP13_CLINIC_DAY_OPERATION_OWNERS).flat();

  assert.equal(owned.length, 93);
  assert.equal(new Set(owned).size, owned.length);
  assert.deepEqual([...owned].sort(), [...expected].sort());
  assert.deepEqual([...ALL_CP13_CLINIC_DAY_OPERATION_IDS].sort(), [...expected].sort());
});

test("CP13 ownership keeps shared compatibility files out of worker path design", () => {
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.frontOffice.length, 26);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.clinicalDental.length, 22);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.treatmentBilling.length, 11);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.continuityOperations.length, 34);
  assert.deepEqual(CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS, []);
  assert.equal(CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS.length, 11);
  assert.equal(ALL_CP13_CLINIC_FEATURE_OPERATION_IDS.length, 93);
  assert.equal(new Set(ALL_CP13_CLINIC_FEATURE_OPERATION_IDS).size, 93);
  assert.equal(
    ALL_CP13_CLINIC_FEATURE_OPERATION_IDS.includes("receiveRazorpayPaymentWebhook" as never),
    false
  );
});

test("CP13 feature runtime binds verified scope and closes every module port", async () => {
  const calls: Array<{ scope: unknown; operation: PropertyKey }> = [];
  const repository = new Proxy(Object.create(null) as ClinicOperationsRepository, {
    get(_target, operation) {
      return async (scope: unknown) => {
        calls.push({ scope, operation });
        return [];
      };
    }
  });
  const requestGuards = {
    idempotency: {
      claim: async () => ({ outcome: "expired" as const }),
      complete: async () => ({ outcome: "missing" as const })
    },
    optimisticConcurrency: {
      readCurrentVersion: async () => ({ outcome: "not_found" as const }),
      advanceVersion: async () => ({ outcome: "not_found" as const })
    }
  } as ScopedApiRequestGuardsPort;
  let captured: ClinicModuleTransactionContext | undefined;
  const handler: ClinicFeatureOperationHandler = async (request, context) => {
    captured = context;
    assert.equal(request.operationId, "listPatients");
    assert.equal(request.metadata.ipAddress, "127.0.0.1");
    assert.equal(request.metadata.userAgent, "ClinicOSagent");
    await context.repositories.patientAdministration.listPatients({});
    return { status: 200, body: { patients: [] } };
  };
  const tenantId = "11111111-1111-4111-8111-111111111111" as UUID;
  const clinicId = "22222222-2222-4222-8222-222222222222" as UUID;
  const userId = "33333333-3333-4333-8333-333333333333" as UUID;

  const result = await runClinicFeatureOperation({
    operationId: "listPatients",
    handler,
    request: {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "user-agent": "ClinicOS\u0000agent" }
    } as IncomingMessage,
    requestId: "cp13-request",
    access: {
      context: {
        tenant: { id: tenantId },
        user: { id: userId }
      },
      clinicId
    } as never,
    parsedRequest: { path: {}, query: {}, headers: {} },
    receivedAt: new Date("2026-07-10T10:00:00.000Z"),
    transaction: {
      repository,
      auditSink: { appendAuditEvent: async () => undefined },
      requestGuards
    },
    clock: new FixedClock("2026-07-10T10:00:00.000Z")
  });

  assert.equal(result.status, 200);
  assert.deepEqual(calls, [
    {
      operation: "listPatients",
      scope: { tenantId, clinicId, actorUserId: userId }
    }
  ]);
  assert.ok(captured);
  assert.throws(
    () => captured?.repositories.patientAdministration.listPatients({}),
    /no longer inside its active unit of work/u
  );
});
