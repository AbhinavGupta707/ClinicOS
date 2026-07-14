export type FhirResourceType =
  | "AuditEvent"
  | "Bundle"
  | "CapabilityStatement"
  | "Composition"
  | "Consent"
  | "DocumentReference"
  | "Encounter"
  | "MedicationRequest"
  | "OperationOutcome"
  | "Organization"
  | "Patient"
  | "Practitioner"
  | "Provenance";

export interface FhirMeta {
  lastUpdated?: string;
  profile?: string[];
  security?: FhirCoding[];
  source?: string;
  tag?: FhirCoding[];
  versionId?: string;
}

export interface FhirCoding {
  system?: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirIdentifier {
  system?: string;
  value: string;
  type?: FhirCodeableConcept;
}

export interface FhirReference {
  reference: string;
  display?: string;
  type?: string;
}

export interface FhirExtension {
  url: string;
  valueBoolean?: boolean;
  valueCode?: string;
  valueDateTime?: string;
  valueString?: string;
  valueUri?: string;
}

export interface FhirContactPoint {
  system: "email" | "phone" | "url";
  value: string;
  use?: "home" | "mobile" | "old" | "temp" | "work";
}

export interface FhirHumanName {
  text: string;
}

export interface FhirResourceBase {
  resourceType: Exclude<FhirResourceType, "Bundle" | "CapabilityStatement" | "OperationOutcome">;
  id: string;
  meta: FhirMeta;
  text?: FhirNarrative;
  extension?: FhirExtension[];
  identifier?: FhirIdentifier[];
}

export interface FhirOrganization extends FhirResourceBase {
  resourceType: "Organization";
  active: boolean;
  name: string;
  partOf?: FhirReference;
}

export interface FhirPatient extends FhirResourceBase {
  resourceType: "Patient";
  active: boolean;
  birthDate?: string;
  gender?: "female" | "male" | "other" | "unknown";
  managingOrganization?: FhirReference;
  name: FhirHumanName[];
  telecom?: FhirContactPoint[];
}

export interface FhirPractitioner extends FhirResourceBase {
  resourceType: "Practitioner";
  active: boolean;
  name: FhirHumanName[];
  telecom?: FhirContactPoint[];
}

export interface FhirEncounter extends FhirResourceBase {
  resourceType: "Encounter";
  appointment?: FhirReference[];
  class: FhirCoding;
  participant?: Array<{
    individual: FhirReference;
    type?: FhirCodeableConcept[];
  }>;
  period?: {
    end?: string;
    start?: string;
  };
  reasonCode?: FhirCodeableConcept[];
  serviceProvider?: FhirReference;
  status:
    | "arrived"
    | "cancelled"
    | "entered-in-error"
    | "finished"
    | "in-progress"
    | "onleave"
    | "planned"
    | "triaged"
    | "unknown";
  subject: FhirReference;
}

export interface FhirNarrative {
  div: string;
  status: "additional" | "empty" | "extensions" | "generated";
}

export interface FhirComposition extends FhirResourceBase {
  resourceType: "Composition";
  author: FhirReference[];
  custodian?: FhirReference;
  date: string;
  encounter?: FhirReference;
  section: Array<{
    code?: FhirCodeableConcept;
    entry?: FhirReference[];
    text: FhirNarrative;
    title: string;
  }>;
  status: "amended" | "entered-in-error" | "final" | "preliminary";
  subject: FhirReference;
  title: string;
  type: FhirCodeableConcept;
}

export interface FhirDocumentReference extends FhirResourceBase {
  resourceType: "DocumentReference";
  author?: FhirReference[];
  content: Array<{
    attachment: {
      contentType: string;
      creation?: string;
      hash?: string;
      title: string;
      url: string;
    };
  }>;
  context?: {
    encounter?: FhirReference[];
    related?: FhirReference[];
  };
  date?: string;
  description?: string;
  docStatus?: "amended" | "entered-in-error" | "final" | "preliminary";
  relatesTo?: Array<{
    code: "appends" | "replaces" | "signs" | "transforms";
    target: FhirReference;
  }>;
  securityLabel?: FhirCodeableConcept[];
  status: "current" | "entered-in-error" | "superseded";
  subject: FhirReference;
  type?: FhirCodeableConcept;
}

export interface FhirProvenance extends FhirResourceBase {
  resourceType: "Provenance";
  agent: Array<{
    onBehalfOf?: FhirReference;
    role?: FhirCodeableConcept[];
    who: FhirReference;
  }>;
  entity?: Array<{
    role: "derivation" | "quotation" | "removal" | "revision" | "source";
    what: {
      display?: string;
      identifier?: FhirIdentifier;
      reference?: string;
    };
  }>;
  activity?: FhirCodeableConcept;
  occurredDateTime?: string;
  policy?: string[];
  reason?: FhirCodeableConcept[];
  recorded: string;
  target: FhirReference[];
}

export interface FhirConsent extends FhirResourceBase {
  resourceType: "Consent";
  category: FhirCodeableConcept[];
  dateTime?: string;
  organization?: FhirReference[];
  patient?: FhirReference;
  performer?: FhirReference[];
  policy?: Array<{
    authority?: string;
    uri: string;
  }>;
  provision?: {
    action?: FhirCodeableConcept[];
    class?: FhirCoding[];
    data?: Array<{
      meaning: "authoredby" | "dependents" | "instance" | "related";
      reference: FhirReference;
    }>;
    dataPeriod?: { end?: string; start?: string };
    period?: { end?: string; start?: string };
    purpose?: FhirCoding[];
    type?: "deny" | "permit";
  };
  scope: FhirCodeableConcept;
  status: "active" | "draft" | "entered-in-error" | "inactive" | "proposed" | "rejected";
}

export interface FhirMedicationRequest extends FhirResourceBase {
  resourceType: "MedicationRequest";
  authoredOn?: string;
  dosageInstruction?: Array<{ text?: string }>;
  encounter?: FhirReference;
  intent:
    | "filler-order"
    | "instance-order"
    | "option"
    | "order"
    | "original-order"
    | "plan"
    | "proposal"
    | "reflex-order";
  medicationCodeableConcept: FhirCodeableConcept;
  note?: Array<{ text: string }>;
  requester?: FhirReference;
  status:
    | "active"
    | "cancelled"
    | "completed"
    | "draft"
    | "entered-in-error"
    | "on-hold"
    | "stopped"
    | "unknown";
  subject: FhirReference;
}

export type FhirResource =
  | FhirComposition
  | FhirConsent
  | FhirDocumentReference
  | FhirEncounter
  | FhirMedicationRequest
  | FhirOrganization
  | FhirPatient
  | FhirPractitioner
  | FhirProvenance;

export interface FhirBundleEntry {
  fullUrl: string;
  resource: FhirResource;
}

export interface FhirBundle {
  resourceType: "Bundle";
  id: string;
  identifier?: FhirIdentifier;
  meta: FhirMeta;
  timestamp: string;
  type: "collection" | "document";
  entry: FhirBundleEntry[];
}

export type FhirIssueSeverity = "error" | "fatal" | "information" | "warning";
export type FhirIssueCode =
  | "business-rule"
  | "conflict"
  | "duplicate"
  | "forbidden"
  | "invalid"
  | "not-found"
  | "not-supported"
  | "processing"
  | "required"
  | "security"
  | "structure"
  | "throttled"
  | "timeout"
  | "too-costly"
  | "transient"
  | "value";

export interface FhirOperationOutcomeIssue {
  code: FhirIssueCode;
  details?: FhirCodeableConcept;
  diagnostics?: string;
  expression?: string[];
  severity: FhirIssueSeverity;
}

export interface FhirOperationOutcome {
  resourceType: "OperationOutcome";
  issue: FhirOperationOutcomeIssue[];
}

export interface FhirCapabilityStatement {
  resourceType: "CapabilityStatement";
  id: string;
  url: string;
  version: string;
  name: string;
  title: string;
  status: "active" | "draft" | "retired" | "unknown";
  experimental: boolean;
  date: string;
  publisher: string;
  kind: "capability" | "instance" | "requirements";
  software: {
    name: string;
    version?: string;
  };
  fhirVersion: "4.0.1";
  format: string[];
  document: Array<{
    mode: "consumer" | "producer";
    profile: string;
    documentation?: string;
  }>;
  rest: Array<{
    mode: "client" | "server";
    documentation?: string;
    security?: {
      cors: boolean;
      description: string;
      service: FhirCodeableConcept[];
    };
    resource: Array<{
      type: Exclude<FhirResourceType, "Bundle" | "CapabilityStatement" | "OperationOutcome">;
      profile: string;
      supportedProfile?: string[];
      referencePolicy?: Array<"enforced" | "literal" | "local" | "logical" | "resolves">;
      versioning?: "no-version" | "versioned" | "versioned-update";
    }>;
  }>;
}
