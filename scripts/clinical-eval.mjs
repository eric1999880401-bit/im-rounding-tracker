import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  root: process.cwd(),
  server: { middlewareMode: true },
});

const {
  applyClinicalKnowledgeToAiSoapDraft,
  applyClinicalKnowledgeToPatientImportDraft,
  applyClinicalKnowledgeToText,
  formatRuleBasedAdmissionSummary,
  formatRuleBasedSbar,
  formatRuleBasedWeeklySummary,
} = await server.ssrLoadModule("/src/clinicalKnowledge.ts");
const { formatClinicalDocumentDraft } = await server.ssrLoadModule("/src/clinicalDocumentFormat.ts");
const { emptyPatient, getLabFocusSummary, parseLabText, textToItems, todayKey, nowIso, createId } = await server.ssrLoadModule("/src/utils.ts");
const { getRoundingDigest } = await server.ssrLoadModule("/src/roundingDigest.ts");
const { buildConcisePatientClinicalUpdate } = await server.ssrLoadModule("/src/clinicalPatientPolish.ts");
const { sanitizeAiSoapDraftForReview } = await server.ssrLoadModule("/src/aiDraftSanitizer.ts");
const { routePatientImportDraft, routePatientClinicalFields } = await server.ssrLoadModule("/src/clinicalFieldRouter.ts");

function haystack(plan) {
  return [
    ...plan.redFlags.map((item) => `${item.text} ${item.reason}`),
    ...plan.todayTasks.map((item) => `${item.text} ${item.reason}`),
    ...plan.problemBasedAP.map((item) => `${item.problemTitle} ${item.assessmentSummary} ${item.planItems.join(" ")}`),
    plan.printSummary,
    plan.sbarRecommendation,
  ].join("\n");
}

function assertMatch(plan, pattern, label) {
  if (!pattern.test(haystack(plan))) {
    throw new Error(`Expected ${label}: ${pattern}`);
  }
}

function assertNoMatch(plan, pattern, label) {
  if (pattern.test(plan.redFlags.map((item) => `${item.text} ${item.reason}`).join("\n"))) {
    throw new Error(`Unexpected red flag ${label}: ${pattern}`);
  }
}

function assertSbarReadable(plan) {
  const sbar = formatRuleBasedSbar(plan);
  if (/Rule-matched/i.test(sbar)) {
    throw new Error("SBAR should not expose internal rule-matched wording");
  }
  if (!/Assessment:\n- /i.test(sbar) || !/Recommendation:\n- /i.test(sbar)) {
    throw new Error("SBAR should use readable problem/task bullets");
  }
}

function assertDocumentIncludes(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`Expected ${label}: ${pattern}\n${value}`);
  }
}

function assertCount(plan, selector, expected, label) {
  const actual = selector(plan);
  if (actual !== expected) {
    throw new Error(`Expected ${label} = ${expected}, got ${actual}`);
  }
}

function assertNoProblem(plan, pattern, label) {
  const problems = plan.problemBasedAP.map((item) => item.problemTitle).join("\n");
  if (pattern.test(problems)) {
    throw new Error(`Unexpected problem ${label}: ${pattern}`);
  }
}

