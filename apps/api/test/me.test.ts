import test from "node:test";
import assert from "node:assert/strict";
import { getMe } from "../src/index.ts";

const tenant = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "demo-dental-care",
  legalName: "Demo Dental Care Private Limited",
  displayName: "Demo Dental Care",
  status: "active"
};

const clinic = {
  id: "10000000-0000-4000-8000-000000000101",
  tenantId: tenant.id,
  slug: "indiranagar",
  displayName: "Demo Dental Care Indiranagar",
  status: "active",
  timezone: "Asia/Kolkata"
};

test("/me returns tenant, clinic, role, permission, and Keycloak subject context", async () => {
  const auditEvents = [];
  const response = await getMe(
    {
      requestId: "req_test",
      verifiedKeycloakClaims: {
        sub: "seed-doctor",
        iss: "http://localhost:8080/realms/clinicos-local",
        aud: "clinicos-api",
        exp: Math.floor(new Date("2026-07-06T10:00:00Z").getTime() / 1000) + 300,
        name: "Dr Kabir Doctor"
      },
      ipAddress: "127.0.0.1",
      userAgent: "node-test"
    },
    {
      keycloak: {
        expectedIssuer: "http://localhost:8080/realms/clinicos-local",
        acceptedAudiences: ["clinicos-api"],
        now: new Date("2026-07-06T10:00:00Z")
      },
      identityRepository: {
        async findAccessByKeycloakSubject(subject) {
          assert.equal(subject, "seed-doctor");
          return {
            tenant,
            clinics: [clinic],
            user: {
              id: "10000000-0000-4000-8000-000000001002",
              displayName: "Dr Kabir Doctor",
              email: "doctor@demo.clinicos.local",
              phone: null,
              status: "active"
            },
            memberships: [
              {
                tenantId: tenant.id,
                userId: "10000000-0000-4000-8000-000000001002",
                status: "active"
              }
            ],
            clinicAssignments: [
              {
                tenantId: tenant.id,
                clinicId: clinic.id,
                userId: "10000000-0000-4000-8000-000000001002",
                status: "active"
              }
            ],
            roleAssignments: [
              {
                tenantId: tenant.id,
                clinicId: clinic.id,
                userId: "10000000-0000-4000-8000-000000001002",
                roleSlug: "doctor"
              }
            ]
          };
        }
      },
      auditSink: {
        async appendAuditEvent(event) {
          auditEvents.push(event);
        }
      }
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, "doctor@demo.clinicos.local");
  assert.equal(response.body.clinics[0].roleSlugs[0], "doctor");
  assert.equal(response.body.permissions.includes("clinical.note.sign"), true);
  assert.equal(response.body.permissions.includes("billing.export"), false);
  assert.equal(response.body.keycloak.subject, "seed-doctor");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "auth.session.resolved");
});

test("/me rejects an authenticated Keycloak identity that is not registered", async () => {
  await assert.rejects(
    () =>
      getMe(
        {
          requestId: "req_missing",
          verifiedKeycloakClaims: {
            sub: "missing-user",
            iss: "http://localhost:8080/realms/clinicos-local",
            aud: "clinicos-api",
            exp: Math.floor(new Date("2026-07-06T10:00:00Z").getTime() / 1000) + 300
          }
        },
        {
          keycloak: {
            expectedIssuer: "http://localhost:8080/realms/clinicos-local",
            acceptedAudiences: ["clinicos-api"],
            now: new Date("2026-07-06T10:00:00Z")
          },
          identityRepository: {
            async findAccessByKeycloakSubject() {
              return null;
            }
          }
        }
      ),
    /not registered/
  );
});
