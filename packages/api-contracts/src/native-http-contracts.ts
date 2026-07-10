import {
  API_ERROR_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  PUBLIC_RECORD_ARRAY_SCHEMA,
  PUBLIC_RECORD_SCHEMA,
  UUID_PATH_SCHEMA,
  VERSIONED_PUBLIC_RESOURCE_ARRAY_SCHEMA,
  VERSIONED_PUBLIC_RESOURCE_SCHEMA,
  WRITABLE_JSON_SCHEMA,
  bodySchema,
  defineOperation,
  headersSchema,
  parseOperationRequest,
  parseOperationResponse,
  parseOperationResponseHeaders,
  pathSchema,
  querySchema,
  responseSchema,
  type EvidenceCheckpoint,
  type HttpMethod,
  type HttpOperationContract,
  type HttpResponseDefinition,
  type OperationAuth,
  type OperationRequestInput
} from "./http-contract.ts";
import { schema, type RuntimeSchema } from "./runtime-schema.ts";

const text = schema.string({ minLength: 1, maxLength: 4096 });
const shortText = schema.string({ minLength: 1, maxLength: 256 });
const longText = schema.string({ minLength: 1, maxLength: 32_768 });
const uuid = UUID_PATH_SCHEMA;
const optionalUuid = schema.nullable(uuid);
const date = schema.date({ minLength: 10, maxLength: 10 });
const dateTime = schema.dateTime({ minLength: 20, maxLength: 40 });
const nullableText = schema.nullable(text);
const nullableDateTime = schema.nullable(dateTime);
const nonNegativeInteger = schema.integer({ minimum: 0, maximum: 2_147_483_647 });
const positiveInteger = schema.integer({ minimum: 1, maximum: 2_147_483_647 });
const positiveNumber = schema.number({ minimum: 0, maximum: 1_000_000_000 });
const stringList = schema.array(shortText, { maxItems: 100 });
const uuidList = schema.array(uuid, { maxItems: 100 });
const entity = PUBLIC_RECORD_SCHEMA;
const entities = PUBLIC_RECORD_ARRAY_SCHEMA;
const versionedEntity = VERSIONED_PUBLIC_RESOURCE_SCHEMA;
const versionedEntities = VERSIONED_PUBLIC_RESOURCE_ARRAY_SCHEMA;

const patientSources = [
  "manual",
  "whatsapp",
  "phone",
  "call",
  "walkin",
  "practo",
  "google",
  "website",
  "instagram",
  "referral",
  "recall_campaign",
  "imported",
  "external_system"
] as const;
const leadSources = patientSources.filter(
  (value) => value !== "imported" && value !== "external_system"
);
const appointmentStatuses = [
  "requested",
  "booked",
  "confirmed",
  "checked_in",
  "in_consult",
  "completed",
  "cancelled",
  "no_show"
] as const;
const leadStatuses = [
  "new",
  "contacted",
  "matched",
  "booked",
  "lost",
  "duplicate",
  "spam"
] as const;
const queueStatuses = ["waiting", "called", "in_consult", "completed", "cancelled"] as const;

const provenanceSchema = schema.writableJsonObject({
  description:
    "Source/provenance metadata; server authority and private provider fields are forbidden."
});
const clinicalNoteContentSchema = bodySchema({
  chiefComplaint: longText,
  history: longText,
  examination: longText,
  investigations: longText,
  diagnosis: longText,
  treatmentPlan: longText,
  treatmentPerformed: longText,
  followUpInstructions: longText,
  additionalSections: WRITABLE_JSON_SCHEMA
});
const medicationSchema = bodySchema(
  {
    name: shortText,
    strength: shortText,
    route: shortText,
    frequency: shortText,
    duration: shortText,
    instructions: text
  },
  ["name", "frequency", "duration"]
);
const treatmentPlanItemSchema = bodySchema(
  {
    pricebookProcedureId: uuid,
    dentalFindingId: optionalUuid,
    toothNumber: nullableText,
    quantity: schema.integer({ minimum: 1, maximum: 999 }),
    estimatedVisits: schema.integer({ minimum: 1, maximum: 99 }),
    priority: nullableText,
    notes: nullableText
  },
  ["pricebookProcedureId"],
  {
    description:
      "The client selects a catalog procedure and clinical quantity only. Unit price, discounts, tax and totals are server-derived from the active pricebook."
  }
);
const treatmentPlanPhaseSchema = bodySchema(
  {
    title: shortText,
    description: nullableText,
    estimatedStartAfterDays: schema.nullable(nonNegativeInteger),
    items: schema.array(treatmentPlanItemSchema, { minItems: 1, maxItems: 100 })
  },
  ["title", "items"]
);

const STANDARD_ERROR_RESPONSES = {
  400: { description: "The request is malformed or ambiguous.", schema: API_ERROR_SCHEMA },
  401: { description: "Authentication is required or invalid.", schema: API_ERROR_SCHEMA },
  403: {
    description: "The verified identity is not authorized for the scoped operation.",
    schema: API_ERROR_SCHEMA
  },
  404: { description: "The tenant-scoped resource does not exist.", schema: API_ERROR_SCHEMA },
  409: {
    description: "The request conflicts with current workflow or idempotency state.",
    schema: API_ERROR_SCHEMA
  },
  413: { description: "The request exceeds its declared body budget.", schema: API_ERROR_SCHEMA },
  422: { description: "The request failed runtime contract validation.", schema: API_ERROR_SCHEMA },
  429: {
    description: "The request exceeded an application abuse budget.",
    schema: API_ERROR_SCHEMA
  },
  500: {
    description: "The request failed without exposing internal details.",
    schema: API_ERROR_SCHEMA
  },
  503: {
    description: "A required dependency or configured capability is unavailable.",
    schema: API_ERROR_SCHEMA
  }
} as const satisfies Readonly<Record<number, HttpResponseDefinition>>;

interface NativeOperationInput {
  readonly operationId: string;
  readonly checkpoint: EvidenceCheckpoint;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly auth?: OperationAuth;
  readonly phi?: "none" | "read" | "write";
  readonly pathProperties?: Readonly<Record<string, RuntimeSchema>>;
  readonly queryProperties?: Readonly<Record<string, RuntimeSchema>>;
  readonly body?: RuntimeSchema;
  readonly bodyContentType?: "application/json" | "application/octet-stream";
  readonly maximumBodyBytes?: number;
  readonly success: Readonly<Record<number, RuntimeSchema>>;
  readonly mutation?: boolean;
  readonly optimisticConcurrency?: boolean;
  readonly paginated?: boolean;
  readonly providerEventIdempotency?: boolean;
  readonly nativeRuntimeEnforcement?: "body-parser-only" | "partial" | "route-parity";
  readonly requiredMasterWiring?: readonly string[];
}

function operation(input: NativeOperationInput): HttpOperationContract {
  const auth = input.auth ?? "bearer";
  const mutation = input.mutation ?? input.method !== "GET";
  const bodyContentType = input.bodyContentType ?? "application/json";
  const headers = headersSchema({
    auth,
    mutation,
    concurrency: input.optimisticConcurrency,
    contentType: input.body ? bodyContentType : undefined
  });
  return defineOperation({
    operationId: input.operationId,
    checkpoint: input.checkpoint,
    method: input.method,
    path: input.path,
    summary: input.summary,
    description: `${input.summary}. The native route is retained as a strangler input until the CP12 API layer consumes this runtime contract.`,
    tags: input.tags,
    auth,
    phi: input.phi ?? "none",
    cache: auth === "none" && input.path === "/health/live" ? "public-health" : "no-store",
    request: {
      path: pathSchema(input.pathProperties),
      query: querySchema(input.queryProperties, { paginated: input.paginated }),
      headers,
      ...(input.body
        ? {
            body: {
              contentType: bodyContentType,
              maximumBytes: input.maximumBodyBytes ?? 1024 * 1024,
              schema: input.body
            }
          }
        : {})
    },
    responses: {
      ...STANDARD_ERROR_RESPONSES,
      ...Object.fromEntries(
        Object.entries(input.success).map(([status, successSchema]) => [
          Number(status),
          { description: "Successful response.", schema: successSchema }
        ])
      )
    },
    mutation,
    optimisticConcurrency: input.optimisticConcurrency,
    paginated: input.paginated,
    providerEventIdempotency: input.providerEventIdempotency,
    integration: {
      nativeRuntimeEnforcement: input.nativeRuntimeEnforcement ?? "body-parser-only",
      requiredMasterWiring: input.requiredMasterWiring
    }
  });
}

const emptyBody = bodySchema({});
const singleEntity = (key: string) => responseSchema({ [key]: entity });
const entityList = (key: string) => responseSchema({ [key]: entities });
const singleVersionedEntity = (key: string) => responseSchema({ [key]: versionedEntity });
const versionedEntityList = (key: string) => responseSchema({ [key]: versionedEntities });
const patientDuplicateProjectionSchema = responseSchema({
  id: uuid,
  fullName: shortText,
  phone: schema.nullable(shortText),
  email: schema.nullable(schema.string({ format: "email", maxLength: 320 })),
  createdAt: dateTime
});
const patientDuplicateSuggestionSchema = responseSchema({
  patient: patientDuplicateProjectionSchema,
  score: schema.integer({ minimum: 0, maximum: 100 }),
  reasons: schema.array(schema.enum(["phone_exact", "name_exact", "name_similar"]), {
    maxItems: 3
  })
});
const patientDuplicateSuggestionsSchema = schema.array(patientDuplicateSuggestionSchema, {
  maxItems: 100
});
const patientPrepProjectionSchema = responseSchema({
  id: uuid,
  fullName: shortText,
  phone: schema.nullable(shortText),
  dateOfBirth: schema.nullable(date),
  gender: schema.enum(["female", "male", "other", "unknown"])
});
const appointmentPrepProjectionSchema = responseSchema({
  id: uuid,
  status: schema.enum(appointmentStatuses),
  startAt: dateTime,
  endAt: dateTime,
  providerUserId: uuid,
  reason: nullableText
});
const patientPrepSummarySchema = responseSchema({
  patient: patientPrepProjectionSchema,
  appointment: schema.nullable(appointmentPrepProjectionSchema),
  generatedAt: dateTime,
  latestIntakeResponse: schema.nullable(entity),
  consentEnforcementState: entity,
  activeConsentPurposes: stringList,
  timelineHighlights: entities,
  priorClinicalTimeline: entities,
  medicalHistoryChangePromptRequired: schema.boolean(),
  dataCoverage: entity
});
const morningDashboardSchema = responseSchema({
  date,
  appointmentCounts: schema.object(
    Object.fromEntries(appointmentStatuses.map((status) => [status, nonNegativeInteger] as const)),
    appointmentStatuses
  ),
  totalAppointments: nonNegativeInteger,
  unconfirmedAppointments: versionedEntities,
  todaysAppointments: versionedEntities,
  openLeads: versionedEntities,
  openTasks: versionedEntities,
  queue: versionedEntities,
  newPatientAppointmentIds: uuidList,
  returningPatientAppointmentIds: uuidList
});
const labCaseDetailSchema = responseSchema({
  labCase: versionedEntity,
  vendor: entity,
  items: entities,
  statusHistory: entities
});
const inventoryCheckRunDetailSchema = responseSchema({
  run: versionedEntity,
  template: entity,
  lines: entities,
  procurementSuggestions: entities
});

export const ACTIVE_NATIVE_HTTP_OPERATIONS: readonly HttpOperationContract[] = [
  operation({
    operationId: "healthLive",
    checkpoint: "CP1",
    method: "GET",
    path: "/health/live",
    summary: "Report process liveness",
    tags: ["Health"],
    auth: "none",
    mutation: false,
    success: {
      200: responseSchema(
        {
          status: schema.enum(["ok"]),
          service: schema.enum(["clinic-os-api"]),
          request_id: shortText
        },
        ["status", "service", "request_id"]
      )
    },
    nativeRuntimeEnforcement: "route-parity"
  }),
  ...healthDependencyOperations(),
  operation({
    operationId: "getCurrentIdentity",
    checkpoint: "CP1",
    method: "GET",
    path: "/v1/me",
    summary: "Resolve the verified current identity and clinic access",
    tags: ["Identity"],
    phi: "read",
    mutation: false,
    success: {
      200: responseSchema(
        {
          user: entity,
          tenant: entity,
          clinics: entities,
          permissions: stringList,
          keycloak: schema.object(
            {
              subject: shortText,
              issuer: text,
              roles: stringList
            },
            ["subject", "issuer", "roles"]
          )
        },
        ["user", "tenant", "clinics", "permissions", "keycloak"]
      )
    },
    nativeRuntimeEnforcement: "route-parity"
  }),
  operation({
    operationId: "receiveRazorpayPaymentWebhook",
    checkpoint: "CP5",
    method: "POST",
    path: "/v1/payment-webhooks/razorpay",
    summary: "Verify and apply a Razorpay webhook",
    tags: ["Payments", "Webhooks"],
    auth: "razorpay_signature",
    body: schema.string({ format: "binary", minLength: 1, maxLength: 1024 * 1024 }),
    bodyContentType: "application/json",
    maximumBodyBytes: 1024 * 1024,
    success: {
      200: responseSchema({
        status: shortText,
        replayed: schema.boolean(),
        invoice: schema.nullable(entity),
        transaction: schema.nullable(entity),
        reconciliationItem: schema.nullable(entity),
        providerEvent: entity
      })
    },
    providerEventIdempotency: true,
    nativeRuntimeEnforcement: "partial",
    requiredMasterWiring: [
      "Accept provider application/json while preserving the exact bounded raw bytes for signature verification before parsing or business effects.",
      "Persist provider event IDs and reject duplicate/out-of-order effects atomically.",
      "Serve this operation only after the official callback is registered and sandbox-verified."
    ]
  }),
  ...cp2Operations(),
  ...cp3Operations(),
  ...cp4Operations(),
  ...cp5Operations(),
  ...cp6Operations(),
  ...cp7Operations(),
  ...cp8Operations(),
  ...cp9Operations(),
  ...cp10Operations()
];

