import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { createPaymentProvider } from "@clinic-os/integrations";
import {
  commitMigrationBatch,
  createClinicOsApiServer,
  createMigrationBatch,
  createImportRun,
  getImportRun,
  listImportRuns,
  InMemoryAuditSink,
  listDeadLetterEvents,
  listMigrationBatches,
  listMigrationBatchRows,
  listProviderHealth,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  replayDeadLetterEvent,
  resolveMigrationBatchRow,
  rollbackMigrationBatch,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;

test("operator import run recovers immutable steps and reconciles a three-phase CSV import", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant", "import-run");
  const accountant = await operationsContext("seed-accountant", "import-run-denied");
  const id = randomUUID();
  const sourceSystem = `manual_run_${id}`;
  await assert.rejects(() => createImportRun(accountant, dependencies, { id, sourceSystem }), /missing_permission/);
  assert.equal((await createImportRun(assistant, dependencies, { id, sourceSystem })).status, 201);
  assert.equal((await createImportRun(assistant, dependencies, { id, sourceSystem })).status, 200);
  await assert.rejects(() => createImportRun(assistant, dependencies, { id, sourceSystem: "different" }), /already in use/);
  assert.equal(auditSink.events.filter((event) => event.action === "migration.run.created").length, 1);
  const patient = {
    importRunId: id, importType: "patients", sourceSystem, sourceFileName: "patients.csv",
    csv: "external_reference,full_name,phone\npatient-1,Run Patient,+91 99900 01111"
  };
  await assert.rejects(() => createMigrationBatch(assistant, dependencies, {
    ...patient, importType: "appointments"
  }), /previous import step/);
  const patientBatch = await createMigrationBatch(assistant, dependencies, patient);
  assert.equal(patientBatch.status, 201);
  const replay = await createMigrationBatch(assistant, dependencies, { ...patient, sourceChecksum: "f".repeat(64) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.batch.id, patientBatch.body.batch.id);
  assert.equal(auditSink.events.filter((event) => event.action === "migration.batch.created").length, 1);
  await assert.rejects(() => createMigrationBatch(assistant, dependencies, {
    ...patient, csv: patient.csv.replace("Run Patient", "Changed Patient")
  }), /different content/);
  await assert.rejects(() => createMigrationBatch(assistant, dependencies, {
    ...patient, sourceSystem: "another_source"
  }), /does not match/);
  await commitMigrationBatch(assistant, dependencies, patientBatch.body.batch.id, {});

  const practitioner = await createMigrationBatch(assistant, dependencies, {
    importRunId: id, importType: "practitioners", sourceSystem, sourceFileName: "practitioners.csv",
    csv: "external_reference,display_name,email,phone\ndoctor-1,Run Doctor,,"
  });
  assert.equal(practitioner.status, 201);
  await resolveMigrationBatchRow(assistant, dependencies, practitioner.body.batch.id,
    practitioner.body.rows[0].id, {
      action: "link_existing", targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor
    });
  await commitMigrationBatch(assistant, dependencies, practitioner.body.batch.id, {});
  const appointment = await createMigrationBatch(assistant, dependencies, {
    importRunId: id, importType: "appointments", sourceSystem, sourceFileName: "appointments.csv",
    csv: "external_reference,patient_external_reference,provider_external_reference,appointment_type_code,chair_code,start_at,end_at,status,source\nappointment-1,patient-1,doctor-1,consultation,op-1,2026-09-01T09:00:00.000Z,2026-09-01T09:30:00.000Z,booked,manual"
  });
  assert.equal(appointment.status, 201);
  await commitMigrationBatch(assistant, dependencies, appointment.body.batch.id, {});
  const lateReplay = await createMigrationBatch(assistant, dependencies, {
    ...patient, sourceChecksum: "0".repeat(64)
  });
  assert.equal(lateReplay.status, 200);
  assert.equal(lateReplay.body.batch.id, patientBatch.body.batch.id);
  const detail = await getImportRun(assistant, dependencies, id);
  assert.equal(detail.body.status, "complete");
  assert.deepEqual(detail.body.batches.map((entry) => entry.batch.importType), ["patients", "practitioners", "appointments"]);
  assert.deepEqual(detail.body.reconciliation, {
    received: 3, valid: 3, invalid: 0, needsReview: 0, ready: 0,
    committed: 3, skipped: 0, rolledBack: 0, failed: 0, reconciled: 0,
    missingSourceAssessment: "unknown"
  });
  assert.equal("rawPayload" in detail.body.batches[0].rows[0], false);
  const list = await listImportRuns(assistant, dependencies, { limit: "1" });
  assert.equal(list.body.runs[0].id, id);
  assert.equal(list.body.nextCursor, null);
  const laterId = randomUUID();
  await createImportRun(assistant, dependencies, { id: laterId, sourceSystem });
  const firstPage = await listImportRuns(assistant, dependencies, { limit: "1" });
  assert.ok(firstPage.body.nextCursor);
  const secondPage = await listImportRuns(assistant, dependencies, {
    limit: "1", cursor: firstPage.body.nextCursor
  });
  assert.equal(secondPage.body.runs.length, 1);
  assert.notEqual(secondPage.body.runs[0].id, firstPage.body.runs[0].id);
  await assert.rejects(() => listImportRuns(assistant, dependencies, {
    limit: "1", cursor: randomUUID()
  }), /cursor not found/);
});

test("operator run retains rejected rows as partial truth after accepted import", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "import-run-partial");
  const id = randomUUID();
  const sourceSystem = `manual_run_${id}`;
  await createImportRun(assistant, dependencies, { id, sourceSystem });
  const batch = await createMigrationBatch(assistant, dependencies, {
    importRunId: id, importType: "patients", sourceSystem, sourceFileName: "patients.csv",
    csv: "external_reference,full_name,phone\nvalid-1,Valid Patient,+91 99900 01111\ninvalid-1,,123"
  });
  await commitMigrationBatch(assistant, dependencies, batch.body.batch.id, {});
  const detail = await getImportRun(assistant, dependencies, id);
  assert.equal(detail.body.status, "partial");
  assert.equal(detail.body.reconciliation.received, 2);
  assert.equal(detail.body.reconciliation.committed, 1);
  assert.equal(detail.body.reconciliation.invalid, 1);
  assert.equal(detail.body.reconciliation.valid, 1);
  assert.equal(detail.body.reconciliation.missingSourceAssessment, "unknown");
});

