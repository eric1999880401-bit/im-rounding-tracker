import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
const {
  emptyDailyNote,
  emptyPatient,
  emptyTask,
  getAdmissionSummaryText,
  getLabFocusSummary,
  getPatientDisplaySummary,
  interpretLabItem,
  parseLabReports,
  parseLabText,
  safeClinicalLine,
  textToItems,
  todayKey,
  nowIso,
  createId,
  dailyNoteMatchesSavedSnapshot,
} = await server.ssrLoadModule("/src/utils.ts");
const { getRoundingDigest, getPatientHeadline } = await server.ssrLoadModule("/src/roundingDigest.ts");
const { buildCarriedForwardKeys, isCarriedForwardLine } = await server.ssrLoadModule("/src/soapLineDelta.ts");
const { detectSourceType } = await server.ssrLoadModule("/src/aiPostprocess/sourceTypeDetect.ts");
const {
  aiSoapDraftToSoapDraft,
  formatSoapDraft,
  formatSoapTextForEditorStyle,
  getCanonicalSoapText,
  localRoundSoapFromPaste,
  normalizeSoapTextForEditor,
  parseSoapText,
  patientToSoapDraft,
  soapDraftToPatientPatch,
  soapTextToPatientPatch,
  soapTextWithDerivedHighlights,
} = await server.ssrLoadModule("/src/soapDraft.ts");
const { deriveSoapEvidence } = await server.ssrLoadModule("/src/soapEvidence.ts");
const { buildConcisePatientClinicalUpdate } = await server.ssrLoadModule("/src/clinicalPatientPolish.ts");
const { sanitizeAiSoapDraftForReview } = await server.ssrLoadModule("/src/aiDraftSanitizer.ts");
const { routePatientImportDraft, routePatientClinicalFields } = await server.ssrLoadModule("/src/clinicalFieldRouter.ts");
const { classifyClinicalLine, compactDisplaySymbols, normalizeClinicalDisplayText, normalizeClinicalDisplayTextPreservingMarks } = await server.ssrLoadModule("/src/clinicalLineClassifier.ts");
const { editorDraftToSoapText, lintSoapEditorDraft, mergeOrderSourceIntoEditorDraft, parseSoapTextToEditorDraft, splitSoapEditorTaskLines } = await server.ssrLoadModule("/src/soapEditorDraft.ts");
const { buildAntibioticApSummary, ensureAntibioticApInDraft } = await server.ssrLoadModule("/src/antibioticPlan.ts");
const {
  buildUserAiStyleProfile,
  isDcSoapLineVisible,
  isObjectiveSoapLineVisible,
  isOrderSoapLine,
  isTaskSoapLineVisible,
  normalizeKeywordHighlightRules,
  normalizeRoundingLayoutPreferences,
  visibleSectionsForPreset,
} = await server.ssrLoadModule("/src/userPreferences.ts");
const {
  formatMedicationOrderLinesForDisplay,
  parseMedicationOrders,
  summarizeMedicationOrders,
} = await server.ssrLoadModule("/src/medicationOrderParser.ts");
const {
  acceptSoapDeltaSection,
  guardRoundSoapDelta,
  restoreSoapDeltaSection,
} = await server.ssrLoadModule("/src/soapDeltaGuardrails.ts");
const { displayPrintLine, selectPriorityPrintItems } = await server.ssrLoadModule("/src/printPriority.ts");
const { applyClinicalColorMarkup, applyUserKeywordHighlights, clearClinicalColorMarkupAtSelection } = await server.ssrLoadModule("/src/clinicalColorMarkup.ts");
const { labReferenceText, parseClinicalLabTokens } = await server.ssrLoadModule("/src/labReference.ts");
const { boardDischargeTasks, hasBoardDischargeSoonSignal, isBoardNewAdmission } = await server.ssrLoadModule("/src/boardCockpit.ts");
const { buildLabVisualSummaryFromText, formatLabVisualSummaryLinesFromText } = await server.ssrLoadModule("/src/labVisualSummary.ts");
const { formatSoapBasedIsbar } = await server.ssrLoadModule("/src/soapSbar.ts");
const { AI_SOAP_OUTPUT_CONTRACT_VERSION, normalizeAiSoapText } = await server.ssrLoadModule("/src/aiSoapContract.ts");
const {
  createUndoRedoHistory,
  pushUndoRedoEdit,
  redoEdit,
  replaceUndoRedoPresent,
  undoEdit,
} = await server.ssrLoadModule("/src/editHistory.ts");
const {
  makeRecoveryDraft,
  readRecoveryDraft,
  recoveryFingerprint,
  recoveryStaleState,
  removeRecoveryDraft,
  writeRecoveryDraft,
} = await server.ssrLoadModule("/src/draftRecovery.ts");
const { SoapVisualPreview } = await server.ssrLoadModule("/src/components/SoapVisualPreview.tsx");

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

function admissionSentenceCount(value) {
  return (value.match(/\u3002/g) ?? []).length;
}

function assertOneMinuteAdmissionBrief(value, label) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4 || lines.length > 20) {
    throw new Error(`${label} should be a compact structured brief (4-20 lines), got ${lines.length}: ${value}`);
  }
  if (!/\bPHx\s*:/.test(value) || !/\bCC\s*:/.test(value)) {
    throw new Error(`${label} did not use structured PHx:/CC: brief labels: ${value}`);
  }
}