export type VersionedResourceFamily =
  | "appointment"
  | "corrective_action"
  | "dental_finding"
  | "encounter"
  | "inventory_check_run"
  | "lab_case"
  | "lead"
  | "patient"
  | "queue_entry"
  | "sop_run"
  | "task"
  | "treatment_plan";

export interface VersionedResourceResponseSource {
  readonly operationId: string;
  readonly status: number;
  readonly responsePath: string;
  readonly role: "action" | "aggregate" | "create" | "list" | "read" | "update";
}

export interface VersionedResourceResponseContract {
  readonly family: VersionedResourceFamily;
  readonly updateOperationId: string;
  readonly sources: readonly VersionedResourceResponseSource[];
}

export const VERSIONED_RESOURCE_RESPONSE_CONTRACTS: readonly VersionedResourceResponseContract[] = [
  {
    family: "patient",
    updateOperationId: "updatePatient",
    sources: [
      { operationId: "listPatients", status: 200, responsePath: "patients[]", role: "list" },
      { operationId: "createPatient", status: 201, responsePath: "patient", role: "create" },
      { operationId: "getPatient", status: 200, responsePath: "patient", role: "read" },
      { operationId: "updatePatient", status: 200, responsePath: "patient", role: "update" }
    ]
  },
  {
    family: "lead",
    updateOperationId: "updateLeadStatus",
    sources: [
      { operationId: "createPatient", status: 201, responsePath: "matchedLead", role: "action" },
      { operationId: "listLeads", status: 200, responsePath: "leads[]", role: "list" },
      { operationId: "createLead", status: 201, responsePath: "lead", role: "create" },
      { operationId: "matchLeadToPatient", status: 200, responsePath: "lead", role: "action" },
      {
        operationId: "convertLeadToAppointment",
        status: 201,
        responsePath: "lead",
        role: "action"
      },
      { operationId: "updateLeadStatus", status: 200, responsePath: "lead", role: "update" },
      {
        operationId: "getMorningDashboard",
        status: 200,
        responsePath: "dashboard.openLeads[]",
        role: "aggregate"
      }
    ]
  },
  {
    family: "appointment",
    updateOperationId: "updateAppointment",
    sources: [
      {
        operationId: "convertLeadToAppointment",
        status: 201,
        responsePath: "appointment",
        role: "action"
      },
      {
        operationId: "listAppointments",
        status: 200,
        responsePath: "appointments[]",
        role: "list"
      },
      {
        operationId: "createAppointment",
        status: 201,
        responsePath: "appointment",
        role: "create"
      },
      {
        operationId: "updateAppointment",
        status: 200,
        responsePath: "appointment",
        role: "update"
      },
      {
        operationId: "confirmAppointment",
        status: 200,
        responsePath: "appointment",
        role: "action"
      },
      {
        operationId: "checkInAppointment",
        status: 200,
        responsePath: "appointment",
        role: "action"
      },
      {
        operationId: "markAppointmentNoShow",
        status: 200,
        responsePath: "appointment",
        role: "action"
      },
      {
        operationId: "getMorningDashboard",
        status: 200,
        responsePath: "dashboard.unconfirmedAppointments[]",
        role: "aggregate"
      },
      {
        operationId: "getMorningDashboard",
        status: 200,
        responsePath: "dashboard.todaysAppointments[]",
        role: "aggregate"
      }
    ]
  },
  {
    family: "queue_entry",
    updateOperationId: "updateQueueEntry",
    sources: [
      {
        operationId: "checkInAppointment",
        status: 200,
        responsePath: "queueEntry",
        role: "create"
      },
      { operationId: "listQueue", status: 200, responsePath: "queue[]", role: "list" },
      {
        operationId: "updateQueueEntry",
        status: 200,
        responsePath: "queueEntry",
        role: "update"
      },
      {
        operationId: "getMorningDashboard",
        status: 200,
        responsePath: "dashboard.queue[]",
        role: "aggregate"
      }
    ]
  },
  {
    family: "encounter",
    updateOperationId: "saveEncounterClinicalNoteDraft",
    sources: [
      { operationId: "createEncounter", status: 201, responsePath: "encounter", role: "create" },
      { operationId: "getEncounter", status: 200, responsePath: "encounter", role: "read" },
      { operationId: "startEncounter", status: 200, responsePath: "encounter", role: "action" },
      {
        operationId: "saveEncounterClinicalNoteDraft",
        status: 200,
        responsePath: "encounter",
        role: "update"
      },
      {
        operationId: "signEncounterClinicalNote",
        status: 200,
        responsePath: "encounter",
        role: "action"
      },
      {
        operationId: "amendEncounterClinicalNote",
        status: 200,
        responsePath: "encounter",
        role: "action"
      }
    ]
  },
  {
    family: "dental_finding",
    updateOperationId: "updateDentalFinding",
    sources: [
      {
        operationId: "getPatientDentalChart",
        status: 200,
        responsePath: "findings[]",
        role: "list"
      },
      {
        operationId: "createPatientDentalFinding",
        status: 201,
        responsePath: "finding",
        role: "create"
      },
      {
        operationId: "createEncounterDentalFinding",
        status: 201,
        responsePath: "finding",
        role: "create"
      },
      {
        operationId: "updateDentalFinding",
        status: 200,
        responsePath: "finding",
        role: "update"
      }
    ]
  },
  {
    family: "treatment_plan",
    updateOperationId: "updateTreatmentPlan",
    sources: [
      {
        operationId: "createPatientTreatmentPlan",
        status: 201,
        responsePath: "treatmentPlan",
        role: "create"
      },
      {
        operationId: "updateTreatmentPlan",
        status: 200,
        responsePath: "treatmentPlan",
        role: "update"
      },
      {
        operationId: "acceptTreatmentPlan",
        status: 200,
        responsePath: "treatmentPlan",
        role: "action"
      },
      {
        operationId: "createEncounterProcedurePerformed",
        status: 201,
        responsePath: "treatmentPlan",
        role: "action"
      }
    ]
  },
  {
    family: "task",
    updateOperationId: "updateTask",
    sources: [
      { operationId: "listTasks", status: 200, responsePath: "tasks[]", role: "list" },
      { operationId: "createTask", status: 201, responsePath: "task", role: "create" },
      { operationId: "updateTask", status: 200, responsePath: "task", role: "update" },
      {
        operationId: "generateDueContinuityTasks",
        status: 202,
        responsePath: "recallTasksCreated[]",
        role: "action"
      },
      {
        operationId: "generateDueContinuityTasks",
        status: 202,
        responsePath: "followUpTasksCreated[]",
        role: "action"
      },
      {
        operationId: "getMorningDashboard",
        status: 200,
        responsePath: "dashboard.openTasks[]",
        role: "aggregate"
      }
    ]
  },
  {
    family: "sop_run",
    updateOperationId: "updateSopRun",
    sources: [
      { operationId: "listSopRuns", status: 200, responsePath: "sopRuns[]", role: "list" },
      {
        operationId: "generateDueSopRuns",
        status: 202,
        responsePath: "sopRunsCreated[]",
        role: "create"
      },
      { operationId: "updateSopRun", status: 200, responsePath: "sopRun", role: "update" }
    ]
  },
  {
    family: "lab_case",
    updateOperationId: "updateLabCase",
    sources: [
      { operationId: "listLabCases", status: 200, responsePath: "labCases[]", role: "list" },
      {
        operationId: "createLabCase",
        status: 201,
        responsePath: "labCase.labCase",
        role: "create"
      },
      {
        operationId: "updateLabCase",
        status: 200,
        responsePath: "labCase.labCase",
        role: "update"
      }
    ]
  },
  {
    family: "inventory_check_run",
    updateOperationId: "updateInventoryCheckRun",
    sources: [
      {
        operationId: "createInventoryCheckRun",
        status: 201,
        responsePath: "checkRun.run",
        role: "create"
      },
      {
        operationId: "updateInventoryCheckRun",
        status: 200,
        responsePath: "checkRun.run",
        role: "update"
      }
    ]
  },
  {
    family: "corrective_action",
    updateOperationId: "updateCorrectiveAction",
    sources: [
      {
        operationId: "listCorrectiveActions",
        status: 200,
        responsePath: "correctiveActions[]",
        role: "list"
      },
      {
        operationId: "createCorrectiveAction",
        status: 201,
        responsePath: "correctiveAction",
        role: "create"
      },
      {
        operationId: "updateCorrectiveAction",
        status: 200,
        responsePath: "correctiveAction",
        role: "update"
      }
    ]
  }
];

function healthDependencyOperations(): HttpOperationContract[] {
  const healthReport = responseSchema({
    status: schema.enum(["ready", "unavailable"]),
    service: schema.enum(["clinic-os-api"]),
    repository_mode: schema.enum(["postgres", "fixture", "injected"]),
    auth_mode: schema.enum(["keycloak_jwks", "local_synthetic_fixture"]),
    evidence_tier: schema.enum(["E2_fixture", "E3_durable", "unverified_injected"]),
    dependencies: entities,
    request_id: shortText
  });
  return [
    operation({
      operationId: "healthReady",
      checkpoint: "CP1",
      method: "GET",
      path: "/health/ready",
      summary: "Report current traffic readiness",
      tags: ["Health"],
      auth: "none",
      mutation: false,
      success: { 200: healthReport, 503: healthReport },
      nativeRuntimeEnforcement: "route-parity"
    }),
    operation({
      operationId: "healthStartup",
      checkpoint: "CP1",
      method: "GET",
      path: "/health/startup",
      summary: "Report sticky startup completion",
      tags: ["Health"],
      auth: "none",
      mutation: false,
      success: { 200: healthReport, 503: healthReport },
      nativeRuntimeEnforcement: "route-parity"
    })
  ];
}