test("CP7 migration import separates invalid rows, resolves duplicates, commits idempotently, and rolls back imports", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant", "cp7-create");
  const accountant = await operationsContext("seed-accountant", "cp7-accountant");

  await assert.rejects(
    () =>
      createMigrationBatch(accountant, dependencies, {
        importType: "patients",
        rows: [{ fullName: "Forbidden Import", phone: "+91 99999 11111" }]
      }),
    /missing_permission/
  );
  await assert.rejects(
    () =>
      createMigrationBatch(assistant, dependencies, {
        importType: "invoices",
        rows: [{ fullName: "Must Not Become Patient", phone: "+91 99999 22222" }]
      }),
    /does not have an implemented ingestion contract/
  );

  const created = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem: "ray_legacy_export",
    sourceFileName: "patients.csv",
    csv: [
      "external_reference,full_name,phone,email,date_of_birth,gender,source_type",
      "legacy-new,Asha Import,+91 99900 01111,asha.import@example.test,1984-02-03,female,practo",
      "legacy-dup,Rhea Synthetic,+91 98765 43210,rhea.synthetic@example.test,,female,google",
      "legacy-bad,,123,bad-email,not-a-date,unknown,practo"
    ].join("\n")
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.rowCount, 3);
  assert.equal(created.body.batch.invalidRowCount, 1);
  assert.equal(created.body.batch.conflictRowCount, 1);
  assert.equal(created.body.batch.state, "needs_review");
  assert.equal("rawPayload" in created.body.rows[0], false);

  const duplicateRow = created.body.rows.find((row) => row.matchStatus === "duplicate_candidate");
  assert.ok(duplicateRow);
  assert.equal(duplicateRow.conflicts[0].conflictType, "duplicate_patient");
  assert.deepEqual(duplicateRow.conflicts[0].evidence.candidatePatient, {
    fullName: "Rhea Synthetic", phone: "+919876543210"
  });

  await assert.rejects(
    () =>
      commitMigrationBatch(
        { ...assistant, idempotencyKey: "cp7-commit-1" },
        dependencies,
        created.body.batch.id,
        {}
      ),
    /unresolved duplicate/
  );

  const resolved = await resolveMigrationBatchRow(
    assistant,
    dependencies,
    created.body.batch.id,
    duplicateRow.id,
    {
      action: "link_existing",
      targetPatientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      note: "Confirmed same patient during import review."
    }
  );
  assert.equal(resolved.body.row.status, "ready_to_commit");
  assert.equal(resolved.body.row.matchStatus, "resolved");

  const committed = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-commit-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(committed.status, 202);
  assert.equal(committed.body.batch.state, "partially_committed");
  assert.equal(committed.body.importedRecordLinks.length, 2);
  assert.ok(
    committed.body.importedRecordLinks.every(
      (link) => link.verificationStatus === "imported_unverified"
    )
  );
  assert.equal(repository.patients.length, 2);
  assert.equal(
    repository.patients.find(
      (patient) => patient.id === CHECKPOINT1_SEED_IDS.patients.rheaSynthetic
    )?.fullName,
    "Rhea Synthetic"
  );

  const repeated = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-commit-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(repeated.body.commit.id, committed.body.commit.id);

  assert.ok(auditSink.events.some((event) => event.action === "migration.batch.created"));
  assert.ok(auditSink.events.some((event) => event.action === "migration.row.resolved"));
  assert.ok(auditSink.events.some((event) => event.action === "migration.batch.committed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "patient.imported"));

  const rolledBack = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-rollback-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(rolledBack.status, 202);
  assert.equal(rolledBack.body.batch.state, "rolled_back");
  assert.equal(rolledBack.body.blockedLinks.length, 0);
  assert.equal(repository.patients.length, 1);
  assert.equal(
    repository.importedRecordLinks.every((link) => link.verificationStatus === "rolled_back"),
    true
  );
});

