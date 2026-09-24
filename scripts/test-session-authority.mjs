import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresIdentityRepository } from "@clinic-os/db";
import { CurrentSessionAuthorityResolver } from "@clinic-os/auth";

// Called only by the existing guarded synthetic loopback repository gate. All changes roll back.
export async function testCurrentSessionAuthority(pool) {
  const identity = {
    issuer: "http://localhost:8080/realms/clinic-os-local",
    subject: "seed-owner"
  };
  const tenant = "10000000-0000-4000-8000-000000000001";
  const otherTenant = "20000000-0000-4000-8000-000000000001";
  const user = "10000000-0000-4000-8000-000000001001";
  const baseline = await new CurrentSessionAuthorityResolver(
    new PostgresIdentityRepository(pool)
  ).resolve(identity);
  const client = await pool.connect();
  const repository = new PostgresIdentityRepository({
    inTransaction: true,
    query: (sql, values) => client.query(sql, values)
  });
  const resolver = new CurrentSessionAuthorityResolver(repository);
  const scope = () =>
    client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.clinic_id', '', true)",
      [tenant]
    );
  const resolve = () => resolver.resolve(identity);
  try {
    await client.query("begin");
    assert.equal(
      (
        await client.query(
          "select rolsuper or rolbypassrls as elevated from pg_roles where rolname = current_user"
        )
      ).rows[0].elevated,
      false
    );
    assert.deepEqual(await resolve(), baseline);
    assert.deepEqual(await resolve(), baseline);
    for (const [table, condition, deactivate, restore] of [
      ["memberships", "tenant_id = $1 and user_id = $2", "status = 'revoked'", "status = 'active'"],
      [
        "clinic_user_assignments",
        "tenant_id = $1 and user_id = $2",
        "status = 'suspended'",
        "status = 'active'"
      ],
      [
        "user_role_assignments",
        "tenant_id = $1 and user_id = $2",
        "revoked_at = now()",
        "revoked_at = null"
      ]
    ]) {
      const before = await resolve();
      await scope();
      await client.query(`update ${table} set ${deactivate} where ${condition}`, [tenant, user]);
      assert.equal((await resolve()).active, false, `${table} revocation denies access`);
      await scope();
      await client.query(`update ${table} set ${restore} where ${condition}`, [tenant, user]);
      const after = await resolve();
      assert.equal(after.active, true);
      assert.notEqual(
        after.authorityRevision,
        before.authorityRevision,
        `${table} revoke/regrant must not resurrect authority`
      );
    }
    for (const [table, key, inactive, active] of [
      ["users", user, "disabled", "active"],
      ["tenants", tenant, "suspended", "active"],
      ["clinics", "10000000-0000-4000-8000-000000000101", "inactive", "active"]
    ]) {
      const before = await resolve();
      await scope();
      await client.query(`update ${table} set status = $2 where id = $1`, [key, inactive]);
      assert.equal((await resolve()).active, false);
      await scope();
      await client.query(`update ${table} set status = $2 where id = $1`, [key, active]);
      assert.notEqual((await resolve()).authorityRevision, before.authorityRevision);
    }
    const beforeSecondMembership = await resolve();
    await client.query("select set_config('app.tenant_id', $1, true)", [otherTenant]);
    await client.query("insert into memberships (tenant_id, user_id) values ($1, $2)", [
      otherTenant,
      user
    ]);
    assert.equal((await resolve()).active, false);
    await client.query("select set_config('app.tenant_id', $1, true)", [otherTenant]);
    await client.query("delete from memberships where tenant_id = $1 and user_id = $2", [
      otherTenant,
      user
    ]);
    assert.notEqual((await resolve()).authorityRevision, beforeSecondMembership.authorityRevision);

    const beforePermission = await resolve();
    await scope();
    const role = (
      await client.query("select id from roles where tenant_id = $1 and slug = 'owner_admin'", [
        tenant
      ])
    ).rows[0].id;
    await client.query(
      "delete from role_permissions where role_id = $1 and permission_key = 'patient.read'",
      [role]
    );
    await assert.rejects(resolve(), /Installed role permissions differ/);
    await scope();
    await client.query(
      "insert into role_permissions (role_id, permission_key) values ($1, 'patient.read')",
      [role]
    );
    assert.notEqual((await resolve()).authorityRevision, beforePermission.authorityRevision);
    await scope();
    await client.query("update roles set slug = 'unknown_synthetic_role' where id = $1", [role]);
    await assert.rejects(resolve(), /Installed role permissions differ/);
    await scope();
    await client.query("update roles set slug = 'owner_admin' where id = $1", [role]);

    const beforeOtherTenant = await resolve();
    await client.query("update tenants set display_name = display_name where id = $1", [
      otherTenant
    ]);
    assert.deepEqual(
      await resolve(),
      beforeOtherTenant,
      "unrelated tenant changes do not revoke this user"
    );
    const beforeAlias = await resolve();
    await client.query(
      "update user_identities set email_at_provider = email_at_provider where user_id = $1",
      [user]
    );
    assert.notEqual((await resolve()).authorityRevision, beforeAlias.authorityRevision);
    await scope();
    const userGeneration = (
      await client.query("select authority_generation from users where id = $1", [user])
    ).rows[0].authority_generation;
    await client.query("update users set authority_generation = $2 where id = $1", [
      user,
      userGeneration
    ]);
    assert.notEqual(
      (await client.query("select authority_generation from users where id = $1", [user])).rows[0]
        .authority_generation,
      userGeneration,
      "callers cannot restore an old generation"
    );

    // Moving an identity/assignment must invalidate both the former and new owner.
    const newUser = randomUUID();
    await client.query(
      "insert into users (id, display_name) values ($1, 'Synthetic authority move')",
      [newUser]
    );
    const generations = async () =>
      (
        await client.query(
          "select id, authority_generation from users where id = any($1::uuid[]) order by id",
          [[user, newUser]]
        )
      ).rows;
    for (const [table, predicate, parameters] of [
      [
        "user_identities",
        "provider = 'keycloak' and issuer = $2 and subject = $3",
        [identity.issuer, identity.subject]
      ],
      ["user_role_assignments", "tenant_id = $2 and role_id = $3", [tenant, role]]
    ]) {
      const before = await generations();
      await scope();
      const moved = await client.query(
        `update ${table} set user_id = $1 where user_id = $4 and ${predicate}`,
        [newUser, ...parameters, user]
      );
      assert.equal(moved.rowCount, 1);
      const after = await generations();
      assert.ok(
        after.every(
          (row, index) => row.authority_generation !== before[index].authority_generation
        ),
        `${table}: invalidate both owners`
      );
      await client.query(`update ${table} set user_id = $1 where user_id = $4 and ${predicate}`, [
        user,
        ...parameters,
        newUser
      ]);
    }

    // Role-grant writes cannot target a hidden parent role in another tenant.
    const foreignRole = randomUUID();
    await client.query("select set_config('app.tenant_id', $1, true)", [otherTenant]);
    await client.query(
      "insert into roles (id, tenant_id, slug, display_name) values ($1, $2, $3, 'Synthetic foreign role')",
      [foreignRole, otherTenant, `synthetic-${foreignRole}`]
    );
    await scope();
    for (const [sql, values] of [
      [
        "insert into role_permissions (role_id, permission_key) values ($1, 'patient.read')",
        [foreignRole]
      ],
      [
        "update role_permissions set role_id = $1 where role_id = $2 and permission_key = 'patient.read'",
        [foreignRole, role]
      ]
    ]) {
      await client.query("savepoint denied_foreign_grant");
      await assert.rejects(client.query(sql, values), { code: "42501" });
      await client.query("rollback to savepoint denied_foreign_grant");
    }
  } finally {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  }
  assert.deepEqual(
    await new CurrentSessionAuthorityResolver(new PostgresIdentityRepository(pool)).resolve(
      identity
    ),
    baseline,
    "authority and generation mutations roll back together"
  );
  console.log(
    JSON.stringify({
      currentSessionAuthority: "pass",
      revokeRegrant: "pass",
      permissionDrift: "denied",
      rollback: "pass"
    })
  );
}
