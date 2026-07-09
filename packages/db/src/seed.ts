import type { ClinicRoleSlug, UUID } from "@clinic-os/domain";

export const CHECKPOINT1_SEED_IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001" as UUID,
  clinicId: "10000000-0000-4000-8000-000000000101" as UUID,
  users: {
    owner: "10000000-0000-4000-8000-000000001001" as UUID,
    doctor: "10000000-0000-4000-8000-000000001002" as UUID,
    assistant: "10000000-0000-4000-8000-000000001003" as UUID,
    receptionist: "10000000-0000-4000-8000-000000001004" as UUID,
    accountant: "10000000-0000-4000-8000-000000001005" as UUID,
    auditor: "10000000-0000-4000-8000-000000001006" as UUID,
    platformAdmin: "10000000-0000-4000-8000-000000001007" as UUID
  },
  patients: {
    rheaSynthetic: "10000000-0000-4000-8000-000000002001" as UUID
  },
  appointmentTypes: {
    consultation: "10000000-0000-4000-8000-000000003001" as UUID
  },
  chairs: {
    operatoryOne: "10000000-0000-4000-8000-000000004001" as UUID
  },
  providerSchedules: {
    doctorWeekday: "10000000-0000-4000-8000-000000005001" as UUID
  }
} as const;

export const CHECKPOINT1_SEED_USERS: readonly {
  key: keyof typeof CHECKPOINT1_SEED_IDS.users;
  displayName: string;
  email: string;
  keycloakSubject: string;
  roleSlug: ClinicRoleSlug;
}[] = [
  {
    key: "owner",
    displayName: "Dr Ananya Owner",
    email: "owner@demo.clinicos.local",
    keycloakSubject: "seed-owner",
    roleSlug: "owner_admin"
  },
  {
    key: "doctor",
    displayName: "Dr Kabir Doctor",
    email: "doctor@demo.clinicos.local",
    keycloakSubject: "seed-doctor",
    roleSlug: "doctor"
  },
  {
    key: "assistant",
    displayName: "Meera Assistant",
    email: "assistant@demo.clinicos.local",
    keycloakSubject: "seed-assistant",
    roleSlug: "assistant"
  },
  {
    key: "receptionist",
    displayName: "Rohan Reception",
    email: "reception@demo.clinicos.local",
    keycloakSubject: "seed-receptionist",
    roleSlug: "receptionist"
  },
  {
    key: "accountant",
    displayName: "Priya Accounts",
    email: "accounts@demo.clinicos.local",
    keycloakSubject: "seed-accountant",
    roleSlug: "accountant"
  },
  {
    key: "auditor",
    displayName: "Asha Synthetic Auditor",
    email: "auditor@demo.clinicos.local",
    keycloakSubject: "seed-auditor",
    roleSlug: "auditor"
  },
  {
    key: "platformAdmin",
    displayName: "Dev Synthetic Platform Admin",
    email: "platform@demo.clinicos.local",
    keycloakSubject: "seed-platform-admin",
    roleSlug: "platform_admin"
  }
];