function assertThreeMinuteAdmissionBrief(value, label) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4 || lines.length > 28) {
    throw new Error(`${label} should be a structured brief (4-28 lines), got ${lines.length}: ${value}`);
  }
  if (!/\b(?:CC|PHx)\s*:/.test(value) || !/\bImp\s*:/.test(value)) {
    throw new Error(`${label} did not use structured brief labels: ${value}`);
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
      assertDocumentIncludes(formatRuleBasedWeeklySummary(plan), /^During this week, .*neutropenic fever.*WBC 1\.6k/i, "weekly focus should lead with neutropenic fever and WBC");
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
  const legacyWeekly = formatClinicalDocumentDraft({
    ...baseDraft,
    documentType: "weeklySummary",
    clinicalReasoning: undefined,
    conciseSummary: "Current focus: ward transfer after cholangitis septic shock; AKI off CRRT.",
    sections: [
      {
        heading: "Weekly Summary",
        content: "Current focus: ward transfer after cholangitis septic shock; AKI off CRRT; aspiration PNA/COPD.",
      },
      {
        heading: "Timeline / Key Course",
        content: "- 5/06 ERCP + biliary stent for source control.\n- 5/07-5/14 CRRT for AKI/hyperK; Cr 2.7, K 5.3.",
      },
      {
        heading: "Problem-Based A/P",
        content: "- Cholangitis/sepsis: afebrile/off pressor; f/u Cx and Abx duration.\n- Aspiration/COPD: NC O2, swallow eval.",
      },
      {
        heading: "Pending / Dispo",
        content: "- CBC diff, Cr/K/UO, sputum Cx, Abx plan, rehab/SNF.",
      },
    ],
    followUpItems: ["rehab/SNF"],
    uncertainty: [],
  });
  const sbar = formatClinicalDocumentDraft({ ...baseDraft, documentType: "isbar" });
  const combined = `${admission}\n${weekly}\n${sbar}`;
  if (/continue current management|monitor closely/i.test(combined)) {
    throw new Error(`shared document formatter retained generic filler: ${combined}`);
  }
  if (/negative head CT wording|old CVA without new focal deficit/i.test(combined)) {
    throw new Error(`shared document formatter leaked noise-to-ignore content: ${combined}`);
  }
  if (!/\bCC\s*:/.test(admission) || !/\bImp\s*:/.test(admission) || /The patient is|Admitted\/managed|PMH\/context|Key course|Active issues|Today\/pending/i.test(admission)) {
    throw new Error(`admission summary did not use the structured brief labels: ${admission}`);
  }
  assertThreeMinuteAdmissionBrief(admission, "reasoning admission summary");
  assertDocumentIncludes(admission, /ED Lab:[\s\S]*(Cr|K|SpO2|O2|Plt|Hb|Cx|CXR|CT|ERCP)/i, "reasoning admission summary should include key objective anchors");
  assertDocumentIncludes(admission, /AKI\/hyperK|Plt-limited anticoag|aspiration risk/i, "admission summary should lead with current transfer risks");
  if (/Problem-Based A\/P|Pending \/ Disposition|\n\s*-/i.test(weekly)) {
    throw new Error(`weekly summary should be paragraph format without headings/bullets: ${weekly}`);
  }
  assertDocumentIncludes(weekly, /During this week[\s\S]*AKI on CKD with hyperK[\s\S]*Pending\/dispo/i, "weekly summary should keep active problems and pending/dispo in paragraph form");
  if (/Weekly Summary|Timeline|Problem-Based A\/P|Pending \/ Dispo|\n\s*-/i.test(legacyWeekly)) {
    throw new Error(`legacy weekly draft headings/bullets leaked into paragraph: ${legacyWeekly}`);
  }
  assertDocumentIncludes(legacyWeekly, /During this week[\s\S]*ERCP[\s\S]*Cr 2\.7[\s\S]*K 5\.3[\s\S]*Abx[\s\S]*rehab\/SNF/i, "legacy weekly formatter should preserve course values, treatment, and dispo");
  assertDocumentIncludes(sbar, /^Situation: .*septic shock.*AKI\/hyperK.*O2\/aspiration/im, "SBAR should lead with transfer risk");
  assertDocumentIncludes(sbar, /Recommendation:[\s\S]*f\/u Cx\/Abx de-escalation[\s\S]*restart anticoag only after Hb\/Plt\/bleed review/i, "SBAR should keep concrete actions");
  const dischargeCourse = formatClinicalDocumentDraft({
    ...baseDraft,
    documentType: "dischargeHospitalCourse",
    sections: [
      { heading: "Hospital Course", content: "treated for CAP/sepsis w/ ceftriaxone after B/C; lactate 3.1 -> 1.4, O2 NC3L -> RA, CXR RLL PNA improved." },
      { heading: "Disposition", content: "OPD chest clinic f/u and oral Abx completion" },
    ],
    followUpItems: ["OPD chest clinic f/u and oral Abx completion"],
  });
  assertDocumentIncludes(dischargeCourse, /^After admission, .*lactate 3\.1.*O2 NC3L -> RA.*under relative stable condition, the patient was discharged w\/ OPD chest clinic f\/u/i, "discharge course should enforce opener, specific values, and closing");
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
  if (!/\bPHx\s*:/.test(admission) || !/\bCC\s*:/.test(admission) || /The patient is|Admitted\/managed|PMH\/context|Key course|Active issues|Today\/pending/i.test(admission)) {
    throw new Error(`rule-based admission summary did not use the structured brief labels: ${admission}`);
  }
  assertOneMinuteAdmissionBrief(admission, "rule-based admission summary");
  if (/pneumonia|oxygen requirement|blood culture|follow up|antibiotics/i.test(admission)) {
    throw new Error(`rule-based admission summary should prefer clinical abbreviations: ${admission}`);
  }
  assertDocumentIncludes(admission, /PNA|sepsis|lactate|culture|O2|renal|anticoag/i, "new admission summary should preserve admission reason, active risks, and pending work");
  assertDocumentIncludes(admission, /PHx:[\s\S]*CC:[\s\S]*PI:[\s\S]*ED Lab:[\s\S]*(?:Image:[\s\S]*)?Imp:/i, "new admission summary should follow the structured brief order");
  const expanded = formatRuleBasedAdmissionSummary(newAdmissionPlan, { length: "threeMinute" });
  const briefLineCount = (value) => value.split("\n").filter((line) => line.trim()).length;
  if (briefLineCount(expanded) < briefLineCount(admission) || briefLineCount(expanded) > 18) {
    throw new Error(`3-min admission brief support should preserve/expand the brief safely: ${expanded}`);
  }
  assertDocumentIncludes(expanded, /ED Lab:[\s\S]*(WBC|lactate|SpO2|O2)/i, "3-min admission brief should preserve objective anchors");
  assertDocumentIncludes(expanded, /Image:[\s\S]*CXR/i, "3-min admission brief should preserve image anchors");
  const reviewedPreferred = getAdmissionSummaryText(
    {
      ...emptyPatient(),
      admissionBriefFreeText: "reviewed free text summary",
      generatedAdmissionSummary: "stale generated summary",
    },
    { allowFallback: false },
  );
  if (reviewedPreferred !== "reviewed free text summary") {
    throw new Error(`reviewed admission brief should display before stale generated summary: ${reviewedPreferred}`);
  }
  const existingMarkdownBrief = getAdmissionSummaryText(
    {
      ...emptyPatient(),
      admissionBriefFreeText: [
        "**90F**",
        "",
        "**PHx:** T2DM c prior DKA",
        "",
        "**CC:** fever x 1 d",
        "",
        "**PI:** vomiting and Lt thigh redness",
      ].join("\n"),
      generatedAdmissionSummary: "stale generated summary",
    },
    { allowFallback: false },
  );
  if (/\*\*/.test(existingMarkdownBrief) || !/^90F\s*\n[\s\S]*PHx:\s*T2DM[\s\S]*CC:\s*fever[\s\S]*PI:\s*vomiting/i.test(existingMarkdownBrief)) {
    throw new Error(`stored admission brief markdown emphasis should be hidden on display: ${existingMarkdownBrief}`);
  }
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
  const groupedLabText = "Lab: WBC 12.7, Neu 88.9, Hb 9.4, Plt 259, BUN 16, Cr 0.46, Na 139, K 3.0, AST 175, ALT 419, INR 1.8, lactate 3.1, Troponin I 0.011 ng/mL";
  const groups = buildLabVisualSummaryFromText(groupedLabText, { maxGroups: 8, maxItemsPerGroup: 8 });
  const lines = formatLabVisualSummaryLinesFromText(groupedLabText, { maxGroups: 8, maxItemsPerGroup: 8 });
  const joined = lines.join("\n");
  for (const required of [
    /CBC:.*WBC 12\.7.*Neu 88\.9.*Hb 9\.4.*Plt 259/i,
    /Renal\/Lyte:.*Cr 0\.46.*Na 139.*K 3\.0/i,
    /Liver\/Coag:.*AST 175.*ALT 419.*INR 1\.8/i,
    /Infx\/Perfusion:.*Lactate 3\.1/i,
    /Cardiac:.*Troponin I 0\.011/i,
  ]) {
    if (!required.test(joined)) throw new Error(`visual lab summary missing grouped line ${required}:\n${joined}`);
  }
  if (/ref\s|routine hidden/i.test(joined)) {
    throw new Error(`visual lab summary should not include reference ranges or hidden-routine placeholders:\n${joined}`);
  }
  const toneMap = new Map(groups.map((group) => [group.label, group.tone]));
  if (toneMap.get("Liver/Coag") !== "critical" || toneMap.get("Renal/Lyte") !== "important") {
    throw new Error(`visual lab tone should be stable across renderers: ${JSON.stringify([...toneMap.entries()])}`);
  }
  console.log("PASS Visual lab summary groups labs consistently for Board/Preview/Print");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Visual lab summary groups labs consistently for Board/Preview/Print", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Visual lab summary groups labs consistently for Board/Preview/Print: ${failures[failures.length - 1].error}`);
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
      generatedWeeklySummary: existing.generatedWeeklySummary,
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
  const icuReviewedSoap = [
    "ICU-XFER 78/M",
    "Dx: septic shock recovery w/ AKI/hyperK",
    "",
    "S:",
    "- transfer from ICU, O2/aspiration concern",
    "",
    "O:",
    "- Lab: Cr/K/Troponin/Hb/Plt active trends",
    "- Culture: blood/sputum cultures pending",
    "",
    "A/P:",
    "# AKI/hyperK after shock",
    "- CRRT stopped, trend Cr/K/I/O, avoid nephrotoxins.",
    "# Infection / aspiration risk",
    "- Meropenem/vancomycin, f/u cultures and de-escalation.",
    "# O2/bleeding risk",
    "- Monitor O2, aspiration, Hb/Plt/bleeding.",
  ].join("\n");
  const digest = getRoundingDigest(patient, [{ ...emptyDailyNote(todayKey()), soapText: icuReviewedSoap }], { mode: "board" });
  const labFocus = getLabFocusSummary(patient, [], todayKey()).text;
  const sbar = formatRuleBasedSbar(applyClinicalKnowledgeToText(rawIcuTransfer));
  const labels = parsedLabs.map((item) => item.label).join("\n");
  if (reviewed.status !== "updateCandidate" || reviewed.matchPatientId !== existing.id) {
    throw new Error("existing patient was not preserved as an update candidate");
  }
  if (patient.isNewAdmission || patient.showAdmissionBriefOnPrint || patient.generatedAdmissionSummary) {
    throw new Error("existing inpatient transfer was treated as a new admission");
  }
  if (patient.generatedWeeklySummary !== existing.generatedWeeklySummary) {
    throw new Error(`existing inpatient import polluted generatedWeeklySummary: ${patient.generatedWeeklySummary}`);
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
  if (!/Subjective|V\/S|Physical exam|Images|Active problems/i.test(changedLabels) || /A\/P/i.test(changedLabels)) {
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
  if (cleanedAp !== dirtyPatient.assessmentPlanItems.map((item) => [item.problemTitle, item.assessmentSummary, ...item.planItems].join("\n")).join("\n")) {
    throw new Error(`cleanup mutated legacy A/P even though A/P is SOAP-only:\n${cleanedAp}`);
  }
  if (/UGIB|Cardio \/ HF \/ rhythm|Stroke \/ neuro/i.test(cleaned.activeProblems)) {
    throw new Error(`cleanup active problems still noisy:\n${cleaned.activeProblems}`);
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
  if (patient.assessmentPlanItems.length !== 0 || patient.plan.trim()) {
    throw new Error(`rule polish created legacy A/P despite SOAP-only policy: ${JSON.stringify(patient.assessmentPlanItems)}\n${patient.plan}`);
  }
  if (/Heme\/onc safety|review VTE\/bleed risk|UGIB|transfusion|EGD|T&S/i.test([patient.generatedSbarNote, patient.generatedWeeklySummary].join("\n"))) {
    throw new Error(`rule polish leaked generic A/P wording into generated docs:\n${patient.generatedSbarNote}\n${patient.generatedWeeklySummary}`);
  }
  console.log("PASS Rule polish does not create legacy A/P");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Rule polish does not create legacy A/P", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Rule polish does not create legacy A/P: ${failures[failures.length - 1].error}`);
}

try {
  const labText = "5/15 WBC 12.7, Neu 88.9, Hb 9.4, Plt 259, Cr 0.46, K 3.0. B/C MRSA then Enterococcus. Teicoplanin 5/13-.";
  const patient = {
    ...emptyPatient(),
    id: "demo-board-detail-clean",
    bed: "H5-113",
    patientCode: "TEST-BOARD",
    age: 51,
    sex: "M",
    primaryDiagnosis: "esophageal SCC",
    oneLiner: "51M SCC with bacteremia and J-tube nutrition",
    underlyingDiseases: "hypopharyngeal SCC s/p chemotherapy; J-tube",
    activeProblems: "Bacteremia / infection\nHeme/Onc safety\nUGIB / anemia",
    hospitalCourseHighlights: "B/C peripheral MRSA, Port-A Enterococcus faecalis. Teicoplanin 5/13-. ED shock responded to IV fluids.",
    rawLabText: labText,
    newLabs: labText,
    parsedLabItems: parseLabText(labText),
    newImaging: "CT neck/chest: persistent esophageal wall thickening; necrotic metastatic LAD. Brain CT no hemorrhage/edema.",
    importantRedFlags:
      "Bacteremia\n!Possible sepsis/shock physiology - Reason: resolved initial shock.\n!Active bleeding or severe anemia signal - Reason: Hb 9.4 without bleeding.\n!Febrile neutropenia safety signal - Reason: cancer.",
    tasks: [
      { id: "t-board-1", text: "Continue teicoplanin for MRSA bacteremia / Enterococcus infection", done: false, priority: "normal", category: "order", dueDate: "", createdAt: nowIso(), completedAt: "" },
      { id: "t-board-2", text: "f/u repeat blood cultures from 5/15", done: false, priority: "urgent", category: "lab", dueDate: "", createdAt: nowIso(), completedAt: "" },
      { id: "t-board-3", text: "trend TLS labs: K/Phos/Ca/uric acid/Cr", done: false, priority: "urgent", category: "lab", dueDate: "", createdAt: nowIso(), completedAt: "" },
      { id: "t-board-4", text: "f/u pathology/staging; review VTE/bleed risk", done: false, priority: "normal", category: "other", dueDate: "", createdAt: nowIso(), completedAt: "" },
    ],
    assessmentPlanItems: [
      {
        id: "ap-board-dirty",
        problemTitle: "Heme/Onc safety",
        assessmentSummary: "Cancer/infx risk; staging/path pending; review VTE/bleed.",
        evidenceOrCourseItems: ["B/C MRSA and Enterococcus", "hypovolemic shock improved after IV fluids"],
        planItems: ["f/u pathology/staging", "review VTE/bleed risk", "Onc/ID if fever/neutro"],
        category: "activeProblem",
        isImportant: true,
        color: "",
        order: 0,
      },
    ],
    updatedAt: nowIso(),
  };
  const noSoapDigest = getRoundingDigest(patient, [], { mode: "board", hideCompletedTasks: true });
  if (noSoapDigest.assessmentPlan.trim()) {
    throw new Error(`digest used legacy/rule A/P without SOAP text: ${noSoapDigest.assessmentPlan}`);
  }
  const reviewedSoap = [
    "TEST-BOARD 51/M",
    "Dx: esophageal SCC w/ MRSA/Enterococcus bacteremia",
    "",
    "S:",
    "- weak, afebrile",
    "",
    "O:",
    "- Lab: WBC 12.7, Neu 88.9, Hb 9.4, K 3.0",
    "- Image: CT neck/chest persistent esophageal wall thickening/metastatic LAD",
    "",
    "A/P:",
    "# MRSA/Enterococcus bacteremia",
    "- Teicoplanin 5/13-, f/u B/C clearance, define duration/source.",
    "# SCC w/ J-tube nutrition",
    "- maintain J-tube feeds, onc f/u.",
    "",
    "Tasks:",
    "- f/u repeat blood cultures from 5/15",
  ].join("\n");
  const digest = getRoundingDigest(patient, [{ ...emptyDailyNote("2026-05-15"), soapText: reviewedSoap }], { mode: "board", hideCompletedTasks: true });
  if (!/MRSA\/Enterococcus bacteremia|Teicoplanin/i.test(digest.assessmentPlan)) {
    throw new Error(`board/detail SOAP A/P lost concrete infection plan: ${digest.assessmentPlan}`);
  }
  if (/TLS\s*\/\s*onc safety|Heme\/Onc safety|review VTE\/bleed risk|UGIB|transfusion|EGD/i.test(digest.assessmentPlan)) {
    throw new Error(`board/detail A/P kept generic or false plans: ${digest.assessmentPlan}`);
  }
  if (!/Abn Infx:.*WBC.*Neu/i.test(digest.lab) || !/Abn Anemia:.*Hb/i.test(digest.lab) || !/Abn Lyte\/Renal:.*K/i.test(digest.lab)) {
    throw new Error(`lab focus was not severity/category grouped: ${digest.lab}`);
  }
  if (/TLS/i.test(digest.lab)) {
    throw new Error(`lab focus created false TLS label from generic task/context: ${digest.lab}`);
  }
  if (/Continue teicoplanin|review VTE\/bleed risk|TLS labs/i.test(digest.tasks) || !/blood culture/i.test(digest.tasks)) {
    throw new Error(`tasks were not deduped/action-focused: ${digest.tasks}`);
  }
  if (/Possible sepsis\/shock|Active bleeding|Febrile neutropenia/i.test(digest.redFlags)) {
    throw new Error(`rule-label red flags leaked into board/detail digest: ${digest.redFlags}`);
  }
  const dxIssueText = [digest.snapshot.dxCore, ...digest.snapshot.activeIssues].join("\n");
  const bacteremiaMentions = dxIssueText.match(/bacteremia/gi)?.length ?? 0;
  if (bacteremiaMentions > 1) {
    throw new Error(`Dx/issues repeated bacteremia: ${dxIssueText}`);
  }
  console.log("PASS Board/detail digest is print-like, lab severity-grouped, dx-deduped, and task-deduped");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Board/detail digest is print-like, lab severity-grouped, dx-deduped, and task-deduped", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Board/detail digest is print-like, lab severity-grouped, dx-deduped, and task-deduped: ${failures[failures.length - 1].error}`);
}

try {
  const clipped = safeClinicalLine("MRSA/Enterococcus: Teicoplanin 5/13-, f/u B/C clearance, define duration/source control", 62);
  if (/\b(?:define|after|and|with|ct|feeding)$/i.test(clipped)) {
    throw new Error(`safe clinical line left dangling tail: ${clipped}`);
  }
  const chestCtTask = safeClinicalLine("pending chest CT", 170);
  if (chestCtTask !== "pending chest CT") {
    throw new Error(`safe clinical line incorrectly removed valid imaging study tail: ${chestCtTask}`);
  }

  const reports = parseLabReports(
    "5/12 WBC 8.0, Neu 70, Hb 10.2, K 3.8\n5/15 WBC 12.7, Neu 88.9, Hb 9.4, K 3.0",
    "2026-05-18",
    "CBC/DC",
  );
  const dates = reports.map((report) => report.date).join("\n");
  if (!/2026-05-12/.test(dates) || !/2026-05-15/.test(dates)) {
    throw new Error(`lab parser did not preserve embedded report dates: ${dates}`);
  }
  const latestItems = reports.find((report) => report.date === "2026-05-15")?.items ?? [];
  const abnormalLabels = latestItems
    .filter((item) => ["WBC", "Neu", "Hb", "K"].includes(item.label))
    .map((item) => `${item.label}:${interpretLabItem(item).severity}`)
    .join(", ");
  if (!/WBC:abnormal/.test(abnormalLabels) || !/Neu:abnormal/.test(abnormalLabels) || !/Hb:abnormal/.test(abnormalLabels) || !/K:abnormal/.test(abnormalLabels)) {
    throw new Error(`smart lab abnormal interpretation missing: ${abnormalLabels}`);
  }

  const patient = {
    ...emptyPatient(),
    id: "demo-h5-113-quality",
    bed: "H5-113",
    patientCode: "TEST-H5",
    age: 51,
    sex: "M",
    primaryDiagnosis: "esophageal SCC",
    oneLiner: "51M esophageal SCC with MRSA/Enterococcus bacteremia",
    underlyingDiseases: "right hypopharyngeal SCC cT4bN2bM0; mid-lower esophageal SCC; J-tube",
    activeProblems: "MRSA/Enterococcus bacteremia\nSCC with J-tube nutrition/malnutrition\nAnemia",
    hospitalCourseHighlights: "Initial shock improved after IV fluids. B/C MRSA and Port-A Enterococcus faecalis. Teicoplanin 5/13-.",
    rawLabText: "5/15 WBC 12.7, Neu 88.9, Hb 9.4, K 3.0",
    newLabs: "5/15 WBC 12.7, Neu 88.9, Hb 9.4, K 3.0",
    parsedLabItems: parseLabText("5/15 WBC 12.7, Neu 88.9, Hb 9.4, K 3.0"),
    newImaging: "CT neck/chest 5/13: persistent esophageal wall thickening; stable metastatic LAD. Brain CT 5/7: no ICH/edema.",
    tasks: [
      { id: "h5-task-1", text: "f/u repeat blood cultures from 5/15", done: false, priority: "urgent", category: "lab", dueDate: "", createdAt: nowIso(), completedAt: "" },
      { id: "h5-task-2", text: "trend TLS labs: K/Phos/Ca/uric acid/Cr", done: false, priority: "urgent", category: "lab", dueDate: "", createdAt: nowIso(), completedAt: "" },
    ],
    assessmentPlanItems: [
      {
        id: "h5-ap-infx",
        problemTitle: "MRSA/Enterococcus bacteremia",
        assessmentSummary: "MRSA/Enterococcus bacteremia; Teicoplanin 5/13-, f/u B/C clearance, define duration/source.",
        evidenceOrCourseItems: ["B/C MRSA and Port-A Enterococcus faecalis"],
        planItems: ["Teicoplanin 5/13-, f/u B/C clearance, define duration/source"],
        category: "activeProblem",
        isImportant: true,
        color: "",
        order: 0,
      },
    ],
    updatedAt: nowIso(),
  };
  const digest = getRoundingDigest(patient, [], { mode: "rounds", hideCompletedTasks: true });
  const combined = `${digest.risks}\n${digest.image}\n${digest.assessmentPlan}\n${digest.tasks}`;
  if (!/hypopharyngeal SCC.*esophageal SCC|esophageal SCC.*hypopharyngeal SCC/i.test(digest.risks)) {
    throw new Error(`PMH did not name cancer type: ${digest.risks}`);
  }
  if (!/CT neck\/chest/i.test(digest.image)) {
    throw new Error(`image focus did not include study type: ${digest.image}`);
  }
  if (/trend TLS labs|TLS \/ onc safety/i.test(combined)) {
    throw new Error(`unsupported TLS leaked into H5 snapshot: ${combined}`);
  }
  if (/\b(?:define|after|and|with|ct|feeding)$/im.test(digest.assessmentPlan)) {
    throw new Error(`rounds A/P has dangling line ending: ${digest.assessmentPlan}`);
  }
  console.log("PASS H5-113 quality regression keeps safe A/P, named PMH, image study type, lab dates, and abnormal flags");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "H5-113 quality regression keeps safe A/P, named PMH, image study type, lab dates, and abnormal flags", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL H5-113 quality regression keeps safe A/P, named PMH, image study type, lab dates, and abnormal flags: ${failures[failures.length - 1].error}`);
}

try {
  const patient = {
    ...emptyPatient(),
    id: "demo-soap-first",
    bed: "H5-113",
    patientCode: "DEMO-SOAP",
    age: 51,
    sex: "M",
    primaryDiagnosis: "esophageal SCC with MRSA/Enterococcus bacteremia",
    underlyingDiseases: "right hypopharyngeal SCC; mid-lower esophageal SCC; J-tube",
    tasks: [],
    updatedAt: nowIso(),
  };
  const aiDraft = {
    oneLiner: "esophageal SCC w/ MRSA/Enterococcus bacteremia",
    admissionSummary: "",
    isbarHandoff: "",
    clinicalReasoning: {
      currentClinicalState: "bacteremia on teicoplanin, clinically stable",
      primaryRisk: "line infection/source control",
      whyThisMatters: [],
      activeProblemsRanked: [],
      resolvedOrLessImportant: ["initial fluid-responsive shock, resolved"],
      missingDataNeeded: ["blood culture clearance"],
      noiseToIgnore: ["Brain CT no ICH/edema unless neuro concern"],
    },
    subjective: {
      chiefConcern: "5/15 afebrile, weak, no fever",
      symptoms: [],
      overnightEvents: [],
      importantSymptoms: [],
      importantOvernightEvents: [],
    },
    objective: {
      vitals: [
        { date: "5/15", name: "V/S", value: "T 37.0 C, BP 100/69, P 99, RR 16, SpO2 100%", interpretation: "", isAbnormal: false, isImportant: true },
      ],
      bloodSugars: [],
      physicalExam: [{ system: "Ext", finding: "No edema", isImportant: false }],
      labs: [
        { date: "5/15", group: "Infx", name: "WBC", value: "12.7", unit: "", previousValue: "", isAbnormal: true, isImportant: true, interpretation: "" },
        { date: "5/15", group: "Anemia", name: "Hb", value: "9.4", unit: "", previousValue: "10.2", isAbnormal: true, isImportant: true, interpretation: "downtrend" },
        { date: "5/15", group: "Lyte/Renal", name: "K", value: "3.0", unit: "", previousValue: "", isAbnormal: true, isImportant: true, interpretation: "" },
      ],
      images: [
        { date: "5/13", studyType: "CT neck/chest", finding: "persistent esophageal wall thickening; stable metastatic LAD", impression: "persistent esophageal wall thickening; stable metastatic LAD", isImportant: true },
      ],
    },
    assessmentPlan: [
      {
        problemTitle: "MRSA/Enterococcus bacteremia",
        assessmentSummary: "B/C MRSA and Port-A Enterococcus faecalis",
        evidenceOrCourseItems: ["Teicoplanin started 5/13"],
        planItems: ["Teicoplanin 5/13-, f/u B/C clearance, define duration/source"],
        isImportant: true,
      },
      {
        problemTitle: "Esophageal/hypopharyngeal SCC, J-tube nutrition",
        assessmentSummary: "advanced SCC with J-tube feeding",
        evidenceOrCourseItems: ["CT neck/chest 5/13 persistent esophageal wall thickening/stable metastatic LAD"],
        planItems: ["maintain J-tube feeds; oncology f/u"],
        isImportant: true,
      },
    ],
    redFlags: [{ text: "Bacteremia", reason: "culture-positive infection; verify clearance/source" }],
    tasks: [
      { text: "f/u repeat blood cultures from 5/15", priority: "urgent", dueDate: "", category: "lab" },
      { text: "monitor port-A as possible source", priority: "urgent", dueDate: "", category: "order" },
    ],
    dischargeIssues: ["continue IV abx course; outpatient oncology f/u"],
    thinkingPrompts: [],
    uncertainty: [],
  };
  const soap = aiSoapDraftToSoapDraft(aiDraft, patient, "2026-05-15");
  const text = formatSoapDraft(soap);
  if (!/^S:\n/m.test(text) || !/^O:\n/m.test(text) || !/^A\/P:\n/m.test(text) || !/^# MRSA\/Enterococcus bacteremia/m.test(text)) {
    throw new Error(`SOAP-first text lost expected section/problem structure:\n${text}`);
  }
  if (!/Lab: .*WBC 12\.7/i.test(text) || !/Lab: .*Hb 9\.4.*from 10\.2/i.test(text) || !/CT neck\/chest/i.test(text)) {
    throw new Error(`SOAP-first text lost lab trend or image study:\n${text}`);
  }
  if (/TLS \/ onc safety|trend TLS labs|Heme\/Onc safety/i.test(text)) {
    throw new Error(`SOAP-first text leaked rule labels:\n${text}`);
  }
  const parsed = parseSoapText(text);
  const patch = soapDraftToPatientPatch(parsed, patient, "2026-05-15");
  if (!/Teicoplanin 5\/13-/i.test(patch.patient.plan) || !/CT neck\/chest/i.test(patch.patient.newImaging)) {
    throw new Error(`SOAP save adapter lost concrete therapy/image:\n${patch.patient.plan}\n${patch.patient.newImaging}`);
  }
  if (patch.patient.tasks.length !== 2 || patch.patient.assessmentPlanItems.length !== patient.assessmentPlanItems.length || patch.dailyNotePatch.assessmentPlanItems) {
    throw new Error("SOAP save adapter should create tasks but preserve legacy A/P fields");
  }
  const fallbackPatient = {
    ...patient,
    rawLabText: "Cr 2.7, K 5.3",
    newLabs: "Cr 2.7, K 5.3",
    parsedLabItems: parseLabText("Cr 2.7, K 5.3"),
  };
  const fallbackSoap = patientToSoapDraft(fallbackPatient, [], "2026-05-15");
  const fallbackLabText = fallbackSoap.oLines.join("\n");
  if (/!Crit|Abn Lyte\/Renal|Trend Anemia|Anchor/i.test(fallbackLabText) || !/Lab: Cr 2\.7/i.test(fallbackLabText)) {
    throw new Error(`SOAP fallback lab line still exposes parser labels: ${fallbackLabText}`);
  }
  const messySoap = [
    "H5-113new 51/M",
    "* S： afebrile, weak",
    "O：",
    "• V/S： BP 100/69, HR 99, SpO2 100%",
    "！ Lab： Hb 7.6 from 9.4",
    "! A/P:",
    "1. MRSA/Enterococcus bacteremia：Teicoplanin 5/13-, f/u B/C clearance",
    "* Tasks: ! f/u repeat B/C",
    "DC： pending infection control",
  ].join("\n");
  const normalizedSoap = normalizeSoapTextForEditor(messySoap);
  if (
    !/^S:\n- afebrile, weak/m.test(normalizedSoap) ||
    !/^O:\n- V\/S: BP 100\/69/m.test(normalizedSoap) ||
    !/^A\/P:\n# MRSA\/Enterococcus bacteremia\n- Teicoplanin/m.test(normalizedSoap) ||
    !/^Tasks:\n- ! f\/u repeat B\/C/m.test(normalizedSoap) ||
    /[：﹕]/.test(normalizedSoap)
  ) {
    throw new Error(`SOAP bullet guard did not normalize messy symbols:\n${normalizedSoap}`);
  }
  const normalizedDraft = parseSoapText(normalizedSoap);
  if (normalizedDraft.apProblems[0]?.title !== "MRSA/Enterococcus bacteremia" || normalizedDraft.taskLines[0] !== "! f/u repeat B/C") {
    throw new Error(`SOAP bullet guard output did not parse cleanly:\n${JSON.stringify(normalizedDraft, null, 2)}`);
  }
  const legacyRedFlagPatient = {
    ...fallbackPatient,
    importantRedFlags: "! Strict I/O\n! recurrent fever or BP drop",
  };
  const legacyRedFlagSoap = patientToSoapDraft(legacyRedFlagPatient, [], "2026-05-15");
  if (legacyRedFlagSoap.header.some((line) => /^Red flags:/i.test(line))) {
    throw new Error(`Fallback SOAP should not promote legacy red flags into canonical header: ${legacyRedFlagSoap.header.join(" | ")}`);
  }
  const reviewedSoapText = [
    "H5-113new 16189520 51/M",
    "Dx: esophageal cancer w/ MRSA/Enterococcus bacteremia",
    "PMH: hypopharyngeal SCC / esophageal SCC",
    "Date: 2026-05-15",
    "Red flags: pending B/C clearance; Hb drop requiring transfusion",
    "",
    "S:",
    "- afebrile, weak, no fever",
    "",
    "O:",
    "- V/S: T 37.0 C, BP 100/69, P 99, RR 16, SpO2 100%",
    "- Lab: WBC 12.7, Neu 88.9, Hb 9.4, K 3.0",
    "- Image: CT neck/chest 5/13 persistent esophageal wall thickening/stable metastatic LAD",
    "",
    "A/P:",
    "# MRSA/Enterococcus bacteremia",
    "- Teicoplanin 5/13-, f/u B/C clearance, define duration/source",
    "# SCC, J-tube nutrition",
    "- maintain J-tube feeds; onc f/u",
    "",
    "Tasks:",
    "- f/u repeat blood cultures from 5/15",
    "- monitor port-A as possible source",
    "",
    "DC:",
    "- IV abx course; J-tube feeding; OPD oncology",
  ].join("\n");
  const plainFormatted = formatSoapTextForEditorStyle(normalizedSoap, "plain");
  if (!/^A\/P:\n1\. MRSA\/Enterococcus bacteremia: Teicoplanin/m.test(plainFormatted)) {
    throw new Error(`SOAP plain format did not preserve parser-safe A/P:\n${plainFormatted}`);
  }
  const compactFormatted = formatSoapTextForEditorStyle(reviewedSoapText, "compact");
  if ((compactFormatted.match(/^# /gm) ?? []).length > 4 || !/Teicoplanin 5\/13-/.test(compactFormatted)) {
    throw new Error(`SOAP compact format did not cap A/P while preserving key therapy:\n${compactFormatted}`);
  }
  const organHeavySoapText = [
    "CASE-LFT 77/M",
    "Dx: PNA/sepsis w/ hypoxemic RF, AKI/elevated LFT",
    "",
    "S:",
    "- Fever after weakness/cough",
    "",
    "O:",
    "- Lab: lactate 25.3, Cr 30, INR 10.6",
    "- Liver: elevated LFT, abd image no biliary dilatation/ascites",
    "- Image: chest CT pleural effusion",
    "",
    "A/P:",
    "# PNA/sepsis w/ hypoxemic RF",
    "- P/F 92, lactate 25.3, confirm Cx/source/Abx, titrate O2",
    "# R mouth floor SCC history",
    "- pT2N2a ENE(+), background onc issue after acute illness",
    "# AKI / renal safety",
    "- Cr reported 30, verify value/unit, trend Cr/K/I/O",
    "# Elevated LFT / coagulopathy",
    "- Elevated LFT + INR 10.6, no biliary dilatation/ascites, trend LFT/INR",
    "# Low-value generic plan",
    "- review VTE risk and monitor closely",
    "",
    "Tasks:",
    "- Repeat CBC/CMP/K/Cr/lactate/LFT/INR",
  ].join("\n");
  const organCompact = formatSoapTextForEditorStyle(organHeavySoapText, "compact");
  if (!/Elevated LFT \/ coagulopathy/i.test(organCompact) || !/LFT\/INR/i.test(organCompact)) {
    throw new Error(`SOAP compact format dropped elevated LFT/coag problem:\n${organCompact}`);
  }
  const pleuralSoapText = [
    "CASE-PLEURAL 45/M",
    "Dx: recurrent L parotid adenoCA, malignant pleural effusion/chylothorax, trach",
    "",
    "S:",
    "- Dyspnea improved under trach",
    "",
    "O:",
    "- CXR 5/18: BL CP angle blunting/pleural effusion",
    "",
    "A/P:",
    "# Parotid adenoCA, palliative",
    "- Skin/facial edema + malignant disease, symptom-focused care",
    "# PNA / soft tissue infection",
    "- WBC 17k -> 11.9, Betamycin + Levofloxacin x5d",
    "# Trach/edema/hypoK",
    "- monitor airway, Lasix edema, replace K 3.3",
    "# Malignant pleural effusion/chylothorax, RF improving",
    "- Tap 5/13 L1000/R1400, SpO2 100%, CXR better, PRN tap if dyspnea recurs",
    "# Generic pain plan",
    "- monitor symptoms",
  ].join("\n");
  const pleuralCompact = formatSoapTextForEditorStyle(pleuralSoapText, "compact");
  if (!/Malignant pleural effusion\/chylothorax/i.test(pleuralCompact) || !/Tap 5\/13/i.test(pleuralCompact)) {
    throw new Error(`SOAP compact format dropped malignant pleural effusion problem:\n${pleuralCompact}`);
  }
  const reviewedNote = { ...emptyDailyNote("2026-05-15"), soapText: reviewedSoapText, soapStatus: "reviewed", soapVersion: 1 };
  const canonical = getCanonicalSoapText(patient, [reviewedNote], "2026-05-15");
  if (canonical.source !== "selected" || canonical.text !== reviewedSoapText) {
    throw new Error("Canonical SOAP did not prefer selected dailyNote.soapText");
  }
  const boardSoap = patientToSoapDraft(patient, [reviewedNote], "2026-05-15");
  if (!/Teicoplanin 5\/13-/.test(boardSoap.apProblems.flatMap((problem) => problem.lines).join("\n"))) {
    throw new Error("Board/Print SOAP draft did not read reviewed soapText first");
  }
  if (!boardSoap.header.some((line) => /^Red flags: pending B\/C clearance/i.test(line))) {
    throw new Error("Reviewed SOAP red flags were not preserved from explicit soapText");
  }
  const savedPatch = soapTextToPatientPatch(reviewedSoapText, patient, "2026-05-15");
  if (savedPatch.dailyNotePatch.soapText !== reviewedSoapText || savedPatch.dailyNotePatch.soapStatus !== "reviewed") {
    throw new Error("Saving reviewed SOAP did not persist canonical soapText metadata");
  }
  const mergedLocalSoap = localRoundSoapFromPaste(patient, [reviewedNote], "2026-05-15", "5/16 B/C pending. Continue Teicoplanin 5/13-. CT neck/chest: stable LAD.");
  if (!/B\/C pending|Teicoplanin|CT neck\/chest/i.test(mergedLocalSoap)) {
    throw new Error(`Local demo SOAP merge lost treatment/pending/image facts:\n${mergedLocalSoap}`);
  }
  const cholangitisLocalSoap = localRoundSoapFromPaste(
    {
      ...emptyPatient(),
      bed: "9A-09",
      patientCode: "TEST-0528",
      age: 72,
      sex: "M",
      primaryDiagnosis: "Acute cholangitis sepsis",
      activeProblems: "AKI; O2 wean",
      underlyingDiseases: "CKD3b, HFrEF EF35%, AF on apixaban",
    },
    [],
    "2026-05-28",
    [
      "Admission:",
      "Fever/RUQ pain/jaundice/hypotension.",
      "V/S:",
      "T 38.6, BP 86/52, HR 118, RR 24, SpO2 91% NC 3L. PE: icteric sclera, RUQ tenderness.",
      "Lab:",
      "5/28 WBC 18.9, Cr 2.8 from baseline 1.6, K 5.4, lactate 3.4. B/C x2 pending.",
      "Image:",
      "CT A/P 5/28: CBD stone with cholangitis. ERCP 5/28: CBD stone extraction + plastic biliary stent.",
      "藥囑:",
      "piperacillin/tazobactam 5/28-, hold apixaban, O2 NC 3L.",
    ].join("\n"),
  );
  if (!/piperacillin\/tazobactam 5\/28-/i.test(cholangitisLocalSoap) || !/ERCP 5\/28/i.test(cholangitisLocalSoap) || !/PE: icteric sclera/i.test(cholangitisLocalSoap)) {
    throw new Error(`Local demo New SOAP merge lost abx/procedure/PE facts:\n${cholangitisLocalSoap}`);
  }
  if (/V\/S:\s*PE:/i.test(cholangitisLocalSoap)) {
    throw new Error(`Local demo New SOAP merge mislabeled PE as V/S:\n${cholangitisLocalSoap}`);
  }
  const highlighted = soapTextWithDerivedHighlights(reviewedSoapText);
  if (!/!!- Teicoplanin 5\/13-/i.test(highlighted) || !/\[\[orange:.*OPD oncology/i.test(highlighted)) {
    throw new Error(`Derived SOAP highlight did not mark infection/DC signals:\n${highlighted}`);
  }
  const completeEvidence = deriveSoapEvidence(reviewedSoapText, { labs: "WBC 12.7, Neu 88.9, Hb 9.4, K 3.0", orders: "Teicoplanin 5/13-" });
  if (!completeEvidence.sourceRefs.some((ref) => ref.sourceField === "orders" && /Teicoplanin/i.test(ref.line))) {
    throw new Error(`SOAP evidence did not link preview line to transient order source: ${JSON.stringify(completeEvidence.sourceRefs)}`);
  }
  if (completeEvidence.missingData.some((item) => item.id === "antibiotic-culture-source-duration")) {
    throw new Error(`Complete antibiotic line should not warn when culture/source/duration are present: ${JSON.stringify(completeEvidence.missingData)}`);
  }
  const gapSoapText = [
    "7B-01 TEST 72/F",
    "Dx: fever",
    "",
    "S:",
    "- weak",
    "",
    "O:",
    "- Lab: Cr 3.1, K 6.2",
    "",
    "A/P:",
    "# Infection",
    "- Ceftriaxone started",
    "# AKI / hyperK",
    "- worsening renal function",
  ].join("\n");
  const gapEvidence = deriveSoapEvidence(gapSoapText);
  for (const expected of ["missing-code-status", "missing-allergy", "antibiotic-culture-source-duration", "aki-hyperk-follow-up"]) {
    if (!gapEvidence.missingData.some((item) => item.id === expected)) {
      throw new Error(`SOAP evidence missed ${expected}: ${JSON.stringify(gapEvidence.missingData, null, 2)}`);
    }
  }
  const bleedingEvidence = deriveSoapEvidence([
    "8C-02 TEST 66/M",
    "Code: Full | Allergy: NKDA",
    "Dx: GI bleed",
    "",
    "A/P:",
    "# Melena",
    "- Hb 6.8 with hypotension",
  ].join("\n"));
  if (!bleedingEvidence.missingData.some((item) => item.id === "bleeding-follow-up")) {
    throw new Error(`SOAP evidence missed bleeding follow-up gap: ${JSON.stringify(bleedingEvidence.missingData, null, 2)}`);
  }
  console.log("PASS SOAP-first adapter creates one editable note and saves to existing fields");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "SOAP-first adapter creates one editable note and saves to existing fields", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL SOAP-first adapter creates one editable note and saves to existing fields: ${failures[failures.length - 1].error}`);
}

try {
  const messySoap = [
    "I3-013 51/M",
    "S：",
    "• dyspnea improved",
    "O：",
    "！ BP 90/50 HR 120 SpO2 88%",
    "* Lab: Cr 2.7, K 6.1",
    "1) CT chest: malignant pleural effusion/chylothorax improved after tap",
    "A/P：",
    "1) Malignant pleural effusion/chylothorax: Tap 5/13 L1000/R1400, CXR improved; PRN tap if dyspnea recurs.",
    "2) Elevated LFT/coagulopathy: INR 10.6, trend LFT/INR.",
    "Tasks：",
    "• f/u repeat CXR and tap need",
  ].join("\n");
  const editorDraft = parseSoapTextToEditorDraft(messySoap);
  const normalizedSoap = editorDraftToSoapText(editorDraft);
  if (!/S:\n- dyspnea improved/i.test(normalizedSoap) || !/A\/P:\n# Malignant pleural effusion\/chylothorax/i.test(normalizedSoap)) {
    throw new Error(`structured editor failed to normalize mixed symbols:\n${normalizedSoap}`);
  }
  if (!/!! V\/S: BP 90\/50 HR 120 SpO2 88%/i.test(normalizedSoap) || !/!! Lab: Cr 2\.7, K 6\.1/i.test(normalizedSoap)) {
    throw new Error(`structured editor lost critical/important tone:\n${normalizedSoap}`);
  }
  const lintIssues = lintSoapEditorDraft({ ...editorDraft, apProblems: [{ ...editorDraft.apProblems[0], title: "" }] });
  if (!lintIssues.some((issue) => /no problem title/i.test(issue.text))) {
    throw new Error(`structured editor did not warn on A/P without title: ${JSON.stringify(lintIssues)}`);
  }
  const previewTone = classifyClinicalLine("Lab: Cr 2.7, K 6.1", { fallbackKind: "lab" }).tone;
  const boardTone = classifyClinicalLine("Lab: Cr 2.7, K 6.1", { fallbackKind: "lab" }).tone;
  const printTone = classifyClinicalLine("Lab: Cr 2.7, K 6.1", { fallbackKind: "lab" }).tone;
  if (previewTone !== "critical" || boardTone !== previewTone || printTone !== previewTone) {
    throw new Error(`unified classifier inconsistent across surfaces: ${previewTone}/${boardTone}/${printTone}`);
  }
  const peImageDraft = parseSoapTextToEditorDraft("O:\n- PE: CT chest: pleural effusion\nA/P:\n# Effusion\n- PRN tap");
  if (!lintSoapEditorDraft(peImageDraft).some((issue) => /marked as PE/i.test(issue.text))) {
    throw new Error("structured editor did not warn when image/report text is marked PE");
  }
  const orderEditorDraft = parseSoapTextToEditorDraft("Tasks:\n- Order: VS q4h\n- Complete Levofloxacin PO x5 days\n- f/u Cx");
  if (orderEditorDraft.taskLines.filter((line) => line.subtype === "order").length !== 2) {
    throw new Error(`structured editor did not split order-like task lines: ${JSON.stringify(orderEditorDraft.taskLines)}`);
  }
  const orderSoap = editorDraftToSoapText({
    ...orderEditorDraft,
    taskLines: [
      { ...orderEditorDraft.taskLines[0], text: "VS q4h", subtype: "order" },
      { ...orderEditorDraft.taskLines[2], text: "f/u Cx" },
    ],
  });
  if (!/Tasks:[\s\S]*Order: VS q4h[\s\S]*f\/u Cx/i.test(orderSoap)) {
    throw new Error(`structured editor did not serialize order lines safely:\n${orderSoap}`);
  }
  const sourceMergedOrderDraft = mergeOrderSourceIntoEditorDraft(orderEditorDraft, "hold apixaban\nVS q6h");
  const sourceMergedOrderSoap = editorDraftToSoapText(sourceMergedOrderDraft);
  if (!/Tasks:[\s\S]*Order: hold apixaban[\s\S]*Order: VS q6h/i.test(sourceMergedOrderSoap)) {
    throw new Error(`pending order source was not merged into saved SOAP:\n${sourceMergedOrderSoap}`);
  }
  const duplicateOrderDraft = mergeOrderSourceIntoEditorDraft(sourceMergedOrderDraft, "Order: VS q6h");
  if (duplicateOrderDraft.taskLines.filter((line) => /VS q6h/i.test(line.text)).length !== 1) {
    throw new Error(`pending order source merge duplicated existing order lines: ${JSON.stringify(duplicateOrderDraft.taskLines)}`);
  }
  const imagingTaskSoap = editorDraftToSoapText({
    ...orderEditorDraft,
    taskLines: [{ ...orderEditorDraft.taskLines[2], text: "pending chest CT", tone: "important" }],
  });
  if (!/Tasks:[\s\S]*! pending chest CT/i.test(imagingTaskSoap)) {
    throw new Error(`structured editor dropped valid CT task tail:\n${imagingTaskSoap}`);
  }
  console.log("PASS Structured SOAP editor normalizes symbols and shares clinical severity");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Structured SOAP editor normalizes symbols and shares clinical severity", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Structured SOAP editor normalizes symbols and shares clinical severity: ${failures[failures.length - 1].error}`);
}

try {
  const malformedAiSoap = [
    "H5-113 51/M",
    "Subjective: weak, afebrile",
    "Objective:",
    "BP 100/69 HR 99 SpO2 100%",
    "Lab: WBC 12.7, Hb 9.4, K 3.0",
    "Assessment/Plan:",
    "MRSA/Enterococcus bacteremia: Teicoplanin 5/13-, f/u B/C clearance.",
    "Orders:",
    "continue Teicoplanin",
    "Discharge:",
    "OPD oncology after infection clearance",
  ].join("\n");
  const normalizedAi = normalizeAiSoapText(malformedAiSoap, ["source warning"]);
  if (normalizedAi.contractVersion !== AI_SOAP_OUTPUT_CONTRACT_VERSION) {
    throw new Error(`AI SOAP contract version mismatch: ${normalizedAi.contractVersion}`);
  }
  if (!/^S:\n- weak, afebrile/m.test(normalizedAi.soapText) || !/^O:\n- V\/S: BP 100\/69 HR 99 SpO2 100%/m.test(normalizedAi.soapText)) {
    throw new Error(`AI SOAP normalizer did not stabilize S/O sections:\n${normalizedAi.soapText}`);
  }
  if (!/^A\/P:\n# MRSA\/Enterococcus bacteremia\n- Teicoplanin 5\/13-;\s*f\/u B\/C clearance\./m.test(normalizedAi.soapText)) {
    throw new Error(`AI SOAP normalizer did not stabilize A/P block:\n${normalizedAi.soapText}`);
  }
  if (!/Tasks:[\s\S]*continue Teicoplanin/i.test(normalizedAi.soapText) || !/DC:[\s\S]*OPD oncology/i.test(normalizedAi.soapText)) {
    throw new Error(`AI SOAP normalizer lost task/DC content:\n${normalizedAi.soapText}`);
  }
  const sparseAi = normalizeAiSoapText("A/P:\n# PNA\n- Ceftriaxone started");
  if (!/S:\n- No documented interval event\./.test(sparseAi.soapText) || !/O:\n- No new objective data provided\./.test(sparseAi.soapText)) {
    throw new Error(`AI SOAP normalizer did not add explicit empty states:\n${sparseAi.soapText}`);
  }
  const repetitiveAi = normalizeAiSoapText([
    "S:",
    "- dyspnea improved",
    "O:",
    "- V/S: SpO2 94% NC2L",
    "- Lab: WBC 14, Na 156",
    "A/P:",
    "# PNA / infection",
    "- Ceftriaxone 6/1-, f/u B/C; O2 NC2L",
    "# Hypernatremia",
    "- Na 156; Ceftriaxone 6/1-, f/u B/C; O2 NC2L",
    "# O2 need",
    "- O2 NC2L; Ceftriaxone 6/1-, f/u B/C",
  ].join("\n"));
  const repetitiveAp = parseSoapText(repetitiveAi.soapText).apProblems;
  const ceftriaxoneProblemCount = repetitiveAp.filter((problem) => /Ceftriaxone/i.test(problem.lines.join(" "))).length;
  const oxygenProblemCount = repetitiveAp.filter((problem) => /\bO2\b|NC2L/i.test(problem.lines.join(" "))).length;
  if (ceftriaxoneProblemCount > 1 || oxygenProblemCount > 1) {
    throw new Error(`AI SOAP normalizer allowed repeated treatment lines across A/P:\n${repetitiveAi.soapText}`);
  }
  if (!/# Hypernatremia[\s\S]*Na 156/i.test(repetitiveAi.soapText)) {
    throw new Error(`AI SOAP normalizer did not preserve/create sodium A/P from critical O/Lab:\n${repetitiveAi.soapText}`);
  }
  const respiratorySplitAi = normalizeAiSoapText([
    "S:",
    "- SOB improved",
    "O:",
    "- V/S: SpO2 99% NC2L",
    "A/P:",
    "# Acute hypoxemic RF s/p MV/extubation, improving",
    "# s/p lung-protective MV 6/8-6/11, prone 6/8 18",
    "# 00-6/9 13",
    "- 00; extubated 6/23 and now stable on NC.",
    "- Cont pulm rehab, breathing training, and wean O2 as tolerated.",
  ].join("\n"));
  const respiratoryAp = parseSoapText(respiratorySplitAi.soapText).apProblems;
  const respiratoryProblemCount = respiratoryAp.filter((problem) => /RF|resp|MV|extubat|O2|NC/i.test(`${problem.title} ${problem.lines.join(" ")}`)).length;
  if (respiratoryProblemCount !== 1 || /00-6\/9|^00;|\?亙\?/i.test(respiratorySplitAi.soapText)) {
    throw new Error(`AI SOAP normalizer did not merge respiratory course fragments:\n${respiratorySplitAi.soapText}`);
  }
  if (!/s\/p lung-protective MV 6\/8-6\/11/i.test(respiratorySplitAi.soapText) || !/extubated 6\/23/i.test(respiratorySplitAi.soapText)) {
    throw new Error(`AI SOAP normalizer lost respiratory course details:\n${respiratorySplitAi.soapText}`);
  }
  const editorRespDraft = parseSoapTextToEditorDraft(respiratorySplitAi.soapText);
  if (editorRespDraft.apProblems.length !== respiratoryAp.length || /00-6\/9|^00;/i.test(editorDraftToSoapText(editorRespDraft))) {
    throw new Error(`Structured editor did not load normalized respiratory A/P:\n${editorDraftToSoapText(editorRespDraft)}`);
  }

  let history = createUndoRedoHistory("A");
  history = pushUndoRedoEdit(history, "AB");
  history = pushUndoRedoEdit(history, "ABC");
  const undoOnce = undoEdit(history);
  if (!undoOnce.changed || undoOnce.history.present !== "AB") throw new Error("Undo did not restore previous edit state");
  const redoOnce = redoEdit(undoOnce.history);
  if (!redoOnce.changed || redoOnce.history.present !== "ABC") throw new Error("Redo did not restore undone edit state");
  const replacedHistory = replaceUndoRedoPresent(redoOnce.history, "Firestore snapshot");
  if (replacedHistory.past.length !== 0 || replacedHistory.future.length !== 0 || replacedHistory.present !== "Firestore snapshot") {
    throw new Error(`Programmatic replace polluted undo stack: ${JSON.stringify(replacedHistory)}`);
  }

  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  const scope = { kind: "roundSoap", patientId: "p-test", selectedDate: "2026-05-20" };
  const baseline = { soapText: "S:\n- baseline" };
  const recoveryDraft = makeRecoveryDraft(scope, { soapText: "S:\n- unsaved edit" }, baseline, "2026-05-20T08:00:00.000Z");
  if (!writeRecoveryDraft(storage, recoveryDraft)) throw new Error("Recovery draft write failed");
  const restoredDraft = readRecoveryDraft(storage, scope);
  if (!restoredDraft || restoredDraft.payload.soapText !== "S:\n- unsaved edit") {
    throw new Error(`Recovery draft did not round-trip: ${JSON.stringify(restoredDraft)}`);
  }
  const cleanState = recoveryStaleState(restoredDraft, recoveryFingerprint(baseline), "2026-05-20T08:00:00.000Z");
  if (cleanState.stale) throw new Error(`Recovery draft should not be stale: ${JSON.stringify(cleanState)}`);
  const staleState = recoveryStaleState(restoredDraft, recoveryFingerprint({ soapText: "S:\n- newer saved" }), "2026-05-20T09:00:00.000Z");
  if (!staleState.stale) throw new Error("Recovery stale protection did not detect newer saved data");
  removeRecoveryDraft(storage, scope);
  if (readRecoveryDraft(storage, scope)) throw new Error("Recovery draft cleanup failed");

  console.log("PASS AI SOAP contract, undo/redo, and recovery draft protection");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "AI SOAP contract, undo/redo, and recovery draft protection", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL AI SOAP contract, undo/redo, and recovery draft protection: ${failures[failures.length - 1].error}`);
}

try {
  const baselineSoap = [
    "7A-01 IM-A01 67/F",
    "Dx: PNA w/ bacteremia",
    "PMH: CKD3",
    "Date: 2026-05-20",
    "",
    "S:",
    "- cough improving",
    "",
    "O:",
    "- V/S: BP 112/70, HR 88, SpO2 96% RA",
    "- PE: mild RLL crackles",
    "- Lab: WBC 13.0, Hb 9.4, Cr 1.6",
    "- Image: CXR 5/20 RLL opacity improving",
    "",
    "A/P:",
    "# PNA / bacteremia",
    "- Ceftriaxone 5/19-, f/u B/C clearance and de-escalation.",
    "# AKI on CKD",
    "- Cr 1.6, trend renal/lytes and I/O.",
    "",
    "Tasks:",
    "- f/u B/C result",
    "- Order: VS q4h",
    "",
    "DC:",
    "- Pending: afebrile, Cx clearance, OPD meds.",
  ].join("\n");
  const unsafeVitalsCandidate = [
    "7A-01 IM-A01 67/F",
    "Dx: new sepsis shock",
    "PMH: CKD3",
    "Date: 2026-05-20",
    "",
    "S:",
    "- worse dyspnea and fever",
    "",
    "O:",
    "- V/S: BP 108/66, HR 92, SpO2 97% RA",
    "- PE: clear breath sounds",
    "- Lab: WBC normalized",
    "",
    "A/P:",
    "# Sepsis shock",
    "- Stop Ceftriaxone, no culture follow-up needed.",
    "",
    "Tasks:",
    "- no pending tasks",
  ].join("\n");
  const vitalsOnly = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: baselineSoap,
    candidateText: unsafeVitalsCandidate,
    sourceFields: { vitals: "BP 108/66 HR 92 SpO2 97% RA" },
    candidateWarnings: ["AI generated draft"],
  });
  if (!/V\/S: BP 108\/66, HR 92, SpO2 97% RA/i.test(vitalsOnly.acceptedText)) {
    throw new Error(`Vitals-only update did not apply V/S:\n${vitalsOnly.acceptedText}`);
  }
  if (/V\/S: BP 112\/70, HR 88, SpO2 96% RA/i.test(vitalsOnly.acceptedText)) {
    throw new Error(`Vitals-only update kept stale V/S line:\n${vitalsOnly.acceptedText}`);
  }
  if (!/cough improving/i.test(vitalsOnly.acceptedText) || !/Ceftriaxone 5\/19-/i.test(vitalsOnly.acceptedText) || !/Pending: afebrile/i.test(vitalsOnly.acceptedText)) {
    throw new Error(`Vitals-only update rewrote protected baseline sections:\n${vitalsOnly.acceptedText}`);
  }
  if (/new sepsis shock|Stop Ceftriaxone|no pending tasks/i.test(vitalsOnly.acceptedText)) {
    throw new Error(`Vitals-only update accepted unrelated AI content:\n${vitalsOnly.acceptedText}`);
  }
  if (!vitalsOnly.changedSections.some((section) => section.id === "ap" && section.blocked) || !vitalsOnly.changedSections.some((section) => section.id === "header" && section.blocked)) {
    throw new Error(`Vitals-only guard did not flag blocked high-risk sections: ${JSON.stringify(vitalsOnly.changedSections)}`);
  }
  if (!vitalsOnly.highRiskWarnings.some((warning) => /A\/P change blocked|Header\/Dx\/PMH/i.test(warning))) {
    throw new Error(`Vitals-only guard did not surface readable high-risk warnings: ${JSON.stringify(vitalsOnly.highRiskWarnings)}`);
  }

  const labCandidate = [
    "7A-01 IM-A01 67/F",
    "Dx: PNA w/ bacteremia",
    "PMH: CKD3",
    "Date: 2026-05-20",
    "",
    "S:",
    "- cough improving",
    "",
    "O:",
    "- V/S: BP 112/70, HR 88, SpO2 96% RA",
    "- PE: mild RLL crackles",
    "- Lab: WBC 10.2 from 13.0, Hb 9.4 stable, Cr 2.0 from 1.6",
    "- Image: CXR 5/20 RLL opacity improving",
    "",
    "A/P:",
    "# PNA / bacteremia",
    "- WBC improving, f/u B/C clearance.",
    "# AKI on CKD",
    "- Cr 2.0 from 1.6, trend renal/lytes and I/O.",
    "# New CHF",
    "- Start diuresis.",
    "",
    "Tasks:",
    "- f/u B/C result",
    "- Order: VS q4h",
    "",
    "DC:",
    "- Pending: afebrile, Cx clearance, OPD meds.",
  ].join("\n");
  const labOnly = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: baselineSoap,
    candidateText: labCandidate,
    sourceFields: { labs: "WBC 10.2 from 13.0, Hb 9.4 stable, Cr 2.0 from 1.6" },
  });
  if (!/Lab: WBC 10\.2 from 13\.0, Hb 9\.4 stable, Cr 2\.0 from 1\.6/i.test(labOnly.acceptedText)) {
    throw new Error(`Lab-only update did not apply lab trend:\n${labOnly.acceptedText}`);
  }
  if (/Lab: WBC 13\.0, Hb 9\.4, Cr 1\.6/i.test(labOnly.acceptedText)) {
    throw new Error(`Lab-only update kept stale raw lab line:\n${labOnly.acceptedText}`);
  }
  const labOnlyVisual = formatLabVisualSummaryLinesFromText(labOnly.acceptedText, { maxGroups: 8, maxItemsPerGroup: 8 }).join("\n");
  if (!/WBC 10\.2.*\(13\)|Cr 2\.0.*\(1\.6\)/i.test(labOnlyVisual)) {
    throw new Error(`Lab visual summary did not display current(previous) trend:\n${labOnlyVisual}`);
  }
  if (!/# PNA \/ bacteremia[\s\S]*WBC improving[\s\S]*Ceftriaxone 5\/19-[\s\S]*# AKI on CKD[\s\S]*Cr 2\.0 from 1\.6/i.test(labOnly.acceptedText)) {
    throw new Error(`Lab-only update did not merge facts under existing A/P titles:\n${labOnly.acceptedText}`);
  }
  if (/New CHF|Start diuresis/i.test(labOnly.acceptedText)) {
    throw new Error(`Lab-only update accepted unsupported new A/P problem:\n${labOnly.acceptedText}`);
  }
  if (/Cr 1\.6, trend renal\/lytes and I\/O/i.test(labOnly.acceptedText)) {
    throw new Error(`Lab-only A/P kept stale renal assessment instead of replacing under same problem:\n${labOnly.acceptedText}`);
  }

  const imageBaseline = [
    "7A-02 IM-A02 70/M",
    "Dx: aspiration PNA",
    "",
    "S:",
    "- cough improving.",
    "",
    "O:",
    "- V/S: BP 120/70, SpO2 96% RA",
    "- Image: CXR 5/20 RLL opacity, small R effusion.",
    "",
    "A/P:",
    "# Aspiration PNA",
    "- CXR 5/20 RLL opacity; Ceftriaxone 5/20-, f/u sputum Cx.",
    "",
    "Tasks:",
    "- f/u sputum Cx",
  ].join("\n");
  const imageCandidate = imageBaseline
    .replace("Image: CXR 5/20 RLL opacity, small R effusion.", "Image: CXR 5/21 RLL opacity improving, no effusion.")
    .replace("CXR 5/20 RLL opacity; Ceftriaxone 5/20-, f/u sputum Cx.", "CXR 5/21 improved; continue Ceftriaxone and f/u sputum Cx.");
  const imageOnly = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: imageBaseline,
    candidateText: imageCandidate,
    sourceFields: { images: "CXR 5/21 RLL opacity improving, no effusion" },
  });
  if (!/Image: CXR 5\/21 RLL opacity improving, no effusion/i.test(imageOnly.acceptedText) || /Image: CXR 5\/20 RLL opacity/i.test(imageOnly.acceptedText)) {
    throw new Error(`Image-only update did not replace stale CXR line:\n${imageOnly.acceptedText}`);
  }
  if (!/CXR 5\/21 improved/i.test(imageOnly.acceptedText) || /CXR 5\/20 RLL opacity/i.test(imageOnly.acceptedText)) {
    throw new Error(`Image-only A/P kept stale CXR assessment instead of updating matching problem:\n${imageOnly.acceptedText}`);
  }

  const ordersCandidate = baselineSoap.replace("- Order: VS q4h", "- Order: Ceftriaxone 5/19-, VS q4h, KCl replacement").replace("- Ceftriaxone 5/19-, f/u B/C clearance and de-escalation.", "- Broad new A/P rewrite.");
  const ordersOnly = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: baselineSoap,
    candidateText: ordersCandidate,
    sourceFields: { orders: "Ceftriaxone 5/19-, VS q4h, KCl replacement" },
  });
  if (!/Ceftriaxone 5\/19-, VS q4h, KCl replacement/i.test(ordersOnly.acceptedText) || !/Ceftriaxone 5\/19-, f\/u B\/C clearance/i.test(ordersOnly.acceptedText)) {
    throw new Error(`Orders-only update did not isolate order changes from A/P:\n${ordersOnly.acceptedText}`);
  }
  if (/Broad new A\/P rewrite/i.test(ordersOnly.acceptedText)) {
    throw new Error(`Orders-only update accepted unrelated A/P rewrite:\n${ordersOnly.acceptedText}`);
  }
  const acceptedAp = acceptSoapDeltaSection(vitalsOnly.acceptedText, unsafeVitalsCandidate, "ap");
  if (!/Stop Ceftriaxone/i.test(acceptedAp)) {
    throw new Error(`Accept section did not apply candidate A/P for manual override:\n${acceptedAp}`);
  }
  const restoredVs = restoreSoapDeltaSection(vitalsOnly.acceptedText, baselineSoap, "vs");
  if (!/V\/S: BP 112\/70, HR 88, SpO2 96% RA/i.test(restoredVs) || /BP 108\/66/i.test(restoredVs)) {
    throw new Error(`Restore section did not restore baseline V/S:\n${restoredVs}`);
  }
  const transferCandidate = guardRoundSoapDelta({
    workflowMode: "transferHandoff",
    baselineText: baselineSoap,
    candidateText: unsafeVitalsCandidate,
    sourceFields: { admission: "PNA admission", lastSoap: baselineSoap, vitals: "BP 108/66" },
  });
  if (transferCandidate.acceptedText !== transferCandidate.candidateText || !transferCandidate.changedSections.some((section) => section.id === "ap")) {
    throw new Error("Transfer/New SOAP guard should allow full candidate draft but still report changed sections.");
  }
  const overbroadDailyCandidate = [
    "7A-01 IM-A01 67/F",
    "Dx: PNA w/ bacteremia",
    "PMH: CKD3",
    "Date: 2026-05-20",
    "",
    "S:",
    "- cough better, no fever",
    "- denies CP, appetite good",
    "",
    "O:",
    "- V/S: BP 112/70, HR 88, SpO2 96% RA",
    "- PE: lungs clear, no edema",
    "- Lab: WBC 12.1 from 13.0",
    "",
    "A/P:",
    "# Pneumonia and bloodstream infection",
    "- WBC improving; continue antibiotics and monitor closely.",
    "# Diabetes management",
    "- Review glycemic control.",
    "",
    "Tasks:",
    "- f/u B/C result",
    "- review VTE/bleed risk",
    "",
    "DC:",
    "- arrange home oxygen",
  ].join("\n");
  const overbroadDaily = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: baselineSoap,
    candidateText: overbroadDailyCandidate,
    sourceFields: {
      labs: "WBC 12.1 from 13.0",
      other: "cough better, no fever. f/u B/C result.",
    },
  });
  if (!/# PNA \/ bacteremia/i.test(overbroadDaily.acceptedText) || /Pneumonia and bloodstream infection|Diabetes management|review glycemic|VTE\/bleed|home oxygen|denies CP/i.test(overbroadDaily.acceptedText)) {
    throw new Error(`Overbroad daily update was not constrained to reviewed style/source support:\n${overbroadDaily.acceptedText}`);
  }
  if (!overbroadDaily.warnings.some((warning) => /without pasted-source support/i.test(warning))) {
    throw new Error(`Overbroad daily update did not explain held unsupported lines: ${JSON.stringify(overbroadDaily.warnings)}`);
  }
  const malformedDaily = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: baselineSoap,
    candidateText: "Rewrite looks good. Continue current management and discharge when stable.",
    sourceFields: { vitals: "BP 112/70 HR 88 SpO2 96% RA" },
  });
  if (!/Ceftriaxone 5\/19-|AKI on CKD|Pending: afebrile/i.test(malformedDaily.acceptedText) || /Continue current management|discharge when stable/i.test(malformedDaily.acceptedText)) {
    throw new Error(`Malformed daily update changed reviewed baseline:\n${malformedDaily.acceptedText}`);
  }
  if (!malformedDaily.highRiskWarnings.some((warning) => /Malformed daily SOAP draft blocked/i.test(warning))) {
    throw new Error(`Malformed daily update did not produce readable high-risk warning: ${JSON.stringify(malformedDaily.highRiskWarnings)}`);
  }
  const highYieldBaseline = [
    "H9-001 SYN-HY 70/M",
    "Dx: cholangitis sepsis w/ AKI/LFT injury",
    "PMH: CKD3, AF on apixaban",
    "",
    "S:",
    "- RUQ pain improved after ERCP.",
    "",
    "O:",
    "- V/S: BP 108/66, HR 92, SpO2 95% NC2L",
    "- Lab: WBC 18.2, Cr 2.7, K 5.6, AST 175, ALT 419, INR 1.8",
    "- Image: CT A/P 5/20 biliary dilatation, no abscess.",
    "",
    "A/P:",
    "# Cholangitis/sepsis s/p ERCP stent",
    "- Meropenem 5/20-, f/u B/C/bile Cx and source control.",
    "# AKI/hyperK",
    "- Cr 2.7, K 5.6; renal-dose meds, f/u UO/K.",
    "# LFT/coagulopathy",
    "- AST/ALT 175/419, INR 1.8; trend LFT/PT-INR after drainage.",
    "",
    "Tasks:",
    "- f/u B/C and bile Cx final",
    "- clarify Abx duration with ID/GI",
    "",
    "DC:",
    "- Pending: afebrile, Cx plan, renal/LFT trend.",
  ].join("\n");
  const sparseCandidate = [
    "H9-001 SYN-HY 70/M",
    "Dx: cholangitis",
    "",
    "S:",
    "- RUQ pain better.",
    "",
    "O:",
    "- Lab: WBC 12.1, Cr 2.1, K 4.8",
    "",
    "A/P:",
    "# Cholangitis/sepsis s/p ERCP stent",
    "- WBC improving.",
    "",
    "Tasks:",
    "- f/u Cx",
  ].join("\n");
  const highYieldDaily = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: highYieldBaseline,
    candidateText: sparseCandidate,
    sourceFields: { labs: "WBC 12.1, Cr 2.1, K 4.8" },
  });
  if (!/WBC 12\.1 \(18\.2\), Cr 2\.1 \(2\.7\), K 4\.8 \(5\.6\)/i.test(highYieldDaily.acceptedText)) {
    throw new Error(`Sparse lab update did not apply new lab:\n${highYieldDaily.acceptedText}`);
  }
  for (const required of [/Meropenem 5\/20-/i, /AST\/ALT 175\/419, INR 1\.8/i, /CT A\/P 5\/20/i, /f\/u B\/C and bile Cx final/i, /Pending: afebrile, Cx plan/i]) {
    if (!required.test(highYieldDaily.acceptedText)) {
      throw new Error(`Daily patch dropped reviewed high-yield line ${required}:\n${highYieldDaily.acceptedText}`);
    }
  }
  console.log("PASS AI SOAP delta guardrails preserve reviewed baseline unless source supports changes");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "AI SOAP delta guardrails preserve reviewed baseline unless source supports changes", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL AI SOAP delta guardrails preserve reviewed baseline unless source supports changes: ${failures[failures.length - 1].error}`);
}

try {
  const taskDraft = parseSoapTextToEditorDraft([
    "S:",
    "- stable",
    "O:",
    "- V/S: BP 120/70",
    "A/P:",
    "# PNA",
    "- improving",
    "Tasks:",
    "- Order: VS q4h",
    "- Check ambulatory oxygen saturation",
    "- f/u B/C result",
    "- Complete Levofloxacin PO x5 days",
  ].join("\n"));
  const splitTasks = splitSoapEditorTaskLines(taskDraft.taskLines);
  if (!splitTasks.orderLines.some((line) => /VS q4h/i.test(line.text)) || !splitTasks.orderLines.some((line) => /Levofloxacin/i.test(line.text))) {
    throw new Error(`Medication/order lines were not retained as explicit order subtype: ${JSON.stringify(splitTasks)}`);
  }
  if (!splitTasks.taskOnlyLines.some((line) => /Check ambulatory oxygen saturation/i.test(line.text)) || !splitTasks.taskOnlyLines.some((line) => /f\/u B\/C/i.test(line.text))) {
    throw new Error(`Routine tasks were promoted into order section during parsing: ${JSON.stringify(splitTasks)}`);
  }
  const editedTask = { ...splitTasks.taskOnlyLines[0], text: "Check ambulation after lunch" };
  const editedSplit = splitSoapEditorTaskLines([editedTask, ...splitTasks.orderLines]);
  if (!editedSplit.taskOnlyLines.some((line) => /Check ambulation/i.test(line.text)) || editedSplit.orderLines.some((line) => /Check ambulation/i.test(line.text))) {
    throw new Error(`Editing a task line changed its section by text classifier: ${JSON.stringify(editedSplit)}`);
  }
  if (isOrderSoapLine("Check ambulatory oxygen saturation") || isOrderSoapLine("f/u B/C result")) {
    throw new Error("Generic check/follow-up tasks should not be classified as 藥囑.");
  }

  const abxSummary = buildAntibioticApSummary(
    "B/C grew MRSA and Enterococcus faecalis. Order: Teicoplanin 400 mg IV qd 5/13-. f/u repeat blood culture and define source.",
    "2026-05-15",
  );
  if (!abxSummary || !/MRSA\/Enterococcus bacteremia/i.test(abxSummary.title) || !/Teicoplanin 400 mg IV qd 5\/13- \(D3\)/i.test(abxSummary.line) || !/f\/u B\/C clearance\/susceptibility/i.test(abxSummary.line)) {
    throw new Error(`Antibiotic A/P summary did not preserve drug/day/culture follow-up: ${JSON.stringify(abxSummary)}`);
  }
  const draftWithoutAbx = parseSoapText([
    "S:",
    "- stable",
    "O:",
    "- Lab: WBC 12.7",
    "A/P:",
    "# PNA / infection",
    "- afebrile.",
    "Tasks:",
    "- f/u Cx",
  ].join("\n"));
  const abxDraft = ensureAntibioticApInDraft(
    draftWithoutAbx,
    "B/C grew MRSA and Enterococcus. Teicoplanin 400 mg IV qd 5/13-. f/u B/C.",
    "2026-05-15",
  );
  const abxText = formatSoapDraft(abxDraft);
  if (!/# PNA \/ infection[\s\S]*Teicoplanin 400 mg IV qd 5\/13- \(D3\)/i.test(abxText)) {
    throw new Error(`Antibiotic line was not merged into infection A/P:\n${abxText}`);
  }

  const baselineProtected = [
    "S:",
    "- dyspnea improved",
    "O:",
    "- Lab: WBC 12.7, Cr 1.2",
    "A/P:",
    "# MRSA/Enterococcus bacteremia",
    "- Teicoplanin 400 mg IV qd 5/13- (D3) for B/C MRSA/Enterococcus; f/u B/C clearance/susceptibility.",
    "Tasks:",
    "- f/u B/C result",
    "DC:",
    "- Pending: Abx duration and OPD meds.",
  ].join("\n");
  const transferWithoutProtected = guardRoundSoapDelta({
    workflowMode: "transferHandoff",
    baselineText: baselineProtected,
    candidateText: [
      "S:",
      "- dyspnea improved",
      "O:",
      "- Lab: WBC 10",
      "A/P:",
      "# PNA improving",
      "- O2 wean.",
      "Tasks:",
      "- arrange rehab",
    ].join("\n"),
    sourceFields: { admission: "transfer note", lastSoap: baselineProtected, labs: "WBC 10" },
    selectedDate: "2026-05-15",
  });
  if (!/Teicoplanin 400 mg IV qd 5\/13- \(D3\)/i.test(transferWithoutProtected.acceptedText) || !/Pending: Abx duration/i.test(transferWithoutProtected.acceptedText)) {
    throw new Error(`Transfer guard allowed protected Abx/DC information to disappear:\n${transferWithoutProtected.acceptedText}`);
  }
  if (!transferWithoutProtected.highRiskWarnings.some((warning) => /Protected antibiotic\/culture\/DC/i.test(warning))) {
    throw new Error(`Transfer guard did not warn about carried protected data: ${JSON.stringify(transferWithoutProtected.highRiskWarnings)}`);
  }

  console.log("PASS Structured task editor and antibiotic A/P preservation prevent disappearing clinical data");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Structured task editor and antibiotic A/P preservation prevent disappearing clinical data", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Structured task editor and antibiotic A/P preservation prevent disappearing clinical data: ${failures[failures.length - 1].error}`);
}

try {
  const lockedAp = classifyClinicalLine("Lab: Cr 2.7, Hb 8.7, INR 10; CXR improved", { fallbackKind: "ap", lockKind: true });
  const objectiveLab = classifyClinicalLine("Lab: Cr 2.7, Hb 8.7, INR 10", { fallbackKind: "lab" });
  if (lockedAp.kind !== "ap" || lockedAp.label !== "A/P" || !/^Lab:/i.test(lockedAp.text)) {
    throw new Error(`A/P section was not label-locked: ${JSON.stringify(lockedAp)}`);
  }
  if (objectiveLab.kind !== "lab" || objectiveLab.label !== "LAB") {
    throw new Error(`Objective lab did not remain LAB: ${JSON.stringify(objectiveLab)}`);
  }
  const markedHeaders = ["!! Dx: cholangitis sepsis", "! PMH: CKD3/HFrEF", "Dx: !! bacteremia"];
  const normalizedHeaders = markedHeaders.map(normalizeClinicalDisplayText);
  const printedHeaders = markedHeaders.map(displayPrintLine);
  if (normalizedHeaders.some((line) => /^!|:\s*!/.test(line)) || printedHeaders.some((line) => /^!|:\s*!/.test(line))) {
    throw new Error(`Severity markers leaked into display headers: ${JSON.stringify({ normalizedHeaders, printedHeaders })}`);
  }
  if (!normalizedHeaders.includes("Dx: cholangitis sepsis") || !normalizedHeaders.includes("Dx: bacteremia")) {
    throw new Error(`Header marker normalization changed clinical text: ${JSON.stringify(normalizedHeaders)}`);
  }
  const markedLine = normalizeClinicalDisplayTextPreservingMarks("!! Dx: [[yellow:cholangitis sepsis]] with [[blue:ERCP 5/20]]");
  if (markedLine !== "Dx: [[yellow:cholangitis sepsis]] with [[blue:ERCP 5/20]]") {
    throw new Error(`Inline color markup should survive display normalization: ${markedLine}`);
  }
  const markedPrint = displayPrintLine("A/P: [[yellow:AKI Cr 2.7]]; [[green:UO improving]]");
  if (!/\[\[yellow:AKI Cr 2\.7\]\]/.test(markedPrint) || !/\[\[green:UO improving\]\]/.test(markedPrint)) {
    throw new Error(`Print display should preserve inline color markup: ${markedPrint}`);
  }
  const colorPreviewHtml = renderToStaticMarkup(React.createElement(SoapVisualPreview, {
    value: [
      "S:",
      "- [[red:SOB]] improved",
      "O:",
      "- Lab: [[red:Cr 6.1]]",
      "A/P:",
      "# [[orange:AKI]]",
      "- f/u Cr",
    ].join("\n"),
  }));
  if (!/clinical-mark-red/.test(colorPreviewHtml) || !/clinical-mark-orange/.test(colorPreviewHtml)) {
    throw new Error(`Highlighted SOAP preview did not render clinician color markup: ${colorPreviewHtml.slice(0, 600)}`);
  }
  const appliedColor = applyClinicalColorMarkup("Cr 2.7 improving", 0, 6, "yellow");
  if (appliedColor !== "[[yellow:Cr 2.7]] improving") {
    throw new Error(`Color markup helper wrapped the wrong text: ${appliedColor}`);
  }
  const clearedColor = clearClinicalColorMarkupAtSelection(appliedColor, 9, 15);
  if (clearedColor !== "Cr 2.7 improving") {
    throw new Error(`Color clear helper did not remove surrounding mark: ${clearedColor}`);
  }
  const keywordRules = normalizeKeywordHighlightRules([
    { id: "teico", label: "Teico", pattern: "Teicoplanin", matchMode: "containsInsensitive", color: "orange", style: "highlight", enabled: true, priority: 0 },
    { id: "cr", label: "Cr", pattern: "Cr", matchMode: "exact", color: "yellow", style: "text", enabled: true, priority: 1 },
    { id: "disabled", label: "Mero", pattern: "Meropenem", matchMode: "containsInsensitive", color: "purple", style: "highlight", enabled: false, priority: 2 },
    { id: "blank", label: "", pattern: "   ", matchMode: "containsInsensitive", color: "not-a-color", style: "bad-style", enabled: true, priority: Number.NaN },
  ]);
  const blankRule = keywordRules.find((rule) => rule.id === "blank");
  if (!blankRule || blankRule.label !== "New highlight" || blankRule.color !== "yellow" || blankRule.style !== "highlight" || blankRule.priority !== 3) {
    throw new Error(`Keyword preference normalization should keep empty draft rules safe for settings preview: ${JSON.stringify(blankRule)}`);
  }
  const highlightedKeywords = applyUserKeywordHighlights("Continue teicoplanin; Cr 6.1; Meropenem", keywordRules);
  if (!highlightedKeywords.includes("[[orange:teicoplanin]]") || !highlightedKeywords.includes("[[yellow-text:Cr]] 6.1") || highlightedKeywords.includes("[[purple:Meropenem]]")) {
    throw new Error(`Keyword highlights were not applied deterministically: ${highlightedKeywords}`);
  }
  const manualMarkupWins = applyUserKeywordHighlights("[[blue:Teicoplanin]] Cr 1.2", keywordRules);
  if (!manualMarkupWins.includes("[[blue:Teicoplanin]]") || !manualMarkupWins.includes("[[yellow-text:Cr]] 1.2")) {
    throw new Error(`Manual markup did not win over keyword rules: ${manualMarkupWins}`);
  }

  const visibleSections = { ...visibleSectionsForPreset("compactSoap"), objectiveImages: false, tasks: false, dcBarriers: false, dcPrep: true };
  const layout = normalizeRoundingLayoutPreferences({
    preset: "compactSoap",
    visibleSections,
    apDisplayMode: "merged",
    orderDisplayMode: "category",
    printFontSize: "large",
    printLineSpacing: "airy",
    printPadding: "dense",
  });
  if (layout.apDisplayMode !== "merged") {
    throw new Error("A/P display mode setting was not preserved");
  }
  if (layout.orderDisplayMode !== "category") {
    throw new Error("Order display mode setting was not preserved");
  }
  if (layout.printFontSize !== "large" || layout.printLineSpacing !== "airy" || layout.printPadding !== "dense") {
    throw new Error(`Print appearance settings were not preserved: ${JSON.stringify(layout)}`);
  }
  if (!/3\.5-5\.1/.test(labReferenceText("K")) || labReferenceText("untrusted-custom-lab")) {
    throw new Error("Lab reference display should only show known trusted single-value references");
  }
  const trustedLabTokens = parseClinicalLabTokens("WBC 7.1, Hb 9.1, PLT 122, BUN 24, Cr 0.83, Na 130, K 4.0, ALT 11");
  const trustedLabLabels = new Set(trustedLabTokens.filter((token) => token.confidence === "high" && token.reference).map((token) => token.canonicalLabel));
  ["WBC", "Hb", "Plt", "BUN", "Cr", "Na", "K", "ALT"].forEach((label) => {
    if (!trustedLabLabels.has(label)) {
      throw new Error(`Trusted lab parser did not identify ${label}: ${JSON.stringify(trustedLabTokens)}`);
    }
  });
  const unknownLabTokens = parseClinicalLabTokens("XYZ 9.9, customLab 12");
  if (unknownLabTokens.some((token) => token.reference || token.confidence === "high")) {
    throw new Error(`Unknown labs should not get guessed references: ${JSON.stringify(unknownLabTokens)}`);
  }
  if (classifyClinicalLine("Lab: K 4.0", { fallbackKind: "lab" }).tone === "critical") {
    throw new Error("Normal potassium should not be elevated to critical by reference lookup");
  }
  if (classifyClinicalLine("Lab: K 6.1", { fallbackKind: "lab" }).tone !== "critical") {
    throw new Error("Critical potassium should remain critical");
  }
  if (isObjectiveSoapLineVisible("Image: CXR: improved opacity", layout)) {
    throw new Error("O Image remained visible after objectiveImages was disabled");
  }
  if (!isObjectiveSoapLineVisible("Lab: Cr 2.7", layout)) {
    throw new Error("O Lab was hidden unexpectedly");
  }
  if (isTaskSoapLineVisible("f/u CBC tomorrow", layout) || !isTaskSoapLineVisible("Order: VS q4h", layout) || !isTaskSoapLineVisible("Complete Levofloxacin PO x5 days", layout)) {
    throw new Error("Order/task layout filtering did not separate orders from tasks");
  }
  if (!isOrderSoapLine("Complete Levofloxacin PO x5 days") || !isOrderSoapLine("Abx: Teicoplanin 5/13-") || isOrderSoapLine("f/u CBC tomorrow")) {
    throw new Error("Order detection did not catch medication orders without promoting routine tasks");
  }
  const parsedOrdersSoap = parseSoapText("Orders:\n- Teicoplanin 5/13-\n藥囑:\n- VS q4h");
  if (parsedOrdersSoap.taskLines.length < 2 || !parsedOrdersSoap.taskLines.some((line) => /Teicoplanin/i.test(line)) || !parsedOrdersSoap.taskLines.some((line) => /VS q4h/i.test(line))) {
    throw new Error(`SOAP parser did not accept Orders/藥囑 section as task/order content: ${JSON.stringify(parsedOrdersSoap.taskLines)}`);
  }
  if (isDcSoapLineVisible("Barrier: oxygen requirement", layout) || !isDcSoapLineVisible("Pending: meds/OPD/certificate", layout)) {
    throw new Error("DC barrier/prep layout filtering was incorrect");
  }

  const briefOnlyPatient = {
    ...emptyPatient(),
    id: "brief-only",
    status: "active",
    isNewAdmission: false,
    showAdmissionBriefOnPrint: true,
  };
  if (isBoardNewAdmission(briefOnlyPatient)) {
    throw new Error("Board New Admits should not include patients only marked Brief included");
  }
  const actualNewAdmission = { ...briefOnlyPatient, isNewAdmission: true };
  if (!isBoardNewAdmission(actualNewAdmission)) {
    throw new Error("Board New Admits should include explicitly marked new admissions");
  }
  const defaultPrepPatient = {
    ...emptyPatient(),
    id: "default-dc-prep",
    status: "active",
    dischargeMedsStatus: "pending",
    opdAppointmentStatus: "pending",
    diagnosisCertificateStatus: "pending",
    dischargePlan: "Home after stable condition.",
  };
  if (hasBoardDischargeSoonSignal(defaultPrepPatient)) {
    throw new Error("Board DC Soon should not include routine pending prep without near-discharge signal");
  }
  const todayDischargePatient = { ...defaultPrepPatient, dischargeTargetDate: todayKey() };
  if (!hasBoardDischargeSoonSignal(todayDischargePatient)) {
    throw new Error("Board DC Soon should include patients with today/tomorrow discharge target");
  }
  const urgentDischargeTaskPatient = {
    ...defaultPrepPatient,
    tasks: [
      {
        id: "dc-task",
        text: "prepare discharge meds today",
        done: false,
        priority: "urgent",
        category: "discharge",
        dueDate: "",
        createdAt: nowIso(),
        completedAt: "",
      },
    ],
  };
  if (!hasBoardDischargeSoonSignal(urgentDischargeTaskPatient) || boardDischargeTasks(urgentDischargeTaskPatient).length !== 1) {
    throw new Error("Board DC Soon should include urgent near-term discharge tasks");
  }

  const stylePatient = { ...emptyPatient(), id: "style-patient" };
  const styleNote = {
    ...emptyDailyNote("2026-05-20"),
    soapStatus: "reviewed",
    soapText: [
      "7A-01 IM-A01 67/F",
      "S:",
      "- better",
      "O:",
      "- Lab: WBC 12, Cr 1.2",
      "A/P:",
      "# PNA improving",
      "- Abx, f/u Cx, wean O2.",
      "# AKI",
      "- Cr improving, f/u BMP.",
      "Tasks:",
      "- f/u Cx",
    ].join("\n"),
  };
  const profile = buildUserAiStyleProfile([stylePatient], { [stylePatient.id]: [styleNote] });
  if (profile.apVoice !== "terse" || profile.apOrganization !== "problemStatusPlan" || !profile.preferredTerms.includes("Abx") || !profile.preferredTerms.includes("f/u")) {
    throw new Error(`Style profile did not abstract reviewed SOAP writing style: ${JSON.stringify(profile)}`);
  }
  if (profile.typicalApProblemCount !== 2 || profile.typicalApLineLimit !== 1 || !profile.styleSummary.some((line) => /A\/P/i.test(line))) {
    throw new Error(`Style profile should keep density as a weak hint and summarize style: ${JSON.stringify(profile)}`);
  }
  const verboseStylePatient = { ...emptyPatient(), id: "style-patient-verbose" };
  const verboseStyleNote = {
    ...emptyDailyNote("2026-05-20"),
    soapStatus: "reviewed",
    soapText: [
      "7A-02 IM-A02 67/F",
      "S:",
      "- Patient reports gradual clinical improvement.",
      "O:",
      "- Lab: White blood cell count 12, creatinine 1.2",
      "A/P:",
      "# Pneumonia",
      "- Patient is clinically improving after antibiotic therapy; follow culture data and adjust treatment plan.",
      "# Acute kidney injury",
      "- Renal function is improving; repeat metabolic panel and maintain renal-dose medications.",
      "Tasks:",
      "- Follow culture results",
    ].join("\n"),
  };
  const verboseProfile = buildUserAiStyleProfile([verboseStylePatient], { [verboseStylePatient.id]: [verboseStyleNote] });
  if (
    verboseProfile.preferredTerms.includes("Abx") ||
    verboseProfile.preferredTerms.includes("f/u") ||
    verboseProfile.abbreviationStyle === profile.abbreviationStyle ||
    verboseProfile.apOrganization === profile.apOrganization
  ) {
    throw new Error(`Style profile should distinguish actual shorthand voice, not just A/P count/line count: ${JSON.stringify({ profile, verboseProfile })}`);
  }
  const emptyProfile = buildUserAiStyleProfile([], {});
  if (emptyProfile.abbreviationStyle !== "heavy") {
    throw new Error(`Default AI style profile should be abbreviation-forward without reviewed notes: ${JSON.stringify(emptyProfile)}`);
  }
  const compactAiDraft = sanitizeAiSoapDraftForReview(
    {
      oneLiner: "Pneumonia with oxygen requirement on nasal cannula.",
      admissionSummary: "Patient with pneumonia and respiratory failure; continue antibiotics and follow up blood culture.",
      isbarHandoff: "Recommendation: follow up blood culture and continue antibiotics.",
      subjective: {
        chiefConcern: "Shortness of breath without chest pain",
        symptoms: ["dyspnea without chest pain"],
        overnightEvents: [],
        importantSymptoms: ["dyspnea without chest pain"],
        importantOvernightEvents: [],
      },
      objective: {
        vitals: [
          {
            date: "2026-05-20",
            name: "oxygen saturation",
            value: "92% on nasal cannula",
            interpretation: "oxygen requirement",
            isAbnormal: true,
            isImportant: true,
          },
        ],
        bloodSugars: [],
        physicalExam: [],
        labs: [],
        images: [
          {
            date: "2026-05-20",
            studyType: "chest x-ray",
            finding: "right lower lobe pneumonia",
            impression: "right lower lobe pneumonia",
            isImportant: true,
          },
        ],
      },
      assessmentPlan: [
        {
          problemTitle: "Pneumonia with respiratory failure",
          assessmentSummary: "Concern for pneumonia with oxygen requirement",
          evidenceOrCourseItems: ["Chest x-ray shows pneumonia"],
          planItems: ["Continue antibiotics", "Follow up blood culture"],
          isImportant: true,
        },
      ],
      redFlags: [],
      tasks: [{ text: "Follow up blood culture and continue antibiotics", priority: "normal", category: "lab", dueDate: "" }],
      dischargeIssues: ["Arrange outpatient clinic follow-up and diagnosis certificate"],
      thinkingPrompts: [],
      uncertainty: [],
    },
    [
      "2026-05-20 chest x-ray right lower lobe pneumonia.",
      "oxygen saturation 92% on nasal cannula.",
      "continue antibiotics; follow up blood culture.",
      "Arrange outpatient clinic follow-up and diagnosis certificate.",
    ].join("\n"),
    "mixed",
  );
  const compactAiText = JSON.stringify(compactAiDraft);
  ["PNA", "O2 req", "NC", "CXR", "B/C", "f/u", "cont Abx", "OPD", "Cert"].forEach((term) => {
    if (!compactAiText.includes(term)) {
      throw new Error(`AI draft sanitizer did not preserve compressed term ${term}: ${compactAiText}`);
    }
  });
  if (/pneumonia|oxygen requirement|nasal cannula|chest x-ray|blood culture|follow up|continue antibiotics|outpatient clinic|diagnosis certificate/i.test(compactAiText)) {
    throw new Error(`AI draft sanitizer left verbose phrases instead of medical shorthand: ${compactAiText}`);
  }
  console.log("PASS Layout preferences lock print labels and build abstract AI style profile");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Layout preferences lock print labels and build abstract AI style profile", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Layout preferences lock print labels and build abstract AI style profile: ${failures[failures.length - 1].error}`);
}

try {
  const date = "2026-05-27";
  const patient = {
    ...emptyPatient(),
    id: "manual-display-regression",
    bed: "T-01",
    patientCode: "MANUAL",
    newLabs: "old patient-level labs",
    rawLabText: "old patient-level raw labs",
    labReports: [
      {
        id: "old-lab-report",
        date: "2026-05-26",
        title: "Old labs",
        rawText: "old patient-level raw labs",
        items: [{ id: "old-lab-item", label: "K", value: "3.0", group: "Lyte/Renal" }],
      },
    ],
    parsedLabItems: [{ id: "old-parsed-item", label: "K", value: "3.0", group: "Lyte/Renal" }],
    newImaging: "Old CXR: mild congestion",
    imageStudyEntries: [
      {
        id: "old-image",
        date: "2026-05-26",
        studyType: "CXR",
        finding: "mild congestion",
        impression: "old finding",
        isImportant: false,
        color: "Blue",
        note: "",
      },
    ],
    assessment: "old patient-level assessment",
    plan: "old patient-level plan",
    assessmentPlanItems: [
      {
        id: "old-ap",
        problemTitle: "Old AP",
        assessmentSummary: "old patient-level assessment",
        evidenceOrCourseItems: [],
        planItems: ["old patient-level plan"],
        category: "activeProblem",
        isImportant: false,
        color: "Blue",
        order: 0,
      },
    ],
  };
  const note = {
    ...emptyDailyNote(date),
    labSummary: "Manual today Lab: Cr 2.1 from 1.7, K 5.4",
    rawLabText: "Manual today raw lab line",
    labReports: [
      {
        id: "today-lab-report",
        date,
        title: "Manual daily labs",
        rawText: "Manual today raw lab line",
        items: [{ id: "today-lab-item", label: "Cr", value: "2.1", previousValue: "1.7", group: "Lyte/Renal" }],
      },
    ],
    parsedLabItems: [{ id: "today-parsed-item", label: "Cr", value: "2.1", previousValue: "1.7", group: "Lyte/Renal" }],
    imageSummary: "Manual CT A/P 5/27: biliary stent patent, no abscess",
    imageStudyEntries: [
      {
        id: "today-image",
        date,
        studyType: "CT A/P",
        finding: "biliary stent patent, no abscess",
        impression: "manual daily image",
        isImportant: true,
        color: "Orange",
        note: "",
      },
    ],
    assessment: "manual daily assessment",
    plan: "manual daily plan",
    assessmentPlanItems: [
      {
        id: "today-ap",
        problemTitle: "Manual AP",
        assessmentSummary: "manual daily assessment",
        evidenceOrCourseItems: ["Cr 2.1 from 1.7"],
        planItems: ["manual daily plan"],
        category: "activeProblem",
        isImportant: true,
        color: "Orange",
        order: 0,
      },
    ],
  };
  const summary = getPatientDisplaySummary(patient, { [patient.id]: [note] }, date);
  if (summary.latestLabs.reports[0]?.id !== "today-lab-report" || summary.latestLabs.items[0]?.id !== "today-lab-item") {
    throw new Error(`Daily-note lab arrays were hidden by older patient-level arrays: ${JSON.stringify(summary.latestLabs)}`);
  }
  if (!/Manual today raw lab line/i.test(summary.latestLabs.text)) {
    throw new Error(`Daily-note lab text was not displayed: ${summary.latestLabs.text}`);
  }
  if (summary.latestImages.entries[0]?.id !== "today-image" || !/Manual CT A\/P/i.test(summary.latestImages.text)) {
    throw new Error(`Daily-note image data was hidden by older patient-level image data: ${JSON.stringify(summary.latestImages)}`);
  }
  if (summary.assessmentPlanItems[0]?.id !== "today-ap" || summary.assessment !== "manual daily assessment" || summary.plan !== "manual daily plan") {
    throw new Error(`Daily-note A/P was hidden by older patient-level A/P: ${JSON.stringify({ ap: summary.assessmentPlanItems, assessment: summary.assessment, plan: summary.plan })}`);
  }
  const savedNote = {
    ...note,
    soapText: [
      "S:",
      "- manually reviewed interval",
      "O:",
      "- Lab: Cr 2.1 from 1.7",
      "A/P:",
      "# Manual AP",
      "- manual daily plan",
    ].join("\n"),
    updatedAt: "2026-05-27T08:00:00.000Z",
  };
  const staleNote = { ...emptyDailyNote(date), labSummary: "old stale lab", soapText: "S:\n- old stale SOAP", updatedAt: "2026-05-27T07:00:00.000Z" };
  if (dailyNoteMatchesSavedSnapshot(staleNote, savedNote)) {
    throw new Error("Stale Firestore daily-note snapshot was accepted as the just-saved manual note");
  }
  if (!dailyNoteMatchesSavedSnapshot({ ...staleNote, soapText: savedNote.soapText }, savedNote)) {
    throw new Error("Just-saved SOAP snapshot was not recognized after Firestore catch-up");
  }
  const savedFieldNote = { ...note, updatedAt: "2026-05-27T08:05:00.000Z" };
  if (dailyNoteMatchesSavedSnapshot({ ...staleNote, soapText: "" }, savedFieldNote)) {
    throw new Error("Stale structured daily-note snapshot was accepted before manual fields caught up");
  }
  if (!dailyNoteMatchesSavedSnapshot({ ...savedFieldNote, updatedAt: "2026-05-27T08:06:00.000Z" }, savedFieldNote)) {
    throw new Error("Manual structured fields were not recognized after Firestore catch-up");
  }
  console.log("PASS Manual daily-note fields render over older patient-level structured data");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Manual daily-note fields render over older patient-level structured data", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Manual daily-note fields render over older patient-level structured data: ${failures[failures.length - 1].error}`);
}

try {
  const sbarPatient = {
    ...emptyPatient(),
    id: "soap-sbar",
    bed: "S5-001",
    patientCode: "SYN-SBAR",
    age: 72,
    sex: "F",
    primaryDiagnosis: "PNA/sepsis w/ AKI",
    underlyingDiseases: "CKD3; AF on apixaban",
  };
  const reviewedSoap = [
    "S5-001 SYN-SBAR 72/F",
    "Dx: PNA/sepsis w/ AKI",
    "PMH: CKD3; AF on apixaban",
    "S:",
    "- dyspnea improved, still weak.",
    "O:",
    "- V/S: BP 104/62, HR 96, SpO2 95% NC2L",
    "- Lab: WBC 15.2, Cr 2.3, K 5.2",
    "- Image: CXR 6/1 RLL PNA improving.",
    "A/P:",
    "# PNA/sepsis, improving",
    "- Ceftriaxone 6/1-, f/u B/C final and O2 wean.",
    "# AKI on CKD",
    "- Cr 2.3, K 5.2; renal-dose meds, f/u UO/K.",
    "Tasks:",
    "- f/u B/C final",
    "- wean O2 as tolerated",
    "DC:",
    "- Pending: O2, Abx plan, renal trend.",
  ].join("\n");
  const sbar = formatSoapBasedIsbar(sbarPatient, [{ ...emptyDailyNote("2026-06-01"), soapText: reviewedSoap, soapStatus: "reviewed" }], "2026-06-01");
  if (!/^I: .*SYN-SBAR.*Dx: PNA\/sepsis/im.test(sbar) || !/^S: .*dyspnea improved/im.test(sbar) || !/Ceftriaxone 6\/1-|f\/u B\/C final|Cr 2\.3|O2/i.test(sbar)) {
    throw new Error(`SOAP-based SBAR did not preserve reviewed SOAP facts:\n${sbar}`);
  }
  const insufficient = formatSoapBasedIsbar(sbarPatient, [{ ...emptyDailyNote("2026-06-01"), soapText: reviewedSoap, soapStatus: "draft" }], "2026-06-01");
  if (!/^insufficient reviewed SOAP\/context/i.test(insufficient)) {
    throw new Error(`SOAP-based SBAR should refuse unreviewed SOAP:\n${insufficient}`);
  }
  console.log("PASS SOAP-based iSBAR uses reviewed SOAP and refuses unsupported fallback");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "SOAP-based iSBAR uses reviewed SOAP and refuses unsupported fallback", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL SOAP-based iSBAR uses reviewed SOAP and refuses unsupported fallback: ${failures[failures.length - 1].error}`);
}

try {
  const noisyOrders = [
    "2026/05/13 Teicoplanin 400 mg IV qd 5/13-",
    "Levofloxacin 500 mg PO qd x5 days",
    "Piperacillin/tazobactam stop after culture review",
    "Pantoprazole 40 mg IV qd",
    "Senna 2 tab HS",
    "Vitamin B complex 1# PO qd",
    "Heparin SC hold for tap",
    "Resume aspirin after bleeding review",
    "Methylprednisolone 40 mg IV q12h",
    "Lasix 20 mg IV stat",
    "Norepinephrine drip titrate",
    "O2 nasal cannula 3 L/min keep SpO2 > 92%",
    "Berodual neb q6h",
    "Insulin regular sliding scale AC/HS",
    "D50W 2 amp IV stat if hypoglycemia",
    "D5W 500 mL IV q12h",
    "KCl replacement 20 mEq IV",
    "Tube feeding 1500 kcal/day",
    "VS q4h",
    "I/O q8h",
    "Morphine 5 mg IV PRN dyspnea",
    "Acetaminophen 500 mg PO PRN fever",
    "Metoclopramide 10 mg IV PRN nausea",
    "Amlodipine 5 mg PO qd",
    "Atorvastatin 20 mg PO qn",
    "Lactulose 30 mL PO tid",
    "Calcium carbonate 1 tab PO tid",
    "Folic acid 1 tab PO qd",
    "Mosapride 5 mg PO tid",
    "Normal saline flush for line care",
  ].join("\n");
  const parsedOrders = parseMedicationOrders(noisyOrders);
  if (parsedOrders.length < 20) {
    throw new Error(`Order parser dropped too many lines: ${parsedOrders.length}`);
  }
  const summaries = summarizeMedicationOrders(parsedOrders, { maxLines: 6, mode: "summary" });
  if (summaries.length > 6) {
    throw new Error(`Order summary exceeded print-friendly limit: ${summaries.join("\n")}`);
  }
  if (!summaries.some((line) => /Abx:.*Teicoplanin.*Levofloxacin/i.test(line))) {
    throw new Error(`Order summary lost antibiotics/date/course signal:\n${summaries.join("\n")}`);
  }
  if (!summaries.some((line) => /Anticoag\/AP:.*heparin.*hold/i.test(line))) {
    throw new Error(`Order summary lost anticoag hold signal:\n${summaries.join("\n")}`);
  }
  if (!summaries.some((line) => /Steroid\/Immuno:.*Methylpred/i.test(line)) || !summaries.some((line) => /Insulin\/Glucose:.*Insulin/i.test(line))) {
    throw new Error(`Order summary lost steroid or insulin signal:\n${summaries.join("\n")}`);
  }
  if (summaries.some((line) => /Pantoprazole|Senna|Vitamin B/i.test(line))) {
    throw new Error(`Routine meds leaked into high-yield order summary:\n${summaries.join("\n")}`);
  }
  const routineHidden = parsedOrders.filter((order) => order.hiddenReason).map((order) => order.displayText).join("\n");
  if (!/Pantoprazole/i.test(routineHidden) || !/Senna/i.test(routineHidden) || !/Vitamin B/i.test(routineHidden)) {
    throw new Error(`Routine hidden list did not keep retrievable low-yield meds:\n${routineHidden}`);
  }
  const routineEnglishLabelPattern = /\bRoutine(?: hidden)?\s*:/i;
  const displayLines = formatMedicationOrderLinesForDisplay(
    ["Order: Teicoplanin 400 mg IV qd 5/13-", "Order: Pantoprazole 40 mg IV qd", "Order: Morphine 5 mg IV PRN dyspnea"],
    "summary",
    6,
  );
  if (
    !displayLines.some((line) => /Abx:.*Teicoplanin/i.test(line)) ||
    !displayLines.some((line) => /PRN:.*Morphine/i.test(line)) ||
    displayLines.some((line) => /Pantoprazole/i.test(line)) ||
    displayLines.some((line) => routineEnglishLabelPattern.test(line))
  ) {
    throw new Error(`Order display formatting did not hide routine meds while keeping high-yield PRN:\n${displayLines.join("\n")}`);
  }
  const routineOnlyDisplayLines = formatMedicationOrderLinesForDisplay(
    ["Order: Amlodipine 5 mg PO qd", "Order: Atorvastatin 20 mg PO qn"],
    "summary",
    6,
  );
  if (routineOnlyDisplayLines.length !== 0) {
    throw new Error(`All-routine order display should stay off Board/Print:\n${routineOnlyDisplayLines.join("\n")}`);
  }
  const mixedCategoryDisplayLines = formatMedicationOrderLinesForDisplay(
    ["Order: Teicoplanin 400 mg IV qd 5/13-", "Order: Pantoprazole 40 mg IV qd"],
    "category",
    6,
  );
  if (
    mixedCategoryDisplayLines.some((line) => routineEnglishLabelPattern.test(line)) ||
    mixedCategoryDisplayLines.some((line) => /Pantoprazole/i.test(line)) ||
    mixedCategoryDisplayLines.some((line) => /常規|routine|hidden/i.test(line))
  ) {
    throw new Error(`Category order display should hide routine meds without placeholder labels:\n${mixedCategoryDisplayLines.join("\n")}`);
  }
  const collapsedRoutineLines = formatMedicationOrderLinesForDisplay(
    ["Order: Amlodipine 5 mg PO qd", "Order: Atorvastatin 20 mg PO qn"],
    "collapsed",
    6,
  );
  if (collapsedRoutineLines.length !== 0) {
    throw new Error(`Collapsed order display should remain intentionally hidden:\n${collapsedRoutineLines.join("\n")}`);
  }
  console.log("PASS Medication order cleaner summarizes noisy HIS orders without saving raw text");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Medication order cleaner summarizes noisy HIS orders without saving raw text", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Medication order cleaner summarizes noisy HIS orders without saving raw text: ${failures[failures.length - 1].error}`);
}