test("CP7 patient resolution rejects unreviewed same-clinic targets and permits candidate retries", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository, auditSink: new InMemoryAuditSink() };
  const assistant = await operationsContext("seed-assistant", "cp7-patient-candidate-guard");
  const unrelated = await repository.createPatient({
    tenantId: assistant.accessContext.tenant.id, clinicId, actorUserId: assistant.accessContext.user.id
  }, { fullName: "Unrelated Synthetic", phone: "+919999991234", gender: "unknown", source: "manual", sourceDetail: {} });
  const batch = await createMigrationBatch(assistant, dependencies, {
    importType: "patients", sourceSystem: "candidate_guard",
    rows: [{ externalReference: "candidate-1", fullName: "Rhea Synthetic", phone: "+919876543210" }]
  });
  const row = batch.body.rows[0];
  assert.ok(row);
  await assert.rejects(() => resolveMigrationBatchRow(assistant, dependencies, batch.body.batch.id,
    row.id, { action: "link_existing", targetRecordId: unrelated.id }), /resolution target is unavailable/);
  assert.equal((await listMigrationBatchRows(assistant, dependencies, batch.body.batch.id, {})).body.rows[0].status, "needs_review");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const resolved = await resolveMigrationBatchRow(assistant, dependencies, batch.body.batch.id,
      row.id, { action: "link_existing", targetRecordId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic });
    assert.equal(resolved.body.row.resolutionTargetRecordId, CHECKPOINT1_SEED_IDS.patients.rheaSynthetic);
  }
});

test("CP7 patient import reconciles exact cross-batch replay and reviews changed linked records", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant", "cp7-cross-batch-replay");
  const sourceSystem = "canonical_patient_import";
  const originalRow = {
    externalReference: "stable-patient-1",
    fullName: "Replay Synthetic",
    phone: "+91 99900 04444",
    email: "replay.original@example.test",
    dateOfBirth: "1990-04-05",
    gender: "female"
  };

  const initial = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  const initialCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-initial-import" },
    dependencies,
    initial.body.batch.id,
    {}
  );
  const linkedPatientId = initialCommit.body.rows[0].committedRecordId;
  assert.ok(linkedPatientId);
  assert.equal(repository.patients.length, 2);

  const exactReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  assert.equal(exactReplay.body.rows[0].status, "ready_to_commit");
  assert.equal(exactReplay.body.rows[0].matchStatus, "resolved");
  assert.equal(exactReplay.body.rows[0].conflicts.length, 0);

  const replayCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-exact-replay" },
    dependencies,
    exactReplay.body.batch.id,
    {}
  );
  assert.equal(replayCommit.body.rows[0].committedRecordId, linkedPatientId);
  assert.equal(replayCommit.body.commit.summary.reconciledRows, 1);
  assert.equal(replayCommit.body.importedRecordLinks.length, 0);
  assert.equal(repository.patients.length, 2);

  const replayRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-exact-replay-rollback" },
    dependencies,
    exactReplay.body.batch.id,
    {}
  );
  assert.equal(replayRollback.body.batch.state, "rolled_back");
  assert.equal(replayRollback.body.rows[0].status, "rolled_back");
  assert.equal(repository.patients.length, 2);
  assert.ok(repository.patients.some((patient) => patient.id === linkedPatientId));

  const explicitlyLinkedExactReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    explicitlyLinkedExactReplay.body.batch.id,
    explicitlyLinkedExactReplay.body.rows[0].id,
    { action: "link_existing", targetRecordId: linkedPatientId }
  );
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-explicit-exact-replay" },
    dependencies,
    explicitlyLinkedExactReplay.body.batch.id,
    {}
  );
  const explicitlyLinkedExactRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-explicit-exact-replay-rollback" },
    dependencies,
    explicitlyLinkedExactReplay.body.batch.id,
    {}
  );
  assert.equal(explicitlyLinkedExactRollback.body.batch.state, "rolled_back");
  assert.equal(explicitlyLinkedExactRollback.body.blockedLinks.length, 0);

  const changedSourceEvidenceReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [{ ...originalRow, source: "practo" }]
  });
  assert.equal(changedSourceEvidenceReplay.body.batch.state, "needs_review");
  assert.deepEqual(
    changedSourceEvidenceReplay.body.rows[0].conflicts[0].evidence.differingFields,
    []
  );
  assert.equal(
    changedSourceEvidenceReplay.body.rows[0].conflicts[0].evidence.evidenceDigestStatus,
    "changed"
  );

  const changedReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [{ ...originalRow, email: "replay.changed@example.test" }]
  });
  assert.equal(changedReplay.body.batch.state, "needs_review");
  assert.equal(changedReplay.body.rows[0].matchStatus, "conflict");
  assert.equal(changedReplay.body.rows[0].conflicts[0].conflictType, "verified_record_overlap");
  assert.deepEqual(changedReplay.body.rows[0].conflicts[0].evidence.differingFields, ["email"]);
  assert.equal(
    JSON.stringify(changedReplay.body.rows[0].conflicts[0].evidence).includes(
      "replay.original@example.test"
    ),
    false
  );

  const resolved = await resolveMigrationBatchRow(
    assistant,
    dependencies,
    changedReplay.body.batch.id,
    changedReplay.body.rows[0].id,
    {
      action: "link_existing",
      targetRecordId: linkedPatientId,
      note: "Confirmed identity; preserve the current ClinicOS demographic value for review."
    }
  );
  assert.equal(resolved.body.row.status, "ready_to_commit");
  const changedCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-changed-replay" },
    dependencies,
    changedReplay.body.batch.id,
    {}
  );
  assert.equal(changedCommit.body.rows[0].committedRecordId, linkedPatientId);
  assert.equal(changedCommit.body.commit.summary.reconciledRows, 1);
  assert.equal(repository.patients.length, 2);
  assert.equal(
    repository.patients.find((patient) => patient.id === linkedPatientId)?.email,
    originalRow.email
  );
});

