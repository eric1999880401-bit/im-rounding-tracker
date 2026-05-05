import type { HighlightLine, Patient, PatientStatus, PatientTask, SortMode } from "./types";

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getActivePatients(patients: Patient[]) {
  return patients.filter((patient) => patient.status === "active");
}

export function textToItems(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getUnderlyingDiseaseItems(patient: Patient) {
  return patient.underlyingDiseaseItems.length > 0
    ? patient.underlyingDiseaseItems
    : textToItems(patient.underlyingDiseases);
}

export function getActiveProblemItems(patient: Patient) {
  return patient.activeProblemItems.length > 0
    ? patient.activeProblemItems
    : textToItems(patient.activeProblems);
}

export function summarizeItems(items: string[], fallback = "-") {
  if (items.length === 0) return fallback;
  return items.join("; ");
}

export function splitHighlightLines(value: string): HighlightLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const important = line.startsWith("!");
      return {
        important,
        text: important ? line.slice(1).trim() : line,
      };
    })
    .filter((line) => line.text);
}

export function importantLines(value: string) {
  return splitHighlightLines(value).filter((line) => line.important);
}

export function plainClinicalText(value: string, fallback = "-") {
  const text = splitHighlightLines(value).map((line) => line.text).join("; ");
  return text || fallback;
}

export function compactClinicalText(value: string, maxLines = 2, fallback = "-") {
  const lines = splitHighlightLines(value);
  if (lines.length === 0) return fallback;

  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  return [...important, ...normal].slice(0, maxLines).map((line) => line.text).join("; ");
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
    age: 0,
    sex: "M",
    underlyingDiseases: "",
    underlyingDiseaseItems: [],
    attending: "",
    teamOrService: "",
    admissionDate: "",
    primaryDiagnosis: "",
    activeProblems: "",
    activeProblemItems: [],
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
    isNewAdmission: false,
    showAdmissionBriefOnPrint: false,
    physicalExam: "",
    hospitalCourseHighlights: "",
    importantRedFlags: "",
    overnightEvent: "",
    subjectiveOrChiefConcern: "",
    newLabs: "",
    newImaging: "",
    assessment: "",
    plan: "",
    dischargePlan: "",
    dischargeTargetDate: "",
    dischargeBarriers: "",
    specialAttention: "",
    vsOrder: "",
    status: "active",
    tasks: [],
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
