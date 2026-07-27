import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "src/patientWriteSafety.ts");
const helperSource = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  fileName: helperPath,
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  FIRESTORE_WRITE_BATCH_LIMIT,
  patientDeletionLimitReason,
  patientDeletionWriteCount,
  patientDetailEditorPatient,
  patientUpdatedAtConflictReason,
  persistedPatientUpdatedAt,
  pickAtomicPatientPatch,
  reconcilePatientDraftRevision,
  selectedDailyNoteContext,
} = await import(helperUrl);

const fakeSourcePatient = {
  id: "fake-patient",
  bed: "D-01",
  patientCode: "FAKE-001",
  vitalSigns: "source master V/S",
  assessment: "source master assessment",
  updatedAt: "2026-07-27T08:00:00.000Z",
  persistedUpdatedAt: "2026-07-27T07:00:00.000Z",
};
const editorPatient = patientDetailEditorPatient(fakeSourcePatient);
assert.notEqual(editorPatient, fakeSourcePatient, "editor must use a local copy");
assert.equal(editorPatient.vitalSigns, "source master V/S", "display fallback must not replace the writable patient baseline");

const fakeNotes = [
  { date: "2026-07-26", assessment: "previous-date fallback" },
  { date: "2026-07-27", assessment: "selected-date note" },
];
assert.deepEqual(
  selectedDailyNoteContext(fakeNotes, "2026-07-27").map((note) => note.assessment),
  ["selected-date note"],
  "only the true selected note may enter writable editor context",
);
assert.deepEqual(
  selectedDailyNoteContext(fakeNotes, "2026-07-28"),
  [],
  "a missing date must not fall back to a previous note",
);

assert.equal(persistedPatientUpdatedAt(fakeSourcePatient), "2026-07-27T07:00:00.000Z");
assert.match(
  patientUpdatedAtConflictReason(true, "newer", "older"),
  /another tab or device/i,
  "stale patient writes must be rejected",
);
assert.equal(patientUpdatedAtConflictReason(true, "same", "same"), "");

const fakeRevisionA = {
  updatedAt: "revision-A",
  persistedUpdatedAt: "revision-A",
};
const fakeRemoteRevisionB = {
  updatedAt: "revision-B",
  persistedUpdatedAt: "revision-B",
};
let pinnedDraftRevision = reconcilePatientDraftRevision("", fakeRevisionA, true);
assert.equal(pinnedDraftRevision, "revision-A", "the writable draft must capture revision A");
pinnedDraftRevision = reconcilePatientDraftRevision(pinnedDraftRevision, fakeRemoteRevisionB, false);
assert.equal(
  pinnedDraftRevision,
  "revision-A",
  "a remote revision B snapshot must not rebase an unsaved revision A draft",
);
assert.match(
  patientUpdatedAtConflictReason(true, fakeRemoteRevisionB.updatedAt, pinnedDraftRevision),
  /another tab or device/i,
  "saving the A-based draft against persisted B must conflict",
);
const fakeSavedRevisionC = {
  updatedAt: "revision-C",
  persistedUpdatedAt: "revision-C",
};
pinnedDraftRevision = reconcilePatientDraftRevision(pinnedDraftRevision, fakeSavedRevisionC, true);
assert.equal(pinnedDraftRevision, "revision-C", "a successful local save must advance the draft baseline");

const atomicPatch = pickAtomicPatientPatch({
  bed: "SHOULD-NOT-WRITE",
  patientCode: "SHOULD-NOT-WRITE",
  plan: "fake plan",
  vsOrder: "fake V/S order",
  updatedAt: "2026-07-27T09:00:00.000Z",
  persistedUpdatedAt: "LOCAL-ONLY",
});
assert.deepEqual(atomicPatch, {
  plan: "fake plan",
  vsOrder: "fake V/S order",
  updatedAt: "2026-07-27T09:00:00.000Z",
});

assert.equal(FIRESTORE_WRITE_BATCH_LIMIT, 500);
assert.equal(
  patientDeletionWriteCount(496, 1, 1, 1),
  500,
  "patient + notes + audit documents + AI drafts may use exactly one full batch",
);
assert.equal(patientDeletionLimitReason(500), "", "500 writes must remain allowed");
assert.match(
  patientDeletionLimitReason(patientDeletionWriteCount(497, 1, 1, 1)),
  /blocked[\s\S]+501[\s\S]+500-write[\s\S]+No data was deleted/i,
  "501 writes must be refused before any mutation",
);