test("CP7 patient replay requires review and backfill when legacy digest evidence is missing", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "cp7-legacy-evidence-digest");
  const sourceSystem = "legacy_digest_test";
  const originalRow = {
    externalReference: "legacy-digest-patient-1",
    fullName: "Legacy Digest Synthetic",
    phone: "+91 99900 04445"
  };
  const initial = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  const committed = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "legacy-digest-initial" },
    dependencies,
    initial.body.batch.id,
    {}
  );
  const patientId = committed.body.rows[0].committedRecordId;
  assert.ok(patientId);
  const canonicalLink = repository.importedRecordLinks.find(
    (link) =>
      link.sourceSystem === sourceSystem &&
      link.externalRecordId === originalRow.externalReference
  );
  assert.ok(canonicalLink);
  delete canonicalLink.metadata.normalizedRecordDigest;

  const replay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  assert.equal(replay.body.batch.state, "needs_review");
  assert.equal(replay.body.rows[0].conflicts[0].evidence.evidenceDigestStatus, "missing");
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    replay.body.batch.id,
    replay.body.rows[0].id,
    { action: "link_existing", targetRecordId: patientId }
  );
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "legacy-digest-reaffirm" },
    dependencies,
    replay.body.batch.id,
    {}
  );
  assert.equal(typeof canonicalLink.metadata.normalizedRecordDigest, "string");
  assert.equal(canonicalLink.metadata.evidenceReaffirmedByBatchId, replay.body.batch.id);
  assert.equal(canonicalLink.metadata.evidenceReaffirmedByRowId, replay.body.rows[0].id);
  const postBackfillReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  assert.equal(postBackfillReplay.body.batch.state, "ready_to_commit");
  assert.equal(postBackfillReplay.body.rows[0].conflicts.length, 0);
});

test("CP7 patient import blocks duplicate external references inside one batch", async () => {
  const dependencies: OperationsDependencies = {
    repository: new LocalFixtureClinicOperationsRepository(),
    auditSink: new InMemoryAuditSink()
  };
  const assistant = await operationsContext("seed-assistant", "cp7-duplicate-external-ref");
  const created = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem: "canonical_patient_import",
    rows: [
      {
        externalReference: "duplicate-external-1",
        fullName: "First Synthetic",
        phone: "+91 99900 05551"
      },
      {
        externalReference: "duplicate-external-1",
        fullName: "Second Synthetic",
        phone: "+91 99900 05552"
      }
    ]
  });

  assert.equal(created.body.batch.state, "needs_review");
  assert.equal(created.body.rows[0].status, "needs_review");
  assert.equal(created.body.rows[1].status, "needs_review");
  assert.equal(created.body.rows[0].conflicts[0].conflictType, "field_conflict");
  assert.equal(created.body.rows[1].conflicts[0].conflictType, "field_conflict");
  assert.equal(created.body.rows[1].conflicts[0].fieldName, "externalReference");
  assert.equal(created.body.rows[1].conflicts[0].evidence.occurrenceCount, 2);
});