try {
  const cxrFixBaseline = [
    "S:",
    "- stable overnight",
    "O:",
    "- V/S: BP 120/70, HR 80",
    "- Lab: Na 128",
    "- Image: CXR 5/18 RLL opacity",
    "A/P:",
    "# PNA",
    "- Ceftriaxone 5/17-, f/u B/C",
    "# Hyponatremia",
    "- Na 128, fluid restriction",
  ].join("\n");
  const cxrFixCandidate = [
    "S:",
    "- stable overnight",
    "O:",
    "- V/S: BP 120/70, HR 80",
    "- Lab: Na 134",
    "- Image: CXR 5/20 RLL opacity improving",
    "A/P:",
    "# PNA",
    "- Ceftriaxone 5/17-, f/u B/C",
    "# Hyponatremia",
    "- Na 134 improving, cont fluid restriction",
  ].join("\n");
  const cxrFixGuarded = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: cxrFixBaseline,
    candidateText: cxrFixCandidate,
    sourceFields: { labs: "Na 134 (was 128)", images: "CXR 5/20 RLL opacity improving" },
  });
  if (!/CXR 5\/20 RLL opacity improving/i.test(cxrFixGuarded.acceptedText)) {
    throw new Error(`New CXR report was not applied:\n${cxrFixGuarded.acceptedText}`);
  }
  if (/CXR 5\/18/i.test(cxrFixGuarded.acceptedText)) {
    throw new Error(`Stale CXR line should be replaced by the new same-study report:\n${cxrFixGuarded.acceptedText}`);
  }
  if (!/Na 134 improving/i.test(cxrFixGuarded.acceptedText)) {
    throw new Error(`Updated A/P status line was not applied:\n${cxrFixGuarded.acceptedText}`);
  }
  if (/Na 128, fluid restriction/i.test(cxrFixGuarded.acceptedText)) {
    throw new Error(`Stale plain A/P line should be replaced by the pasted update:\n${cxrFixGuarded.acceptedText}`);
  }
  if (!/Ceftriaxone 5\/17-/i.test(cxrFixGuarded.acceptedText)) {
    throw new Error(`Protected antibiotic A/P line must be preserved:\n${cxrFixGuarded.acceptedText}`);
  }
  const sodiumGuarded = guardRoundSoapDelta({
    workflowMode: "dailyUpdate",
    baselineText: [
      "S:",
      "- no new dyspnea",
      "O:",
      "- V/S: BP 118/70, HR 88",
      "- Lab: Na 140, Cr 0.9",
      "A/P:",
      "# PNA",
      "- Ceftriaxone 6/1-, f/u B/C.",
    ].join("\n"),
    candidateText: [
      "S:",
      "- no new dyspnea",
      "O:",
      "- V/S: BP 118/70, HR 88",
      "- Lab: Na 156, Cr 0.9",
      "A/P:",
      "# PNA",
      "- Ceftriaxone 6/1-, f/u B/C.",
      "# Hypernatremia",
      "- Na 156; f/u trend, volume/free water plan.",
    ].join("\n"),
    sourceFields: { labs: "Na 156 from 140, Cr 0.9" },
  });
  if (!/# Hypernatremia[\s\S]*Na 156/i.test(sodiumGuarded.acceptedText)) {
    throw new Error(`Daily lab update did not allow objective-supported sodium A/P:\n${sodiumGuarded.acceptedText}`);
  }
  if (!/Ceftriaxone 6\/1-/i.test(sodiumGuarded.acceptedText) || !/S:\n- no new dyspnea/i.test(sodiumGuarded.acceptedText)) {
    throw new Error(`Daily lab update should preserve unrelated reviewed SOAP:\n${sodiumGuarded.acceptedText}`);
  }

  const colorMarkSoap = [
    "S:",
    "- [[red:chest pain]] worse at night",
    "O:",
    "- V/S: BP 120/70",
    "A/P:",
    "# Sepsis",
    "- [[orange:f/u B/C clearance]]",
  ].join("\n");
  const colorMarkRoundTrip = editorDraftToSoapText(parseSoapTextToEditorDraft(colorMarkSoap));
  if (!/\[\[red:chest pain\]\]/i.test(colorMarkRoundTrip) || !/\[\[orange:f\/u B\/C clearance\]\]/i.test(colorMarkRoundTrip)) {
    throw new Error(`Clinician color marks must survive the SOAP editor round-trip:\n${colorMarkRoundTrip}`);
  }
  if (/\[\[orange[^:]/i.test(colorMarkRoundTrip)) {
    throw new Error(`Color markup was corrupted during round-trip:\n${colorMarkRoundTrip}`);
  }

  const bangLeakSoap = [
    "S:",
    "- !! new chest pain",
    "O:",
    "- !! V/S: BP 80/40",
    "- ! Image: CXR 5/20 RLL opacity",
    "A/P:",
    "# ! Sepsis",
    "- !! on norepi",
    "DC:",
    "- ! not ready",
  ].join("\n");
  const bangLeakPatch = soapTextToPatientPatch(bangLeakSoap, emptyPatient("bang-leak"), todayKey());
  const bangLeakFields = [
    bangLeakPatch.patient.subjectiveOrChiefConcern,
    bangLeakPatch.patient.vitalSigns,
    bangLeakPatch.patient.newImaging,
    bangLeakPatch.patient.assessment,
    bangLeakPatch.patient.plan,
    bangLeakPatch.patient.dischargePlan,
  ].join("\n");
  if (/^\s*!|\n\s*!|- !/.test(bangLeakFields)) {
    throw new Error(`Tone bangs leaked into plain patient fields:\n${bangLeakFields}`);
  }
  if (!/soapText/.test(JSON.stringify(Object.keys(bangLeakPatch.dailyNotePatch))) || !/!!/.test(bangLeakPatch.dailyNotePatch.soapText)) {
    throw new Error("Tone markers must stay encoded inside the saved soapText.");
  }
  const markedLabSummary = formatLabVisualSummaryLinesFromText(
    "Lab: WBC 4.0, BUN/Cr 41/5.55, [[orange:K 2.9]], Na 128",
    { maxGroups: 6, maxItemsPerGroup: 8, maxCharsPerGroup: 160 },
  ).join("\n");
  if (!/\[\[orange:K 2\.9\]\]/.test(markedLabSummary)) {
    throw new Error(`Lab visual summary dropped the clinician color mark:\n${markedLabSummary}`);
  }
  if (/K 2\.9(?!\]\])/.test(markedLabSummary.replace(/\[\[orange:K 2\.9\]\]/g, ""))) {
    throw new Error(`Lab visual summary duplicated the marked lab value:\n${markedLabSummary}`);
  }
  console.log("PASS Pasted CXR/A&P updates replace stale lines, color marks persist, and bangs stay out of plain fields");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "CXR/A&P replace + color mark + bang regression", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL CXR/A&P replace + color mark + bang regression: ${failures[failures.length - 1].error}`);
}

try {
  const { concretizeVagueFollowUps } = await server.ssrLoadModule("/src/aiPostprocess/planConcretizer.ts");
  const vagueDraft = sanitizeAiSoapDraftForReview(
    {
      oneLiner: "AKI on CKD under workup",
      admissionSummary: "",
      isbarHandoff: "",
      clinicalReasoning: {
        currentClinicalState: "",
        primaryRisk: "",
        whyThisMatters: [],
        activeProblemsRanked: [],
        resolvedOrLessImportant: [],
        missingDataNeeded: [],
        noiseToIgnore: [],
      },
      subjective: { chiefConcern: "", symptoms: [], overnightEvents: [], importantSymptoms: [], importantOvernightEvents: [] },
      objective: { vitals: [], bloodSugars: [], physicalExam: [], labs: [], images: [] },
      assessmentPlan: [
        {
          problemTitle: "AKI on CKD",
          assessmentSummary: "Cr 2.1 from 1.4, oliguric",
          evidenceOrCourseItems: ["Cr 2.1 from 1.4"],
          planItems: ["review renal function", "hold ACEi", "IV hydration", "correct electrolyte imbalance"],
          isImportant: true,
        },
      ],
      redFlags: [],
      tasks: [
        { text: "check liver function tests", category: "lab", dueDate: "" },
        { text: "monitor electrolytes daily", category: "lab", dueDate: "" },
        { text: "f/u B/C result", category: "lab", dueDate: "" },
      ],
      dischargeIssues: [],
      thinkingPrompts: [],
      uncertainty: [],
    },
    "AKI Cr 2.1 from 1.4, oliguric, on lisinopril. LFT pending. Blood culture pending.",
    "mixed",
  );
  const planText = vagueDraft.assessmentPlan.map((item) => item.planItems.join("\n")).join("\n");
  const taskText = vagueDraft.tasks.map((task) => task.text).join("\n");
  if (!/f\/u BUN\/Cr, K/.test(planText)) {
    throw new Error(`vague 'review renal function' was not concretized to f/u BUN/Cr, K:\n${planText}`);
  }
  if (!/f\/u Na\/K\/Ca\/Mg\/P daily/.test(taskText)) {
    throw new Error(`vague 'monitor electrolytes' was not concretized:\n${taskText}`);
  }
  if (!/hold ACEi/.test(planText)) {
    throw new Error(`already-concrete plan item was altered:\n${planText}`);
  }
  if (!/IVF — clarify type\/rate; recheck BP, UO/.test(planText)) {
    throw new Error(`vague 'IV hydration' was not concretized to an executable IVF line:\n${planText}`);
  }
  if (!/replete K\/Mg\/Ca as indicated; recheck lytes after repletion/.test(planText)) {
    throw new Error(`vague 'correct electrolyte imbalance' was not concretized:\n${planText}`);
  }
  const tlsUntouched = concretizeVagueFollowUps("verify hydration/urate-lowering plan");
  if (tlsUntouched !== "verify hydration/urate-lowering plan") {
    throw new Error(`legit hydration mention was wrongly rewritten: ${tlsUntouched}`);
  }
  const bareHydration = concretizeVagueFollowUps("- hydration");
  if (!/IVF — clarify type\/rate/.test(bareHydration)) {
    throw new Error(`bare 'hydration' plan line was not concretized: ${bareHydration}`);
  }
  if (!/f\/u AST\/ALT\/T-bil, INR/.test(taskText) || !/f\/u B\/C result/.test(taskText)) {
    throw new Error(`vague liver task was not concretized or concrete task was altered:\n${taskText}`);
  }
  const untouched = concretizeVagueFollowUps("renal function improving, Cr 1.2 from 2.1");
  if (untouched !== "renal function improving, Cr 1.2 from 2.1") {
    throw new Error(`descriptive assessment text was wrongly rewritten: ${untouched}`);
  }
  console.log("PASS Vague follow-up phrases become concrete lab follow-ups (f/u BUN/Cr instead of review renal function)");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Vague follow-up concretizer", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Vague follow-up concretizer: ${failures[failures.length - 1].error}`);
}

