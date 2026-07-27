import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const boardSource = await readFile("src/pages/PatientBoardPage.tsx", "utf8");
const reviewStart = boardSource.indexOf("{bulkDrafts.map((draft) => (");
const reviewEnd = boardSource.indexOf("</article>", reviewStart);
assert.ok(reviewStart >= 0 && reviewEnd > reviewStart, "Bulk review card was not found");
const reviewCard = boardSource.slice(reviewStart, reviewEnd);

const persistedModelFields = [
  "bed",
  "patientCode",
  "age",
  "sex",
  "attending",
  "teamOrService",
  "primaryDiagnosis",
  "oneLiner",
  "chiefComplaint",
  "todayUpdates",
  "vitalSigns",
  "physicalExam",
  "labText",
  "imageText",
  "admissionSummary",
  "underlyingDiseases",
  "activeProblems",
  "hospitalCourseHighlights",
  "antibioticsProceduresConsults",
  "importantRedFlags",
  "dischargePlan",
  "disposition",
  "tasks",
];
for (const field of persistedModelFields) {
  assert.match(reviewCard, new RegExp(`draft\\.${field}\\b`), `${field} is persisted but not visible in the review card`);
}
assert.match(reviewCard, /Chief complaint[\s\S]*value=\{draft\.chiefComplaint\}/);
assert.match(reviewCard, /<pre>\{bulkReviewSources\[draft\.id\]/);
assert.doesNotMatch(reviewCard, /draft\.sourceExcerpt/, "model excerpts must not be labeled as original source");

console.log("OK Bulk review exposes persisted model fields and source-owned original text");