test("source-independent practitioner and appointment imports require exact mappings and replay safely", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = {
    repository,
    auditSink: new InMemoryAuditSink()
  };
  const assistant = await operationsContext("seed-assistant", "practitioner-appointment-import");
  const sourceSystem = "synthetic_practo_contract";

  const practitionerBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [
      {
        externalReference: "ray-doctor-1",
        displayName: "External Doctor",
        email: "doctor@example.test"
      }
    ]
  });
  assert.equal(practitionerBatch.body.batch.state, "needs_review");
  assert.equal(practitionerBatch.body.rows[0].conflicts[0].conflictType, "invalid_reference");
  const mappedPractitioner = await resolveMigrationBatchRow(
    assistant,
    dependencies,
    practitionerBatch.body.batch.id,
    practitionerBatch.body.rows[0].id,
    {
      action: "link_existing",
      targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor,
      note: "Clinic operator confirmed the practitioner mapping."
    }
  );
  assert.equal(mappedPractitioner.body.row.resolutionTargetRecordType, "provider_user");
  const practitionerCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "practitioner-map-1" },
    dependencies,
    practitionerBatch.body.batch.id,
    {}
  );
  assert.equal(practitionerCommit.body.batch.state, "committed");
  assert.equal(practitionerCommit.body.importedRecordLinks[0].linkType, "linked_existing");
  assert.equal(
    practitionerCommit.body.importedRecordLinks[0].targetRecordId,
    CHECKPOINT1_SEED_IDS.users.doctor
  );

  const unresolvedAppointment = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [
      {
        externalReference: "appointment-before-patient",
        patientExternalReference: "patient-not-mapped",
        providerExternalReference: "ray-doctor-1",
        appointmentTypeCode: "consultation",
        startAt: "2026-09-01T08:00:00.000Z",
        endAt: "2026-09-01T08:30:00.000Z",
        status: "booked",
        source: "practo"
      }
    ]
  });
  assert.equal(unresolvedAppointment.body.batch.state, "needs_review");
  await assert.rejects(
    () =>
      resolveMigrationBatchRow(
        assistant,
        dependencies,
        unresolvedAppointment.body.batch.id,
        unresolvedAppointment.body.rows[0].id,
        {
          action: "create_new",
          note: "Must not bypass unresolved dependencies."
        }
      ),
    /not found or resolution target is unavailable/
  );
  assert.equal(unresolvedAppointment.body.rows[0].status, "needs_review");

  const changedPractitioner = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [
      {
        externalReference: "ray-doctor-1",
        displayName: "External Doctor, Updated",
        email: "updated-doctor@example.test"
      }
    ]
  });
  assert.equal(changedPractitioner.body.batch.state, "needs_review");
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    changedPractitioner.body.batch.id,
    changedPractitioner.body.rows[0].id,
    {
      action: "link_existing",
      targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor,
      note: "Clinic operator reaffirmed the changed external evidence."
    }
  );
  const reaffirmedPractitioner = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "practitioner-map-reaffirmed" },
    dependencies,
    changedPractitioner.body.batch.id,
    {}
  );
  assert.equal(reaffirmedPractitioner.body.commit.summary.reconciledRows, 1);
  const blockedReaffirmationRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "practitioner-reaffirmation-rollback" },
    dependencies,
    changedPractitioner.body.batch.id,
    {}
  );
  assert.equal(blockedReaffirmationRollback.body.batch.state, "partially_committed");
  assert.equal(blockedReaffirmationRollback.body.rows[0].status, "committed");
  assert.equal(blockedReaffirmationRollback.body.blockedLinks.length, 1);
  const repeatedBlockedReaffirmationRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "practitioner-reaffirmation-rollback" },
    dependencies,
    changedPractitioner.body.batch.id,
    {}
  );
  assert.equal(repeatedBlockedReaffirmationRollback.body.blockedLinks.length, 1);
  const blockedOriginalMappingRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "practitioner-original-mapping-rollback" },
    dependencies,
    practitionerBatch.body.batch.id,
    {}
  );
  assert.equal(blockedOriginalMappingRollback.body.batch.state, "partially_committed");
  assert.equal(blockedOriginalMappingRollback.body.blockedLinks.length, 1);
  const replayedReaffirmedPractitioner = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [
      {
        externalReference: "ray-doctor-1",
        displayName: "External Doctor, Updated",
        email: "updated-doctor@example.test"
      }
    ]
  });
  assert.equal(replayedReaffirmedPractitioner.body.rows[0].status, "ready_to_commit");
  assert.equal(replayedReaffirmedPractitioner.body.rows[0].conflicts.length, 0);

  const patientBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [
      {
        externalReference: "ray-patient-1",
        fullName: "Appointment Import Synthetic",
        phone: "+91 99900 07771"
      }
    ]
  });
  const patientCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "appointment-patient-1" },
    dependencies,
    patientBatch.body.batch.id,
    {}
  );
  const patientId = patientCommit.body.rows[0].committedRecordId;
  assert.ok(patientId);

  const appointmentRow = {
    externalReference: "ray-appointment-1",
    patientExternalReference: "ray-patient-1",
    providerExternalReference: "ray-doctor-1",
    appointmentTypeCode: "consultation",
    chairCode: "op-1",
    startAt: "2026-09-01T09:00:00.000Z",
    endAt: "2026-09-01T09:30:00.000Z",
    status: "booked",
    source: "practo"
  };
  const appointmentBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [appointmentRow]
  });
  assert.equal(appointmentBatch.body.batch.state, "ready_to_commit");
  const appointmentCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "appointment-import-1" },
    dependencies,
    appointmentBatch.body.batch.id,
    {}
  );
  const appointmentId = appointmentCommit.body.rows[0].committedRecordId;
  assert.ok(appointmentId);
  assert.equal(repository.appointments.length, 1);
  assert.equal(repository.appointments[0].patientId, patientId);
  assert.equal(repository.appointments[0].providerUserId, CHECKPOINT1_SEED_IDS.users.doctor);
  assert.equal(repository.appointments[0].status, "booked");
  assert.equal(
    repository.timelineItems.some(
      (item) => item.sourceTable === "appointments" && item.sourceId === appointmentId
    ),
    false
  );

  const exactReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [appointmentRow]
  });
  assert.equal(exactReplay.body.rows[0].matchStatus, "resolved");
  const replayCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "appointment-replay-1" },
    dependencies,
    exactReplay.body.batch.id,
    {}
  );
  assert.equal(replayCommit.body.commit.summary.reconciledRows, 1);
  assert.equal(replayCommit.body.importedRecordLinks.length, 0);
  assert.equal(repository.appointments.length, 1);

  const changedReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [{ ...appointmentRow, status: "confirmed" }]
  });
  assert.equal(changedReplay.body.batch.state, "needs_review");
  assert.equal(changedReplay.body.rows[0].conflicts[0].conflictType, "verified_record_overlap");

  await repository.updateAppointmentStatus(
    {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    appointmentId,
    "confirmed"
  );
  const blockedRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "appointment-rollback-blocked" },
    dependencies,
    appointmentBatch.body.batch.id,
    {}
  );
  assert.equal(blockedRollback.body.batch.state, "partially_committed");
  assert.equal(blockedRollback.body.blockedLinks.length, 1);
  assert.equal(repository.appointments.length, 1);
  const repeatedBlockedRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "appointment-rollback-blocked" },
    dependencies,
    appointmentBatch.body.batch.id,
    {}
  );
  assert.equal(repeatedBlockedRollback.body.rollback.id, blockedRollback.body.rollback.id);
  assert.equal(repeatedBlockedRollback.body.blockedLinks.length, 1);
});

