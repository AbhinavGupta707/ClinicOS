import type { MeProfile } from "./me";
import { normalizeRole } from "./roles";
import type { ClinicRole } from "./roles";

const DEFAULT_DEV_ROLE: ClinicRole = "assistant";

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
      id: "synthetic-clinic",
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
      id: "synthetic-tenant",
      name: "ClinicOS Synthetic Tenant"
    },
    user: {
      displayName: `${role.replace("_", " ")} fixture user`,
      email: "fixture.user@example.test",
      id: `synthetic-${role}`
    }
  };
}
