# Codex Prompt — Safe Refactor

任務：
<描述要重構的範圍>

目的：
<例如：把 AI summarizer 與 renderer 分離，讓 deterministic fallback 可測試>

必須保持不變：
- 既有 fake fixtures 的 golden output，除非我明確允許變更。
- patient list 必含內容。
- redaction behavior。
- AI schema validation behavior。

請執行：
1. 先找出目前資料流。
2. 提出小步驟 refactor plan。
3. 執行最小變更。
4. 更新測試。
5. 執行 test/lint/typecheck/build。
6. 用 diff summary 說明哪些是純重構、哪些是行為改變。

限制：
- 不新增功能。
- 不改 clinical content spec。
- 不改 prompt 除非重構必須。
