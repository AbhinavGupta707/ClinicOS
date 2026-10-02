"use client";

import { useMemo } from "react";
import { createCp13ApiClient } from "@/lib/cp13-api-client";
import type { MeProfile } from "@/lib/me";
import { FrontDeskWorkspace } from "./front-office/FrontDeskWorkspace";
import { PatientsWorkspace } from "./front-office/PatientsWorkspace";
import { LeadsWorkspace } from "./front-office/LeadsWorkspace";
import { ClinicSetupWorkspace } from "./clinic-setup/ClinicSetupWorkspace";
import { ClinicalWorkflowWorkspace } from "./clinical-dental/ClinicalWorkflowWorkspace";
import { BillingWorkflowWorkspace } from "./treatment-billing/BillingWorkflowWorkspace";
import { OperationsWorkspace } from "./continuity-operations/OperationsWorkspace";
import {
  clinicLocalDate,
  isCp13BillingSurface,
  isCp13ClinicalSurface,
  isCp13OperationsSurface
} from "./runtime-helpers";

export function Cp13Workspace(props: {
  readonly activeSurfaceId: string;
  readonly onOpenPatient: (patientId: string) => void;
  readonly onOpenPatientProfile: (patientId: string) => void;
  readonly onSelectPatient: (patientId: string) => void;
  readonly profile: MeProfile;
  readonly selectedPatientId: string | null;
}) {
  const client = useMemo(
    () => createCp13ApiClient(props.profile.clinic.id),
    [props.profile.clinic.id]
  );
  const shared = {
    client,
    profile: props.profile,
    surfaceId: props.activeSurfaceId,
    patientId: props.selectedPatientId,
    onSelectPatient: props.onSelectPatient
  };
  // Setup remains reachable when the timezone itself needs repair.
  if (props.activeSurfaceId === "settings") return <ClinicSetupWorkspace {...shared} />;
  try {
    if (!props.profile.clinic.timezone) throw new Error("Missing timezone");
    clinicLocalDate(new Date(), props.profile.clinic.timezone);
  } catch {
    return (
      <p role="alert">
        The clinic timezone is unavailable. Ask the clinic administrator to correct Settings before
        recording dated work.
      </p>
    );
  }
  if (
    isCp13BillingSurface(props.activeSurfaceId) ||
    (props.activeSurfaceId === "today" && props.profile.roles.includes("accountant"))
  )
    return <BillingWorkflowWorkspace {...shared} />;
  if (["today", "appointments"].includes(props.activeSurfaceId))
    return <FrontDeskWorkspace {...shared} onOpenPatient={props.onOpenPatient} />;
  if (props.activeSurfaceId === "patients")
    return <PatientsWorkspace {...shared} onOpenPatientProfile={props.onOpenPatientProfile} />;
  if (props.activeSurfaceId === "lead-inbox") return <LeadsWorkspace {...shared} />;
  if (isCp13ClinicalSurface(props.activeSurfaceId))
    return <ClinicalWorkflowWorkspace {...shared} />;
  if (isCp13OperationsSurface(props.activeSurfaceId)) return <OperationsWorkspace {...shared} />;
  return <p role="alert">This workflow is not registered.</p>;
}