const cases = [
  {
    name: "AIS without reperfusion BP below 220/120 is not urgent uncontrolled BP",
    text: "72/M acute ischemic stroke NIHSS 3, BP 168/92, no tPA/EVT. Dysarthria, f/u MRI/MRA brain and swallow screen.",
    expect(plan) {
      assertNoMatch(plan, /uncontrolled BP|BP 168\/92/i, "permissive BP false alarm");
      assertMatch(plan, /swallow|imaging|antithrombotic|statin/i, "stroke handoff task");
    },
  },
  {
    name: "AIS post thrombolysis high BP is safety signal",
    text: "AIS post tPA, BP 190/110, f/u CT brain and neuro checks.",
    expect(plan) {
      assertMatch(plan, /BP 190\/110|reperfusion/i, "post thrombolysis BP warning");
    },
  },
  {
    name: "Sepsis shock preserves cultures, antibiotics, lactate and source control",
    text: "Sepsis due to pneumonia, BP 82/48, lactate 4.6, norepi started. B/C pending, ceftriaxone + azithro, need source control review.",
    expect(plan) {
      assertMatch(plan, /sepsis\/shock|cultures|antibiotic|lactate|source control/i, "sepsis bundle handoff");
    },
  },
  {
    name: "Pneumonia on antibiotics keeps O2 and de-escalation tasks",
    text: "PNA with fever and SpO2 91 on NC 3L. Ceftriaxone started. f/u sputum culture and fever curve, consider de-escalation.",
    expect(plan) {
      assertMatch(plan, /O2|culture|Abx|de-escalation|fever/i, "pneumonia handoff");
    },
  },
  {
    name: "HF exacerbation keeps volume, I/O, renal and K monitoring",
    text: "Acute decompensated HF, pulmonary edema, leg edema, IV furosemide. Strict I/O, daily weight, Cr 1.8, K 3.4.",
    expect(plan) {
      assertMatch(plan, /volume|I\/O|diuresis|Cr\/K|renal|electrolyte/i, "HF monitoring");
    },
  },
  {
    name: "AKI with hyperkalemia triggers renal safety",
    text: "AKI on CKD, Cr 3.2 from 1.5, K 6.2, oliguria. Hold ACEi, review contrast and renal consult.",
    expect(plan) {
      assertMatch(plan, /AKI\/electrolyte|K|Cr|I\/O|nephrotoxin|renal consult/i, "AKI hyperK safety");
    },
  },
  {
    name: "GI bleed with low Hb keeps transfusion/endoscopy/antithrombotic plan",
    text: "Melena with Hb 6.8, BP 96/58. PRBC transfusion, EGD pending, hold anticoagulation.",
    expect(plan) {
      assertMatch(plan, /bleeding|Hb|transfusion|endoscopy|anticoag/i, "GI bleed tasks");
    },
  },
  {
    name: "Neutropenic fever is high risk",
    text: "Lymphoma on chemotherapy, fever 38.6, ANC 200. Blood cultures drawn, cefepime, isolation, contact oncology and ID.",
    expect(plan) {
      assertMatch(plan, /Febrile neutropenia|ANC|cultures|broad-spectrum|isolation|onc\/ID/i, "neutropenic fever safety");
    },
  },
  {
    name: "Resolved neutropenic fever with persistent leukopenia leads SBAR and weekly focus",
    text: "H11-032 Ramsay Hunt, suspected neutropenic fever now afebrile after antibiotics. WBC 1.6k still low, SLE on dexamethasone, INF take over, f/u ANC and cultures.",
    expect(plan) {
      assertDocumentIncludes(formatRuleBasedSbar(plan), /^Situation: .*neutropenic fever.*WBC 1\.6k/im, "SBAR situation should lead with neutropenic fever and WBC");
      assertDocumentIncludes(formatRuleBasedWeeklySummary(plan), /Current focus: .*neutropenic fever.*WBC 1\.6k/i, "weekly focus should lead with neutropenic fever and WBC");
    },
  },
  {
    name: "Mild anemia and normal oxygen do not create unrelated A/P",
    text: "Ramsay Hunt improving, afebrile. WBC 1.6k, Hb 11.7, SpO2 99% RA, moderate TR with pulmonary hypertension.",
    expect(plan) {
      assertNoProblem(plan, /Pulmonary \/ O2/i, "normal SpO2/pulmonary HTN false positive");
      assertNoProblem(plan, /Bleeding \/ anemia/i, "mild anemia false positive");
    },
  },
  {
    name: "Stable vitals only do not create fake A/P",
    text: "V/S only: BP 128/76, HR 78, RR 16, SpO2 97% RA, afebrile, comfortable.",
    expect(plan) {
      assertCount(plan, (next) => next.redFlags.length, 0, "red flags");
      assertCount(plan, (next) => next.problemBasedAP.length, 0, "A/P");
    },
  },
  {
    name: "Mixed messy handover produces actionable review without saving anything",
    text: "Bed A12: 68/F PNA on ceftriaxone, O2 NC 2L, f/u B/C. Bed A13: AKI Cr 2.8 K 5.7, strict I/O, hold ACEi, discharge to rehab pending.",
    expect(plan) {
      assertMatch(plan, /culture|Cr\/K|I\/O|discharge|rehab/i, "mixed handover actions");
      assertSbarReadable(plan);
    },
  },
  {
    name: "COPD exacerbation keeps CO2, bronchodilator, steroid and NIV threshold",
    text: "COPD AE with wheezing, VBG pCO2 68, SpO2 90% on NC 2L. Methylpred and bronchodilator neb started, BiPAP if worsening.",
    expect(plan) {
      assertMatch(plan, /COPD\/asthma|CO2|bronchodilator|steroid|VBG|NIV|BiPAP|O2/i, "COPD hypercapnia handoff");
    },
  },
  {
    name: "PE concern preserves imaging, RV strain and anticoag bleeding tradeoff",
    text: "Pleuritic chest pain with D-dimer high, PE concern, CTPA pending. Hb 7.8, Plt 72, apixaban held; check troponin/BNP and Echo RV strain.",
    expect(plan) {
      assertMatch(plan, /PE|CTPA|RV strain|trop|BNP|anticoag|bleeding|Plt/i, "PE anticoag tradeoff");
    },
  },
  {
    name: "DKA physiology preserves gap, K, insulin, IVF and transition",
    text: "DKA: glucose 520, anion gap 24, HCO3 12, pH 7.18, K 5.2, urine ketone positive. Insulin drip and IVF, transition when gap closed.",
    expect(plan) {
      assertMatch(plan, /DKA|anion gap|HCO3|pH|K|insulin|IVF|transition/i, "DKA structured plan");
    },
  },
  {
    name: "Severe hyponatremia with confusion keeps Na correction safety",
    text: "Hyponatremia Na 118 with confusion/AMS. Check serum osm, urine osm/Na, volume status and correction rate.",
    expect(plan) {
      assertMatch(plan, /Na 118|correction rate|osm|volume status|Severe Na/i, "severe sodium handoff");
    },
  },
  {
    name: "UGIB on anticoag keeps PPI, EGD, transfusion and antithrombotic plan",
    text: "UGIB with melena on apixaban, Hb 6.9, BP 94/60. Pantoprazole/PPI, T&S PRBC transfusion, EGD pending; hold anticoag.",
    expect(plan) {
      assertMatch(plan, /UGIB|PPI|EGD|transfusion|T&S|anticoag/i, "UGIB plan");
    },
  },
  {
    name: "Tumor lysis risk keeps uric acid, phosphate, K, Cr and heme plan",
    text: "DLBCL after chemotherapy with TLS concern: uric acid 12, Phos 6.8, K 5.8, Cr 2.1, LDH high. Hydration, allopurinol/rasburicase review, contact heme.",
    expect(plan) {
      assertMatch(plan, /TLS|uric|Phos|K|Cr|hydration|rasburicase|heme/i, "TLS safety plan");
    },
  },
  {
    name: "Stable DM with normal glucose does not create endocrine A/P",
    text: "PMH DM and HTN. Today eating well, glucose 132, V/S stable, no insulin change needed.",
    expect(plan) {
      assertNoProblem(plan, /Glucose|DKA|Hypogly/i, "stable DM false positive");
    },
  },
  {
    name: "Complex ICU transfer activates multi-specialty knowledge without fake neuro issue",
    text:
      "76F ICU transfer after cholangitis septic shock s/p ERCP stent. PMH CKD3b, COPD, HFrEF EF35, AF on apixaban before admission, old lacunar infarct. ICU course: norepi, intubation, CRRT, vanco/mero. Now off pressor, extubated, CRRT stopped. Today weak cough, intermittently confused, afebrile. VS BP 106/64 HR 104 irreg RR22 SpO2 93 NC2L. Lab WBC 13.2 from 25.4, Hb 8.4, Plt 64, Cr 2.7 from peak 5.8, K 5.3, Na 130, VBG pCO2 58, lactate 1.4, Troponin I 0.085 ng/mL to 0.052 ng/mL. Sputum Klebsiella sensitivity pending. CXR RLL aspiration opacity improving. CT AP biliary stent no abscess. Echo EF35. Head CT no ICH. Tasks f/u Cx/Abx de-escalation, Cr/K/UO, renal-dose meds, O2 wean, bronchodilator, swallow eval, restart anticoag only after Hb/Plt review.",
    expect(plan) {
      assertMatch(plan, /source control|ERCP|Abx|culture|de-escalation/i, "ICU sepsis/source-control handoff");
      assertMatch(plan, /AKI|Cr\/K|I\/O|renal|nephrotoxin/i, "ICU renal handoff");
      assertMatch(plan, /COPD\/asthma|CO2|bronchodilator|VBG|NIV|O2/i, "ICU COPD/CO2 handoff");
      assertMatch(plan, /HFrEF|GDMT|contraindications|anticoag|Plt|bleeding/i, "ICU cardio/heme tradeoff");
      assertNoProblem(plan, /Stroke \/ neuro deficit/i, "old infarct/no ICH false active neuro problem");
    },
  },
];

const failures = [];
let supplementalPasses = 0;
for (const item of cases) {
  try {
    const plan = applyClinicalKnowledgeToText(item.text);
    item.expect(plan);
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failures.push({ name: item.name, error: error instanceof Error ? error.message : String(error) });
    console.error(`FAIL ${item.name}: ${failures[failures.length - 1].error}`);
  }
}

