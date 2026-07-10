import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type FirestoreError,
} from "firebase/firestore";
import type {
  AssessmentPlanItem,
  ActiveProblemItem,
  AiThinkingPrompt,
  DailyNote,
  ImageStudyEntry,
  LabReport,
  Patient,
  PatientTask,
  PhysicalExamEntry,
  SoapEditChangeKind,
  SoapEditSection,
  SoapEditTrace,
} from "../types";
import { db } from "./firebase";
import { normalizeDateKey, parseLabReports, parseLabText, textToItems } from "../utils";

function patientsCollection(uid: string) {
  return collection(db, "users", uid, "patients");
}

function patientDocument(uid: string, patientId: string) {
  return doc(db, "users", uid, "patients", patientId);
}

function dailyNotesCollection(uid: string, patientId: string) {
  return collection(db, "users", uid, "patients", patientId, "dailyNotes");
}

function dailyNoteDocument(uid: string, patientId: string, date: string) {
  return doc(db, "users", uid, "patients", patientId, "dailyNotes", date);
}

function normalizeTask(task: Partial<PatientTask>): PatientTask {
  return {
    id: task.id ?? "",
    text: task.text ?? "",
    done: task.done ?? false,
    priority: task.priority ?? "normal",
    category: task.category ?? "other",
    dueDate: task.dueDate ?? "",
    createdAt: task.createdAt ?? "",
    completedAt: task.completedAt ?? "",
  };
}

function normalizeParsedLabItem(item: Record<string, unknown>) {
  const label = String(item.label ?? item.name ?? "");
  return {
    id: String(item.id ?? ""),
    label,
    name: String(item.name ?? label),
    displayName: String(item.displayName ?? item.name ?? label),
    value: String(item.value ?? ""),
    unit: String(item.unit ?? ""),
    previousValue: String(item.previousValue ?? ""),
    group: String(item.group ?? ""),
    color: String(item.color ?? ""),
    important: Boolean(item.important ?? item.isImportant ?? false),
    isImportant: Boolean(item.isImportant ?? item.important ?? false),
    note: String(item.note ?? ""),
  };
}

function normalizeLabReport(report: Partial<LabReport>, fallbackDate = normalizeDateKey(undefined)): LabReport {
  const date = normalizeDateKey(report.date, normalizeDateKey(fallbackDate));
  return {
    id: report.id ?? "",
    date,
    title: report.title ?? "",
    rawText: report.rawText ?? "",
    items: Array.isArray(report.items)
      ? report.items.map((item) => normalizeParsedLabItem(item as unknown as Record<string, unknown>))
      : parseLabReports(report.rawText ?? "", date, report.title ?? "").flatMap((nextReport) => nextReport.items),
  };
}

function normalizePhysicalExamEntry(entry: Partial<PhysicalExamEntry>): PhysicalExamEntry {
  return {
    id: entry.id ?? "",
    date: entry.date ?? "",
    system: entry.system ?? "",
    finding: entry.finding ?? "",
    isImportant: entry.isImportant ?? false,
    color: entry.color ?? "",
    note: entry.note ?? "",
  };
}

function normalizeImageStudyEntry(entry: Partial<ImageStudyEntry>): ImageStudyEntry {
  return {
    id: entry.id ?? "",
    date: entry.date ?? "",
    studyType: entry.studyType ?? "",
    finding: entry.finding ?? "",
    impression: entry.impression ?? "",
    isImportant: entry.isImportant ?? false,
    color: entry.color ?? "",
    note: entry.note ?? "",
  };
}

function normalizeAssessmentPlanItem(item: Partial<AssessmentPlanItem>, index: number): AssessmentPlanItem {
  return {
    id: item.id ?? "",
    problemTitle: item.problemTitle ?? "",
    assessmentSummary: item.assessmentSummary ?? "",
    evidenceOrCourseItems: Array.isArray(item.evidenceOrCourseItems) ? item.evidenceOrCourseItems.map(String) : [],
    planItems: Array.isArray(item.planItems) ? item.planItems.map(String) : [],
    category: item.category ?? "activeProblem",
    isImportant: item.isImportant ?? false,
    color: item.color ?? "",
    order: typeof item.order === "number" ? item.order : index,
  };
}

function normalizeActiveProblemItem(item: Partial<ActiveProblemItem>, index: number): ActiveProblemItem {
  return {
    id: item.id ?? "",
    title: item.title ?? "",
    note: item.note ?? "",
    isImportant: item.isImportant ?? false,
    color: item.color ?? "",
    order: typeof item.order === "number" ? item.order : index,
  };
}

