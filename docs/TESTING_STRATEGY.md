# Testing Strategy

## Goal

讓 Codex 每次修 bug 或新增功能時，都能用測試保護 patient list 的醫療內容完整度與排版穩定性。

## Test layers

### 1. Unit tests

適合測：

- date / hospital day calculation
- lab trend formatting
- abnormal flag detection
- problem sorting
- redaction
- missing field detection
- schema validation
- markdown/html escaping

### 2. Golden tests

固定輸入 fake patient JSON，輸出固定 markdown 或 HTML。適合測：

- clinical content completeness
- formatting regression
- AI fallback behavior
- multi-patient sorting

範例：

```text
tests/fixtures/fake_patient_case_aki_pneumonia.json
tests/golden/fake_patient_case_aki_pneumonia.md
```

### 3. Prompt / AI contract tests

不要只人工看 prompt 好不好。要檢查：

- LLM response can be parsed as JSON
- schema valid
- every factual claim has sourceRefs
- no extra unsupported claims
- missing data correctly listed

### 4. Regression tests

每個 bug 都變成測試：

```text
Bug: CKD patient with Cr increase did not show AKI alert.
Test: fake_patient_case_aki_pneumonia should contain "AKI" top alert and Cr trend.
```

## Minimum fake patient cases

至少建立：

1. Stable uncomplicated pneumonia
2. Pneumonia + AKI
3. GI bleeding + anticoagulation
4. Post-op patient with drain
5. Discharge-ready patient with placement barrier
6. ICU patient with oxygen/pressor
7. Missing code status/allergy/med list
8. Malformed AI JSON fallback

## Example golden test assertion

Pseudo-code:

```ts
const input = loadFixture("fake_patient_case_aki_pneumonia.json");
const output = renderPatientList(input);

expect(output).toContain("72M");
expect(output).toContain("Pneumonia");
expect(output).toContain("Cr 2.1 <- 1.4");
expect(output).toContain("AKI");
expect(output).toContain("Blood cultures pending");
expect(output).toContain("Code status: 未提供");
expect(output).toMatchSnapshot();
```

## Bug report template

When asking Codex to fix a bug, include:

```text
Observed:
Expected:
Fixture:
Steps to reproduce:
Relevant files:
Non-goals:
Verification command:
```

## Definition of a good test

A good test fails before the fix and passes after the fix.

If Codex changes output, it must explain whether the diff is:
- intended product change
- bug fix
- formatting-only
- accidental regression
