# Product TODO

Deferred after the MVP stability pass:

- Add structured medication / antibiotic, procedure, and consult fields. The print page currently extracts these signals from existing free-text fields to avoid a risky Firebase schema change before the deadline.
- Add a dedicated print overflow preview for large census days. The current A4 landscape layout is compact and build-safe, but very long notes or high patient counts can still continue to a second page.
- Consider code-splitting Firebase/AI routes if the production bundle warning becomes a deployment or load-time problem.
- Expand the Clinical Knowledge Base into versioned specialty packs with local SOP overlays, named clinician owners/reviewers, and fake-case regression for every hard rule before use in production handoff.
