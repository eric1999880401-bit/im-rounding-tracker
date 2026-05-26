# IM Rounding Tracker Agent Rules

This project is a clinical internal medicine rounding tool. Ship reliable, clinically useful behavior before visual novelty.

## Product Priorities

- Clinical safety is higher priority than cosmetic polish.
- Print usefulness is critical. The rounding list must preserve important red flags, tasks, labs, imaging, antibiotics, procedures, consults, discharge needs, and disposition signals.
- Keep interfaces dense but calm: clear section headers, consistent spacing, restrained colors, and red only for urgent or high-risk clinical signals.
- Prefer small targeted improvements over redesigns or broad refactors.

## Data Safety

- Preserve existing patient data behavior and field names unless there is a documented migration plan.
- Do not destructively change Firebase schema, collection paths, or patient document shape.
- Firestore is the source of truth for patient data. Do not add patient-data persistence through `localStorage`.
- Keep patient editing explicit-save based. Do not add passive save on blur, tab change, unmount, or IME composition events.
- Preserve Chinese Zhuyin/Bopomofo-safe input behavior.
- Do not commit real patient data.
- Do not commit `.env` or secrets.

## Engineering Rules

- Run `npm run build` after meaningful frontend changes.
- Run `npm --prefix functions run build` after Firebase Functions changes.
- Inspect print output paths when changing print data, print CSS, or rounding digest logic.
- If a feature is risky or too large for an MVP stability pass, defer it in `TODO_PRODUCT.md`.
- Do not push to `main` unless build, smoke checks, git diff review, and safety checks pass.

## SOAP-First Rounding List Rules

This project is an internal medicine rounding tool. The default patient-list format should be SOAP-oriented, compact, and clinically useful. Prefer one clean SOAP block per patient over many separate cards, boxes, tabs, or decorative sections.

The product goal is not to display every possible data category as an independent UI block. The goal is to produce a fast, readable rounding list that helps the team answer:

1. What happened overnight?
2. What is objectively changing?
3. What are the active problems?
4. What exactly needs to be done today?
5. What could become unsafe if missed?

Do not build extra sections unless they clearly improve clinical safety or daily workflow.

## SOAP Output Contract

Each patient should render in this general structure:

```text
[Header]
Bed/Room | Patient display name | Age/Sex | HD/POD | Primary diagnosis or one-liner
Code | Allergy | Isolation | Team/Attending | Major alert if present

S: Subjective / Interval Events
- Overnight events, symptoms, patient concerns, nursing concerns, family concerns.
- Include fever, dyspnea, chest pain, pain, bleeding, delirium/AMS, poor intake, fall, sleep, bowel/urine symptoms when relevant.
- If no meaningful interval event is known, write a short explicit statement such as "No documented overnight event" instead of leaving the section ambiguous.

O: Objective Data
- VS/O2: vital-sign trends, fever curve, BP/HR/RR, SpO2, oxygen device and flow.
- I/O: urine output, drains, NG output, stool/diarrhea, weight change when relevant.
- Labs: key trends and dangerous abnormalities, not every normal value.
- Micro: cultures, pending results, antibiotic-relevant microbiology.
- Imaging/Procedures: new or pending results only.
- Meds/Devices: antibiotics with day count, anticoagulation, insulin/steroids, nephrotoxins, Foley/CVC/drains/NG/chest tube when clinically relevant.

A: Assessment
- Prioritized active problems, sorted by acuity and rounding importance.
- Each problem should include a concise status statement and key evidence.
- Avoid long textbook explanations.
- Do not create diagnoses that are not supported by the available data.

P: Plan / Tasks Today
- Concrete tasks for today.
- Medication changes, lab follow-up, imaging/procedure follow-up, consult follow-up, discharge steps.
- Include contingency plans when relevant, e.g., what to watch for or when to escalate.
- Include discharge readiness, barriers, disposition, and follow-up only when relevant.
```

The final printed/list output should be dense and calm. Use short lines, clinically meaningful abbreviations, and consistent spacing. Avoid visual clutter.

## Header Safety Rules

Even in a SOAP-first layout, the header should preserve high-safety information because these items are too important to bury in the note body:

- Code status
- Allergy
- Isolation status
- Major red flag or unstable status
- Age/sex
- Bed/room
- HD/POD when available
- Primary diagnosis or concise one-liner

If code status or allergy is missing, show it clearly in the header as missing. Do not guess.

## What Belongs in SOAP vs Separate Boxes

Prefer SOAP sections for almost everything.

Use separate visual emphasis only for:

- Critical alerts
- Missing code status or allergy
- Dangerous vital-sign instability
- Critical lab abnormality
- New oxygen requirement or respiratory instability
- AKI/hyperkalemia or other same-day action item
- Sepsis concern
- Active bleeding
- Altered mental status/delirium with safety concern
- Urgent pending imaging/procedure/consult
- Discharge-critical missing item

Do not create separate decorative boxes for routine labs, routine medications, routine imaging, or low-priority history. Put those into S/O/A/P where they belong.

## Clinical Completeness Rules in SOAP Form

The list does not need many sections, but it must not lose clinically important information. Preserve these data points by placing them into the appropriate SOAP section:

### S should capture
- Overnight events
- New symptoms
- Pain
- Dyspnea
- Chest pain
- Fever/chills
- Nausea/vomiting/diarrhea/constipation
- Urinary symptoms
- Sleep, appetite, oral intake
- Delirium, agitation, confusion
- Patient/family/nursing concerns

