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
