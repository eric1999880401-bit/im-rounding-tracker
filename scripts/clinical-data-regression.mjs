import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(scriptDirectory, "../src/clinicalDataSafety.ts");
const helperSource = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: helperPath,
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  allPatientDailyNotesAreReady,
  clinicalDataSnapshotsAreReady,
  markDailyNotesSnapshotReady,
  normalizeOptionalDateKey,
  normalizePmhForExplicitWrite,
  normalizeSoapVersion,
  patientDailyNotesAreReady,
  recentDailyNotesOnOrBefore,
  reconcileDailyNotesReadiness,
  resolveCanonicalPmhText,
  resolveLegacyDailyNoteLabDate,
  retargetSoapDateHeader,
  snapshotIsServerConfirmed,
  sortDailyNotesDesc,
  sortPatientsByBed,
} = await import(helperUrl);

const patients = [
  { id: "legacy-z", bed: "" },
  { id: "bed-10", bed: "10B" },
  { id: "bed-2", bed: "2A" },
  { id: "legacy-a" },
];
assert.deepEqual(
  sortPatientsByBed(patients).map((patient) => patient.id),
  ["bed-2", "bed-10", "legacy-a", "legacy-z"],
  "patients missing a legacy bed field must remain visible and sort after numbered beds",
);
assert.equal(patients[0].id, "legacy-z", "sorting must not mutate the Firestore snapshot array");

const notes = [
  { date: "2026-07-24", updatedAt: "2026-07-24T10:00:00.000Z" },
  { date: "", updatedAt: "2026-07-27T10:00:00.000Z" },
  { date: "2026-07-27", updatedAt: "2026-07-27T10:00:00.000Z" },
  { date: "2026-07-26", updatedAt: "2026-07-26T10:00:00.000Z" },
  { date: "legacy-note", updatedAt: "2026-07-28T10:00:00.000Z" },
];
assert.deepEqual(
  sortDailyNotesDesc(notes).map((note) => note.date),
  ["2026-07-27", "2026-07-26", "2026-07-24", "legacy-note", ""],
  "daily notes must use explicit descending date order while retaining missing-date legacy rows",
);
assert.deepEqual(
  recentDailyNotesOnOrBefore([...notes].reverse(), "2026-07-26", 2).map((note) => note.date),
  ["2026-07-26", "2026-07-24"],
  "recent-note selection must not depend on incoming snapshot order",
);

const readiness = reconcileDailyNotesReadiness({ existing: true, removed: true }, ["existing", "new-patient"]);
assert.deepEqual(readiness, { existing: true, "new-patient": false });
assert.equal(patientDailyNotesAreReady(readiness, "existing"), true);
assert.equal(patientDailyNotesAreReady(readiness, "new-patient"), false);
assert.equal(patientDailyNotesAreReady(readiness, "unknown"), false);

assert.equal(resolveLegacyDailyNoteLabDate("2026-07-12", undefined), "2026-07-12");
assert.equal(resolveLegacyDailyNoteLabDate("2026-07-12", ""), "2026-07-12");
assert.equal(resolveLegacyDailyNoteLabDate("2026-07-12", "2026/7/11"), "2026-07-11");
assert.equal(resolveLegacyDailyNoteLabDate("2026-07-12", "not-a-date"), "2026-07-12");
assert.equal(normalizeOptionalDateKey(undefined), "", "missing patient-master lab date must stay missing");
assert.equal(normalizeOptionalDateKey("not-a-date"), "", "invalid patient-master lab date must not become today");
assert.equal(normalizeOptionalDateKey("2026/7/11"), "2026-07-11");
assert.equal(normalizeSoapVersion(4.9), 4, "SOAP revisions must be positive integers");
assert.equal(normalizeSoapVersion(0), 1);
assert.equal(normalizeSoapVersion(-2), 1);
assert.equal(normalizeSoapVersion(Number.NaN), 1);
assert.equal(normalizeSoapVersion(Number.POSITIVE_INFINITY), 1);
assert.equal(
  resolveCanonicalPmhText("T2DM, CKD3", "legacy HTN"),
  "T2DM, CKD3",
  "canonical PHx must win over a stale legacy admissionPMH value",
);
assert.equal(
  resolveCanonicalPmhText("", "legacy CKD3, AF"),
  "legacy CKD3, AF",
  "legacy admissionPMH must remain visible when the canonical PHx field is absent",
);
assert.deepEqual(
  normalizePmhForExplicitWrite("", "legacy CKD3, AF"),
  { underlyingDiseases: "", admissionPMH: "" },
  "an explicit canonical PHx clear must not be repopulated from a stale legacy alias",
);

