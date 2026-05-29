# Codex Prompt — Bug Fix

Bug：
<描述 bug>

Observed：
<目前實際輸出或行為>

Expected：
<正確輸出或行為>

Fixture / reproduction：
<貼 fixture 路徑或重現步驟>

Relevant files：
<若知道，列出檔案；不知道就寫 unknown>

Non-goals：
- 不重寫整個 renderer。
- 不改變無關排版。
- 不新增真實病人資料。
- 不讓 AI 補未提供資訊。

請執行：
1. 找出 root cause。
2. 先新增一個會失敗的 regression test 或 golden test。
3. 做最小修正。
4. 執行測試。
5. 回報：
   - root cause
   - 修改檔案
   - 測試結果
   - 剩餘風險
