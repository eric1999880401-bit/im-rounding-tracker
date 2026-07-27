import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type FirestoreError,
  type Transaction,
} from "firebase/firestore";
import type {
  ClinicalAuditEvent,
  ClinicalAuditPayload,
  Patient,
  SaveDailyNoteOptions,
  SavePatientOptions,
} from "../types";
import { db } from "./firebase";
import { clinicalSaveConflictReason } from "../clinicalSaveGuard";
import { patientUpdatedAtConflictReason, pickAtomicPatientPatch } from "../patientWriteSafety";

function auditEventsCollection(uid: string) {
  return collection(db, "users", uid, "clinicalAuditEvents");
}

function auditPayloadsCollection(uid: string) {
  return collection(db, "users", uid, "clinicalAuditPayloads");
}

function currentSoapVersion(data: Record<string, unknown> | undefined) {
  if (!data) return 0;
  const version = Number(data.soapVersion);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function allowlistedPatientPatch(value: SaveDailyNoteOptions["patientPatch"]) {
  return pickAtomicPatientPatch(value);
}

const aiDocumentPatientFields = new Set<keyof Patient>([
  "generatedAdmissionNote",
  "admissionBriefNotes",
  "generatedAdmissionSummary",
  "admissionBriefFreeText",
  "oneLiner",
  "chiefComplaint",
  "admissionChiefConcern",
  "presentIllnessOrHPI",
  "hpiOrAdmissionStory",
  "generatedDischargeSummary",
  "hospitalCourseHighlights",
  "generatedWeeklySummary",
  "generatedSbarNote",
  "updatedAt",
]);

function allowlistedAiDocumentPatch(value: SavePatientOptions["patientPatch"]) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(
      ([key, nextValue]) => aiDocumentPatientFields.has(key as keyof Patient) && typeof nextValue === "string",
    ),
  );
}

function writeAuditPayloads(
  uid: string,
  patientId: string,
  audit: NonNullable<SavePatientOptions["audit"]>,
  transaction: Transaction,
) {
  audit.payloads.forEach((payload) => {
    if (payload.eventId !== audit.event.id || payload.patientId !== patientId) {
      throw new Error("Clinical audit payload binding is invalid.");
    }
    transaction.set(doc(auditPayloadsCollection(uid), payload.id), {
      ...payload,
      actorUid: uid,
      expiresAt: Timestamp.fromDate(new Date(payload.expiresAt)),
    });
  });
}

export async function savePatientWithAudit(
  uid: string,
  patientId: string,
  options: SavePatientOptions,
) {
  const audit = options.audit;
  if (!audit) throw new Error("Clinical audit metadata is required for an audited patient save.");
  if (audit.event.patientId !== patientId || audit.event.operation !== "ai.document.save") {
    throw new Error("AI document audit binding does not match the patient being saved.");
  }
  if (options.expectedPatientUpdatedAt === undefined) {
    throw new Error("AI document save requires the patient revision that was reviewed.");
  }
  const patientPatch = allowlistedAiDocumentPatch(options.patientPatch);
  if (Object.keys(patientPatch).length === 0) {
    throw new Error("AI document save did not contain an allowlisted reviewed patient field.");
  }

  const patientRef = doc(db, "users", uid, "patients", patientId);
  const eventRef = doc(auditEventsCollection(uid), audit.event.id);
  await runTransaction(db, async (transaction) => {
    const patientSnapshot = await transaction.get(patientRef);
    const conflictReason = patientUpdatedAtConflictReason(
      patientSnapshot.exists(),
      String(patientSnapshot.data()?.updatedAt ?? ""),
      options.expectedPatientUpdatedAt ?? "",
    );
    if (conflictReason) throw new Error(conflictReason);

    transaction.update(patientRef, patientPatch);
    transaction.set(eventRef, {
      ...audit.event,
      actorUid: uid,
      status: "committed",
      committedAt: serverTimestamp(),
    });
    writeAuditPayloads(uid, patientId, audit, transaction);
  });
}

