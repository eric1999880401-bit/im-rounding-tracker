# Overnight Product Polish Log

Run target: stable production-ready MVP for IM Rounding Tracker before 2026-05-15 08:00 Asia/Taipei.

## What Changed

- Added `AGENTS.md` with project rules for clinical safety, print usefulness, data preservation, explicit-save behavior, and safe main-branch pushes.
- Kept the existing Firestore patient data model and routing architecture unchanged.
- Tightened two compact UI labels:
  - `A-P` style tab text now renders as `A/P`.
  - The board print-brief toggle now says `No brief` instead of a symbolic minus label.
- Made non-urgent print explanatory text neutral gray so red remains reserved for true red flags and urgent clinical signals.

## What Was Tested

- `npm run build` passed before and after the targeted changes.
- `VITE_BASE_PATH=/IM-Rounding-Tracker/ npm run build` passed for GitHub Pages-style asset paths.
- `npm --prefix functions run build` passed.
- SSR smoke test rendered the main clinical surfaces with a synthetic patient:
  - Patient Board rendered patient identifiers and focused clinical sections.
  - Patient Board showed generated admission brief summary text.
  - Patient Detail rendered all 7 tabs and showed the patient and admission summary.
  - Print List included bed, patient code, age/sex, attending, service, admission summary, PMH, active problems, hospital course, red flags, tasks, discharge plan, labs, imaging, and admission brief section.
  - Print List did not include `+N more` overflow markers for clinically important fixture content.
- Browser smoke test against `http://127.0.0.1:5173` showed the login screen with no console errors.
  The Browser plugin's required Node REPL execution tool was not exposed in this environment, so Playwright CLI was used as the fallback browser-control path.
- `git diff --check` passed with line-ending warnings only.

## Deferred

- Structured medication / antibiotic, procedure, and consult fields remain deferred in `TODO_PRODUCT.md` to avoid a risky Firebase schema change before shipping.
- Dedicated print overflow preview for very large census days remains deferred in `TODO_PRODUCT.md`.
- Bundle code-splitting remains deferred unless the current Vite chunk-size warning becomes a practical load-time or deployment issue.

## Known Remaining Limitations

- Browser smoke did not log into Firebase or touch real patient data.
- Very large census lists or extremely long notes can still continue to a second page, although important fields are no longer intentionally collapsed behind `+N` markers.
- Vite still reports a large bundle warning, but the production build succeeds.
- Local `.env` exists in the workspace and is intentionally ignored; do not commit secrets.

## Git Safety Status

- Working branch for this run: `overnight-product-polish`.
- Intended commit files: `AGENTS.md`, `OVERNIGHT_LOG.md`, `src/i18n.tsx`, `src/styles/print.css`.
- Intentionally excluded local file: `vite-dev.log`.
- No Firebase schema files, patient data exports, `.env` files, or destructive data migrations are part of this change.

## 2026-05-15 Print List Simplification

Objective: simplify the printed rounding list by removing unnecessary crowded columns while preserving clinically important content, including prior important hospital events, investigations/treatment signals, today's updates, tasks, and miscellaneous print items.

### Changed Files

- `src/pages/PrintRoundingListPage.tsx`
  - Replaced the 8-column print table with one compact patient block per patient.
  - Grouped content into three clinical sections: `Clinical Picture`, `Today / Results`, and `Plan / Tasks / DC`.
  - Kept bed, patient code, age/sex, attending, and service in the patient block header.
  - Added the generated admission summary into the main print-list `Brief` source, not only the separate Admission Brief section.
  - Preserved prior course, PMH, active problems, red flags, today updates, key vitals/sugar/PE, labs, imaging, treatment/consult cues, A/P, tasks, orders, discharge plan, and discharge preparation when discharge context exists.
  - Removed default discharge-prep noise for patients without discharge date, discharge plan, or discharge barrier.
- `src/styles/print.css`
  - Updated the print patient block grid to three compact sections.
  - Tightened print block spacing and added an empty-state style for no selected patients.

