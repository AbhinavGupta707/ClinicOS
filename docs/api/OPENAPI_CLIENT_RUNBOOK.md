# OpenAPI and Generated Client Runbook

## Regenerate

From the repository root:

```sh
npm --workspace @clinic-os/api-contracts run generate
```

Generation writes the namespaced native OpenAPI document, native route inventory, and generated
client. It is deterministic and offline.

## Verify drift and route coverage

```sh
npm --workspace @clinic-os/api-contracts run check:generated
npm --workspace @clinic-os/api-contracts run check:inventory
npm --workspace @clinic-os/api-client-generated run typecheck
npm --workspace @clinic-os/api-client-generated test
npm --workspace @clinic-os/api-client-generated run build
```

`check:generated` renders all artifacts in memory and byte-compares them with the checked-in files.
It then runs the native route-discovery comparison. Missing artifacts, nondeterministic output,
manual generated-client edits, route additions and stale contracts fail the command.

## Change procedure

1. Change the runtime schema/operation registry, not the JSON or generated client.
2. Add success and negative schema tests, including unknown-field and authority-field cases.
3. Regenerate.
4. Review OpenAPI, client and route-inventory diffs together.
5. Run package typecheck/test/build plus both drift/inventory gates.
6. If an app route or root script/export is needed, record the exact integration patch for the
   master. Contract-lane code must not modify app registration or root manifests/lockfile.

Never hand-edit generated artifacts to conceal drift. Never add a route solely to preserve an old
fixture. Provider/device/FHIR/ABDM workflows remain absent until their official activation gates are
met.
