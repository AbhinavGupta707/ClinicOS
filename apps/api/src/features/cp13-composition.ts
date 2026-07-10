import type { PaymentProvider } from "@clinic-os/integrations";
import type { ClinicFeatureHandlerMap } from "./contracts.ts";
import {
  ALL_CP13_CLINIC_FEATURE_OPERATION_IDS,
  type Cp13ClinicFeatureOperationId
} from "./cp13-operation-ownership.ts";
import { createClinicalDentalHandlerMap } from "./clinical-dental/index.ts";
import type { ClinicalDentalHandlerDependencies } from "./clinical-dental/types.ts";
import { createContinuityOperationsHandlerMap } from "./continuity-operations/index.ts";
import { createFrontOfficeFeatureHandlerMap } from "./front-office/index.ts";
import { createTreatmentBillingHandlerMap } from "./treatment-billing/index.ts";

export interface Cp13ClinicFeatureCompositionDependencies {
  readonly paymentProvider: PaymentProvider;
  readonly clinicalDental: ClinicalDentalHandlerDependencies;
}

export function createCp13ClinicFeatureHandlerMap(
  dependencies: Cp13ClinicFeatureCompositionDependencies
): ClinicFeatureHandlerMap<Cp13ClinicFeatureOperationId> {
  const maps = [
    createFrontOfficeFeatureHandlerMap(),
    createClinicalDentalHandlerMap(dependencies.clinicalDental),
    createTreatmentBillingHandlerMap({ paymentProvider: dependencies.paymentProvider }),
    createContinuityOperationsHandlerMap()
  ] as const;
  const handlers: Partial<Record<Cp13ClinicFeatureOperationId, unknown>> = {};

  for (const map of maps) {
    for (const [operationId, handler] of Object.entries(map)) {
      if (operationId in handlers) {
        throw new Error(`Duplicate CP13 clinic feature handler registration: ${operationId}.`);
      }
      handlers[operationId as Cp13ClinicFeatureOperationId] = handler;
    }
  }

  const actual = Object.keys(handlers).sort();
  const expected = [...ALL_CP13_CLINIC_FEATURE_OPERATION_IDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((operationId, index) => operationId !== expected[index])
  ) {
    throw new Error("CP13 clinic feature composition does not match frozen operation ownership.");
  }

  return Object.freeze(handlers) as ClinicFeatureHandlerMap<Cp13ClinicFeatureOperationId>;
}
