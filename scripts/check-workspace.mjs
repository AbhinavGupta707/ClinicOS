import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredPaths = [
  "AGENTS.md",
  "package.json",
  ".env.example",
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

console.log("Checkpoint 0 workspace structure is valid.");
