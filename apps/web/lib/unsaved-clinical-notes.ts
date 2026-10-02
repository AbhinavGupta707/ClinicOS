/** Tab-local recovery only. Never serialize this PHI to browser storage. */
export interface UnsavedClinicalNote {
  readonly patientId: string;
  readonly encounterId: string;
  readonly rowVersion: number;
  readonly content: Readonly<Record<string, string>>;
  readonly ready: boolean;
  readonly amendmentReason: string;
}

let activeScope: string | null = null;
const drafts = new Map<string, UnsavedClinicalNote>();
const key = (patientId: string, encounterId: string) => `${patientId}:${encounterId}`;

export function clearUnsavedClinicalNotes() {
  drafts.clear();
  activeScope = null;
}

/** Called only after the shell has loaded the current authorized identity. */
export function activateClinicalNoteScope(scope: string) {
  if (scope !== activeScope) {
    clearUnsavedClinicalNotes();
    activeScope = scope;
  }
}

export function readUnsavedClinicalNote(scope: string, patientId: string, encounterId: string) {
  if (scope !== activeScope) return undefined;
  const draft = drafts.get(key(patientId, encounterId));
  return draft ? { ...draft, content: { ...draft.content } } : undefined;
}

export function unsavedEncounterForPatient(scope: string, patientId: string) {
  if (scope !== activeScope) return undefined;
  return [...drafts.values()].reverse().find((draft) => draft.patientId === patientId)?.encounterId;
}

export function rememberUnsavedClinicalNote(scope: string, draft: UnsavedClinicalNote) {
  // An old component cannot resurrect a cleared or different user's draft.
  if (scope !== activeScope) return;
  drafts.set(key(draft.patientId, draft.encounterId), { ...draft, content: { ...draft.content } });
}

export function forgetUnsavedClinicalNote(scope: string, patientId: string, encounterId: string) {
  if (scope === activeScope) drafts.delete(key(patientId, encounterId));
}
