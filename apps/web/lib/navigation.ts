import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  ClipboardPenLine,
  CreditCard,
  DatabaseBackup,
  FileText,
  FileSignature,
  HeartPulse,
  Home,
  Inbox,
  KeyRound,
  LineChart,
  ListTodo,
  LucideIcon,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  Wrench
} from "lucide-react";

import type { ClinicRole } from "./roles";

export type SurfaceAvailability = "active" | "registered_unavailable";

export interface SurfaceRegistration {
  availability: SurfaceAvailability;
  checkpoint: number;
  description: string;
  href: string;
  icon: LucideIcon;
  id: string;
  label: string;
  requiredApis: string[];
  roles: ClinicRole[];
}

const ALL_CLINIC_ROLES: ClinicRole[] = [
  "owner",
  "doctor",
  "assistant",
  "receptionist",
  "accountant"
];

export const SURFACES: SurfaceRegistration[] = [
  {
    availability: "active",
    checkpoint: 2,
    description:
      "Assistant day-start dashboard with leads, appointments, confirmations, and queue.",
    href: "/",
    icon: Home,
    id: "today",
    label: "Today",
    requiredApis: ["GET /v1/me", "GET /v1/appointments", "GET /v1/leads", "GET /v1/queue"],
    roles: ALL_CLINIC_ROLES
  },
  {
    availability: "active",
    checkpoint: 2,
    description: "Lead intake, message triage, patient match, and conversion status.",
    href: "/surface/lead-inbox",
    icon: Inbox,
    id: "lead-inbox",
    label: "Lead inbox",
    requiredApis: [
      "POST /v1/leads",
      "GET /v1/leads",
      "POST /v1/leads/{id}/match-patient",
      "POST /v1/leads/{id}/convert-to-appointment"
    ],
    roles: ["owner", "assistant", "receptionist"]
  },
  {
    availability: "active",
    checkpoint: 2,
    description: "Appointments, confirmations, queue, and check-in.",
    href: "/surface/appointments",
    icon: CalendarDays,
    id: "appointments",
    label: "Appointments",
    requiredApis: [
      "GET /v1/appointments",
      "POST /v1/appointments/{appointmentId}/confirm",
      "POST /v1/appointments/{appointmentId}/check-in",
      "GET /v1/queue"
    ],
    roles: ["owner", "doctor", "assistant", "receptionist"]
  },
  {
    availability: "active",
    checkpoint: 2,
    description: "Patient search, registration, duplicate review, and timeline access.",
    href: "/surface/patients",
    icon: UsersRound,
    id: "patients",
    label: "Patients",
    requiredApis: ["GET /v1/patients", "POST /v1/patients"],
    roles: ["owner", "doctor", "assistant", "receptionist"]
  },
  {
    availability: "active",
    checkpoint: 3,
    description: "Patient clinical profile, timeline, consent readiness, and visit context.",
    href: "/surface/patient-profile",
    icon: UsersRound,
    id: "patient-profile",
    label: "Patient profile",
    requiredApis: ["GET /v1/clinical-workflows/cp3?date="],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 3,
    description: "Digital intake and assistant-entered paper history card capture.",
    href: "/surface/intake",
    icon: ClipboardPenLine,
    id: "intake",
    label: "Intake",
    requiredApis: ["POST /v1/patients/{patientId}/form-responses"],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 3,
    description: "Consent capture, revocation, and AI/audio readiness enforcement state.",
    href: "/surface/consent",
    icon: ShieldCheck,
    id: "consent",
    label: "Consent",
    requiredApis: [
      "POST /v1/patients/{patientId}/consents",
      "POST /v1/patients/{patientId}/consents/{consentId}/revoke"
    ],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 3,
    description: "Returning-patient prep summary before the clinical visit starts.",
    href: "/surface/returning-prep",
    icon: UserRoundCheck,
    id: "returning-prep",
    label: "Patient prep",
    requiredApis: ["GET /v1/clinical-workflows/cp3?date="],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 3,
    description: "Encounter prep, note drafting, prescriptions, and clinical sign-off.",
    href: "/surface/encounter",
    icon: FileSignature,
    id: "encounter",
    label: "Encounter",
    requiredApis: [
      "POST /v1/encounters/{encounterId}/start",
      "PATCH /v1/encounters/{encounterId}",
      "POST /v1/encounters/{encounterId}/sign-note",
      "POST /v1/prescriptions/{prescriptionId}/sign"
    ],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 4,
    description: "Odontogram, tooth findings, media review, and comparison workspace.",
    href: "/surface/dental-media",
    icon: HeartPulse,
    id: "dental-media",
    label: "Dental and media",
    requiredApis: [
      "GET /v1/clinical-workflows/cp4?date=",
      "POST /v1/patients/{patientId}/dental-findings",
      "PATCH /v1/dental-findings/{findingId}",
      "POST /v1/media/upload-urls",
      "PUT /v1/media/uploads/{uploadId}/content",
      "POST /v1/media/uploads/{uploadId}/complete",
      "POST /v1/media/assets/{mediaAssetId}/signed-url"
    ],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 5,
    description: "Treatment plans, estimates, invoice state, payment collection, and receipts.",
    href: "/surface/checkout",
    icon: CreditCard,
    id: "checkout",
    label: "Checkout",
    requiredApis: [
      "GET /v1/pricebook/procedures",
      "POST /v1/patients/{patientId}/treatment-plans",
      "PATCH /v1/treatment-plans/{treatmentPlanId}",
      "POST /v1/treatment-plans/{treatmentPlanId}/accept",
      "POST /v1/encounters/{encounterId}/procedures",
      "POST /v1/invoices",
      "GET /v1/invoices/{invoiceId}",
      "POST /v1/invoices/{invoiceId}/payment-requests",
      "POST /v1/invoices/{invoiceId}/manual-payments",
      "POST /v1/invoices/{invoiceId}/receipts",
      "POST /v1/patients/{patientId}/instructions"
    ],
    roles: ["owner", "doctor", "assistant", "receptionist", "accountant"]
  },
  {
    availability: "active",
    checkpoint: 6,
    description: "Recalls, follow-ups, payment tasks, SOPs, and staff work queues.",
    href: "/surface/tasks",
    icon: ListTodo,
    id: "tasks",
    label: "Tasks and recalls",
    requiredApis: [
      "GET /v1/tasks?status=&dueDate=",
      "POST /v1/tasks",
      "PATCH /v1/tasks/{taskId}",
      "GET /v1/recalls?status=&dueBefore=",
      "POST /v1/recalls/{recallId}/actions",
      "GET /v1/sop-runs?date=",
      "PATCH /v1/sop-runs/{sopRunId}"
    ],
    roles: ["owner", "assistant", "receptionist"]
  },
  {
    availability: "active",
    checkpoint: 6,
    description: "Lab cases, slips, due work, returns, and reconciliation.",
    href: "/surface/lab",
    icon: ClipboardCheck,
    id: "lab",
    label: "Lab",
    requiredApis: [
      "POST /v1/lab-cases",
      "PATCH /v1/lab-cases/{labCaseId}",
      "GET /v1/lab-cases?status=&dueBefore=",
      "POST /v1/lab-reconciliations"
    ],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 6,
    description: "Inventory checks, stock exceptions, SOP runs, and event diary.",
    href: "/surface/operations",
    icon: PackageCheck,
    id: "operations",
    label: "Operations",
    requiredApis: [
      "POST /v1/inventory/check-runs",
      "PATCH /v1/inventory/check-runs/{checkRunId}",
      "GET /v1/inventory/exceptions",
      "POST /v1/incidents",
      "POST /v1/corrective-actions",
      "PATCH /v1/corrective-actions/{correctiveActionId}"
    ],
    roles: ["owner", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 6,
    description: "Source-attributed metrics, leakage views, audit review, and exports.",
    href: "/surface/owner-control",
    icon: LineChart,
    id: "owner-control",
    label: "Owner control",
    requiredApis: ["GET /v1/owner-dashboard?from=&to="],
    roles: ["owner"]
  },
  {
    availability: "active",
    checkpoint: 7,
    description:
      "Provider health, capability gates, and honest live/sandbox/unavailable integration states.",
    href: "/surface/integrations",
    icon: Activity,
    id: "integrations",
    label: "Integrations",
    requiredApis: [
      "GET /v1/provider-health",
      "GET /v1/dead-letter-events?status=unreviewed",
      "GET /v1/migration-batches?status=needs_review"
    ],
    roles: ["owner", "assistant"]
  },
  {
    availability: "active",
    checkpoint: 7,
    description: "Audited failed-provider event review and replay without fake provider success.",
    href: "/surface/event-replay",
    icon: RotateCcw,
    id: "event-replay",
    label: "Event replay",
    requiredApis: [
      "GET /v1/dead-letter-events?status=unreviewed",
      "POST /v1/dead-letter-events/{deadLetterEventId}/replay"
    ],
    roles: ["owner"]
  },
  {
    availability: "active",
    checkpoint: 7,
    description: "CSV migration duplicate review, rejected-row safety, and reviewed commit.",
    href: "/surface/migration-review",
    icon: DatabaseBackup,
    id: "migration-review",
    label: "Migration review",
    requiredApis: [
      "GET /v1/migration-batches?status=needs_review",
      "GET /v1/migration-batches/{migrationBatchId}",
      "POST /v1/migration-batches/{migrationBatchId}/conflicts/{conflictId}/resolve",
      "POST /v1/migration-batches/{migrationBatchId}/commit"
    ],
    roles: ["owner"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 1,
    description: "Clinic setup, users, roles, templates, pricebook, and source policy.",
    href: "/surface/settings",
    icon: Wrench,
    id: "settings",
    label: "Settings",
    requiredApis: ["GET /v1/users", "GET /external-systems/accounts"],
    roles: ["owner"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 9,
    description: "Exports, audit review, data retention, and compliance operations.",
    href: "/surface/compliance",
    icon: ShieldCheck,
    id: "compliance",
    label: "Compliance",
    requiredApis: ["GET /v1/audit-events", "GET /v1/patients/{patientId}/export"],
    roles: ["owner"]
  },
  {
    availability: "active",
    checkpoint: 5,
    description: "Billing exports and payment reconciliation without default clinical access.",
    href: "/surface/accounting",
    icon: FileText,
    id: "accounting",
    label: "Accounting",
    requiredApis: [
      "GET /v1/invoices/{invoiceId}",
      "POST /v1/invoices/{invoiceId}/payment-requests",
      "POST /v1/invoices/{invoiceId}/manual-payments",
      "POST /v1/invoices/{invoiceId}/receipts"
    ],
    roles: ["owner", "accountant"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 9,
    description: "Audited break-glass support, tenant diagnostics, and provider health.",
    href: "/surface/platform-support",
    icon: KeyRound,
    id: "platform-support",
    label: "Platform support",
    requiredApis: ["GET /v1/platform/tenants", "GET /external-systems/accounts/{id}/health"],
    roles: ["platform_admin"]
  }
];

const SURFACE_BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));
const SURFACE_ALIASES = new Map<string, string>([
  ["clinical", "encounter"],
  ["dental", "dental-media"],
  ["billing", "checkout"],
  ["continuity", "tasks"],
  ["odontogram", "dental-media"],
  ["recalls", "tasks"],
  ["payments", "checkout"],
  ["day-start", "today"],
  ["provider-health", "integrations"],
  ["integration-ops", "integrations"],
  ["dead-letter-replay", "event-replay"],
  ["imports", "migration-review"]
]);

export function hasSurface(surfaceId: string) {
  return SURFACE_BY_ID.has(resolveSurfaceId(surfaceId));
}

export function getSurface(surfaceId: string) {
  return SURFACE_BY_ID.get(resolveSurfaceId(surfaceId)) ?? SURFACE_BY_ID.get("today")!;
}

export function resolveSurfaceId(surfaceId: string) {
  return SURFACE_ALIASES.get(surfaceId) ?? surfaceId;
}

export function canAccessSurface(surface: SurfaceRegistration, roles: ClinicRole[]) {
  return surface.roles.some((role) => roles.includes(role));
}

export function getVisibleSurfaces(roles: ClinicRole[]) {
  return SURFACES.filter((surface) => canAccessSurface(surface, roles));
}

export function getPrimarySurfaceId(roles: ClinicRole[]) {
  if (roles.includes("assistant") || roles.includes("receptionist")) {
    return "today";
  }

  if (roles.includes("doctor")) {
    return "appointments";
  }

  if (roles.includes("owner")) {
    return "owner-control";
  }

  if (roles.includes("accountant")) {
    return "accounting";
  }

  if (roles.includes("platform_admin")) {
    return "platform-support";
  }

  return "today";
}

export function summarizeSurfaceAccess(roles: ClinicRole[]) {
  const visible = getVisibleSurfaces(roles);
  const activeCount = visible.filter((surface) => surface.availability === "active").length;

  return {
    activeCount,
    registeredCount: visible.length,
    unavailableCount: visible.length - activeCount
  };
}

export function getUnavailableReason(surface: SurfaceRegistration) {
  if (surface.availability === "active") {
    return "Available in this checkpoint";
  }

  if (surface.checkpoint === 1) {
    return "Registered in Checkpoint 1; backend capability is not active yet";
  }

  return `Registered for Checkpoint ${surface.checkpoint}; API capability is not active yet`;
}