try {
  const { dedupeDiseaseItems, dedupeDiseaseText } = await server.ssrLoadModule("/src/aiPostprocess/diseaseDedupe.ts");
  const deduped = dedupeDiseaseItems([
    "diabetes mellitus",
    "hypertension",
    "hyperlipidemia",
    "left-sided hearing loss status post intratympanic steroid injection (2016/07/15)",
    "hypertensive cardiovascular disease",
    "HTN",
    "DM",
    "HLD",
  ]);
  const joined = deduped.join(" | ");
  if (deduped.length !== 5) {
    throw new Error(`PMH synonym dedupe kept ${deduped.length} items instead of 5:\n${joined}`);
  }
  if (!/^DM \| HTN \| HLD \|/.test(joined)) {
    throw new Error(`PMH dedupe should keep the shorter abbreviation forms:\n${joined}`);
  }
  if (!/hearing loss status post/.test(joined) || !/hypertensive cardiovascular disease/i.test(joined)) {
    throw new Error(`PMH dedupe dropped a distinct disease:\n${joined}`);
  }
  const strokeSafe = dedupeDiseaseItems([
    "acute cerebral infarction involving the left M2 territory status post intravenous thrombolysis with tPA in 2020",
    "old CVA",
  ]);
  if (strokeSafe.length !== 2) {
    throw new Error(`detailed stroke history must not collapse into bare CVA:\n${strokeSafe.join(" | ")}`);
  }
  const textForm = dedupeDiseaseText("diabetes mellitus, hypertension, hyperlipidemia, HTN, DM, and HLD");
  if (textForm !== "DM, HTN, HLD") {
    throw new Error(`PMH text dedupe produced: ${textForm}`);
  }
  console.log("PASS PMH synonym dedupe collapses full-name/abbreviation duplicates without losing distinct diseases");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "PMH synonym dedupe", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL PMH synonym dedupe: ${failures[failures.length - 1].error}`);
}

try {
  const { dropRestatedLabBullets, leanSoapCleanup, stripDeferralTails } = await server.ssrLoadModule("/src/aiPostprocess/soapLeanCleanup.ts");

  // Pinned from the user's 2026-07 manual correction (ESRD/UTI note).
  const soap = [
    "S:",
    "- Fever persists",
    "O:",
    "- !! Lab: Hb 7.6 -> 7.3 g/dL, Cr 7.08",
    "A/P:",
    "# Anemia, r/o occult GI bleed",
    "- !! Hb 7.3; f/u trend/bleeding signs and transfusion threshold.",
    "- !! Hb 7.6 -> 7.3 g/dL, stool brown/FOBT neg; GI offered EGD but pt/family refused.",
    "# ESRD on HD",
    "- !! Cr 7.08; f/u UO/renal trend, adjust nephrotoxins.",
    "- !! Cr 7.08, residual UO 100-200 mL/day; on M/W/F HD via L Hickman, s/p recent AVF PTA.",
    "# DM2 + severe CAD s/p PCI",
    "- ! Cont vildagliptin + aspirin/clopidogrel/statin/bisoprolol as ordered; f/u AC/PC glucose.",
    "Tasks:",
    "- transfuse PRBC only if symptomatic or Hb trend worsens per team decision.",
    "DC:",
    "- ! Meds □ / OPD □ / Cert □",
    "- ! Pending Meds/OPD/Cert",
  ].join("\n");
  const cleaned = leanSoapCleanup(soap);

  if (/Hb 7\.3; f\/u trend\/bleeding signs/.test(cleaned)) {
    throw new Error(`vague Hb restatement bullet was not dropped:\n${cleaned}`);
  }
  if (!/Hb 7\.6 -> 7\.3 g\/dL, stool brown\/FOBT neg/.test(cleaned)) {
    throw new Error(`concrete Hb bullet was lost:\n${cleaned}`);
  }
  if (/Cr 7\.08; f\/u UO\/renal trend/.test(cleaned)) {
    throw new Error(`vague Cr restatement bullet was not dropped:\n${cleaned}`);
  }
  if (!/Cr 7\.08, residual UO 100-200 mL\/day/.test(cleaned)) {
    throw new Error(`concrete Cr bullet was lost:\n${cleaned}`);
  }
  if (/as ordered|per team decision/.test(cleaned)) {
    throw new Error(`decision-deferral filler tails were not stripped:\n${cleaned}`);
  }
  if (!/bisoprolol; f\/u AC\/PC glucose\./.test(cleaned)) {
    throw new Error(`stripDeferralTails damaged surrounding text:\n${cleaned}`);
  }
  if ((cleaned.match(/Meds.*OPD.*Cert/gi) ?? []).length !== 1) {
    throw new Error(`duplicated DC pending lines were not collapsed to one:\n${cleaned}`);
  }
  // The O-section lab line must never be touched by the A/P-scoped dedupe.
  if (!/Lab: Hb 7\.6 -> 7\.3 g\/dL, Cr 7\.08/.test(cleaned)) {
    throw new Error(`O-section lab line was altered:\n${cleaned}`);
  }

  // Bullets with concrete remainders (doses, dates, actions) must be kept even
  // when another bullet shares the same lab value.
  const concreteKept = dropRestatedLabBullets([
    "A/P:",
    "# Anemia",
    "- !! Hb 7.3; transfuse 2U PRBC if symptomatic",
    "- !! Hb 7.6 -> 7.3, stool neg",
  ].join("\n"));
  if (!/transfuse 2U PRBC/.test(concreteKept)) {
    throw new Error(`concrete transfusion bullet was wrongly dropped:\n${concreteKept}`);
  }
  const repletionKept = dropRestatedLabBullets([
    "A/P:",
    "# Hypokalemia",
    "- ! K 3.1; replete KCl 40 mEq PO",
    "- ! K 3.1 on today's draw",
  ].join("\n"));
  if (!/replete KCl 40 mEq PO/.test(repletionKept)) {
    throw new Error(`repletion bullet was wrongly dropped:\n${repletionKept}`);
  }
  if (stripDeferralTails("- cont HD + furosemide") !== "- cont HD + furosemide") {
    throw new Error("stripDeferralTails altered a line without filler");
  }
  console.log("PASS Lean SOAP cleanup drops restated-lab bullets, strips 'as ordered/per team decision' tails, collapses DC dupes");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Lean SOAP cleanup", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Lean SOAP cleanup: ${failures[failures.length - 1].error}`);
}

