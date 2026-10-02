import test from "node:test";
import assert from "node:assert/strict";
import { FixedClock } from "@clinic-os/domain";
import {
  parseNativeOperationResponse,
  parseNativeOperationRequest
} from "@clinic-os/api-contracts";
import { handlePatientDocuments } from "../src/features/patient-documents.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
const id = "10000000-0000-4000-8000-000000000001",
  patient = "10000000-0000-4000-8000-000000000002",
  source = "10000000-0000-4000-8000-000000000003",
  documentId = "10000000-0000-4000-8000-000000000004";
function setup(role = "owner_admin", kind = "instruction", failAudit = false) {
  const reads: unknown[][] = [],
    audits: unknown[] = [],
    events: unknown[] = [];
  const request = {
    operationId: "issuePatientDocument",
    access: {
      clinicId: id,
      context: {
        tenant: { id },
        user: { id },
        roleAssignments: [{ tenantId: id, clinicId: id, userId: id, roleSlug: role }]
      }
    },
    parsed: {
      path: { patientId: patient, kind, sourceId: source },
      body: { expectedSourceDigest: "a".repeat(64) },
      headers: { "idempotency-key": "synthetic-doc-1" }
    },
    metadata: {
      requestId: "synthetic",
      receivedAt: new Date("2026-10-02T10:00:00Z"),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as ClinicFeatureOperationRequest;
  const context = {
    clock: new FixedClock("2026-10-02T10:00:00Z"),
    repositories: {
      clinicalCare: {
        issuePatientDocument: async (...args: unknown[]) => {
          reads.push(args);
          return {
            created: true,
            document: {
              id: documentId,
              revision: 1,
              rendererVersion: 1,
              htmlDigest: "b".repeat(64)
            }
          };
        }
      }
    },
    evidence: {
      appendAuditEvent: async (event: unknown) => {
        if (failAudit) throw new Error("audit unavailable");
        audits.push(event);
      },
      appendOutboxEvent: async (event: unknown) => {
        events.push(event);
      }
    }
  } as unknown as ClinicFeatureExecutionContext;
  return { request, context, reads, audits, events };
}
test("document generation uses verified scoped source identities and metadata-only evidence", async () => {
  const state = setup();
  const response = await handlePatientDocuments(state.request, state.context);
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { documentId, reused: false });
  assert.equal(
    parseNativeOperationResponse("issuePatientDocument", response.status, response.body).success,
    true
  );
  assert.deepEqual(state.reads[0]?.slice(0, 4), [patient, "instruction", source, "a".repeat(64)]);
  assert.equal(state.audits.length, 1);
  assert.equal(state.events.length, 1);
  assert.doesNotMatch(
    JSON.stringify([...state.audits, ...state.events]),
    /snapshot|medications|patientName|<html/
  );
});
test("kind-specific authority is enforced before any source read", async () => {
  for (const [role, kind] of [
    ["receptionist", "prescription"],
    ["accountant", "prescription"],
    ["receptionist", "lab_slip"],
    ["accountant", "instruction"],
    ["auditor", "invoice"],
    ["receptionist", "estimate"],
    ["accountant", "estimate"]
  ]) {
    const state = setup(role, kind);
    await assert.rejects(
      () => handlePatientDocuments(state.request, state.context),
      (e: unknown) => !!e && typeof e === "object" && "status" in e && e.status === 403
    );
    assert.equal(state.reads.length, 0);
    assert.equal(state.audits.length, 0);
  }
});
test("audit failure prevents a successful generated-copy response", async () => {
  const state = setup("owner_admin", "invoice", true);
  await assert.rejects(
    () => handlePatientDocuments(state.request, state.context),
    /audit unavailable/
  );
  assert.equal(state.events.length, 0);
});
test("document contract rejects raw content, alternate authority and unknown source kinds", () => {
  const input = {
    path: { patientId: patient, kind: "invoice", sourceId: source },
    headers: {
      "idempotency-key": "synthetic-doc",
      authorization: "Bearer synthetic",
      "content-type": "application/json"
    },
    body: { expectedSourceDigest: "a".repeat(64) }
  };
  assert.equal(parseNativeOperationRequest("issuePatientDocument", input).success, true);
  for (const body of [
    { ...input.body, html: "forged" },
    { ...input.body, tenantId: id },
    { expectedSourceDigest: "wrong" }
  ])
    assert.equal(
      parseNativeOperationRequest("issuePatientDocument", { ...input, body }).success,
      false
    );
  assert.equal(
    parseNativeOperationRequest("issuePatientDocument", {
      ...input,
      path: { ...input.path, kind: "other" }
    }).success,
    false
  );
});

test("operational documents remain available without broad clinical-history access", async () => {
  for (const [role, kind] of [
    ["receptionist", "invoice"],
    ["receptionist", "receipt"],
    ["receptionist", "instruction"],
    ["accountant", "invoice"],
    ["doctor", "estimate"]
  ]) {
    const state = setup(role, kind);
    const response = await handlePatientDocuments(state.request, state.context);
    assert.equal(response.status, 201);
    assert.equal(state.reads.length, 1);
  }
});
