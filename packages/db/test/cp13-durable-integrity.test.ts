import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Clock, UUID } from "@clinic-os/domain";
import {
  PostgresClinicOperationsRepository,
  buildPaymentRequestIntentDigest,
  type SqlConnectionFactory,
  type SqlQueryResult
} from "../src/postgres.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0017_cp13_durable_integrity.sql"),
  "utf8"
);
const postgresSource = readFileSync(resolve(import.meta.dirname, "../src/postgres.ts"), "utf8");
const localLifecycle = readFileSync(resolve(ROOT, "scripts/db-local-lifecycle.mjs"), "utf8");

const TENANT_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const CLINIC_ID = "10000000-0000-4000-8000-000000000101" as UUID;
const ACTOR_ID = "10000000-0000-4000-8000-000000001001" as UUID;
const PATIENT_ID = "10000000-0000-4000-8000-000000002001" as UUID;
const PROVIDER_ID = "10000000-0000-4000-8000-000000003001" as UUID;
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000004001" as UUID;
const QUEUE_ID = "10000000-0000-4000-8000-000000005001" as UUID;
const UPLOAD_ID = "10000000-0000-4000-8000-000000006001" as UUID;
const RECEIPT_ID = "10000000-0000-4000-8000-000000007001" as UUID;
const ACCOUNT_ID = "10000000-0000-4000-8000-000000008001" as UUID;
const EVENT_ID = "10000000-0000-4000-8000-000000009001" as UUID;
const OUTBOX_ID = "10000000-0000-4000-8000-000000010001" as UUID;
const INTENT_ID = "10000000-0000-4000-8000-000000013001" as UUID;
const NOW = "2026-07-10T09:00:00.000Z";
const scope = {
  tenantId: TENANT_ID,
  clinicId: CLINIC_ID,
  actorUserId: ACTOR_ID
} satisfies RepositoryScope;
const fixedClock: Clock = { now: () => new Date(NOW) };

test("CP13 forward migration is strict, preflighted, scoped, and forced-RLS", () => {
  assert.match(migration, /existing clinical media rows may retain client original filenames/u);
  assert.match(migration, /patient instruction references an unbound outbox event identifier/u);
  assert.match(
    migration,
    /verified legacy webhook rows lack complete signature\/raw-body\/normalized fingerprints/u
  );
  const createInvoiceSection = postgresSource.slice(
    postgresSource.indexOf("  async createInvoice(scope"),
    postgresSource.indexOf("  async findInvoiceById(scope")
  );
  assert.ok(
    createInvoiceSection.indexOf("update procedure_performed_records") <
      createInvoiceSection.indexOf("insert into invoice_items"),
    "The procedure must reference the invoice before the composite invoice-item FK is inserted."
  );
  assert.match(
    postgresSource,
    /#listCompletedProceduresForInvoiceInTransaction[\s\S]*invoice_id is null[\s\S]*for update/u
  );
  assert.match(migration, /duplicate account-scoped provider event identifiers exist/u);
  assert.match(migration, /drop index if exists raw_webhook_events_idempotency_unique_idx/u);
  assert.match(
    migration,
    /raw_webhook_events_cp13_account_idempotency_uidx[\s\S]*tenant_id, clinic_id, external_account_id, idempotency_key/u
  );
  assert.match(
    postgresSource,
    /on conflict \(tenant_id, clinic_id, external_account_id, idempotency_key\) do nothing/u
  );
  assert.match(
    migration,
    /original_filename ~ '\^clinical-media-\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\\\./u
  );
  assert.doesNotMatch(migration, /\^media-|primary_clinic_id/iu);
  const mediaSection = migration.slice(
    migration.indexOf("alter table media_uploads"),
    migration.indexOf("alter table treatment_plans")
  );
  assert.doesNotMatch(mediaSection, /on delete cascade/iu);
  assert.doesNotMatch(migration, /create\s+(?:unique\s+)?index\s+concurrently/iu);
  assert.match(
    migration,
    /provider_key text not null check \(provider_key in \('razorpay', 'simulator'\)\)/u
  );
  assert.match(migration, /provider_safe_request jsonb not null/u);
  assert.match(migration, /octet_length\(provider_safe_request::text\) <= 32768/u);

  for (const table of [
    "clinical_media_receipts",
    "raw_webhook_events",
    "payment_provider_request_intents",
    "payment_reconciliation_items"
  ]) {
    assert.match(migration, new RegExp(`alter table ${table} force row level security`, "u"));
  }

  for (const constraint of [
    "media_uploads_cp13_encounter_patient_fk",
    "media_uploads_cp13_finding_patient_fk",
    "procedure_performed_cp13_plan_patient_fk",
    "payment_transactions_cp13_request_invoice_patient_fk",
    "patient_instruction_requests_outbox_fk"
  ]) {
    assert.match(migration, new RegExp(constraint, "u"), constraint);
    assert.match(migration, new RegExp(`validate constraint ${constraint}`, "u"), constraint);
  }

  const migrationRunner = readFileSync(resolve(ROOT, "scripts/test-db-migrations.mjs"), "utf8");
  assert.match(migrationRunner, /packages\/db\/migrations/u);
  assert.match(migrationRunner, /runFlyway\("migrate"\)/u);
  assert.match(migrationRunner, /"flyway",[\s\S]*command/u);
  assert.match(migrationRunner, /flyway_schema_history/u);
  assert.match(migrationRunner, /localFlywayMigrationOptions[\s\S]*-sqlMigrationPrefix=0/u);
  assert.match(
    migrationRunner,
    /`-locations=filesystem:\$\{temporaryMigrations\}`,[\s\S]*\.\.\.localFlywayMigrationOptions,[\s\S]*command/u
  );
});

