import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "functions/src/rawTextRetention.ts");
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
  AI_DRAFT_RAW_TEXT_RETENTION_DAYS,
  buildAiDraftRawTextRetention,
} = await import(helperUrl);

const fakeNow = Date.UTC(2026, 6, 27, 0, 0, 0);
const fakeRawText = "FAKE PATIENT: fever improved; repeat CBC tomorrow.";
assert.equal(AI_DRAFT_RAW_TEXT_RETENTION_DAYS, 30);
assert.deepEqual(
  buildAiDraftRawTextRetention(fakeRawText, false, fakeNow),
  {},
  "raw source and expiry must both be absent when retention is not selected",
);
const retained = buildAiDraftRawTextRetention(fakeRawText, true, fakeNow);
assert.equal(retained.rawText, fakeRawText);
assert.equal(
  retained.rawTextExpiresAt?.getTime(),
  fakeNow + 30 * 24 * 60 * 60 * 1_000,
  "opted-in raw source must expire exactly 30 days after persistence",
);

const functionsSource = await readFile(path.join(repoRoot, "functions/src/index.ts"), "utf8");
const retentionWrites = functionsSource.match(
  /\.\.\.buildAiDraftRawTextRetention\(rawText, storeRawText\),/g,
) ?? [];
assert.equal(retentionWrites.length, 2, "both persisted AI draft write paths must attach the 30-day expiry");
assert.match(functionsSource, /collectionGroup\("clinicalAuditPayloads"\)/, "audit payload cleanup must remain enabled");
assert.match(functionsSource, /collectionGroup\("aiDrafts"\)/, "scheduled cleanup must scan all AI draft locations");
assert.match(functionsSource, /where\("rawTextExpiresAt", "<=", new Date\(\)\)/);
for (const field of ["rawText", "rawTextPreview", "rawTextExpiresAt"]) {
  assert.match(
    functionsSource,
    new RegExp(`${field}: FieldValue\\.delete\\(\\)`),
    `scheduled cleanup must remove ${field}`,
  );
}
assert.match(functionsSource, /AI_DRAFT_RAW_TEXT_PURGE_MAX_BATCHES/);
assert.match(functionsSource, /AI_DRAFT_RAW_TEXT_PURGE_BATCH_SIZE/);
assert.match(functionsSource, /where\("createdAt", "<=", expiredDraftCutoff\)/, "legacy AI drafts must be swept by server createdAt");
assert.match(functionsSource, /deletedExpiredAiDrafts/);
assert.match(functionsSource, /EXPIRED_AI_DRAFT_PURGE_MAX_BATCHES/);

const firebaseConfig = JSON.parse(await readFile(path.join(repoRoot, "firebase.json"), "utf8"));
assert.equal(firebaseConfig.firestore?.indexes, "firestore.indexes.json");
const firestoreIndexes = JSON.parse(await readFile(path.join(repoRoot, "firestore.indexes.json"), "utf8"));
for (const [collectionGroup, fieldPath] of [
  ["clinicalAuditPayloads", "expiresAt"],
  ["aiDrafts", "rawTextExpiresAt"],
  ["aiDrafts", "createdAt"],
]) {
  const fieldOverride = firestoreIndexes.fieldOverrides?.find(
    (entry) => entry.collectionGroup === collectionGroup && entry.fieldPath === fieldPath,
  );
  assert.ok(fieldOverride, `${collectionGroup}.${fieldPath} must have an explicit collection-group index`);
  assert.ok(
    fieldOverride.indexes?.some(
      (entry) => entry.queryScope === "COLLECTION_GROUP" && entry.order === "ASCENDING",
    ),
    `${collectionGroup}.${fieldPath} must support the scheduled <= expiry query`,
  );
  if (collectionGroup === "clinicalAuditPayloads" && fieldPath === "expiresAt") {
    assert.ok(
      fieldOverride.indexes?.some(
        (entry) => entry.queryScope === "COLLECTION" && entry.order === "ASCENDING",
      ),
      "clinicalAuditPayloads.expiresAt must also support the signed-in client collection cleanup query",
    );
  }
}

console.log("OK AI draft raw-source 30-day retention and bounded scheduled cleanup regression");