function normalizeAiThinkingPrompt(item: Partial<AiThinkingPrompt>): AiThinkingPrompt {
  return {
    id: item.id ?? "",
    prompt: item.prompt ?? "",
    reason: item.reason ?? "",
    kind: item.kind === "uncertainty" ? "uncertainty" : "thinkingPrompt",
    createdAt: item.createdAt ?? "",
  };
}

const soapEditSections = new Set<SoapEditSection>(["header", "s", "vs", "pe", "lab", "image", "objective", "ap", "orders", "tasks", "dc"]);
const soapEditChangeKinds = new Set<SoapEditChangeKind>(["added", "removed", "rewritten"]);

function normalizeSoapEditTrace(value: Partial<SoapEditTrace>): SoapEditTrace {
  const changes = Array.isArray(value.changes)
    ? value.changes.slice(0, 40).map((change) => ({
        section: soapEditSections.has(change.section as SoapEditSection) ? (change.section as SoapEditSection) : "objective",
        kind: soapEditChangeKinds.has(change.kind as SoapEditChangeKind) ? (change.kind as SoapEditChangeKind) : "rewritten",
        before: String(change.before ?? "").slice(0, 320),
        after: String(change.after ?? "").slice(0, 320),
      }))
    : [];
  const changedSections = Array.isArray(value.changedSections)
    ? value.changedSections.filter((section): section is SoapEditSection => soapEditSections.has(section as SoapEditSection))
    : [];
  return {
    id: String(value.id ?? ""),
    savedAt: String(value.savedAt ?? ""),
    source: value.source === "ai" ? "ai" : "manual",
    workflowMode: value.workflowMode === "newSoap" || value.workflowMode === "transferHandoff" ? value.workflowMode : "dailyUpdate",
    aiDraftId: String(value.aiDraftId ?? ""),
    model: String(value.model ?? ""),
    qualityMode: value.qualityMode === "fast" || value.qualityMode === "balanced" || value.qualityMode === "highAccuracy" ? value.qualityMode : "",
    baseSoapVersion: Number(value.baseSoapVersion) || 0,
    savedSoapVersion: Number(value.savedSoapVersion) || 1,
    changedSections,
    changes,
    stats: {
      added: Number(value.stats?.added) || changes.filter((change) => change.kind === "added").length,
      removed: Number(value.stats?.removed) || changes.filter((change) => change.kind === "removed").length,
      rewritten: Number(value.stats?.rewritten) || changes.filter((change) => change.kind === "rewritten").length,
    },
    acceptedAiDraftWithoutEdits: Boolean(value.acceptedAiDraftWithoutEdits),
    truncated: Boolean(value.truncated),
  };
}