try {
  const { looksLikeStructuredAdmissionBrief } = await server.ssrLoadModule("/src/clinicalTextFormat.ts");
  const structuredBrief = [
    "73F",
    "PHx: dementia, HTN, recent H. pylori infx s/p EGD",
    "CC: painful dermatomal rash x recent days",
    "PI:",
    "RUQ pain radiating ant abd → back x ~2 wks, appetite fair, bowel habit N.",
    "Denied fever/dizziness/HA/neck pain/dyspnea.",
    "ED PE:",
    "Erythematous painful rash below bil breasts, involving bil T5 dermatome, plus lesions over Lt axilla + RLE.",
    "Lab 07-01:",
    "WBC 6.3k, Neu 66.4%, Hb 13.9, PLT 197k",
    "→ no leukocytosis, no sig. inflammatory marker elevation",
    "Imp:",
    "Suspect multidermatomal/disseminated HZ / VZV infx",
  ].join("\n");
  if (!looksLikeStructuredAdmissionBrief(structuredBrief)) {
    throw new Error("structured brief detector did not recognize the reference format");
  }
  const emptyDraftShell = {
    oneLiner: "",
    admissionSummary: structuredBrief,
    isbarHandoff: "",
    clinicalReasoning: {
      currentClinicalState: "Suspected disseminated VZV on acyclovir.",
      primaryRisk: "Disseminated VZV infection-control and progression risk",
      whyThisMatters: [{ fact: "multidermatomal rash", source: "PI", implication: "dissemination risk" }],
      activeProblemsRanked: [
        {
          problem: "Suspected disseminated zoster/varicella",
          status: "under treatment",
          whyImportant: "Dissemination changes isolation and antiviral plan.",
          evidence: ["bil T5 dermatome + Lt axilla + RLE rash"],
          todayPlan: ["cont acyclovir 250 mg q8h (7/2-)"],
          callThresholds: ["new fever or rapid rash progression"],
        },
      ],
      resolvedOrLessImportant: [],
      missingDataNeeded: [],
      noiseToIgnore: [],
    },
    subjective: { chiefConcern: "", symptoms: [], overnightEvents: [], importantSymptoms: [], importantOvernightEvents: [] },
    objective: { vitals: [], bloodSugars: [], physicalExam: [], labs: [], images: [] },
    assessmentPlan: [],
    redFlags: [],
    tasks: [],
    dischargeIssues: [],
    thinkingPrompts: [],
    uncertainty: [],
  };
  const sanitizedBriefDraft = sanitizeAiSoapDraftForReview(emptyDraftShell, "de-identified rash admission text", "mixed");
  if (!/\nPHx:/.test(sanitizedBriefDraft.admissionSummary) || !/\nImp:/.test(sanitizedBriefDraft.admissionSummary)) {
    throw new Error(`sanitizer flattened the structured brief:\n${sanitizedBriefDraft.admissionSummary}`);
  }
  if (sanitizedBriefDraft.admissionSummary.split("\n").length < 10) {
    throw new Error(`sanitizer dropped structured brief lines:\n${sanitizedBriefDraft.admissionSummary}`);
  }
  const appliedBriefDraft = applyClinicalKnowledgeToAiSoapDraft(emptyDraftShell, "");
  if (!appliedBriefDraft.admissionSummary.startsWith("73F")) {
    throw new Error(`reasoning rebuild replaced the structured brief:\n${appliedBriefDraft.admissionSummary}`);
  }
  if (/目前重點|關鍵O|今日待/.test(appliedBriefDraft.admissionSummary)) {
    throw new Error(`structured brief was contaminated with reasoning-template labels:\n${appliedBriefDraft.admissionSummary}`);
  }
  console.log("PASS Structured admission brief (PHx/CC/PI/Lab/Imp) survives sanitizer and reasoning override");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Structured admission brief preservation", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Structured admission brief preservation: ${failures[failures.length - 1].error}`);
}

