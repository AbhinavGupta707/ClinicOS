import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyFixtureCommitMigrationBatch,
  applyFixtureReplayDeadLetter,
  applyFixtureResolveMigrationConflict,
  classifyCp7EndpointFailures,
  commitLiveMigrationBatch,
  createLiveMigrationBatch,
  createFixtureCp7IntegrationOpsData,
  getCanonicalMigrationCsvTemplate,
  loadCp7IntegrationOps,
  loadLiveCp7IntegrationOps,
  replayLiveDeadLetterEvent,
  resolveLiveMigrationConflict,
  rollbackLiveMigrationBatch
} from "@/lib/cp7-integration-ops";

describe("CP7 integration ops workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows provider availability honestly without live success claims", () => {
    const data = createFixtureCp7IntegrationOpsData("2026-07-07");

    expect(data.providers.find((provider) => provider.id === "whatsapp-cloud")).toMatchObject({
      mode: "configured/degraded",
      status: "degraded"
    });
    expect(data.providers.find((provider) => provider.id === "telephony-exotel")).toMatchObject({
      mode: "provider unavailable",
      status: "unavailable"
    });
    expect(data.providers.find((provider) => provider.id === "google-business")).toMatchObject({
      mode: "manual/source only",
      status: "not_configured"
    });
    expect(data.providers.find((provider) => provider.id === "razorpay")).toMatchObject({
      mode: "sandbox webhook URL missing",
      status: "degraded"
    });
    expect(data.providers.find((provider) => provider.id === "practo-source")).toMatchObject({
      mode: "awaiting authorized access contract",
      status: "not_configured"
    });
    expect(JSON.stringify(data)).not.toContain("Provider success confirmed");
  });

  it("replays a dead-letter event as reviewed fixture evidence only", () => {
    const data = createFixtureCp7IntegrationOpsData("2026-07-07");
    const replayed = applyFixtureReplayDeadLetter(data, {
      actorName: "owner fixture user",
      deadLetterEventId: "cp7DeadLetterWhatsappStatus",
      reason: "Reviewed failed provider event."
    });

    expect(replayed.deadLetters[0]).toMatchObject({
      attempts: 4,
      status: "replayed"
    });
    expect(replayed.timeline[0]?.kind).toBe("dead_letter.replayed");
    expect(JSON.stringify(replayed.deadLetters[0])).not.toMatch(/\b(delivered|read)\b/i);
  });

  it("requires duplicate review before migration commit and preserves rejected rows", () => {
    const data = createFixtureCp7IntegrationOpsData("2026-07-07");

    expect(() =>
      applyFixtureCommitMigrationBatch(data, {
        actorName: "owner fixture user",
        batchId: "cp7MigrationBatchRayPatients"
      })
    ).toThrow(/Resolve migration conflicts/);

    const resolved = applyFixtureResolveMigrationConflict(data, {
      actorName: "owner fixture user",
      batchId: "cp7MigrationBatchRayPatients",
      conflictId: "cp7ConflictDuplicatePatient",
      resolution: "keep_existing_verified_record"
    });
    const resolvedBatch = resolved.migrationBatches[0]!;

    expect(resolvedBatch.status).toBe("ready_to_commit");
    expect(resolvedBatch.commit.state).toBe("ready");

    const committed = applyFixtureCommitMigrationBatch(resolved, {
      actorName: "owner fixture user",
      batchId: "cp7MigrationBatchRayPatients"
    });
    const committedBatch = committed.migrationBatches[0]!;

    expect(committedBatch.status).toBe("committed");
    expect(committedBatch.commit.committedRows).toBe(2);
    expect(committedBatch.rows.find((row) => row.id === "cp7MigrationRowRejectedPatient")).toMatchObject({
      status: "rejected"
    });
  });

  it("classifies missing CP7 route registration before runtime debugging", () => {
    expect(
      classifyCp7EndpointFailures([
        {
          endpoint: "GET /v1/provider-health",
          message: "Not found",
          status: 404
        }
      ])
    ).toMatchObject({
      code: "CP7_ENDPOINT_NOT_REGISTERED",
      message:
        "One or more CP7 integration endpoints are not registered in this environment. Check route registration and official activation before debugging permissions or runtime state."
    });
  });

  it("returns a missing-route state when fixture mode is not active", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE", "false");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: "Not found"
            }
          },
          404
        )
      )
    );

    const state = await loadCp7IntegrationOps();

    expect(state.status).toBe("unavailable");
    expect("problem" in state ? state.problem : null).toMatchObject({
      code: "CP7_ENDPOINT_NOT_REGISTERED"
    });
  });

  it("uses the documented live CP7 route family", async () => {
    const fixture = createFixtureCp7IntegrationOpsData("2026-07-07");
    const durableProviders = fixture.providers.map((provider) =>
      provider.id === "razorpay"
        ? {
            ...provider,
            activationState: "sandbox_verified" as const,
            lastFailureCode: null,
            lastReconciledAt: "2026-07-07T10:12:00+05:30",
            lastVerifiedCallbackAt: "2026-07-07T10:14:00+05:30",
            productionVerifiedAt: null,
            sandboxVerifiedAt: "2026-07-07T10:10:00+05:30"
          }
        : provider
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url === "http://localhost/v1/provider-health") {
        expect(init?.method).toBeUndefined();
        return jsonResponse({ providers: durableProviders });
      }

      if (url === "http://localhost/v1/dead-letter-events?status=unreviewed") {
        expect(init?.method).toBeUndefined();
        return jsonResponse({ deadLetterEvents: fixture.deadLetters });
      }

      if (url === "http://localhost/v1/migration-batches" && init?.method === undefined) {
        expect(init?.method).toBeUndefined();
        return jsonResponse({
          migrationBatches: [
            {
              batch: {
                committedRowCount: 0,
                conflictRowCount: 1,
                createdAt: "2026-07-07T08:30:00+05:30",
                id: "cp7MigrationBatchRayPatients",
                readyRowCount: 1,
                importType: "patients",
                rowCount: 1,
                sourceSystem: "authorized_manual_contract",
                state: "needs_review"
              },
              conflicts: [
                {
                  conflictType: "duplicate_patient",
                  id: "cp7ConflictDuplicatePatient",
                  rowId: "cp7MigrationRowDuplicatePatient",
                  status: "open",
                  summary: "Existing verified ClinicOS patient with same phone; keep existing record.",
                  targetRecordId: "cp7ExistingPatient",
                  targetRecordType: "patient"
                }
              ],
              rows: [
                {
                  externalRecordId: "ray-patient-002",
                  id: "cp7MigrationRowDuplicatePatient",
                  importType: "patients",
                  matchStatus: "duplicate_candidate",
                  normalizedRecord: {
                    fullName: "Synthetic duplicate candidate",
                    phone: "+919999997002"
                  },
                  rowNumber: 3,
                  status: "needs_review"
                }
              ]
            },
            {
              batch: {
                committedRowCount: 0,
                conflictRowCount: 1,
                createdAt: "2026-07-07T08:35:00+05:30",
                id: "practitionerBatch",
                importType: "practitioners",
                readyRowCount: 0,
                rowCount: 1,
                sourceSystem: "another_authorized_source",
                state: "needs_review"
              },
              conflicts: [],
              rows: [
                {
                  externalRecordId: "external-doctor-1",
                  id: "practitionerRow",
                  importType: "practitioners",
                  matchStatus: "conflict",
                  normalizedRecord: {
                    displayName: "External Doctor"
                  },
                  rowNumber: 1,
                  status: "needs_review"
                }
              ]
            }
          ]
        });
      }

      if (url === "http://localhost/v1/migration-batches" && init?.method === "POST") {
        return jsonResponse({ batch: { id: "createdMigrationBatch" } }, 201);
      }

      if (url.endsWith("/v1/dead-letter-events/cp7DeadLetterWhatsappStatus/replay")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ replay: { status: "accepted" } });
      }

      if (
        url.endsWith(
          "/v1/migration-batches/cp7MigrationBatchRayPatients/rows/cp7MigrationRowDuplicatePatient/resolve"
        )
      ) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ row: { status: "ready_to_commit" } });
      }

      if (url.endsWith("/v1/migration-batches/cp7MigrationBatchRayPatients/commit")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ migrationBatch: { status: "committed" } });
      }

      if (url.endsWith("/v1/migration-batches/cp7MigrationBatchRayPatients/rollback")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          batch: { state: "partially_committed" },
          blockedLinks: [
            {
              metadata: {
                rollbackBlockedReason: "Imported patient has downstream clinical dependencies."
              }
            }
          ]
        });
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadLiveCp7IntegrationOps(undefined, "2026-07-07");
    await replayLiveDeadLetterEvent("cp7DeadLetterWhatsappStatus", {
      reason: "Reviewed failed provider event."
    });
    await resolveLiveMigrationConflict(
      "cp7MigrationBatchRayPatients",
      "cp7MigrationRowDuplicatePatient",
      {
        action: "link_existing",
        notes: "Keep existing verified ClinicOS record.",
        targetRecordId: "cp7ExistingPatient",
        targetRecordType: "patient"
      }
    );
    await commitLiveMigrationBatch("cp7MigrationBatchRayPatients");
    const created = await createLiveMigrationBatch({
      csv: getCanonicalMigrationCsvTemplate("patients"),
      importType: "patients",
      sourceFileName: "trial.csv",
      sourceSystem: "authorized_manual_contract"
    });
    const rollback = await rollbackLiveMigrationBatch("cp7MigrationBatchRayPatients");

    expect(loaded.status).toBe("ready");
    expect(
      "data" in loaded
        ? loaded.data.providers.find((provider) => provider.id === "razorpay")
        : null
    ).toMatchObject({
      activationState: "sandbox_verified",
      lastReconciledAt: "2026-07-07T10:12:00+05:30",
      lastVerifiedCallbackAt: "2026-07-07T10:14:00+05:30",
      productionVerifiedAt: null,
      sandboxVerifiedAt: "2026-07-07T10:10:00+05:30"
    });
    expect("data" in loaded ? loaded.data.migrationBatches[0]?.conflicts[0] : null).toMatchObject({
      conflictType: "duplicate_patient",
      rowId: "cp7MigrationRowDuplicatePatient",
      targetRecordId: "cp7ExistingPatient"
    });
    expect("data" in loaded ? loaded.data.migrationBatches[0]?.sourceSystem : null).toBe(
      "authorized_manual_contract"
    );
    expect("data" in loaded ? loaded.data.migrationBatches[1]?.rows[0]?.target : null).toBe(
      "practitioner"
    );
    expect(created.batchId).toBe("createdMigrationBatch");
    expect(rollback).toMatchObject({
      blockedCount: 1,
      blockedReasons: ["Imported patient has downstream clinical dependencies."],
      state: "partially_committed"
    });
    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "http://localhost/v1/provider-health",
      "http://localhost/v1/dead-letter-events?status=unreviewed",
      "http://localhost/v1/migration-batches",
      "http://localhost/v1/dead-letter-events/cp7DeadLetterWhatsappStatus/replay",
      "http://localhost/v1/migration-batches/cp7MigrationBatchRayPatients/rows/cp7MigrationRowDuplicatePatient/resolve",
      "http://localhost/v1/migration-batches/cp7MigrationBatchRayPatients/commit",
      "http://localhost/v1/migration-batches",
      "http://localhost/v1/migration-batches/cp7MigrationBatchRayPatients/rollback"
    ]);

    const replayBody = JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string);
    expect(replayBody).toEqual({ reason: "Reviewed failed provider event." });

    const commitBody = JSON.parse(fetchMock.mock.calls[5]?.[1]?.body as string);
    expect(commitBody).toEqual({});

    const resolveBody = JSON.parse(fetchMock.mock.calls[4]?.[1]?.body as string);
    expect(resolveBody).toEqual({
      action: "link_existing",
      note: "Keep existing verified ClinicOS record.",
      targetRecordId: "cp7ExistingPatient",
      targetRecordType: "patient"
    });

    const createBody = JSON.parse(fetchMock.mock.calls[6]?.[1]?.body as string);
    expect(createBody).toMatchObject({
      importType: "patients",
      sourceFileName: "trial.csv",
      sourceSystem: "authorized_manual_contract"
    });

    const rollbackBody = JSON.parse(fetchMock.mock.calls[7]?.[1]?.body as string);
    expect(rollbackBody).toEqual({});
  });

  it("preserves actionable API error detail for live mutations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: "Migration batch has unresolved duplicate or conflict rows."
            }
          },
          422
        )
      )
    );

    await expect(commitLiveMigrationBatch("cp7MigrationBatchRayPatients")).rejects.toThrow(
      "Migration batch has unresolved duplicate or conflict rows."
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}
