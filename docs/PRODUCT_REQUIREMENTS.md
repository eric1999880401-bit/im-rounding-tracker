# Product Requirements — 查房 Patient List 系統

## 一句話目標

讓臨床團隊在查房前能快速取得每位住院病人的重點摘要、今日任務、風險提醒與出院障礙，並能以穩定格式列印或分享給授權醫療團隊成員。

## Primary users

- Clerk / intern / PGY / resident
- Chief resident
- Attending
- NP / PA / case manager, 若院內流程允許

## Non-goals

- 不做自動診斷。
- 不自動產生醫囑。
- 不取代醫師判斷。
- 不使用未授權的真實病人資料作為開發或測試資料。

## Core workflows

### Workflow 1：每日查房前產生 list

1. 使用者匯入或貼上病人資料。
2. 系統轉成 normalized patient model。
3. 系統用 deterministic rules 建立基本 list。
4. AI 只在允許範圍內補助摘要、重點排序或語句壓縮。
5. 使用者審閱並手動修正。
6. 輸出 markdown / HTML / PDF / print view。

### Workflow 2：快速找今日任務

每位病人必須能顯示：

- 今天一定要處理的任務
- pending studies
- consult follow-up
- discharge barriers
- overnight issues
- abnormal labs or vitals requiring attention

### Workflow 3：交班 / 接班

輸出需包含：

- 短 one-liner
- active problems
- contingency plan
- call parameters
- pending issues
- high-risk meds and devices

## Minimal viable feature set

### Must have

- 病人卡片式 list
- 可依 ward / team / acuity / discharge readiness 排序
- 必填欄位缺漏提示
- AI JSON output schema validation
- fake patient fixture tests
- golden output tests
- redaction mode
- print-friendly view

### Should have

- 支援 user-defined specialty templates
- 顯示 lab trend arrows or deltas
- 今日待辦清單自動彙整
- 可手動 pin important notes
- output diff review

### Could have

- EMR 匯入 adapter
- team-level dashboard
- resident handoff mode
- ICU mode / surgical mode / nephrology mode
- local-only LLM mode or hospital-approved model gateway

## Acceptance criteria

1. 給定同一份 fake patient input，輸出內容穩定。
2. 若資料缺漏，輸出會清楚列出缺漏，不會自行猜測。
3. 若 AI 失敗或 schema validation 失敗，仍可產生 deterministic fallback list。
4. 每一個 clinical bullet 可追溯到來源欄位或缺漏原因。
5. 排版能讓使用者在 10 秒內找到：
   - why admitted
   - current severity
   - overnight event
   - top active problems
   - today’s plan
   - discharge barrier
6. 測試覆蓋至少包含：
   - uncomplicated patient
   - AKI
   - pneumonia/sepsis
   - anticoagulation
   - discharge planning
   - missing critical fields
   - AI malformed response
