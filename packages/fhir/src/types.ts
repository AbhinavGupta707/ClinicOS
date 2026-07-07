export type FhirResourceType =
  | "AuditEvent"
  | "Bundle"
  | "Composition"
  | "DocumentReference"
  | "Encounter"
  | "Organization"
  | "Patient"
  | "Practitioner"
  | "Provenance";

export interface FhirMeta {
  profile?: string[];
  tag?: FhirCoding[];
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
  resourceType: Exclude<FhirResourceType, "Bundle">;
  id: string;
  meta: FhirMeta;
  extension?: FhirExtension[];
  identifier?: FhirIdentifier[];
}

export interface FhirOrganization extends FhirResourceBase {
  resourceType: "Organization";
  active: boolean;
  name: string;
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
  date: string;
  encounter?: FhirReference;
  section: Array<{
    code?: FhirCodeableConcept;
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
    role?: FhirCodeableConcept[];
    who: FhirReference;
  }>;
  entity?: Array<{
    role: "derivation" | "quotation" | "removal" | "revision" | "source";
    what: {
      display?: string;
      identifier?: FhirIdentifier;
    };
  }>;
  recorded: string;
  target: FhirReference[];
}

export type FhirResource =
  | FhirComposition
  | FhirDocumentReference
  | FhirEncounter
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
  meta: FhirMeta;
  timestamp: string;
  type: "collection" | "document";
  entry: FhirBundleEntry[];
}