try {
  const narrativePlan = applyClinicalKnowledgeToText(
    [
      "The 90-y-o female w/ PHx of T2DM w/ prior DKA, UTI, volume depletion, paroxysmal AF, and dementia was admitted via emergency department because of left thigh redness and swelling.",
      "Left thigh redness and swelling had been noted for several days w/o trauma, obvious wound, or local tenderness.",
      "Fever up to 38.8\u00b0C for 1 day. Vomiting since tonight. Hypotension to 84/45 was noted.",
      "Diarrhea x2 after ED arrival. No oliguria. Abd soft, no guarding.",
      "ED work-up showed WBC 9.6 k/\u00b5L w/ Neu 93.5%, BUN/Cr 33/0.63, glucose 169 mg/dL, serum ketone 0.5, VBG pH 7.42 then 7.38, lactate 26.9 then 20.6 mg/dL.",
      "UA: WBC 26/HPF, RBC 18/HPF, LE +/-, nitrite negative. Stool WBC/RBC/OB all negative.",
      "CXR showed mild increased right infiltrate, similar to exam performed in 2026/03. KUB showed moderate fecal components.",
      "Bedside echo showed IVC ~0.5 cm w/ >50% variation, so LR hydration was given, and IV Curam plus clindamycin was started.",
      "Under the impression of Lt cellulitis, she was admitted for further evaluation and treatment.",
    ].join("\n"),
  );
  const narrativeBrief = formatRuleBasedAdmissionSummary(narrativePlan, { length: "threeMinute" });
  const plainNarrativeBrief = narrativeBrief.replace(/\*\*/g, "");
  const phxLine = plainNarrativeBrief.split("\n").find((line) => line.startsWith("PHx:")) ?? "";
  if (phxLine && /\b(?:was|is)\s+admitted\b|admitted via/i.test(phxLine)) {
    throw new Error(`PHx line kept the admission-sentence narrative: ${phxLine}`);
  }
  assertDocumentIncludes(narrativeBrief, /^90F$/m, "C15-style admission brief should start with age/sex");
  assertDocumentIncludes(narrativeBrief, /PHx:\s*T2DM c prior DKA, prior UTI, volume depletion, pAF, dementia/i, "C15-style admission brief should preserve concise PHx");
  assertDocumentIncludes(narrativeBrief, /CC:\s*fever up to 38\.8.C x 1 d/i, "C15-style admission brief should keep fever as CC");
  assertDocumentIncludes(narrativeBrief, /ED Lab:[\s\S]*Serum ketone 0\.5, VBG pH 7\.42[\s\S]*7\.38[\s\S]*no DKA/i, "C15-style admission brief should preserve ketone/VBG/no-DKA line");
  assertDocumentIncludes(narrativeBrief, /Image:[\s\S]*CXR:[\s\S]*KUB:/i, "C15-style admission brief should split image findings");
  assertDocumentIncludes(narrativeBrief, /ED Course:[\s\S]*IVC ~0\.5 cm[\s\S]*Started IV Curam \+ clindamycin/i, "C15-style admission brief should preserve ED course and treatment");
  assertDocumentIncludes(narrativeBrief, /Imp:[\s\S]*1\. Fever\/sepsis, likely Lt (?:thigh )?cellulitis[\s\S]*\d\. T2DM, no DKA this time/i, "C15-style admission brief should use numbered source-grounded Imp");
  if (/\*\*/.test(narrativeBrief) || /Key O:|Plan:|DKA\/HHS|AKI\/electrolyte|PNA\/O2|source\/Cx\/Abx|transition readiness|Abx response\/weaning/i.test(plainNarrativeBrief)) {
    throw new Error(`C15-style admission brief leaked old labels or canned rule titles:\n${narrativeBrief}`);
  }
  const admittedMentions = (narrativeBrief.match(/admitted via/gi) ?? []).length;
  if (admittedMentions > 1) {
    throw new Error(`the admission sentence is duplicated across sections:\n${narrativeBrief}`);
  }
  const planSection = narrativeBrief.split(/\nPlan:\n?/)[1] ?? "";
  if (/\b(?:KUB|CXR|echo)\s+showed\b/i.test(planSection)) {
    throw new Error(`Plan section contains objective findings instead of actions:\n${planSection}`);
  }
  const fragmentKeys = narrativeBrief
    .split(/\n|;\s*/)
    .map((item) => item.replace(/\*\*/g, "").replace(/^(?:PHx|CC|PI|ED Lab|Image|ED Course|Imp|Plan):?\s*/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60))
    .filter((item) => item.length > 12);
  const duplicated = fragmentKeys.find((key, index) => fragmentKeys.indexOf(key) !== index);
  if (duplicated) {
    throw new Error(`a fragment appears in more than one section (${duplicated}):\n${narrativeBrief}`);
  }
  console.log("PASS Narrative admission note produces a clean structured brief without cross-section duplication");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Narrative admission brief classification", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Narrative admission brief classification: ${failures[failures.length - 1].error}`);
}