try {
  const reasoningDraft = applyClinicalKnowledgeToAiSoapDraft(
    {
      oneLiner: "Ramsay Hunt",
      admissionSummary: "Patient is stable. Continue current management.",
      isbarHandoff: "Situation: Ramsay Hunt\nAssessment: stable\nRecommendation: monitor closely",
      clinicalReasoning: {
        currentClinicalState: "Ramsay Hunt treated with Abx/antiviral; fever resolved but WBC remains low.",
        primaryRisk: "Resolved neutropenic fever / leukopenic infection risk with WBC 1.6k",
        whyThisMatters: [
          { fact: "WBC 1.6k", source: "latest lab", implication: "persistent leukopenia despite defervescence" },
          { fact: "INF take over", source: "handover task", implication: "infection plan still active" },
        ],
        activeProblemsRanked: [
          {
            problem: "Neutropenic fever / leukopenia",
            status: "improving",
            whyImportant: "Afebrile now but WBC remains severely low; infection can recur or be masked.",
            evidence: ["WBC 1.6k", "afebrile after treatment", "INF take over"],
            todayPlan: ["f/u ANC/WBC recovery", "confirm culture result and Abx duration", "clarify isolation threshold"],
            callThresholds: ["fever recurrence or unstable V/S"],
          },
        ],
        resolvedOrLessImportant: ["headache improving"],
        missingDataNeeded: ["ANC", "culture result", "Abx stop/de-escalation plan"],
        noiseToIgnore: ["routine normal V/S"],
      },
      subjective: { chiefConcern: "", symptoms: [], overnightEvents: [], importantSymptoms: [], importantOvernightEvents: [] },
      objective: { vitals: [], bloodSugars: [], physicalExam: [], labs: [], images: [] },
      assessmentPlan: [],
      redFlags: [],
      tasks: [],
      dischargeIssues: [],
      thinkingPrompts: [],
      uncertainty: [],
    },
    "",
  );
  if (!/^Situation: Resolved neutropenic fever \/ leukopenic infection risk with WBC 1\.6k/im.test(reasoningDraft.isbarHandoff)) {
    throw new Error("reasoning-driven SBAR did not lead with primary risk");
  }
  if (/monitor closely|continue current management/i.test(reasoningDraft.isbarHandoff)) {
    throw new Error("reasoning-driven SBAR retained generic filler");
  }
  if (!/clarify ANC/i.test(reasoningDraft.thinkingPrompts.map((item) => item.prompt).join("\n"))) {
    throw new Error("reasoning missing-data prompts were not surfaced");
  }
  console.log("PASS Reasoning-driven SOAP overrides generic AI prose");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Reasoning-driven SOAP overrides generic AI prose", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Reasoning-driven SOAP overrides generic AI prose: ${failures[failures.length - 1].error}`);
}

try {
  const icuTransferReasoning = {
    currentClinicalState:
      "ICU transfer after cholangitis septic shock; off pressor/CRRT but aspiration PNA, AKI/hyperK, thrombocytopenia and anticoag decision remain active.",
    primaryRisk: "Ward transfer after septic shock with AKI/hyperK, O2/aspiration risk, and Plt-limited anticoag decision",
    whyThisMatters: [
      { fact: "s/p ERCP stent, off pressor", source: "ICU course", implication: "source controlled but Abx/Cx plan still needs closure" },
      { fact: "Cr 2.9, K 5.4", source: "latest labs", implication: "renal recovery incomplete; hyperK can change orders overnight" },
      { fact: "Plt 78 and AF previously on apixaban", source: "PMH/labs", implication: "anticoag restart needs bleeding-risk review" },
    ],
    activeProblemsRanked: [
      {
        problem: "Resolving cholangitis/sepsis",
        status: "improving",
        whyImportant: "ERCP source control done, but Cx/Abx de-escalation and recurrent fever threshold remain important.",
        evidence: ["ERCP stent", "off pressor", "sputum Cx pending"],
        todayPlan: ["f/u Cx/Abx de-escalation", "confirm no abscess/source-control issue"],
        callThresholds: ["fever recurrence or SBP <90"],
      },
      {
        problem: "AKI on CKD with hyperK",
        status: "improving",
        whyImportant: "Off CRRT but Cr/K still unsafe enough to affect renal dosing and telemetry/lab cadence.",
        evidence: ["Cr 2.9 from peak 5.6", "K 5.4"],
        todayPlan: ["trend Cr/K/UO", "renal-dose Abx and hold nephrotoxins"],
        callThresholds: ["K rising, oliguria, ECG change"],
      },
      {
        problem: "Aspiration PNA / O2 need",
        status: "improving",
        whyImportant: "Extubated but still needs NC O2 and swallow/aspiration plan before safe disposition.",
        evidence: ["SpO2 94 NC3L", "RLL infiltrate improving"],
        todayPlan: ["O2 wean", "swallow eval and aspiration precaution"],
        callThresholds: ["worsening hypoxia or CO2 retention"],
      },
      {
        problem: "AF anticoag vs thrombocytopenia",
        status: "uncertain",
        whyImportant: "Stroke prevention competes with bleeding risk while Plt is still low after ICU course.",
        evidence: ["AF on apixaban before admission", "Plt 78"],
        todayPlan: ["restart anticoag only after Hb/Plt/bleed review"],
        callThresholds: ["bleeding, Plt drop, new neuro deficit"],
      },
    ],
    resolvedOrLessImportant: ["Head CT no ICH is a negative image result, not an active neuro problem."],
    missingDataNeeded: ["Abx stop/de-escalation date", "anticoag restart threshold", "disposition/rehab target"],
    noiseToIgnore: ["routine normal vitals", "old CVA without new focal deficit", "negative head CT wording"],
  };
  const baseDraft = {
    title: "AI document draft",
    conciseSummary: "Patient is stable. Continue current management.",
    clinicalReasoning: icuTransferReasoning,
    sections: [
      { heading: "Summary", content: "Patient is stable. Continue current management." },
      { heading: "Recommendation", content: "Monitor closely." },
    ],
    followUpItems: ["monitor closely"],
    uncertainty: [],
  };
  const admission = formatClinicalDocumentDraft({ ...baseDraft, documentType: "admissionSummary" });
  const weekly = formatClinicalDocumentDraft({ ...baseDraft, documentType: "weeklySummary" });
  const sbar = formatClinicalDocumentDraft({ ...baseDraft, documentType: "isbar" });
  const combined = `${admission}\n${weekly}\n${sbar}`;
  if (/continue current management|monitor closely/i.test(combined)) {
    throw new Error(`shared document formatter retained generic filler: ${combined}`);
  }
  if (/negative head CT wording|old CVA without new focal deficit/i.test(combined)) {
    throw new Error(`shared document formatter leaked noise-to-ignore content: ${combined}`);
  }
  assertDocumentIncludes(admission, /AKI\/hyperK|Plt-limited anticoag|aspiration risk/i, "admission summary should lead with current transfer risks");
  assertDocumentIncludes(weekly, /Problem-Based A\/P[\s\S]*AKI on CKD with hyperK[\s\S]*Pending \/ Disposition/i, "weekly summary should keep A/P and pending structure");
  assertDocumentIncludes(sbar, /^Situation: .*septic shock.*AKI\/hyperK.*O2\/aspiration/im, "SBAR should lead with transfer risk");
  assertDocumentIncludes(sbar, /Recommendation:[\s\S]*f\/u Cx\/Abx de-escalation[\s\S]*restart anticoag only after Hb\/Plt\/bleed review/i, "SBAR should keep concrete actions");
  console.log("PASS Shared document formatter projects reasoning into concise admission/weekly/SBAR drafts");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Shared document formatter projects reasoning into concise admission/weekly/SBAR drafts", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Shared document formatter projects reasoning into concise admission/weekly/SBAR drafts: ${failures[failures.length - 1].error}`);
}

try {
  const newAdmissionPlan = applyClinicalKnowledgeToText(
    "New admission 62F fever and dyspnea. Dx CAP with sepsis physiology, BP 92/58, lactate 3.1, WBC 18, SpO2 91% NC3L. PMH CKD3 and AF on apixaban. CXR RLL PNA. Ceftriaxone/azithro started after B/C. Pending sputum Cx, repeat lactate, O2 wean, renal-dose meds and anticoag/bleed review.",
  );
  const admission = formatRuleBasedAdmissionSummary(newAdmissionPlan);
  if (/monitor closely|continue current management|clinical correlation/i.test(admission)) {
    throw new Error(`rule-based new-admission summary retained filler: ${admission}`);
  }
  assertDocumentIncludes(admission, /PNA|sepsis|lactate|culture|O2|renal|anticoag/i, "new admission summary should preserve admission reason, active risks, and pending work");
  console.log("PASS Rule-based new-admission summary is concise and preserves key IM work");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Rule-based new-admission summary is concise and preserves key IM work", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Rule-based new-admission summary is concise and preserves key IM work: ${failures[failures.length - 1].error}`);
}

