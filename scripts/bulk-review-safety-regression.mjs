import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "src/bulkReviewSafety.ts");
const helperSource = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  fileName: helperPath,
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { bulkReviewConflictReason, captureBulkReviewRevision } = await import(helperUrl);

const fakePatientA = {
  id: "fake-patient",
  updatedAt: "2026-07-27T01:00:00.000Z",
  persistedUpdatedAt: "2026-07-27T01:00:00.000Z",
};
const fakeNoteV1 = { soapVersion: 1, updatedAt: "2026-07-27T01:00:00.000Z" };
const reviewed = captureBulkReviewRevision(fakePatientA, fakeNoteV1, "2026-07-27");
assert.equal(bulkReviewConflictReason(reviewed, captureBulkReviewRevision(fakePatientA, fakeNoteV1, "2026-07-27")), "");
assert.match(
  bulkReviewConflictReason(
    reviewed,
    captureBulkReviewRevision(
      { ...fakePatientA, updatedAt: "2026-07-27T02:00:00.000Z", persistedUpdatedAt: "2026-07-27T02:00:00.000Z" },
      fakeNoteV1,
      "2026-07-27",
    ),
  ),
  /patient changed/i,
);
assert.match(
  bulkReviewConflictReason(
    reviewed,
    captureBulkReviewRevision(fakePatientA, { soapVersion: 2, updatedAt: "2026-07-27T02:00:00.000Z" }, "2026-07-27"),
  ),
  /daily note changed/i,
);
assert.match(
  bulkReviewConflictReason(reviewed, captureBulkReviewRevision(fakePatientA, undefined, "2026-07-27")),
  /daily note changed/i,
  "deleting a reviewed baseline note must invalidate the draft",
);
assert.match(
  bulkReviewConflictReason(reviewed, captureBulkReviewRevision(fakePatientA, fakeNoteV1, "2026-07-28")),
  /rounding date changed/i,
);

const boardSource = await readFile(path.join(repoRoot, "src/pages/PatientBoardPage.tsx"), "utf8");
assert.match(boardSource, /if \(!bulkConfirmed\)[\s\S]+Reconfirm that the reviewed bulk source is de-identified/);
assert.match(boardSource, /setBulkReviewRevisions\(captureReviewRevisions\(knowledgeDrafts\)\)/);
assert.match(boardSource, /bulkReviewConflictReason\(reviewedRevision, currentRevision\)/);
assert.match(boardSource, /expectedSoapVersion: reviewedRevision\?\.noteSoapVersion/);
assert.match(boardSource, /expectedPatientUpdatedAt: reviewedRevision\?\.patientUpdatedAt/);

console.log("OK Bulk Import reviewed patient/note revision binding regression");
