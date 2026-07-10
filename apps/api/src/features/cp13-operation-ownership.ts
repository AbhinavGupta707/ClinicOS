export const CP13_FRONT_OFFICE_OPERATION_IDS = Object.freeze([
  "listPatients",
  "createPatient",
  "getPatient",
  "updatePatient",
  "getPatientTimeline",
  "listLeads",
  "createLead",
  "matchLeadToPatient",
  "convertLeadToAppointment",
  "updateLeadStatus",
  "listAppointments",
  "createAppointment",
  "updateAppointment",
  "confirmAppointment",
  "checkInAppointment",
  "markAppointmentNoShow",
  "listAppointmentTypes",
  "listChairs",
  "listProviderSchedules",
  "listQueue",
  "updateQueueEntry",
  "getMorningDashboard",
  "listIntakeFormTemplates",
  "createIntakeFormTemplate",
  "submitPatientIntakeForm",
  "getPatientPrepSummary"
] as const);

export const CP13_CLINICAL_DENTAL_OPERATION_IDS = Object.freeze([
  "listPatientConsents",
  "createPatientConsent",
  "revokePatientConsent",
  "createEncounter",
  "getEncounter",
  "startEncounter",
  "saveEncounterClinicalNoteDraft",
  "signEncounterClinicalNote",
  "amendEncounterClinicalNote",
  "createEncounterPrescription",
  "signPrescription",
  "getPatientDentalChart",
  "createPatientDentalFinding",
  "createEncounterDentalFinding",
  "updateDentalFinding",
  "listDentalFindingHistory",
  "createDentalChartSnapshot",
  "requestMediaUploadUrl",
  "receiveMediaUploadContent",
  "completeMediaUpload",
  "listPatientMediaAssets",
  "createSignedMediaAccess"
] as const);

export const CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS = Object.freeze([
  "receiveRazorpayPaymentWebhook"
] as const);

export const CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS = Object.freeze([
  "listPricebookProcedures",
  "createPatientTreatmentPlan",
  "updateTreatmentPlan",
  "acceptTreatmentPlan",
  "createEncounterProcedurePerformed",
  "createInvoice",
  "getInvoice",
  "createInvoiceReceipt",
  "createPatientInstruction",
  "createInvoicePaymentRequest",
  "recordInvoiceManualPayment"
] as const);

export const CP13_TREATMENT_BILLING_OPERATION_IDS = Object.freeze([
  ...CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS,
  ...CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS
] as const);

export const CP13_CONTINUITY_OPERATIONS_OPERATION_IDS = Object.freeze([
  "getOwnerDashboard",
  "listTasks",
  "createTask",
  "updateTask",
  "generateDueContinuityTasks",
  "createRecallRule",
  "listRecalls",
  "recordRecallAction",
  "createSopTemplate",
  "createSopSchedule",
  "listSopRuns",
  "generateDueSopRuns",
  "updateSopRun",
  "listLabVendors",
  "createLabVendor",
  "listLabCases",
  "createLabCase",
  "updateLabCase",
  "createLabReconciliation",
  "listInventoryCategories",
  "createInventoryCategory",
  "listInventoryItems",
  "createInventoryItem",
  "createStockLedgerEntry",
  "listInventoryCheckTemplates",
  "createInventoryCheckTemplate",
  "createInventoryCheckRun",
  "updateInventoryCheckRun",
  "listInventoryExceptions",
  "listIncidents",
  "createIncident",
  "listCorrectiveActions",
  "createCorrectiveAction",
  "updateCorrectiveAction"
] as const);

export const CP13_CLINIC_DAY_OPERATION_OWNERS = Object.freeze({
  frontOffice: CP13_FRONT_OFFICE_OPERATION_IDS,
  clinicalDental: CP13_CLINICAL_DENTAL_OPERATION_IDS,
  treatmentBilling: CP13_TREATMENT_BILLING_OPERATION_IDS,
  continuityOperations: CP13_CONTINUITY_OPERATIONS_OPERATION_IDS
});

type Cp13OperationTuple =
  (typeof CP13_CLINIC_DAY_OPERATION_OWNERS)[keyof typeof CP13_CLINIC_DAY_OPERATION_OWNERS];

export type Cp13ClinicDayOperationId = Cp13OperationTuple[number];

export type Cp13ClinicFeatureOperationId = Exclude<
  Cp13ClinicDayOperationId,
  (typeof CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS)[number]
>;

export const ALL_CP13_CLINIC_DAY_OPERATION_IDS = Object.freeze(
  Object.values(CP13_CLINIC_DAY_OPERATION_OWNERS).flat()
) as readonly Cp13ClinicDayOperationId[];
