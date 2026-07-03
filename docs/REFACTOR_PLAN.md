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

## Phase 0 — Safety net first (do before moving any code) — DONE

1. Keep `npm run clinical:eval` green as the gate for every phase.
2. DONE: `.github/workflows/ci.yml` runs both builds and `clinical:eval` on every
   PR and non-main branch push.
3. Optional: adopt vitest and move eval helpers into importable unit tests so
   failures point at a module instead of a script section.

## Phase 1 — Split `src/utils.ts` (mechanical, no logic changes) — DONE

Extracted by responsibility; `utils.ts` is now a pure re-export shim so the 37
import sites are unchanged. Delete the shim in a follow-up codemod commit.

- `src/dates.ts`: createId/nowIso/todayKey/date parsing helpers.
- `src/clinicalTextFormat.ts`: safeClinicalLine, splitHighlightLines,
  stripColorMarkup, compactClinicalText, getAdmissionSummaryText.
- `src/labParsing.ts`: parseLabText, parseLabReports, labSummary, lab focus /
  interpretation summaries (~980 lines).
- `src/patientModel.ts`: patient/daily-note model helpers, display summary,
  sorting, empty-model factories.
- Import direction: dates → clinicalTextFormat → labParsing → patientModel
  (no cycles).

## Phase 2 — One AI post-processing pipeline — DONE (core)

- DONE: `src/aiPostprocess/genericFiller.ts` is the single filler word-list and
  detector; the duplicated filters in clinicalKnowledge, aiDraftSanitizer, and
  clinicalPatientPolish now call it. `planConcretizer.ts` moved here too.
- Remaining: extract shock-context and report-vs-PE heuristics from
  aiDraftSanitizer; make `sanitizeAiSoapDraftForReview` the only raw-draft entry
  point for clinicalFieldRouter as well.

## Phase 3 — Split `functions/src/index.ts` — DONE (core)

- DONE: split into `schemas.ts`, `types.ts`, `openai.ts`, `sanitize.ts`,
  `prompts.ts`; `index.ts` (~620 lines) keeps only the four onCall callables.
- Remaining: evaluate an npm-workspace `shared/` package for the filler list +
  concretizer map so web and functions stop drifting (currently duplicated with
  sync comments on both sides).

## Phase 4 — Component and bundle slimming — DONE (core)

- DONE: pages are lazy-loaded routes and Firebase SDK is a separate vendor chunk;
  main chunk went from 1,071 kB to 418 kB and the Vite size warning is gone.
- DONE: `clinicalKnowledge.ts` (1,996 lines) split into
  `clinicalRules/references.ts`, `clinicalRules/ruleHelpers.ts`,
  `clinicalRules/domainRules.ts` (8 domain blocks), with assembly/formatting
  remaining in `clinicalKnowledge.ts` (1,178 lines).
- Remaining: split `PatientBoardPage.tsx` and `AiIntakePanel.tsx` into
  subcomponents + hooks; `npm run lint` lists the 13 files still over 600 lines.

## Phase 5 — Keep it from re-accumulating — DONE (core)

- DONE: ESLint with a warning-only `max-lines` (600) size guard, wired into CI.
- DONE: `docs/ARCHITECTURE.md` maps the pipeline stages and module ownership.
- Remaining: consider Prettier and `import/no-cycle` if churn justifies them;
  delete the `utils.ts` shim after codemodding the 37 import sites.

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
