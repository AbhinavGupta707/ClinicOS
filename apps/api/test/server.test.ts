import assert from "node:assert/strict";
import test from "node:test";
import {
  createClinicOsApiServer,
  InMemoryAuditSink,
  LocalFixtureIdentityRepository
} from "../src/index.ts";

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

test("API health and local synthetic /v1/me fixture boot through HTTP", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    auditSink,
    useLocalAuthFixture: true
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
    const health = await fetch(`${baseUrl}/health/ready`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ready");

    const me = await fetch(`${baseUrl}/v1/me`, {
      headers: {
        "x-clinic-os-dev-subject": "seed-assistant"
      }
    });

    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.user.email, "assistant@demo.clinicos.local");
    assert.equal(body.clinics[0].displayName, "Synthetic Dental Clinic");
    assert.equal(body.permissions.includes("schedule.write"), true);
    assert.equal(auditSink.events.length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});
