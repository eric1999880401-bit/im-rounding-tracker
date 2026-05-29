# Codex Prompt — AI Output Evaluation

請評估目前 AI patient summary prompt 與輸出流程是否符合 `docs/AI_OUTPUT_CONTRACT.md`。

請檢查：

1. 是否要求 JSON only。
2. 是否有 schema validation。
3. 是否要求每個 factual bullet 附 `sourceRefs`。
4. 是否處理 missing data。
5. 是否禁止 hallucination。
6. 是否有 deterministic fallback。
7. 是否有 fake fixtures / prompt tests。
8. 是否有 redaction mode。
9. 是否有對 AI malformed response 的測試。
10. 是否讓 AI 直接產生最終 HTML/markdown；若是，請提出改法。

請先只回報問題與建議，不要改程式。