### O should capture
- Vital-sign trends
- Oxygen requirement
- I/O and urine output
- Weight trend when relevant
- CBC trend
- Renal function and electrolytes
- Liver tests/coagulation when relevant
- Glucose when relevant
- Inflammatory markers when relevant
- Microbiology and pending cultures
- Imaging/procedure updates
- Antibiotics and antibiotic day count
- Anticoagulation
- High-risk medications
- Lines, tubes, drains, devices

### A should capture
- Active problems by acuity
- Working diagnosis
- Clinical trajectory: improving, stable, worsening, unresolved
- Key evidence supporting the assessment
- Uncertainty when present

### P should capture
- Specific tasks today
- Medication changes
- Lab follow-up
- Imaging/procedure follow-up
- Consult follow-up
- Culture follow-up
- Device/line/tube management
- Patient/family communication tasks
- Discharge readiness and barriers
- Disposition and follow-up
- Contingency/escalation plan when relevant

## Missing Data Rules

Missing important data should appear inline in the SOAP list, not as a large separate administrative section unless it is high risk.

Examples:

```text
Header: Code: MISSING | Allergy: MISSING
O: No vitals documented after 20:00.
O: Cr/K not updated despite AKI risk.
P: Need to clarify discharge destination.
P: Need antibiotic day count/stop date.
```

High-priority missing data:

- Code status missing
- Allergy missing
- No recent vital signs for unstable patient
- No recent labs when AKI, hyperkalemia, sepsis, bleeding, DKA/HHS, arrhythmia, diuretic use, nephrotoxic drug, chemotherapy, or contrast exposure is relevant
- Antibiotic without indication, culture follow-up, day count, or planned duration
- No plan for a high-acuity active problem
- Discharge plan missing when discharge is expected soon

Never fill missing values by guessing.

## AI Assistance Rules

AI assistance should support SOAP summarization, not control the final UI layout.

Preferred flow:

```text
raw patient data
-> normalized patient model
-> clinical prioritization
-> optional AI SOAP summary
-> schema validation
-> deterministic SOAP renderer
-> print/list UI
```

AI output should be structured around SOAP:

```json
{
  "oneLiner": "",
  "headerAlerts": [],
  "subjective": [],
  "objective": [],
  "assessment": [],
  "plan": [],
  "missingData": [],
  "sourceRefs": [],
  "confidence": ""
}
```

Rules:

- AI must not invent symptoms, diagnoses, lab values, dates, medications, culture results, imaging findings, procedures, or plans.
- AI must preserve source-grounded clinical details.
- AI should mark uncertainty explicitly.
- AI should compress information into SOAP, not create many new categories.
- AI output should be schema-validated before rendering.
- If AI output is invalid, incomplete, or unsafe, fall back to deterministic SOAP rendering.
- The final patient list must remain usable when AI is disabled.
- AI-generated text must not overwrite structured patient data unless the user explicitly accepts the change.
- AI must not remove red flags, abnormal trends, pending tasks, discharge barriers, or missing critical data.

## Rendering Style Rules

The preferred UI should feel like a clean printed rounding sheet, not a dashboard.

Style priorities:

- Minimal boxes.
- Strong typography and spacing.
- Consistent SOAP labels.
- Compact lines.
- Red only for urgent or high-risk clinical signals.
- No decorative color coding.
- No excessive icons.
- No repeated labels if context is obvious.
- No long paragraphs unless needed for clinical clarity.

The renderer should prioritize readability during morning rounds and print output. If there is a conflict between visual novelty and clinical clarity, choose clinical clarity.

## Testing Rules

Every clinically meaningful change should include or update tests when feasible.

Important tests:

- SOAP renderer golden tests.
- Patient-data normalization tests.
- Clinical prioritization tests.
- Missing-data warning tests.
- Regression tests for fixed bugs.
- Smoke tests for add/edit/save/load/print workflows.
- AI contract tests using fake/de-identified patient fixtures.

Use fake data only. Do not commit real patient data into fixtures, logs, screenshots, prompts, or tests.

Good fake cases:

- Pneumonia with new oxygen requirement.
- AKI with hyperkalemia.
- UTI with delirium.
- Neutropenic fever risk.
- GI bleeding with anemia.
- Discharge-tomorrow patient with unresolved discharge checklist.
- NPO/NG/drain output patient.
- Stroke or focal neurologic deficit patient.
- Patient with missing code status and allergy.

## Bugfix Rules

For any bug:

1. Reproduce the bug using fake data.
2. Identify the root cause.
3. Add or update a regression test when possible.
4. Apply the smallest safe fix.
5. Run the relevant checks.
6. Report changed files and risk areas.

Do not fix bugs by deleting features, bypassing validation, hiding missing data, weakening clinical safety, or making the renderer less SOAP-consistent.

## Definition of Done

A task is done only when:

- The requested behavior works with fake data.
- The SOAP layout remains simple and scannable.
- Clinically important information is preserved inside S/O/A/P.
- Header safety items are preserved.
- Missing critical data is shown clearly.
- No real patient data is introduced.
- Build passes.
- Relevant tests pass, or missing tests are explicitly documented.
- Print output remains useful for rounds.
- The final diff is reviewed for accidental schema, Firebase, patient-data, or print-output behavior changes.
