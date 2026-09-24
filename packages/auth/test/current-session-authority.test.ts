import assert from "node:assert/strict";
import test from "node:test";
import {
  CurrentSessionAuthorityResolver,
  type CurrentIdentityAuthorityRepository
} from "../src/current-session-authority.ts";

type Snapshot = NonNullable<
  Awaited<ReturnType<CurrentIdentityAuthorityRepository["findAccessByKeycloakIdentity"]>>
>;
const identity = { issuer: "https://identity.example/realms/clinic", subject: "synthetic-subject" };
function snapshot(): Snapshot {
  return {
    authorityRevision: "a".repeat(64),
    tenant: {
      id: "tenant-a",
      slug: "tenant-a",
      legalName: "Synthetic",
      displayName: "Synthetic",
      status: "active"
    },
    user: { id: "user-a", displayName: "Synthetic", email: null, phone: null, status: "active" },
    memberships: [{ tenantId: "tenant-a", userId: "user-a", status: "active" }],
    clinicAssignments: [
      { tenantId: "tenant-a", clinicId: "clinic-a", userId: "user-a", status: "active" }
    ],
    roleAssignments: [
      { tenantId: "tenant-a", clinicId: "clinic-a", userId: "user-a", roleSlug: "doctor" }
    ],
    clinics: [
      {
        id: "clinic-a",
        tenantId: "tenant-a",
        slug: "clinic-a",
        displayName: "Synthetic",
        timezone: "Asia/Kolkata",
        status: "active"
      }
    ]
  };
}

test("authority reads current exact identity on every call and binds the persisted generation", async () => {
  let current = snapshot();
  let calls = 0;
  const resolver = new CurrentSessionAuthorityResolver({
    async findAccessByKeycloakIdentity(input) {
      assert.deepEqual(input, identity);
      calls++;
      return current;
    }
  });
  const before = await resolver.resolve(identity);
  assert.equal(before.active, true);
  assert.match(before.authorityRevision, /^[0-9a-f]{64}$/);
  assert.deepEqual(await resolver.resolve(identity), before);
  current = { ...current, authorityRevision: "b".repeat(64) };
  assert.notEqual((await resolver.resolve(identity)).authorityRevision, before.authorityRevision);
  assert.equal(calls, 3);
});

test("inactive, missing, ambiguous and unusable clinic authority cannot admit a session", async () => {
  const mutations: Array<(s: Snapshot) => void> = [
    (s) => {
      s.tenant.status = "suspended";
    },
    (s) => {
      s.user.status = "disabled";
    },
    (s) => {
      s.memberships = [];
    },
    (s) => {
      s.memberships = [
        ...s.memberships,
        { tenantId: "tenant-b", userId: "user-a", status: "active" }
      ];
    },
    (s) => {
      s.clinics[0].status = "inactive";
    },
    (s) => {
      s.clinics = [];
    },
    (s) => {
      s.clinicAssignments = [];
    },
    (s) => {
      s.roleAssignments = [];
    },
    (s) => {
      s.roleAssignments[0].clinicId = "clinic-b";
    },
    (s) => {
      s.roleAssignments[0].userId = "another-user";
    }
  ];
  for (const change of mutations) {
    const current = snapshot();
    change(current);
    const resolver = new CurrentSessionAuthorityResolver({
      findAccessByKeycloakIdentity: async () => current
    });
    assert.equal((await resolver.resolve(identity)).active, false);
  }
  assert.equal(
    (
      await new CurrentSessionAuthorityResolver({
        findAccessByKeycloakIdentity: async () => null
      }).resolve(identity)
    ).active,
    false
  );
});

test("tenant-wide roles apply only to clinics present in the verified repository snapshot", async () => {
  const current = snapshot();
  current.roleAssignments[0].clinicId = null;
  current.clinicAssignments = [];
  const resolver = new CurrentSessionAuthorityResolver({
    findAccessByKeycloakIdentity: async () => current
  });
  assert.equal((await resolver.resolve(identity)).active, true);
  current.clinics = [];
  assert.equal((await resolver.resolve(identity)).active, false);
});

test("dependency failure and invalid generations throw rather than pretending identity was revoked", async () => {
  for (const repository of [
    {
      findAccessByKeycloakIdentity: async () => {
        throw new Error("synthetic outage");
      }
    },
    { findAccessByKeycloakIdentity: async () => ({ ...snapshot(), authorityRevision: "" }) }
  ])
    await assert.rejects(new CurrentSessionAuthorityResolver(repository).resolve(identity));
});
