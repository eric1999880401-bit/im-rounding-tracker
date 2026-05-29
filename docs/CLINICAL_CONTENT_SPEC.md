# Clinical Content Spec — Patient List 必含內容

> 此文件定義 patient list「應該包含什麼」。Codex 修改程式時，不能只讓輸出變漂亮，必須維持臨床資訊完整度。

## 1. Patient header

每位病人頂部應包含：

| 欄位 | 必要性 | 範例 |
|---|---:|---|
| Ward / bed | required | 8A-12 |
| Name display or redacted ID | required | 王○○ / P003 |
| Age / sex | required | 72M |
| Hospital day | preferred | HD#5 |
| Service / team | preferred | GI team |
| Attending / resident | optional | Dr. Chen |
| Code status | required if available | DNR / Full code |
| Allergy | required if available | PCN allergy |
| Isolation | required if available | contact isolation |

## 2. One-liner

格式：

```text
[age][sex] with [key PMH] admitted for [reason], now [current main issue/status].
```

規則：

- 不超過 25–35 個中文字或 25 個英文單字，除非病情複雜。
- 僅使用輸入資料中存在的診斷與病史。
- 優先包含會改變處置的 PMH：
  - CKD / ESRD
  - CHF / CAD
  - COPD / chronic respiratory failure
  - DM
  - cirrhosis
  - malignancy
  - immunosuppression / transplant
  - anticoagulation indication
  - pregnancy, if relevant

## 3. Acuity flags

若出現以下狀況，應在 patient header 或 top alerts 顯示：

### Vital / respiratory

- hypotension or shock
- fever or hypothermia
- tachycardia with clinical concern
- new oxygen requirement
- escalating oxygen support
- ventilator / airway issue
- SpO2 below target range if documented

### Lab / organ dysfunction

- AKI or worsening creatinine
- hyperkalemia / hypokalemia
- hyponatremia / hypernatremia
- metabolic acidosis
- severe anemia or active bleeding concern
- thrombocytopenia with bleeding/procedure relevance
- supratherapeutic INR or anticoagulation concern
- lactate elevation if available

### Infection

- suspected sepsis
- positive blood culture
- broad-spectrum antibiotics
- source control pending
- isolation precautions

### Safety / disposition

- fall risk / delirium / restraint, if documented
- pending procedure
- discharge barrier
- new consult request
- unclear code status
- critical missing data

## 4. Daily ward-round body

建議以以下順序輸出：

```text
[Header]
One-liner
Overnight / interval events
Vitals / I&O / diet
Labs / Micro / Imaging
Active problems and plan
Meds / devices / lines
To-do today
Discharge / disposition
Contingency
Missing data
```

## 5. Overnight / interval events

必須優先呈現：

- fever
- pain crisis
- desaturation
- hypotension
- fall
- bleeding
- chest pain
- altered mental status
- new consult recommendation
- procedure result
- transfer to/from ICU
- new antibiotics or high-risk meds
- any nurse call or rapid response event

## 6. Objective data

### Vitals

呈現最近值與有意義趨勢：

```text
Tmax 38.5, BP 95/60–128/76, HR 102–118, SpO2 93% on NC 3 L
```

不可只列一堆數字。請優先突出異常與趨勢。

### Intake / output

若相關，應包含：

- urine output
- net balance
- drain output
- stool count
- emesis
- body weight trend
- dialysis / ultrafiltration

### Labs

以 problem-oriented 方式呈現，不要無腦貼所有 lab。

範例：

```text
Cr 2.1 <- 1.4, K 5.6, WBC 15 <- 11, Hb stable 9.8
```

規則：

- 有 timestamp 更好。
- 趨勢符號必須有一致語意。
- 單位不清楚時不要自行補單位。
- 危急值或明顯異常應加 flag。

### Microbiology

感染相關病人應包含：

- culture source
- collection date/time
- result
- susceptibilities if available
- current antimicrobial and day count
- source control status

### Imaging / procedures

只列跟目前處置相關或新結果：

- new/worsening finding
- pending final read
- procedure complication
- line/tube placement confirmation

## 7. Active problem list

每個 active problem 建議格式：

```text
# Problem name
- Status: improving / stable / worsening / unclear
- Evidence: key data only
- Plan today: concrete tasks
- Contingency: when to call / what to monitor, if relevant
```

問題排序：

1. Life-threatening / unstable
2. Reason for admission
3. Active inpatient problems
4. Chronic diseases affecting management
5. Discharge barriers

## 8. Medication highlights

不用列完整 MAR，除非使用者要求。必須提示：

- antibiotics with indication and day count
- anticoagulants / antiplatelets
- insulin regimen if diabetes or hyperglycemia relevant
- steroids / immunosuppressants
- vasopressors / sedatives / opioids
- nephrotoxic meds if AKI
- held home meds with reason if relevant

## 9. Devices / lines / tubes / drains

必要時列出：

- Foley
- central line / PICC
- arterial line
- NG / PEG
- chest tube
- surgical drains
- wound VAC
- ostomy
- dialysis catheter

格式：

```text
Lines/Drains: Foley D3, JP drain 40 mL/day, PICC R arm
```

## 10. To-do today

每位病人至少嘗試輸出一個 today task。若沒有資料，顯示「未提供 today tasks」。

好的 task 應該具體：

- follow BMP 14:00
- call ID after blood culture susceptibility
- remove Foley if voiding trial ok
- PT eval for discharge
- clarify code status with family
- arrange home oxygen evaluation

避免空泛：

- monitor
- follow up
- continue treatment

## 11. Discharge planning

若住院病人接近穩定，應包含：

- estimated discharge date if available
- barrier: oxygen / IV antibiotics / placement / PT / pending imaging / lab stability
- destination: home / SNF / rehab / hospice / transfer
- follow-up appointments
- medication reconciliation issues

## 12. Contingency / call parameters

適合交班或值班情境：

```text
Call if SBP < 90, SpO2 < 90% despite O2 escalation, UOP < 0.5 mL/kg/hr, fever with rigors.
```

只能根據輸入資料或院內常規模板產生；若資料不足，標示需人工補齊。

## 13. Missing data report

系統應列出 critical missing fields，例如：

- code status missing
- allergy missing
- no recent vitals
- no active problem list
- no medication list
- no plan today
- no discharge barrier documented

## 14. Specialty add-ons

### General medicine

- problem-based assessment and plan
- high-risk chronic disease interactions
- discharge barrier

### Surgery

- post-op day
- procedure
- wound / drain output
- diet advancement
- pain control
- antibiotics
- DVT prophylaxis
- pathology pending

### ICU

- airway / vent settings
- hemodynamics / pressors
- sedation / analgesia
- lines
- I&O / renal replacement therapy
- infection / antimicrobials
- nutrition
- prophylaxis bundle
- goals of care

### Nephrology

- baseline Cr / eGFR if available
- current Cr trend
- urine output
- electrolytes / acid-base
- dialysis access and schedule
- nephrotoxin exposure
- volume status

### Infectious disease

- syndrome / source
- organism
- culture date
- antibiotic day count
- susceptibility
- source control
- planned duration
