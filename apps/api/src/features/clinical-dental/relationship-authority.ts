import type { ClinicFeatureExecutionContext } from "../contracts.ts";
import type { ClinicalDentalRelationshipAuthority } from "./types.ts";

/**
 * Resolves clinical relationships exclusively through transaction-bound, clinic-scoped ports.
 * Request bodies never establish patient, appointment, provider-role, or finding authority.
 */
export function createClinicalDentalRelationshipAuthority(): ClinicalDentalRelationshipAuthority {
  const authority: ClinicalDentalRelationshipAuthority = {
    async patientExists(context, patientId) {
      return Boolean(await context.repositories.patientAdministration.findPatientById(patientId));
    },

    async appointmentBelongsToPatient(context, input) {
      const appointment = await context.repositories.scheduling.findAppointmentById(
        input.appointmentId
      );
      return appointment?.patientId === input.patientId;
    },

    async providerCanOwnEncounter(context, providerUserId) {
      const durability = requiredDurableIntegrity(context);
      return (await durability.findProviderEligibility(providerUserId)).eligible;
    },

    async dentalFindingBelongsToPatient(context, input) {
      const chart = await context.repositories.dentalTreatment.getDentalChart(input.patientId);
      return Boolean(chart?.findings.some((finding) => finding.id === input.dentalFindingId));
    }
  };
  return Object.freeze(authority);
}

function requiredDurableIntegrity(context: ClinicFeatureExecutionContext) {
  const durability = context.repositories.durableIntegrity;
  if (!durability) {
    throw new Error("CP13 durable integrity repository is not configured.");
  }
  return durability;
}
