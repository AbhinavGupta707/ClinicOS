import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { UUID } from "@clinic-os/domain";
import {
  createClinicOsApiServer,
  getOwnerDashboard,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const tenantId = CHECKPOINT1_SEED_IDS.tenantId;
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;

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

test("CP6 owner dashboard operation returns aggregate source-backed metrics without PHI", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const owner = await operationsContext("seed-owner");
  const accountant = await operationsContext("seed-accountant");
  const assistant = await operationsContext("seed-assistant");

  const ownerResponse = await getOwnerDashboard(owner, dependencies, {
    from: "2026-07-01",
    to: "2026-07-07"
  });
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.body.dashboard.revenue.invoicedMinor, 1500000);
  assert.equal(ownerResponse.body.dashboard.revenue.collectedMinor, 900000);
  assert.equal(ownerResponse.body.dashboard.revenue.outstandingMinor, 600000);
  assert.ok(
    ownerResponse.body.dashboard.dataSources.some(
      (source) => source.key === "cp6-local-continuity-fixture"
    )
  );

  const accountantResponse = await getOwnerDashboard(accountant, dependencies, {
    from: "2026-07-01",
    to: "2026-07-07"
  });
  assert.equal(accountantResponse.status, 200);
  const serialized = JSON.stringify(accountantResponse.body.dashboard);
  assert.doesNotMatch(serialized, /Rhea Synthetic|\+919876543210|clinicalSummary|medicalHistory/i);

  await assert.rejects(
    () => getOwnerDashboard(assistant, dependencies, { from: "2026-07-01", to: "2026-07-07" }),
    /missing_permission/
  );
  await assert.rejects(
    () =>
      getOwnerDashboard(wrongClinicOwnerContext(owner), dependencies, {
        from: "2026-07-01",
        to: "2026-07-07"
      }),
    /clinic_mismatch/
  );

  assert.ok(auditSink.events.some((event) => event.action === "owner_dashboard.viewed"));
  assert.equal(
    auditSink.events.some(
      (event) => event.action === "owner_dashboard.viewed" && event.phiInvolved
    ),
    false
  );
});

test("CP6 owner dashboard route enforces analytics role and clinic scope", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: new LocalFixtureClinicOperationsRepository(),
    auditSink,
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
        "Socket binding is blocked in this sandbox; run the API boot smoke outside the sandbox."
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
    const path = "/v1/owner-dashboard?from=2026-07-01&to=2026-07-07";

    const owner = await fetch(`${baseUrl}${path}`, {
      headers: fixtureHeaders("seed-owner")
    });
    assert.equal(owner.status, 200);
    const ownerBody = await owner.json();
    assert.equal(ownerBody.dashboard.revenue.invoicedMinor, 1500000);
    assert.equal(JSON.stringify(ownerBody).includes("Rhea Synthetic"), false);

    const accountant = await fetch(`${baseUrl}${path}`, {
      headers: fixtureHeaders("seed-accountant")
    });
    assert.equal(accountant.status, 200);
    assert.equal(JSON.stringify(await accountant.json()).includes("+919876543210"), false);

    const assistant = await fetch(`${baseUrl}${path}`, {
      headers: fixtureHeaders("seed-assistant")
    });
    assert.equal(assistant.status, 403);
    assert.equal((await assistant.json()).error.details.reason, "missing_permission");

    const wrongClinic = await fetch(`${baseUrl}${path}`, {
      headers: fixtureHeaders("seed-owner", {
        "x-clinic-id": "20000000-0000-4000-8000-000000000101"
      })
    });
    assert.equal(wrongClinic.status, 403);
    assert.equal((await wrongClinic.json()).error.details.reason, "clinic_mismatch");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

async function operationsContext(subject: string): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const principal = principalFromVerifiedKeycloakClaims(createClaims(subject), {
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
    clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function wrongClinicOwnerContext(context: OperationsRequestContext): OperationsRequestContext {
  return {
    ...context,
    requestId: "req_wrong_clinic_owner",
    clinicId: "20000000-0000-4000-8000-000000000101" as UUID
  };
}

function fixtureHeaders(subject: string, extra: Record<string, string> = {}) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-clinic-os-dev-subject": subject,
    "x-clinic-id": clinicId,
    ...extra
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