try {
  const dvtPlan = applyClinicalKnowledgeToText(
    [
      "The 68-y-o male w/ PHx of lung cancer s/p chemotherapy and HTN was admitted via emergency department because of left leg swelling.",
      "Left leg swelling and pain had been noted for 2 weeks, no redness, no fever.",
      "ED work-up showed WBC 7.2 k/\u00b5L, D-dimer 4.8, Cr 1.1.",
      "Venous doppler showed left femoral vein thrombosis.",
      "Under the impression of left leg DVT, he was admitted for anticoagulation.",
    ].join("\n"),
  );
  const dvtBrief = formatRuleBasedAdmissionSummary(dvtPlan, { length: "threeMinute" });
  if (/cellulitis/i.test(dvtBrief)) {
    throw new Error(`a non-cellulitis patient was stamped with cellulitis:\n${dvtBrief}`);
  }
  if (/curam|clindamycin|LR hydration|D x2|no DKA/i.test(dvtBrief)) {
    throw new Error(`C15-case content leaked into a different patient's brief:\n${dvtBrief}`);
  }
  assertDocumentIncludes(dvtBrief, /^68M$/m, "different-patient brief should start with its own age/sex");
  assertDocumentIncludes(dvtBrief, /PHx:\s*lung cancer s\/p chemotherapy, HTN/i, "different-patient brief should extract its own PHx");
  assertDocumentIncludes(dvtBrief, /CC:\s*left leg swelling/i, "different-patient brief should extract its own CC");
  assertDocumentIncludes(dvtBrief, /favor left leg DVT/i, "source-named DVT judgment should be preserved");
  assertDocumentIncludes(dvtBrief, /Imp:[\s\S]*1\. left leg DVT/i, "Imp should lead with the source impression");
  console.log("PASS Different-patient admission brief stays source-grounded (no C15 overfitting)");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Different-patient admission brief", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Different-patient admission brief: ${failures[failures.length - 1].error}`);
}

