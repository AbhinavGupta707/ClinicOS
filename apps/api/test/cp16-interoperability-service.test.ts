import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClinicalSummaryDocument,
  ClinicOsFhirError,
  patientIdentifierSystem,
  type InteroperabilityConsentDecision
} from "../../../packages/fhir/src/index.ts";
import {
  consentFixture,
  GENERATED_AT,
  IDS,
  sourceFixture
} from "../../../packages/fhir/test/cp16-fixture.ts";
import {
  InteroperabilityExchangeService,
  type AuthenticatedInteroperabilityContext,
  type ImportReconciliationRecord,
  type InteroperabilityClinicalSourcePort,
  type InteroperabilityConsentPort,
  type InteroperabilityDurableReconciliationPort,
  type InteroperabilityExportResult,
  type InteroperabilityImportResult,
  type InteroperabilityReconciliationTransaction
} from "../src/features/cp16-interoperability/index.ts";

const RECONCILIATION_ID = "30000000-0000-4000-8000-000000000012";

test("CP16 export is tenant-scoped, consent-checked on replay and durably idempotent", async () => {
  const harness = createHarness();
  const command = exportCommand();
  const first = await harness.service.exportClinicalSummary(command);
  const replay = await harness.service.exportClinicalSummary(command);

  assert.equal(first.status, "completed");
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.artifact.digest.value, first.artifact.digest.value);
  assert.equal(harness.consentCalls.length, 2, "consent must be rechecked before replay");
  assert.equal(harness.store.exports.size, 1);

  harness.consentStatus = "revoked";
  await assert.rejects(
    harness.service.exportClinicalSummary(command),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 409
  );
});

test("CP16 export rejects stale versions, cross-scope sources and idempotency conflicts", async () => {
  const stale = createHarness();
  await assert.rejects(
    stale.service.exportClinicalSummary({ ...exportCommand(), expectedSourceVersion: 6 }),
    (error) => outcomeCode(error) === "FHIR_SOURCE_VERSION_CONFLICT"
  );

  const harness = createHarness();
  await harness.service.exportClinicalSummary(exportCommand());
  await assert.rejects(
    harness.service.exportClinicalSummary({
      ...exportCommand(),
      recipient: { type: "authorized_system", identifier: "different-recipient" }
    }),
    (error) => outcomeCode(error) === "FHIR_IDEMPOTENCY_CONFLICT"
  );

  const crossScope = sourceFixture();
  const cross = createHarness({
    source: {
      ...crossScope,
      clinic: { ...crossScope.clinic, tenantId: "40000000-0000-4000-8000-000000000001" }
    }
  });
  await assert.rejects(
    cross.service.exportClinicalSummary(exportCommand()),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 403
  );
});

test("CP16 import stages one exact match, replays idempotently and never auto-merges", async () => {
  const harness = createHarness();
  const artifact = exportArtifact();
  const command = importCommand(artifact.bundle);
  const first = await harness.service.importClinicalSummary(command);
  const replay = await harness.service.importClinicalSummary(command);

  assert.equal(first.status, "pending_review");
  assert.equal(first.quarantineReason, null);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(harness.store.appliedCount, 0, "staging must not mutate clinical truth");
  assert.equal(harness.store.imports.get(RECONCILIATION_ID)?.status, "pending_review");
  assert.equal(
    harness.consentCalls.filter((call) => call.action === "clinical_summary_import").length,
    2
  );
});

test("CP16 import quarantines ambiguous exact identifiers and review rechecks identity/version/consent", async () => {
  const harness = createHarness({ ambiguous: true });
  const result = await harness.service.importClinicalSummary({
    ...importCommand(exportArtifact().bundle),
    idempotencyKey: "cp16-import-ambiguous-0001"
  });
  assert.equal(result.status, "quarantined");
  assert.equal(result.quarantineReason, "ambiguous_exact_match");
  assert.equal(harness.store.appliedCount, 0);

  const exact = createHarness();
  await exact.service.importClinicalSummary(importCommand(exportArtifact().bundle));
  const reviewed = await exact.service.reviewClinicalSummaryImport({
    context: context(),
    decision: "accept",
    expectedReconciliationVersion: 1,
    reason: "Reviewed against the signed synthetic source.",
    reconciliationId: RECONCILIATION_ID,
    requestId: "request-review-0001"
  });
  assert.equal(reviewed.status, "applied");
  assert.equal(exact.store.appliedCount, 1);

  await assert.rejects(
    exact.service.reviewClinicalSummaryImport({
      context: context(),
      decision: "accept",
      expectedReconciliationVersion: 1,
      reason: "Stale replay.",
      reconciliationId: RECONCILIATION_ID,
      requestId: "request-review-0002"
    }),
    (error) => error instanceof ClinicOsFhirError && [404, 409].includes(error.httpStatus)
  );
});

