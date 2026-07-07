import {
  CalendarDays,
  ClipboardCheck,
  ClipboardPenLine,
  CreditCard,
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
    availability: "registered_unavailable",
    checkpoint: 5,
    description: "Treatment plans, estimates, invoice state, payment collection, and receipts.",
    href: "/surface/checkout",
    icon: CreditCard,
    id: "checkout",
    label: "Checkout",
    requiredApis: ["POST /v1/invoices", "POST /v1/invoices/{invoiceId}/payment-link"],
    roles: ["owner", "assistant", "receptionist", "accountant"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 6,
    description: "Recalls, follow-ups, payment tasks, SOPs, and staff work queues.",
    href: "/surface/tasks",
    icon: ListTodo,
    id: "tasks",
    label: "Tasks and recalls",
    requiredApis: ["GET /v1/tasks", "GET /v1/recalls/due"],
    roles: ["owner", "assistant", "receptionist"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 6,
    description: "Lab cases, slips, due work, returns, and reconciliation.",
    href: "/surface/lab",
    icon: ClipboardCheck,
    id: "lab",
    label: "Lab",
    requiredApis: ["POST /v1/lab-cases", "PATCH /v1/lab-cases/{labCaseId}"],
    roles: ["owner", "doctor", "assistant"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 6,
    description: "Inventory checks, stock exceptions, SOP runs, and event diary.",
    href: "/surface/operations",
    icon: PackageCheck,
    id: "operations",
    label: "Operations",
    requiredApis: ["GET /v1/sop-runs", "POST /v1/incidents"],
    roles: ["owner", "assistant"]
  },
  {
    availability: "registered_unavailable",
    checkpoint: 6,
    description: "Source-attributed metrics, leakage views, audit review, and exports.",
    href: "/surface/owner-control",
    icon: LineChart,
    id: "owner-control",
    label: "Owner control",
    requiredApis: ["GET /v1/analytics/owner", "GET /v1/audit-events"],
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
    availability: "registered_unavailable",
    checkpoint: 1,
    description: "Billing exports and payment reconciliation without default clinical access.",
    href: "/surface/accounting",
    icon: FileText,
    id: "accounting",
    label: "Accounting",
    requiredApis: ["GET /v1/payments", "GET /v1/invoices/{invoiceId}"],
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
  ["odontogram", "dental-media"],
  ["day-start", "today"]
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
