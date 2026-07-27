import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "src/bulkSourceBinding.ts");
const helperSource = await readFile(helperPath, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  fileName: helperPath,
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  assignUniqueBulkReviewIds,
  splitBulkPatientSourceBlocks,
  uniquelyBoundBulkSourceChunk,
} = await import(helperUrl);

const chunks = [
  "Bed A-01 | Code FAKE-A\nK 6.1; repeat K and ECG",
  "Bed B-02 | Code FAKE-B\nHb 6.8; prepare transfusion review",
];
const modelDraftWithSwappedIndex = { bed: "A-01", patientCode: "FAKE-A", sourceIndex: 1 };
assert.equal(
  uniquelyBoundBulkSourceChunk(chunks, modelDraftWithSwappedIndex),
  chunks[0],
  "model-swapped sourceIndex must not attach patient B source to patient A audit",
);
assert.equal(
  uniquelyBoundBulkSourceChunk([chunks[0], chunks[0]], modelDraftWithSwappedIndex),
  "",
  "ambiguous duplicate identity must not produce an exact audit source",
);
assert.equal(
  uniquelyBoundBulkSourceChunk(chunks, { bed: "", patientCode: "" }),
  "",
  "source without source-owned identity must not be guessed",
);
assert.equal(
  uniquelyBoundBulkSourceChunk(chunks, { bed: "A-01", patientCode: "INVENTED" }),
  "",
  "a model-invented second identity must invalidate source binding",
);

const paragraphSource = [
  "Bed A-01 | Code FAKE-A",
  "",
  "V/S: BP 96/58, SpO2 91% on NC 3 L/min",
  "",
  "Lab: K 6.1; repeat K and ECG",
  "",
  "Bed B-02 | Code FAKE-B",
  "Course: Hb 6.8; prepare transfusion review",
].join("\n");
const paragraphBlocks = splitBulkPatientSourceBlocks(paragraphSource);
assert.equal(paragraphBlocks.length, 2, "internal blank paragraphs must not become patient boundaries");
assert.match(paragraphBlocks[0], /V\/S: BP 96\/58/);
assert.match(paragraphBlocks[0], /Lab: K 6\.1/);
assert.doesNotMatch(paragraphBlocks[0], /FAKE-B/);
assert.match(paragraphBlocks[1], /FAKE-B/);

const duplicateModelIds = assignUniqueBulkReviewIds([
  { id: "model-duplicate", bed: "A-01" },
  { id: "model-duplicate", bed: "B-02" },
]);
assert.deepEqual(duplicateModelIds.map((draft) => draft.id), ["bulk-review-1", "bulk-review-2"]);
assert.equal(new Set(duplicateModelIds.map((draft) => draft.id)).size, 2);

const chineseWardSource = [
  "床: A01 | Code FAKE-A",
  "Lab: K 6.1; repeat K",
  "床號：B02 | Code FAKE-B",
  "Lab: Hb 6.8; review transfusion threshold",
].join("\n");
const chineseBlocks = splitBulkPatientSourceBlocks(chineseWardSource);
assert.equal(chineseBlocks.length, 2, "Chinese bed headers must form exact per-patient source blocks");
const chineseDrafts = [
  { bed: "A01", patientCode: "FAKE-A" },
  { bed: "B02", patientCode: "FAKE-B" },
];
assert.equal(uniquelyBoundBulkSourceChunk(chineseBlocks, chineseDrafts[0], chineseDrafts), chineseBlocks[0]);
assert.equal(uniquelyBoundBulkSourceChunk(chineseBlocks, chineseDrafts[1], chineseDrafts), chineseBlocks[1]);
assert.equal(
  uniquelyBoundBulkSourceChunk([chineseWardSource], chineseDrafts[0], chineseDrafts),
  "",
  "an unsplit source containing another reviewed patient identity must be rejected",
);

const boardSource = await readFile(path.join(repoRoot, "src/pages/PatientBoardPage.tsx"), "utf8");
assert.match(boardSource, /uniquelyBoundBulkSourceChunk\(sourceChunks, draft, drafts\)/);
assert.match(boardSource, /assignUniqueBulkReviewIds\(drafts/);
assert.match(boardSource, /const sourceText = bulkReviewSources\[draft\.id\] \?\? ""/);
assert.doesNotMatch(boardSource, /sourceChunks\[draft\.sourceIndex\]/);
assert.doesNotMatch(
  boardSource.slice(boardSource.indexOf("async function createSelectedBulkDrafts")),
  /draft\.sourceExcerpt\.trim\(\)/,
  "model-generated excerpts must not be persisted as exact audit source",
);

console.log("OK Bulk Import exact-source binding ignores model sourceIndex/excerpt");