const yesterdaySoap = [
  "Dx: Fake pneumonia",
  "Date: 2026-07-26",
  "S:",
  "- Patient stated Date: uncertain in copied narrative.",
  "O:",
  "- No new objective data.",
  "A/P:",
  "# Fake pneumonia",
  "- Continue fake-data monitoring.",
].join("\n");
const retargetedSoap = retargetSoapDateHeader(yesterdaySoap, "2026-07-27");
assert.equal(
  retargetedSoap,
  yesterdaySoap.replace("Date: 2026-07-26", "Date: 2026-07-27"),
  "DITTO must change only the exact SOAP Date header",
);
assert.match(retargetedSoap, /Patient stated Date: uncertain/, "narrative Date text must remain verbatim");

const patientServiceSource = await readFile(path.resolve(scriptDirectory, "../src/firebase/patientService.ts"), "utf8");
assert.match(patientServiceSource, /const patientLabDate = normalizeOptionalDateKey\(data\.labDate\)/);
assert.match(
  patientServiceSource,
  /useLegacyPmhFallback[\s\S]*resolveCanonicalPmhText\(data\.underlyingDiseases, data\.admissionPMH\)/,
  "patient normalization must expose legacy admissionPMH through the canonical PHx field",
);
assert.match(
  patientServiceSource,
  /normalizePatient\(patient\.id, patient, false\)/,
  "write serialization must not run the read-time legacy PMH fallback",
);
assert.match(patientServiceSource, /normalizePmhForExplicitWrite\(patient\.underlyingDiseases, patient\.admissionPMH\)/);
assert.match(patientServiceSource, /soapVersion:\s*normalizeSoapVersion\(data\.soapVersion\)/);
assert.doesNotMatch(
  patientServiceSource,
  /labDate:\s*normalizeDateKey\(data\.labDate\)/,
  "patient normalization must not apply normalizeDateKey's today fallback",
);
const datesSource = await readFile(path.resolve(scriptDirectory, "../src/dates.ts"), "utf8");
assert.match(
  datesSource,
  /const normalized = normalizeDateKey\(dateKey, ""\)/,
  "display formatting must not turn an absent clinical date into today",
);