test("CP16 durable reconciliation unavailable is explicit and retry-classified", async () => {
  const harness = createHarness({ available: false });
  await assert.rejects(
    harness.service.exportClinicalSummary(exportCommand()),
    (error) =>
      error instanceof ClinicOsFhirError &&
      error.httpStatus === 503 &&
      error.retryable === true &&
      outcomeCode(error) === "FHIR_RECONCILIATION_UNAVAILABLE"
  );

  const unsafeTestDouble = createHarness({ allowInMemory: false });
  await assert.rejects(
    unsafeTestDouble.service.exportClinicalSummary(exportCommand()),
    (error) => outcomeCode(error) === "FHIR_DURABLE_RECONCILIATION_REQUIRED"
  );
});

test("CP16 review failure evidence distinguishes unresolved reconciliation from a loaded patient", async () => {
  const invalidPatient = createHarness();
  await assert.rejects(
    invalidPatient.service.exportClinicalSummary({
      ...exportCommand(),
      patientId: "not-a-patient-uuid"
    }),
    (error) => outcomeCode(error) === "FHIR_IDENTIFIER_INVALID"
  );
  assert.deepEqual(invalidPatient.store.failures.at(-1), {
    code: "FHIR_IDENTIFIER_INVALID",
    scope: "unscoped"
  });

  const missing = createHarness();
  await assert.rejects(
    missing.service.reviewClinicalSummaryImport(reviewCommand()),
    (error) => outcomeCode(error) === "FHIR_RECONCILIATION_NOT_FOUND"
  );
  assert.deepEqual(missing.store.failures.at(-1), {
    code: "FHIR_RECONCILIATION_NOT_FOUND",
    scope: "unscoped"
  });

  const loaded = createHarness();
  await loaded.service.importClinicalSummary(importCommand(exportArtifact().bundle));
  loaded.consentStatus = "revoked";
  await assert.rejects(
    loaded.service.reviewClinicalSummaryImport(reviewCommand()),
    (error) => outcomeCode(error) === "FHIR_CONSENT_REVOKED"
  );
  assert.deepEqual(loaded.store.failures.at(-1), {
    code: "FHIR_CONSENT_REVOKED",
    scope: "patient"
  });
});

test("CP16 rejects a durable applied label without atomic clinical, audit and outbox evidence", async () => {
  const harness = createHarness();
  await harness.service.importClinicalSummary(importCommand(exportArtifact().bundle));
  harness.store.invalidAppliedEvidence = true;
  await assert.rejects(
    harness.service.reviewClinicalSummaryImport(reviewCommand()),
    (error) => outcomeCode(error) === "FHIR_RECONCILIATION_EFFECT_INVALID"
  );
  assert.equal(harness.store.appliedCount, 0);
});