export async function saveDailyNoteWithAudit(
  uid: string,
  patientId: string,
  noteDate: string,
  noteData: Record<string, unknown>,
  options: SaveDailyNoteOptions,
) {
  const audit = options.audit;
  if (!audit) throw new Error("Clinical audit metadata is required for an audited save.");
  if (audit.event.patientId !== patientId || audit.event.dailyNoteDate !== noteDate) {
    throw new Error("Clinical audit binding does not match the patient/date being saved.");
  }
  if (Number(noteData.soapVersion) !== audit.event.savedSoapVersion) {
    throw new Error("Clinical audit version does not match the reviewed SOAP version.");
  }

  const noteRef = doc(db, "users", uid, "patients", patientId, "dailyNotes", noteDate);
  const patientRef = doc(db, "users", uid, "patients", patientId);
  const eventRef = doc(auditEventsCollection(uid), audit.event.id);
  const expectedSoapVersion = options.expectedSoapVersion ?? audit.event.baseSoapVersion;

  await runTransaction(db, async (transaction) => {
    const [currentSnapshot, patientSnapshot] = await Promise.all([
      transaction.get(noteRef),
      transaction.get(patientRef),
    ]);
    const persistedVersion = currentSnapshot.exists()
      ? currentSoapVersion(currentSnapshot.data() as Record<string, unknown>)
      : 0;
    const conflictReason = clinicalSaveConflictReason({
      persistedSoapVersion: persistedVersion,
      expectedSoapVersion,
      patientExists: patientSnapshot.exists(),
      persistedPatientUpdatedAt: String(patientSnapshot.data()?.updatedAt ?? ""),
      expectedPatientUpdatedAt: options.expectedPatientUpdatedAt,
    });
    if (conflictReason) throw new Error(conflictReason);

    transaction.set(noteRef, noteData);
    const patientPatch = allowlistedPatientPatch(options.patientPatch);
    if (Object.keys(patientPatch).length > 0) transaction.update(patientRef, patientPatch);
    transaction.set(eventRef, {
      ...audit.event,
      actorUid: uid,
      status: "committed",
      committedAt: serverTimestamp(),
    });
    writeAuditPayloads(uid, patientId, audit, transaction);
  });
}

export function subscribeToClinicalAuditEvents(
  uid: string,
  patientId: string,
  onEvents: (events: ClinicalAuditEvent[]) => void,
  onError: (error: FirestoreError) => void,
) {
  const patientEvents = query(auditEventsCollection(uid), where("patientId", "==", patientId));
  return onSnapshot(
    patientEvents,
    (snapshot) => {
      const events = snapshot.docs
        .map((eventDoc) => ({ ...eventDoc.data(), id: eventDoc.id }) as ClinicalAuditEvent)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 250);
      onEvents(events);
    },
    onError,
  );
}

export async function loadClinicalAuditPayloads(uid: string, eventId: string) {
  const payloadQuery = query(auditPayloadsCollection(uid), where("eventId", "==", eventId));
  const snapshot = await getDocs(payloadQuery);
  return snapshot.docs
    .map((payloadDoc) => {
      const data = payloadDoc.data() as Omit<ClinicalAuditPayload, "expiresAt"> & { expiresAt?: Timestamp | string };
      const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toDate().toISOString() : String(data.expiresAt ?? "");
      return { ...data, id: payloadDoc.id, expiresAt } as ClinicalAuditPayload;
    })
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

export async function purgeExpiredClinicalAuditPayloads(uid: string) {
  let deleted = 0;
  for (let batchIndex = 0; batchIndex < 20; batchIndex += 1) {
    const expiredQuery = query(
      auditPayloadsCollection(uid),
      where("expiresAt", "<=", Timestamp.now()),
      limit(250),
    );
    const snapshot = await getDocs(expiredQuery);
    if (snapshot.empty) break;
    const batch = writeBatch(db);
    snapshot.docs.forEach((payloadDoc) => batch.delete(payloadDoc.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 250) break;
  }
  return deleted;
}
