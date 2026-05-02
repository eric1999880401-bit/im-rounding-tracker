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

function normalizePatient(patientId: string, data: Partial<Patient>): Patient {
  return {
    id: data.id ?? patientId,
    bed: data.bed ?? "",
    patientCode: data.patientCode ?? "",
    age: data.age ?? 0,
    sex: data.sex ?? "M",
    admissionDate: data.admissionDate ?? "",
    primaryDiagnosis: data.primaryDiagnosis ?? "",
    activeProblems: data.activeProblems ?? "",
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
  return setDoc(patientDocument(uid, patient.id), patient);
}

export function updatePatient(uid: string, patient: Patient) {
  return updateDoc(patientDocument(uid, patient.id), { ...patient });
}

export function deletePatient(uid: string, patientId: string) {
  return deleteDoc(patientDocument(uid, patientId));
}
