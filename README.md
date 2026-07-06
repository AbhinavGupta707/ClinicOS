# ClinicOS

ClinicOS India is a dental-first, production-grade clinic operating system for Indian private clinics.

Start with the project specs:

- `AGENTS.md`
- `clinic_os_specs_v2/README.md`
- `clinic_os_specs_v2/16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md`
- `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md`

Checkpoint 0 establishes this Git-backed monorepo baseline. Checkpoint 1 starts the production platform foundation.

## Developer Commands

ClinicOS uses npm workspaces with a committed `package-lock.json`.

```sh
npm ci
npm run check
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm run test --workspaces --if-present
npm run build --workspaces --if-present
```

Local dependencies for platform work:

```sh
npm run local:up
npm run local:ps
npm run local:logs
npm run local:down
```

The local stack starts Postgres, Redis, Temporal, Temporal UI, and Keycloak. Runtime apps are registered by their owning lanes; until then `npm run dev:web`, `npm run dev:api`, `npm run dev:worker`, and `npm run dev:mobile` report the missing runtime activation path instead of pretending a product app exists.

## Environment Contract

Copy `.env.example` to `.env.local` for local development. The shared `@clinic-os/config` package validates the template and blocks `simulator` providers in `staging`, `pilot-prod`, and `prod`. Use `unconfigured` in production-like environments when a provider is intentionally unavailable.
