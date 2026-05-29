# AI Output Contract

## Purpose

AI 可以協助把半結構化資料整理成 concise clinical bullets，但 AI 輸出必須被 schema 驗證、可追溯、可 fallback。AI 不應直接產生最終醫療事實。

## Recommended pipeline

```text
Input data
  -> redact / normalize
  -> deterministic extraction
  -> LLM JSON draft
  -> schema validation
  -> factuality guard against input
  -> deterministic renderer
  -> human review
```

## Required AI behavior

1. Do not invent facts.
2. Use only provided data.
3. Mark missing fields explicitly.
4. Prefer concise bullets.
5. Attach `sourceRefs` to every factual statement.
6. Attach `confidence` when summarization or inference is involved.
7. Return valid JSON only.
8. Never produce medical orders.
9. Never hide uncertainty.

## Suggested JSON shape

```json
{
  "patientId": "fake-001",
  "oneLiner": {
    "text": "72M with CKD admitted for pneumonia, now with improving oxygen need and AKI.",
    "sourceRefs": ["demographics.age", "demographics.sex", "problems.0", "labs.creatinine"]
  },
  "topAlerts": [
    {
      "label": "AKI",
      "severity": "high",
      "text": "Cr 2.1 from 1.4",
      "sourceRefs": ["labs.creatinine"],
      "confidence": 0.9
    }
  ],
  "sections": [
    {
      "title": "Overnight",
      "bullets": [
        {
          "text": "Tmax 38.5 overnight; blood cultures pending.",
          "sourceRefs": ["vitals.temperature", "micro.bloodCulture"],
          "confidence": 0.95
        }
      ]
    }
  ],
  "missingData": [
    {
      "field": "codeStatus",
      "reason": "not provided in input",
      "severity": "critical"
    }
  ]
}
```

## Validation rules

AI output is invalid if:

- JSON parse fails.
- Required keys missing.
- Any factual bullet lacks `sourceRefs` or `missingReason`.
- It includes diagnosis, medication, lab value, imaging finding, or timeline not present in input.
- It gives instructions that look like independent medical orders.
- It contains real identifiers in a redacted mode.

## Fallback behavior

If AI output is invalid:

1. Log redacted validation error.
2. Use deterministic renderer.
3. Display warning badge:
   ```text
   AI summary unavailable; deterministic list generated.
   ```
4. Preserve user ability to edit.

## System prompt for summarizer

See `prompts/LLM_PATIENT_SUMMARY_SYSTEM_PROMPT.md`.

## Evaluation checklist

For every AI-generated list, reviewers should ask:

- Does it include why the patient is admitted?
- Does it include what changed overnight?
- Does it include current severity?
- Does it include abnormal vitals/labs relevant to plan?
- Does it include today’s concrete tasks?
- Does it include discharge barriers?
- Did it invent anything?
- Are missing code status/allergy/medications clearly flagged?