try {
  const rawLab =
    "Lab: WBC 12.8 from 18, Cr 2.6 from baseline 4.1, CA 19-9 456 H, Troponin 42 to 68, Troponin I 0.011 ng/mL, Blood culture: pending";
  const items = parseLabText(rawLab);
  if (!items.some((item) => /CA\s*19-9/i.test(item.label) && item.value === "456")) {
    throw new Error("generic tumor marker CA 19-9 was not extracted");
  }
  if (!items.some((item) => item.label === "Troponin" && item.value === "68" && item.previousValue === "42")) {
    throw new Error("generic directional troponin trend was not extracted as latest value with previous value");
  }
  if (!items.some((item) => item.label === "Troponin I" && item.value === "0.011" && item.unit === "ng/mL")) {
    throw new Error("troponin I unit should be preserved only when present in source text");
  }
  if (!items.some((item) => item.label === "Blood culture" && /pending/i.test(item.value))) {
    throw new Error("qualitative culture result was not extracted");
  }
  const focus = getLabFocusSummary(
    {
      ...emptyPatient(),
      primaryDiagnosis: "pancreatic cancer with infection and AKI",
      rawLabText: rawLab,
      newLabs: rawLab,
    },
    [],
    { maxCritical: 5, maxTrend: 8, maxAnchors: 5, separator: " | " },
  ).text;
  if (!/CA\s*19-9 456|Troponin 68|Blood culture pending/i.test(focus)) {
    throw new Error(`lab focus did not preserve meaningful non-common labs: ${focus}`);
  }
  console.log("PASS Raw lab fallback extracts broad labs then filters meaningful signals");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Raw lab fallback extracts broad labs then filters meaningful signals", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Raw lab fallback extracts broad labs then filters meaningful signals: ${failures[failures.length - 1].error}`);
}

try {
  const stableHfPlan = applyClinicalKnowledgeToText(
    "HFrEF EF35%, admitted for ADHF now euvolemic after IV furosemide. BP 118/72, Cr 1.2, K 4.2. Discharge planning tomorrow.",
  );
  const stableText = haystack(stableHfPlan);
  if (!/ACEi\/ARB\/ARNI|SGLT2i|MRA|GDMT/i.test(stableText)) {
    throw new Error(`stable HFrEF should prompt GDMT readiness review: ${stableText}`);
  }
  const unstableHfPlan = applyClinicalKnowledgeToText(
    "HFrEF EF30%, septic shock improved but BP 88/52, AKI Cr 3.1, K 6.0. On oxygen and diuresis held.",
  );
  const unstableText = haystack(unstableHfPlan);
  if (!/contraindications|defer|adjust|hypotension|AKI|hyperK/i.test(unstableText)) {
    throw new Error(`unstable HFrEF should frame GDMT as readiness/contraindication review: ${unstableText}`);
  }
  if (/start ACEi|start ARB|start ARNI|start beta|start SGLT2|start MRA/i.test(unstableText)) {
    throw new Error(`unstable HFrEF should not directly instruct starting GDMT: ${unstableText}`);
  }
  console.log("PASS HFrEF rule reviews GDMT readiness without unsafe start instructions");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "HFrEF rule reviews GDMT readiness without unsafe start instructions", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL HFrEF rule reviews GDMT readiness without unsafe start instructions: ${failures[failures.length - 1].error}`);
}

try {
  const displayPatient = {
    ...emptyPatient(),
    id: "demo-display-negative-neuro",
    bed: "10W-07",
    patientCode: "DEMO-NEG",
    age: 76,
    sex: "F",
    primaryDiagnosis: "ICU transfer after cholangitis septic shock",
    underlyingDiseases: "CKD3b; COPD; HFrEF; AF; old lacunar infarct",
    activeProblems: "AKI on CKD; aspiration PNA; delirium/deconditioning",
    newImaging: "CXR RLL aspiration PNA improving. Head CT no ICH.",
    physicalExam: "A&O x2-3; post-ICU generalized weakness; coarse RLL crackles.",
    rawLabText: "Cr 2.7, K 5.3, Hb 8.4, Plt 64",
    assessmentPlanItems: [
      {
        id: "ap-display-1",
        problemTitle: "Delirium/deconditioning",
        assessmentSummary: "Post-ICU generalized weakness; no lateralizing sign.",
        evidenceOrCourseItems: ["A&O x2-3", "Head CT no ICH"],
        planItems: ["PT/OT", "delirium precautions"],
        category: "activeProblem",
        isImportant: true,
        color: "",
        order: 1,
      },
    ],
  };
  const digest = getRoundingDigest(displayPatient, [], todayKey());
  const combined = `${digest.issues}\n${digest.image}\n${digest.objective}`;
  if (/\bICH\b|neuro deficit/i.test(combined)) {
    throw new Error(`negative neuro finding leaked into digest: ${combined}`);
  }
  if (!/PNA|AKI/i.test(combined)) {
    throw new Error(`digest lost active non-neuro issues: ${combined}`);
  }
  console.log("PASS Display digest suppresses no-ICH and generalized-weakness false neuro tags");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Display digest suppresses no-ICH and generalized-weakness false neuro tags", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Display digest suppresses no-ICH and generalized-weakness false neuro tags: ${failures[failures.length - 1].error}`);
}

