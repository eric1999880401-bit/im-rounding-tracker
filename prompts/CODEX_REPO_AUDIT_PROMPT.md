# Codex Prompt — Repo Audit

請你先不要修改任何程式碼。請閱讀本 repo，尤其是：

- `AGENTS.md`
- `docs/PRODUCT_REQUIREMENTS.md`
- `docs/CLINICAL_CONTENT_SPEC.md`
- `docs/AI_OUTPUT_CONTRACT.md`
- `docs/TESTING_STRATEGY.md`

然後回報：

1. 目前專案架構摘要：資料從輸入到輸出的流程。
2. 最可能導致 patient list 缺漏重點的 5 個位置。
3. 最可能導致 bug 的 5 個位置。
4. 目前缺少哪些測試。
5. 建議的第一個最小 PR。
6. 請補上本專案實際 install/test/lint/typecheck/build 指令到 `AGENTS.md`，但除非你能確認指令，否則只提出建議，不要硬填。

限制：

- 不要重構。
- 不要改 UI。
- 不要新增套件，除非你能說明必要性。
- 不要使用真實病人資料。
