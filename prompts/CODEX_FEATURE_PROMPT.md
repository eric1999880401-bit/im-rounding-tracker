# Codex Prompt — Feature Implementation

任務：<用一句話描述要新增的功能>

背景：
- 這是查房 patient list 系統。
- 臨床內容規格見 `docs/CLINICAL_CONTENT_SPEC.md`。
- AI 輸出規格見 `docs/AI_OUTPUT_CONTRACT.md`。
- 測試策略見 `docs/TESTING_STRATEGY.md`。

需求：
1. <具體需求 1>
2. <具體需求 2>
3. <具體需求 3>

驗收條件：
- [ ] 給定 fixture `<fixture file>`，輸出必須包含 `<expected content>`。
- [ ] 缺漏資料必須顯示為 `<expected missing message>`。
- [ ] 不得新增輸入中沒有的醫療事實。
- [ ] 新增或更新測試。
- [ ] 執行 test/lint/typecheck/build，並回報結果。

限制：
- 只做這個功能，不做大型重構。
- 不修改無關 UI。
- 不加入真實病人資料。
- 若發現架構需要重構，先提出最小重構計畫，不要直接大改。
