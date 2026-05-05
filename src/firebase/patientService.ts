import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type FirestoreError,
} from "firebase/firestore";
import type { Patient, PatientTask } from "../types";
import { db } from "./firebase";
import { parseLabText, textToItems } from "../utils";

function patientsCollection(uid: string) {
  return collection(db, "users", uid, "patients");
}

function patientDocument(uid: string, patientId: string) {
  return doc(db, "users", uid, "patients", patientId);
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
    label,
    name: String(item.name ?? label),
    value: String(item.value ?? ""),
    unit: String(item.unit ?? ""),
    previousValue: String(item.previousValue ?? ""),
    group: String(item.group ?? ""),
    important: Boolean(item.important ?? item.isImportant ?? false),
    isImportant: Boolean(item.isImportant ?? item.important ?? false),
    note: String(item.note ?? ""),
  };
}

function normalizePatient(patientId: string, data: Partial<Patient>): Patient {
  return {
    id: data.id ?? patientId,
    bed: data.bed ?? "",
    patientCode: data.patientCode ?? "",
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
    isNewAdmission: data.isNewAdmission ?? false,
    showAdmissionBriefOnPrint: data.showAdmissionBriefOnPrint ?? false,
    physicalExam: data.physicalExam ?? "",
    hospitalCourseHighlights: data.hospitalCourseHighlights ?? "",
    importantRedFlags: data.importantRedFlags ?? "",
    rawLabText: data.rawLabText ?? data.newLabs ?? "",
    parsedLabItems: Array.isArray(data.parsedLabItems)
      ? data.parsedLabItems.map((item) => normalizeParsedLabItem(item as unknown as Record<string, unknown>))
      : parseLabText(data.rawLabText ?? data.newLabs ?? ""),
    dischargeMedsStatus: data.dischargeMedsStatus ?? "pending",
    opdAppointmentStatus: data.opdAppointmentStatus ?? "pending",
    diagnosisCertificateStatus: data.diagnosisCertificateStatus ?? "pending",
    overnightEvent: data.overnightEvent ?? "",
    subjectiveOrChiefConcern: data.subjectiveOrChiefConcern ?? "",
    newLabs: data.newLabs ?? "",
    newImaging: data.newImaging ?? "",
    assessment: data.assessment ?? "",
    plan: data.plan ?? "",
    dischargePlan: data.dischargePlan ?? "",
    dischargeTargetDate: data.dischargeTargetDate ?? "",
    dischargeBarriers: data.dischargeBarriers ?? "",
    specialAttention: data.specialAttention ?? "",
    vsOrder: data.vsOrder ?? "",
    status: data.status ?? "active",
    tasks: Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [],
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

export function createPatient(uid: string, patient: Patient) {
  // The patient id is also the Firestore document id for easy lookup.
  return setDoc(patientDocument(uid, patient.id), preparePatientForFirestore(patient));
}

export function updatePatient(uid: string, patient: Patient) {
  return updateDoc(patientDocument(uid, patient.id), preparePatientForFirestore(patient));
}

export function deletePatient(uid: string, patientId: string) {
  return deleteDoc(patientDocument(uid, patientId));
}
