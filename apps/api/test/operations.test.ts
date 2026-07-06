import test from "node:test";
import assert from "node:assert/strict";
import { CHECKPOINT1_SEED_IDS, type RepositoryScope } from "@clinic-os/db";
import { LocalFixtureClinicOperationsRepository } from "../src/index.ts";

test("local fixture operations repository enforces tenant and clinic scope", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const otherTenantPatient = {
    ...repository.patients[0],
    id: "20000000-0000-4000-8000-000000002001",
    tenantId: "20000000-0000-4000-8000-000000000001",
    clinicId: "20000000-0000-4000-8000-000000000101",
    phone: "+919876543210"
  };
  repository.patients.push(otherTenantPatient);

  const scope: RepositoryScope = {
    tenantId: CHECKPOINT1_SEED_IDS.tenantId,
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
  };
  const patients = await repository.listPatients(scope, { phone: "+91 98765 43210" });
  const duplicateCandidates = await repository.findPatientDuplicateCandidates(scope, {
    fullName: "Rhea Synthetic",
    phone: "+91 98765 43210"
  });

  assert.equal(patients.length, 1);
  assert.equal(patients[0].tenantId, scope.tenantId);
  assert.equal(duplicateCandidates.length, 1);
  assert.equal(duplicateCandidates[0].tenantId, scope.tenantId);
});
