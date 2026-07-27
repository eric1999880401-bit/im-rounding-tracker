import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");

async function importTypeScriptModule(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(moduleUrl);
}

const { applyVisibleAdmissionSummaryEdit } = await importTypeScriptModule("src/admissionBriefPersistence.ts");

const fakePatient = {
  id: "fake-admission-patient",
  oneLiner: "",
  chiefComplaint: "",
  admissionChiefConcern: "",
  presentIllnessOrHPI: "",
  hpiOrAdmissionStory: "",
  admissionPMH: "",
  initialLabs: "",
  initialImaging: "",
  generatedAdmissionSummary: "older generated summary",
  admissionBriefFreeText: "older clinician-reviewed summary",
  showAdmissionBriefOnPrint: false,
  updatedAt: "2026-07-27T01:00:00.000Z",
};
const reviewedSummary = "Fake reviewed admission summary; no patient identifiers.";
const savedAt = "2026-07-27T02:00:00.000Z";
const nextPatient = applyVisibleAdmissionSummaryEdit(fakePatient, reviewedSummary, savedAt);

assert.notEqual(nextPatient, fakePatient, "visible edit must produce a new patient draft");
assert.equal(nextPatient.admissionBriefFreeText, reviewedSummary);
assert.equal(nextPatient.updatedAt, savedAt);
assert.deepEqual(
  Object.keys(nextPatient).filter((field) => nextPatient[field] !== fakePatient[field]).sort(),
  ["admissionBriefFreeText", "updatedAt"],
  "Admission Summary generation may change only the visible summary and revision timestamp",
);
assert.equal(nextPatient.showAdmissionBriefOnPrint, false, "generation must preserve the clinician's print preference");
assert.equal(nextPatient.generatedAdmissionSummary, "older generated summary", "hidden generated-summary history must not be overwritten");

const formSource = await readFile(path.join(repoRoot, "src/components/AdmissionBriefForm.tsx"), "utf8");
assert.match(formSource, /applyVisibleAdmissionSummaryEdit\(currentPatientRef\.current, (?:summary|fallbackSummary)\)/);
assert.doesNotMatch(formSource, /showAdmissionBriefOnPrint:\s*true/);
assert.doesNotMatch(formSource, /oneLiner:\s*basePatient|initialLabs:\s*basePatient|initialImaging:\s*basePatient/);

console.log("OK Admission Brief visible-field persistence regression (fake data only)");