try {
  const existing = {
    ...emptyPatient(),
    id: "demo-existing-icu-transfer",
    bed: "10ICU-07",
    patientCode: "DEMO-ICU-001",
    age: 72,
    sex: "M",
    attending: "Dr Demo",
    teamOrService: "INF",
    primaryDiagnosis: "Septic shock from cholangitis",
    oneLiner: "72M cholangitis septic shock ICU transfer",
    underlyingDiseases: "DM\nHTN\nCKD3b baseline Cr 1.7\nold CVA\nHFrEF EF35%\nAF previously on apixaban",
    activeProblems: "septic shock/cholangitis\nAKI on CKD\naspiration pneumonia\nAF/HFrEF",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const rawIcuTransfer =
    "Bed 10ICU-07 Code DEMO-ICU-001 72M. Dx septic shock from ascending cholangitis s/p ERCP stent, aspiration PNA, AKI on CKD after CRRT, AF/HFrEF, ICU delirium. PMH DM HTN CKD3b old CVA. ICU course: norepi/intubation, mero/vanco, ERCP 5/10, extubated 5/14, pressor off 5/15, CRRT stopped 5/15. Today afebrile 72h, weak/intermittent confusion, productive cough/aspiration risk, UO 900 mL/day, NG feeding, sacral PI. VS BP 108/62 off pressor HR 105 RR22 SpO2 94 NC3L. Lab WBC 14.2 from 24.5 H, Hb 8.1 from 9.4 L, Plt 78 from 45 L, Cr 2.9 from peak 5.6, K 5.4 H, Na 132 L, Lactate 1.6 from 5.2, Troponin I 84 to 62, Vanco trough 22 H, Blood culture 5/14 no growth, Sputum culture pending. Image CXR RLL infiltrate improving, CT AP no abscess, Echo EF35%, Head CT no ICH. Tasks f/u CBC diff, Cr/K, UO, sputum culture; renal dose Abx/review vanco; aspiration/swallow eval; anticoag after Plt/bleed review; wound/rehab.";
  const draft = {
    id: "draft-icu-transfer",
    status: "updateCandidate",
    matchPatientId: existing.id,
    sourceIndex: 0,
    bed: "10ICU-07",
    patientCode: "DEMO-ICU-001",
    age: "72",
    sex: "M",
    attending: "Dr Demo",
    teamOrService: "INF",
    primaryDiagnosis: "ICU transfer after septic shock from ascending cholangitis",
    oneLiner: "72M ICU transfer: resolving cholangitis septic shock s/p ERCP/stent, AKI off CRRT, aspiration PNA, AF/HFrEF.",
    chiefComplaint: "ICU transfer after septic shock",
    todayUpdates: "Afebrile 72h; weak/intermittent confusion; productive cough/aspiration risk; UO 900 mL/day; NG feeding; stage 2 sacral PI.",
    vitalSigns: "BP 108/62 off pressor; HR 105 irreg; RR 22; SpO2 94% NC 3L; T 36.8.",
    physicalExam: "Intermittently disoriented; coarse RLL crackles; soft abd; 2+ edema; sacral PI stage 2.",
    labText:
      "WBC 14.2 from 24.5 H, Hb 8.1 from 9.4 L, Plt 78 from 45 L, Cr 2.9 from peak 5.6, K 5.4 H, Na 132 L, Lactate 1.6 from 5.2, Troponin I 84 to 62, Vanco trough 22 H, Blood culture 5/14 no growth, Sputum culture pending.",
    imageText: "CXR RLL infiltrate improving; CT AP no abscess; Echo EF35%; Head CT no ICH.",
    admissionSummary: "ICU 5/03-5/17: norepi/intubation; mero/vanco; ERCP/stent; extubated; pressor and CRRT stopped; transfer to ward.",
    underlyingDiseases: "DM; HTN; CKD3b; old CVA; HFrEF EF35%; AF previously on apixaban",
    activeProblems: "resolving cholangitis/septic shock; aspiration PNA; AKI on CKD off CRRT; hyperK; thrombocytopenia/anemia; AF/HFrEF; delirium/aspiration risk; sacral PI",
    hospitalCourseHighlights: "ICU: norepi/intubation; mero/vanco; ERCP/stent; extubated; off pressor/CRRT.",
    importantRedFlags: "recurrent fever/hypotension; rising K/Cr or oliguria; worsening hypoxia; bleeding with thrombocytopenia; delirium/aspiration.",
    tasks: [
      { text: "f/u CBC diff, Cr/K, UO, sputum culture", priority: "urgent", dueDate: "", category: "lab" },
      { text: "renal-dose Abx; review vanco trough/de-escalation", priority: "urgent", dueDate: "", category: "order" },
      { text: "aspiration precaution + swallow eval", priority: "normal", dueDate: "", category: "order" },
      { text: "anticoag restart only after Plt/bleeding review", priority: "normal", dueDate: "", category: "order" },
    ],
    antibioticsProceduresConsults: ["meropenem/vancomycin", "ERCP biliary stent", "CRRT stopped"],
    dischargePlan: "Ward trial; rehab/SNF after infection/renal stability.",
    disposition: "rehab/SNF likely",
    uncertainty: ["verify Abx stop/de-escalation date", "verify current anticoagulation plan"],
    sourceExcerpt: rawIcuTransfer,
  };
  const reviewed = applyClinicalKnowledgeToPatientImportDraft(draft);
  const parsedLabs = parseLabText(reviewed.labText);
  const patient = buildConcisePatientClinicalUpdate(
    {
      ...existing,
      primaryDiagnosis: reviewed.primaryDiagnosis || existing.primaryDiagnosis,
      oneLiner: reviewed.oneLiner || existing.oneLiner,
      chiefComplaint: reviewed.chiefComplaint,
      subjectiveOrChiefConcern: reviewed.todayUpdates,
      vitalSigns: reviewed.vitalSigns,
      physicalExam: reviewed.physicalExam,
      rawLabText: reviewed.labText,
      newLabs: reviewed.labText,
      parsedLabItems: parsedLabs,
      newImaging: reviewed.imageText,
      generatedWeeklySummary: reviewed.admissionSummary,
      underlyingDiseases: [existing.underlyingDiseases, reviewed.underlyingDiseases].filter(Boolean).join("\n"),
      underlyingDiseaseItems: textToItems([existing.underlyingDiseases, reviewed.underlyingDiseases].filter(Boolean).join("\n")),
      activeProblems: [existing.activeProblems, reviewed.activeProblems].filter(Boolean).join("\n"),
      activeProblemItems: textToItems([existing.activeProblems, reviewed.activeProblems].filter(Boolean).join("\n")),
      hospitalCourseHighlights: [existing.hospitalCourseHighlights, reviewed.hospitalCourseHighlights, reviewed.admissionSummary].filter(Boolean).join("\n"),
      importantRedFlags: [existing.importantRedFlags, reviewed.importantRedFlags].filter(Boolean).join("\n"),
      dischargePlan: [existing.dischargePlan, reviewed.dischargePlan, reviewed.disposition && `Disposition: ${reviewed.disposition}`].filter(Boolean).join("\n"),
      isNewAdmission: false,
      showAdmissionBriefOnPrint: false,
      status: "active",
      tasks: reviewed.tasks.map((task) => ({ id: createId("t"), text: task.text, done: false, priority: task.priority, category: task.category, dueDate: task.dueDate, createdAt: nowIso(), completedAt: "" })),
      updatedAt: nowIso(),
    },
    [],
    todayKey(),
  );
  const digest = getRoundingDigest(patient, [], todayKey());
  const labFocus = getLabFocusSummary(patient, [], todayKey()).text;
  const sbar = formatRuleBasedSbar(applyClinicalKnowledgeToText(rawIcuTransfer));
  const labels = parsedLabs.map((item) => item.label).join("\n");
  if (reviewed.status !== "updateCandidate" || reviewed.matchPatientId !== existing.id) {
    throw new Error("existing patient was not preserved as an update candidate");
  }
  if (patient.isNewAdmission || patient.showAdmissionBriefOnPrint || patient.generatedAdmissionSummary) {
    throw new Error("existing inpatient transfer was treated as a new admission");
  }
  if (!/Vancomycin|Troponin I|Blood culture|Sputum culture/i.test(labels)) {
    throw new Error(`broad lab/culture extraction failed: ${labels}`);
  }
  if (/afebrile\s*72/i.test(labFocus) || !/Cr|K|Troponin|Hb|Plt/i.test(labFocus)) {
    throw new Error(`lab focus was noisy or low-yield: ${labFocus}`);
  }
  if (!digest.assessmentPlan.trim() || /\.{3}/.test([digest.assessmentPlan, digest.tasks, sbar].join("\n"))) {
    throw new Error(`rounding digest was empty or truncated: ${digest.assessmentPlan}`);
  }
  if (/Stroke\s*\/\s*neuro deficit|Stroke\/neuro|Neuro worsening/i.test([digest.assessmentPlan, sbar].join("\n"))) {
    throw new Error(`old CVA/no ICH created a false active neuro plan: ${digest.assessmentPlan}\n${sbar}`);
  }
  if (!/AKI|hyperK|Abx|culture|O2|aspiration|bleeding/i.test(sbar)) {
    throw new Error(`SBAR missed ICU transfer priorities: ${sbar}`);
  }
  console.log("PASS ICU transfer existing inpatient import creates concise board/SBAR");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "ICU transfer existing inpatient import creates concise board/SBAR", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL ICU transfer existing inpatient import creates concise board/SBAR: ${failures[failures.length - 1].error}`);
}

try {
  const rawCancerTransfer = [
    "Known right hypopharyngeal SCC cT4bN2bM0 s/p induction TPF, mid-lower esophageal SCC/obstructive dysphagia with J-tube.",
    "Admitted after syncope/LOC with standing shock physiology; BP 54/29 improved after fluid challenge, felt hypovolemic.",
    "Current 5/15 off-service note: weak, no fever. V/S T 37.0, BP 100/69, P 99, RR 16, SpO2 100%.",
    "B/C peripheral MRSA then S. haemolyticus; Port-A B/C Enterococcus faecalis. Teicoplanin from 5/13.",
    "Lab 5/15 WBC 12.7, Neu 88.9, Hb 9.4, Hct 27.7, Plt 259, Cr 0.46, eGFR 125.85.",
    "Brain CT: diffuse atrophy; no ICH, edema, hydrocephalus or major infarct.",
    "CT neck/chest 5/13: persistent mid-lower esophageal wall thickening, metastatic-appearing LAD, tiny lung nodules; no pleural effusion.",
    "PE cachectic/weak, alert/clear, BS clear, Abd soft, J-tube feeding tolerated, no edema. DNR/all refused documented.",
  ].join("\n");
  const draft = {
    id: "draft-cancer-transfer-messy",
    status: "updateCandidate",
    matchPatientId: "demo-cancer-transfer",
    sourceIndex: 0,
    bed: "H5-113",
    patientCode: "DEMO-SCC",
    age: "51",
    sex: "M",
    attending: "Dr Demo",
    teamOrService: "Onc/INF",
    primaryDiagnosis: "esophageal cancer",
    oneLiner: "Esophageal SCC w/ shock syncope\nMRSA + Enterococcus bacteremia\nmalnutrition/J-tube\nanemia\nprior neuro change r/o ICH",
    chiefComplaint: "syncope, bacteremia",
    todayUpdates: "weak, no fever; DNR/all refused documented",
    vitalSigns: "5/15: afebrile, weak, no fever. BP 100/69, P 99, RR 16, SpO2 100%",
    physicalExam: "Cachectic, weak; alert/clear; BS clear; abd soft, NT, J-tube feeding tolerated; no edema",
    labText: "5/15 WBC 12.7, Neu 88.9, Hb 9.4, Hct 27.7, Plt 259, Cr 0.46, eGFR 125.85",
    imageText: "Brain CT no ICH/edema/major infarct. CT neck/chest persistent esophageal wall thickening, metastatic LAD, tiny lung nodules.",
    admissionSummary:
      "Known hypopharyngeal/esophageal SCC with J-tube, admitted after syncope/LOC with initial shock that improved after fluids. Current issues are MRSA/Enterococcus bacteremia on teicoplanin, anemia, nutrition via J-tube, and metastatic LAD follow-up.",
    underlyingDiseases: "right hypopharyngeal SCC; mid-lower esophageal SCC; s/p induction TPF; J-tube",
    activeProblems:
      "Bacteremia / infection Heme/Onc safety Stroke / neuro deficit UGIB / anemia Cardio / HF / rhythm Hypovolemia/shock syncope Malnutrition/PO intolerance with J-tube feeding\nBacteremia / infection\nHeme/Onc safety\nStroke / neuro deficit\nUGIB / anemia\nCardio / HF / rhythm",
    hospitalCourseHighlights: "ED shock responded to IV fluids. Teicoplanin 5/13-. Feeding jejunostomy. CT neck/chest follow-up.",
    importantRedFlags:
      "Recurrent hypotension/syncope, fever, rising WBC, worsening mental status, or inability to obtain repeat Cx. DNR/all refused documented.\n!Possible sepsis/shock physiology - Reason: Infection trigger with shock, hypotension, vasopressor or high lactate signal.\n!High-risk cardiac signal - Reason: ACS/troponin, RVR, shock or pulmonary edema signal requires explicit handoff.\n!Active bleeding or severe anemia signal - Reason: Bleeding/Hb signal requires handoff of hemodynamics, transfusion and scope plan.\n!Febrile neutropenia safety signal - Reason: Cancer/immunosuppression with fever/neutropenia requires urgent culture/Abx/isolation review.",
    tasks: [
      { text: "f/u pending blood cultures from 5/15", priority: "urgent", dueDate: "", category: "lab" },
      { text: "Continue teicoplanin for MRSA bacteremia / Enterococcus infection", priority: "normal", dueDate: "", category: "order" },
      { text: "f/u neuro change, swallow screen, antithrombotic/statin and brain/vascular imaging plan", priority: "normal", dueDate: "", category: "order" },
      { text: "track volume/O2 status, I/O/diuresis response, ECG/troponin or rate-control plan if present", priority: "normal", dueDate: "", category: "order" },
      { text: "trend Hb/V/S; confirm PPI, EGD timing, transfusion/T&S and antithrombotic hold-resume", priority: "normal", dueDate: "", category: "lab" },
      { text: "f/u CBC diff/ANC, fever curve, Cx/Abx, isolation need", priority: "normal", dueDate: "", category: "consult" },
      { text: "f/u pathology/staging; review VTE/bleed risk", priority: "normal", dueDate: "", category: "other" },
    ],
    antibioticsProceduresConsults: ["Teicoplanin 5/13-", "J-tube", "CT neck/chest"],
    dischargePlan: "Inpatient ward; discharge once bacteremia/infection and hemodynamics stabilized.",
    disposition: "Inpatient ward",
    uncertainty: [],
    sourceExcerpt: rawCancerTransfer,
  };
  const reviewed = routePatientImportDraft(applyClinicalKnowledgeToPatientImportDraft(draft, { targetUpdate: true }));
  const noisyText = `${reviewed.activeProblems}\n${reviewed.importantRedFlags}\n${reviewed.tasks.map((task) => task.text).join("\n")}`;
  if (/Stroke \/ neuro deficit|UGIB \/ anemia|Cardio \/ HF \/ rhythm|Hypovolemia\/shock|Heme\/Onc safety|Possible sepsis\/shock|High-risk cardiac|Active bleeding|Febrile neutropenia|transfusion\/T&S|antithrombotic\/statin/i.test(noisyText)) {
    throw new Error(`messy rule labels leaked into reviewed import draft:\n${noisyText}`);
  }
  assertDocumentIncludes(reviewed.activeProblems, /MRSA\/Enterococcus bacteremia/i, "reviewed import should keep bacteremia as active problem");
  assertDocumentIncludes(reviewed.activeProblems, /SCC|J-tube|anemia/i, "reviewed import should keep cancer nutrition/anemia issues");
  if (reviewed.activeProblems.split(/\r?\n/).filter(Boolean).length > 4) {
    throw new Error(`active problems still too crowded:\n${reviewed.activeProblems}`);
  }
  if (reviewed.tasks.length > 8) {
    throw new Error(`reviewed import kept too many tasks: ${reviewed.tasks.length}`);
  }
  if (/BP 100\/69|SpO2|RR 16|T 37\.0/i.test(reviewed.todayUpdates) || !/BP 100\/69|SpO2 100/i.test(reviewed.vitalSigns) || /weak|DNR/i.test(reviewed.vitalSigns)) {
    throw new Error(`V/S was not routed out of today update:\nS=${reviewed.todayUpdates}\nVS=${reviewed.vitalSigns}`);
  }
  if (/Brain CT|CT neck|hemorrhage|LAD|nodule/i.test(reviewed.physicalExam) || !/Cachectic|J-tube/i.test(reviewed.physicalExam)) {
    throw new Error(`image text leaked into PE or bedside PE was lost:\nPE=${reviewed.physicalExam}`);
  }
  if (!/esophageal wall|metastatic LAD|nodule/i.test(reviewed.imageText) || /no pleural effusion|chemoport/i.test(reviewed.imageText)) {
    throw new Error(`image summary was not high-yield:\n${reviewed.imageText}`);
  }
  if (!/Teicoplanin/i.test(reviewed.hospitalCourseHighlights)) {
    throw new Error(`specific antibiotic was lost from course:\n${reviewed.hospitalCourseHighlights}`);
  }
  console.log("PASS Cancer transfer import suppresses stale shock/no-ICH false rule clutter");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Cancer transfer import suppresses stale shock/no-ICH false rule clutter", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Cancer transfer import suppresses stale shock/no-ICH false rule clutter: ${failures[failures.length - 1].error}`);
}