for (const linkExistingPatient of [false, true]) {
test(`patient and practitioner mappings survive dependent appointments (linked patient: ${linkExistingPatient})`, async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "practitioner-rollback-dependency");
  const sourceSystem = "practitioner_rollback_dependency_test";

  const practitionerBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [
      {
        externalReference: "dependency-doctor-1",
        displayName: "Dependency Doctor"
      }
    ]
  });
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    practitionerBatch.body.batch.id,
    practitionerBatch.body.rows[0].id,
    {
      action: "link_existing",
      targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor,
      note: "Confirmed for rollback dependency coverage."
    }
  );
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-practitioner-commit" },
    dependencies,
    practitionerBatch.body.batch.id,
    {}
  );

  const patientBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [
      {
        externalReference: "dependency-patient-1",
        fullName: linkExistingPatient ? "Rhea Synthetic" : "Dependency Patient",
        phone: linkExistingPatient ? "+919876543210" : "+91 99900 08881"
      }
    ]
  });
  if (linkExistingPatient) {
    await resolveMigrationBatchRow(assistant, dependencies, patientBatch.body.batch.id,
      patientBatch.body.rows[0].id, {
        action: "link_existing", targetRecordId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic
      });
  }
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-patient-commit" },
    dependencies,
    patientBatch.body.batch.id,
    {}
  );

  const appointmentBatch = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [
      {
        externalReference: "dependency-appointment-1",
        patientExternalReference: "dependency-patient-1",
        providerExternalReference: "dependency-doctor-1",
        appointmentTypeCode: "consultation",
        startAt: "2099-03-01T09:00:00.000Z",
        endAt: "2099-03-01T09:30:00.000Z",
        status: "booked",
        source: "practo"
      }
    ]
  });
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-appointment-commit" },
    dependencies,
    appointmentBatch.body.batch.id,
    {}
  );

  const blockedPatientRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-patient-blocked" }, dependencies,
    patientBatch.body.batch.id, {}
  );
  assert.equal(blockedPatientRollback.body.batch.state, "partially_committed");
  assert.equal(blockedPatientRollback.body.blockedLinks.length, 1);
  assert.match(String(blockedPatientRollback.body.blockedLinks[0].metadata.rollbackBlockedReason),
    /appointment depends on this patient mapping/);
  const replay = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments", sourceSystem,
    rows: [{ externalReference: "dependency-appointment-1",
      patientExternalReference: "dependency-patient-1", providerExternalReference: "dependency-doctor-1",
      appointmentTypeCode: "consultation", startAt: "2099-03-01T09:00:00.000Z",
      endAt: "2099-03-01T09:30:00.000Z", status: "booked", source: "practo" }]
  });
  assert.equal(replay.body.rows[0].status, "ready_to_commit");

  const blockedPractitionerRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-practitioner-blocked" },
    dependencies,
    practitionerBatch.body.batch.id,
    {}
  );
  assert.equal(blockedPractitionerRollback.body.batch.state, "partially_committed");
  assert.equal(blockedPractitionerRollback.body.blockedLinks.length, 1);
  assert.match(
    String(blockedPractitionerRollback.body.blockedLinks[0].metadata.rollbackBlockedReason),
    /appointment depends on this practitioner mapping/
  );

  const appointmentRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-appointment-rollback" },
    dependencies,
    appointmentBatch.body.batch.id,
    {}
  );
  assert.equal(appointmentRollback.body.batch.state, "rolled_back");
  const patientRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-patient-rollback" },
    dependencies,
    patientBatch.body.batch.id,
    {}
  );
  assert.equal(patientRollback.body.batch.state, "rolled_back");
  const practitionerRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-practitioner-cleanup" },
    dependencies,
    practitionerBatch.body.batch.id,
    {}
  );
  assert.equal(practitionerRollback.body.batch.state, "rolled_back");
});
}

test("migration creation requires exactly one bounded input source", async () => {
  const dependencies: OperationsDependencies = {
    repository: new LocalFixtureClinicOperationsRepository()
  };
  const assistant = await operationsContext("seed-assistant", "bounded-migration-input");
  await assert.rejects(
    () =>
      createMigrationBatch(assistant, dependencies, {
        importType: "patients",
        csv: "external_reference,full_name\npatient-1,Synthetic Patient",
        rows: [{ externalReference: "patient-1", fullName: "Synthetic Patient" }]
      }),
    /exactly one of csv or rows/
  );
  await assert.rejects(
    () => createMigrationBatch(assistant, dependencies, { importType: "patients", csv: null }),
    /csv is required/
  );
  await assert.rejects(
    () =>
      createMigrationBatch(assistant, dependencies, {
        importType: "patients",
        rows: Array.from({ length: 101 }, (_, index) => ({
          externalReference: `patient-${index}`,
          fullName: `Synthetic Patient ${index}`,
          phone: `+9199900${String(index).padStart(5, "0")}`
        }))
      }),
    /cannot exceed 100 rows/
  );
});

test("migration repository rejects commit-ready identity rows without external identifiers", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const scope = {
    tenantId: CHECKPOINT1_SEED_IDS.tenantId,
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
  };

  for (const importType of ["patients", "practitioners", "appointments"] as const) {
    await assert.rejects(
      () =>
        repository.createMigrationBatch(scope, {
          importType,
          sourceSystem: `missing_external_identity_${importType}`,
          state: "ready_to_commit",
          rows: [
            {
              rowNumber: 1,
              importType,
              externalRecordId: null,
              rawPayload: {},
              rawPayloadDigest: `missing-external-identity-${importType}`,
              normalizedRecord: null,
              validationErrors: [],
              status: "ready_to_commit",
              matchStatus: "none"
            }
          ]
        }),
      /requires a stable external record identifier/
    );
  }
});

