# Architecture / Module Map

The app is a pipeline from pasted chart text to a printable SOAP rounding list.
Every module owns exactly one stage. New code must name its stage; if a change
doesn't fit a stage, discuss before adding another module.

```text
paste / Firestore data
  → parse & classify        (dates, clinicalTextFormat, labParsing,
                             clinicalLineClassifier, medicationOrderParser)
  → local rules / AI        (clinicalRules/* + clinicalKnowledge,
                             functions/src: prompts + callables)
  → sanitize & concretize   (aiPostprocess/*, aiDraftSanitizer,
                             functions/src/sanitize)
  → draft & guardrails      (soapDraft, soapEditorDraft, soapDeltaGuardrails,
                             soapEvidence, aiSoapContract, draftRecovery,
                             clinicalFieldRouter, apProblemNormalizer)
  → render / print          (patientModel display summary, roundingDigest,
                             labVisualSummary, printPriority, components/, pages/)
```

## Frontend (`src/`)

| Module | Stage / responsibility |
| --- | --- |
| `dates.ts` | id + date primitives |
| `clinicalTextFormat.ts` | line splitting, color markup, safe truncation |
| `labParsing.ts` | lab text parsing, lab focus/interpretation summaries |
| `patientModel.ts` | patient/daily-note model helpers, display summary, sorting |
| `utils.ts` | compatibility shim re-exporting the four modules above (do not add code here) |
| `clinicalRules/references.ts` | knowledge packs + literature refs |
| `clinicalRules/ruleHelpers.ts` | shared numeric/text extractors, plan-append primitives |
| `clinicalRules/domainRules.ts` | per-domain rule blocks (neuro/infection/cardio/renal/pulm/GI/endo/heme-onc) |
| `clinicalKnowledge.ts` | fact bundle, plan assembly, rule-based formatting (SBAR/weekly/brief) |
| `aiPostprocess/genericFiller.ts` | single filler word-list + detectors (sync with functions) |
| `aiPostprocess/planConcretizer.ts` | vague follow-up/intervention → concrete rewrite (sync with functions) |
| `aiDraftSanitizer.ts` | only entry point for raw AI drafts |
| `roundingDigest.ts` | `getRoundingDigest` (list projection) + `getPatientHeadline` (one-line per-card headline) |
| `soapLineDelta.ts` | carried-forward detection: dims lines unchanged since the prior daily note so today's changes stand out |
| `soapDraft.ts`, `soapDeltaGuardrails.ts` | SOAP text model + reviewed-baseline protection (highest risk; move, don't rewrite) |
| `firebase/` | auth + Firestore + callable wrappers |
| `pages/`, `components/` | rendering; pages are lazy-loaded routes |

## Backend (`functions/src/`)

| Module | Responsibility |
| --- | --- |
| `schemas.ts` | OpenAI structured-output JSON schemas |
| `types.ts` | callable input types, allowed-value sets |
| `openai.ts` | API key/model config, response extraction, error mapping |
| `sanitize.ts` | input/output cleaning, filler filter, concretizer (sync with `src/aiPostprocess/`) |
| `prompts.ts` | all prompt builders — edit AI behavior here |
| `index.ts` | the four onCall callables only |

## Guardrails

- `npm run clinical:eval` (45 cases) is the regression contract — must stay green.
- `npm run lint` warns when a file exceeds 600 effective lines: split it.
- CI (`.github/workflows/ci.yml`) runs both builds + eval on every PR/branch push.
- Functions deploy on merge to main (`deploy-functions.yml`).
