// Patient / daily-note model helpers and display summaries. Extracted from utils.ts (Phase 1 refactor).
import type {
  ActiveProblemItem,
  AssessmentPlanItem,
  DailyNote,
  DailyNotesByPatient,
  DischargePrepStatus,
  ImageStudyEntry,
  LabReport,
  ParsedLabItem,
  Patient,
  PatientStatus,
  PatientTask,
  PhysicalExamEntry,
  SortMode,
} from "./types";
import { createId, nowIso, todayKey, normalizeDateKey, formatDateLabel } from "./dates";
import { getAdmissionSummaryText, textToItems, plainClinicalText, safeClinicalLine, compactClinicalText, summarizeItems, splitHighlightLines, stripColorMarkup, importantLines, cleanClinicalTail } from "./clinicalTextFormat";
import { labSummary, parseLabText, getLabFocusSummary, keyLabItems } from "./labParsing";
import { dedupeDiseaseText } from "./aiPostprocess/diseaseDedupe";

export function getActivePatients(patients: Patient[]) {
  return patients.filter((patient) => patient.status === "active");
}


export function getPatientPmhText(patient: Patient) {
  const sources = [
    ...(patient.underlyingDiseaseItems ?? []),
    patient.underlyingDiseases,
    patient.admissionPMH,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return dedupeDiseaseText(sources.join("\n"));
}

export function getUnderlyingDiseaseItems(patient: Patient) {
  const pmhText = getPatientPmhText(patient);
  return pmhText ? pmhText.split(/,\s*/).filter(Boolean) : [];
}

export function getActiveProblemItems(patient: Patient) {
  if (patient.activeProblemStructuredItems.length > 0) {
    return [...patient.activeProblemStructuredItems]
      .sort((a, b) => a.order - b.order)
      .map((item) => (item.note ? `${item.title}: ${item.note}` : item.title))
      .filter(Boolean);
  }

  return patient.activeProblemItems.length > 0
    ? patient.activeProblemItems
    : textToItems(patient.activeProblems);
}


export function emptyAssessmentPlanItem(order = 0): AssessmentPlanItem {
  return {
    id: createId("ap"),
    problemTitle: "",
    assessmentSummary: "",
    evidenceOrCourseItems: [],
    planItems: [],
    category: "activeProblem",
    isImportant: false,
    color: "",
    order,
  };
}

export function emptyActiveProblemItem(order = 0): ActiveProblemItem {
  return {
    id: createId("problem"),
    title: "",
    note: "",
    isImportant: false,
    color: "",
    order,
  };
}

export function emptyDailyNote(date = todayKey()): DailyNote {
  const now = nowIso();
  return {
    date,
    soapText: "",
    soapStatus: "draft",
    soapUpdatedAt: "",
    soapVersion: 1,
    soapEditHistory: [],
    importantRedFlags: "",
    overnightEvents: "",
    subjectiveOrChiefConcern: "",
    vitalSigns: "",
    bloodSugar: "",
    physicalExam: "",
    labSummary: "",
    imageSummary: "",
    assessment: "",
    plan: "",
    dischargePlan: "",
    vsOrder: "",
    rawLabText: "",
    labDate: date,
    labReportTitle: "",
    labReports: [],
    parsedLabItems: [],
    physicalExamEntries: [],
    imageStudyEntries: [],
    assessmentPlanItems: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function dailyNoteFromPatient(patient: Patient, date = todayKey()): DailyNote {
  const now = nowIso();
  return {
    ...emptyDailyNote(date),
    importantRedFlags: patient.importantRedFlags,
    overnightEvents: patient.overnightEvent,
    subjectiveOrChiefConcern: patient.subjectiveOrChiefConcern,
    vitalSigns: patient.vitalSigns,
    bloodSugar: patient.bloodSugar,
    physicalExam: patient.physicalExam,
    labSummary: patient.newLabs,
    imageSummary: patient.newImaging,
    assessment: patient.assessment,
    plan: patient.plan,
    dischargePlan: patient.dischargePlan,
    vsOrder: patient.vsOrder,
    rawLabText: patient.rawLabText || patient.newLabs,
    labDate: patient.labDate || date,
    labReportTitle: patient.labReportTitle,
    labReports: patient.labReports,
    parsedLabItems: patient.parsedLabItems,
    physicalExamEntries: patient.physicalExamEntries,
    imageStudyEntries: patient.imageStudyEntries,
    assessmentPlanItems: patient.assessmentPlanItems,
    createdAt: patient.createdAt || now,
    updatedAt: patient.updatedAt || now,
  };
}

/**
 * Legacy/basic-field edits may still update the structured daily-note fields,
 * but they must never clear the clinician-reviewed SOAP source of truth.
 */
export function dailyNoteFromPatientPreservingSoap(
  patient: Patient,
  existingNote: DailyNote | null | undefined,
  date = todayKey(),
): DailyNote {
  const nextNote = dailyNoteFromPatient(patient, date);
  if (!existingNote) return nextNote;

  return {
    ...existingNote,
    ...nextNote,
    soapText: existingNote.soapText ?? nextNote.soapText,
    soapStatus: existingNote.soapStatus ?? nextNote.soapStatus,
    soapUpdatedAt: existingNote.soapUpdatedAt ?? nextNote.soapUpdatedAt,
    soapVersion: existingNote.soapVersion ?? nextNote.soapVersion,
    soapEditHistory: existingNote.soapEditHistory ?? nextNote.soapEditHistory,
  };
}

export function patientWithDailyNote(patient: Patient, note?: DailyNote): Patient {
  if (!note) return patient;
  return {
    ...patient,
    importantRedFlags: note.importantRedFlags,
    overnightEvent: note.overnightEvents,
    subjectiveOrChiefConcern: note.subjectiveOrChiefConcern,
    vitalSigns: note.vitalSigns,
    bloodSugar: note.bloodSugar,
    physicalExam: note.physicalExam,
    newLabs: note.labSummary,
    newImaging: note.imageSummary,
    assessment: note.assessment,
    plan: note.plan,
    dischargePlan: note.dischargePlan,
    vsOrder: note.vsOrder,
    rawLabText: note.rawLabText || note.labSummary,
    labDate: note.labDate,
    labReportTitle: note.labReportTitle,
    labReports: note.labReports,
    parsedLabItems: note.parsedLabItems,
    physicalExamEntries: note.physicalExamEntries,
    imageStudyEntries: note.imageStudyEntries,
    assessmentPlanItems: note.assessmentPlanItems,
  };
}

export function latestDailyNote(notes: DailyNote[]) {
  return [...notes].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasItems<T>(items: T[] | undefined) {
  return Array.isArray(items) && items.length > 0;
}

export function notesOnOrBefore(notes: DailyNote[], date: string) {
  if (!date) return notes;
  return notes.filter((note) => !note.date || note.date <= date);
}

export function dailyNoteHasClinicalData(note: DailyNote | undefined) {
  if (!note) return false;
  return (
    hasText(note.soapText) ||
    hasText(note.importantRedFlags) ||
    hasText(note.overnightEvents) ||
    hasText(note.subjectiveOrChiefConcern) ||
    hasText(note.vitalSigns) ||
    hasText(note.bloodSugar) ||
    hasText(note.physicalExam) ||
    hasText(note.labSummary) ||
    hasText(note.rawLabText) ||
    hasItems(note.labReports) ||
    hasItems(note.parsedLabItems) ||
    hasText(note.imageSummary) ||
    hasItems(note.imageStudyEntries) ||
    hasText(note.assessment) ||
    hasText(note.plan) ||
    hasItems(note.assessmentPlanItems) ||
    hasText(note.dischargePlan) ||
    hasText(note.vsOrder)
  );
}

function latestNoteWith(notes: DailyNote[], predicate: (note: DailyNote) => boolean) {
  return [...notes].filter(predicate).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function getLatestNonEmptyDailyNote(notes: DailyNote[]) {
  return latestNoteWith(notes, dailyNoteHasClinicalData);
}

function displayString(
  patientValue: string,
  todayNote: DailyNote | undefined,
  notes: DailyNote[],
  noteField: keyof DailyNote,
) {
  const todayValue = String(todayNote?.[noteField] ?? "");
  if (hasText(todayValue)) return todayValue;
  const latestValue = String(latestNoteWith(notes, (note) => hasText(String(note[noteField] ?? "")))?.[noteField] ?? "");
  if (hasText(latestValue)) return latestValue;
  return patientValue;
}

function displayArray<T>(
  patientValue: T[],
  todayNote: DailyNote | undefined,
  notes: DailyNote[],
  noteField: keyof DailyNote,
) {
  const todayValue = todayNote?.[noteField];
  if (Array.isArray(todayValue) && todayValue.length > 0) return todayValue as T[];
  const latestValue = latestNoteWith(notes, (note) => {
    const value = note[noteField];
    return Array.isArray(value) && value.length > 0;
  })?.[noteField];
  if (Array.isArray(latestValue) && latestValue.length > 0) return latestValue as T[];
  if (hasItems(patientValue)) return patientValue;
  return patientValue;
}

const dailyNoteSnapshotTextFields: Array<keyof Pick<
  DailyNote,
  | "importantRedFlags"
  | "overnightEvents"
  | "subjectiveOrChiefConcern"
  | "vitalSigns"
  | "bloodSugar"
  | "physicalExam"
  | "labSummary"
  | "rawLabText"
  | "imageSummary"
  | "assessment"
  | "plan"
  | "dischargePlan"
  | "vsOrder"
>> = [
  "importantRedFlags",
  "overnightEvents",
  "subjectiveOrChiefConcern",
  "vitalSigns",
  "bloodSugar",
  "physicalExam",
  "labSummary",
  "rawLabText",
  "imageSummary",
  "assessment",
  "plan",
  "dischargePlan",
  "vsOrder",
];

const dailyNoteSnapshotArrayFields: Array<keyof Pick<
  DailyNote,
  | "labReports"
  | "parsedLabItems"
  | "physicalExamEntries"
  | "imageStudyEntries"
  | "assessmentPlanItems"
  | "soapEditHistory"
>> = ["labReports", "parsedLabItems", "physicalExamEntries", "imageStudyEntries", "assessmentPlanItems", "soapEditHistory"];

export function dailyNoteMatchesSavedSnapshot(note: DailyNote | undefined, expected: DailyNote) {
  if (!note) return false;
  if (note.date !== expected.date) return false;
  if (String(note.soapText ?? "").trim() !== String(expected.soapText ?? "").trim()) return false;
  if ((note.soapStatus ?? "draft") !== (expected.soapStatus ?? "draft")) return false;
  if ((note.soapVersion ?? 1) !== (expected.soapVersion ?? 1)) return false;
  if (String(note.soapUpdatedAt ?? "") !== String(expected.soapUpdatedAt ?? "")) return false;
  if (!dailyNoteSnapshotTextFields.every((field) =>
    String(note[field] ?? "").trim() === String(expected[field] ?? "").trim(),
  )) return false;
  return dailyNoteSnapshotArrayFields.every((field) =>
    JSON.stringify(note[field] ?? []) === JSON.stringify(expected[field] ?? []),
  );
}

export function noteForDateOrFallback(patient: Patient, notes: DailyNote[], date = todayKey()) {
  const eligibleNotes = notesOnOrBefore(notes, date);
  return eligibleNotes.find((note) => note.date === date) ?? getLatestNonEmptyDailyNote(eligibleNotes) ?? dailyNoteFromPatient(patient, date);
}

export function patientForDate(patient: Patient, dailyNotesByPatient: DailyNotesByPatient = {}, date = todayKey()) {
  const notes = notesOnOrBefore(dailyNotesByPatient[patient.id] ?? [], date);
  const todayNote = notes.find((note) => note.date === date);
  const latestLabTextNote = latestNoteWith(notes, (note) => hasText(note.rawLabText) || hasText(note.labSummary));
  const latestLabItemsNote = latestNoteWith(notes, (note) => hasItems(note.parsedLabItems));
  const latestLabReportsNote = latestNoteWith(notes, (note) => hasItems(note.labReports));
  const latestImageSummaryNote = latestNoteWith(notes, (note) => hasText(note.imageSummary));
  const displayLabReports = displayArray<LabReport>(patient.labReports, todayNote, notes, "labReports");
  const displayImageEntries = displayArray<ImageStudyEntry>(patient.imageStudyEntries, todayNote, notes, "imageStudyEntries");
  const displayAssessmentPlanItems = displayArray<AssessmentPlanItem>(patient.assessmentPlanItems, todayNote, notes, "assessmentPlanItems");
  const displayRawLabText = String(
    todayNote?.rawLabText?.trim()
      ? todayNote.rawLabText
      : todayNote?.labSummary?.trim()
        ? todayNote.labSummary
        : latestLabTextNote?.rawLabText?.trim()
          ? latestLabTextNote.rawLabText
          : latestLabTextNote?.labSummary?.trim()
            ? latestLabTextNote.labSummary
            : patient.rawLabText,
  );
  const displayLabSummary = String(
    todayNote?.labSummary?.trim()
      ? todayNote.labSummary
      : latestLabTextNote?.labSummary?.trim()
        ? latestLabTextNote.labSummary
        : patient.newLabs,
  );
  const displayParsedLabItems =
    Array.isArray(todayNote?.parsedLabItems) && todayNote.parsedLabItems.length > 0
      ? todayNote.parsedLabItems
      : Array.isArray(todayNote?.labReports) && todayNote.labReports.length > 0
        ? todayNote.labReports.flatMap((report) => report.items)
        : hasItems(latestLabItemsNote?.parsedLabItems)
          ? latestLabItemsNote?.parsedLabItems ?? patient.parsedLabItems
          : hasItems(latestLabReportsNote?.labReports)
            ? latestLabReportsNote?.labReports.flatMap((report) => report.items) ?? patient.parsedLabItems
            : hasItems(patient.labReports)
              ? patient.labReports.flatMap((report) => report.items)
              : patient.parsedLabItems;
  const displayImageSummary = String(
    todayNote?.imageSummary?.trim()
      ? todayNote.imageSummary
      : latestImageSummaryNote?.imageSummary?.trim()
        ? latestImageSummaryNote.imageSummary
        : patient.newImaging,
  );

  return {
    ...patient,
    importantRedFlags: displayString(patient.importantRedFlags, todayNote, notes, "importantRedFlags"),
    overnightEvent: displayString(patient.overnightEvent, todayNote, notes, "overnightEvents"),
    subjectiveOrChiefConcern: displayString(patient.subjectiveOrChiefConcern, todayNote, notes, "subjectiveOrChiefConcern"),
    vitalSigns: displayString(patient.vitalSigns, todayNote, notes, "vitalSigns"),
    bloodSugar: displayString(patient.bloodSugar, todayNote, notes, "bloodSugar"),
    physicalExam: displayString(patient.physicalExam, todayNote, notes, "physicalExam"),
    newLabs: displayLabSummary,
    rawLabText: displayRawLabText,
    labDate: todayNote?.labDate || latestLabReportsNote?.labDate || latestLabTextNote?.labDate || patient.labDate,
    labReportTitle: todayNote?.labReportTitle || latestLabReportsNote?.labReportTitle || latestLabTextNote?.labReportTitle || patient.labReportTitle,
    labReports: displayLabReports,
    parsedLabItems: displayParsedLabItems,
    newImaging: displayImageSummary,
    physicalExamEntries: displayArray<PhysicalExamEntry>(patient.physicalExamEntries, todayNote, notes, "physicalExamEntries"),
    imageStudyEntries: displayImageEntries,
    assessment: displayString(patient.assessment, todayNote, notes, "assessment"),
    plan: displayString(patient.plan, todayNote, notes, "plan"),
    assessmentPlanItems: displayAssessmentPlanItems,
    dischargePlan: displayString(patient.dischargePlan, todayNote, notes, "dischargePlan"),
    vsOrder: displayString(patient.vsOrder, todayNote, notes, "vsOrder"),
  };
}

export function patientForToday(patient: Patient, dailyNotesByPatient: DailyNotesByPatient = {}) {
  return patientForDate(patient, dailyNotesByPatient, todayKey());
}

export interface PatientDisplaySummary {
  patient: Patient;
  identity: {
    bed: string;
    patientCode: string;
    age: number;
    sex: Patient["sex"];
    attending: string;
    primaryDiagnosis: string;
  };
  redFlags: string;
  underlyingDiseases: string[];
  activeProblems: string[];
  subjective: string;
  vitalSigns: string;
  bloodSugar: string;
  physicalExam: string;
  physicalExamEntries: PhysicalExamEntry[];
  latestLabs: {
    reports: LabReport[];
    items: ParsedLabItem[];
    text: string;
  };
  latestImages: {
    text: string;
    entries: ImageStudyEntry[];
  };
  assessmentPlanItems: AssessmentPlanItem[];
  assessment: string;
  plan: string;
  tasks: PatientTask[];
  dischargeChecklist: {
    meds: DischargePrepStatus;
    opd: DischargePrepStatus;
    certificate: DischargePrepStatus;
  };
  dischargePlan: string;
  dischargeTargetDate: string;
  admissionSummary: string;
  sourceLabels: {
    todayNoteIsEmpty: boolean;
  };
}

export function getPatientDisplaySummary(
  patient: Patient,
  dailyNotesByPatient: DailyNotesByPatient = {},
  date = todayKey(),
): PatientDisplaySummary {
  const notes = notesOnOrBefore(dailyNotesByPatient[patient.id] ?? [], date);
  const todayNote = notes.find((note) => note.date === date);
  const displayPatient = patientForDate(patient, dailyNotesByPatient, date);
  const latestRedFlagNote = latestNoteWith(notes, (note) => hasText(note.importantRedFlags));

  const redFlags = hasText(todayNote?.importantRedFlags)
    ? todayNote?.importantRedFlags ?? ""
    : hasText(latestRedFlagNote?.importantRedFlags)
      ? latestRedFlagNote?.importantRedFlags ?? ""
      : patient.importantRedFlags;

  const labReports = displayPatient.labReports;
  const labItems = hasItems(labReports)
    ? labReports.flatMap((report) => report.items)
    : displayPatient.parsedLabItems;
  const imageEntries = displayPatient.imageStudyEntries;

  return {
    patient: {
      ...displayPatient,
      importantRedFlags: redFlags,
      labReports,
      parsedLabItems: labItems,
      imageStudyEntries: imageEntries,
    },
    identity: {
      bed: patient.bed,
      patientCode: patient.patientCode,
      age: patient.age,
      sex: patient.sex,
      attending: patient.attending,
      primaryDiagnosis: patient.primaryDiagnosis,
    },
    redFlags,
    underlyingDiseases: getUnderlyingDiseaseItems(patient),
    activeProblems: getActiveProblemItems(patient),
    subjective: displayPatient.subjectiveOrChiefConcern,
    vitalSigns: displayPatient.vitalSigns,
    bloodSugar: displayPatient.bloodSugar,
    physicalExam: displayPatient.physicalExam,
    physicalExamEntries: displayPatient.physicalExamEntries,
    latestLabs: {
      reports: labReports,
      items: labItems,
      text: displayPatient.rawLabText || displayPatient.newLabs,
    },
    latestImages: {
      text: displayPatient.newImaging,
      entries: imageEntries,
    },
    assessmentPlanItems: displayPatient.assessmentPlanItems,
    assessment: displayPatient.assessment,
    plan: displayPatient.plan,
    tasks: patient.tasks,
    dischargeChecklist: {
      meds: patient.dischargeMedsStatus,
      opd: patient.opdAppointmentStatus,
      certificate: patient.diagnosisCertificateStatus,
    },
    dischargePlan: displayPatient.dischargePlan,
    dischargeTargetDate: patient.dischargeTargetDate,
    admissionSummary: getAdmissionSummaryText(patient),
    sourceLabels: {
      todayNoteIsEmpty: Boolean(!dailyNoteHasClinicalData(todayNote) && getLatestNonEmptyDailyNote(notes.filter((note) => note.date !== date))),
    },
  };
}

export function pendingDischargePrep(patient: Patient) {
  const labels: Array<[DischargePrepStatus, string]> = [
    [patient.dischargeMedsStatus, "Meds"],
    [patient.opdAppointmentStatus, "OPD"],
    [patient.diagnosisCertificateStatus, "Cert"],
  ];

  return labels.filter(([status]) => status === "pending").map(([, label]) => label);
}

export function hasUpcomingDischarge(patient: Patient) {
  if (patient.status !== "active" || !patient.dischargeTargetDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(`${patient.dischargeTargetDate}T00:00:00`);
  return target.getTime() === today.getTime() || target.getTime() === tomorrow.getTime();
}

export function dischargePrepText(patient: Patient) {
  const symbol = (status: DischargePrepStatus) =>
    status === "done" ? "\u2713" : status === "notNeeded" ? "N/A" : "\u25a1";

  return `Meds ${symbol(patient.dischargeMedsStatus)} / OPD ${symbol(patient.opdAppointmentStatus)} / Cert ${symbol(
    patient.diagnosisCertificateStatus,
  )}`;
}

export function getAttendingName(patient: Patient) {
  return patient.attending.trim() || "Unassigned attending";
}

export function getActiveAttendingNames(patients: Patient[]) {
  const names = getActivePatients(patients)
    .map((patient) => patient.attending.trim())
    .filter(Boolean);

  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function groupPatientsByAttending(patients: Patient[]) {
  return patients.reduce<Record<string, Patient[]>>((groups, patient) => {
    const attending = getAttendingName(patient);
    groups[attending] = [...(groups[attending] ?? []), patient];
    return groups;
  }, {});
}

export function getArchivedPatients(patients: Patient[]) {
  return patients.filter(
    (patient) => patient.status === "discharged" || patient.status === "archived",
  );
}

export function getPendingTasks(patient: Patient[]) {
  return patient.flatMap((item) =>
    item.tasks
      .filter((task) => !task.done)
      .map((task) => ({ patient: item, task })),
  );
}

export function hasUrgentPendingTask(patient: Patient) {
  return patient.tasks.some((task) => !task.done && task.priority === "urgent");
}

export function sortPatients(patients: Patient[], sortMode: SortMode) {
  const sortedPatients = [...patients];

  if (sortMode === "bed") {
    return sortedPatients.sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
  }

  if (sortMode === "dischargeDate") {
    return sortedPatients.sort((a, b) => {
      const dateA = a.dischargeTargetDate || "9999-12-31";
      const dateB = b.dischargeTargetDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });
  }

  return sortedPatients.sort((a, b) => Number(hasUrgentPendingTask(b)) - Number(hasUrgentPendingTask(a)));
}

export function createTodayFromYesterday(patient: Patient): Patient {
  return {
    ...patient,
    assessmentPlanItems: patient.assessmentPlanItems.map((item) => ({
      ...item,
      evidenceOrCourseItems: [...item.evidenceOrCourseItems],
      planItems: [...item.planItems],
    })),
    // Keep clinically useful S/O/A/P, course, discharge, attention, and current tasks.
    updatedAt: nowIso(),
  };
}

export function emptyPatient(): Patient {
  const now = nowIso();

  return {
    id: createId("p"),
    bed: "",
    patientCode: "",
    oneLiner: "",
    age: 0,
    // Unknown at creation time. Never seed a guessed demographic into the
    // patient master before the clinician explicitly selects it.
    sex: "Other",
    underlyingDiseases: "",
    underlyingDiseaseItems: [],
    attending: "",
    teamOrService: "",
    admissionDate: "",
    primaryDiagnosis: "",
    activeProblems: "",
    activeProblemItems: [],
    activeProblemStructuredItems: [],
    chiefComplaint: "",
    presentIllnessOrHPI: "",
    admissionBriefFreeText: "",
    admissionChiefConcern: "",
    hpiOrAdmissionStory: "",
    baselineFunction: "",
    admissionPMH: "",
    initialPhysicalExam: "",
    initialLabs: "",
    initialImaging: "",
    initialAssessment: "",
    initialPlan: "",
    earlyHospitalCourse: "",
    admissionBriefNotes: "",
    generatedAdmissionNote: "",
    generatedAdmissionSummary: "",
    generatedDischargeSummary: "",
    generatedWeeklySummary: "",
    generatedSbarNote: "",
    isNewAdmission: false,
    showAdmissionBriefOnPrint: false,
    physicalExam: "",
    hospitalCourseHighlights: "",
    importantRedFlags: "",
    vitalSigns: "",
    bloodSugar: "",
    rawLabText: "",
    labDate: todayKey(),
    labReportTitle: "",
    labReports: [],
    parsedLabItems: [],
    physicalExamEntries: [],
    imageStudyEntries: [],
    dischargeMedsStatus: "pending",
    opdAppointmentStatus: "pending",
    diagnosisCertificateStatus: "pending",
    overnightEvent: "",
    subjectiveOrChiefConcern: "",
    newLabs: "",
    newImaging: "",
    assessment: "",
    plan: "",
    assessmentPlanItems: [],
    dischargePlan: "",
    dischargeTargetDate: "",
    dischargeBarriers: "",
    specialAttention: "",
    vsOrder: "",
    status: "active",
    tasks: [],
    aiThinkingPrompts: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyTask(): PatientTask {
  return {
    id: createId("t"),
    text: "",
    done: false,
    priority: "normal",
    category: "other",
    dueDate: "",
    createdAt: nowIso(),
    completedAt: "",
  };
}

export function statusLabel(status: PatientStatus) {
  if (status === "active") return "Active";
  if (status === "discharged") return "Discharged";
  return "Archived";
}
