import type { MeProfile } from "./me";
import { normalizeRole } from "./roles";
import type { ClinicRole } from "./roles";

const DEFAULT_DEV_ROLE: ClinicRole = "assistant";

// Keep the explicitly local-only fixture aligned with the durable seed scope so generated clients
// exercise the real clinic selector and identity-shaped identifiers.
const LOCAL_SEED_TENANT_ID = "10000000-0000-4000-8000-000000000001";
const LOCAL_SEED_CLINIC_ID = "10000000-0000-4000-8000-000000000101";
const LOCAL_SEED_USER_IDS: Record<ClinicRole, string> = {
  owner: "10000000-0000-4000-8000-000000001001",
  doctor: "10000000-0000-4000-8000-000000001002",
  assistant: "10000000-0000-4000-8000-000000001003",
  receptionist: "10000000-0000-4000-8000-000000001004",
  accountant: "10000000-0000-4000-8000-000000001005",
  platform_admin: "10000000-0000-4000-8000-000000001007"
};

export function getDevFixtureRole(): ClinicRole {
  const configuredRole = normalizeRole(process.env.NEXT_PUBLIC_CLINIC_OS_DEV_ROLE);

  return configuredRole ?? DEFAULT_DEV_ROLE;
}

export function isDevFixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && ["development", "dev", "local", "test"].includes(environment);
}

export function createSyntheticMeFixture(): MeProfile {
  const role = getDevFixtureRole();

  return {
    api: {
      environment: "local",
      requestId: "fixture-local",
      serverTime: new Date().toISOString()
    },
    clinic: {
      id: LOCAL_SEED_CLINIC_ID,
      name: "Synthetic Dental Clinic",
      timezone: "Asia/Kolkata"
    },
    featureFlags: {
      checkpoint_1_web_shell: true,
      dev_fixture: true
    },
    permissions: ["shell.read", "me.read"],
    roles: [role],
    source: "dev_fixture",
    tenant: {
      id: LOCAL_SEED_TENANT_ID,
      name: "ClinicOS Synthetic Tenant"
    },
    user: {
      displayName: `${role.replace("_", " ")} fixture user`,
      email: "fixture.user@example.test",
      id: LOCAL_SEED_USER_IDS[role]
    }
  };
}
