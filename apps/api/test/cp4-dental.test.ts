import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug, UUID } from "@clinic-os/domain";
import {
  createDentalChartSnapshot,
  createEncounter,
  createEncounterDentalFinding,
  getPatientDentalChart,
  InMemoryAuditSink,
  listDentalFindingHistory,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  updateDentalFinding,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

test("CP4 dental charting creates findings, history, snapshots, and audited chart reads", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const doctor = await operationsContext("seed-doctor");

  const encounterResponse = await createEncounter(doctor, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP4 dental charting test"
  });
  const encounterId = encounterResponse.body.encounter.id;

  const created = await createEncounterDentalFinding(assistant, dependencies, encounterId, {
    toothNumber: "16",
    surfaces: ["occlusal"],
    findingType: "caries",
    severity: "moderate",
    status: "active",
    provenance: { source: "chairside_charting", enteredBy: "assistant" }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.finding.toothNumber, "16");
  assert.deepEqual(created.body.finding.surfaces, ["occlusal"]);
  assert.equal(created.body.finding.numberingSystem, "FDI");
  const findingId = created.body.finding.id;

  const updated = await updateDentalFinding(doctor, dependencies, findingId, {
    reviewState: "reviewed",
    doctorNote: "Synthetic doctor confirmed moderate caries."
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.finding.reviewStatus, "reviewed");
  assert.equal(updated.body.history.changeType, "updated");

  const snapshot = await createDentalChartSnapshot(doctor, dependencies, patientId, {
    encounterId,
    reason: "finding_reviewed"
  });

  assert.equal(snapshot.status, 201);
  assert.equal(snapshot.body.snapshot.chartState.findingCount, 1);
  assert.equal(snapshot.body.snapshot.chartState.numberingSystem, "FDI");

  const chart = await getPatientDentalChart(doctor, dependencies, patientId);
  assert.equal(chart.status, 200);
  assert.equal(chart.body.findings.length, 1);
  assert.equal(chart.body.history[0].entries.length, 2);
  assert.equal(chart.body.snapshots.length, 1);
  assert.doesNotMatch(JSON.stringify(chart.body), /objectKey|rawStoragePath|storagePath|bucket/);

  const history = await listDentalFindingHistory(doctor, dependencies, findingId);
  assert.equal(history.body.history.length, 2);
  assert.ok(auditSink.events.some((event) => event.action === "dental_finding.created"));
  assert.ok(auditSink.events.some((event) => event.action === "dental_finding.updated"));
  assert.ok(auditSink.events.some((event) => event.action === "dental_chart.snapshot_created"));
  assert.ok(auditSink.events.some((event) => event.action === "dental_chart.viewed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "dental.finding.created"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "dental.finding.updated"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "dental.chart.snapshot_created")
  );
});

test("CP4 dental charting denies accountant and wrong-tenant chart reads", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const accountant = await operationsContext("seed-accountant");

  await assert.rejects(
    () => getPatientDentalChart(accountant, dependencies, patientId),
    /missing_permission/
  );

  await assert.rejects(
    () => getPatientDentalChart(wrongTenantDoctorContext(), dependencies, patientId),
    (error) => error instanceof Error && "status" in error && error.status === 404
  );
  assert.equal(auditSink.events.some((event) => event.action === "dental_chart.viewed"), false);
});

async function operationsContext(subject: string): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const claims = {
    ...createClaims(subject),
    exp: Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000) + 300
  };
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);
  assert.ok(snapshot);

  return {
    requestId: `req_${subject}`,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function wrongTenantDoctorContext(): OperationsRequestContext {
  const tenantId = "20000000-0000-4000-8000-000000000001" as UUID;
  const clinicId = "20000000-0000-4000-8000-000000000101" as UUID;
  const userId = "20000000-0000-4000-8000-000000001002" as UUID;
  const roleSlug: ClinicRoleSlug = "doctor";
  const principal = principalFromVerifiedKeycloakClaims(createClaims("wrong-tenant-doctor"), {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });

  return {
    requestId: "req_wrong_tenant",
    accessContext: buildAccessContext({
      principal,
      tenant: {
        id: tenantId,
        slug: "wrong-tenant",
        legalName: "Wrong Tenant Dental Private Limited",
        displayName: "Wrong Tenant",
        status: "active"
      },
      user: {
        id: userId,
        displayName: "Wrong Tenant Doctor",
        email: "wrong@example.test",
        phone: null,
        status: "active"
      },
      memberships: [{ tenantId, userId, status: "active" }],
      clinicAssignments: [{ tenantId, clinicId, userId, status: "active" }],
      roleAssignments: [{ tenantId, clinicId, userId, roleSlug }]
    }),
    clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function createClaims(subject: string) {
  const issuedAt = Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000);
  return {
    sub: subject,
    iss: expectedIssuer,
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: issuedAt + 300,
    iat: issuedAt
  };
}