function cp2Operations(): HttpOperationContract[] {
  const patientBody = bodySchema(
    {
      fullName: shortText,
      phone: schema.string({ minLength: 8, maxLength: 16, pattern: "^\\+[1-9][0-9]{7,14}$" }),
      email: schema.nullable(schema.string({ format: "email", maxLength: 320 })),
      dateOfBirth: schema.nullable(date),
      gender: schema.enum(["female", "male", "other", "unknown"]),
      source: schema.enum(patientSources),
      sourceDetail: provenanceSchema,
      leadId: optionalUuid
    },
    ["fullName", "phone", "source"]
  );
  const appointmentBody = bodySchema(
    {
      patientId: uuid,
      leadId: optionalUuid,
      providerUserId: uuid,
      appointmentTypeId: uuid,
      chairId: optionalUuid,
      status: schema.enum(["requested", "booked"]),
      startAt: dateTime,
      endAt: dateTime,
      durationMinutes: schema.integer({ minimum: 5, maximum: 720 }),
      source: schema.enum(leadSources),
      reason: nullableText,
      notes: nullableText,
      allowConflictOverride: schema.boolean()
    },
    ["patientId", "providerUserId", "appointmentTypeId", "startAt"]
  );
  return [
    operation({
      operationId: "listPatients",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/patients",
      summary: "List or search clinic-scoped patients",
      tags: ["Patients"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: {
        query: shortText,
        phone: shortText,
        source: schema.enum(patientSources)
      },
      success: { 200: versionedEntityList("patients") }
    }),
    operation({
      operationId: "createPatient",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/patients",
      summary: "Create a clinic-scoped patient with attribution",
      tags: ["Patients"],
      phi: "write",
      body: patientBody,
      success: {
        201: responseSchema({
          patient: versionedEntity,
          duplicateSuggestions: patientDuplicateSuggestionsSchema,
          matchedLead: schema.nullable(versionedEntity)
        })
      }
    }),
    operation({
      operationId: "getPatient",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/patients/{patientId}",
      summary: "Get one authorized patient record",
      tags: ["Patients"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      success: { 200: singleVersionedEntity("patient") }
    }),
    operation({
      operationId: "updatePatient",
      checkpoint: "CP2",
      method: "PATCH",
      path: "/v1/patients/{patientId}",
      summary: "Update mutable patient demographics",
      tags: ["Patients"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: bodySchema(
        {
          fullName: shortText,
          phone: schema.nullable(shortText),
          email: schema.nullable(schema.string({ format: "email", maxLength: 320 })),
          dateOfBirth: schema.nullable(date),
          gender: schema.enum(["female", "male", "other", "unknown"])
        },
        [],
        { minProperties: 1 }
      ),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("patient") }
    }),
    operation({
      operationId: "getPatientTimeline",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/patients/{patientId}/timeline",
      summary: "List a patient's public timeline projection",
      tags: ["Patients", "Timeline"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      paginated: true,
      success: { 200: responseSchema({ timeline: entities, items: entities }) }
    }),
    operation({
      operationId: "listLeads",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/leads",
      summary: "List acquisition leads",
      tags: ["Leads"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: { source: schema.enum(leadSources), status: schema.enum(leadStatuses) },
      success: { 200: versionedEntityList("leads") }
    }),
    operation({
      operationId: "createLead",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/leads",
      summary: "Create an attributed acquisition lead",
      tags: ["Leads"],
      phi: "write",
      body: bodySchema(
        {
          primaryContact: shortText,
          intent: schema.enum([
            "appointment_request",
            "pricing_query",
            "followup",
            "emergency",
            "lab_vendor",
            "unknown"
          ]),
          source: schema.enum(leadSources),
          sourceDetail: provenanceSchema
        },
        ["primaryContact", "source"]
      ),
      success: {
        201: responseSchema({
          lead: versionedEntity,
          patientMatchSuggestions: patientDuplicateSuggestionsSchema
        })
      }
    }),
    operation({
      operationId: "matchLeadToPatient",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/leads/{leadId}/match-patient",
      summary: "Resolve a lead to an existing patient",
      tags: ["Leads", "Patients"],
      phi: "write",
      pathProperties: { leadId: uuid },
      body: bodySchema({ patientId: uuid }, ["patientId"]),
      success: { 200: singleVersionedEntity("lead") }
    }),
    operation({
      operationId: "convertLeadToAppointment",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/leads/{leadId}/convert-to-appointment",
      summary: "Convert a matched lead into an appointment",
      tags: ["Leads", "Appointments"],
      phi: "write",
      pathProperties: { leadId: uuid },
      body: bodySchema(
        {
          providerUserId: uuid,
          appointmentTypeId: uuid,
          chairId: optionalUuid,
          status: schema.enum(["requested", "booked"]),
          startAt: dateTime,
          endAt: dateTime,
          durationMinutes: schema.integer({ minimum: 5, maximum: 720 }),
          reason: nullableText,
          notes: nullableText,
          allowConflictOverride: schema.boolean()
        },
        ["providerUserId", "appointmentTypeId", "startAt"]
      ),
      success: {
        201: responseSchema({ lead: versionedEntity, appointment: versionedEntity })
      }
    }),
    operation({
      operationId: "updateLeadStatus",
      checkpoint: "CP2",
      method: "PATCH",
      path: "/v1/leads/{leadId}/status",
      summary: "Transition a lead status",
      tags: ["Leads"],
      phi: "write",
      pathProperties: { leadId: uuid },
      body: bodySchema({ status: schema.enum(leadStatuses) }, ["status"]),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("lead") }
    }),
    operation({
      operationId: "listAppointments",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/appointments",
      summary: "List scheduled appointments",
      tags: ["Appointments"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: { date, providerId: uuid, status: schema.enum(appointmentStatuses) },
      success: { 200: versionedEntityList("appointments") }
    }),
    operation({
      operationId: "createAppointment",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/appointments",
      summary: "Book a patient appointment",
      tags: ["Appointments"],
      phi: "write",
      body: appointmentBody,
      success: { 201: singleVersionedEntity("appointment") }
    }),
    operation({
      operationId: "updateAppointment",
      checkpoint: "CP2",
      method: "PATCH",
      path: "/v1/appointments/{appointmentId}",
      summary: "Transition appointment status",
      tags: ["Appointments"],
      phi: "write",
      pathProperties: { appointmentId: uuid },
      body: bodySchema({ status: schema.enum(appointmentStatuses) }, ["status"]),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("appointment") }
    }),
    ...appointmentActionOperations(),
    operation({
      operationId: "listAppointmentTypes",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/appointment-types",
      summary: "List appointment type configuration",
      tags: ["Appointments", "Configuration"],
      mutation: false,
      success: { 200: entityList("appointmentTypes") }
    }),
    operation({
      operationId: "listChairs",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/chairs",
      summary: "List clinic chairs",
      tags: ["Appointments", "Configuration"],
      mutation: false,
      success: { 200: entityList("chairs") }
    }),
    operation({
      operationId: "listProviderSchedules",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/provider-schedules",
      summary: "List provider schedules",
      tags: ["Appointments", "Configuration"],
      mutation: false,
      queryProperties: { providerId: uuid },
      success: { 200: entityList("providerSchedules") }
    }),
    operation({
      operationId: "listQueue",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/queue",
      summary: "List the clinic-day queue",
      tags: ["Queue"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: { date },
      success: { 200: versionedEntityList("queue") }
    }),
    operation({
      operationId: "updateQueueEntry",
      checkpoint: "CP2",
      method: "PATCH",
      path: "/v1/queue/{queueEntryId}",
      summary: "Transition a queue entry",
      tags: ["Queue"],
      phi: "write",
      pathProperties: { queueEntryId: uuid },
      body: bodySchema({ status: schema.enum(queueStatuses) }, ["status"]),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("queueEntry") }
    }),
    operation({
      operationId: "getMorningDashboard",
      checkpoint: "CP2",
      method: "GET",
      path: "/v1/dashboard/morning",
      summary: "Get the assistant morning dashboard",
      tags: ["Dashboard"],
      phi: "read",
      mutation: false,
      queryProperties: { date },
      success: { 200: responseSchema({ dashboard: morningDashboardSchema }) }
    })
  ];
}

function appointmentActionOperations(): HttpOperationContract[] {
  return [
    operation({
      operationId: "confirmAppointment",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/appointments/{appointmentId}/confirm",
      summary: "Confirm an appointment",
      tags: ["Appointments"],
      phi: "write",
      pathProperties: { appointmentId: uuid },
      success: { 200: singleVersionedEntity("appointment") }
    }),
    operation({
      operationId: "checkInAppointment",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/appointments/{appointmentId}/check-in",
      summary: "Check in an appointment and create its queue entry",
      tags: ["Appointments", "Queue"],
      phi: "write",
      pathProperties: { appointmentId: uuid },
      success: {
        200: responseSchema({ appointment: versionedEntity, queueEntry: versionedEntity })
      }
    }),
    operation({
      operationId: "markAppointmentNoShow",
      checkpoint: "CP2",
      method: "POST",
      path: "/v1/appointments/{appointmentId}/mark-no-show",
      summary: "Mark an appointment as a no-show",
      tags: ["Appointments"],
      phi: "write",
      pathProperties: { appointmentId: uuid },
      success: { 200: singleVersionedEntity("appointment") }
    })
  ];
}

function cp3Operations(): HttpOperationContract[] {
  const formTypes = ["patient_intake", "medical_history", "consent_capture"] as const;
  const consentPurposes = [
    "treatment_registration",
    "privacy_notice",
    "whatsapp_communication",
    "marketing_recall",
    "ai_audio_capture",
    "raw_audio_retention",
    "photo_capture",
    "photo_sharing",
    "abdm_abha",
    "procedure_treatment"
  ] as const;
  const captureMethods = [
    "digital_patient",
    "assistant_paper_card",
    "clinic_staff",
    "imported_record"
  ] as const;
  return [
    operation({
      operationId: "listIntakeFormTemplates",
      checkpoint: "CP3",
      method: "GET",
      path: "/v1/form-templates",
      summary: "List active intake form templates",
      tags: ["Intake"],
      phi: "read",
      mutation: false,
      success: { 200: entityList("templates") }
    }),
    operation({
      operationId: "createIntakeFormTemplate",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/form-templates",
      summary: "Create a versioned intake form template",
      tags: ["Intake", "Configuration"],
      body: bodySchema(
        {
          code: shortText,
          displayName: shortText,
          formType: schema.enum(formTypes),
          version: schema.integer({ minimum: 1, maximum: 10_000 }),
          schema: WRITABLE_JSON_SCHEMA,
          active: schema.boolean()
        },
        ["code", "displayName", "formType", "schema"]
      ),
      success: { 201: singleEntity("template") }
    }),
    operation({
      operationId: "submitPatientIntakeForm",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/patients/{patientId}/form-responses",
      summary: "Submit a patient intake form response",
      tags: ["Intake", "Patients"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: bodySchema(
        {
          templateId: uuid,
          source: schema.enum(["digital", "assistant_paper_card"]),
          responses: WRITABLE_JSON_SCHEMA,
          medicalHistorySnapshot: WRITABLE_JSON_SCHEMA,
          provenance: provenanceSchema
        },
        ["templateId", "responses"]
      ),
      success: { 201: responseSchema({ formResponse: entity, submission: entity }) }
    }),
    operation({
      operationId: "getPatientPrepSummary",
      checkpoint: "CP3",
      method: "GET",
      path: "/v1/patients/{patientId}/prep-summary",
      summary: "Build the authorized clinical preparation summary",
      tags: ["Clinical", "Patients"],
      phi: "read",
      pathProperties: { patientId: uuid },
      queryProperties: { appointmentId: uuid },
      mutation: false,
      success: {
        200: responseSchema({
          prepSummary: patientPrepSummarySchema,
          summary: patientPrepSummarySchema
        })
      }
    }),
    operation({
      operationId: "listPatientConsents",
      checkpoint: "CP3",
      method: "GET",
      path: "/v1/patients/{patientId}/consents",
      summary: "List consent records and their enforcement state",
      tags: ["Consent", "Patients"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      success: { 200: responseSchema({ consents: entities, enforcementState: entity }) }
    }),
    operation({
      operationId: "createPatientConsent",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/patients/{patientId}/consents",
      summary: "Record a purpose-specific patient consent",
      tags: ["Consent", "Patients"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: bodySchema(
        {
          purpose: schema.enum(consentPurposes),
          templateCode: shortText,
          templateVersion: schema.integer({ minimum: 1, maximum: 10_000 }),
          captureMethod: schema.enum(captureMethods),
          grantedByName: nullableText,
          relationshipToPatient: nullableText,
          evidence: WRITABLE_JSON_SCHEMA,
          provenance: provenanceSchema
        },
        ["purpose", "templateCode", "templateVersion", "evidence", "provenance"]
      ),
      success: { 201: responseSchema({ consent: entity, enforcementState: entity }) }
    }),
    operation({
      operationId: "revokePatientConsent",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/patients/{patientId}/consents/{consentId}/revoke",
      summary: "Revoke a patient consent prospectively",
      tags: ["Consent", "Patients"],
      phi: "write",
      pathProperties: { patientId: uuid, consentId: uuid },
      body: bodySchema({ reason: text }, ["reason"]),
      success: { 200: responseSchema({ consent: entity, enforcementState: entity }) }
    }),
    operation({
      operationId: "createEncounter",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/encounters",
      summary: "Create a patient encounter",
      tags: ["Clinical", "Encounters"],
      phi: "write",
      body: bodySchema(
        {
          patientId: uuid,
          appointmentId: optionalUuid,
          providerUserId: uuid,
          reason: nullableText,
          medicalHistorySnapshot: WRITABLE_JSON_SCHEMA
        },
        ["patientId", "providerUserId"]
      ),
      success: { 201: singleVersionedEntity("encounter") }
    }),
    operation({
      operationId: "getEncounter",
      checkpoint: "CP3",
      method: "GET",
      path: "/v1/encounters/{encounterId}",
      summary: "Get an encounter and its clinical note versions",
      tags: ["Clinical", "Encounters"],
      phi: "read",
      pathProperties: { encounterId: uuid },
      mutation: false,
      success: {
        200: responseSchema({ encounter: versionedEntity, noteVersions: entities })
      }
    }),
    operation({
      operationId: "startEncounter",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/encounters/{encounterId}/start",
      summary: "Start clinical drafting for an encounter",
      tags: ["Clinical", "Encounters"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      success: { 200: singleVersionedEntity("encounter") }
    }),
    operation({
      operationId: "saveEncounterClinicalNoteDraft",
      checkpoint: "CP3",
      method: "PATCH",
      path: "/v1/encounters/{encounterId}",
      summary: "Save a mutable clinical note draft",
      tags: ["Clinical", "Encounters"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: bodySchema({ content: clinicalNoteContentSchema, readyForSign: schema.boolean() }, [
        "content"
      ]),
      optimisticConcurrency: true,
      success: { 200: responseSchema({ encounter: versionedEntity, note: entity }) }
    }),
    operation({
      operationId: "signEncounterClinicalNote",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/encounters/{encounterId}/sign-note",
      summary: "Sign the current clinical note as the verified doctor",
      tags: ["Clinical", "Signatures"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      success: { 200: responseSchema({ encounter: versionedEntity, note: entity }) }
    }),
    operation({
      operationId: "amendEncounterClinicalNote",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/encounters/{encounterId}/amend-note",
      summary: "Append a signed clinical note amendment",
      tags: ["Clinical", "Signatures"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: bodySchema({ content: clinicalNoteContentSchema, amendmentReason: text }, [
        "content",
        "amendmentReason"
      ]),
      success: {
        200: responseSchema({ encounter: versionedEntity, note: entity, amendedFrom: entity })
      }
    }),
    operation({
      operationId: "createEncounterPrescription",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/encounters/{encounterId}/prescriptions",
      summary: "Create an unsigned prescription draft",
      tags: ["Clinical", "Prescriptions"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: bodySchema(
        {
          medications: schema.array(medicationSchema, { minItems: 1, maxItems: 50 }),
          notes: nullableText
        },
        ["medications"]
      ),
      success: { 201: singleEntity("prescription") }
    }),
    operation({
      operationId: "signPrescription",
      checkpoint: "CP3",
      method: "POST",
      path: "/v1/prescriptions/{prescriptionId}/sign",
      summary: "Sign a prescription as the verified doctor",
      tags: ["Clinical", "Prescriptions", "Signatures"],
      phi: "write",
      pathProperties: { prescriptionId: uuid },
      success: { 200: singleEntity("prescription") }
    })
  ];
}

function cp4Operations(): HttpOperationContract[] {
  const dentalFindingBody = bodySchema(
    {
      encounterId: optionalUuid,
      toothNumber: schema.string({ minLength: 2, maxLength: 2, pattern: "^[1-8][1-8]$" }),
      surface: schema.nullable(
        schema.enum(["distal", "occlusal", "buccal", "lingual", "mesial", "cervical"])
      ),
      findingType: schema.enum([
        "caries",
        "cervical_erosion",
        "restoration",
        "crown",
        "missing",
        "mobility",
        "rct",
        "periodontal_note",
        "watch_item"
      ]),
      severity: nullableText,
      status: schema.enum(["active", "watch", "treated", "historical", "entered_in_error"]),
      reviewStatus: schema.enum(["needs_review", "reviewed"]),
      source: schema.enum(["manual", "ai_draft", "imported", "historical"]),
      confidence: schema.nullable(schema.number({ minimum: 0, maximum: 1 })),
      notes: nullableText,
      provenance: provenanceSchema,
      treatmentReference: WRITABLE_JSON_SCHEMA
    },
    ["toothNumber", "findingType"]
  );
  const updateDentalBody = bodySchema(
    {
      encounterId: optionalUuid,
      toothNumber: schema.string({ minLength: 2, maxLength: 2, pattern: "^[1-8][1-8]$" }),
      surface: schema.nullable(shortText),
      findingType: shortText,
      severity: nullableText,
      status: schema.enum(["active", "watch", "treated", "historical", "entered_in_error"]),
      reviewStatus: schema.enum(["needs_review", "reviewed"]),
      source: schema.enum(["manual", "ai_draft", "imported", "historical"]),
      confidence: schema.nullable(schema.number({ minimum: 0, maximum: 1 })),
      notes: nullableText,
      provenance: provenanceSchema,
      treatmentReference: WRITABLE_JSON_SCHEMA,
      changeReason: text
    },
    ["changeReason"],
    { minProperties: 2 }
  );
  return [
    operation({
      operationId: "getPatientDentalChart",
      checkpoint: "CP4",
      method: "GET",
      path: "/v1/patients/{patientId}/dental-chart",
      summary: "Get a patient's dental chart, findings and snapshots",
      tags: ["Dental"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      success: {
        200: responseSchema({
          dentalChart: entity,
          findings: versionedEntities,
          history: entities,
          snapshots: entities
        })
      }
    }),
    operation({
      operationId: "createPatientDentalFinding",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/patients/{patientId}/dental-findings",
      summary: "Create one patient dental finding row",
      tags: ["Dental"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: dentalFindingBody,
      success: { 201: responseSchema({ finding: versionedEntity, history: entity }) }
    }),
    operation({
      operationId: "createEncounterDentalFinding",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/encounters/{encounterId}/dental-findings",
      summary: "Create one encounter-scoped dental finding row",
      tags: ["Dental", "Encounters"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: dentalFindingBody,
      success: { 201: responseSchema({ finding: versionedEntity, history: entity }) }
    }),
    operation({
      operationId: "updateDentalFinding",
      checkpoint: "CP4",
      method: "PATCH",
      path: "/v1/dental-findings/{findingId}",
      summary: "Append a reasoned update to a dental finding",
      tags: ["Dental"],
      phi: "write",
      pathProperties: { findingId: uuid },
      body: updateDentalBody,
      optimisticConcurrency: true,
      success: { 200: responseSchema({ finding: versionedEntity, history: entity }) }
    }),
    operation({
      operationId: "listDentalFindingHistory",
      checkpoint: "CP4",
      method: "GET",
      path: "/v1/dental-findings/{findingId}/history",
      summary: "List additive dental finding history",
      tags: ["Dental"],
      phi: "read",
      pathProperties: { findingId: uuid },
      mutation: false,
      success: { 200: entityList("history") }
    }),
    operation({
      operationId: "createDentalChartSnapshot",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/patients/{patientId}/dental-chart/snapshots",
      summary: "Create an immutable dental chart snapshot",
      tags: ["Dental"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: bodySchema({
        encounterId: optionalUuid,
        reason: nullableText,
        provenance: provenanceSchema
      }),
      success: { 201: singleEntity("snapshot") }
    }),
    operation({
      operationId: "requestMediaUploadUrl",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/media/upload-urls",
      summary: "Reserve a private mediated media upload",
      tags: ["Media"],
      phi: "write",
      body: bodySchema(
        {
          patientId: uuid,
          encounterId: optionalUuid,
          toothNumber: nullableText,
          dentalFindingId: optionalUuid,
          mediaType: schema.enum([
            "intraoral_photo",
            "xray",
            "document",
            "audio_chunk",
            "generated_document"
          ]),
          originalFilename: schema.string({ minLength: 1, maxLength: 255 }),
          mimeType: schema.string({ minLength: 3, maxLength: 255 }),
          fileSizeBytes: schema.integer({ minimum: 1, maximum: 100 * 1024 * 1024 }),
          sha256Digest: schema.nullable(schema.sha256({ minLength: 64, maxLength: 64 })),
          tags: schema.array(shortText, { maxItems: 32 }),
          provenance: provenanceSchema
        },
        ["patientId", "mediaType", "originalFilename", "mimeType", "fileSizeBytes"]
      ),
      success: { 201: responseSchema({ upload: entity, uploadTarget: entity }) }
    }),
    operation({
      operationId: "receiveMediaUploadContent",
      checkpoint: "CP4",
      method: "PUT",
      path: "/v1/media/uploads/{uploadId}/content",
      summary: "Receive bytes through a mediated local/test upload target",
      tags: ["Media"],
      phi: "write",
      pathProperties: { uploadId: uuid },
      body: schema.string({ format: "binary", minLength: 1, maxLength: 100 * 1024 * 1024 }),
      bodyContentType: "application/octet-stream",
      maximumBodyBytes: 100 * 1024 * 1024,
      success: { 200: responseSchema({ upload: entity, object: entity }) }
    }),
    operation({
      operationId: "completeMediaUpload",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/media/uploads/{uploadId}/complete",
      summary: "Complete uploaded media metadata without client scan authority",
      tags: ["Media"],
      phi: "write",
      pathProperties: { uploadId: uuid },
      body: bodySchema(
        {
          patientId: uuid,
          encounterId: optionalUuid,
          contentLength: schema.nullable(
            schema.integer({ minimum: 1, maximum: 100 * 1024 * 1024 })
          ),
          sha256Digest: schema.nullable(schema.sha256({ minLength: 64, maxLength: 64 })),
          mimeType: nullableText
        },
        ["patientId"],
        {
          description:
            "Scan status, quarantine decisions, storage version, object key, bucket and provider metadata are server/provider authority and are never accepted from this public request."
        }
      ),
      success: { 201: singleEntity("mediaAsset") }
    }),
    operation({
      operationId: "listPatientMediaAssets",
      checkpoint: "CP4",
      method: "GET",
      path: "/v1/patients/{patientId}/media",
      summary: "List mediated public media metadata",
      tags: ["Media", "Patients"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      paginated: true,
      success: { 200: entityList("mediaAssets") }
    }),
    operation({
      operationId: "createSignedMediaAccess",
      checkpoint: "CP4",
      method: "POST",
      path: "/v1/media/assets/{mediaAssetId}/signed-url",
      summary: "Create short-lived mediated media read access",
      tags: ["Media"],
      phi: "read",
      pathProperties: { mediaAssetId: uuid },
      body: bodySchema({ expiresInSeconds: schema.integer({ minimum: 30, maximum: 300 }) }),
      success: { 200: responseSchema({ mediaAsset: entity, access: entity }) }
    })
  ];
}

function cp5Operations(): HttpOperationContract[] {
  const treatmentPlanBody = bodySchema(
    {
      encounterId: optionalUuid,
      title: shortText,
      clinicalSummary: nullableText,
      status: schema.enum(["draft", "presented"]),
      phases: schema.array(treatmentPlanPhaseSchema, { minItems: 1, maxItems: 25 })
    },
    ["title", "phases"]
  );
  return [
    operation({
      operationId: "listPricebookProcedures",
      checkpoint: "CP5",
      method: "GET",
      path: "/v1/pricebook/procedures",
      summary: "List server-authoritative pricebook procedures",
      tags: ["Billing", "Pricebook"],
      mutation: false,
      success: { 200: entityList("procedures") }
    }),
    operation({
      operationId: "createPatientTreatmentPlan",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/patients/{patientId}/treatment-plans",
      summary: "Create a treatment plan from server-priced catalog procedures",
      tags: ["Treatment Plans", "Billing"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: treatmentPlanBody,
      success: { 201: singleVersionedEntity("treatmentPlan") },
      requiredMasterWiring: [
        "Reject unknown writable fields before handler execution.",
        "Derive unit price, tax, discounts and totals from the active server pricebook; ignore no client price authority.",
        "Persist idempotency by actor, clinic, operation, key and canonical request digest."
      ]
    }),
    operation({
      operationId: "updateTreatmentPlan",
      checkpoint: "CP5",
      method: "PATCH",
      path: "/v1/treatment-plans/{treatmentPlanId}",
      summary: "Update an unsigned treatment plan",
      tags: ["Treatment Plans", "Billing"],
      phi: "write",
      pathProperties: { treatmentPlanId: uuid },
      body: bodySchema(
        {
          title: shortText,
          clinicalSummary: nullableText,
          status: schema.enum(["draft", "presented", "declined", "deferred", "cancelled"]),
          phases: schema.array(treatmentPlanPhaseSchema, { minItems: 1, maxItems: 25 })
        },
        [],
        { minProperties: 1 }
      ),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("treatmentPlan") }
    }),
    operation({
      operationId: "acceptTreatmentPlan",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/treatment-plans/{treatmentPlanId}/accept",
      summary: "Record treatment-plan acceptance without client signature authority",
      tags: ["Treatment Plans"],
      phi: "write",
      pathProperties: { treatmentPlanId: uuid },
      body: bodySchema({ acceptedByName: nullableText, acceptanceEvidence: WRITABLE_JSON_SCHEMA }),
      success: { 200: singleVersionedEntity("treatmentPlan") }
    }),
    operation({
      operationId: "createEncounterProcedurePerformed",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/encounters/{encounterId}/procedures",
      summary: "Record completed procedure evidence against an accepted plan item",
      tags: ["Clinical", "Billing"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: bodySchema(
        {
          treatmentPlanId: uuid,
          treatmentPlanEstimateItemId: uuid,
          performedAt: nullableDateTime,
          notes: nullableText,
          outcome: nullableText,
          provenance: provenanceSchema
        },
        ["treatmentPlanId", "treatmentPlanEstimateItemId"]
      ),
      success: {
        201: responseSchema({ procedure: entity, treatmentPlan: versionedEntity })
      }
    }),
    operation({
      operationId: "createInvoice",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/invoices",
      summary: "Create an invoice from completed procedure evidence",
      tags: ["Billing", "Invoices"],
      phi: "write",
      body: bodySchema(
        {
          patientId: optionalUuid,
          treatmentPlanId: optionalUuid,
          procedurePerformedIds: uuidList,
          dueAt: nullableDateTime
        },
        [],
        {
          anyOf: [
            { type: "object", required: ["treatmentPlanId"], additionalProperties: true },
            { type: "object", required: ["procedurePerformedIds"], additionalProperties: true }
          ],
          description:
            "Line items, prices, tax, discounts and totals are not writable. The server derives them from accepted procedure evidence."
        }
      ),
      success: { 201: singleEntity("invoice") }
    }),
    operation({
      operationId: "getInvoice",
      checkpoint: "CP5",
      method: "GET",
      path: "/v1/invoices/{invoiceId}",
      summary: "Get an invoice with public payment and receipt projections",
      tags: ["Billing", "Invoices"],
      phi: "read",
      pathProperties: { invoiceId: uuid },
      mutation: false,
      success: { 200: singleEntity("invoice") }
    }),
    operation({
      operationId: "createInvoiceReceipt",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/invoices/{invoiceId}/receipts",
      summary: "Create a receipt from verified payment transactions",
      tags: ["Billing", "Invoices"],
      phi: "write",
      pathProperties: { invoiceId: uuid },
      body: bodySchema({ paymentTransactionIds: uuidList }),
      success: { 201: responseSchema({ receipt: entity, invoice: entity }) }
    }),
    operation({
      operationId: "createPatientInstruction",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/patients/{patientId}/instructions",
      summary: "Create print or provider-send instruction evidence",
      tags: ["Clinical", "Instructions"],
      phi: "write",
      pathProperties: { patientId: uuid },
      body: bodySchema(
        {
          channel: schema.enum(["print", "whatsapp"]),
          templateId: shortText,
          title: nullableText,
          body: nullableText
        },
        ["templateId"]
      ),
      success: { 201: singleEntity("instruction"), 202: singleEntity("instruction") }
    }),
    operation({
      operationId: "createInvoicePaymentRequest",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/invoices/{invoiceId}/payment-requests",
      summary: "Create a bounded payment link or QR request",
      tags: ["Billing", "Payments"],
      phi: "write",
      pathProperties: { invoiceId: uuid },
      body: bodySchema(
        {
          requestType: schema.enum(["payment_link", "invoice_qr"]),
          amountMinor: positiveInteger,
          expiresAt: nullableDateTime,
          description: nullableText,
          customer: schema.nullable(
            bodySchema({ name: nullableText, email: nullableText, contact: nullableText })
          ),
          metadata: WRITABLE_JSON_SCHEMA
        },
        [],
        {
          description:
            "The optional amount is a partial collection amount bounded by the server invoice balance; it cannot alter invoice price or total."
        }
      ),
      success: {
        201: responseSchema({ invoice: entity, paymentRequest: entity, provider: entity })
      }
    }),
    operation({
      operationId: "recordInvoiceManualPayment",
      checkpoint: "CP5",
      method: "POST",
      path: "/v1/invoices/{invoiceId}/manual-payments",
      summary: "Record reasoned manual payment evidence",
      tags: ["Billing", "Payments"],
      phi: "write",
      pathProperties: { invoiceId: uuid },
      body: bodySchema(
        {
          amountMinor: positiveInteger,
          currency: schema.enum(["INR"]),
          method: schema.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]),
          reason: text,
          reference: shortText,
          receivedAt: nullableDateTime,
          evidence: WRITABLE_JSON_SCHEMA
        },
        ["amountMinor", "method", "reason", "reference", "evidence"]
      ),
      success: {
        201: responseSchema({
          invoice: entity,
          transaction: entity,
          reconciliationItem: schema.nullable(entity),
          replayed: schema.boolean()
        })
      }
    })
  ];
}

function cp6Operations(): HttpOperationContract[] {
  const taskStatuses = ["open", "in_progress", "done", "cancelled"] as const;
  const taskTypes = [
    "confirmation",
    "missed_call",
    "whatsapp_request",
    "follow_up",
    "post_op_follow_up",
    "recall",
    "payment_due",
    "payment_follow_up",
    "lab_case",
    "sop",
    "inventory_check",
    "procurement",
    "incident",
    "corrective_action",
    "manual"
  ] as const;
  const taskPriorities = ["low", "normal", "high", "urgent"] as const;
  const taskSources = [
    "manual",
    "appointment_confirmation",
    "recall_generation",
    "post_op_follow_up",
    "payment_follow_up",
    "sop_run",
    "lab_case",
    "inventory_check",
    "incident_capa",
    "system"
  ] as const;
  const labStatuses = [
    "draft",
    "ready_for_pickup",
    "sent_to_lab",
    "received_by_lab",
    "due",
    "returned",
    "fitted",
    "completed",
    "cancelled",
    "rework_required"
  ] as const;
  const incidentCategories = [
    "clinical",
    "operational",
    "lab",
    "inventory",
    "billing",
    "safety",
    "patient_experience",
    "security_privacy",
    "other"
  ] as const;
  return [
    operation({
      operationId: "getOwnerDashboard",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/owner-dashboard",
      summary: "Get aggregate owner analytics without patient detail",
      tags: ["Dashboard", "Analytics"],
      mutation: false,
      queryProperties: { from: date, to: date },
      success: { 200: singleEntity("dashboard") }
    }),
    operation({
      operationId: "listTasks",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/tasks",
      summary: "List clinic continuity tasks",
      tags: ["Tasks"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: {
        status: schema.enum(taskStatuses),
        dueDate: date,
        dueBefore: dateTime,
        assignedToUserId: uuid,
        patientId: uuid,
        sourceWorkflow: schema.enum(taskSources)
      },
      success: { 200: versionedEntityList("tasks") }
    }),
    operation({
      operationId: "createTask",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/tasks",
      summary: "Create an attributable continuity task",
      tags: ["Tasks"],
      phi: "write",
      body: bodySchema(
        {
          patientId: optionalUuid,
          leadId: optionalUuid,
          appointmentId: optionalUuid,
          invoiceId: optionalUuid,
          encounterId: optionalUuid,
          treatmentPlanId: optionalUuid,
          procedurePerformedId: optionalUuid,
          taskType: schema.enum(taskTypes),
          sourceWorkflow: schema.enum(taskSources),
          sourceRecordType: nullableText,
          sourceRecordId: optionalUuid,
          title: shortText,
          description: nullableText,
          priority: schema.enum(taskPriorities),
          status: schema.enum(taskStatuses),
          dueAt: nullableDateTime,
          assignedToUserId: optionalUuid
        },
        ["title"]
      ),
      success: { 201: singleVersionedEntity("task") }
    }),
    operation({
      operationId: "updateTask",
      checkpoint: "CP6",
      method: "PATCH",
      path: "/v1/tasks/{taskId}",
      summary: "Update task state and completion evidence",
      tags: ["Tasks"],
      phi: "write",
      pathProperties: { taskId: uuid },
      body: bodySchema(
        {
          status: schema.enum(taskStatuses),
          assignedToUserId: optionalUuid,
          priority: schema.enum(taskPriorities),
          dueAt: nullableDateTime,
          title: shortText,
          description: nullableText,
          completionEvidence: WRITABLE_JSON_SCHEMA,
          cancelledReason: nullableText
        },
        [],
        { minProperties: 1 }
      ),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("task") }
    }),
    operation({
      operationId: "generateDueContinuityTasks",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/tasks/generate-due",
      summary: "Generate due recall and follow-up tasks idempotently",
      tags: ["Tasks", "Recalls"],
      body: bodySchema({ asOf: dateTime }),
      success: {
        202: responseSchema({
          recallTasksCreated: versionedEntities,
          followUpTasksCreated: versionedEntities,
          recallsCreated: entities,
          skippedExistingKeys: stringList
        })
      }
    }),
    operation({
      operationId: "createRecallRule",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/recall-rules",
      summary: "Create a recall generation rule",
      tags: ["Recalls"],
      body: bodySchema(
        {
          code: shortText,
          title: shortText,
          anchor: schema.enum(["procedure_completed", "checkout_completed"]),
          offsetDays: schema.integer({ minimum: 1, maximum: 3650 }),
          procedureCategory: nullableText,
          pricebookProcedureId: optionalUuid,
          defaultTaskTitle: nullableText,
          defaultTaskPriority: schema.enum(taskPriorities)
        },
        ["code", "title"]
      ),
      success: { 201: singleEntity("recallRule") }
    }),
    operation({
      operationId: "listRecalls",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/recalls",
      summary: "List due and actioned recalls",
      tags: ["Recalls"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: {
        status: schema.enum([
          "due",
          "contact_requested",
          "contacted",
          "booked",
          "completed",
          "cancelled",
          "skipped"
        ]),
        dueBefore: dateTime,
        patientId: uuid
      },
      success: { 200: entityList("recalls") }
    }),
    operation({
      operationId: "recordRecallAction",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/recalls/{recallId}/actions",
      summary: "Record attributable recall action evidence",
      tags: ["Recalls"],
      phi: "write",
      pathProperties: { recallId: uuid },
      body: bodySchema(
        {
          actionType: schema.enum([
            "manual_contact_requested",
            "manual_contacted",
            "appointment_booked",
            "completed",
            "skipped",
            "cancelled"
          ]),
          method: nullableText,
          appointmentId: optionalUuid,
          evidence: WRITABLE_JSON_SCHEMA,
          notes: nullableText
        },
        ["actionType", "evidence"]
      ),
      success: { 200: singleEntity("recall") }
    }),
    ...sopOperations(taskPriorities),
    ...labOperations(labStatuses),
    ...inventoryOperations(),
    operation({
      operationId: "listIncidents",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/incidents",
      summary: "List quality and safety incidents",
      tags: ["Quality", "Incidents"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: {
        status: schema.enum([
          "open",
          "under_review",
          "capa_assigned",
          "resolved",
          "closed",
          "cancelled"
        ]),
        severity: schema.enum(["low", "medium", "high", "critical"]),
        category: schema.enum(incidentCategories)
      },
      success: { 200: entityList("incidents") }
    }),
    operation({
      operationId: "createIncident",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/incidents",
      summary: "Create a quality or safety incident",
      tags: ["Quality", "Incidents"],
      phi: "write",
      body: bodySchema(
        {
          patientId: optionalUuid,
          appointmentId: optionalUuid,
          labCaseId: optionalUuid,
          inventoryItemId: optionalUuid,
          category: schema.enum(incidentCategories),
          severity: schema.enum(["low", "medium", "high", "critical"]),
          occurredAt: dateTime,
          location: nullableText,
          summary: shortText,
          description: longText,
          impact: nullableText,
          learning: nullableText,
          immediateAction: nullableText,
          evidence: WRITABLE_JSON_SCHEMA,
          ownerUserId: optionalUuid
        },
        ["category", "severity", "occurredAt", "summary", "description"]
      ),
      success: { 201: singleEntity("incident") }
    }),
    operation({
      operationId: "listCorrectiveActions",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/corrective-actions",
      summary: "List corrective and preventive actions",
      tags: ["Quality", "Corrective Actions"],
      mutation: false,
      paginated: true,
      success: { 200: versionedEntityList("correctiveActions") }
    }),
    operation({
      operationId: "createCorrectiveAction",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/corrective-actions",
      summary: "Create a corrective or preventive action",
      tags: ["Quality", "Corrective Actions"],
      body: bodySchema(
        {
          incidentId: optionalUuid,
          actionType: schema.enum(["corrective", "preventive"]),
          title: shortText,
          description: longText,
          ownerUserId: uuid,
          dueAt: dateTime,
          verificationEvidence: WRITABLE_JSON_SCHEMA
        },
        ["title", "description", "ownerUserId", "dueAt"]
      ),
      success: { 201: singleVersionedEntity("correctiveAction") }
    }),
    operation({
      operationId: "updateCorrectiveAction",
      checkpoint: "CP6",
      method: "PATCH",
      path: "/v1/corrective-actions/{correctiveActionId}",
      summary: "Transition corrective action state",
      tags: ["Quality", "Corrective Actions"],
      pathProperties: { correctiveActionId: uuid },
      body: bodySchema(
        {
          status: schema.enum(["open", "in_progress", "completed", "cancelled"]),
          completionEvidence: WRITABLE_JSON_SCHEMA,
          verificationEvidence: WRITABLE_JSON_SCHEMA
        },
        ["status", "completionEvidence"]
      ),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("correctiveAction") }
    })
  ];
}

function sopOperations(taskPriorities: readonly string[]): HttpOperationContract[] {
  const runStatuses = ["due", "in_progress", "completed", "cancelled", "overdue"] as const;
  return [
    operation({
      operationId: "createSopTemplate",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/sop-templates",
      summary: "Create a versioned SOP checklist template",
      tags: ["SOP"],
      body: bodySchema(
        {
          code: shortText,
          title: shortText,
          description: nullableText,
          items: schema.array(
            bodySchema(
              { title: shortText, instructions: nullableText, evidenceRequired: schema.boolean() },
              ["title"]
            ),
            { minItems: 1, maxItems: 100 }
          )
        },
        ["code", "title", "items"]
      ),
      success: { 201: singleEntity("sopTemplate") }
    }),
    operation({
      operationId: "createSopSchedule",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/sop-schedules",
      summary: "Schedule recurring SOP runs",
      tags: ["SOP"],
      body: bodySchema(
        {
          templateId: uuid,
          title: shortText,
          recurrenceType: schema.enum(["daily", "weekly", "monthly", "interval_days"]),
          intervalDays: schema.nullable(schema.integer({ minimum: 1, maximum: 365 })),
          dayOfWeek: schema.nullable(schema.integer({ minimum: 0, maximum: 6 })),
          dayOfMonth: schema.nullable(schema.integer({ minimum: 1, maximum: 31 })),
          dueTime: shortText,
          timezone: nullableText,
          startsOn: date,
          endsOn: schema.nullable(date),
          assignedToUserId: optionalUuid,
          defaultTaskPriority: schema.enum(taskPriorities)
        },
        ["templateId", "title", "recurrenceType", "dueTime", "startsOn"]
      ),
      success: { 201: singleEntity("sopSchedule") }
    }),
    operation({
      operationId: "listSopRuns",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/sop-runs",
      summary: "List generated SOP runs",
      tags: ["SOP"],
      mutation: false,
      paginated: true,
      queryProperties: { date, status: schema.enum(runStatuses), dueBefore: dateTime },
      success: { 200: versionedEntityList("sopRuns") }
    }),
    operation({
      operationId: "generateDueSopRuns",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/sop-runs/generate-due",
      summary: "Generate due SOP runs idempotently",
      tags: ["SOP"],
      body: bodySchema({ asOf: dateTime }),
      success: {
        202: responseSchema({
          sopRunsCreated: versionedEntities,
          skippedExistingKeys: stringList
        })
      }
    }),
    operation({
      operationId: "updateSopRun",
      checkpoint: "CP6",
      method: "PATCH",
      path: "/v1/sop-runs/{sopRunId}",
      summary: "Update SOP checklist and completion evidence",
      tags: ["SOP"],
      pathProperties: { sopRunId: uuid },
      body: bodySchema(
        {
          status: schema.enum(runStatuses),
          completionEvidence: WRITABLE_JSON_SCHEMA,
          items: schema.array(
            bodySchema(
              {
                itemId: uuid,
                status: schema.enum(["pending", "done", "skipped"]),
                evidence: WRITABLE_JSON_SCHEMA
              },
              ["itemId", "status", "evidence"]
            ),
            { maxItems: 100 }
          )
        },
        [],
        { minProperties: 1 }
      ),
      optimisticConcurrency: true,
      success: { 200: singleVersionedEntity("sopRun") }
    })
  ];
}

function labOperations(labStatuses: readonly string[]): HttpOperationContract[] {
  const labItem = bodySchema(
    {
      itemType: shortText,
      toothNumber: nullableText,
      material: nullableText,
      shade: nullableText,
      quantity: schema.integer({ minimum: 1, maximum: 99 }),
      notes: nullableText
    },
    ["itemType"]
  );
  return [
    operation({
      operationId: "listLabVendors",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/lab-vendors",
      summary: "List configured laboratory vendors",
      tags: ["Laboratory"],
      mutation: false,
      paginated: true,
      success: { 200: entityList("labVendors") }
    }),
    operation({
      operationId: "createLabVendor",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/lab-vendors",
      summary: "Create a laboratory vendor",
      tags: ["Laboratory"],
      body: bodySchema(
        {
          displayName: shortText,
          phone: nullableText,
          email: schema.nullable(schema.string({ format: "email", maxLength: 320 })),
          address: WRITABLE_JSON_SCHEMA,
          taxRegistrationNumber: nullableText,
          paymentTermsDays: schema.integer({ minimum: 0, maximum: 365 })
        },
        ["displayName"]
      ),
      success: { 201: singleEntity("labVendor") }
    }),
    operation({
      operationId: "listLabCases",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/lab-cases",
      summary: "List patient laboratory cases",
      tags: ["Laboratory"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: { status: schema.enum(labStatuses), dueBefore: dateTime, vendorId: uuid },
      success: { 200: versionedEntityList("labCases") }
    }),
    operation({
      operationId: "createLabCase",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/lab-cases",
      summary: "Create a patient laboratory case and slip",
      tags: ["Laboratory"],
      phi: "write",
      body: bodySchema(
        {
          vendorId: uuid,
          patientId: uuid,
          encounterId: optionalUuid,
          treatmentPlanId: optionalUuid,
          treatmentPlanEstimateItemId: optionalUuid,
          procedurePerformedId: optionalUuid,
          title: shortText,
          priority: schema.enum(["routine", "urgent"]),
          dueAt: dateTime,
          clinicalNotes: nullableText,
          internalNotes: nullableText,
          expectedCostMinor: schema.nullable(nonNegativeInteger),
          slipMetadata: WRITABLE_JSON_SCHEMA,
          items: schema.array(labItem, { minItems: 1, maxItems: 100 })
        },
        ["vendorId", "patientId", "title", "dueAt", "items"]
      ),
      success: { 201: responseSchema({ labCase: labCaseDetailSchema }) }
    }),
    operation({
      operationId: "updateLabCase",
      checkpoint: "CP6",
      method: "PATCH",
      path: "/v1/lab-cases/{labCaseId}",
      summary: "Transition a laboratory case with evidence",
      tags: ["Laboratory"],
      phi: "write",
      pathProperties: { labCaseId: uuid },
      body: bodySchema(
        { status: schema.enum(labStatuses), reason: nullableText, evidence: WRITABLE_JSON_SCHEMA },
        ["status"]
      ),
      optimisticConcurrency: true,
      success: { 200: responseSchema({ labCase: labCaseDetailSchema }) }
    }),
    operation({
      operationId: "createLabReconciliation",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/lab-reconciliations",
      summary: "Create a laboratory invoice reconciliation",
      tags: ["Laboratory", "Billing"],
      body: bodySchema(
        {
          vendorId: uuid,
          periodStart: date,
          periodEnd: date,
          status: schema.enum([
            "draft",
            "submitted",
            "matched",
            "variance_review",
            "approved",
            "cancelled"
          ]),
          invoiceReference: nullableText,
          invoiceAmountMinor: schema.nullable(nonNegativeInteger),
          evidence: WRITABLE_JSON_SCHEMA,
          entries: schema.array(
            bodySchema(
              {
                labCaseId: uuid,
                status: schema.enum([
                  "matched",
                  "amount_variance",
                  "missing_invoice",
                  "unbilled_case",
                  "excluded"
                ]),
                invoiceAmountMinor: schema.nullable(nonNegativeInteger),
                notes: nullableText
              },
              ["labCaseId"]
            ),
            { minItems: 1, maxItems: 100 }
          )
        },
        ["vendorId", "periodStart", "periodEnd", "evidence", "entries"]
      ),
      success: { 201: singleEntity("labReconciliation") }
    })
  ];
}

function inventoryOperations(): HttpOperationContract[] {
  return [
    operation({
      operationId: "listInventoryCategories",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/inventory/categories",
      summary: "List inventory categories",
      tags: ["Inventory"],
      mutation: false,
      paginated: true,
      success: { 200: entityList("categories") }
    }),
    operation({
      operationId: "createInventoryCategory",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/inventory/categories",
      summary: "Create an inventory category",
      tags: ["Inventory"],
      body: bodySchema(
        {
          code: shortText,
          displayName: shortText,
          kind: schema.enum(["material", "instrument", "equipment"]),
          active: schema.boolean()
        },
        ["code", "displayName", "kind"]
      ),
      success: { 201: singleEntity("category") }
    }),
    operation({
      operationId: "listInventoryItems",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/inventory/items",
      summary: "List inventory items and quantities",
      tags: ["Inventory"],
      mutation: false,
      paginated: true,
      success: { 200: entityList("items") }
    }),
    operation({
      operationId: "createInventoryItem",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/inventory/items",
      summary: "Create a tracked inventory item",
      tags: ["Inventory"],
      body: bodySchema(
        {
          categoryId: uuid,
          sku: shortText,
          displayName: shortText,
          unitOfMeasure: shortText,
          storageLocation: shortText,
          trackQuantity: schema.boolean(),
          minimumQuantity: positiveNumber,
          reorderQuantity: positiveNumber,
          openingQuantity: positiveNumber
        },
        ["categoryId", "sku", "displayName", "unitOfMeasure", "storageLocation"]
      ),
      success: { 201: singleEntity("item") }
    }),
    operation({
      operationId: "createStockLedgerEntry",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/inventory/stock-ledger",
      summary: "Append a reasoned stock ledger movement",
      tags: ["Inventory"],
      body: bodySchema(
        {
          itemId: uuid,
          movementType: schema.enum([
            "opening_balance",
            "manual_adjustment",
            "consumption",
            "check_variance",
            "procurement_received",
            "write_off"
          ]),
          quantityDelta: schema.number({ minimum: -1_000_000, maximum: 1_000_000 }),
          unitCostMinor: schema.nullable(nonNegativeInteger),
          currency: schema.nullable(schema.enum(["INR"])),
          sourceTable: nullableText,
          sourceId: optionalUuid,
          reason: text,
          evidence: WRITABLE_JSON_SCHEMA
        },
        ["itemId", "movementType", "quantityDelta", "reason", "evidence"]
      ),
      success: { 201: singleEntity("stockLedgerEntry") }
    }),
    operation({
      operationId: "listInventoryCheckTemplates",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/inventory/check-templates",
      summary: "List inventory check templates",
      tags: ["Inventory"],
      mutation: false,
      paginated: true,
      success: { 200: entityList("templates") }
    }),
    operation({
      operationId: "createInventoryCheckTemplate",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/inventory/check-templates",
      summary: "Create an inventory check template",
      tags: ["Inventory"],
      body: bodySchema(
        {
          code: shortText,
          displayName: shortText,
          cadence: schema.enum(["daily", "weekly", "monthly", "ad_hoc"]),
          active: schema.boolean(),
          lines: schema.array(
            bodySchema(
              {
                itemId: uuid,
                sequence: positiveInteger,
                drawerLocation: shortText,
                expectedQuantity: schema.nullable(positiveNumber),
                required: schema.boolean(),
                instructions: nullableText
              },
              ["itemId", "drawerLocation"]
            ),
            { minItems: 1, maxItems: 100 }
          )
        },
        ["code", "displayName", "lines"]
      ),
      success: { 201: singleEntity("template") }
    }),
    operation({
      operationId: "createInventoryCheckRun",
      checkpoint: "CP6",
      method: "POST",
      path: "/v1/inventory/check-runs",
      summary: "Create an inventory check run",
      tags: ["Inventory"],
      body: bodySchema({ templateId: uuid, notes: nullableText }, ["templateId"]),
      success: { 201: responseSchema({ checkRun: inventoryCheckRunDetailSchema }) }
    }),
    operation({
      operationId: "updateInventoryCheckRun",
      checkpoint: "CP6",
      method: "PATCH",
      path: "/v1/inventory/check-runs/{checkRunId}",
      summary: "Update counted inventory and complete a check run",
      tags: ["Inventory"],
      pathProperties: { checkRunId: uuid },
      body: bodySchema(
        {
          status: schema.enum(["draft", "in_progress", "completed", "cancelled"]),
          notes: nullableText,
          lines: schema.array(
            bodySchema(
              { lineId: uuid, countedQuantity: positiveNumber, exceptionNotes: nullableText },
              ["lineId", "countedQuantity"]
            ),
            { maxItems: 100 }
          )
        },
        ["status"]
      ),
      optimisticConcurrency: true,
      success: { 200: responseSchema({ checkRun: inventoryCheckRunDetailSchema }) }
    }),
    operation({
      operationId: "listInventoryExceptions",
      checkpoint: "CP6",
      method: "GET",
      path: "/v1/inventory/exceptions",
      summary: "List inventory exceptions and procurement suggestions",
      tags: ["Inventory"],
      mutation: false,
      paginated: true,
      queryProperties: { itemId: uuid, checkRunId: uuid },
      success: { 200: entityList("exceptions") }
    })
  ];
}

function cp7Operations(): HttpOperationContract[] {
  const migrationBatchStatuses = [
    "uploaded",
    "parsed",
    "validated",
    "needs_review",
    "ready_to_commit",
    "committed",
    "partially_committed",
    "failed",
    "rolled_back"
  ] as const;
  return [
    operation({
      operationId: "listProviderHealth",
      checkpoint: "CP7",
      method: "GET",
      path: "/v1/provider-health",
      summary: "List registered provider activation and health truth",
      tags: ["Integrations"],
      mutation: false,
      success: { 200: entityList("providers") }
    }),
    operation({
      operationId: "listDeadLetterEvents",
      checkpoint: "CP7",
      method: "GET",
      path: "/v1/dead-letter-events",
      summary: "List sanitized integration dead-letter evidence",
      tags: ["Integrations", "Operations"],
      mutation: false,
      paginated: true,
      queryProperties: {
        status: schema.enum([
          "unreviewed",
          "replay_requested",
          "replayed",
          "ignored",
          "blocked",
          "open",
          "retry_scheduled",
          "resolved",
          "discarded"
        ])
      },
      success: { 200: entityList("deadLetterEvents") }
    }),
    operation({
      operationId: "replayDeadLetterEvent",
      checkpoint: "CP7",
      method: "POST",
      path: "/v1/dead-letter-events/{deadLetterEventId}/replay",
      summary: "Request a reasoned dead-letter replay without claiming provider success",
      tags: ["Integrations", "Operations"],
      pathProperties: { deadLetterEventId: uuid },
      body: bodySchema({ reason: nullableText }),
      success: { 202: singleEntity("replay") }
    }),
    operation({
      operationId: "listMigrationBatches",
      checkpoint: "CP7",
      method: "GET",
      path: "/v1/migration-batches",
      summary: "List reviewed migration batches",
      tags: ["Migration"],
      mutation: false,
      paginated: true,
      queryProperties: { status: schema.enum(migrationBatchStatuses) },
      success: { 200: entityList("migrationBatches") }
    }),
    operation({
      operationId: "createMigrationBatch",
      checkpoint: "CP7",
      method: "POST",
      path: "/v1/migration-batches",
      summary: "Create a bounded patient migration batch for review",
      tags: ["Migration"],
      phi: "write",
      body: bodySchema(
        {
          importType: schema.enum(["patients"]),
          sourceSystem: shortText,
          sourceFileName: nullableText,
          sourceChecksum: schema.nullable(schema.sha256({ minLength: 64, maxLength: 64 })),
          csv: schema.nullable(schema.string({ minLength: 1, maxLength: 900_000 })),
          rows: schema.array(WRITABLE_JSON_SCHEMA, { minItems: 1, maxItems: 10_000 })
        },
        ["importType"],
        {
          anyOf: [
            { type: "object", required: ["csv"], additionalProperties: true },
            { type: "object", required: ["rows"], additionalProperties: true }
          ]
        }
      ),
      success: { 201: responseSchema({ batch: entity, rows: entities, conflicts: entities }) }
    }),
    operation({
      operationId: "getMigrationBatch",
      checkpoint: "CP7",
      method: "GET",
      path: "/v1/migration-batches/{batchId}",
      summary: "Get a migration batch and sanitized row evidence",
      tags: ["Migration"],
      phi: "read",
      pathProperties: { batchId: uuid },
      mutation: false,
      success: { 200: responseSchema({ batch: entity, rows: entities, conflicts: entities }) }
    }),
    operation({
      operationId: "listMigrationBatchRows",
      checkpoint: "CP7",
      method: "GET",
      path: "/v1/migration-batches/{batchId}/rows",
      summary: "List migration rows requiring review",
      tags: ["Migration"],
      phi: "read",
      pathProperties: { batchId: uuid },
      mutation: false,
      paginated: true,
      queryProperties: {
        matchStatus: schema.enum([
          "none",
          "duplicate_candidate",
          "conflict",
          "resolved",
          "skipped"
        ]),
        status: schema.enum([
          "invalid",
          "needs_review",
          "ready_to_commit",
          "committed",
          "skipped",
          "rolled_back",
          "failed"
        ])
      },
      success: { 200: entityList("rows") }
    }),
    operation({
      operationId: "resolveMigrationBatchRow",
      checkpoint: "CP7",
      method: "POST",
      path: "/v1/migration-batches/{batchId}/rows/{rowId}/resolve",
      summary: "Resolve one migration row without silent record overwrite",
      tags: ["Migration"],
      phi: "write",
      pathProperties: { batchId: uuid, rowId: uuid },
      body: bodySchema(
        {
          action: schema.enum(["import_new", "link_existing", "skip"]),
          targetRecordType: shortText,
          targetRecordId: optionalUuid,
          note: nullableText
        },
        ["action"]
      ),
      success: { 200: singleEntity("row") }
    }),
    operation({
      operationId: "commitMigrationBatch",
      checkpoint: "CP7",
      method: "POST",
      path: "/v1/migration-batches/{batchId}/commit",
      summary: "Commit only reviewed migration rows",
      tags: ["Migration"],
      phi: "write",
      pathProperties: { batchId: uuid },
      body: emptyBody,
      success: {
        202: responseSchema({
          batch: entity,
          commit: entity,
          rows: entities,
          importedRecordLinks: entities
        })
      }
    }),
    operation({
      operationId: "rollbackMigrationBatch",
      checkpoint: "CP7",
      method: "POST",
      path: "/v1/migration-batches/{batchId}/rollback",
      summary: "Roll back a migration batch subject to provenance safety",
      tags: ["Migration"],
      phi: "write",
      pathProperties: { batchId: uuid },
      body: emptyBody,
      success: {
        202: responseSchema({
          batch: entity,
          rollback: entity,
          rows: entities,
          importedRecordLinks: entities,
          blockedLinks: entities
        })
      }
    })
  ];
}

function cp8Operations(): HttpOperationContract[] {
  return [
    operation({
      operationId: "listEncounterAiScribeSessions",
      checkpoint: "CP8",
      method: "GET",
      path: "/v1/encounters/{encounterId}/ai-scribe/sessions",
      summary: "List consent-gated AI scribe sessions for an encounter",
      tags: ["AI Scribe"],
      phi: "read",
      pathProperties: { encounterId: uuid },
      mutation: false,
      paginated: true,
      success: { 200: entityList("sessions") }
    }),
    operation({
      operationId: "createAiScribeSession",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/encounters/{encounterId}/ai-scribe/sessions",
      summary: "Create a consent-gated AI scribe session",
      tags: ["AI Scribe"],
      phi: "write",
      pathProperties: { encounterId: uuid },
      body: bodySchema(
        {
          requireRawAudioRetention: schema.boolean(),
          languageHint: nullableText,
          captureSurface: shortText
        },
        []
      ),
      success: { 201: singleEntity("session") }
    }),
    operation({
      operationId: "getAiScribeSession",
      checkpoint: "CP8",
      method: "GET",
      path: "/v1/ai-scribe/sessions/{sessionId}",
      summary: "Get review-safe AI scribe session detail",
      tags: ["AI Scribe"],
      phi: "read",
      pathProperties: { sessionId: uuid },
      mutation: false,
      success: { 200: singleEntity("aiScribeSession") }
    }),
    operation({
      operationId: "createAiScribeTranscriptSegment",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/ai-scribe/sessions/{sessionId}/transcript-segments",
      summary: "Append a bounded consent-gated transcript segment",
      tags: ["AI Scribe"],
      phi: "write",
      pathProperties: { sessionId: uuid },
      body: bodySchema(
        {
          text: schema.string({ minLength: 1, maxLength: 32_768 }),
          speakerRole: schema.enum(["doctor", "assistant", "patient", "unknown"]),
          startsAtMs: nonNegativeInteger,
          endsAtMs: nonNegativeInteger
        },
        ["text", "startsAtMs", "endsAtMs"]
      ),
      success: { 201: responseSchema({ segment: entity, sourceAnchor: entity }) }
    }),
    operation({
      operationId: "createAiScribeSourceAnchor",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/ai-scribe/sessions/{sessionId}/source-anchors",
      summary: "Create an AI provenance source anchor",
      tags: ["AI Scribe"],
      phi: "write",
      pathProperties: { sessionId: uuid },
      body: bodySchema(
        {
          anchorType: schema.enum([
            "transcript_segment",
            "media_asset",
            "clinical_context",
            "external_document"
          ]),
          sourceRecordType: shortText,
          sourceRecordId: shortText,
          transcriptSegmentId: optionalUuid,
          startsAtMs: schema.nullable(nonNegativeInteger),
          endsAtMs: schema.nullable(nonNegativeInteger),
          textQuoteDigest: schema.nullable(schema.sha256({ minLength: 64, maxLength: 64 })),
          supported: schema.boolean(),
          unsupportedReason: nullableText
        },
        ["anchorType", "sourceRecordType", "sourceRecordId"]
      ),
      success: { 201: singleEntity("sourceAnchor") }
    }),
    operation({
      operationId: "generateAiScribeDrafts",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/ai-scribe/sessions/{sessionId}/generate-drafts",
      summary: "Generate review-only AI clinical drafts",
      tags: ["AI Scribe"],
      phi: "write",
      pathProperties: { sessionId: uuid },
      body: bodySchema({ sourceAnchorIds: uuidList }),
      success: {
        201: responseSchema({ job: entity, draftOutputs: entities, actionProposals: entities })
      },
      requiredMasterWiring: [
        "Recheck active consent immediately before provider processing.",
        "Validate structured output and provenance; never apply, sign, prescribe, bill, merge or message from this operation.",
        "Keep the operation unreachable unless an approved provider/data path is activated."
      ]
    }),
    operation({
      operationId: "recordAiScribeReviewDecision",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/ai-scribe/sessions/{sessionId}/review-decisions",
      summary: "Record a human review-only AI decision",
      tags: ["AI Scribe"],
      phi: "write",
      pathProperties: { sessionId: uuid },
      body: bodySchema(
        {
          targetType: schema.enum(["draft_output", "action_proposal"]),
          targetId: uuid,
          decision: schema.enum(["approve", "reject", "request_changes"]),
          reason: text,
          editedContent: schema.nullable(WRITABLE_JSON_SCHEMA)
        },
        ["targetType", "targetId", "decision", "reason"]
      ),
      success: { 200: singleEntity("reviewDecision") }
    }),
    operation({
      operationId: "deleteAiScribeRetainedPayloads",
      checkpoint: "CP8",
      method: "POST",
      path: "/v1/ai-scribe/sessions/{sessionId}/retention-delete",
      summary: "Delete eligible retained AI transcript and audio references",
      tags: ["AI Scribe", "Privacy"],
      phi: "write",
      pathProperties: { sessionId: uuid },
      success: {
        200: responseSchema({
          session: entity,
          deletedTranscriptSegments: nonNegativeInteger,
          deletedRawAudioReferences: nonNegativeInteger
        })
      }
    })
  ];
}

function cp9Operations(): HttpOperationContract[] {
  const deletionStatuses = [
    "requested",
    "approved_pending_retention_job",
    "rejected",
    "completed",
    "cancelled"
  ] as const;
  const breakGlassStatuses = ["requested", "approved", "denied", "revoked", "expired"] as const;
  return [
    operation({
      operationId: "listAuditEvents",
      checkpoint: "CP9",
      method: "GET",
      path: "/v1/audit-events",
      summary: "List PHI-redacted audit events for review",
      tags: ["Audit", "Privacy"],
      mutation: false,
      paginated: true,
      queryProperties: {
        patientId: uuid,
        action: shortText,
        category: schema.enum([
          "security",
          "administration",
          "phi_access",
          "clinical",
          "billing",
          "operations",
          "quality",
          "integration",
          "privacy"
        ]),
        riskLevel: schema.enum(["low", "medium", "high", "critical"])
      },
      success: { 200: entityList("auditEvents") }
    }),
    operation({
      operationId: "reviewAuditEvent",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/audit-events/{auditEventId}/reviews",
      summary: "Append review evidence to an immutable audit event",
      tags: ["Audit", "Privacy"],
      pathProperties: { auditEventId: uuid },
      body: bodySchema(
        {
          reviewStatus: schema.enum(["reviewed", "escalated", "dismissed"]),
          disposition: text,
          notes: nullableText
        },
        ["reviewStatus", "disposition"]
      ),
      success: { 201: singleEntity("review") }
    }),
    operation({
      operationId: "listPatientRecordExports",
      checkpoint: "CP9",
      method: "GET",
      path: "/v1/patients/{patientId}/record-exports",
      summary: "List patient record export evidence without payload by default",
      tags: ["Privacy", "Exports"],
      phi: "read",
      pathProperties: { patientId: uuid },
      mutation: false,
      paginated: true,
      queryProperties: { status: schema.enum(["requested", "completed", "failed", "cancelled"]) },
      success: { 200: entityList("exports") }
    }),
    operation({
      operationId: "createPatientRecordExport",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/patients/{patientId}/record-exports",
      summary: "Create a sanitized patient record export",
      tags: ["Privacy", "Exports"],
      phi: "read",
      pathProperties: { patientId: uuid },
      body: bodySchema(
        {
          sections: schema.array(
            schema.enum([
              "demographics",
              "consents",
              "timeline",
              "intake",
              "encounters",
              "clinical_notes",
              "prescriptions",
              "instructions",
              "dental_chart",
              "media",
              "billing",
              "ai_evidence",
              "privacy_audit"
            ]),
            { maxItems: 13 }
          ),
          reason: text
        },
        []
      ),
      success: { 201: singleEntity("export") },
      requiredMasterWiring: [
        "Re-authorize and audit export creation at action time.",
        "Keep raw storage keys, signed URLs, provider payloads, secrets and unrelated tenant data out of the export.",
        "Apply no-store response policy and approved restricted evidence storage for real PHI."
      ]
    }),
    operation({
      operationId: "listDeletionRequests",
      checkpoint: "CP9",
      method: "GET",
      path: "/v1/privacy/deletion-requests",
      summary: "List governed deletion and correction requests",
      tags: ["Privacy", "Retention"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: { patientId: uuid, status: schema.enum(deletionStatuses) },
      success: { 200: entityList("deletionRequests") }
    }),
    operation({
      operationId: "createDeletionRequest",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/privacy/deletion-requests",
      summary: "Create a governed privacy deletion or correction request",
      tags: ["Privacy", "Retention"],
      phi: "write",
      body: bodySchema(
        {
          patientId: uuid,
          requestType: schema.enum([
            "patient_requested_deletion",
            "transient_payload_redaction",
            "correction_request"
          ]),
          reason: text,
          requestedCategories: schema.array(shortText, { minItems: 1, maxItems: 32 })
        },
        ["patientId", "requestType", "reason"]
      ),
      success: { 201: singleEntity("deletionRequest") }
    }),
    operation({
      operationId: "reviewDeletionRequest",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/privacy/deletion-requests/{deletionRequestId}/review",
      summary: "Review a deletion request conservatively",
      tags: ["Privacy", "Retention"],
      phi: "write",
      pathProperties: { deletionRequestId: uuid },
      body: bodySchema(
        { decision: schema.enum(["approve", "reject", "cancel"]), reviewReason: text },
        ["decision", "reviewReason"]
      ),
      success: { 200: singleEntity("deletionRequest") }
    }),
    operation({
      operationId: "runRetentionJob",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/privacy/retention-runs",
      summary: "Run a conservative auditable retention job",
      tags: ["Privacy", "Retention"],
      phi: "write",
      body: bodySchema(
        {
          mode: schema.enum(["dry_run", "execute"]),
          asOf: dateTime,
          policyCode: shortText,
          patientId: optionalUuid,
          deletionRequestId: optionalUuid,
          transcriptDeleteAfterDays: schema.integer({ minimum: 0, maximum: 3650 })
        },
        []
      ),
      success: { 202: responseSchema({ retentionRun: entity, actions: entities }) }
    }),
    operation({
      operationId: "listBreakGlassAccessRequests",
      checkpoint: "CP9",
      method: "GET",
      path: "/v1/break-glass/access-requests",
      summary: "List time-bounded break-glass requests",
      tags: ["Privacy", "Break Glass"],
      phi: "read",
      mutation: false,
      paginated: true,
      queryProperties: {
        patientId: uuid,
        status: schema.enum(breakGlassStatuses),
        requestedByUserId: uuid
      },
      success: { 200: entityList("breakGlassAccesses") }
    }),
    operation({
      operationId: "createBreakGlassAccessRequest",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/break-glass/access-requests",
      summary: "Request reasoned time-bounded break-glass access",
      tags: ["Privacy", "Break Glass"],
      phi: "write",
      body: bodySchema(
        {
          patientId: uuid,
          reason: text,
          expiresAt: dateTime,
          accessCategories: schema.array(
            schema.enum([
              "patient_record",
              "clinical_notes",
              "dental_chart",
              "media",
              "billing",
              "ai_evidence"
            ]),
            { minItems: 1, maxItems: 6 }
          )
        },
        ["patientId", "reason", "expiresAt", "accessCategories"]
      ),
      success: { 201: singleEntity("breakGlassAccess") }
    }),
    operation({
      operationId: "reviewBreakGlassAccessRequest",
      checkpoint: "CP9",
      method: "POST",
      path: "/v1/break-glass/access-requests/{breakGlassAccessId}/review",
      summary: "Approve, deny or revoke break-glass access",
      tags: ["Privacy", "Break Glass"],
      phi: "write",
      pathProperties: { breakGlassAccessId: uuid },
      body: bodySchema(
        { decision: schema.enum(["approve", "deny", "revoke"]), reviewReason: text },
        ["decision", "reviewReason"]
      ),
      success: { 200: singleEntity("breakGlassAccess") }
    })
  ];
}

function cp10Operations(): HttpOperationContract[] {
  return [
    operation({
      operationId: "getPilotReadiness",
      checkpoint: "CP10",
      method: "GET",
      path: "/v1/pilot-readiness",
      summary: "Report conservative pilot-readiness gates",
      tags: ["Readiness", "Operations"],
      mutation: false,
      success: { 200: singleEntity("readiness") }
    })
  ];
}

export interface DeferredHttpWorkflow {
  readonly workflow: string;
  readonly checkpointOrigin: EvidenceCheckpoint;
  readonly classification:
    "deferred_whole" | "projection_only" | "provider_unregistered" | "stale_fixture_only";
  readonly routeFamily: string;
  readonly reason: string;
  readonly activationGate: string;
}

export const DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS: readonly DeferredHttpWorkflow[] = [
  {
    workflow: "Appointment confirmation request draft",
    checkpointOrigin: "CP2",
    classification: "stale_fixture_only",
    routeFamily: "POST /v1/appointments/{appointmentId}/confirmation-request",
    reason:
      "The native router registers confirm, check-in and no-show actions but not the older confirmation-request note route.",
    activationGate:
      "Register a complete messaging request workflow with provider state, audit, outbox and parity tests, or keep it absent."
  },
  {
    workflow: "Assistant morning dashboard legacy alias",
    checkpointOrigin: "CP2",
    classification: "stale_fixture_only",
    routeFamily: "GET /v1/assistant/morning-dashboard",
    reason: "The active native route is GET /v1/dashboard/morning.",
    activationGate:
      "Consumers migrate to the active generated operation; do not add a compatibility alias without a time-bounded deprecation plan."
  },
  {
    workflow: "External imaging references and links",
    checkpointOrigin: "CP4",
    classification: "deferred_whole",
    routeFamily: "/v1/media/{mediaId}/links and external imaging callbacks",
    reason: "Only mediated upload, completion, list and signed-access routes are registered.",
    activationGate:
      "Activate only through an official imaging adapter with patient matching, authorization, audit and reconciliation."
  },
  {
    workflow: "Aggregate checkout read model",
    checkpointOrigin: "CP5",
    classification: "stale_fixture_only",
    routeFamily: "GET /v1/clinical-workflows/cp5",
    reason:
      "The web fixture read model is not an active native API operation; granular treatment, invoice and payment routes are active.",
    activationGate:
      "Implement one canonical durable read model and generated response contract before route registration."
  },
  {
    workflow: "WhatsApp inbound messages and delivery callbacks",
    checkpointOrigin: "CP7",
    classification: "provider_unregistered",
    routeFamily: "/v1/webhooks/whatsapp/*",
    reason:
      "Provider adapters exist, but no signed inbound Meta route is registered in the native router.",
    activationGate:
      "CP15 official HTTPS callback registration, challenge/signature verification, event deduplication and sandbox reconciliation."
  },
  {
    workflow: "Telephony call and missed-call callbacks",
    checkpointOrigin: "CP7",
    classification: "provider_unregistered",
    routeFamily: "/v1/webhooks/telephony/*",
    reason: "No signed telephony callback route is registered.",
    activationGate:
      "CP15 official provider registration, signed callback verification, ambiguous patient review and reconciliation."
  },
  {
    workflow: "AI scribe aggregate review queue",
    checkpointOrigin: "CP8",
    classification: "stale_fixture_only",
    routeFamily: "GET /v1/ai-scribe/review-queue",
    reason:
      "Session-scoped AI routes are active; the web aggregate queue remains fixture/configuration-only.",
    activationGate:
      "Implement a durable tenant-scoped queue projection with role, pagination, consent and provenance tests."
  },
  {
    workflow: "FHIR exchange API",
    checkpointOrigin: "CP9",
    classification: "projection_only",
    routeFamily: "/v1/fhir/*",
    reason:
      "The FHIR package is a projection/validator foundation and no public FHIR HTTP route is registered.",
    activationGate:
      "CP16 selects a complete exchange scope, validates official profiles, consent, identity, provenance and round-trip reconciliation."
  },
  {
    workflow: "ABDM/ABHA exchange",
    checkpointOrigin: "CP9",
    classification: "provider_unregistered",
    routeFamily: "/v1/abdm/*",
    reason:
      "Readiness modeling exists without credentials, approval or an active HTTP exchange route.",
    activationGate:
      "CP16 official sandbox approval, consent, patient matching, signed callbacks and reconciliation."
  },
  {
    workflow: "Native mobile audio/photo capture control plane",
    checkpointOrigin: "CP8",
    classification: "deferred_whole",
    routeFamily: "/v1/mobile/capture/*",
    reason:
      "Media upload routes are active, but native device capture and encrypted offline queue APIs are not registered.",
    activationGate:
      "CP16 physical-device capture, permissions, encrypted durable cache, consent, purge and distribution evidence."
  }
];

export const ACTIVE_NATIVE_HTTP_OPERATION_BY_ID: ReadonlyMap<string, HttpOperationContract> =
  new Map(ACTIVE_NATIVE_HTTP_OPERATIONS.map((candidate) => [candidate.operationId, candidate]));

export function getNativeHttpOperation(operationId: string): HttpOperationContract {
  const operation = ACTIVE_NATIVE_HTTP_OPERATION_BY_ID.get(operationId);
  if (!operation) throw new Error(`Unknown ClinicOS HTTP operation: ${operationId}`);
  return operation;
}

export function parseNativeOperationRequest(operationId: string, input: OperationRequestInput) {
  return parseOperationRequest(getNativeHttpOperation(operationId), input);
}

export function parseNativeOperationResponse(operationId: string, status: number, body: unknown) {
  return parseOperationResponse(getNativeHttpOperation(operationId), status, body);
}

export function parseNativeOperationResponseHeaders(
  operationId: string,
  status: number,
  headers: unknown
) {
  return parseOperationResponseHeaders(getNativeHttpOperation(operationId), status, headers);
}

export function resolveNativeResponseSchemaPath(
  operationId: string,
  status: number,
  responsePath: string
): RuntimeSchema {
  const response = getNativeHttpOperation(operationId).responses[status];
  if (!response) throw new Error(`Missing ${status} response for ${operationId}`);
  let current = response.schema;
  for (const rawSegment of responsePath.split(".")) {
    const array = rawSegment.endsWith("[]");
    const segment = array ? rawSegment.slice(0, -2) : rawSegment;
    const property = current.properties?.[segment];
    if (!property) {
      throw new Error(`Missing response schema path ${responsePath} for ${operationId}`);
    }
    current = array ? (property.items ?? {}) : property;
  }
  return current;
}

export function normalizedRouteKey(method: HttpMethod, path: string): string {
  return `${method} ${path.replace(/\{[^}]+\}/g, "{}")}`;
}

export function assertNativeHttpContractRegistry(): void {
  const operationIds = new Set<string>();
  const routes = new Set<string>();
  for (const candidate of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    if (operationIds.has(candidate.operationId)) {
      throw new Error(`Duplicate operationId: ${candidate.operationId}`);
    }
    operationIds.add(candidate.operationId);
    const route = normalizedRouteKey(candidate.method, candidate.path);
    if (routes.has(route)) throw new Error(`Duplicate native route contract: ${route}`);
    routes.add(route);

    const pathParameters = [...candidate.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const declaredPathParameters = Object.keys(candidate.request.path.properties ?? {});
    if (
      pathParameters.length !== declaredPathParameters.length ||
      pathParameters.some((parameter) => !declaredPathParameters.includes(parameter))
    ) {
      throw new Error(`Path parameter schema drift for ${candidate.operationId}`);
    }
    if (candidate.request.path.additionalProperties !== false) {
      throw new Error(`Path schema must be strict for ${candidate.operationId}`);
    }
    if (candidate.request.query.additionalProperties !== false) {
      throw new Error(`Query schema must be strict for ${candidate.operationId}`);
    }
    if (candidate.request.body?.contentType === "application/json") {
      const rawJsonWebhook =
        candidate.auth === "razorpay_signature" &&
        candidate.request.body.schema.format === "binary";
      if (!rawJsonWebhook && candidate.request.body.schema.type !== "object") {
        throw new Error(`JSON body must be an object for ${candidate.operationId}`);
      }
      if (!rawJsonWebhook && candidate.request.body.schema.additionalProperties !== false) {
        throw new Error(
          `Writable JSON body must reject unknown fields for ${candidate.operationId}`
        );
      }
    }
    if (candidate.idempotency.mode === "header") {
      const required = candidate.request.headers.required ?? [];
      if (!required.includes("idempotency-key")) {
        throw new Error(`Idempotency header metadata drift for ${candidate.operationId}`);
      }
    }
    if (candidate.concurrency.mode === "if-match") {
      const required = candidate.request.headers.required ?? [];
      if (!required.includes("if-match")) {
        throw new Error(`If-Match metadata drift for ${candidate.operationId}`);
      }
    }
    for (const [statusText, response] of Object.entries(candidate.responses)) {
      const status = Number(statusText);
      if (!response.headers["x-request-id"]?.required) {
        throw new Error(`x-request-id response metadata drift for ${candidate.operationId}`);
      }
      if (status === 429 && !response.headers["Retry-After"]?.required) {
        throw new Error(`Retry-After response metadata drift for ${candidate.operationId}`);
      }
      if (
        status >= 200 &&
        status < 300 &&
        candidate.idempotency.mode === "header" &&
        !response.headers["idempotency-replayed"]?.required
      ) {
        throw new Error(`Replay response metadata drift for ${candidate.operationId}`);
      }
    }
    if (candidate.concurrency.mode === "if-match") {
      const successful = Object.entries(candidate.responses).filter(
        ([status]) => Number(status) >= 200 && Number(status) < 300
      );
      if (successful.some(([, response]) => !response.headers.ETag?.required)) {
        throw new Error(`ETag response metadata drift for ${candidate.operationId}`);
      }
    }
  }

  const conditionalOperations = ACTIVE_NATIVE_HTTP_OPERATIONS.filter(
    (candidate) => candidate.concurrency.mode === "if-match"
  ).map((candidate) => candidate.operationId);
  const mappedConditionalOperations = VERSIONED_RESOURCE_RESPONSE_CONTRACTS.map(
    (contract) => contract.updateOperationId
  );
  if (
    conditionalOperations.length !== mappedConditionalOperations.length ||
    conditionalOperations.some((operationId) => !mappedConditionalOperations.includes(operationId))
  ) {
    throw new Error("Versioned resource family mapping does not cover every If-Match operation.");
  }
  for (const contract of VERSIONED_RESOURCE_RESPONSE_CONTRACTS) {
    if (!contract.sources.some((source) => source.role === "update")) {
      throw new Error(`Missing update response source for ${contract.family}`);
    }
    if (
      !contract.sources.some((source) =>
        ["aggregate", "create", "list", "read"].includes(source.role)
      )
    ) {
      throw new Error(`Missing initial response source for ${contract.family}`);
    }
    for (const source of contract.sources) {
      const definition = resolveNativeResponseSchemaPath(
        source.operationId,
        source.status,
        source.responsePath
      );
      if (definition["x-clinicos-json-kind"] !== "versioned-public") {
        throw new Error(
          `Response source ${source.operationId}:${source.responsePath} is not versioned-public.`
        );
      }
    }
  }
}

assertNativeHttpContractRegistry();