const detailSource = await readFile(path.join(repoRoot, "src/pages/PatientDetailPage.tsx"), "utf8");
assert.doesNotMatch(detailSource, /mergeNoteWithFallback/, "display fallback must not be a writable baseline");
assert.doesNotMatch(
  detailSource,
  /await onSavePatient\([^;]+;\s*await onSaveDailyNote\(/s,
  "patient and daily note must not be written as two independent calls",
);
assert.match(detailSource, /const newNote = emptyDailyNote\(selectedDate\)/, "Create note must start from an empty note");
assert.match(detailSource, /dailyNotes=\{editorDailyNotes\}/, "SOAP editor must receive selected-date notes only");
assert.match(
  detailSource,
  /const draftPersistedRevisionRef = useRef[\s\S]+reconcilePatientDraftRevision[\s\S]+canAcceptSnapshot/,
  "Patient Detail must pin a persisted revision to the writable draft baseline",
);
assert.doesNotMatch(
  detailSource,
  /expectedPatientUpdatedAt:\s*persistedPatientUpdatedAt\(sourcePatient|persistedUpdatedAt:\s*persistedPatientUpdatedAt\(sourcePatient/,
  "dirty draft saves must never derive their expected revision from the live source patient",
);
assert.ok(
  (detailSource.match(/expectedPatientUpdatedAt:\s*expectedDraftPatientRevision\(/g) ?? []).length >= 5,
  "all Patient Detail daily-note compatibility paths must use the pinned draft revision",
);
assert.match(
  detailSource,
  /await onSavePatient\(nextPatient\);\s*advanceDraftPatientRevision\(nextPatient\)/,
  "patient-only saves must advance the pinned revision only after success",
);

const serviceSource = await readFile(path.join(repoRoot, "src/firebase/patientService.ts"), "utf8");
assert.match(serviceSource, /export async function updatePatient[\s\S]+?runTransaction/, "patient update must use a stale-guarded transaction");
assert.match(serviceSource, /saveDailyNoteAtomically/, "combined note and patient writes must have one transaction path");
assert.match(
  serviceSource,
  /if \(!options \|\| options\.expectedSoapVersion === undefined\)[\s\S]+Daily-note save blocked/,
  "every unaudited daily-note write must require the reviewed SOAP version",
);
assert.doesNotMatch(
  serviceSource,
  /setDoc\(dailyNoteDocument/,
  "daily notes must never bypass the revision-checked transaction with a direct setDoc",
);
assert.match(serviceSource, /delete persistablePatient\.persistedUpdatedAt/, "local revision metadata must never be persisted");

const deletePatientSource = serviceSource.slice(serviceSource.indexOf("export async function deletePatient"));
assert.match(deletePatientSource, /await Promise\.all\(/, "patient deletion must discover every target before writing");
assert.match(deletePatientSource, /getDoc\(patientRef\)/, "patient document must be included in discovery");
assert.match(deletePatientSource, /clinicalAuditEventsCollection[\s\S]+where\("patientId", "==", patientId\)/, "audit events must be discovered by patient id");
assert.match(deletePatientSource, /clinicalAuditPayloadsCollection[\s\S]+where\("patientId", "==", patientId\)/, "audit payloads must be discovered by patient id");
assert.match(deletePatientSource, /getDocs\(patientAiDraftsCollection\(uid, patientId\)\)/, "patient AI drafts must be discovered before deletion");
const discoveryIndex = deletePatientSource.indexOf("await Promise.all(");
const guardIndex = deletePatientSource.indexOf("if (limitReason)");
const batchIndex = deletePatientSource.indexOf("writeBatch(db)");
assert.ok(discoveryIndex >= 0 && discoveryIndex < guardIndex, "discovery must finish before the write-limit guard");
assert.ok(guardIndex >= 0 && guardIndex < batchIndex, "write-limit guard must run before batch construction");
assert.equal(
  (deletePatientSource.match(/writeBatch\(db\)/g) ?? []).length,
  1,
  "patient deletion must use exactly one Firestore write batch",
);
assert.match(deletePatientSource, /batch\.delete\(patientSnapshot\.ref\)/, "patient document must be batch-deleted");
assert.match(deletePatientSource, /batch\.delete\(noteSnapshot\.ref\)/, "daily notes must be batch-deleted");
assert.match(deletePatientSource, /batch\.delete\(eventSnapshot\.ref\)/, "audit events must be batch-deleted");
assert.match(deletePatientSource, /batch\.delete\(payloadSnapshot\.ref\)/, "audit payloads must be batch-deleted");
assert.match(deletePatientSource, /batch\.delete\(draftSnapshot\.ref\)/, "patient AI drafts must be batch-deleted");
assert.match(deletePatientSource, /await batch\.commit\(\)/, "the single delete batch must be committed once");
assert.doesNotMatch(deletePatientSource, /deleteDoc\(/, "patient deletion must not issue independent deletes");

console.log("OK Patient write-boundary, atomic-save, and atomic-delete regression");