test("migration rollback preserves an imported patient after downstream mutation", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "patient-rollback-dependency");
  const batch = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem: "rollback_dependency_test",
    rows: [
      {
        externalReference: "dependency-patient-1",
        fullName: "Dependency Patient",
        phone: "+919990007991"
      }
    ]
  });
  const committed = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-patient-commit" },
    dependencies,
    batch.body.batch.id,
    {}
  );
  const patientId = committed.body.rows[0].committedRecordId;
  assert.ok(patientId);
  await repository.updatePatient(
    {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    patientId,
    { email: "downstream-change@example.test" }
  );
  const rollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "dependency-patient-rollback" },
    dependencies,
    batch.body.batch.id,
    {}
  );
  assert.equal(rollback.body.batch.state, "partially_committed");
  assert.equal(rollback.body.blockedLinks.length, 1);
  assert.ok(await repository.findPatientById(
    {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    patientId
  ));
});

test("appointment staging rejects a stale practitioner mapping", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "stale-practitioner-mapping");
  const sourceSystem = "stale_practitioner_test";
  const practitioner = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [{ externalReference: "doctor-stale", displayName: "External Doctor" }]
  });
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    practitioner.body.batch.id,
    practitioner.body.rows[0].id,
    { action: "link_existing", targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor }
  );
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "stale-practitioner-map" },
    dependencies,
    practitioner.body.batch.id,
    {}
  );
  const patient = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [
      {
        externalReference: "patient-stale-provider",
        fullName: "Stale Provider Patient",
        phone: "+919990007992"
      }
    ]
  });
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "stale-provider-patient" },
    dependencies,
    patient.body.batch.id,
    {}
  );
  repository.ineligibleProviderUserIds.add(CHECKPOINT1_SEED_IDS.users.doctor);
  const appointment = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [
      {
        externalReference: "appointment-stale-provider",
        patientExternalReference: "patient-stale-provider",
        providerExternalReference: "doctor-stale",
        appointmentTypeCode: "consultation",
        startAt: "2026-09-03T09:00:00.000Z",
        endAt: "2026-09-03T09:30:00.000Z",
        status: "booked",
        source: "practo"
      }
    ]
  });
  assert.equal(appointment.body.batch.state, "needs_review");
  assert.ok(
    appointment.body.rows[0].conflicts.some(
      (conflict) =>
        conflict.fieldName === "providerExternalReference" &&
        conflict.summary.includes("active eligible")
    )
  );
});

test("appointment staging blocks every overlapping in-batch row without a row-order winner", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const assistant = await operationsContext("seed-assistant", "appointment-in-batch-overlap");
  const sourceSystem = "synthetic_overlap_contract";

  const practitioner = await createMigrationBatch(assistant, dependencies, {
    importType: "practitioners",
    sourceSystem,
    rows: [{ externalReference: "doctor-1", displayName: "External Doctor" }]
  });
  await resolveMigrationBatchRow(
    assistant,
    dependencies,
    practitioner.body.batch.id,
    practitioner.body.rows[0].id,
    { action: "link_existing", targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor }
  );
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "overlap-practitioner" },
    dependencies,
    practitioner.body.batch.id,
    {}
  );
  const patient = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [
      {
        externalReference: "patient-1",
        fullName: "Overlap Import Synthetic",
        phone: "+91 99900 07772"
      }
    ]
  });
  await commitMigrationBatch(
    { ...assistant, idempotencyKey: "overlap-patient" },
    dependencies,
    patient.body.batch.id,
    {}
  );

  const created = await createMigrationBatch(assistant, dependencies, {
    importType: "appointments",
    sourceSystem,
    rows: [
      {
        externalReference: "appointment-a",
        patientExternalReference: "patient-1",
        providerExternalReference: "doctor-1",
        appointmentTypeCode: "consultation",
        startAt: "2026-09-02T09:00:00.000Z",
        endAt: "2026-09-02T09:30:00.000Z",
        status: "booked",
        source: "practo"
      },
      {
        externalReference: "appointment-b",
        patientExternalReference: "patient-1",
        providerExternalReference: "doctor-1",
        appointmentTypeCode: "consultation",
        startAt: "2026-09-02T09:15:00.000Z",
        endAt: "2026-09-02T09:45:00.000Z",
        status: "confirmed",
        source: "practo"
      }
    ]
  });
  assert.equal(created.body.batch.state, "needs_review");
  assert.deepEqual(
    created.body.rows.map((row) => row.status),
    ["needs_review", "needs_review"]
  );
  assert.ok(
    created.body.rows.every((row) =>
      row.conflicts.some((conflict) => conflict.summary.includes("overlap within this batch"))
    )
  );
});