function normalizeDailyNote(date: string, data: Partial<DailyNote>): DailyNote {
  return {
    date: normalizeDateKey(data.date ?? date, date),
    soapText: data.soapText ?? "",
    soapStatus: data.soapStatus === "reviewed" ? "reviewed" : "draft",
    soapUpdatedAt: data.soapUpdatedAt ?? "",
    soapVersion: typeof data.soapVersion === "number" ? data.soapVersion : 1,
    soapEditHistory: Array.isArray(data.soapEditHistory)
      ? data.soapEditHistory.slice(-12).map((trace) => normalizeSoapEditTrace(trace as Partial<SoapEditTrace>))
      : [],
    importantRedFlags: data.importantRedFlags ?? "",
    overnightEvents: data.overnightEvents ?? "",
    subjectiveOrChiefConcern: data.subjectiveOrChiefConcern ?? "",
    vitalSigns: data.vitalSigns ?? "",
    bloodSugar: data.bloodSugar ?? "",
    physicalExam: data.physicalExam ?? "",
    labSummary: data.labSummary ?? "",
    imageSummary: data.imageSummary ?? "",
    assessment: data.assessment ?? "",
    plan: data.plan ?? "",
    dischargePlan: data.dischargePlan ?? "",
    vsOrder: data.vsOrder ?? "",
    rawLabText: data.rawLabText ?? data.labSummary ?? "",
    labDate: normalizeDateKey(data.labDate ?? date, date),
    labReportTitle: data.labReportTitle ?? "",
    labReports: Array.isArray(data.labReports)
      ? data.labReports.map((report) => normalizeLabReport(report as Partial<LabReport>, data.labDate ?? date))
      : parseLabReports(data.rawLabText ?? data.labSummary ?? "", normalizeDateKey(data.labDate ?? date, date), data.labReportTitle ?? ""),
    parsedLabItems: Array.isArray(data.parsedLabItems)
      ? data.parsedLabItems.map((item) => normalizeParsedLabItem(item as unknown as Record<string, unknown>))
      : parseLabText(data.rawLabText ?? data.labSummary ?? ""),
    physicalExamEntries: Array.isArray(data.physicalExamEntries)
      ? data.physicalExamEntries.map((entry) => normalizePhysicalExamEntry(entry as Partial<PhysicalExamEntry>))
      : [],
    imageStudyEntries: Array.isArray(data.imageStudyEntries)
      ? data.imageStudyEntries.map((entry) => normalizeImageStudyEntry(entry as Partial<ImageStudyEntry>))
      : [],
    assessmentPlanItems: Array.isArray(data.assessmentPlanItems)
      ? data.assessmentPlanItems.map((item, index) =>
          normalizeAssessmentPlanItem(item as Partial<AssessmentPlanItem>, index),
        )
      : [],
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

function normalizePatient(patientId: string, data: Partial<Patient>): Patient {
  return {
    id: data.id ?? patientId,
    bed: data.bed ?? "",
    patientCode: data.patientCode ?? "",
    oneLiner: data.oneLiner ?? "",
    age: data.age ?? 0,
    sex: data.sex ?? "M",
    underlyingDiseases: data.underlyingDiseases ?? "",
    underlyingDiseaseItems: Array.isArray(data.underlyingDiseaseItems)
      ? data.underlyingDiseaseItems
      : textToItems(data.underlyingDiseases ?? ""),
    attending: data.attending ?? "",
    teamOrService: data.teamOrService ?? "",
    admissionDate: data.admissionDate ?? "",
    primaryDiagnosis: data.primaryDiagnosis ?? "",
    activeProblems: data.activeProblems ?? "",
    activeProblemItems: Array.isArray(data.activeProblemItems)
      ? data.activeProblemItems
      : textToItems(data.activeProblems ?? ""),
    activeProblemStructuredItems: Array.isArray(data.activeProblemStructuredItems)
      ? data.activeProblemStructuredItems.map((item, index) =>
          normalizeActiveProblemItem(item as Partial<ActiveProblemItem>, index),
        )
      : [],
    chiefComplaint: data.chiefComplaint ?? data.admissionChiefConcern ?? "",
    presentIllnessOrHPI: data.presentIllnessOrHPI ?? data.hpiOrAdmissionStory ?? "",
    admissionBriefFreeText: data.admissionBriefFreeText ?? "",
    admissionChiefConcern: data.admissionChiefConcern ?? "",
    hpiOrAdmissionStory: data.hpiOrAdmissionStory ?? "",
    baselineFunction: data.baselineFunction ?? "",
    admissionPMH: data.admissionPMH ?? "",
    initialPhysicalExam: data.initialPhysicalExam ?? "",
    initialLabs: data.initialLabs ?? "",
    initialImaging: data.initialImaging ?? "",
    initialAssessment: data.initialAssessment ?? "",
    initialPlan: data.initialPlan ?? "",
    earlyHospitalCourse: data.earlyHospitalCourse ?? "",
    admissionBriefNotes: data.admissionBriefNotes ?? "",
    generatedAdmissionNote: data.generatedAdmissionNote ?? "",
    generatedAdmissionSummary: data.generatedAdmissionSummary ?? "",
    generatedDischargeSummary: data.generatedDischargeSummary ?? "",
    generatedWeeklySummary: data.generatedWeeklySummary ?? "",
    generatedSbarNote: data.generatedSbarNote ?? "",
    isNewAdmission: data.isNewAdmission ?? false,
    showAdmissionBriefOnPrint: data.showAdmissionBriefOnPrint ?? false,
    physicalExam: data.physicalExam ?? "",
    hospitalCourseHighlights: data.hospitalCourseHighlights ?? "",
    importantRedFlags: data.importantRedFlags ?? "",
    vitalSigns: data.vitalSigns ?? "",
    bloodSugar: data.bloodSugar ?? "",
    rawLabText: data.rawLabText ?? data.newLabs ?? "",
    labDate: normalizeDateKey(data.labDate),
    labReportTitle: data.labReportTitle ?? "",
    labReports: Array.isArray(data.labReports)
      ? data.labReports.map((report) => normalizeLabReport(report as Partial<LabReport>, data.labDate))
      : parseLabReports(data.rawLabText ?? data.newLabs ?? "", normalizeDateKey(data.labDate), data.labReportTitle ?? ""),
    parsedLabItems: Array.isArray(data.parsedLabItems)
      ? data.parsedLabItems.map((item) => normalizeParsedLabItem(item as unknown as Record<string, unknown>))
      : parseLabText(data.rawLabText ?? data.newLabs ?? ""),
    physicalExamEntries: Array.isArray(data.physicalExamEntries)
      ? data.physicalExamEntries.map((entry) => normalizePhysicalExamEntry(entry as Partial<PhysicalExamEntry>))
      : [],
    imageStudyEntries: Array.isArray(data.imageStudyEntries)
      ? data.imageStudyEntries.map((entry) => normalizeImageStudyEntry(entry as Partial<ImageStudyEntry>))
      : [],
    dischargeMedsStatus: data.dischargeMedsStatus ?? "pending",
    opdAppointmentStatus: data.opdAppointmentStatus ?? "pending",
    diagnosisCertificateStatus: data.diagnosisCertificateStatus ?? "pending",
    overnightEvent: data.overnightEvent ?? "",
    subjectiveOrChiefConcern: data.subjectiveOrChiefConcern ?? "",
    newLabs: data.newLabs ?? "",
    newImaging: data.newImaging ?? "",
    assessment: data.assessment ?? "",
    plan: data.plan ?? "",
    assessmentPlanItems: Array.isArray(data.assessmentPlanItems)
      ? data.assessmentPlanItems.map((item, index) =>
          normalizeAssessmentPlanItem(item as Partial<AssessmentPlanItem>, index),
        )
      : [],
    dischargePlan: data.dischargePlan ?? "",
    dischargeTargetDate: data.dischargeTargetDate ?? "",
    dischargeBarriers: data.dischargeBarriers ?? "",
    specialAttention: data.specialAttention ?? "",
    vsOrder: data.vsOrder ?? "",
    status: data.status ?? "active",
    tasks: Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [],
    aiThinkingPrompts: Array.isArray(data.aiThinkingPrompts)
      ? data.aiThinkingPrompts.map((item) => normalizeAiThinkingPrompt(item as Partial<AiThinkingPrompt>))
      : [],
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return "";
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nextValue]) => [
        key,
        sanitizeForFirestore(nextValue),
      ]),
    );
  }

  return value;
}