test("CP13 worker grants are activity-specific and keep patient/idempotency tables denied", () => {
  assert.match(
    localLifecycle,
    /grant select on table[\s\S]*payment_provider_request_intents, outbox_events[\s\S]*recall_rules[\s\S]*sop_runs[\s\S]*to clinic_os_worker/u
  );
  assert.match(
    localLifecycle,
    /grant insert on table[\s\S]*audit_events[\s\S]*payment_requests[\s\S]*recalls[\s\S]*sop_runs[\s\S]*to clinic_os_worker/u
  );
  assert.match(
    localLifecycle,
    /grant update on table[\s\S]*payment_provider_request_intents, recalls, sop_runs[\s\S]*to clinic_os_worker/u
  );
  assert.match(localLifecycle, /workerUnauthorizedPatientAccess: "denied"/u);
  assert.match(localLifecycle, /workerApiIdempotencyAccess: "denied"/u);
  assert.match(
    localLifecycle,
    /for \(let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek \+= 1\)[\s\S]*insert into provider_schedules/u
  );
  assert.match(localLifecycle, /select tenant_id, id from patients order by id/u);
  assert.match(
    localLifecycle,
    /tenantA\.rows\.some\(\(row\) => row\.tenant_id !== CHECKPOINT1_SEED_IDS\.tenantId\)/u
  );
  assert.doesNotMatch(localLifecycle, /tenantA\.rows\.length !== 1/u);
  assert.doesNotMatch(
    localLifecycle,
    /grant (?:select|insert|update|delete|all)[^;]*all tables[^;]*clinic_os_worker/iu
  );
});

test("CP13 adapter uses the integrated clinical-media UUID format and never accepts an arbitrary client name", () => {
  assert.match(
    postgresSource,
    /\^clinical-media-\(\[0-9a-f-\]\{36\}\)\\\.\(\[a-z0-9\]\{1,12\}\)\$/u
  );
  assert.match(
    postgresSource,
    /match\?\.\[1\] !== uploadId\.toLowerCase\(\)[\s\S]*!extensions\.includes\(match\[2\]\)/u
  );
  assert.doesNotMatch(postgresSource, /return\s+input\.originalFilename/u);
});

test("WhatsApp patient instructions persist null unless a real outbox row is explicitly bound", async () => {
  const insertedOutboxValues: unknown[] = [];
  const client = new ScriptedSqlClient((sql, values) => {
    if (/select \* from patients/u.test(sql)) return [patientRow()];
    if (/insert into patient_instruction_requests/u.test(sql)) {
      insertedOutboxValues.push(values[10]);
      return [patientInstructionRow((values[10] as UUID | null) ?? null)];
    }
    return [];
  });
  const repository = new PostgresClinicOperationsRepository(client, { clock: fixedClock });

  const unbound = await repository.createPatientInstruction(scope, PATIENT_ID, {
    channel: "whatsapp",
    templateId: "post-care-v1"
  });
  const bound = await repository.createPatientInstruction(scope, PATIENT_ID, {
    channel: "whatsapp",
    templateId: "post-care-v1",
    outboxEventId: OUTBOX_ID
  });

  assert.equal(unbound?.outboxEventId, null);
  assert.equal(bound?.outboxEventId, OUTBOX_ID);
  assert.deepEqual(insertedOutboxValues, [null, OUTBOX_ID]);
  assert.doesNotMatch(
    postgresSource,
    /channel === "whatsapp"\s*\?\s*\(input\.outboxEventId \?\? randomUUID\(\)\)/u
  );
});