function createHarness(
  options: {
    allowInMemory?: boolean;
    available?: boolean;
    ambiguous?: boolean;
    source?: ReturnType<typeof sourceFixture>;
  } = {}
) {
  const store = new InMemoryReconciliationPort(options.available ?? true);
  const consentCalls: Array<{ action: string }> = [];
  const source = options.source ?? sourceFixture();
  const harness = {
    consentStatus: "active" as InteroperabilityConsentDecision["status"]
  };
  const consent: InteroperabilityConsentPort = {
    async authorize(input) {
      consentCalls.push({ action: input.action });
      return consentFixture({
        action: input.action,
        evaluatedAt: input.evaluatedAt,
        recipient: input.recipient,
        status: harness.consentStatus,
        revokedAt: harness.consentStatus === "revoked" ? input.evaluatedAt : null
      });
    }
  };
  const clinicalSource: InteroperabilityClinicalSourcePort = {
    async loadClinicalSummary(input) {
      if (input.patientId !== source.patient.id || input.encounterId !== source.encounter.id)
        return { kind: "not_found" };
      if (input.expectedSourceVersion !== source.sourceVersion)
        return { kind: "version_conflict", actualVersion: source.sourceVersion };
      return { kind: "found", source };
    },
    async findExactPatientMatches() {
      const identifiers = [
        {
          system: patientIdentifierSystem(IDS.tenant, IDS.clinic),
          value: IDS.patient
        }
      ];
      const candidate = {
        tenantId: IDS.tenant,
        clinicId: IDS.clinic,
        patientId: IDS.patient,
        rowVersion: 4,
        identifiers
      };
      return options.ambiguous
        ? [candidate, { ...candidate, patientId: "30000000-0000-4000-8000-000000000013" }]
        : [candidate];
    },
    async findExactEncounterMatches() {
      return [
        {
          tenantId: IDS.tenant,
          clinicId: IDS.clinic,
          patientId: IDS.patient,
          encounterId: IDS.encounter,
          rowVersion: 7,
          identifiers: [
            {
              system: "https://fhir.clinicos.in/NamingSystem/encounter-id",
              value: IDS.encounter
            }
          ]
        }
      ];
    }
  };
  const service = new InteroperabilityExchangeService({
    clock: { now: () => new Date(GENERATED_AT) },
    consent,
    reconciliation: store,
    source: clinicalSource,
    ...(options.allowInMemory === false
      ? {}
      : { testOnlyAllowInMemoryReconciliation: true as const })
  });
  return Object.assign(harness, { service, store, consentCalls });
}

class InMemoryReconciliationPort implements InteroperabilityDurableReconciliationPort {
  readonly durability = "in_memory_test_double" as const;
  readonly exports = new Map<string, { digest: string; result?: InteroperabilityExportResult }>();
  readonly importClaims = new Map<
    string,
    { digest: string; result?: InteroperabilityImportResult }
  >();
  readonly imports = new Map<string, ImportReconciliationRecord>();
  readonly failures: Array<{ code: string; scope: string }> = [];
  private readonly available: boolean;
  appliedCount = 0;
  invalidAppliedEvidence = false;

  constructor(available: boolean) {
    this.available = available;
  }

  async readiness() {
    return this.available
      ? ({ status: "available" } as const)
      : ({ status: "unavailable", retryable: true } as const);
  }

  async loadImportForReview(input: { reconciliationId: string }) {
    return this.imports.get(input.reconciliationId) ?? null;
  }