try {
  const dirtyPatient = {
    ...emptyPatient(),
    id: "dirty-ai-fields",
    bed: "H5-113",
    patientCode: "DEMO-DIRTY",
    age: 51,
    sex: "M",
    primaryDiagnosis: "esophageal SCC",
    subjectiveOrChiefConcern: "5/15: afebrile, weak, no fever. BP 100/69, HR 99, SpO2 100%. DNR/refused all. B/C pending from 5/15.",
    vitalSigns: "",
    physicalExam:
      "stable enlarged LN at bilateral paratracheal/right paraesophageal/left gastric chain/liver hilum, metastatic LN possible. Brain CT 5/7: aged brain with atrophy, no hemorrhage/edema.",
    rawLabText: "Hb 9.4, WBC 12.7",
    newImaging: "",
    activeProblems: "Bacteremia / infection Heme/Onc safety Stroke / neuro deficit UGIB / anemia Cardio / HF / rhythm",
    hospitalCourseHighlights: "B/C peripheral MRSA, Port-A Enterococcus faecalis. Teicoplanin 5/13-. ED shock responded to IV fluids.",
    assessmentPlanItems: [
      {
        id: "dirty-ap-1",
        problemTitle: "Heme/Onc safety",
        assessmentSummary: "Cancer/infx risk; staging/path pending; review VTE/bleed.",
        evidenceOrCourseItems: ["hypovolemic shock improved after IV fluids", "B/C MRSA and Enterococcus"],
        planItems: ["f/u pathology/staging", "review VTE/bleed risk", "Onc/ID if fever/neutro"],
        category: "activeProblem",
        isImportant: true,
        color: "",
        order: 0,
      },
    ],
  };
  const preview = routePatientClinicalFields(dirtyPatient);
  const cleaned = preview.patient;
  const changedLabels = preview.changes.map((change) => change.label).join("\n");
  if (!/Subjective|V\/S|Physical exam|Images|Active problems|A\/P/i.test(changedLabels)) {
    throw new Error(`cleanup preview did not identify expected dirty fields: ${changedLabels}`);
  }
  if (/BP 100\/69|SpO2/i.test(cleaned.subjectiveOrChiefConcern) || !/BP 100\/69|SpO2 100/i.test(cleaned.vitalSigns)) {
    throw new Error(`cleanup did not move V/S out of S:\nS=${cleaned.subjectiveOrChiefConcern}\nVS=${cleaned.vitalSigns}`);
  }
  if (/Brain CT|metastatic LN|hemorrhage|edema/i.test(cleaned.physicalExam) || !/metastatic LN|Brain CT/i.test(cleaned.newImaging)) {
    throw new Error(`cleanup did not move image/report text out of PE:\nPE=${cleaned.physicalExam}\nIMG=${cleaned.newImaging}`);
  }
  const cleanedAp = cleaned.assessmentPlanItems
    .map((item) => [item.problemTitle, item.assessmentSummary, ...item.planItems].join("\n"))
    .join("\n");
  if (!/Teicoplanin/i.test(cleanedAp) || /review VTE\/bleed risk|UGIB|Cardio \/ HF \/ rhythm|Stroke \/ neuro/i.test(`${cleaned.activeProblems}\n${cleanedAp}`)) {
    throw new Error(`cleanup A/P still noisy or missing Abx:\n${cleaned.activeProblems}\n${cleanedAp}`);
  }
  console.log("PASS Detail cleanup preview routes polluted fields without saving");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Detail cleanup preview routes polluted fields without saving", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Detail cleanup preview routes polluted fields without saving: ${failures[failures.length - 1].error}`);
}

