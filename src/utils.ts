import type { Patient, PatientStatus, PatientTask, SortMode } from "./types";

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getActivePatients(patients: Patient[]) {
  return patients.filter((patient) => patient.status === "active");
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
    // Keep problem list, A/P, discharge plan, and attention items.
    // Clear fields that usually represent today's new overnight changes.
    overnightEvent: "",
    subjectiveOrChiefConcern: "",
    newLabs: "",
    newImaging: "",
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
    attending: "",
    teamOrService: "",
    admissionDate: "",
    primaryDiagnosis: "",
    activeProblems: "",
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
