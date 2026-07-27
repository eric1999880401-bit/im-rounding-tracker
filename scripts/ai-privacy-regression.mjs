import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const helperPath = path.join(repoRoot, "src/aiPrivacyConfirmation.ts");
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
  bindDeidentifiedConfirmation,
  createAiPrivacyContextFingerprint,
  isDeidentifiedConfirmationCurrent,
} = await import(helperUrl);

const fakeSource = "Bed DEMO-01: fever improved; repeat fake CBC tomorrow.";
const fakePatient = {
  id: "fake-patient-1",
  age: 67,
  sex: "F",
  activeProblems: "Fake pneumonia",
};
const initialFingerprint = createAiPrivacyContextFingerprint(fakeSource, fakePatient, "2026-07-27");
assert.equal(isDeidentifiedConfirmationCurrent("", initialFingerprint), false, "confirmation must default to unchecked");

const confirmedFingerprint = bindDeidentifiedConfirmation(true, initialFingerprint);
assert.equal(isDeidentifiedConfirmationCurrent(confirmedFingerprint, initialFingerprint), true);
assert.equal(
  isDeidentifiedConfirmationCurrent(
    confirmedFingerprint,
    createAiPrivacyContextFingerprint(`${fakeSource} K 5.8`, fakePatient, "2026-07-27"),
  ),
  false,
  "changing pasted source must invalidate confirmation",
);
assert.equal(
  isDeidentifiedConfirmationCurrent(
    confirmedFingerprint,
    createAiPrivacyContextFingerprint(fakeSource, { ...fakePatient, id: "fake-patient-2" }, "2026-07-27"),
  ),
  false,
  "changing patient must invalidate confirmation",
);
assert.equal(
  createAiPrivacyContextFingerprint({ b: 2, a: 1 }),
  createAiPrivacyContextFingerprint({ a: 1, b: 2 }),
  "object key order must not create a false context change",
);

const uiFiles = [
  "src/components/AdmissionBriefForm.tsx",
  "src/pages/AiDocumentsPage.tsx",
  "src/components/ClinicalDocumentQuickActions.tsx",
  "src/components/AiIntakePanel.tsx",
  "src/components/RoundSoapComposer.tsx",
];
for (const relativePath of uiFiles) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  assert.doesNotMatch(source, /deidentifiedConfirmed\s*:\s*true\b/, `${relativePath} must not hardcode privacy confirmation`);
  assert.match(source, /isDeidentifiedConfirmationCurrent/, `${relativePath} must bind confirmation to current context`);
}

const roundSoapSource = await readFile(path.join(repoRoot, "src/components/RoundSoapComposer.tsx"), "utf8");
assert.match(roundSoapSource, /const privacyContextFingerprint = createAiPrivacyContextFingerprint\(/);
assert.match(roundSoapSource, /sourceText: rawText,/m, "generation source must remain available in component memory until Save");
assert.match(
  roundSoapSource,
  /sourceText: storeSourceInAudit \? capturedEditOrigin\.sourceText \?\? "" : ""/,
  "the retention checkbox state at commit must be authoritative",
);
assert.doesNotMatch(
  roundSoapSource,
  /sourceText: storeSourceInAudit \? rawText : ""/,
  "generation-time retention choice must not be captured as irrevocable consent",
);

const functionsSource = await readFile(path.join(repoRoot, "functions/src/index.ts"), "utf8");
assert.doesNotMatch(
  functionsSource,
  /Failed to parse OpenAI[^\n]+[\s\S]{0,120}\{\s*error\s*\}/,
  "malformed AI JSON errors must not log Error objects that can embed clinical output excerpts",
);
const guardedPreviewAssignments = functionsSource.match(
  /const rawTextPreview = storeRawText \? rawText\.slice\(0, 700\) : "";/g,
) ?? [];
assert.equal(guardedPreviewAssignments.length, 2, "both persisted AI draft paths must suppress previews when raw storage is off");
for (const match of functionsSource.matchAll(
  /const rawTextPreview = storeRawText \? rawText\.slice\(0, 700\) : "";/g,
)) {
  const nearbyPersistence = functionsSource.slice(match.index, match.index + 500);
  assert.match(
    nearbyPersistence,
    /rawTextChars: rawText\.length,/,
    "each privacy-guarded persisted draft should retain only a non-content character count by default",
  );
}

console.log("OK AI privacy confirmation and raw preview regression");