try {
  // --- Headline priority: red flag beats everything ---
  const redFlagPatient = {
    ...emptyPatient(),
    bed: "A1",
    primaryDiagnosis: "Sepsis",
    importantRedFlags: "Septic shock, lactate 4.2, call if SBP <90",
    tasks: [{ ...emptyTask(), text: "f/u B/C", priority: "normal" }],
  };
  const redHeadline = getPatientHeadline(redFlagPatient, [], { mode: "board" });
  if (!redHeadline || redHeadline.tone !== "critical" || !/shock|lactate|SBP/i.test(redHeadline.text)) {
    throw new Error(`red-flag headline wrong: ${JSON.stringify(redHeadline)}`);
  }

  // --- Headline: urgent task when no red flag ---
  const urgentTaskPatient = {
    ...emptyPatient(),
    bed: "A2",
    primaryDiagnosis: "PNA",
    tasks: [
      { ...emptyTask(), text: "cont ceftriaxone", priority: "normal" },
      { ...emptyTask(), text: "! call family re: code status", priority: "urgent" },
    ],
  };
  const taskHeadline = getPatientHeadline(urgentTaskPatient, [], { mode: "board" });
  if (!taskHeadline || taskHeadline.tone !== "critical" || !/code status/i.test(taskHeadline.text) || /^!/.test(taskHeadline.text)) {
    throw new Error(`urgent-task headline wrong: ${JSON.stringify(taskHeadline)}`);
  }

  // --- Headline: discharge due today ---
  const dischargePatient = {
    ...emptyPatient(),
    bed: "A3",
    primaryDiagnosis: "CAP resolving",
    dischargeTargetDate: todayKey(),
    tasks: [{ ...emptyTask(), text: "arrange OPD", priority: "normal" }],
  };
  const dcHeadline = getPatientHeadline(dischargePatient, [], { mode: "board" });
  if (!dcHeadline || dcHeadline.tone !== "discharge" || !/DC today/i.test(dcHeadline.text)) {
    throw new Error(`discharge headline wrong: ${JSON.stringify(dcHeadline)}`);
  }

  // --- Carried-forward detection: unchanged line dims, changed value stays ---
  const priorSoap = [
    "Dx: AKI on CKD",
    "O:",
    "Lab: Cr 1.4, K 4.2",
    "A/P:",
    "# HTN, stable",
    "- cont Exforge 1 tab QD",
  ].join("\n");
  const carried = buildCarriedForwardKeys(
    [{ ...emptyDailyNote("2026-07-01"), soapText: priorSoap }],
    "2026-07-02",
  );
  if (carried.size === 0) {
    throw new Error("carried-forward key set was empty for a valid prior note");
  }
  if (!isCarriedForwardLine("- cont Exforge 1 tab QD", carried)) {
    throw new Error("unchanged chronic line was not detected as carried forward");
  }
  if (!isCarriedForwardLine("# HTN, stable", carried)) {
    throw new Error("unchanged problem title was not detected as carried forward");
  }
  if (isCarriedForwardLine("Lab: Cr 2.1, K 5.3", carried)) {
    throw new Error("a CHANGED lab value was wrongly marked carried forward (would be dimmed)");
  }
  if (isCarriedForwardLine("- new task: start insulin", carried)) {
    throw new Error("a brand-new line was wrongly marked carried forward");
  }
  // A bang added today must not defeat the content match (same content = still carried).
  if (!isCarriedForwardLine("! cont Exforge 1 tab QD", carried)) {
    throw new Error("leading bang broke the carried-forward content match");
  }
  // No prior note -> nothing dimmed.
  const emptyCarried = buildCarriedForwardKeys([], "2026-07-02");
  if (emptyCarried.size !== 0 || isCarriedForwardLine("anything", emptyCarried)) {
    throw new Error("first-note case should dim nothing");
  }
  console.log("PASS Rounding headline priority and carried-forward change detection");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Headline + carried-forward delta", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Headline + carried-forward delta: ${failures[failures.length - 1].error}`);
}

try {
  const detectCases = [
    ["WBC 9.6\nHb 13.9\nPlt 197\nBUN/Cr 33/0.63", "lab"],
    ["CXR: mild increased right infiltrate\nCT abdomen: no abscess", "image"],
    ["BP 118/69, P 91, RR 18, SpO2 96%, T 36.6", "vitals"],
    ["Chief complaint: fever x 1 day. Admitted via ED because of cellulitis.", "admission"],
    ["Patient improving, family updated, plan to continue abx", "mixed"],
    ["", "mixed"],
  ];
  for (const [text, want] of detectCases) {
    const got = detectSourceType(text);
    if (got !== want) throw new Error(`source-type detect: want ${want} got ${got} for: ${text.split("\n")[0]}`);
  }
  console.log("PASS AI intake source-type auto-detection classifies lab/image/vitals/admission/mixed");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Source-type auto-detect", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Source-type auto-detect: ${failures[failures.length - 1].error}`);
}

try {
  const slashItems = parseLabText("BUN/Cr 33/0.63, Na/K 137/3.8, AST/ALT 20/18");
  const find = (name) => slashItems.find((item) => item.label === name);
  if (find("Cr")?.value !== "0.63") {
    throw new Error(`Cr must be 0.63 from BUN/Cr 33/0.63, got ${find("Cr")?.value} (Cr 33 is the dangerous misread)`);
  }
  if (find("BUN")?.value !== "33") throw new Error(`BUN must be 33, got ${find("BUN")?.value}`);
  if (find("Na")?.value !== "137" || find("K")?.value !== "3.8") throw new Error("Na/K slash pair mis-split");
  if (find("AST")?.value !== "20" || find("ALT")?.value !== "18") throw new Error("AST/ALT slash pair mis-split");
  if (slashItems.some((item) => item.label.includes("/"))) {
    throw new Error(`a composite label leaked as a single item: ${slashItems.map((i) => i.label).join(", ")}`);
  }
  const bp = parseLabText("BP 118/69, P 91");
  if (bp.some((item) => ["BUN", "Cr", "Na", "K"].includes(item.label))) {
    throw new Error("blood pressure was wrongly parsed as a lab slash pair");
  }
  const trend = parseLabText("Cr 1.4 -> 2.1");
  if (trend.find((item) => item.label === "Cr")?.value !== "2.1") {
    throw new Error("a real Cr trend was broken by the slash-pair change");
  }
  console.log("PASS Composite slash labs split positionally (BUN/Cr 33/0.63 -> BUN 33, Cr 0.63)");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Slash-pair lab parsing", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Slash-pair lab parsing: ${failures[failures.length - 1].error}`);
}

try {
  const disp = compactDisplaySymbols;
  if (disp("curam 07/02- and clindamycin 07/02-") !== "curam 07/02- + clindamycin 07/02-") {
    throw new Error(`and->+ failed: ${disp("curam 07/02- and clindamycin 07/02-")}`);
  }
  if (disp("lactate elevation") !== "lactate ↑") throw new Error(`elevation->↑ failed: ${disp("lactate elevation")}`);
  if (!/~prior$/.test(disp("mild BLL infil., similar to prior exam"))) {
    throw new Error(`similar-to-prior failed: ${disp("mild BLL infil., similar to prior exam")}`);
  }
  if (disp("diarrhea improved") !== "diarrhea impr") {
    throw new Error(`improved must shorten to 'impr' (not an arrow that can invert meaning): ${disp("diarrhea improved")}`);
  }
  if (/↗|↘/.test(disp("diarrhea improved"))) {
    throw new Error("improving/improved must NOT render as a trajectory arrow (misread risk)");
  }
  // Value arrows still work and are not disturbed.
  if (normalizeClinicalDisplayText("K 5.3 high") !== "K 5.3 ↑") throw new Error(`high->↑ regressed: ${normalizeClinicalDisplayText("K 5.3 high")}`);
  if (normalizeClinicalDisplayText("dyspnea improved") !== "dyspnea improved") throw new Error("editor/stored normalizer must NOT compact (display-only)");
  console.log("PASS Display compaction: and->+, elevation->↑, similar to prior->~prior, improved->impr (no inverting arrow)");
  supplementalPasses += 1;
} catch (error) {
  failures.push({ name: "Display compaction substitutions", error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL Display compaction substitutions: ${failures[failures.length - 1].error}`);
}

await server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} clinical eval case(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length + supplementalPasses} clinical eval cases passed.`);
