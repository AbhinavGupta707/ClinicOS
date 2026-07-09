import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const requiredPaths = [
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  ".npmrc",
  ".nvmrc",
  ".env.example",
  ".github/workflows/quality.yml",
  "docker-compose.yml",
  "tsconfig.base.json",
  "eslint.config.mjs",
  "prettier.config.mjs",
  "vitest.config.ts",
  "clinic_os_specs_v2/16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md",
  "clinic_os_specs_v2/17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md",
  "clinic_os_specs_v2/18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md",
  "clinic_os_specs_v2/19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md",
  "clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md",
  "clinic_os_specs_v2/21_EXECUTION_INPUTS_AND_CREDENTIALS.md",
  "clinic_os_specs_v2/22_CREDENTIAL_SETUP_GUIDE.md",
  "apps/web/package.json",
  "apps/api/package.json",
  "apps/worker/package.json",
  "apps/mobile/package.json",
  "packages/domain/package.json",
  "packages/integrations/package.json",
  "packages/workflow/package.json",
  "packages/config/src/index.ts",
  "packages/config/src/index.test.ts",
  "infra/docker/postgres/init/001-local-databases.sql",
  "infra/docker/keycloak/realm-import/clinic-os-local.json",
  "infra/docker/temporal/dynamicconfig/development-sql.yaml",
  "infra/runbooks/local-development.md",
  "docs/orchestration/CHECKPOINT_LOG.md",
  "docs/orchestration/orchestration.env.example",
  "fixtures/synthetic/patients.csv",
  "fixtures/synthetic/appointments.csv",
  "fixtures/synthetic/pricebook.csv",
  "fixtures/synthetic/templates/consent_recording_ai.md",
  "fixtures/synthetic/transcripts/consultation_001.txt"
];

const missing = requiredPaths.filter((path) => !existsSync(join(process.cwd(), path)));

if (missing.length > 0) {
  console.error("Missing required checkpoint-zero paths:");
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

if (!Array.isArray(packageJson.workspaces) || packageJson.workspaces.length < 2) {
  console.error("package.json must define npm workspaces for apps and packages.");
  process.exit(1);
}

if (packageJson.packageManager !== "npm@10.9.7") {
  console.error("package.json must pin npm@10.9.7 as the package manager.");
  process.exit(1);
}

const requiredRootScripts = [
  "check",
  "check:env",
  "check:clock",
  "ci",
  "typecheck",
  "lint",
  "test",
  "build",
  "security:audit",
  "security:secrets",
  "local:up",
  "local:down",
  "db:migrate",
  "db:migrate:validate",
  "db:bootstrap",
  "db:verify",
  "db:test:migrations",
  "db:test:repositories",
  "api:test:readiness",
  "cp11:smoke:api",
  "dev:web",
  "dev:api",
  "dev:worker",
  "dev:mobile"
];

const missingScripts = requiredRootScripts.filter((script) => !packageJson.scripts?.[script]);
if (missingScripts.length > 0) {
  console.error("package.json is missing required root scripts:");
  for (const script of missingScripts) console.error(`- ${script}`);
  process.exit(1);
}

const packageLock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
if (packageLock.lockfileVersion !== 3) {
  console.error("package-lock.json must use lockfileVersion 3 for deterministic npm installs.");
  process.exit(1);
}

const typescriptWorkspaces = ["apps", "packages"].flatMap((root) =>
  readdirSync(join(process.cwd(), root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((workspace) => existsSync(join(process.cwd(), workspace, "package.json")))
    .filter((workspace) => existsSync(join(process.cwd(), workspace, "src")))
    .filter((workspace) =>
      readdirSync(join(process.cwd(), workspace, "src"), { recursive: true }).some(
        (entry) => String(entry).endsWith(".ts") || String(entry).endsWith(".tsx")
      )
    )
);

const invalidTypecheckWorkspaces = [];
for (const workspace of typescriptWorkspaces) {
  const manifestPath = join(process.cwd(), workspace, "package.json");
  const tsconfigPath = join(process.cwd(), workspace, "tsconfig.json");
  if (!existsSync(manifestPath) || !existsSync(tsconfigPath)) {
    invalidTypecheckWorkspaces.push(`${workspace}: missing package.json or tsconfig.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const typecheck = String(manifest.scripts?.typecheck ?? "");
  if (!/\btsc\b/.test(typecheck) || /node\s+--check/.test(typecheck)) {
    invalidTypecheckWorkspaces.push(`${workspace}: typecheck must invoke tsc, not node --check`);
  }
  const build = String(manifest.scripts?.build ?? "");
  if (build && /node\s+--check/.test(build)) {
    invalidTypecheckWorkspaces.push(
      `${workspace}: build must not claim TypeScript safety via node --check`
    );
  }
}

if (invalidTypecheckWorkspaces.length > 0) {
  console.error("Production TypeScript workspace coverage is invalid:");
  for (const issue of invalidTypecheckWorkspaces) console.error(`- ${issue}`);
  process.exit(1);
}

const canonicalMigrations = readdirSync(join(process.cwd(), "packages/db/migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
const migrationVersions = canonicalMigrations.map((name) => Number.parseInt(name.slice(0, 4), 10));
const expectedMigrationVersions = Array.from(
  { length: migrationVersions.length },
  (_, index) => index + 1
);
if (
  canonicalMigrations.length < 14 ||
  migrationVersions.some((version, index) => version !== expectedMigrationVersions[index])
) {
  console.error(
    "Canonical SQL migrations must be contiguous from 0001 and include CP11 migrations."
  );
  process.exit(1);
}

const prettierIgnore = readFileSync(join(process.cwd(), ".prettierignore"), "utf8");
for (const userOwnedPath of ["research/", "scripts/research/"]) {
  if (!prettierIgnore.split(/\r?\n/u).includes(userOwnedPath)) {
    console.error(`.prettierignore must preserve user-owned ${userOwnedPath}`);
    process.exit(1);
  }
}

console.log(
  `Workspace structure is valid; ${typescriptWorkspaces.length} production TypeScript workspaces use tsc typechecks and ${canonicalMigrations.length} migrations are contiguous.`
);
