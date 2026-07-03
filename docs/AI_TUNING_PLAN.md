# AI Output Tuning Plan — 讓 AI 跟上你的修改，而不是你一直改 AI

Status: proposal (2026-07-03). Goal: every correction you make should either be
learned automatically or turned into a permanent rule + regression test, so the
same fix never has to be made twice.

## 現況（已存在的機制）

1. **userStyleProfile**（`src/userPreferences.ts` → `buildUserAiStyleProfile`）:
   從你標記為 reviewed 的 SOAP 中統計出縮寫偏好、A/P 題數/行數/語氣、任務長度，
   隨每次 SOAP 生成送進 prompt（`makeRoundSoapPrompt` 的 style profile 區塊）。
   限制：只學「形狀」（長度、縮寫、組織方式），學不到「內容修正」
   （例如你總是把某種寫法改成另一種寫法）。
2. **soapDeltaGuardrails**: daily update 模式保護你已審閱的 baseline，
   AI 只能加/改有來源依據的行。
3. **確定性改寫層**（`aiPostprocess/planConcretizer`、`genericFiller`）:
   已知的壞模式（籠統 plan、filler）不靠模型自覺，直接改寫/過濾。
4. **clinical-eval 45 案例**: prompt 或程式改動的回歸防線。

## 缺的一塊：你的修改沒有被系統性回收

你每天在 app 裡把 AI 草稿改成最終版，這些「AI 寫的 → 你改成的」配對是最有價值的
訓練訊號，但目前只有間接統計（style profile），沒有逐條學習。

## 計畫（按投資報酬排序）

### 1. 風格修正快速通道（不用寫程式，現在就能做）

你貼「AI 寫的 vs 我改成的」去識別化範例給 Claude（這個 repo 的 session），
由 Claude 把差異固化成三層：
- prompt 規則（`functions/src/prompts.ts`）
- 確定性改寫（`aiPostprocess/`，適合逐字替換型的修正）
- eval 案例（把你的最終版當 golden，永遠不再回退）

每次 1-3 個範例就夠，重複 2-3 輪就能收斂大部分格式問題。
**這是短期內讓你「不用再大改」最有效的一步。**

### 2. Golden style fixtures（把你的理想輸出變成測試）

- 新增 `tests/style/`：每個案例一組（去識別化輸入、AI 草稿、你的最終版）。
- eval 增加斷言：對這些輸入重跑本地 pipeline 後，輸出必須保留你最終版的
  關鍵格式特徵（admission brief 的片段式格式、A/P 標題風格、符號使用）。
- 效果：以後任何 prompt/程式調整，先在 CI 撞到你的 golden 標準才會上線。

### 3. Draft-vs-final diff 回收（要寫程式，中期）

- 存檔時（`soapStatus` → reviewed）計算 AI 草稿與最終版的行級 diff，
  存進 Firestore（`aiDrafts` 已存草稿，補存 finalText + 摘要 diff）。
- Settings 頁加「更新我的 AI 風格」動作：把近 N 次 diff 蒸餾成
  `preferredTerms` / `bannedPhrases` / 常見替換對，寫回 userStyleProfile。
- `buildUserAiStyleProfile` 擴充輸出這些欄位；`makeRoundSoapPrompt` 已會把
  profile 全文帶入，Functions 端只需在 prompt 中強調 bannedPhrases。

### 4. 逐字替換學習（自動長大的 concretizer，長期）

- 從 diff 中挖出「重複 ≥3 次的同樣替換」（例如你每次都把 X 改成 Y），
  自動加入使用者層級的 rewrite map（存在 userPreferences，
  生成後套用，如同 planConcretizer 但屬於你個人）。
- 風險控制：只做整行/整詞替換、只在完全比對時觸發、UI 可檢視/刪除。

## 執行順序建議

| 步驟 | 需要你做什麼 | 需要寫程式 | 何時 |
| --- | --- | --- | --- |
| 1 快速通道 | 貼 1-3 組 before/after 範例 | 否（Claude 改 prompt/map/eval） | 現在 |
| 2 Golden fixtures | 提供 2-3 個理想輸出範本 | 小 | 下一輪 |
| 3 Diff 回收 | 照常用 app | 中 | 之後 |
| 4 個人 rewrite map | 照常用 app | 中 | 之後 |

## 注意事項

- 所有範例必須去識別化（假床號/無名字/無病歷號）。
- 個人化學習只能改「風格與措辭」，不能改臨床事實層的 guardrails。
- 每輪調整都要過 `npm run clinical:eval`，避免為了風格犧牲安全規則。
