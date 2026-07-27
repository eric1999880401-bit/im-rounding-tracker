import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [rules, service, composer, detail, auditBuilder, aiDocuments, app] = await Promise.all([
  readFile("firestore.rules", "utf8"),
  readFile("src/firebase/clinicalAuditService.ts", "utf8"),
  readFile("src/components/RoundSoapComposer.tsx", "utf8"),
  readFile("src/pages/PatientDetailPage.tsx", "utf8"),
  readFile("src/clinicalAudit.ts", "utf8"),
  readFile("src/pages/AiDocumentsPage.tsx", "utf8"),
  readFile("src/App.tsx", "utf8"),
]);

assert.doesNotMatch(rules, /match\s+\/\{document=\*\*\}/, "recursive owner rules would bypass append-only audit restrictions");
assert.match(rules, /match \/clinicalAuditEvents\/\{eventId\}[\s\S]*allow update: if false;/);
assert.match(
  rules,
  /allow delete: if isOwner\(userId\)[\s\S]*!existsAfter\([^;]+patients\/\$\(resource\.data\.patientId\)\);/,
  "audit events may only be deleted when their bound patient no longer exists after the atomic write",
);
assert.match(rules, /match \/clinicalAuditPayloads\/\{payloadId\}[\s\S]*allow update: if false;/);
assert.match(
  rules,
  /request\.resource\.data\.expiresAt >= request\.time[\s\S]*request\.resource\.data\.expiresAt <= request\.time \+ duration\.value\(31, 'd'\)/,
  "client clock skew must not extend clinical payload retention beyond the server-time bound",
);
assert.match(
  rules,
  /match \/aiDrafts\/\{draftId\}[\s\S]*allow create, update: if false;[\s\S]*allow delete: if isOwner\(userId\)[\s\S]*!existsAfter\([^;]+patients\/\$\(patientId\)\);/,
  "patient AI drafts may only be client-deleted with their parent patient",
);
assert.match(service, /runTransaction\(db/);
assert.match(service, /transaction\.set\(noteRef, noteData\)/);
assert.match(service, /transaction\.set\(eventRef/);
assert.match(service, /transaction\.set\(doc\(auditPayloadsCollection/);
assert.match(service, /clinicalSaveConflictReason/);
assert.match(service, /return pickAtomicPatientPatch\(value\)/, "audited SOAP and atomic note saves must share one patient-field allowlist");
assert.match(composer, /audit,\s*expectedSoapVersion:/);
assert.match(composer, /isDemoMode \? getSessionDraftStorage\(\) : null/);
assert.match(detail, /isDemoMode \? getSessionDraftStorage\(\) : null/);
assert.match(auditBuilder, /candidateText = input\.origin\.beforeText/);
assert.match(auditBuilder, /PAYLOAD_RETENTION_DAYS = 30/);
assert.match(auditBuilder, /operation: "ai\.document\.save"/);
assert.match(service, /export async function savePatientWithAudit/);
assert.match(service, /transaction\.update\(patientRef, patientPatch\)/);
assert.match(service, /patientUpdatedAtConflictReason/);
assert.match(aiDocuments, /isDocumentReviewBoundToContext/);
assert.match(aiDocuments, /buildAiDocumentAuditWrite/);
assert.match(aiDocuments, /candidateText,/);
assert.match(aiDocuments, /expectedPatientUpdatedAt: persistedPatientUpdatedAt\(savePatient\)/);
assert.match(app, /savePatientWithAudit\(user\.uid, patient\.id, options\)/);

console.log("OK SOAP and AI-document audit transactions, context binding, retention, privacy, and immutable-rules regression");