test("payment account resolution is exact-one, capability-scoped, and supports the local simulator", async () => {
  const capability = "CREATE_PAYMENT_LINKS";
  const simulatorClient = new ScriptedSqlClient((sql) =>
    /external_accounts\.capability_keys/u.test(sql)
      ? [paymentAccountRow("simulator", "available", "available", [capability])]
      : []
  );
  const simulatorRepository = new PostgresClinicOperationsRepository(simulatorClient);
  const simulator = await simulatorRepository.findActivePaymentProviderAccount(scope, {
    providerKey: "simulator",
    requiredCapability: capability
  });
  assert.equal(simulator.outcome, "resolved");
  assert.equal(simulator.account.providerKey, "simulator");
  assert.equal(simulator.account.externalAccountId, ACCOUNT_ID);
  const simulatorQuery = simulatorClient.queries.find((query) =>
    /external_accounts\.capability_keys/u.test(query.sql)
  );
  assert.deepEqual(simulatorQuery?.values, [TENANT_ID, CLINIC_ID, "simulator", capability]);
  assert.match(simulatorQuery?.sql ?? "", /external_systems\.provider_key = \$3/u);

  const ambiguousRepository = new PostgresClinicOperationsRepository(
    new ScriptedSqlClient((sql) =>
      /external_accounts\.capability_keys/u.test(sql)
        ? [
            paymentAccountRow("razorpay", "available", "available", [capability]),
            {
              ...paymentAccountRow("razorpay", "available", "available", [capability]),
              id: EVENT_ID
            }
          ]
        : []
    )
  );
  assert.equal(
    (
      await ambiguousRepository.findActivePaymentProviderAccount(scope, {
        providerKey: "razorpay",
        requiredCapability: capability
      })
    ).outcome,
    "ambiguous"
  );

  const degradedRepository = new PostgresClinicOperationsRepository(
    new ScriptedSqlClient((sql) =>
      /external_accounts\.capability_keys/u.test(sql)
        ? [paymentAccountRow("razorpay", "degraded", "available", [capability])]
        : []
    )
  );
  const degraded = await degradedRepository.findActivePaymentProviderAccount(scope, {
    providerKey: "razorpay",
    requiredCapability: capability
  });
  assert.deepEqual(degraded, { outcome: "degraded", account: null });
});