### Build Result

- `npm run build` passed on `overnight-product-polish` after the print-list changes.
- Build warning remains: Vite reports one bundle chunk larger than 500 kB. This is already documented as a deferred code-splitting item and does not fail the build.

### Smoke Test Checklist

- Printed list uses compact patient blocks instead of the old crowded 8-column table: PASS.
- Old table headers such as `Today S/O` and `DC / Safety` are not rendered: PASS.
- Patient identifiers render: bed, patient code, age/sex, attending, service: PASS.
- Admission brief summary appears in the main print list: PASS.
- Important prior hospital course remains visible: PASS.
- Today's update and objective signals remain visible: PASS.
- Key labs, imaging, and treatment/consult signals remain visible: PASS.
- Patient tasks, general miscellaneous print tasks, and discharge plan remain visible: PASS.
- Red flags remain visible and emphasized: PASS.
- No `+N more` overflow marker appears in the print smoke fixture: PASS.

### Known Limitations

- The smoke test used synthetic data and did not log into Firebase or touch real patient data.
- Very long censuses or unusually long free-text notes can still continue beyond one printed page.
- Structured medication/antibiotic, procedure, and consult fields remain deferred to avoid a risky Firebase schema change before MVP shipping.
- The Vite bundle-size warning remains non-blocking.

### Firebase Schema Safety

- No Firebase schema, Firestore collection path, Firestore rules, Firebase Functions, or persistence service file was destructively changed.
- This print-list change reads existing patient fields only and does not rename or migrate stored patient data.

### Git Branch / Status Before Push

- Working branch: `overnight-product-polish`.
- Intended commit files for this print-list update: `OVERNIGHT_LOG.md`, `src/pages/PrintRoundingListPage.tsx`, `src/styles/print.css`.
- Intentionally excluded local file: `vite-dev.log`.
- Main pre-push verification: `main` was fast-forwarded with the print-list commit and `npm run build` passed on `main`.
- Final expected branch/status immediately before `git push origin main`: `main...origin/main [ahead 2]`, with only local `vite-dev.log` modified and intentionally uncommitted.

## 2026-05-15 AI Document Format Simplification

Objective: reduce unnecessary AI-generated document choices and make the iSBAR handoff concise, high-yield, and complete for internal medicine handover.

### Changed Files

- `src/pages/AiDocumentsPage.tsx`
  - Removed lower-priority `Admission note` and `Weekly summary` options from the AI Documents selector so the UI focuses on high-yield document outputs.
  - Changed the default AI document type to `iSBAR handoff`.
  - Added a dedicated iSBAR formatter that outputs only `Identify`, `Situation`, `Background`, `Assessment`, and `Recommendation`.
  - Normalizes iSBAR content into compact semicolon-separated handoff lines and folds pending/verify items into `Recommendation` instead of adding extra noisy sections.
- `functions/src/index.ts`
  - Tightened the iSBAR generation instructions to require the five iSBAR sections in order.
  - Added target length guidance and section-specific content rules.
  - Explicitly excludes routine normal data, duplicated diagnosis paragraphs, generic disclaimers, copied full labs, long admission-note prose, and low-signal stable updates.
  - Requires key prior course, red flags, major lab/image findings, antibiotics/procedures/consults, pending tasks, call thresholds, and disposition when available.

### Build Result

- `npm run build` passed in the repository root after the AI document changes.
- `npm run build` passed in `functions/` after the AI document prompt changes.
- Build warning remains: Vite reports one bundle chunk larger than 500 kB. This is non-blocking and already deferred.

### Smoke Test Checklist

- AI Documents selector now shows the focused high-yield choices: admission summary, discharge hospital course, and iSBAR handoff: PASS by source inspection.
- Default selected AI document is now iSBAR handoff: PASS by source inspection.
- iSBAR formatter no longer prints generic title/summary/follow-up boilerplate: PASS by source inspection.
- iSBAR output is constrained to the five expected handoff headings: PASS by source inspection.
- Pending tasks and verification items are preserved by folding them into Recommendation: PASS by source inspection.
- Backend prompt instructs the model to include prior important hospital events, red flags, major tests/treatments/consults, today's status, pending tasks, contingency plans, and disposition: PASS by source inspection.
- Backend prompt instructs the model to omit routine normal data, copied full labs, duplicated diagnosis prose, and generic disclaimers: PASS by source inspection.

