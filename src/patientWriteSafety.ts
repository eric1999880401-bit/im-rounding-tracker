import type { DailyNote, Patient } from "./types";

export const FIRESTORE_WRITE_BATCH_LIMIT = 500;

const atomicPatientPatchFields = [
  "importantRedFlags",
  "overnightEvent",
  "subjectiveOrChiefConcern",
  "vitalSigns",
  "bloodSugar",
  "physicalExam",
  "newLabs",
  "rawLabText",
  "newImaging",
  "assessment",
  "plan",
  "activeProblems",
  "activeProblemItems",
  "assessmentPlanItems",
  "dischargePlan",
  "vsOrder",
  "tasks",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof Patient>;

const aiIntakePatientPatchFields = [
  ...atomicPatientPatchFields,
  // Explicitly accepted AI Intake cards may update these patient-level
  // compatibility fields. Identifiers, demographics, status, and unrelated
  // master fields remain excluded.
  "oneLiner",
  "admissionBriefFreeText",
  "generatedAdmissionSummary",
  "generatedSbarNote",
  "labReports",
  "parsedLabItems",
  "physicalExamEntries",
  "imageStudyEntries",
  "dischargeBarriers",
  "aiThinkingPrompts",
] as const satisfies ReadonlyArray<keyof Patient>;

export function patientDetailEditorPatient(sourcePatient: Patient | null | undefined): Patient | null {
  return sourcePatient ? { ...sourcePatient } : null;
}

export function selectedDailyNoteContext(notes: DailyNote[], selectedDate: string): DailyNote[] {
  const selectedNote = notes.find((note) => note.date === selectedDate);
  return selectedNote ? [selectedNote] : [];
}

export function persistedPatientUpdatedAt(patient: Pick<Patient, "updatedAt" | "persistedUpdatedAt">): string {
  return patient.persistedUpdatedAt ?? patient.updatedAt;
}

export function reconcilePatientDraftRevision(
  currentRevision: string,
  sourcePatient: Pick<Patient, "updatedAt" | "persistedUpdatedAt"> | null | undefined,
  acceptSourceSnapshot: boolean,
): string {
  if (!acceptSourceSnapshot) return currentRevision;
  return sourcePatient ? persistedPatientUpdatedAt(sourcePatient) : "";
}

export function pickAtomicPatientPatch(value: Partial<Patient> | undefined): Partial<Patient> {
  if (!value) return {};
  return Object.fromEntries(
    atomicPatientPatchFields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  ) as Partial<Patient>;
}

export function pickAiIntakePatientPatch(value: Partial<Patient> | undefined): Partial<Patient> {
  if (!value) return {};
  return Object.fromEntries(
    aiIntakePatientPatchFields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  ) as Partial<Patient>;
}

export function patientUpdatedAtConflictReason(
  patientExists: boolean,
  persistedUpdatedAt: string,
  expectedUpdatedAt: string,
): string {
  if (!patientExists) return "Patient save conflict: the patient record no longer exists.";
  if (persistedUpdatedAt !== expectedUpdatedAt) {
    return "Patient save conflict: this patient changed in another tab or device. Reload and review before saving.";
  }
  return "";
}

export function patientDeletionWriteCount(
  dailyNoteCount: number,
  auditEventCount: number,
  auditPayloadCount: number,
  aiDraftCount: number,
): number {
  return 1 + dailyNoteCount + auditEventCount + auditPayloadCount + aiDraftCount;
}

export function patientDeletionLimitReason(writeCount: number): string {
  if (writeCount <= FIRESTORE_WRITE_BATCH_LIMIT) return "";
  return `Patient deletion blocked: ${writeCount} Firestore documents exceed the ${FIRESTORE_WRITE_BATCH_LIMIT}-write atomic batch limit. No data was deleted.`;
}
