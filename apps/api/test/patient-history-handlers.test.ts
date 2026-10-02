import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@clinic-os/domain";
import { parseNativeOperationResponse } from "@clinic-os/api-contracts";
import { createWorkflowDiscoveryHandlers } from "../src/features/workflow-discovery.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
const patient = "10000000-0000-4000-8000-000000000001",
  snapshot = "10000000-0000-4000-8000-000000000002";
function setup(found = true, failAudit = false) {
  const audit: Record<string, unknown>[] = [];
  const reads: unknown[][] = [];
  const request = {
    operationId: "getPatientDentalSnapshot",
    access: { context: { tenant: { id: patient }, user: { id: patient } }, clinicId: patient },
    parsed: { path: { patientId: patient, snapshotId: snapshot }, query: {} },
    metadata: {
      requestId: "synthetic",
      ipAddress: null,
      userAgent: null,
      receivedAt: new Date("2026-01-01T10:00:00Z")
    }
  } as unknown as ClinicFeatureOperationRequest<"getPatientDentalSnapshot">;
  const context = {
    clock: new FixedClock("2026-01-01T10:00:00Z"),
    repositories: {
      patientAdministration: { findPatientById: async () => ({ id: patient }) },
      dentalTreatment: {
        getPatientDentalSnapshot: async (...args: unknown[]) => {
          reads.push(args);
          return found ? { id: snapshot, patientId: patient, snapshotVersion: 1 } : null;
        }
      }
    },
    evidence: {
      appendAuditEvent: async (event: Record<string, unknown>) => {
        if (failAudit) throw new Error("audit unavailable");
        audit.push(event);
      }
    }
  } as unknown as ClinicFeatureExecutionContext;
  return { request, context, audit, reads };
}
test("snapshot detail reads the exact patient/source pair and audits that immutable identity", async () => {
  const { request, context, audit, reads } = setup();
  const response = await createWorkflowDiscoveryHandlers().getPatientDentalSnapshot!(
    request,
    context
  );
  assert.equal(
    parseNativeOperationResponse("getPatientDentalSnapshot", response.status, response.body)
      .success,
    true
  );
  assert.deepEqual(reads, [[patient, snapshot]]);
  assert.equal(audit[0]?.resourceId, snapshot);
  assert.equal(audit[0]?.resourceType, "dental_chart_snapshot");
  assert.equal(audit[0]?.patientId, patient);
});
test("snapshot absence and failed audit never return source data", async () => {
  const missing = setup(false);
  await assert.rejects(
    () =>
      createWorkflowDiscoveryHandlers().getPatientDentalSnapshot!(missing.request, missing.context),
    (e: unknown) => !!e && typeof e === "object" && "status" in e && e.status === 404
  );
  const unavailable = setup(true, true);
  await assert.rejects(
    () =>
      createWorkflowDiscoveryHandlers().getPatientDentalSnapshot!(
        unavailable.request,
        unavailable.context
      ),
    /audit unavailable/
  );
});
