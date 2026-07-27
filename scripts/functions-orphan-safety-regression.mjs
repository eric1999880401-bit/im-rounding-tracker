import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [functionsSource, firestoreIndexesSource] = await Promise.all([
  readFile("functions/src/index.ts", "utf8"),
  readFile("firestore.indexes.json", "utf8"),
]);

const atomicDraftHelper = functionsSource.slice(
  functionsSource.indexOf("async function createPatientAiDraftAtomically"),
  functionsSource.indexOf("export const purgeExpiredClinicalAuditPayloads"),
);
assert.match(atomicDraftHelper, /db\.runTransaction\(/, "patient-bound AI drafts must use a transaction");
assert.match(atomicDraftHelper, /transaction\.get\(patientRef\)/, "the transaction must re-read the patient");
assert.match(atomicDraftHelper, /if \(!latestPatient\.exists\)/, "a deleted patient must block the draft write");
assert.match(atomicDraftHelper, /transaction\.create\(draftRef, draftData\)/, "the draft create must be atomic with the patient read");
assert.equal(
  (functionsSource.match(/createPatientAiDraftAtomically\(patientRef, draftRef,/g) ?? []).length,
  2,
  "AI Intake and patient-bound AI Documents must both use the atomic draft helper",
);

const pollSource = functionsSource.slice(
  functionsSource.indexOf("export const pollRoundSoapGeneration"),
  functionsSource.indexOf("export const analyzeClinicalText"),
);
const firstPatientCheck = pollSource.indexOf("const jobPatientSnapshot = await jobPatientRef.get()");
const responseRetrieval = pollSource.indexOf("await retrieveOpenAiResponse");
assert.ok(firstPatientCheck >= 0 && firstPatientCheck < responseRetrieval, "polling must reject a deleted patient before retrieving AI output");
assert.match(pollSource, /if \(!jobPatientSnapshot\.exists\)[\s\S]*await jobRef\.delete\(\)[\s\S]*"not-found"/);
assert.match(
  pollSource,
  /db\.runTransaction\([\s\S]*transaction\.get\(jobPatientRef\)[\s\S]*transaction\.delete\(jobRef\)[\s\S]*"patient-missing"/,
  "completed output must atomically re-check the patient while consuming the job",
);

assert.match(functionsSource, /collectionGroup\("aiJobs"\)/, "the scheduler must scan orphanable background jobs");
assert.match(functionsSource, /where\("expiresAt", "<=", new Date\(\)\)/);
assert.match(functionsSource, /EXPIRED_AI_JOB_PURGE_BATCH_SIZE/);
assert.match(functionsSource, /EXPIRED_AI_JOB_PURGE_MAX_BATCHES/);
assert.match(functionsSource, /deletedExpiredAiJobs/);

const firestoreIndexes = JSON.parse(firestoreIndexesSource);
const aiJobExpiryIndex = firestoreIndexes.fieldOverrides?.find(
  (entry) => entry.collectionGroup === "aiJobs" && entry.fieldPath === "expiresAt",
);
assert.ok(aiJobExpiryIndex, "aiJobs.expiresAt must have a collection-group index");
assert.ok(
  aiJobExpiryIndex.indexes?.some(
    (entry) => entry.queryScope === "COLLECTION_GROUP" && entry.order === "ASCENDING",
  ),
  "the scheduled aiJobs expiry query requires an ascending collection-group index",
);

console.log("OK Functions patient-deletion race and expired aiJob cleanup regression");
