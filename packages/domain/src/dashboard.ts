import type { AppointmentRecord, AppointmentStatus, QueueEntryRecord } from "./appointment.ts";
import type { UUID } from "./ids.ts";
import type { LeadRecord } from "./lead.ts";

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskType =
  | "confirmation"
  | "missed_call"
  | "whatsapp_request"
  | "follow_up"
  | "recall"
  | "payment_due"
  | "lab_case"
  | "sop";

export interface TaskRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID | null;
  leadId: UUID | null;
  appointmentId: UUID | null;
  taskType: TaskType;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  assignedToUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface MorningDashboardReadModel {
  date: string;
  appointmentCounts: Record<AppointmentStatus, number>;
  totalAppointments: number;
  unconfirmedAppointments: AppointmentRecord[];
  todaysAppointments: AppointmentRecord[];
  openLeads: LeadRecord[];
  openTasks: TaskRecord[];
  queue: QueueEntryRecord[];
  newPatientAppointmentIds: UUID[];
  returningPatientAppointmentIds: UUID[];
}

export function buildMorningDashboard(input: {
  date: string;
  appointments: readonly AppointmentRecord[];
  leads: readonly LeadRecord[];
  tasks: readonly TaskRecord[];
  queue: readonly QueueEntryRecord[];
  returningPatientIds: ReadonlySet<UUID>;
}): MorningDashboardReadModel {
  const appointmentCounts = {
    requested: 0,
    booked: 0,
    confirmed: 0,
    checked_in: 0,
    in_consult: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0
  } satisfies Record<AppointmentStatus, number>;

  const newPatientAppointmentIds: UUID[] = [];
  const returningPatientAppointmentIds: UUID[] = [];

  for (const appointment of input.appointments) {
    appointmentCounts[appointment.status] += 1;

    if (input.returningPatientIds.has(appointment.patientId)) {
      returningPatientAppointmentIds.push(appointment.id);
    } else {
      newPatientAppointmentIds.push(appointment.id);
    }
  }

  return {
    date: input.date,
    appointmentCounts,
    totalAppointments: input.appointments.length,
    unconfirmedAppointments: input.appointments.filter((appointment) =>
      ["requested", "booked"].includes(appointment.status)
    ),
    todaysAppointments: [...input.appointments],
    openLeads: [...input.leads],
    openTasks: [...input.tasks],
    queue: [...input.queue],
    newPatientAppointmentIds,
    returningPatientAppointmentIds
  };
}
