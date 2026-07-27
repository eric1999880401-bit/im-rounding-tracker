import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "src/aiDocumentPersistence.ts");
const helperSource = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  fileName: helperPath,
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { reviewedAiDocumentPatientPatch } = await import(helperUrl);

const finalText = "Reviewed final document; rejected candidate facts removed.";
const updatedAt = "2026-07-27T00:00:00.000Z";
const forbiddenHiddenFields = [
  "oneLiner",
  "chiefComplaint",
  "admissionChiefConcern",
  "presentIllnessOrHPI",
  "hpiOrAdmissionStory",
  "hospitalCourseHighlights",
];

const expectedKeys = {
  admissionNote: ["admissionBriefNotes", "generatedAdmissionNote", "updatedAt"],
  admissionSummary: ["admissionBriefFreeText", "generatedAdmissionSummary", "updatedAt"],
  dischargeHospitalCourse: ["generatedDischargeSummary", "updatedAt"],
  weeklySummary: ["generatedWeeklySummary", "updatedAt"],
  isbar: ["generatedSbarNote", "updatedAt"],
};

for (const [documentType, keys] of Object.entries(expectedKeys)) {
  const patch = reviewedAiDocumentPatientPatch(documentType, finalText, updatedAt);
  assert.deepEqual(Object.keys(patch).sort(), [...keys].sort(), `${documentType} wrote a hidden field`);
  assert.equal(patch.updatedAt, updatedAt);
  for (const key of keys.filter((key) => key !== "updatedAt")) assert.equal(patch[key], finalText);
  for (const key of forbiddenHiddenFields) assert.equal(key in patch, false, `${documentType} persisted hidden ${key}`);
}

const pageSource = await readFile(path.join(repoRoot, "src/pages/AiDocumentsPage.tsx"), "utf8");
const saveBody = pageSource.slice(
  pageSource.indexOf("async function saveReviewedDraft"),
  pageSource.indexOf("return (", pageSource.indexOf("async function saveReviewedDraft")),
);
assert.match(saveBody, /reviewedAiDocumentPatientPatch\(saveDocumentType, editableText, now\)/);
assert.doesNotMatch(saveBody, /draft\.conciseSummary|getClinicalDocumentSection\(draft|hospitalCourseHighlights\s*=/);

console.log("OK AI Documents persists only clinician-visible final text (fake data only)");