### Known Limitations

- This change does not call the OpenAI API during verification; output quality depends on the deployed model following the stricter prompt.
- Hidden document types are still supported in TypeScript and backend code for compatibility, but no longer appear in the AI Documents UI.
- iSBAR may still need clinician editing before saving; the UI continues to present an editable draft before writing to the patient record.

### Firebase Schema Safety

- No Firestore collection path, field name, rules file, Firebase schema, or patient persistence service was destructively changed.
- The save behavior still writes reviewed iSBAR text to the existing `generatedSbarNote` field only.
- Backend draft storage remains in the existing `aiDrafts` flow.

### Git Branch / Status Before Push

- Working branch: `overnight-product-polish`.
- Intended commit files for this AI Documents update: `OVERNIGHT_LOG.md`, `src/pages/AiDocumentsPage.tsx`, `functions/src/index.ts`.
- Intentionally excluded local file: `vite-dev.log`.
- Main pre-push verification: `main` was fast-forwarded with the AI Documents commit and both repository-root `npm run build` and `functions/ npm run build` passed on `main`.
- Final expected branch/status immediately before `git push origin main`: `main...origin/main [ahead 2]`, with only local `vite-dev.log` modified and intentionally uncommitted.

## 2026-05-15 Product System Details

Objective: add product-grade system details with better bilingual UI copy and clearer user switching/account handling.

### Changed Files

- `src/i18n.tsx`
  - Added bilingual keys for current user, privacy note, sidebar expand/collapse, switch user, and Settings account labels.
  - Improved Traditional Chinese navigation copy for AI Documents as `AI 文件`.
- `src/components/AppLayout.tsx`
  - Replaced the sidebar footer action label from generic sign-out wording to explicit `Switch user` / `切換使用者`.
  - Localized sidebar expand/collapse tooltips and the privacy note.
  - Changed the account label from a greeting to current-user terminology.
- `src/pages/SettingsPage.tsx`
  - Added an Account section showing the signed-in user and a `Switch user` button.
  - Kept theme/language settings under a clearer Preferences heading.
- `src/App.tsx`
  - Passed current user display text and the existing safe sign-out action into Settings.

### Build Result

- `npm run build` passed on `overnight-product-polish` after the system-detail changes.
- Build warning remains: Vite reports one bundle chunk larger than 500 kB. This is non-blocking and already deferred.

### Smoke Test Checklist

- Sidebar account label uses localized current-user wording instead of a casual greeting: PASS by source inspection.
- Sidebar switch-user action uses localized `Switch user` / `切換使用者` copy and still calls the existing Firebase sign-out helper: PASS by source inspection.
- Settings page shows an Account section with signed-in user and switch-user button: PASS by source inspection.
- Settings page still preserves existing theme and language controls: PASS by source inspection.
- No patient data save path or Firestore schema was changed: PASS by diff inspection.

### Known Limitations

- This change does not implement multi-account session storage; switching user signs out and returns to the login flow.
- Browser smoke was not run with real Firebase login; verification used TypeScript/build plus source inspection.
- `vite-dev.log` remains a local modified log file and is intentionally excluded from commits.

### Firebase Schema Safety

- No Firestore collection path, field name, rules file, Firebase schema, Firebase Functions file, or patient persistence service was changed.
- User switching uses the existing `signOutCurrentUser` helper only.

### Git Branch / Status Before Push

