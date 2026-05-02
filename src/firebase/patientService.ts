import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import type { Patient } from "../types";
import { db } from "./firebase";

function patientsCollection(uid: string) {
  return collection(db, "users", uid, "patients");
}

function patientDocument(uid: string, patientId: string) {
  return doc(db, "users", uid, "patients", patientId);
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
      const patients = snapshot.docs.map((patientDoc) => patientDoc.data() as Patient);
      onPatients(patients);
    },
    onError,
  );
}

export function savePatient(uid: string, patient: Patient) {
  // The patient id is also the Firestore document id for easy lookup.
  return setDoc(patientDocument(uid, patient.id), patient, { merge: true });
}

export function deletePatient(uid: string, patientId: string) {
  return deleteDoc(patientDocument(uid, patientId));
}