function preparePatientForFirestore(patient: Patient): Record<string, unknown> {
  const normalizedPatient = normalizePatient(patient.id, patient);
  return sanitizeForFirestore(normalizedPatient) as Record<string, unknown>;
}

function prepareDailyNoteForFirestore(note: DailyNote): Record<string, unknown> {
  return sanitizeForFirestore(normalizeDailyNote(note.date, note)) as Record<string, unknown>;
}

export function subscribeToPatients(
  uid: string,
  onPatients: (patients: Patient[]) => void,
  onError: (error: FirestoreError) => void,
) {
  const patientsQuery = query(patientsCollection(uid), orderBy("bed"));

  return onSnapshot(
    patientsQuery,
    (snapshot) => {
      const patients = snapshot.docs.map((patientDoc) =>
        normalizePatient(patientDoc.id, patientDoc.data() as Partial<Patient>),
      );
      onPatients(patients);
    },
    onError,
  );
}

export function subscribeToDailyNotes(
  uid: string,
  patientId: string,
  onNotes: (patientId: string, notes: DailyNote[]) => void,
  onError: (error: FirestoreError) => void,
) {
  const notesQuery = query(dailyNotesCollection(uid, patientId), orderBy("date", "desc"));

  return onSnapshot(
    notesQuery,
    (snapshot) => {
      onNotes(
        patientId,
        snapshot.docs.map((noteDoc) => normalizeDailyNote(noteDoc.id, noteDoc.data() as Partial<DailyNote>)),
      );
    },
    onError,
  );
}

export function createPatient(uid: string, patient: Patient) {
  // The patient id is also the Firestore document id for easy lookup.
  return setDoc(patientDocument(uid, patient.id), preparePatientForFirestore(patient));
}

export function updatePatient(uid: string, patient: Patient) {
  return updateDoc(patientDocument(uid, patient.id), preparePatientForFirestore(patient));
}

export function saveDailyNote(uid: string, patientId: string, note: DailyNote) {
  return setDoc(dailyNoteDocument(uid, patientId, note.date), prepareDailyNoteForFirestore(note));
}

export function deletePatient(uid: string, patientId: string) {
  return getDocs(dailyNotesCollection(uid, patientId)).then(async (snapshot) => {
    await Promise.all(snapshot.docs.map((noteDoc) => deleteDoc(noteDoc.ref)));
    await deleteDoc(patientDocument(uid, patientId));
  });
}