- Working branch: `overnight-product-polish`.
- Intended commit files for this system-detail update: `OVERNIGHT_LOG.md`, `src/App.tsx`, `src/components/AppLayout.tsx`, `src/i18n.tsx`, `src/pages/SettingsPage.tsx`.
- Intentionally excluded local file: `vite-dev.log`.
- Main pre-push verification: `main` was fast-forwarded with the system-detail commit and repository-root `npm run build` passed on `main`.
- Final expected branch/status immediately before `git push origin main`: `main...origin/main [ahead 2]`, with only local `vite-dev.log` modified and intentionally uncommitted.

## 2026-05-15 Morning Cockpit Priority Upgrade

Objective: make Morning Cockpit a practical priority tool that shows who needs to be seen first, why, and what action is next.

### Changed Files

- `src/pages/PatientBoardPage.tsx`
  - Added a computed Morning Priority Queue using the existing shared display-summary/read path.
  - Scores patients by red flags, urgent tasks, new admission status, discharge readiness, pending tasks, and objective/lab/image signals.
  - Shows each queued patient with severity (`See first`, `Today`, `Routine`), diagnosis, patient code, attending, urgent/pending counts, reason, and next action.
  - Preserved the existing `See First`, `New Admits`, and `DC Soon` cockpit columns.
- `src/styles/global.css`
  - Added compact priority summary stat cards.
  - Added queue layout, severity left rails, and severity pills.
  - Added responsive behavior for tablet/mobile widths.

### Build Result

- `npm run build` passed on `overnight-product-polish` after the Morning Cockpit changes.
- Build warning remains: Vite reports one bundle chunk larger than 500 kB. This is non-blocking and already deferred.

### Smoke Test Checklist

- Morning Cockpit renders a `Priority Queue` with reason and next-action columns: PASS.
- Summary stats render for see-first, active-today, DC prep, and total census: PASS.
- Critical red-flag patient is prioritized with `priority-critical`, visible red-flag reason, and urgent task next action: PASS.
- New admission appears in the queue with admission-brief reason and review-admission next action: PASS.
- Discharge-prep patient appears with discharge task/prep context: PASS.
- Existing `See First`, `New Admits`, and `DC Soon` columns still render: PASS.
- `git diff --check` passed with line-ending warnings only.

### Known Limitations

- Morning priority scoring is deterministic and heuristic-based; it may need tuning after real ward use.
- Browser smoke with a live signed-in Firebase session was not run; verification used synthetic SSR rendering plus build.
- The queue displays up to 10 active patients to keep the cockpit scan-friendly.
- `vite-dev.log` remains a local modified log file and is intentionally excluded from commits.

### Firebase Schema Safety

- No Firestore collection path, field name, rules file, Firebase schema, Firebase Functions file, or patient persistence service was changed.
- The cockpit reads existing patient/daily-note display summaries only and does not write patient data.

### Git Branch / Status Before Push

- Working branch: `overnight-product-polish`.
- Intended commit files for this Morning Cockpit update: `OVERNIGHT_LOG.md`, `src/pages/PatientBoardPage.tsx`, `src/styles/global.css`.
- Intentionally excluded local file: `vite-dev.log`.
- Main pre-push verification: `main` was fast-forwarded with the Morning Cockpit commit and repository-root `npm run build` passed on `main`.
- Final expected branch/status immediately before `git push origin main`: `main...origin/main [ahead 2]`, with only local `vite-dev.log` modified and intentionally uncommitted.

## 2026-05-15 AI Clinical Classification and Layout Simplification

Objective: reduce crowded AI/admission-brief surfaces and make AI intake classification closer to practical internal medicine hand-written judgment.

### Changed Files

- `functions/src/index.ts`
  - Added explicit clinical routing rules for AI Intake so subjective, objective, A/P, tasks, red flags, discharge issues, and uncertainty are separated by clinical purpose.
  - Tightened source-specific behavior for consult, nursing, lab-only, image-only, vitals-only, and daily-update inputs.
  - Made red flags/action tasks more specific and discouraged broad SOAP rewrites from stable routine data.
  - Tightened admission-summary generation toward a 3-4 sentence senior-resident admission brief.
