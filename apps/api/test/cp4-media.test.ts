import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug, UUID } from "@clinic-os/domain";
import {
  completeMediaUpload,
  createClinicOsApiServer,
  createSignedMediaAccess,
  InMemoryAuditSink,
  listPatientMediaAssets,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  LocalMediaStorageSimulator,
  receiveMediaUploadContent,
  requestMediaUploadUrl,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

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

test("CP4 media upload completion and signed access keep object keys private and audited", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const mediaStorage = new LocalMediaStorageSimulator({ environment: "local" });
  const dependencies: OperationsDependencies = { repository, auditSink, mediaStorage };
  const assistant = await operationsContext("seed-assistant");
  const bytes = Buffer.from("synthetic intraoral photo bytes");
  const sha256Digest = sha256(bytes);

  const uploadResponse = await requestMediaUploadUrl(assistant, dependencies, {
    patientId,
    mediaType: "intraoral_photo",
    originalFilename: "Rhea Synthetic intraoral photo.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: bytes.byteLength,
    sha256Digest,
    toothNumber: "36",
    tags: ["pre-op", "tooth-36"],
    provenance: { kind: "manual_entry", capturedAt: "2026-07-07T09:30:00.000Z" }
  });

  assert.equal(uploadResponse.status, 201);
  assert.equal(uploadResponse.body.upload.patientId, patientId);
  assert.equal(uploadResponse.body.uploadTarget.method, "PUT");
  assert.equal("objectKey" in uploadResponse.body.upload, false);
  assert.doesNotMatch(JSON.stringify(uploadResponse.body), /objectKey|tenants\/|patients\//);

  const privateObjectKey = repository.mediaUploadReservations[0].objectKey;
  assert.match(privateObjectKey, /tenants\/10000000-0000-4000-8000-000000000001/);

  const uploaded = await receiveMediaUploadContent(
    assistant,
    dependencies,
    uploadResponse.body.upload.id,
    { body: bytes, contentType: "image/jpeg" }
  );
  assert.equal(uploaded.body.object.sha256Digest, sha256Digest);

  const completed = await completeMediaUpload(
    assistant,
    dependencies,
    uploadResponse.body.upload.id,
    {
      patientId,
      contentLength: bytes.byteLength,
      sha256Digest,
      mimeType: "image/jpeg",
      scanStatus: "clean"
    }
  );
  assert.equal(completed.status, 201);
  assert.equal("objectKey" in completed.body.mediaAsset, false);
  assert.equal(completed.body.mediaAsset.scanStatus, "clean");
  assert.doesNotMatch(JSON.stringify(completed.body), /objectKey|tenants\/|patients\//);

  const listed = await listPatientMediaAssets(assistant, dependencies, patientId);
  assert.equal(listed.body.mediaAssets.length, 1);
  assert.equal(listed.body.mediaAssets[0].id, completed.body.mediaAsset.id);

  const access = await createSignedMediaAccess(
    assistant,
    dependencies,
    completed.body.mediaAsset.id,
    { expiresInSeconds: 120 }
  );
  assert.equal(access.status, 200);
  assert.equal(access.body.access.method, "GET");
  assert.match(access.body.access.signedUrl, /media-access\/[0-9a-f-]+$/);
  assert.doesNotMatch(access.body.access.signedUrl, /tenants\/|patients\/|media\/.+\.(jpg|png)/);
  assert.doesNotMatch(JSON.stringify(access.body), /objectKey|tenants\/|patients\//);
  assert.ok(auditSink.events.some((event) => event.action === "media.upload_requested"));
  assert.ok(auditSink.events.some((event) => event.action === "media.upload_completed"));
  assert.ok(auditSink.events.some((event) => event.action === "media.viewed"));
});

test("CP4 media denies accountant and wrong-tenant access", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const mediaStorage = new LocalMediaStorageSimulator({ environment: "local" });
  const dependencies: OperationsDependencies = { repository, auditSink, mediaStorage };
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");
  const bytes = Buffer.from("synthetic xray bytes");
  const mediaAssetId = await createCompletedMediaAsset(assistant, dependencies, bytes);

  await assert.rejects(
    () =>
      requestMediaUploadUrl(accountant, dependencies, {
        patientId,
        mediaType: "xray",
        originalFilename: "blocked-accountant-xray.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: sha256(bytes)
      }),
    /missing_permission/
  );

  await assert.rejects(
    () => createSignedMediaAccess(accountant, dependencies, mediaAssetId, {}),
    /missing_permission/
  );

  const wrongTenant = wrongTenantDoctorContext();
  await assert.rejects(
    () => createSignedMediaAccess(wrongTenant, dependencies, mediaAssetId, {}),
    (error) => error instanceof Error && "status" in error && error.status === 404
  );
  assert.equal(auditSink.events.filter((event) => event.action === "media.viewed").length, 0);
});

test("CP4 local fixture API returns upload URL payloads without private object keys", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const operationsRepository = new LocalFixtureClinicOperationsRepository();
  const mediaStorage = new LocalMediaStorageSimulator({ environment: "local" });
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository,
    auditSink,
    mediaStorage,
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
      t.skip("Socket binding is blocked in this sandbox; run API media smoke outside it.");
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const bytes = Buffer.from("synthetic media route bytes");

    const response = await fetch(`${baseUrl}/v1/media/upload-urls`, {
      method: "POST",
      headers: assistantHeaders({
        "content-type": "application/json",
        "idempotency-key": "cp4-media-http-upload-url"
      }),
      body: JSON.stringify({
        patientId,
        mediaType: "document",
        originalFilename: "Rhea Synthetic referral.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: sha256(bytes),
        tags: ["referral"],
        provenance: { kind: "manual_import" }
      })
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.upload.patientId, patientId);
    assert.match(body.uploadTarget.uploadUrl, /^\/v1\/media\/uploads\/[0-9a-f-]+\/content$/);
    assert.doesNotMatch(JSON.stringify(body), /objectKey|tenants\/|patients\//);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function createCompletedMediaAsset(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  bytes: Buffer
): Promise<UUID> {
  const digest = sha256(bytes);
  const upload = await requestMediaUploadUrl(context, dependencies, {
    patientId,
    mediaType: "xray",
    originalFilename: "synthetic-xray.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: bytes.byteLength,
    sha256Digest: digest,
    provenance: { kind: "manual_import" }
  });
  await receiveMediaUploadContent(context, dependencies, upload.body.upload.id, {
    body: bytes,
    contentType: "image/jpeg"
  });
  const completed = await completeMediaUpload(context, dependencies, upload.body.upload.id, {
    patientId,
    contentLength: bytes.byteLength,
    sha256Digest: digest,
    mimeType: "image/jpeg",
    scanStatus: "clean"
  });
  return completed.body.mediaAsset.id;
}

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

function assistantHeaders(extra: Record<string, string> = {}) {
  return {
    "x-clinic-os-dev-subject": "seed-assistant",
    "x-clinic-id": CHECKPOINT1_SEED_IDS.clinicId,
    ...extra
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