try {
  const rawTransferText = [
    "51M with hypopharyngeal/esophageal SCC, admitted after syncope and conscious disturbance.",
    "ED course: vital signs revealed shock with BP 54/29 mmHg. After fluid challenge, BP recovered and hypovolemia was impressed.",
    "2026-05-15 progress: no fever, weak.",
    "2026-05-15 Vital signs: Temperature 37.0 C, BP: 100/69 mmHg, Pulse: 99/min, RR: 16/min, SpO2: 100%.",
    "Physical Examination: cachexia, weak; clear consciousness; breathing smooth; abdomen soft; extremities no edema.",
    "Lab data",
    "Test WBC Neu Hb Plt CRE GFR Na K ALT Mg",
    "2026-05-12 8.0 70 10.2 220 0.50 133.33 139 3.8 30 1.9",
    "2026-05-15 12.7* 88.9* 9.4* 259 0.46* 125.85 139 3.8 36 1.8",
    "A long report history says the patient had dysphagia, vomiting, weight loss, and was sent to ED.",
    "2026-05-13 Neck/chest CT",
    "Impression:",
    "1. Persistent middle/lower esophageal wall thickening.",
    "2. Stable enlarged necrotic lymph nodes, c/f metastatic lymphadenopathy.",
    "3. RUL/RML ground-glass opacity/inflammation.",
    "For other findings see report.",
    "2026-05-07 Brain CT",
    "Impression:",
    "Aged brain atrophy.",
    "No evidence of hemorrhage or edema.",
    "A/P: bacteremia; peripheral B/C MRSA then S. haemolyticus; Port-A Enterococcus faecalis; Teicoplanin started 5/13; f/u neck/chest CT.",
  ].join("\n");
  const badDraft = {
    oneLiner: "51M SCC with current shock and bacteremia.",
    admissionSummary:
      "Vital signs revealed shock with BP: 54/29 mmHg. The patient has esophageal SCC and bacteremia. Continue current management.",
    isbarHandoff:
      "Situation: active shock with BP 54/29.\nBackground: SCC.\nAssessment: shock.\nRecommendation: monitor closely.",
    subjective: {
      chiefConcern: "shock",
      symptoms: ["weak", "no fever"],
      overnightEvents: [],
      importantSymptoms: [],
      importantOvernightEvents: [],
    },
    objective: {
      vitals: [
        { date: "", name: "V/S", value: "BP 54/29 mmHg", interpretation: "shock", isAbnormal: true, isImportant: true },
        { date: "2026-05-15", name: "V/S", value: "BP 100/69, PR 99, RR 16, SpO2 100%", interpretation: "stable", isAbnormal: false, isImportant: true },
      ],
      bloodSugars: [],
      physicalExam: [
        {
          system: "PE",
          finding: "Due to conscious change, brain CT was arranged, which showed aged brain atrophy without hemorrhage.",
          isImportant: true,
        },
        { system: "General", finding: "cachexia, weak", isImportant: true },
      ],
      labs: [
        { date: "2026-05-12", group: "Latest labs", name: "Hb", value: "10.2", unit: "", previousValue: "", isAbnormal: true, isImportant: true, interpretation: "anemia" },
        { date: "2026-05-12", group: "Latest labs", name: "GFR", value: "133.33", unit: "", previousValue: "", isAbnormal: false, isImportant: true, interpretation: "fair renal function" },
      ],
      images: [
        {
          date: "",
          studyType: "Latest imaging",
          finding: "",
          impression:
            "This 51-year-old male with cancer was admitted via ED. He reported dysphagia since last year and lost body weight before admission.",
          isImportant: true,
        },
      ],
    },
    assessmentPlan: [
      {
        problemTitle: "Shock",
        assessmentSummary: "Current shock with BP 54/29.",
        evidenceOrCourseItems: ["BP 54/29"],
        planItems: ["monitor BP for shock"],
        isImportant: true,
      },
      {
        problemTitle: "Bacteremia",
        assessmentSummary: "MRSA/S. haemolyticus/Enterococcus bacteremia.",
        evidenceOrCourseItems: ["B/C positive", "Teicoplanin 5/13"],
        planItems: ["f/u Cx", "review Abx duration"],
        isImportant: true,
      },
    ],
    redFlags: [{ text: "Shock", reason: "BP 54/29" }],
    tasks: [
      { text: "monitor closely for shock", priority: "urgent", dueDate: "", category: "order" },
      { text: "f/u B/C and Abx duration", priority: "normal", dueDate: "", category: "order" },
    ],
    dischargeIssues: [],
    thinkingPrompts: [],
    uncertainty: [],
  };
  const clean = sanitizeAiSoapDraftForReview(badDraft, rawTransferText, "mixed");
  const vitalsText = JSON.stringify(clean.objective.vitals);
  const peText = JSON.stringify(clean.objective.physicalExam);
  const labText = JSON.stringify(clean.objective.labs);
  const imageText = JSON.stringify(clean.objective.images);
  const currentFields = JSON.stringify([clean.objective.vitals, clean.redFlags, clean.tasks, clean.assessmentPlan]);
  if (/54\/29|shock/i.test(vitalsText) || !/100\/69/.test(vitalsText)) {
    throw new Error(`current V/S did not suppress resolved shock: ${vitalsText}`);
  }
  if (/CT|hemorrhage|edema|atrophy/i.test(peText) || !/cachexia|weak/i.test(peText)) {
    throw new Error(`image report leaked into PE or bedside PE lost: ${peText}`);
  }
  if (/10\.2|133\.33|125\.85/.test(labText) || !/WBC|12\.7|Neu|88\.9|Hb|9\.4/i.test(labText)) {
    throw new Error(`lab sanitizer did not keep latest meaningful labs: ${labText}`);
  }
  if (/51-year-old|dysphagia since|sent to ED|vital signs revealed shock/i.test(imageText) || !/esophageal wall|lymph|ground-glass/i.test(imageText)) {
    throw new Error(`HPI/report narrative leaked into image summary: ${imageText}`);
  }
  if (/\bshock\b|54\/29/i.test(currentFields)) {
    throw new Error(`resolved shock leaked into current redFlag/task/AP/V/S: ${currentFields}`);
  }
  if (!/B\/C|Abx|Bacteremia/i.test(currentFields)) {
    throw new Error(`active infection tasks/AP were lost: ${currentFields}`);
  }
  if (/active shock|current shock|54\/29|monitor closely|continue current management/i.test(`${clean.oneLiner}\n${clean.admissionSummary}\n${clean.isbarHandoff}`)) {
    throw new Error(`generated briefs retained stale shock/generic filler: ${clean.isbarHandoff}`);
  }
  console.log("PASS AI draft sanitizer separates current status from resolved shock and report text");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "AI draft sanitizer separates current status from resolved shock and report text", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL AI draft sanitizer separates current status from resolved shock and report text: ${failures[failures.length - 1].error}`);
}

try {
  const patient = buildConcisePatientClinicalUpdate(
    {
      ...emptyPatient(),
      id: "demo-heme-onc-style",
      bed: "H5-113",
      patientCode: "TEST-STYLE",
      age: 51,
      sex: "M",
      primaryDiagnosis: "esophageal SCC",
      underlyingDiseases: "hypopharyngeal SCC s/p chemotherapy",
      activeProblems: "esophageal SCC; bacteremia; anemia",
      hospitalCourseHighlights:
        "Biopsy confirmed esophageal SCC. CT neck/chest showed mid-lower esophageal wall thickening with metastatic LN concern.",
      rawLabText: "WBC 12.7, Hb 9.4, Plt 259, Cr 0.46. B/C MRSA then Enterococcus; Teicoplanin 5/13.",
      newImaging: "CT neck/chest: esophageal wall thickening; necrotic LNs c/f metastasis.",
      tasks: [],
      updatedAt: nowIso(),
    },
    [],
    todayKey(),
  );
  const apText = patient.assessmentPlanItems
    .map((item) => [item.problemTitle, item.assessmentSummary, ...item.evidenceOrCourseItems, ...item.planItems].join("\n"))
    .join("\n");
  if (/Heme\/onc safety context|verify fever\/ANC or immunosuppression|thrombosis\/bleeding tradeoff/i.test(apText)) {
    throw new Error(`heme/onc A/P still uses verbose template wording: ${apText}`);
  }
  if (!/Teicoplanin/i.test(apText)) {
    throw new Error(`infection A/P lost concrete antibiotic plan: ${apText}`);
  }
  if (/review VTE\/bleed risk/i.test(apText)) {
    throw new Error(`unsupported generic VTE/bleed plan survived: ${apText}`);
  }
  if (/UGIB|transfusion|EGD|T&S/i.test(apText)) {
    throw new Error(`stable anemia created false GI bleed plan: ${apText}`);
  }
  if (/\b(if|and|or|with|for|to)$/im.test(apText) || /\bwith done\b/i.test(apText)) {
    throw new Error(`A/P contains clipped sentence tail: ${apText}`);
  }
  if (!/MRSA\/Enterococcus bacteremia|SCC with J-tube|Onc/i.test(apText)) {
    throw new Error(`heme/onc A/P lost concise clinical content: ${apText}`);
  }
  console.log("PASS Heme/onc A/P is concise and has no clipped tails");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Heme/onc A/P is concise and has no clipped tails", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Heme/onc A/P is concise and has no clipped tails: ${failures[failures.length - 1].error}`);
}

await server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} clinical eval case(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length + supplementalPasses} clinical eval cases passed.`);
