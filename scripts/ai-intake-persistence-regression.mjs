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

const { AI_INTAKE_REVIEW_CARD_DESTINATIONS } = await importTypeScriptModule("src/aiIntakePersistence.ts");
const { pickAiIntakePatientPatch } = await importTypeScriptModule("src/patientWriteSafety.ts");

const expectedReviewKinds = [
  "oneLiner",
  "admissionSummary",
  "isbarHandoff",
  "chiefConcern",
  "symptom",
  "importantSymptom",
  "overnightEvent",
  "importantOvernightEvent",
  "vital",
  "bloodSugar",
  "physicalExam",
  "lab",
  "image",
  "assessmentPlan",
  "redFlag",
  "task",
  "dischargeIssue",
  "thinkingPrompt",
  "uncertainty",
];
assert.deepEqual(
  Object.keys(AI_INTAKE_REVIEW_CARD_DESTINATIONS),
  expectedReviewKinds,
  "every AI Intake review-card kind must have an explicit persistence destination",
);
assert.deepEqual(
  AI_INTAKE_REVIEW_CARD_DESTINATIONS.dischargeIssue,
  ["patient.dischargeBarriers", "dailyNote.dischargePlan"],
  "accepted discharge issues must be date-scoped as well as retained in the patient compatibility field",
);
assert.deepEqual(
  AI_INTAKE_REVIEW_CARD_DESTINATIONS.thinkingPrompt,
  ["patient.aiThinkingPrompts"],
  "AI questions must not be mislabeled as a clinician SOAP plan",
);
assert.deepEqual(AI_INTAKE_REVIEW_CARD_DESTINATIONS.uncertainty, ["patient.aiThinkingPrompts"]);
assert.deepEqual(
  AI_INTAKE_REVIEW_CARD_DESTINATIONS.assessmentPlan,
  ["soapPreview.assessmentPlan"],
  "A/P must remain a single SOAP-preview review rather than independent cards",
);

const fakeAiCandidate = {
  id: "fake-ai-intake-patient",
  bed: "SHOULD-NOT-WRITE",
  patientCode: "SHOULD-NOT-WRITE",
  oneLiner: "Fake one-liner",
  admissionBriefFreeText: "Fake reviewed admission summary",
  generatedAdmissionSummary: "Fake reviewed admission summary",
  generatedSbarNote: "Fake reviewed iSBAR",
  importantRedFlags: "!Fake red flag",
  overnightEvent: "Fake overnight event",
  subjectiveOrChiefConcern: "Fake symptom",
  vitalSigns: "Fake V/S",
  bloodSugar: "Fake glucose",
  physicalExam: "Fake exam",
  newLabs: "Fake lab",
  rawLabText: "Fake raw lab",
  labReports: [{ id: "fake-lab-report", date: "2026-07-27", title: "Fake", rawText: "Fake", items: [] }],
  parsedLabItems: [{ id: "fake-lab", label: "Fake", value: "1" }],
  newImaging: "Fake image",
  physicalExamEntries: [{ id: "fake-pe", date: "2026-07-27", system: "Fake", finding: "Fake", isImportant: false, color: "", note: "" }],
  imageStudyEntries: [{ id: "fake-img", date: "2026-07-27", studyType: "Fake", finding: "Fake", impression: "Fake", isImportant: false, color: "", note: "" }],
  dischargeBarriers: "Fake discharge barrier",
  tasks: [{ id: "fake-task", text: "Fake task", done: false, priority: "normal", category: "other", dueDate: "", createdAt: "2026-07-27T00:00:00.000Z", completedAt: "" }],
  aiThinkingPrompts: [{ id: "fake-prompt", prompt: "Clarify fake datum", reason: "Fake uncertainty", kind: "thinkingPrompt", createdAt: "2026-07-27T00:00:00.000Z" }],
  updatedAt: "2026-07-27T01:00:00.000Z",
};
const persistedPatch = pickAiIntakePatientPatch(fakeAiCandidate);
const expectedPatientFields = [...new Set(
  Object.values(AI_INTAKE_REVIEW_CARD_DESTINATIONS)
    .flat()
    .filter((destination) => destination.startsWith("patient."))
    .map((destination) => destination.slice("patient.".length)),
)];
for (const field of expectedPatientFields) {
  assert.ok(
    Object.hasOwn(persistedPatch, field),
    `accepted fake AI Intake field ${field} must survive the atomic patient allowlist`,
  );
}
assert.equal(persistedPatch.bed, undefined, "bed must not hitchhike on an AI Intake daily-note transaction");
assert.equal(persistedPatch.patientCode, undefined, "patient identity must not hitchhike on an AI Intake transaction");

const intakeSource = await readFile(path.join(repoRoot, "src/components/AiIntakePanel.tsx"), "utf8");
assert.match(
  intakeSource,
  /setTextPatch\("dischargePlan", dischargeIssueLines\)/,
  "accepted discharge issues must be included in the DailyNote patch",
);
assert.match(
  intakeSource,
  /aiThinkingPrompts:\s*mergeThinkingPrompts/,
  "accepted thinking prompts and uncertainty must be retained in the patient candidate",
);
assert.doesNotMatch(
  intakeSource,
  /addCard\([^\n]+"assessmentPlan"/,
  "A/P must not regress to independently accepted review cards",
);
assert.doesNotMatch(
  intakeSource,
  /saved to this patient and today's SOAP note/,
  "success copy must not claim that patient-only review cards were written into SOAP",
);

const detailSource = await readFile(path.join(repoRoot, "src/pages/PatientDetailPage.tsx"), "utf8");
assert.match(
  detailSource,
  /patientPatch:\s*pickAiIntakePatientPatch\(safeNextPatient\)/,
  "AI Intake patient fields and the DailyNote must share the guarded atomic transaction",
);
const dailyNoteBuilder = detailSource.slice(
  detailSource.indexOf("function buildAiAcceptedDailyNote"),
  detailSource.indexOf("async function applyAiIntakePatient"),
);
assert.equal(
  (dailyNoteBuilder.match(/"dischargePlan"/g) ?? []).length,
  2,
  "PatientDetail must allow and merge dischargePlan in the accepted date-scoped DailyNote",
);

console.log("OK AI Intake review-card persistence regression (fake data only)");
