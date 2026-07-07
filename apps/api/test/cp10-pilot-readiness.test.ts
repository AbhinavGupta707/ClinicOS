import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import {
  createClinicOsApiServer,
  getPilotReadiness,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;

test("CP10 pilot readiness exposes local configuration separately from live go-live gaps", async () => {
  const dependencies = dependenciesForCp10();
  const owner = await operationsContext("seed-owner", "cp10-owner-readiness");
  const accountant = await operationsContext("seed-accountant", "cp10-accountant-denied");

  await assert.rejects(() => getPilotReadiness(accountant, dependencies), /missing_permission/);

  const response = await getPilotReadiness(owner, dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.body.readiness.schemaVersion, "cp10.pilot_readiness.v1");
  assert.equal(response.body.readiness.localConfigurationStatus, "ready");
  assert.equal(response.body.readiness.pilotGoLiveStatus, "blocked");
  assert.equal(response.body.readiness.safety.noRealPhi, true);
  assert.equal(response.body.readiness.safety.noSecretValues, true);
  assert.ok(
    response.body.readiness.liveVerificationGaps.some(
      (gap) => gap.id === "provider-razorpay" && gap.status === "blocked"
    )
  );
  assert.ok(
    response.body.readiness.items.some(
      (item) => item.id === "workflow-checkout-payments-instructions" && item.status === "ready"
    )
  );

  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes("Provider success confirmed"), false);
  assert.equal(serialized.includes("RAZORPAY_KEY_SECRET"), false);
  assert.equal(serialized.includes("WHATSAPP_ACCESS_TOKEN"), false);
});

test("CP10 pilot readiness route is registered as a read-only owner surface", async (t) => {
  const server = createClinicOsApiServer({
    auditSink: new InMemoryAuditSink(),
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: new LocalFixtureClinicOperationsRepository(),
    useLocalAuthFixture: true
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Socket binding is blocked in this sandbox; run the CP10 route smoke outside the sandbox.");
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const ownerResponse = await fetch(`${baseUrl}/v1/pilot-readiness`, {
      headers: { "x-clinic-os-dev-subject": "seed-owner" }
    });
    assert.equal(ownerResponse.status, 200);
    const ownerBody = await ownerResponse.json();
    assert.equal(ownerBody.readiness.schemaVersion, "cp10.pilot_readiness.v1");
    assert.equal(ownerBody.readiness.pilotGoLiveStatus, "blocked");

    const accountantResponse = await fetch(`${baseUrl}/v1/pilot-readiness`, {
      headers: { "x-clinic-os-dev-subject": "seed-accountant" }
    });
    assert.equal(accountantResponse.status, 403);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

function dependenciesForCp10(): OperationsDependencies {
  return {
    auditSink: new InMemoryAuditSink(),
    repository: new LocalFixtureClinicOperationsRepository(),
    runtimeConfig: config
  };
}

async function operationsContext(
  subject: string,
  requestId: string
): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const principal = principalFromVerifiedKeycloakClaims(createClaims(subject), {
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    expectedIssuer,
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);
  assert.ok(snapshot);

  return {
    accessContext: buildAccessContext({
      clinicAssignments: snapshot.clinicAssignments,
      memberships: snapshot.memberships,
      principal,
      roleAssignments: snapshot.roleAssignments,
      tenant: snapshot.tenant,
      user: snapshot.user
    }),
    clinicId,
    ipAddress: "127.0.0.1",
    requestId,
    userAgent: "node-test"
  };
}

function createClaims(subject: string) {
  const issuedAt = Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000);
  return {
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: issuedAt + 300,
    iat: issuedAt,
    iss: expectedIssuer,
    sub: subject
  };
}

const config = {
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakClientId: "clinic-os-web",
    keycloakRealm: "clinic-os-local"
  },
  clinicOsEnv: "local",
  isProductionLike: false,
  nodeEnv: "development",
  operations: {
    alerting: {
      provider: "unconfigured"
    },
    backupRestore: {
      allowDestructive: false,
      drillMode: "dry_run",
      rpoMinutes: 60,
      rtoMinutes: 240
    },
    cloud: {
      accountId: "123456789012",
      drRegion: "ap-south-2",
      kmsKeyAlias: "alias/clinic-os-pilot-prod",
      primaryRegion: "ap-south-1",
      profile: "clinicos",
      terraformLockTable: "clinic-os-terraform-locks",
      terraformStateBucket: "clinic-os-terraform-state"
    }
  },
  pilotInputs: {
    appointmentExportPath: "fixtures/synthetic/appointments.csv",
    patientExportPath: "fixtures/synthetic/patients.csv",
    pricebookPath: "fixtures/synthetic/pricebook.csv",
    syntheticDataOnly: true,
    templatesDir: "fixtures/synthetic/templates",
    xraySampleDir: "fixtures/synthetic/media"
  },
  providers: {
    ai: {
      llmProvider: "simulator",
      transcriptionProvider: "simulator"
    },
    payment: {
      provider: "razorpay",
      qrMode: "payment_link_qr",
      razorpayKeyId: "present",
      razorpayKeySecret: "present",
      razorpayWebhookSecret: "present"
    },
    telephony: {
      provider: "unconfigured",
      regionSubdomain: "api.in.exotel.com"
    },
    whatsapp: {
      accessToken: "present",
      appId: "present",
      appSecret: "present",
      appSecretProofRequired: false,
      businessAccountId: "present",
      phoneNumberId: "present",
      provider: "meta_cloud",
      webhookVerifyToken: "present"
    }
  },
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  storage: {
    bucket: "clinic-os-local",
    region: "ap-south-1"
  }
};
