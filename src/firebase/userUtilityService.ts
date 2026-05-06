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
import type { MiscTask, PhonebookContact, StudyTopic } from "../types";
import { db } from "./firebase";

function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return "";
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeForFirestore(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nextValue]) => [key, sanitizeForFirestore(nextValue)]),
    );
  }
  return value;
}

function normalizeContact(id: string, data: Partial<PhonebookContact>): PhonebookContact {
  return {
    id: data.id ?? id,
    name: data.name ?? "",
    roleOrUnit: data.roleOrUnit ?? "",
    phone: data.phone ?? "",
    note: data.note ?? "",
    isImportant: data.isImportant ?? false,
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

function normalizeMiscTask(id: string, data: Partial<MiscTask>): MiscTask {
  return {
    id: data.id ?? id,
    text: data.text ?? "",
    done: data.done ?? false,
    priority: data.priority ?? "normal",
    dueDate: data.dueDate ?? "",
    note: data.note ?? "",
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

function normalizeStudyTopic(id: string, data: Partial<StudyTopic>): StudyTopic {
  return {
    id: data.id ?? id,
    topic: data.topic ?? "",
    note: data.note ?? "",
    done: data.done ?? false,
    createdAt: data.createdAt ?? "",
    updatedAt: data.updatedAt ?? "",
  };
}

function userCollection(uid: string, name: string) {
  return collection(db, "users", uid, name);
}

function userDocument(uid: string, name: string, id: string) {
  return doc(db, "users", uid, name, id);
}

export function subscribeToPhonebook(
  uid: string,
  onData: (items: PhonebookContact[]) => void,
  onError: (error: FirestoreError) => void,
) {
  return onSnapshot(query(userCollection(uid, "phonebook"), orderBy("name")), (snapshot) => {
    onData(snapshot.docs.map((item) => normalizeContact(item.id, item.data() as Partial<PhonebookContact>)));
  }, onError);
}

export function subscribeToMiscTasks(
  uid: string,
  onData: (items: MiscTask[]) => void,
  onError: (error: FirestoreError) => void,
) {
  return onSnapshot(query(userCollection(uid, "miscTasks"), orderBy("createdAt", "desc")), (snapshot) => {
    onData(snapshot.docs.map((item) => normalizeMiscTask(item.id, item.data() as Partial<MiscTask>)));
  }, onError);
}

export function subscribeToStudyTopics(
  uid: string,
  onData: (items: StudyTopic[]) => void,
  onError: (error: FirestoreError) => void,
) {
  return onSnapshot(query(userCollection(uid, "studyTopics"), orderBy("createdAt", "desc")), (snapshot) => {
    onData(snapshot.docs.map((item) => normalizeStudyTopic(item.id, item.data() as Partial<StudyTopic>)));
  }, onError);
}

export function savePhonebookContact(uid: string, contact: PhonebookContact) {
  return setDoc(userDocument(uid, "phonebook", contact.id), sanitizeForFirestore(contact) as Record<string, unknown>);
}

export function deletePhonebookContact(uid: string, id: string) {
  return deleteDoc(userDocument(uid, "phonebook", id));
}

export function saveMiscTask(uid: string, task: MiscTask) {
  return setDoc(userDocument(uid, "miscTasks", task.id), sanitizeForFirestore(task) as Record<string, unknown>);
}

export function deleteMiscTask(uid: string, id: string) {
  return deleteDoc(userDocument(uid, "miscTasks", id));
}

export function saveStudyTopic(uid: string, topic: StudyTopic) {
  return setDoc(userDocument(uid, "studyTopics", topic.id), sanitizeForFirestore(topic) as Record<string, unknown>);
}

export function deleteStudyTopic(uid: string, id: string) {
  return deleteDoc(userDocument(uid, "studyTopics", id));
}
