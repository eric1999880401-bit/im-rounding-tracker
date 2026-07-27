# Product TODO

Deferred after the MVP stability pass:

- Add structured medication / antibiotic, procedure, and consult fields. The print page currently extracts these signals from existing free-text fields to avoid a risky Firebase schema change before the deadline.
- Add a dedicated print overflow preview for large census days. The current A4 landscape layout is compact and build-safe, but very long notes or high patient counts can still continue to a second page.
- Consider code-splitting Firebase/AI routes if the production bundle warning becomes a deployment or load-time problem.
- Keep general Patient Form writes revision-checked and move them to field-specific patches before adding them to the audit corpus; never reuse display/fallback overlays as write payloads.
- Extend the append-only candidate-to-final timeline to AI Intake card acceptance, the embedded Admission Brief paste/generate form, new-patient Bulk Import creation, and ordinary Patient Form edits. AI Documents is already covered by a server-validated field-patch contract.
- Expand the Clinical Knowledge Base into versioned specialty packs with local SOP overlays, named clinician owners/reviewers, and fake-case regression for every hard rule before use in production handoff.