test("payment-provider outbox evidence derives integration authority and rejects mismatched replay", async () => {
  let storedPayload: string | null = null;
  const client = new ScriptedSqlClient((sql, values) => {
    if (/select external_accounts\.id/u.test(sql)) return [{ id: ACCOUNT_ID }];
    if (/insert into outbox_events/u.test(sql)) {
      if (storedPayload !== null) return [];
      storedPayload = String(values[9]);
      return [{ id: OUTBOX_ID }];
    }
    if (/select id, \( clinic_id/u.test(sql)) {
      return [{ id: OUTBOX_ID, replay_matches: values[9] === storedPayload }];
    }
    return [];
  });
  const repository = new PostgresClinicOperationsRepository(client);
  const input = {
    externalAccountId: ACCOUNT_ID,
    providerKey: "razorpay" as const,
    requiredCapability: "RECEIVE_PAYMENT_WEBHOOKS",
    eventType: "payment.succeeded" as const,
    aggregateType: "payment_transaction",
    aggregateId: EVENT_ID,
    patientId: PATIENT_ID,
    idempotencyKey: "cp13:razorpay:event:pay_event_001",
    correlationId: "pay_event_001",
    payload: { providerEventId: "pay_event_001", status: "applied" },
    occurredAt: NOW
  };

  assert.equal(
    (await repository.appendPaymentProviderIntegrationOutboxEvent(scope, input)).outcome,
    "appended"
  );
  assert.equal(
    (await repository.appendPaymentProviderIntegrationOutboxEvent(scope, input)).outcome,
    "replayed"
  );
  assert.equal(
    (
      await repository.appendPaymentProviderIntegrationOutboxEvent(scope, {
        ...input,
        payload: { providerEventId: "pay_event_001", status: "different" }
      })
    ).outcome,
    "mismatch"
  );
  const insert = client.queries.find((query) => /insert into outbox_events/u.test(query.sql));
  assert.match(insert?.sql ?? "", /'integration', \$4::text/u);
  assert.doesNotMatch(insert?.sql ?? "", /'user'/u);
  assert.equal(insert?.values[3], ACCOUNT_ID);
  assert.equal(insert?.values.includes(ACTOR_ID), false);
});

test("payment request intent recovery returns the immutable canonical provider request", async () => {
  let intent: Record<string, unknown> | null = null;
  let invoiceCollectible = true;
  const client = new ScriptedSqlClient((sql, values) => {
    if (/select external_accounts\.id/u.test(sql)) return [{ id: ACCOUNT_ID }];
    if (/insert into payment_provider_request_intents/u.test(sql)) {
      if (intent || !invoiceCollectible) return [];
      intent = paymentRequestIntentRow(values);
      return [intent];
    }
    if (/select \* from payment_provider_request_intents/u.test(sql)) {
      return intent ? [intent] : [];
    }
    if (/set status = 'reconciliation_required'/u.test(sql)) {
      intent = {
        ...intent,
        status: "reconciliation_required",
        mismatch_reason: values[4],
        lease_owner: null,
        lease_expires_at: null,
        processed_at: values[5]
      };
      return [intent];
    }
    if (/attempt_count = attempt_count \+ 1/u.test(sql)) {
      intent = {
        ...intent,
        lease_owner: values[4],
        lease_expires_at: values[5],
        attempt_count: 2
      };
      return [intent];
    }
    return [];
  });
  const repository = new PostgresClinicOperationsRepository(client);
  const canonicalRequest = {
    requestType: "payment_link" as const,
    amountMinor: 1250,
    currency: "INR",
    description: "Invoice payment",
    expiresAt: "2026-07-11T09:00:00.000Z",
    customer: { contact: "+910000000000" },
    metadata: { workflow: "cp13" }
  };
  const claimAuthority = {
    externalAccountId: ACCOUNT_ID,
    providerKey: "simulator" as const,
    requiredCapability: "CREATE_PAYMENT_LINKS",
    invoiceId: EVENT_ID,
    idempotencyKey: "cp13:payment-request:001",
    canonicalRequest
  };
  const input = {
    ...claimAuthority,
    requestDigest: buildPaymentRequestIntentDigest(claimAuthority),
    leaseOwner: "payment-worker-1",
    leaseExpiresAt: "2026-07-10T09:05:00.000Z",
    requestedAt: NOW
  };

  const claimed = await repository.claimPaymentRequestIntent(scope, input);
  assert.equal(claimed.outcome, "claimed");
  assert.deepEqual(claimed.intent.canonicalRequest, canonicalRequest);
  assert.equal(claimed.intent.providerKey, "simulator");
  const insert = client.queries.find((query) =>
    /insert into payment_provider_request_intents/u.test(query.sql)
  );
  assert.match(insert?.sql ?? "", /\$9::char\(3\)/u);
  assert.match(insert?.sql ?? "", /invoices\.currency = \(\$9::char\(3\)\)::text/u);

  invoiceCollectible = false;
  const recovered = await repository.claimPaymentRequestIntent(scope, {
    ...input,
    leaseOwner: "payment-worker-2",
    leaseExpiresAt: "2026-07-10T09:12:00.000Z",
    requestedAt: "2026-07-10T09:06:00.000Z"
  });
  assert.equal(recovered.outcome, "recovered");
  assert.deepEqual(recovered.intent.canonicalRequest, canonicalRequest);

  await assert.rejects(
    repository.claimPaymentRequestIntent(scope, {
      ...input,
      canonicalRequest: { ...canonicalRequest, amountMinor: 500 }
    }),
    /digest does not match/u
  );

  const changedAuthority = {
    ...claimAuthority,
    canonicalRequest: { ...canonicalRequest, amountMinor: 500 }
  };
  const digestMismatch = await repository.claimPaymentRequestIntent(scope, {
    ...input,
    ...changedAuthority,
    requestDigest: buildPaymentRequestIntentDigest(changedAuthority)
  });
  assert.equal(digestMismatch.outcome, "request_mismatch");
  assert.equal(digestMismatch.intent?.mismatchReason, "request_digest_mismatch");
  assert.deepEqual(digestMismatch.intent?.canonicalRequest, canonicalRequest);

  await assert.rejects(
    repository.claimPaymentRequestIntent(scope, {
      ...input,
      canonicalRequest: { ...canonicalRequest, metadata: { apiKey: "must-not-persist" } }
    }),
    /private or invalid field name/u
  );
});

test("clinical media receipt records, replays, and quarantines changed provider evidence without storing its path", async () => {
  const providerArtifactReference = "s3://private-clinic-bucket/opaque/provider/path";
  const expectedDigest = "a".repeat(64);
  let receipt: Record<string, unknown> | null = null;
  const allValues: unknown[] = [];
  const client = new ScriptedSqlClient((sql, values) => {
    allValues.push(...values);
    if (/from media_uploads/u.test(sql))
      return [mediaUploadRow(expectedDigest, providerArtifactReference)];
    if (/select \* from clinical_media_receipts/u.test(sql)) return receipt ? [receipt] : [];
    if (/insert into clinical_media_receipts/u.test(sql)) {
      receipt = mediaReceiptRow({
        receiptFingerprint: String(values[5]),
        providerArtifactFingerprint: String(values[6]),
        sha256Digest: String(values[9]),
        state: String(values[10]),
        mismatchReason: (values[11] as string | null) ?? null
      });
      return [receipt];
    }
    if (/update clinical_media_receipts set state = 'mismatch'/u.test(sql)) {
      receipt = {
        ...receipt,
        state: "mismatch",
        mismatch_reason: values[3],
        last_verified_at: values[5]
      };
      return [receipt];
    }
    return [];
  });
  const repository = new PostgresClinicOperationsRepository(client, { clock: fixedClock });
  const baseInput = {
    uploadId: UPLOAD_ID,
    providerKey: "s3" as const,
    providerArtifactReference,
    contentLength: 4096,
    mimeType: "image/jpeg",
    sha256Digest: expectedDigest,
    storedAt: NOW,
    receivedAt: NOW
  };

  const recorded = await repository.recordClinicalMediaReceipt(scope, baseInput);
  const replayed = await repository.recordClinicalMediaReceipt(scope, baseInput);
  const mismatched = await repository.recordClinicalMediaReceipt(scope, {
    ...baseInput,
    sha256Digest: "b".repeat(64),
    receivedAt: "2026-07-10T09:01:00.000Z"
  });

  assert.equal(recorded.outcome, "recorded");
  assert.equal(replayed.outcome, "replayed");
  assert.equal(mismatched.outcome, "mismatch");
  assert.equal(
    recorded.receipt.providerArtifactFingerprint,
    createHash("sha256").update(providerArtifactReference).digest("hex")
  );
  assert.equal(allValues.includes(providerArtifactReference), false);
  assert.ok(
    client.queries
      .filter((query) => /media_uploads|clinical_media_receipts/u.test(query.sql))
      .every((query) => query.values[0] === TENANT_ID && query.values[1] === CLINIC_ID)
  );
});

test("atomic check-in preserves an existing called queue entry and rolls back a failed queue insert", async () => {
  const replayClient = new ScriptedSqlClient((sql) => {
    if (/from appointments/u.test(sql)) return [appointmentRow("checked_in")];
    if (/from queue_entries/u.test(sql)) return [queueRow("called")];
    return [];
  });
  const replayRepository = new PostgresClinicOperationsRepository(replayClient, {
    clock: fixedClock
  });
  const replay = await replayRepository.checkInAppointmentWithQueue(scope, APPOINTMENT_ID);
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.queueEntry?.status, "called");
  assert.equal(replay.appointmentStatusChanged, false);
  assert.equal(replay.queueEntryCreated, false);
  assert.equal(replayClient.count(/update queue_entries/u), 0);
  assert.ok(replay.appointment);
  const legacyReplay = await replayRepository.createQueueEntry(scope, replay.appointment);
  assert.equal(legacyReplay.status, "called");
  assert.equal(replayClient.count(/insert into queue_entries/u), 0);
  assert.ok(
    replayClient.queries
      .filter((query) => /from (appointments|queue_entries)/u.test(query.sql))
      .every((query) => /for update/u.test(query.sql))
  );
  assert.doesNotMatch(
    postgresSource,
    /on conflict \(tenant_id, clinic_id, appointment_id\) do update set\s+status = 'waiting'/u
  );

  const failure = new Error("CP13_QUEUE_INSERT_FAILURE");
  const rollbackClient = new ScriptedSqlClient((sql) => {
    if (/from appointments/u.test(sql)) return [appointmentRow("booked")];
    if (/insert into queue_entries/u.test(sql)) throw failure;
    if (/from queue_entries/u.test(sql)) return [];
    if (/update appointments/u.test(sql)) return [appointmentRow("checked_in")];
    if (/select timezone from clinics/u.test(sql)) return [{ timezone: "Asia/Kolkata" }];
    return [];
  });
  const rollbackRepository = new PostgresClinicOperationsRepository(rollbackClient, {
    clock: fixedClock
  });
  await assert.rejects(
    rollbackRepository.checkInAppointmentWithQueue(scope, APPOINTMENT_ID, "arrived"),
    (error) => error === failure
  );
  assert.deepEqual(rollbackClient.transactionEndings, ["rollback"]);
  assert.equal(rollbackClient.count(/pg_advisory_xact_lock/u), 1);
  const queueInsert = rollbackClient.queries.find((query) =>
    /insert into queue_entries/u.test(query.sql)
  );
  assert.match(
    queueInsert?.sql ?? "",
    /on conflict \(tenant_id, clinic_id, appointment_id\) do nothing/u
  );
  assert.doesNotMatch(queueInsert?.sql ?? "", /set status = 'waiting'/u);
});