test("CP7 integration ops API surfaces provider health, dead-letter replay requests, and migration collection reads", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = {
    auditSink,
    paymentProvider: createPaymentProvider({ provider: "simulator" }),
    repository,
    runtimeConfig: config
  };
  const owner = await operationsContext("seed-owner", "cp7-ops");
  const deadLetterId = "12345678-1234-4234-8234-123456789abc";

  repository.integrationDeadLetters.push({
    clinicId,
    createdAt: "2026-07-07T09:40:00.000Z",
    failureCode: "normalization_failed",
    failureStage: "normalization",
    failureSummary: "Signed callback verification is not active.",
    id: deadLetterId,
    lastErrorDigest: "sha256:redacted",
    nextRetryAt: null,
    normalizedEventId: null,
    providerKey: "meta_whatsapp_cloud",
    rawEventId: "22345678-1234-4234-8234-123456789abc",
    retryCount: 3,
    status: "open",
    tenantId: CHECKPOINT1_SEED_IDS.tenantId,
    updatedAt: "2026-07-07T09:40:00.000Z"
  });

  const health = await listProviderHealth(owner, dependencies);
  assert.equal(health.status, 200);
  assert.ok(health.body.providers.some((provider) => provider.providerKey === "whatsapp_cloud"));
  assert.ok(health.body.providers.some((provider) => provider.providerKey === "manual_import"));
  assert.ok(
    health.body.providers.some(
      (provider) => provider.providerKey === "practo" && provider.status === "not_configured"
    )
  );
  assert.equal(JSON.stringify(health.body).includes("Provider success confirmed"), false);

  const listedDeadLetters = await listDeadLetterEvents(owner, dependencies, {
    status: "unreviewed"
  });
  assert.equal(listedDeadLetters.status, 200);
  assert.equal(listedDeadLetters.body.deadLetterEvents[0].status, "unreviewed");
  assert.equal("rawEventId" in listedDeadLetters.body.deadLetterEvents[0], false);

  const replay = await replayDeadLetterEvent(owner, dependencies, deadLetterId, {
    reason: "Owner reviewed provider failure evidence."
  });
  assert.equal(replay.status, 202);
  assert.equal(replay.body.replay.status, "accepted");
  assert.equal(replay.body.replay.deadLetterEvent.status, "replay_requested");
  assert.ok(auditSink.events.some((event) => event.action === "integration.dead_letter.replayed"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "integration.dead_letter.replayed")
  );

  const created = await createMigrationBatch(owner, dependencies, {
    importType: "patients",
    rows: [{ externalReference: "ops-1", fullName: "Ops Import", phone: "+91 99900 03333" }]
  });
  const listedBatches = await listMigrationBatches(owner, dependencies, {
    status: "ready_to_commit"
  });
  assert.equal(listedBatches.status, 200);
  assert.equal(listedBatches.body.migrationBatches[0].batch.id, created.body.batch.id);
  assert.equal("rawPayload" in listedBatches.body.migrationBatches[0].rows[0], false);
});

test("CP15 provider health uses durable activation truth without returning secret references", async () => {
  const owner = await operationsContext("seed-owner", "cp15-provider-health");
  const dependencies: OperationsDependencies = {
    repository: new LocalFixtureClinicOperationsRepository(),
    runtimeConfig: config,
    providerOperationsRegistry: {
      async list() {
        return [
          {
            registrationId: "12345678-1234-4234-8234-123456789abc" as never,
            providerKey: "meta_whatsapp_cloud",
            activationState: "sandbox_verified",
            providerMode: "test",
            sandboxVerifiedAt: "2026-07-13T08:00:00.000Z",
            productionVerifiedAt: null,
            lastHealthCheckAt: "2026-07-13T08:05:00.000Z",
            lastVerifiedCallbackAt: "2026-07-13T08:04:00.000Z",
            lastReconciledAt: "2026-07-13T08:03:00.000Z",
            lastFailureCode: null,
            createdAt: "2026-07-13T07:00:00.000Z",
            updatedAt: "2026-07-13T08:05:00.000Z"
          }
        ] as const;
      }
    }
  };
  const health = await listProviderHealth(owner, dependencies);
  const meta = health.body.providers.find(
    (provider) => provider.providerKey === "whatsapp_cloud"
  );
  const razorpay = health.body.providers.find(
    (provider) => provider.providerKey === "razorpay"
  );
  assert.equal(meta?.activationState, "sandbox_verified");
  assert.equal(meta?.status, "available");
  assert.equal(meta?.lastVerifiedCallbackAt, "2026-07-13T08:04:00.000Z");
  assert.equal(razorpay?.activationState, "absent");
  assert.equal(razorpay?.status, "not_configured");
  assert.equal(JSON.stringify(health.body).includes("credential_ref"), false);
  assert.equal(JSON.stringify(health.body).includes("webhook_secret"), false);
});

test("CP7 migration routes expose create and row listing contract without raw payloads", async (t) => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: repository,
    auditSink: new InMemoryAuditSink(),
    useLocalAuthFixture: true,
    repositoryMode: "fixture"
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run the CP7 route smoke outside the sandbox."
      );
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const createResponse = await postJson(baseUrl, "/v1/migration-batches", {
      importType: "patients",
      rows: [{ externalReference: "route-1", fullName: "Route Import", phone: "+919990002222" }]
    });
    assert.equal(createResponse.status, 201);
    const createBody = await createResponse.json();
    assert.equal(createBody.batch.state, "ready_to_commit");
    assert.equal("rawPayload" in createBody.rows[0], false);
    assert.equal(createBody.rows[0].rawPayloadRef.retained, true);

    const rowsResponse = await fetch(
      `${baseUrl}/v1/migration-batches/${createBody.batch.id}/rows?matchStatus=none`,
      { headers: { "x-clinic-os-dev-subject": "seed-assistant" } }
    );
    assert.equal(rowsResponse.status, 200);
    const rowsBody = await rowsResponse.json();
    assert.equal(rowsBody.rows.length, 1);
    assert.equal("rawPayload" in rowsBody.rows[0], false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

async function operationsContext(
  subject: string,
  requestId: string
): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository(expectedIssuer);
  const claims = createClaims(subject);
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakIdentity({ issuer: expectedIssuer, subject });
  assert.ok(snapshot);

  return {
    requestId,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
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

async function postJson(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clinic-os-dev-subject": "seed-assistant",
      "idempotency-key": "cp7-route-create-batch"
    },
    body: JSON.stringify(body)
  });
}

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: {
    region: "ap-south-1",
    bucket: "clinic-os-local"
  },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: { provider: "simulator", qrMode: "payment_link_qr" },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: {
    syntheticDataOnly: true
  }
};