const patientFormSource = await readFile(path.resolve(scriptDirectory, "../src/components/PatientForm.tsx"), "utf8");
assert.match(patientFormSource, /value=\{patient\.underlyingDiseases\}/);
assert.match(patientFormSource, /underlyingDiseaseItems:\s*textToItems\(value\)/);
assert.match(patientFormSource, /admissionPMH:\s*value/);
const admissionBriefSource = await readFile(path.resolve(scriptDirectory, "../src/components/AdmissionBriefForm.tsx"), "utf8");
assert.match(admissionBriefSource, /PHx \/ PMH[\s\S]*value=\{patient\.underlyingDiseases\}/);
assert.match(admissionBriefSource, /underlyingDiseaseItems:\s*textToItems\(value\)/);
assert.match(admissionBriefSource, /admissionPMH:\s*value/);
const patientDetailSource = await readFile(path.resolve(scriptDirectory, "../src/pages/PatientDetailPage.tsx"), "utf8");
assert.match(patientDetailSource, /function updateUnderlyingDiseases[\s\S]*admissionPMH:\s*value/);
const boardSource = await readFile(path.resolve(scriptDirectory, "../src/pages/PatientBoardPage.tsx"), "utf8");
const addPatientStart = boardSource.indexOf("{showForm && (");
const addPatientEnd = boardSource.indexOf("<details", addPatientStart);
assert.ok(addPatientStart >= 0 && addPatientEnd > addPatientStart, "Add Patient form was not found");
const addPatientForm = boardSource.slice(addPatientStart, addPatientEnd);
assert.match(addPatientForm, /showPmhField=\{true\}/, "Add Patient must expose the canonical PHx field");
assert.match(addPatientForm, /showHistoryFields=\{false\}/, "Adding PHx must not expose unrelated history fields");
const printSource = await readFile(path.resolve(scriptDirectory, "../src/pages/PrintRoundingListPage.tsx"), "utf8");
assert.match(printSource, /PHx \/ PMH[\s\S]*getPatientPmhText\(patient\)/);
const patientModelSource = await readFile(path.resolve(scriptDirectory, "../src/patientModel.ts"), "utf8");
assert.match(patientModelSource, /underlyingDiseaseItems[\s\S]*underlyingDiseases[\s\S]*admissionPMH/);
const cleanupSource = await readFile(path.resolve(scriptDirectory, "../scripts/cleanup-patients.mjs"), "utf8");
assert.match(cleanupSource, /function sameDiseaseIdentity/);
assert.match(cleanupSource, /function heartFailureIdentity/);
const { planPmhCleanup } = await import(pathToFileURL(path.resolve(scriptDirectory, "../scripts/cleanup-patients.mjs")).href);
const dirtyPmhCleanup = planPmhCleanup({
  underlyingDiseases: "HTN, myasthenia gravis",
  underlyingDiseaseItems: ["HTN", "hypertension"],
  admissionPMH: "old CVA",
});
assert.equal(dirtyPmhCleanup.changed, true);
assert.equal(dirtyPmhCleanup.underlyingDiseases, "HTN, myasthenia gravis, old CVA");
assert.deepEqual(dirtyPmhCleanup.underlyingDiseaseItems, ["HTN", "myasthenia gravis", "old CVA"]);
assert.equal(
  planPmhCleanup({
    underlyingDiseases: dirtyPmhCleanup.underlyingDiseases,
    underlyingDiseaseItems: dirtyPmhCleanup.underlyingDiseaseItems,
    admissionPMH: "old CVA",
  }).changed,
  false,
  "cleanup write planning must be idempotent even while a legacy alias remains",
);
assert.equal(
  planPmhCleanup({ underlyingDiseases: "type 2 DM, DM", underlyingDiseaseItems: [] }).underlyingDiseases,
  "type 2 DM",
  "cleanup must collapse the DM alias without discarding the more specific type 2 qualifier",
);

const cacheOnly = markDailyNotesSnapshotReady(readiness, "new-patient", {
  fromCache: true,
  hasPendingWrites: false,
});
assert.equal(patientDailyNotesAreReady(cacheOnly, "new-patient"), false);
assert.equal(clinicalDataSnapshotsAreReady(true, cacheOnly, ["existing", "new-patient"]), false);
const pendingWriteSnapshot = markDailyNotesSnapshotReady(cacheOnly, "new-patient", {
  fromCache: false,
  hasPendingWrites: true,
});
assert.equal(patientDailyNotesAreReady(pendingWriteSnapshot, "new-patient"), false);
assert.equal(snapshotIsServerConfirmed({ fromCache: false, hasPendingWrites: true }), false);
const firstServerSnapshot = markDailyNotesSnapshotReady(pendingWriteSnapshot, "new-patient", {
  fromCache: false,
  hasPendingWrites: false,
});
assert.equal(snapshotIsServerConfirmed({ fromCache: false, hasPendingWrites: false }), true);
assert.equal(patientDailyNotesAreReady(firstServerSnapshot, "new-patient"), true);
assert.equal(allPatientDailyNotesAreReady(firstServerSnapshot, ["existing", "new-patient"]), true);
assert.equal(clinicalDataSnapshotsAreReady(false, firstServerSnapshot, ["existing", "new-patient"]), false);
assert.equal(clinicalDataSnapshotsAreReady(true, firstServerSnapshot, ["existing", "new-patient"]), true);
assert.equal(clinicalDataSnapshotsAreReady(true, {}, []), true);

console.log("OK clinical data loading regression");