- `src/components/AiIntakePanel.tsx`
  - Reordered AI review cards into a clinical queue: Safety, Tasks/Discharge, A/P, Objective Data, Subjective/Events, Generated Briefs, and Clinician Review.
  - Added compact human-readable previews for JSON cards so review is scannable without opening raw JSON unless editing.
  - Kept the existing explicit accept/apply workflow; nothing is saved until accepted items are applied.
- `src/components/AiHighlightsPanel.tsx`
  - Renamed the surface to `Admission Brief` on compact board cards and `AI Clinical Brief` on detail pages.
  - Limited compact board admission summary display to high-yield preview lines to reduce crowding.
  - Kept fuller summary/course/iSBAR display for the detail page.
- `src/components/AdmissionBriefForm.tsx`
  - Shows generated admission summary as the main Admission Note Summary fallback when the clinician-reviewed field is blank.
  - Collapsed duplicate generated admission note/summary draft fields under `AI-generated source drafts`.
- `src/styles/global.css`
  - Added compact AI review preview styling.
  - Reduced nested card styling for board Admission Brief display.
  - Added styling for collapsed admission generated drafts.

### Build Result

- `npm run build` passed in the repository root after the AI/layout changes.
- `npm run build` passed in `functions/` after the AI prompt changes.
- `npm run lint` was attempted but no `lint` script exists in `package.json`.
- `npm test` was attempted but no `test` script exists in `package.json`.
- `git diff --check` passed with line-ending warnings only.
- Build warning remains: Vite reports one bundle chunk larger than 500 kB. This is non-blocking and already deferred.

### Smoke Test Checklist

- AI Intake still requires de-identification confirmation before analysis: PASS by source inspection.
- AI Intake still saves only after clinician accepts cards and clicks Apply accepted items: PASS by source inspection.
- Accepted AI output still writes through existing patient/daily-note fields and does not create passive autosave behavior: PASS by source inspection.
- AI review queue now prioritizes red flags, tasks, A/P, objective data, then generated briefs: PASS by source inspection.
- JSON review cards have compact previews and can still enter edit mode before accepting: PASS by source inspection.
- Board Admission Brief no longer renders duplicate active plan blocks in compact mode: PASS by source inspection.
- Board Admission Brief limits summary preview to reduce card crowding while detail view keeps fuller AI clinical brief content: PASS by source inspection.
- Admission Brief form surfaces generated admission summary through the main summary field when the reviewed summary is blank: PASS by source inspection.

### Known Limitations

- This verification did not call the OpenAI API; final classification quality depends on the deployed model following the stricter prompt.
- Browser plugin automation was unavailable in this session because the required Node REPL browser tool was not exposed; rendered verification used build plus source inspection.
- No real Firebase login or real patient data was used during verification.
- Very long generated admission summaries still require clinician editing before saving/printing.
- `vite-dev.log` remains a local modified log file and is intentionally excluded from commits.

### Firebase Schema Safety

- No Firestore collection path, field name, rules file, Firebase schema, or patient persistence service was destructively changed.
- The change updates prompts and rendering only, while preserving existing fields such as `generatedAdmissionSummary`, `admissionBriefFreeText`, `generatedSbarNote`, `assessmentPlanItems`, `tasks`, and daily-note fields.
- AI draft storage remains in the existing `aiDrafts` flow.

### Git Branch / Status Before Push

- Working branch: `overnight-product-polish`.
- Intended commit files for this AI classification/layout update: `OVERNIGHT_LOG.md`, `functions/src/index.ts`, `src/components/AiIntakePanel.tsx`, `src/components/AiHighlightsPanel.tsx`, `src/components/AdmissionBriefForm.tsx`, `src/styles/global.css`.
- Intentionally excluded local file: `vite-dev.log`.
- Main pre-push verification: `main` was fast-forwarded with the AI classification/layout commit and both repository-root `npm run build` and `functions/ npm run build` passed on `main`.
- Final expected branch/status immediately before `git push origin main`: `main...origin/main [ahead 2]`, with only local `vite-dev.log` modified and intentionally uncommitted.