test("provider eligibility is current-clinic doctor scoped and provider-event evidence detects replay mismatch", async () => {
  let providerEvent: Record<string, unknown> | null = null;
  const client = new ScriptedSqlClient((sql, values) => {
    if (/as doctor_role_active/u.test(sql)) {
      return [
        {
          user_active: true,
          membership_active: true,
          clinic_assignment_active: true,
          doctor_role_active: true
        }
      ];
    }
    if (/select external_accounts\.id/u.test(sql)) return [{ id: ACCOUNT_ID }];
    if (/insert into raw_webhook_events/u.test(sql)) {
      if (providerEvent) return [];
      providerEvent = providerEventRow({
        rawBodySha256: String(values[8]),
        signatureSha256: String(values[9]),
        normalizedEventSha256: String(values[10])
      });
      return [providerEvent];
    }
    if (/select \* from raw_webhook_events/u.test(sql)) return providerEvent ? [providerEvent] : [];
    if (/update raw_webhook_events set evidence_state = 'mismatch'/u.test(sql)) {
      providerEvent = {
        ...providerEvent,
        evidence_state: "mismatch",
        processing_status: "reconciliation_required",
        mismatch_reason: values[3],
        lease_owner: null,
        lease_expires_at: null,
        processed_at: values[4]
      };
      return [providerEvent];
    }
    return [];
  });
  const repository = new PostgresClinicOperationsRepository(client, { clock: fixedClock });
  const eligibility = await repository.findProviderEligibility(scope, PROVIDER_ID);
  assert.equal(eligibility.eligible, true);
  const eligibilityQuery = client.queries.find((query) => /as doctor_role_active/u.test(query.sql));
  assert.deepEqual(eligibilityQuery?.values, [TENANT_ID, CLINIC_ID, PROVIDER_ID]);
  assert.match(eligibilityQuery?.sql ?? "", /clinic_id = \$2/u);
  assert.match(eligibilityQuery?.sql ?? "", /roles\.slug = 'doctor'/u);
  assert.doesNotMatch(eligibilityQuery?.sql ?? "", /keycloak|subject/iu);

  const input = {
    providerKey: "razorpay" as const,
    externalAccountId: ACCOUNT_ID,
    providerEventId: "pay_event_001",
    idempotencyKey: "razorpay:pay_event_001",
    eventName: "payment.captured",
    eventKind: "payment_captured",
    rawBodySha256: "a".repeat(64),
    signatureSha256: "b".repeat(64),
    normalizedEventSha256: "c".repeat(64),
    normalizedEvent: { providerEventId: "pay_event_001", amountMinor: 1000 },
    receivedAt: NOW,
    leaseOwner: "worker-cp13",
    leaseExpiresAt: "2026-07-10T09:05:00.000Z"
  };
  const claimed = await repository.claimVerifiedPaymentProviderEvent(scope, input);
  assert.equal(claimed.outcome, "claimed");
  const providerEventInsert = client.queries.find((query) =>
    /insert into raw_webhook_events/u.test(query.sql)
  );
  assert.match(
    providerEventInsert?.sql ?? "",
    /\$9::text, \(\$9::text\)::char\(64\), \$10, \$11/u
  );
  providerEvent = {
    ...providerEvent,
    evidence_state: "applied",
    processing_status: "applied",
    lease_owner: null,
    lease_expires_at: null,
    result_digest: "d".repeat(64),
    result_projection: { verificationEvidence: { rawBodySha256: input.rawBodySha256 } },
    processed_at: NOW
  };
  const duplicate = await repository.claimVerifiedPaymentProviderEvent(scope, input);
  assert.equal(duplicate.outcome, "duplicate");
  assert.deepEqual(duplicate.event.resultProjection, {
    verificationEvidence: { rawBodySha256: input.rawBodySha256 }
  });
  const mismatch = await repository.claimVerifiedPaymentProviderEvent(scope, {
    ...input,
    rawBodySha256: "e".repeat(64)
  });
  assert.equal(mismatch.outcome, "evidence_mismatch");
  assert.match(mismatch.event?.mismatchReason ?? "", /raw_body_sha256/u);
  assert.ok(
    client.queries
      .filter((query) => /external_accounts|raw_webhook_events/u.test(query.sql))
      .every((query) => query.values[0] === TENANT_ID && query.values[1] === CLINIC_ID)
  );
});