  async transaction<T>(
    _context: AuthenticatedInteroperabilityContext,
    execute: (transaction: InteroperabilityReconciliationTransaction) => Promise<T>
  ): Promise<T> {
    return execute({
      claimExport: async (input) => {
        const existing = this.exports.get(input.idempotencyKey);
        if (existing) {
          if (existing.digest !== input.requestDigest) return { outcome: "conflict" } as const;
          if (!existing.result) return { outcome: "in_progress" } as const;
          return { outcome: "replay", result: existing.result } as const;
        }
        this.exports.set(input.idempotencyKey, { digest: input.requestDigest });
        return { outcome: "claimed", exchangeId: IDS.bundle } as const;
      },
      completeExport: async (input) => {
        assert.deepEqual(input.requiredAtomicEffects, ["exchange", "audit", "outbox"]);
        this.exports.set(
          input.result.exchangeId === IDS.bundle
            ? "cp16-export-idempotency-0001"
            : input.exchangeId,
          {
            digest: input.requestDigest,
            result: input.result
          }
        );
        return { exchangeStored: true, auditAppended: true, outboxAppended: true };
      },
      claimImport: async (input) => {
        const existing = this.importClaims.get(input.idempotencyKey);
        if (existing) {
          if (existing.digest !== input.requestDigest) return { outcome: "conflict" } as const;
          if (!existing.result) return { outcome: "in_progress" } as const;
          return { outcome: "replay", result: existing.result } as const;
        }
        this.importClaims.set(input.idempotencyKey, { digest: input.requestDigest });
        return { outcome: "claimed", reconciliationId: RECONCILIATION_ID } as const;
      },
      stageImport: async (input) => {
        assert.deepEqual(input.requiredAtomicEffects, ["reconciliation", "audit", "outbox"]);
        const claim = [...this.importClaims.entries()].find(([, value]) => !value.result);
        if (!claim) throw new Error("missing import claim");
        this.importClaims.set(claim[0], { digest: claim[1].digest, result: input.result });
        this.imports.set(input.reconciliationId, {
          encounterId: input.encounterId,
          expectedEncounterVersion: input.expectedEncounterVersion,
          expectedPatientVersion: input.expectedPatientVersion,
          identifiers: input.minimized.patientIdentifiers,
          minimized: input.minimized,
          patientId: input.patientId,
          reconciliationId: input.reconciliationId,
          reconciliationVersion: input.result.reconciliationVersion,
          status: input.result.status
        });
        return { reconciliationStaged: true, auditAppended: true, outboxAppended: true };
      },
      completeImportReview: async (input) => {
        const record = this.imports.get(input.reconciliationId);
        if (!record) return { outcome: "not_found" } as const;
        if (record.reconciliationVersion !== input.expectedReconciliationVersion)
          return { outcome: "reconciliation_version_conflict" } as const;
        if (record.expectedEncounterVersion !== input.expectedEncounterVersion)
          return { outcome: "state_conflict" } as const;
        if (record.expectedPatientVersion !== input.expectedPatientVersion)
          return { outcome: "patient_version_conflict" } as const;
        if (record.status !== "pending_review" && input.decision === "accept")
          return { outcome: "state_conflict" } as const;
        if (input.decision === "accept") {
          assert.equal(input.application.mode, "apply_minimized");
          if (input.application.mode === "apply_minimized") {
            assert.equal(input.application.encounterId, record.encounterId);
            assert.equal(input.application.patientId, record.patientId);
            assert.deepEqual(input.application.minimized, record.minimized);
            assert.deepEqual(input.application.requiredAtomicEffects, [
              "clinical_state",
              "audit",
              "outbox"
            ]);
          }
        } else {
          assert.equal(input.application.mode, "reject_only");
        }
        const result = {
          effects: {
            auditAppended: true,
            clinicalStateApplied: input.decision === "accept" && !this.invalidAppliedEvidence,
            outboxAppended: true,
            patientMerged: false as const
          },
          encounterId: record.encounterId,
          patientId: record.patientId,
          reconciliationId: record.reconciliationId,
          reconciliationVersion: record.reconciliationVersion + 1,
          status: input.decision === "accept" ? ("applied" as const) : ("rejected" as const)
        };
        if (input.decision === "accept" && !this.invalidAppliedEvidence) this.appliedCount += 1;
        this.imports.delete(input.reconciliationId);
        return { outcome: "completed", result } as const;
      }
    });
  }

  async recordFailure(
    input: Parameters<InteroperabilityDurableReconciliationPort["recordFailure"]>[0]
  ) {
    this.failures.push({ code: input.failureCode, scope: input.scope.kind });
  }
}

function context(): AuthenticatedInteroperabilityContext {
  return {
    verified: true,
    tenantId: IDS.tenant,
    clinicId: IDS.clinic,
    actorUserId: IDS.actor,
    actorDisplayName: "Dr Synthetic",
    capabilities: new Set([
      "interoperability.fhir_r4.export",
      "interoperability.fhir_r4.import",
      "interoperability.fhir_r4.reconcile"
    ])
  };
}

function exportCommand() {
  return {
    context: context(),
    encounterId: IDS.encounter,
    expectedSourceVersion: 7,
    idempotencyKey: "cp16-export-idempotency-0001",
    patientId: IDS.patient,
    recipient: { type: "authorized_organization" as const, identifier: "authorized-recipient-1" },
    requestId: "request-export-0001"
  };
}

function importCommand(bundle: ReturnType<typeof exportArtifact>["bundle"]) {
  return {
    context: context(),
    expectedPatientVersion: 4,
    idempotencyKey: "cp16-import-idempotency-0001",
    patientId: IDS.patient,
    rawBody: Buffer.from(JSON.stringify(bundle), "utf8"),
    requestId: "request-import-0001"
  };
}

function reviewCommand() {
  return {
    context: context(),
    decision: "accept" as const,
    expectedReconciliationVersion: 1,
    reason: "Reviewed against exact patient and encounter evidence.",
    reconciliationId: RECONCILIATION_ID,
    requestId: "request-review-evidence-0001"
  };
}

function exportArtifact() {
  return buildClinicalSummaryDocument({
    actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
    bundleId: IDS.bundle,
    consent: consentFixture(),
    generatedAt: GENERATED_AT,
    source: sourceFixture()
  });
}

function outcomeCode(error: unknown): string | null {
  return error instanceof ClinicOsFhirError
    ? (error.outcome.issue[0]?.details?.coding?.[0]?.code ?? null)
    : null;
}
