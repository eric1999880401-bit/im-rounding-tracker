import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
  normalizeSoapVersion,
  patientDailyNotesAreReady,
  recentDailyNotesOnOrBefore,
  reconcileDailyNotesReadiness,
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
