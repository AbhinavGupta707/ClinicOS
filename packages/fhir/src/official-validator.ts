import { CLINIC_OS_FHIR_R4_VERSION } from "./capability.ts";
import { ABDM_PUBLISHED_FHIR_IG } from "./abdm.ts";
import path from "node:path";

export const OFFICIAL_FHIR_VALIDATOR_EVIDENCE_STATE = "E4_pending" as const;

export interface OfficialFhirValidatorCommandInput {
  readonly artifactPath: string;
  readonly validatorJarPath: string;
}

export interface OfficialFhirValidatorCommandContract {
  readonly command: "java";
  readonly args: readonly string[];
  readonly evidenceState: typeof OFFICIAL_FHIR_VALIDATOR_EVIDENCE_STATE;
  readonly fhirVersion: typeof CLINIC_OS_FHIR_R4_VERSION;
  readonly requiredRuntime: "HL7 FHIR Validator CLI";
}

export function officialFhirR4ValidatorCommand(
  input: OfficialFhirValidatorCommandInput
): OfficialFhirValidatorCommandContract {
  const validatorJarPath = requiredPath(input.validatorJarPath, "validatorJarPath");
  const artifactPath = requiredPath(input.artifactPath, "artifactPath");
  return {
    command: "java",
    args: [
      "-jar",
      validatorJarPath,
      artifactPath,
      "-version",
      CLINIC_OS_FHIR_R4_VERSION,
      "-ig",
      "hl7.fhir.r4.core#4.0.1"
    ],
    evidenceState: OFFICIAL_FHIR_VALIDATOR_EVIDENCE_STATE,
    fhirVersion: CLINIC_OS_FHIR_R4_VERSION,
    requiredRuntime: "HL7 FHIR Validator CLI"
  };
}

/**
 * Command contract only. Running it and passing both the official validator and ABDM sandbox is
 * required before any ABDM profile is registered as available.
 */
export function officialAbdmValidatorCommand(
  input: OfficialFhirValidatorCommandInput
): OfficialFhirValidatorCommandContract {
  const contract = officialFhirR4ValidatorCommand(input);
  return {
    ...contract,
    args: [...contract.args, "-ig", ABDM_PUBLISHED_FHIR_IG.packageSpec]
  };
}

function requiredPath(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !path.isAbsolute(normalized) ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    normalized.startsWith("-")
  )
    throw new Error(`${field} must be an absolute safe path.`);
  return normalized;
}
