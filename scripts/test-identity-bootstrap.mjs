import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresIdentityRepository } from "@clinic-os/db";

// Invoked only by the loopback synthetic repository gate. Every mutation below
// is rolled back, including when an assertion fails. Never run against clinic data.
export async function testIssuerBoundIdentityBootstrap(pool) {
  const client = await pool.connect();
  const tenantA = "10000000-0000-4000-8000-000000000001";
  const tenantB = "20000000-0000-4000-8000-000000000001";
  const userA = "10000000-0000-4000-8000-000000001001";
  const userB = "20000000-0000-4000-8000-000000001001";
  const subject = `synthetic-issuer-collision-${randomUUID()}`;
  const issuerA = "https://synthetic-a.example/realms/clinic-os";
  const issuerB = "https://synthetic-b.example/realms/clinic-os";
  const repository = new PostgresIdentityRepository({
    inTransaction: true,
    query: (sql, values) => client.query(sql, values)
  });
  const tables = [
    "memberships",
    "clinic_user_assignments",
    "user_role_assignments",
    "clinics",
    "roles"
  ];
  try {
    await client.query("begin");
    const privilege = await client.query(
      "select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user"
    );
    assert.deepEqual(privilege.rows, [
      { rolname: "clinic_os_runtime", rolsuper: false, rolbypassrls: false }
    ]);
    await client.query(
      `insert into user_identities (user_id, provider, issuer, subject)
       values ($1, 'keycloak', $2, $5), ($3, 'keycloak', $4, $5)`,
      [userA, issuerA, userB, issuerB, subject]
    );
    for (const [issuer, tenantId, userId] of [
      [issuerA, tenantA, userA],
      [issuerB, tenantB, userB]
    ]) {
      // An ambient tenant must not broaden the identity bootstrap query.
      await client.query("select set_config('app.tenant_id', $1, true)", [
        tenantId === tenantA ? tenantB : tenantA
      ]);
      const snapshot = await repository.findAccessByKeycloakIdentity({ issuer, subject });
      assert.equal(snapshot?.tenant.id, tenantId);
      assert.equal(snapshot?.user.id, userId);
      assert.ok(snapshot.clinics.length > 0);
      assert.ok(snapshot.clinics.every((clinic) => clinic.tenantId === tenantId));
      assert.ok(
        snapshot.roleAssignments.every(
          (role) => role.userId === userId && role.tenantId === tenantId
        )
      );

      const afterLookup = await client.query(
        "select nullif(current_setting('app.identity_issuer', true), '') as issuer, nullif(current_setting('app.identity_subject', true), '') as subject"
      );
      assert.deepEqual(
        afterLookup.rows,
        [{ issuer: null, subject: null }],
        "leased transactions must not retain bootstrap read authority"
      );
      await client.query(
        "select set_config('app.identity_issuer', $1, true), set_config('app.identity_subject', $2, true)",
        [issuer, subject]
      );

      for (const table of tables) {
        // Table names are a fixed test-only allowlist, never external input.
        const visible = await client.query(`select distinct tenant_id from ${table}`);
        assert.deepEqual(
          visible.rows,
          [{ tenant_id: tenantId }],
          `${table}: issuer must isolate bootstrap reads`
        );
        const updated = await client.query(`update ${table} set id = id returning id`);
        assert.equal(updated.rowCount, 0, `${table}: bootstrap cannot update`);
        const deleted = await client.query(`delete from ${table} returning id`);
        assert.equal(deleted.rowCount, 0, `${table}: bootstrap cannot delete`);
      }
      // INSERT is also denied without a tenant context, even with a valid identity.
      await client.query("savepoint forbidden_bootstrap_insert");
      await assert.rejects(
        client.query(
          "insert into roles (tenant_id, slug, display_name) values ($1, $2, 'Synthetic denied role')",
          [tenantId, `denied-${randomUUID()}`]
        ),
        { code: "42501" }
      );
      await client.query("rollback to savepoint forbidden_bootstrap_insert");
    }
    for (const issuer of ["", "https://unregistered.example/realms/clinic-os"]) {
      await client.query("select set_config('app.identity_issuer', $1, true)", [issuer]);
      for (const table of tables) {
        assert.equal(
          (await client.query(`select id from ${table}`)).rowCount,
          0,
          `${table}: subject alone grants no access`
        );
      }
    }
    assert.equal(
      await repository.findAccessByKeycloakIdentity({
        issuer: issuerA,
        subject: `${subject}-unknown`
      }),
      null
    );
    assert.equal(
      await repository.findAccessByKeycloakIdentity({ issuer: `${issuerA}/`, subject }),
      null,
      "issuer spelling must not be normalized"
    );

    // An active second tenant with no clinic assignment is still ambiguous.
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantB]);
    await client.query("insert into memberships (tenant_id, user_id) values ($1, $2)", [
      tenantB,
      userA
    ]);
    assert.equal(await repository.findAccessByKeycloakIdentity({ issuer: issuerA, subject }), null);
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantB]);
    await client.query(
      "update memberships set status = 'suspended' where tenant_id = $1 and user_id = $2",
      [tenantB, userA]
    );
    assert.equal(
      (await repository.findAccessByKeycloakIdentity({ issuer: issuerA, subject }))?.tenant.id,
      tenantA
    );

    // Normal explicitly scoped application writes remain governed by the tenant policy.
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    const allowed = await client.query(
      "update memberships set status = status where tenant_id = $1 and user_id = $2 returning id",
      [tenantA, userA]
    );
    assert.equal(allowed.rowCount, 1);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  }
}
