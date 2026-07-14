import assert from "node:assert/strict";
import test from "node:test";
import { buildClinicalSummaryDocument } from "../../../packages/fhir/src/index.ts";
import {
  createInteroperabilityHandlers,
  type AuthenticatedInteroperabilityContext,
  type InteroperabilityExchangeService,
  type ReviewClinicalSummaryImportCommand
} from "../src/features/cp16-interoperability/index.ts";
import {
  consentFixture,
  GENERATED_AT,
  IDS,
  sourceFixture
} from "../../../packages/fhir/test/cp16-fixture.ts";

test("CP16 handlers expose core R4 capability while ABDM stays honestly unregistered", () => {
  const handlers = createHandlers(fakeService());
  const capability = handlers.capability();
  assert.equal(capability.status, 200);
  assert.equal((capability.body as { fhirVersion: string }).fhirVersion, "4.0.1");

  const abdm = handlers.abdmCapability();
  assert.equal(abdm.status, 503);
  assert.equal((abdm.body as { resourceType: string }).resourceType, "OperationOutcome");
  assert.match(JSON.stringify(abdm.body), /ndhm\.in#6\.5\.0/u);
});

test("CP16 export handler requires canonical strong If-Match and emits CP12 headers", async () => {
  let expectedSourceVersion: number | null = null;
  const artifact = exportArtifact();
  const service = fakeService({
    async exportClinicalSummary(command) {
      expectedSourceVersion = command.expectedSourceVersion;
      return {
        artifact,
        exchangeId: IDS.bundle,
        replayed: true,
        status: "completed"
      };
    }
  });
  const handlers = createHandlers(service);
  const response = await handlers.exportClinicalSummary({
    body: {
      recipient: { type: "authorized_organization", identifier: "authorized-recipient-1" }
    },
    context: context(),
    encounterId: IDS.encounter,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "idempotency-key": "cp16-handler-export-0001",
      "if-match": '"rv-7"'
    },
    patientId: IDS.patient,
    requestId: "request-handler-export-0001"
  });
  assert.equal(expectedSourceVersion, 7);
  assert.equal(response.status, 200);
  assert.equal(response.headers.etag, '"rv-7"');
  assert.equal(response.headers["idempotency-replayed"], "true");
  assert.equal(response.headers["x-clinicos-idempotency-replayed"], undefined);

  const weak = await handlers.exportClinicalSummary({
    body: {
      recipient: { type: "authorized_organization", identifier: "authorized-recipient-1" }
    },
    context: context(),
    encounterId: IDS.encounter,
    headers: {
      "content-type": "application/json",
      "idempotency-key": "cp16-handler-export-0002",
      "if-match": 'W/"rv-7"'
    },
    patientId: IDS.patient,
    requestId: "request-handler-export-0002"
  });
  assert.equal(weak.status, 428);
});

test("CP16 import/review handlers use one reconciliation ETag and no patient-version header", async () => {
  let reviewCommand: ReviewClinicalSummaryImportCommand | null = null;
  const service = fakeService({
    async importClinicalSummary() {
      return {
        bundleDigest: "a".repeat(64),
        candidateCount: 1,
        encounterId: IDS.encounter,
        patientId: IDS.patient,
        quarantineReason: null,
        reconciliationId: IDS.bundle,
        reconciliationVersion: 1,
        replayed: false,
        status: "pending_review"
      };
    },
    async reviewClinicalSummaryImport(command) {
      reviewCommand = command;
      return {
        effects: {
          auditAppended: true,
          clinicalStateApplied: false,
          outboxAppended: true,
          patientMerged: false
        },
        encounterId: IDS.encounter,
        patientId: IDS.patient,
        reconciliationId: IDS.bundle,
        reconciliationVersion: 2,
        status: "accepted_pending_apply"
      };
    }
  });
  const handlers = createHandlers(service);
  const wrongMediaType = await handlers.importClinicalSummary({
    context: context(),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "cp16-handler-import-media-0001",
      "if-match": '"rv-4"'
    },
    patientId: IDS.patient,
    rawBody: Buffer.from(JSON.stringify(exportArtifact().bundle), "utf8"),
    requestId: "request-handler-import-media-0001"
  });
  assert.equal(wrongMediaType.status, 415);

  const imported = await handlers.importClinicalSummary({
    context: context(),
    headers: {
      "content-type": "application/fhir+json",
      "idempotency-key": "cp16-handler-import-0001",
      "if-match": '"rv-4"'
    },
    patientId: IDS.patient,
    rawBody: Buffer.from(JSON.stringify(exportArtifact().bundle), "utf8"),
    requestId: "request-handler-import-0001"
  });
  assert.equal(imported.status, 202);
  assert.equal(imported.headers.etag, '"rv-1"');
  assert.equal(imported.headers["idempotency-replayed"], "false");

  const reviewed = await handlers.reviewClinicalSummaryImport({
    body: { decision: "accept", reason: "Reviewed exact source evidence." },
    context: context(),
    headers: { "content-type": "application/json", "if-match": '"rv-1"' },
    reconciliationId: IDS.bundle,
    requestId: "request-handler-review-0001"
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.headers.etag, '"rv-2"');
  assert.equal(reviewCommand?.expectedReconciliationVersion, 1);
  assert.equal(
    reviewCommand ? "expectedPatientVersion" in reviewCommand : true,
    false,
    "patient version is loaded from the staged reconciliation, never a review header"
  );
});

function createHandlers(service: InteroperabilityExchangeService) {
  return createInteroperabilityHandlers({
    abdmActivation: null,
    now: () => new Date(GENERATED_AT),
    service
  });
}

function fakeService(
  overrides: Partial<
    Pick<
      InteroperabilityExchangeService,
      "exportClinicalSummary" | "importClinicalSummary" | "reviewClinicalSummaryImport"
    >
  > = {}
): InteroperabilityExchangeService {
  return {
    async exportClinicalSummary() {
      throw new Error("unexpected export call");
    },
    async importClinicalSummary() {
      throw new Error("unexpected import call");
    },
    async reviewClinicalSummaryImport() {
      throw new Error("unexpected review call");
    },
    ...overrides
  } as unknown as InteroperabilityExchangeService;
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