interface RecordedQuery {
  sql: string;
  values: readonly unknown[];
}

class ScriptedSqlClient implements SqlConnectionFactory {
  readonly queries: RecordedQuery[] = [];
  readonly transactionEndings: Array<"commit" | "rollback"> = [];
  readonly #handle: (sql: string, values: readonly unknown[]) => Record<string, unknown>[];
  #inTransaction = false;

  constructor(handle: (sql: string, values: readonly unknown[]) => Record<string, unknown>[]) {
    this.#handle = handle;
  }

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.trim().replace(/\s+/gu, " ");
    this.queries.push({ sql, values: [...values] });
    if (sql === "begin") {
      assert.equal(this.#inTransaction, false);
      this.#inTransaction = true;
      return { rows: [] };
    }
    if (sql === "commit" || sql === "rollback") {
      assert.equal(this.#inTransaction, true);
      this.#inTransaction = false;
      this.transactionEndings.push(sql);
      return { rows: [] };
    }
    if (/set_config\(/u.test(sql)) {
      assert.equal(this.#inTransaction, true);
      return { rows: [] };
    }
    return { rows: this.#handle(sql, values) as TResult[] };
  }

  count(pattern: RegExp): number {
    return this.queries.filter((query) => pattern.test(query.sql)).length;
  }
}

function patientRow(): Record<string, unknown> {
  return {
    id: PATIENT_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    row_version: 1,
    full_name: "Synthetic DB Regression",
    phone: null,
    email: null,
    date_of_birth: null,
    gender: "unknown",
    abha_address: null,
    source: "manual",
    created_at: NOW,
    updated_at: NOW
  };
}

function patientInstructionRow(outboxEventId: UUID | null): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000011001",
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    channel: "whatsapp",
    template_id: "post-care-v1",
    title: "Post-care instructions",
    body: "Clinic-approved instructions",
    status: "send_requested",
    rendered_at: NOW,
    print_job_id: null,
    outbox_event_id: outboxEventId,
    provider_confirmation_received: false,
    provider_delivery_confirmed_at: null,
    delivered_at: null,
    read_at: null,
    created_by_user_id: ACTOR_ID,
    created_at: NOW
  };
}

function mediaUploadRow(expectedDigest: string, objectKey: string): Record<string, unknown> {
  return {
    id: UPLOAD_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    encounter_id: null,
    tooth_number: null,
    dental_finding_id: null,
    media_type: "intraoral_photo",
    original_filename: `clinical-media-${UPLOAD_ID}.jpg`,
    mime_type: "image/jpeg",
    expected_file_size_bytes: 4096,
    expected_sha256_digest: expectedDigest,
    object_key: objectKey,
    storage_provider: "s3",
    storage_region: "ap-south-1",
    status: "reserved",
    expires_at: "2026-07-10T09:10:00.000Z",
    created_by_user_id: ACTOR_ID,
    created_at: NOW,
    completed_at: null,
    media_asset_id: null,
    tags: [],
    provenance: {}
  };
}

function mediaReceiptRow(input: {
  receiptFingerprint: string;
  providerArtifactFingerprint: string;
  sha256Digest: string;
  state: string;
  mismatchReason: string | null;
}): Record<string, unknown> {
  return {
    id: RECEIPT_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    upload_id: UPLOAD_ID,
    patient_id: PATIENT_ID,
    provider_key: "s3",
    receipt_fingerprint: input.receiptFingerprint,
    provider_artifact_fingerprint: input.providerArtifactFingerprint,
    content_length: 4096,
    mime_type: "image/jpeg",
    sha256_digest: input.sha256Digest,
    state: input.state,
    mismatch_reason: input.mismatchReason,
    stored_at: NOW,
    received_at: NOW,
    last_verified_at: NOW,
    consumed_at: null
  };
}

function appointmentRow(status: string): Record<string, unknown> {
  return {
    id: APPOINTMENT_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    row_version: 1,
    patient_id: PATIENT_ID,
    lead_id: null,
    provider_user_id: PROVIDER_ID,
    appointment_type_id: "10000000-0000-4000-8000-000000012001",
    chair_id: null,
    status,
    start_at: "2026-07-10T09:30:00.000Z",
    end_at: "2026-07-10T10:00:00.000Z",
    source: "manual",
    reason: null,
    notes: null,
    created_at: NOW,
    updated_at: NOW
  };
}

function queueRow(status: string): Record<string, unknown> {
  return {
    id: QUEUE_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    row_version: 1,
    appointment_id: APPOINTMENT_ID,
    patient_id: PATIENT_ID,
    provider_user_id: PROVIDER_ID,
    status,
    position: 4,
    checked_in_at: NOW,
    called_at: NOW,
    completed_at: null
  };
}

function providerEventRow(input: {
  rawBodySha256: string;
  signatureSha256: string;
  normalizedEventSha256: string;
}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    tenant_id: TENANT_ID,
    clinic_id: CLINIC_ID,
    external_account_id: ACCOUNT_ID,
    provider_key: "razorpay",
    provider_event_id: "pay_event_001",
    idempotency_key: "razorpay:pay_event_001",
    event_type: "payment.captured",
    event_kind: "payment_captured",
    raw_body_sha256: input.rawBodySha256,
    signature_sha256: input.signatureSha256,
    normalized_event_sha256: input.normalizedEventSha256,
    normalized_event: { providerEventId: "pay_event_001", amountMinor: 1000 },
    evidence_state: "verified",
    processing_status: "processing",
    mismatch_reason: null,
    lease_owner: "worker-cp13",
    lease_expires_at: "2026-07-10T09:05:00.000Z",
    attempt_count: 1,
    result_digest: null,
    result_projection: null,
    received_at: NOW,
    processed_at: null
  };
}

function paymentAccountRow(
  providerKey: "razorpay" | "simulator",
  accountStatus: "available" | "degraded" | "unavailable" | "not_configured",
  systemStatus: "available" | "degraded" | "unavailable" | "not_configured",
  capabilityKeys: string[]
): Record<string, unknown> {
  return {
    id: ACCOUNT_ID,
    provider_key: providerKey,
    account_status: accountStatus,
    system_status: systemStatus,
    capability_keys: capabilityKeys
  };
}

function paymentRequestIntentRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: INTENT_ID,
    tenant_id: values[0],
    clinic_id: values[1],
    external_account_id: values[2],
    provider_key: values[13],
    required_capability: values[14],
    invoice_id: values[3],
    patient_id: PATIENT_ID,
    idempotency_key: values[4],
    request_digest: values[5],
    request_type: values[6],
    amount_minor: values[7],
    currency: values[8],
    provider_safe_request: JSON.parse(String(values[9])),
    status: "claimed",
    lease_owner: values[10],
    lease_expires_at: values[11],
    attempt_count: 1,
    payment_request_id: null,
    provider_artifact_fingerprint: null,
    result_digest: null,
    result_projection: null,
    mismatch_reason: null,
    requested_at: values[12],
    processed_at: null
  };
}
