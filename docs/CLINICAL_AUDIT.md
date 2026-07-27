# Clinical Change Audit

The first safety scope covers the active write paths that most often transform pasted clinical text:

- reviewed SOAP saves from Board and Patient Detail;
- DITTO copies between dates;
- reviewed Bulk Import updates for an existing inpatient;
- reviewed AI Documents saved into a patient record.

Each covered save uses one Firestore transaction. The canonical daily note, the allowlisted patient compatibility patch, durable audit metadata, and short-lived text snapshots either all commit or all fail. The transaction rejects stale SOAP versions and stale patient `updatedAt` values instead of silently overwriting another tab or device.

## Firestore layout

```text
/users/{uid}/clinicalAuditEvents/{eventId}
/users/{uid}/clinicalAuditPayloads/{eventId}-{kind}
```

`clinicalAuditEvents` stores patient/date binding, entry point, workflow/model metadata, base and saved versions, and a bounded candidate-to-final correction diff. Client rules permit create/read for the owner and always deny updates. Deletion is allowed only when the event's bound patient no longer exists after the same atomic write, so the event is immutable during normal use but cannot be left behind as orphaned clinical metadata when a patient is deleted.

Clinical text is split into separate `source`, `baseline`, `candidate`, and `final` payload documents to stay well below Firestore's document limit. Payloads carry a 30-day expiry. The client purges all expired batches after sign-in, and the scheduled `purgeExpiredClinicalAuditPayloads` Cloud Function provides daily server-side enforcement even when the user does not sign in. Owners may delete payloads, while durable metadata remains.

For SOAP, exact pasted source is retained only when the clinician explicitly selects the 30-day source option. Candidate and final snapshots are retained for correction review. Bulk Import records the de-identified source block after explicit de-identification confirmation. No clinical payload is written to `localStorage`, `sessionStorage`, console logs, URLs, or analytics in live mode.

AI Intake and AI Documents persist exact pasted source in `aiDrafts` only when the clinician explicitly selects the 30-day retention option. Those opted-in drafts carry `rawTextExpiresAt`; the daily scheduled cleanup removes `rawText`, its preview, and the expiry marker after 30 days. A bounded `createdAt` sweep also deletes AI drafts older than 30 days, so pre-retention drafts cannot retain legacy source indefinitely. Accepted patient data and durable audit metadata are separate and are not deleted by this draft cleanup.

AI Documents binds each generated draft to the exact patient, document type, date range, pasted text, model quality, source-retention choice, patient snapshot, and selected SOAP context. A change to any bound input invalidates the draft. Saving rechecks that binding and the persisted patient `updatedAt`, then commits only allowlisted document fields with the audit event and `baseline`, `candidate`, and `final` payloads in one transaction. Exact pasted source is included in the audit payload only when the clinician explicitly selects the 30-day retention option.

## Current coverage boundary

The append-only candidate-to-final timeline does not yet cover AI Intake card acceptance, the embedded Admission Brief paste/generate form, new-patient Bulk Import creation, or ordinary Patient Form edits. Those saves now use revision-checked/allowlisted write paths where applicable, and opted-in AI draft source still expires, but they must not be treated as a complete correction-learning corpus until their own audited field-patch contracts are added. This boundary is tracked in `TODO_PRODUCT.md` rather than hidden behind a broad "all changes are logged" claim.

## Safety behavior

- AI correction learning compares the candidate actually shown to the clinician with the final reviewed SOAP. The pre-generation baseline is tracked separately.
- A stale note or patient revision produces a visible conflict and no partial write.
- DITTO only accepts a complete reviewed SOAP, resets copied provenance, and records its source date.
- Existing-inpatient Bulk Import writes date-scoped draft facts rather than appending daily vitals/labs/imaging to the patient master. It refuses to replace an existing SOAP and refuses ambiguous bed/patient-code matches.
- The audit viewer is read-only. It intentionally has no restore button; restoring old clinical text must become a new reviewed, audited mutation.

Deploy `firestore.rules`, `firestore.indexes.json`, and Firebase Functions together with the application before enabling this feature in production; the scheduled retention job and its required collection-group expiry indexes do not exist until deployment completes. Existing patient documents are not migrated or rewritten by this change.
