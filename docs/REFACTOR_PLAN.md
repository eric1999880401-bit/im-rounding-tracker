# Refactor / Code-Slimming Plan

Status: proposal (2026-07-03). Follows AGENTS.md: prefer small targeted steps, never
break the clinical eval suite, no Firebase schema changes, no behavior changes without
a regression case.

## Current state (review findings)

- ~28,400 lines of frontend TS/TSX plus ~2,100 lines in `functions/src/index.ts`.
- No unit-test framework and no linter; `scripts/clinical-eval.mjs` (45 cases) is the
  only regression gate, so every refactor phase must keep it green.
- Oversized files (top offenders):
  - `src/clinicalKnowledge.ts` (~2,000): reference metadata + fact extraction + eight
    clinical-domain rule blocks + digest/print projection, all in one file.
  - `src/utils.ts` (~1,900): grab-bag of IDs/dates, patient/daily-note model helpers,
    an ~800-line lab parser, and display summaries. 37 files import from it, so any
    edit here invalidates almost the whole dependency graph.
  - `functions/src/index.ts` (~2,100): JSON schemas + 5 prompt builders + sanitizers +
    4 callables in one file.
  - `src/pages/PatientBoardPage.tsx` (~1,700), `src/components/AiIntakePanel.tsx`
    (~1,540), `PrintRoundingListPage.tsx` / `RoundSoapComposer.tsx` (~1,200 each).
- Duplicated logic (the main "堆積" cost):
  - Generic-filler / vague-text filtering exists in 4+ places with drifting word
    lists: `isGenericClinicalFiller` (functions), `removeGenericFiller`
    (clinicalKnowledge), inline regexes in `aiDraftSanitizer`, and
    `clinicalPatientPolish`.
  - The vague-follow-up concretizer map is intentionally duplicated between
    `src/planConcretizer.ts` and `functions/src/index.ts` (separate npm packages);
    a shared workspace package would remove this.
  - 13+ overlapping single-purpose `clinical*` / `soap*` modules
    (clinicalLineClassifier, clinicalFieldRouter, clinicalColorMarkup,
    clinicalDocumentFormat, clinicalPatientPolish, apProblemNormalizer, soapDraft,
    soapEditorDraft, soapDeltaGuardrails, soapEvidence, soapSbar, aiDraftSanitizer,
    aiSoapContract) form an implicit pipeline with no documented stage boundaries.
- Bundle: single 1.07 MB JS chunk (Vite warns above 500 kB); no route-level code
  splitting.
- Hygiene: `vite-dev.log` was tracked in git (removed); `OVERNIGHT_LOG.md` (35 kB)
  is still tracked — keep only if it is intentional working memory.

## Phase 0 — Safety net first (do before moving any code)

1. Keep `npm run clinical:eval` green as the gate for every phase.
2. Add a CI workflow that runs `npm run build`, `npm --prefix functions run build`,
   and `npm run clinical:eval` on every PR (deploy.yml only covers deploys today).
3. Optional: adopt vitest and move eval helpers into importable unit tests so
   failures point at a module instead of a script section.

## Phase 1 — Split `src/utils.ts` (mechanical, no logic changes)

Extract by responsibility, keeping `utils.ts` as a re-export shim so the 37 import
sites don't change in the same PR; delete the shim in a follow-up codemod commit.

- `src/labParsing.ts`: parseLabText, parseLabReports, labSummary, formatLabItem and
  their private helpers (~800 lines).
- `src/dailyNoteModel.ts`: emptyDailyNote, dailyNoteFromPatient, patientForDate,
  patientWithDailyNote, snapshot comparison helpers.
- `src/clinicalTextFormat.ts`: safeClinicalLine, splitHighlightLines,
  stripColorMarkup, compactClinicalText.
- Leave only createId/nowIso/date helpers in `utils.ts`, or dissolve it entirely.

## Phase 2 — One AI post-processing pipeline (removes the most duplication)

- Create `src/aiPostprocess/` with single implementations of:
  - `genericFiller.ts` — one filler word-list + `removeGenericFiller` used by
    clinicalKnowledge, aiDraftSanitizer, and clinicalPatientPolish.
  - `planConcretizer.ts` — already exists; move here.
  - shock-context and report-vs-PE heuristics currently inlined in aiDraftSanitizer.
- Make `sanitizeAiSoapDraftForReview` the only entry point that touches raw AI
  drafts; clinicalFieldRouter/clinicalPatientPolish call the shared helpers instead
  of re-implementing filters.
- Add eval cases pinning the shared filler list so consolidation cannot silently
  drop a filter someone relied on.

## Phase 3 — Split `functions/src/index.ts`

- `schemas.ts` (JSON schemas), `prompts.ts` (makePrompt/makeRoundSoapPrompt/
  makeBatchImportPrompt/documentInstructions + shared bullet constants),
  `sanitize.ts` (truncate/clean/filler/concretizer helpers), and one file per
  callable under `callables/`; `index.ts` only re-exports.
- Evaluate an npm-workspace `shared/` package for the filler list + concretizer map
  so web and functions stop drifting (currently duplicated by necessity).

## Phase 4 — Component and bundle slimming

- Route-level `React.lazy` code splitting for pages (board, print, settings, AI docs)
  to get the main chunk under ~500 kB.
- Split `PatientBoardPage.tsx` and `AiIntakePanel.tsx` into subcomponents + hooks
  (state logic into `useXxx` hooks, rendering into small components).
- Split `clinicalKnowledge.ts` by clinical domain into `src/clinicalRules/`
  (renal.ts, infection.ts, cardio.ts, respiratory.ts, gi.ts, endocrine.ts, onc.ts,
  neuro.ts) implementing one shared rule interface; keep the fact extractor and the
  digest projection as separate modules.

## Phase 5 — Keep it from re-accumulating

- Add ESLint (with `max-lines` warning ~600 and `import/no-cycle`) and Prettier.
- Add `docs/ARCHITECTURE.md` mapping the pipeline: paste → parse/classify →
  rules/AI → sanitize/concretize → draft/guardrails → render/print, and which module
  owns each stage. New code must name its stage.

## Explicit non-goals

- No framework/library changes, no Firebase schema or collection-path changes.
- Do not rewrite `soapDraft.ts` / `soapDeltaGuardrails.ts` logic — highest-risk,
  best-tested code; only move it, never "improve" it in a refactor commit.
- No UI redesign; AGENTS.md style rules stand.

## Suggested order and size

| Step | Risk | Size | Prereq |
| --- | --- | --- | --- |
| Phase 0 CI gate | none | small | — |
| Phase 1 utils split | low (mechanical) | medium | Phase 0 |
| Phase 2 AI post-process merge | medium (word lists differ subtly) | medium | Phase 1 |
| Phase 3 functions split | low | medium | Phase 0 |
| Phase 4 components/bundle | medium | large | Phases 1–2 |
| Phase 5 lint/docs | none | small | any time |

One phase per PR; each PR must keep `npm run build`, functions build, and
`npm run clinical:eval` green.
