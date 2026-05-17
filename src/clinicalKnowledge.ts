import type {
  AiSoapDraft,
  ClinicalFactBundle,
  ClinicalReasoningBundle,
  ClinicalRuleMatch,
  ClinicalRuleSeverity,
  ClinicalSourceRef,
  GeneratedClinicalPlan,
  PatientImportDraft,
  TaskCategory,
  TaskPriority,
} from "./types";

type KnowledgeScope =
  | "neuro-stroke"
  | "infection-sepsis"
  | "cardio-hf-acs-af"
  | "renal-aki-electrolytes"
  | "pulm-o2-pna-copd-pe"
  | "gi-bleed-anemia"
  | "endocrine-glucose-dka-hhs"
  | "heme-onc-safety";

interface ClinicalKnowledgePack {
  id: KnowledgeScope;
  title: string;
  scope: string;
  triggers: RegExp[];
  mustNotMiss: string[];
  summaryHints: string[];
  sourceRefs: ClinicalSourceRef[];
}

interface RuleContext {
  pmh?: string[];
  activeProblems?: string[];
  today?: string;
}

const LAST_REVIEWED = "2026-05-17";
const RULE_OWNER = "IM Rounding Tracker clinical rule draft";

const sourceRefs = {
  ais2026: {
    id: "aha-asa-ais-2026",
    level: "A",
    title: "AHA/ASA 2026 Guideline for Early Management of Acute Ischemic Stroke",
    url: "https://professional.heart.org/en/science-news/2026-guideline-for-the-early-management-of-patients-with-acute-ischemic-stroke",
    note: "Use for AIS supportive care, reperfusion context, BP/glucose caution, dysphagia and complication awareness.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  sepsis2021: {
    id: "ssc-sepsis-2021",
    level: "A",
    title: "Surviving Sepsis Campaign 2021 Adult Guidelines",
    url: "https://www.sccm.org/Clinical-Resources/Guidelines/Guidelines/Surviving-Sepsis-Guidelines-2021",
    note: "Use for sepsis/shock recognition, cultures, antibiotics, lactate, source control, and resuscitation prompts.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  kdigoAki: {
    id: "kdigo-aki",
    level: "A",
    title: "KDIGO Acute Kidney Injury Guideline",
    url: "https://kdigo.org/guidelines/acute-kidney-injury/",
    note: "Use for AKI recognition, Cr/urine output trends, electrolyte safety, nephrotoxin and contrast awareness.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  hf2022: {
    id: "acc-aha-hfsa-hf-2022",
    level: "A",
    title: "ACC/AHA/HFSA Guideline for Management of Heart Failure",
    url: "https://www.acc.org/About-ACC/Press-Releases/2022/04/01/15/22/ACC-AHA-HFSA-Issue-Heart-Failure-Guideline",
    note: "Use for HF congestion, diuresis monitoring, renal/electrolyte follow-up, and disposition awareness.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  cap2019: {
    id: "ats-idsa-cap-2019",
    level: "A",
    title: "ATS/IDSA Guideline for Community-Acquired Pneumonia",
    url: "https://www.idsociety.org/practice-guideline/community-acquired-pneumonia-cap-in-adults/",
    note: "Use for pneumonia handoff structure: severity, cultures when indicated, antibiotic stewardship, response and disposition.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  goldCopd2026: {
    id: "gold-copd-2026",
    level: "A",
    title: "GOLD 2026 Report for COPD",
    url: "https://goldcopd.org/2026-gold-report-and-pocket-guide/",
    note: "Use for COPD exacerbation handoff: oxygenation, bronchodilator/steroid plan, hypercapnia/NIV signals and discharge inhaler readiness.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  acgUgib2021: {
    id: "acg-ugib-2021",
    level: "A",
    title: "ACG Clinical Guideline: Upper Gastrointestinal and Ulcer Bleeding",
    url: "https://journals.lww.com/ajg/fulltext/2021/05000/acg_clinical_guideline__upper_gastrointestinal_and.14.aspx",
    note: "Use for UGIB handoff: hemodynamics, Hb/transfusion context, endoscopy, PPI and antithrombotic decisions.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  adaHospital2026: {
    id: "ada-hospital-care-2026",
    level: "A",
    title: "ADA Standards of Care in Diabetes 2026: Diabetes Care in the Hospital",
    url: "https://professional.diabetes.org/standards-of-care",
    note: "Use for inpatient glucose safety, hypoglycemia, DKA/HHS signals, insulin/nutrition and electrolyte monitoring prompts.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  ashVte2020: {
    id: "ash-vte-treatment-2020",
    level: "A",
    title: "ASH Guidelines for Treatment of DVT and PE",
    url: "https://ashpublications.org/bloodadvances/article/4/19/4693/463207/American-Society-of-Hematology-2020-guidelines",
    note: "Use for VTE/PE handoff structure: hemodynamic compromise, anticoagulation and bleeding tradeoff.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
  },
  neutropenia2010: {
    id: "idsa-neutropenic-fever-2010",
    level: "A",
    title: "IDSA Fever and Neutropenia in Patients with Cancer Guideline",
    url: "https://www.idsociety.org/practice-guideline/neutropenic-patients-with-cancer/",
    note: "Use for neutropenic fever safety, urgent broad-spectrum antibiotics, cultures, and persistent fever reassessment.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
    uncertainty: "Older guideline; local oncology/ID protocol should override when available.",
  },
  localInpatient: {
    id: "local-inpatient-handoff-heuristic",
    level: "D",
    title: "Local inpatient handoff heuristic",
    url: "",
    note: "Workflow heuristic for making reminders concrete, actionable, and clinician-reviewed.",
    lastReviewed: LAST_REVIEWED,
    owner: RULE_OWNER,
    uncertainty: "Local practice dependent; should be updated with hospital SOP overlays.",
  },
} satisfies Record<string, ClinicalSourceRef>;

export const clinicalKnowledgePacks: ClinicalKnowledgePack[] = [
  {
    id: "neuro-stroke",
    title: "Neuro / Stroke",
    scope: "AIS/TIA/ICH, neuro deficit, dysphagia, antithrombotic and imaging handoff",
    triggers: [/\b(ais|acute ischemic stroke|ischemic stroke|cva|tia|nihss|thrombectomy|evt|alteplase|tnk|ich)\b/i, /中風|腦梗|腦出血/],
    mustNotMiss: ["neuro worsening", "reperfusion status", "BP target context", "dysphagia/aspiration", "antithrombotic plan", "imaging pending"],
    summaryHints: ["stroke type/location", "NIHSS/deficit", "tPA/EVT/ICH context", "swallow/rehab/dispo"],
    sourceRefs: [sourceRefs.ais2026, sourceRefs.localInpatient],
  },
  {
    id: "infection-sepsis",
    title: "Infection / Sepsis",
    scope: "Fever, suspected source, cultures, antibiotics, lactate, shock/source control",
    triggers: [/\b(sepsis|septic|shock|bacteremia|fever|febrile|culture|lactate|pna|pneumonia|uti|cellulitis|abscess)\b/i, /發燒|感染|菌血症|肺炎/],
    mustNotMiss: ["shock/hypotension", "lactate", "cultures before antibiotics if no delay", "antibiotic start/de-escalation", "source control"],
    summaryHints: ["source", "culture status", "current antibiotics", "hemodynamics", "source control/pending"],
    sourceRefs: [sourceRefs.sepsis2021, sourceRefs.localInpatient],
  },
  {
    id: "cardio-hf-acs-af",
    title: "Cardio / HF / ACS / AF",
    scope: "HF congestion, ACS/troponin/ECG, AF/RVR, anticoagulation and volume status",
    triggers: [/\b(hf|hfref|hfpef|adhf|heart failure|chf|pulmonary edema|jvp|edema|diuresis|acs|stemi|nstemi|troponin|chest pain|afib|atrial fibrillation|rvr)\b/i],
    mustNotMiss: ["O2/respiratory status", "volume status", "troponin/ECG trend", "rate/rhythm", "anticoagulation/bleeding tradeoff", "Cr/K during diuresis", "HFrEF GDMT readiness/contraindications before discharge"],
    summaryHints: ["volume exam", "O2 need", "diuretic response", "troponin/ECG", "AF/RVR control", "ACEi/ARB/ARNI, beta-blocker, SGLT2i, MRA readiness if HFrEF"],
    sourceRefs: [sourceRefs.hf2022, sourceRefs.localInpatient],
  },
  {
    id: "renal-aki-electrolytes",
    title: "Renal / AKI / Electrolytes",
    scope: "AKI/CKD, Cr trend, K, I/O, nephrotoxins, contrast and renal consult prompts",
    triggers: [/\b(aki|ckd|esrd|dialysis|renal|creatinine|cr\s*[0-9]|hyperkal|hypokal|hyponat|hypernat|na\s*(?:1[01]\d|12[0-4]|15[5-9]|16\d)|k\s*[5-9]\.?[0-9]?|oliguria|anuria)\b/i],
    mustNotMiss: ["K danger", "Na danger", "Cr trend", "urine output", "nephrotoxin/contrast exposure", "ACEi/ARB/diuretic review", "dialysis indication"],
    summaryHints: ["baseline vs current Cr", "K/Na", "I/O", "held meds", "renal consult/dialysis status"],
    sourceRefs: [sourceRefs.kdigoAki, sourceRefs.localInpatient],
  },
  {
    id: "pulm-o2-pna-copd-pe",
    title: "Pulmonary / O2 / PNA / COPD / PE",
    scope: "O2 requirement, pneumonia, COPD/asthma, PE concern and respiratory failure",
    triggers: [/\b(o2|oxygen|spo2|desat|hypox|respiratory failure|pna|pneumonia|aspirat|copd|asthma|wheeze|hypercap|co2|abg|vbg|bipap|niv|pe\b|pulmonary embol|ctpa|d-dimer)\b/i],
    mustNotMiss: ["O2 escalation", "respiratory failure", "antibiotics if pneumonia", "bronchodilator/steroid if obstructive", "hypercapnia/NIV signal", "PE anticoagulation/bleeding tradeoff"],
    summaryHints: ["O2 device/flow", "CXR/CT finding", "Abx/bronchodilator/steroid", "CO2/ABG/VBG/NIV", "PE workup/anticoag", "weaning/dispo"],
    sourceRefs: [sourceRefs.cap2019, sourceRefs.goldCopd2026, sourceRefs.ashVte2020, sourceRefs.localInpatient],
  },
  {
    id: "gi-bleed-anemia",
    title: "GI Bleed / Anemia",
    scope: "Melena/hematochezia/hematemesis, Hb trend, transfusion, endoscopy and anticoag decisions",
    triggers: [/\b(gi bleed|melena|hematochezia|hematemesis|bleed|bleeding|hb\s*[0-9]|hgb|anemia|transfusion|endoscopy|egd|colonoscopy)\b/i],
    mustNotMiss: ["hemodynamic instability", "Hb trend", "transfusion threshold/context", "endoscopy plan", "anticoag/antiplatelet hold-resume"],
    summaryHints: ["bleeding source", "Hb trend", "transfusion", "scope timing", "antithrombotic decision"],
    sourceRefs: [sourceRefs.acgUgib2021, sourceRefs.localInpatient],
  },
  {
    id: "endocrine-glucose-dka-hhs",
    title: "Endocrine / Glucose / DKA-HHS",
    scope: "Hypoglycemia, hyperglycemia, DKA/HHS signals, insulin and electrolyte tasks",
    triggers: [/\b(dm|diabetes|glucose|sugar|hypergly|hypogly|dka|hhs|ketone|insulin|anion gap|hco3|bicarb|acidosis)\b/i],
    mustNotMiss: ["hypoglycemia", "DKA/HHS", "K with insulin", "anion gap/acidosis", "scheduled insulin and glucose checks"],
    summaryHints: ["glucose range", "DKA/HHS evidence", "insulin plan", "K/anion gap monitoring"],
    sourceRefs: [sourceRefs.adaHospital2026, sourceRefs.localInpatient],
  },
  {
    id: "heme-onc-safety",
    title: "Heme / Onc Safety",
    scope: "Neutropenia, chemo/immunosuppression, thrombosis/bleeding, pathology and mass workup pending",
    triggers: [/\b(neutropen|anc|leukopenia|wbc\s*[0-3](?:\.\d+)?\s*k?|chemo|chemotherapy|immunosupp|transplant|steroid|dexamethasone|prednisolone|malign|cancer|carcinoma|tumou?r|mass|pathology|biopsy|thrombosis|dvt|thrombocytopenia|plt\s*[0-9]|tumor lysis|tls|uric acid|phos|phosphate|rasburicase|allopurinol)\b/i],
    mustNotMiss: ["febrile neutropenia", "ANC", "broad-spectrum antibiotics", "isolation", "onc/ID contact", "pathology/staging pending", "TLS labs", "VTE/bleeding balance"],
    summaryHints: ["cancer status", "chemo/immunosuppression", "ANC/fever", "platelets/TLS labs", "pathology/staging", "onc/ID plan"],
    sourceRefs: [sourceRefs.neutropenia2010, sourceRefs.ashVte2020, sourceRefs.localInpatient],
  },
];

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function lineText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function splitLines(value: string) {
  const normalized = value.replace(
    /\s+(?=(?:dx|diagnosis|pmh|underlying|icu course|hospital course|course|today|overnight|vs|v\/s|pe|lab|image|tasks?|pending|red flags?|disposition|dispo)\b\s*[:：]?)/gi,
    "\n",
  );
  return normalized
    .split(/\r?\n|;(?=\s*[A-Z#]|\s*[0-9]|\s*[\u4e00-\u9fff])/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function dedupe(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((item) => cleanText(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function removeGenericFiller(items: string[]) {
  return items.filter((item) => {
    const text = item.toLowerCase();
    const hasTrigger = /\d|if\b|when\b|call\b|threshold|pending|f\/u|repeat|culture|lactate|troponin|\bk\b|\bcr\b|\bhb\b|o2|shock|bleed|fever|glucose|anc|pathology/.test(text);
    if (hasTrigger) return true;
    return !/(monitor closely|continue current management|clinical correlation|stable condition|watch for deterioration|supportive care)$/i.test(text);
  });
}

function corpusFromFacts(facts: ClinicalFactBundle) {
  return [
    facts.sourceText,
    ...facts.diagnoses,
    ...facts.pmh,
    ...facts.activeProblems,
    ...facts.objectiveFacts,
    ...facts.medications,
    ...facts.antibiotics,
    ...facts.hospitalCourse,
    ...facts.todayUpdates,
    ...facts.pendingItems,
    ...facts.dischargeDisposition,
    ...facts.immunocompromisedSignals,
  ].join("\n");
}

function linesMatching(lines: string[], pattern: RegExp, maxItems = 6) {
  return dedupe(lines.filter((line) => pattern.test(line))).slice(0, maxItems);
}

function maxBloodPressure(text: string) {
  let maxSbp = 0;
  let maxDbp = 0;
  for (const match of text.matchAll(/\b(?:bp|b\/p|sbp|blood pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi)) {
    maxSbp = Math.max(maxSbp, Number(match[1] ?? 0));
    maxDbp = Math.max(maxDbp, Number(match[2] ?? 0));
  }
  return { maxSbp, maxDbp };
}

function maxNumberAfter(pattern: RegExp, text: string) {
  let max: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) max = Math.max(max ?? value, value);
  }
  return max;
}

function minNumberAfter(pattern: RegExp, text: string) {
  let min: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) min = Math.min(min ?? value, value);
  }
  return min;
}

function wbcValuesInK(text: string) {
  const values: number[] = [];
  for (const match of text.matchAll(/\bwbc\s*(?:-|:|=)?\s*(\d{1,5}(?:[.,]\d+)?)/gi)) {
    const rawValue = String(match[1] ?? "");
    const numericValue = Number(rawValue.includes(",") ? rawValue.replace(",", "") : rawValue);
    if (!Number.isFinite(numericValue)) continue;
    const valueInK = numericValue >= 100 ? numericValue / 1000 : numericValue;
    values.push(valueInK);
  }
  return values;
}

function minWbc(text: string) {
  const values = wbcValuesInK(text);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function preferredDisplayWbc(text: string) {
  const values = dedupe(wbcValuesInK(text).map((value) => String(value))).map(Number).sort((left, right) => left - right);
  if (values.length === 0) return null;
  const likelyDecimalLabValue = values.find((value) => value > 1.05 && value < 2);
  if (values.includes(1) && likelyDecimalLabValue) return likelyDecimalLabValue;
  return values[0];
}

function formatWbc(value: number | null) {
  if (value === null) return "";
  return Number.isInteger(value) ? `${value}k` : `${value.toFixed(1).replace(/\.0$/, "")}k`;
}

function minAnc(text: string) {
  return minNumberAfter(/\banc\s*(?:-|:|=)?\s*(\d+(?:\.\d+)?)/gi, text);
}

function feverOrInfectionContext(text: string) {
  return /\b(neutropenic fever|febrile neutropen|fever\s*(?:to|up to|38|39)|bt\s*3[89]|temp\s*3[89]|infect|infection|cellulitis|abscess|culture|abx|antibiotic|cef|vanco|mero|pip\/tazo|inf\s+take\s+over|ramsay|zoster|ear\s+swelling|ear\s+discharge)\b/i.test(text);
}

function currentlyAfebrile(text: string) {
  return /\b(afebrile|no fever|temp\s*3[5-7](?:\.\d)?|bt\s*3[5-7](?:\.\d)?)\b/i.test(text);
}

function leukopeniaContext(text: string) {
  const wbc = minWbc(text);
  const anc = minAnc(text);
  return {
    wbc,
    anc,
    hasLowWbc: wbc !== null && wbc < 4,
    hasSevereWbc: wbc !== null && wbc < 2,
    hasLowAnc: anc !== null && anc < 500,
  };
}

function appendRedFlag(
  plan: GeneratedClinicalPlan,
  text: string,
  reason: string,
  severity: ClinicalRuleSeverity,
  sourceRefsForRule: ClinicalSourceRef[],
) {
  plan.redFlags.push({ text, reason, severity, sourceRefs: sourceRefsForRule });
}

function appendTask(
  plan: GeneratedClinicalPlan,
  text: string,
  category: TaskCategory,
  reason: string,
  sourceRefsForRule: ClinicalSourceRef[],
  priority: TaskPriority = "normal",
) {
  plan.todayTasks.push({ text, category, reason, priority, sourceRefs: sourceRefsForRule });
}

function appendAp(
  plan: GeneratedClinicalPlan,
  problemTitle: string,
  assessmentSummary: string,
  evidenceOrCourseItems: string[],
  planItems: string[],
  sourceRefsForRule: ClinicalSourceRef[],
  isImportant = true,
) {
  plan.problemBasedAP.push({
    problemTitle,
    assessmentSummary,
    evidenceOrCourseItems: dedupe(evidenceOrCourseItems).slice(0, 4),
    planItems: dedupe(planItems).slice(0, 5),
    isImportant,
    sourceRefs: sourceRefsForRule,
  });
}

function emptyFacts(sourceText: string, context?: RuleContext): ClinicalFactBundle {
  return {
    sourceText: lineText(sourceText),
    diagnoses: [],
    pmh: dedupe(context?.pmh ?? []),
    activeProblems: dedupe(context?.activeProblems ?? []),
    objectiveFacts: [],
    medications: [],
    antibiotics: [],
    procedures: [],
    consults: [],
    hospitalCourse: [],
    todayUpdates: [],
    pendingItems: [],
    dischargeDisposition: [],
    immunocompromisedSignals: [],
    uncertainty: [],
  };
}

export function buildClinicalFactBundle(sourceText: string, context?: RuleContext): ClinicalFactBundle {
  const facts = emptyFacts(sourceText, context);
  const lines = splitLines(sourceText);
  facts.diagnoses = dedupe([
    ...facts.activeProblems,
    ...linesMatching(lines, /\b(dx|diagnosis|impression|assessment|ais|stroke|sepsis|pna|pneumonia|copd|asthma|pe\b|pulmonary embol|hf|hfref|hfpef|adhf|aki|hyponat|hypernat|gi bleed|anemia|dka|hhs|cancer|neutropen|tls|tumor lysis)/i),
  ]).slice(0, 12);
  facts.pmh = dedupe([
    ...facts.pmh,
    ...linesMatching(lines, /\b(pmh|underlying|history|htn|dm|ckd|cad|hf|af|stroke|cancer|chemo|immunosupp)/i),
  ]).slice(0, 12);
  facts.activeProblems = dedupe([
    ...facts.activeProblems,
    ...linesMatching(lines, /\b(active|problem|ais|stroke|sepsis|shock|pna|pneumonia|copd|asthma|pe\b|pulmonary embol|hf|hfref|hfpef|adhf|acs|af|aki|hyperk|hyponat|hypernat|bleed|anemia|dka|hhs|neutropen|fever|tls|tumor lysis|thrombocytopenia)/i),
  ]).slice(0, 14);
  facts.objectiveFacts = dedupe(linesMatching(lines, /\b(bp|hr|spo2|o2|fio2|rr|bt|temp|fever|wbc|anc|hb|hgb|plt|cr|creatinine|k\s*[0-9]|na|lactate|troponin|bnp|glucose|ketone|ph|hco3|bicarb|anion gap|ag\b|uric acid|phos|phosphate|ldh|d-dimer|ddimer|abg|vbg|pco2|co2|cxr|ctpa|ct|mri|echo|ecg)\b/i, 24));
  facts.medications = dedupe(linesMatching(lines, /\b(insulin|heparin|doac|warfarin|apixaban|rivaroxaban|enoxaparin|aspirin|clopidogrel|statin|diuretic|lasix|furosemide|acei|arb|arni|sacubitril|valsartan|beta[- ]?blocker|\bbb\b|bisoprolol|carvedilol|metoprolol|sglt2|dapagliflozin|empagliflozin|mra|spironolactone|eplerenone|steroid|methylpred|prednisolone|vasopressor|norepi|ppi|pantoprazole|rasburicase|allopurinol)\b/i, 16));
  facts.antibiotics = dedupe(linesMatching(lines, /\b(abx|antibiotic|cef|pip\/tazo|tazocin|zosyn|vanco|vancomycin|mero|imipenem|ertapenem|levo|azithro|ampicillin|sulbactam|metronidazole)\b/i, 16));
  facts.procedures = dedupe(linesMatching(lines, /\b(procedure|operation|op|biopsy|scope|egd|colonoscopy|cath|pci|intubat|extubat|drain|thoracentesis|paracentesis|bronchoscopy|ctpa)\b/i, 10));
  facts.consults = dedupe(linesMatching(lines, /\b(consult|neuro|cardio|renal|nephro|pulm|gi|hema|onco|onc|id|infectious|surgery|rehab)\b/i, 10));
  facts.hospitalCourse = dedupe(linesMatching(lines, /\b(hospital course|course|s\/p|started|stopped|treated|improved|worse|complicated|transferred|icu|ward)\b/i, 12));
  facts.todayUpdates = dedupe(linesMatching(lines, /\b(today|overnight|on |new|worse|improved|still|persistent|now|目前|今天|昨晚)\b/i, 12));
  facts.pendingItems = dedupe(linesMatching(lines, /\b(pending|f\/u|follow|repeat|await|culture|pathology|biopsy|ct|mri|echo|scope|consult|arrange|monitor|trend)\b/i, 18));
  facts.dischargeDisposition = dedupe(linesMatching(lines, /\b(dispo|disposition|discharge|dc\b|home|transfer|snf|rehab|opd|follow-up|出院|轉院|安置)\b/i, 10));
  facts.immunocompromisedSignals = dedupe(linesMatching(lines, /\b(neutropen|anc|leukopenia|wbc\s*[0-3](?:\.\d+)?\s*k?|chemo|immunosupp|transplant|steroid|dexamethasone|prednisolone|hematologic malign|lymphoma|leukemia)\b/i, 12));
  facts.uncertainty = dedupe(linesMatching(lines, /\b(unclear|unknown|r\/o|rule out|suspect|possible|query|\?|pending)\b/i, 8));
  return facts;
}

function matchKnowledgePacks(facts: ClinicalFactBundle): ClinicalRuleMatch[] {
  const corpus = corpusFromFacts(facts);
  return clinicalKnowledgePacks
    .map((pack) => {
      const matchedTriggers = pack.triggers.map((trigger) => corpus.match(trigger)?.[0] ?? "").filter(Boolean);
      if (matchedTriggers.length === 0) return null;
      const match: ClinicalRuleMatch = {
        id: pack.id,
        scope: pack.scope,
        title: pack.title,
        severity: "review",
        matchedTriggers: dedupe(matchedTriggers),
        sourceRefs: pack.sourceRefs,
        needsReview: true,
      };
      return match;
    })
    .filter((match): match is ClinicalRuleMatch => Boolean(match));
}

function stableVitalsOnly(sourceText: string) {
  const text = sourceText.toLowerCase();
  if (!/\b(v\/s|vitals?|bp|hr|rr|spo2|sat|temp|bt)\b/.test(text)) return false;
  if (/\b(dx|diagnosis|assessment|plan|sepsis|shock|stroke|ais|ich|pna|pneumonia|hf|hfref|hfpef|adhf|heart failure|acs|aki|bleed|dka|hhs|neutropen|fever|pending|f\/u|follow|consult)\b/.test(text)) {
    return false;
  }
  const { maxSbp, maxDbp } = maxBloodPressure(sourceText);
  const maxHr = maxNumberAfter(/\bhr\s*[:=]?\s*(\d{2,3})/gi, sourceText);
  const minSpo2 = minNumberAfter(/\b(?:spo2|sat)\s*[:=]?\s*(\d{2,3})/gi, sourceText);
  const maxTemp = maxNumberAfter(/\b(?:temp|bt)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, sourceText);
  return (
    (maxSbp === 0 || maxSbp < 180) &&
    (maxDbp === 0 || maxDbp < 110) &&
    (maxHr === null || maxHr < 110) &&
    (minSpo2 === null || minSpo2 >= 94) &&
    (maxTemp === null || maxTemp < 38)
  );
}

function hasMatch(matches: ClinicalRuleMatch[], id: KnowledgeScope) {
  return matches.some((match) => match.id === id);
}

function applyNeuroRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "neuro-stroke")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "neuro-stroke")?.sourceRefs ?? [sourceRefs.localInpatient];
  const { maxSbp, maxDbp } = maxBloodPressure(text);
  const hasIchSignal =
    /\b(ich|intracranial hemorrhage|hemorrhagic)\b/i.test(text) &&
    !/\b(?:no|without|w\/o)\s+(?:ich|intracranial hemorrhage|hemorrhage)\b/i.test(text);
  const hasReperfusionOrIch = /\b(tpa|tnk|alteplase|thrombolysis|thrombectomy|evt)\b/i.test(text) || hasIchSignal;

  const hasAcuteNeuroWorsening =
    /\b(?:decreased consciousness|coma|seizure|new weakness|aphasia|new focal|acute neuro)\b/i.test(text) ||
    /\b(?:worse|worsening|progress|declin)[^.]{0,40}\b(?:weakness|aphasia|dysarthria|consciousness|focal|nihss|stroke|seizure)\b/i.test(text);
  const hasActiveStrokeOrNeuroCare =
    /\b(?:ais|acute ischemic stroke|subacute stroke|recent stroke|new stroke|tia|nihss|thrombectomy|evt|alteplase|tnk|thrombolysis|dysphagia|aphasia|hemiplegia|facial droop|new weakness|new focal|neuro deficit|stroke protocol|stroke survey|brain infarct)\b/i.test(text) ||
    hasReperfusionOrIch ||
    hasAcuteNeuroWorsening;
  if (!hasActiveStrokeOrNeuroCare) return;

  if (hasAcuteNeuroWorsening) {
    appendRedFlag(plan, "Neuro worsening or decreased consciousness", "Stroke/neuro trigger with worsening deficit or mental status change.", "urgent", refs);
  }
  if (hasReperfusionOrIch && (maxSbp >= 180 || maxDbp >= 105)) {
    appendRedFlag(plan, `BP ${maxSbp}/${maxDbp} in reperfusion/ICH context`, "BP target depends on tPA/EVT/ICH context; clinician should verify active target.", "urgent", refs);
  } else if (!hasReperfusionOrIch && (maxSbp >= 220 || maxDbp >= 120)) {
    appendRedFlag(plan, `BP ${maxSbp}/${maxDbp} in AIS without reperfusion context`, "Marked BP elevation exceeds permissive HTN range; verify target and treatment plan.", "urgent", refs);
  }
  appendTask(plan, "f/u neuro change, swallow screen, antithrombotic/statin and brain/vascular imaging plan", "order", "Stroke handoff must preserve deficit, dysphagia, imaging and secondary prevention tasks.", refs);
  appendAp(plan, "Stroke / neuro deficit", "Stroke/neuro issue; define current deficit, reperfusion/ICH context, swallow safety, imaging, and secondary prevention plan.", plan.facts.objectiveFacts, ["neuro checks", "verify BP target by reperfusion/ICH context", "f/u swallow/imaging", "clarify antithrombotic/statin/rehab plan"], refs);
}

function applyInfectionRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "infection-sepsis")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "infection-sepsis")?.sourceRefs ?? [sourceRefs.localInpatient];
  const lactate = maxNumberAfter(/\blactate\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const minSbp = minNumberAfter(/\bbp\s*[:=]?\s*(\d{2,3})\s*\/\s*\d{2,3}/gi, text);
  const hasRamsayEarInfection = /\b(ramsay|zoster|ear\s+swelling|ear\s+discharge|facial\s+weakness|cnvii|cn\s*vii)\b/i.test(text);
  const shockKeyword = /shock|pressor|norepi|hypotension|septic shock/i.test(text);
  const cultureSignal = /\b(?:b\/c|bcx|blood culture|sputum culture|urine culture|culture)\b/i.test(text);
  const bacteremiaSignal = /\b(bacteremia|blood culture.*positive|bcx.*positive|gram[- ](?:positive|negative)|gpc|gnb)\b/i.test(text);
  const sourceControlNeed = /\b(abscess|empyema|cholangitis|obstruct|obstruction|drain|source control|ercp|debridement)\b/i.test(text);
  const resolvedShockContext = /\b(?:shock|sepsis|hypotension)[^.]{0,40}\b(?:resolved|improved)|\b(?:resolved|improved)[^.]{0,40}\b(?:shock|sepsis|hypotension)|\bnorepi\s+(?:stopped|off)|\boff\s+(?:pressor|norepi)|\bafebrile\s*\d{0,2}\s*h/i.test(text);
  const currentHemodynamicSignal =
    (lactate !== null && lactate >= 4) ||
    (minSbp !== null && minSbp < 90) ||
    (lactate !== null && lactate >= 2 && minSbp !== null && minSbp <= 95);
  const hasSepsisPhysiology = currentHemodynamicSignal || (shockKeyword && !resolvedShockContext);
  if (hasSepsisPhysiology) {
    appendRedFlag(plan, "Possible sepsis/shock physiology", "Infection trigger with shock, hypotension, vasopressor or high lactate signal.", "urgent", refs);
  } else if (bacteremiaSignal && !currentlyAfebrile(text)) {
    appendRedFlag(plan, "Bacteremia / persistent fever signal", "Positive blood culture or persistent fever requires explicit source/Abx handoff.", "today", refs);
  }
  appendTask(
    plan,
    hasRamsayEarInfection
      ? "confirm antiviral/antibiotic duration, fever trend, ENT/ID follow-up and culture results if obtained"
      : sourceControlNeed
        ? "f/u cultures/Abx response and source control/drainage status"
        : cultureSignal
          ? "f/u cultures, Abx coverage/de-escalation, fever/WBC and hemodynamics"
          : "confirm infection source, Abx need/duration, fever/WBC and hemodynamic trend",
    "order",
    "Infection handoff should preserve source, Abx/antiviral plan, cultures and hemodynamic risk.",
    refs,
    hasSepsisPhysiology ? "urgent" : "normal",
  );
  appendAp(
    plan,
    hasRamsayEarInfection ? "Ramsay Hunt / ear infection" : "Infection / sepsis",
    hasRamsayEarInfection
      ? "Ear/zoster infection with cranial nerve involvement; clarify antiviral/Abx duration, fever trend, hearing/eye care, and ENT/ID follow-up."
      : sourceControlNeed
        ? "Infection with source-control issue; track Cx, Abx response, fever/WBC, hemodynamics and drainage/procedure status."
        : "Infection concern; verify source, culture status, Abx coverage/de-escalation, fever/WBC, lactate and hemodynamics.",
    [...plan.facts.objectiveFacts, ...plan.facts.antibiotics, ...plan.facts.consults],
    hasRamsayEarInfection
      ? ["confirm antiviral/Abx duration", "f/u fever curve/culture if obtained", "clarify ENT/ID follow-up", "eye care/hearing follow-up if facial palsy or hearing deficit"]
      : [
          "confirm source",
          cultureSignal || bacteremiaSignal ? "f/u cultures/susceptibility" : "f/u Cx only if obtained/indicated",
          "review Abx/de-escalation",
          sourceControlNeed ? "verify source control/procedure response" : "trend fever/WBC/lactate if relevant",
        ],
    refs,
  );
}

function applyCardioRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "cardio-hf-acs-af")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "cardio-hf-acs-af")?.sourceRefs ?? [sourceRefs.localInpatient];
  const unresolvedShockSignal = /shock/i.test(text) && !/\b(?:shock|sepsis|hypotension)[^.]{0,40}\b(?:resolved|improved)|\b(?:resolved|improved)[^.]{0,40}\b(?:shock|sepsis|hypotension)|\bnorepi\s+(?:stopped|off)|\boff\s+(?:pressor|norepi)/i.test(text);
  const ef = minNumberAfter(/\b(?:ef|lvef)\s*[:=]?\s*(\d{1,2})\s*%?/gi, text);
  const hasHfrEf =
    /\b(hfref|heart failure with reduced ef|reduced ef|systolic hf)\b/i.test(text) ||
    (/\b(hf|heart failure|chf)\b/i.test(text) && ef !== null && ef <= 40);
  const minSbp = minNumberAfter(/\bbp\s*[:=]?\s*(\d{2,3})\s*\/\s*\d{2,3}/gi, text);
  const potassium = maxNumberAfter(/\bk\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const creatinine = maxNumberAfter(/\b(?:cr|creatinine)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const gdmtCaution = unresolvedShockSignal || (minSbp !== null && minSbp < 95) || (potassium !== null && potassium >= 5.5) || (creatinine !== null && creatinine >= 2.5);
  const gdmtPlan = hasHfrEf
    ? gdmtCaution
      ? "review HFrEF GDMT readiness/contraindications before DC; defer or adjust ACEi/ARB/ARNI, BB, SGLT2i, MRA if hypotension, AKI, hyperK or shock"
      : "review HFrEF GDMT before DC: ACEi/ARB/ARNI, evidence BB, SGLT2i, MRA as tolerated"
    : "";
  if (/chest pain|stemi|nstemi|acs|troponin.*(rise|up|elevat)|rvr|pulmonary edema|respiratory failure/i.test(text) || unresolvedShockSignal) {
    appendRedFlag(plan, "High-risk cardiac signal", "ACS/troponin, RVR, shock or pulmonary edema signal requires explicit handoff.", "urgent", refs);
  }
  appendTask(plan, "track volume/O2 status, I/O/diuresis response, ECG/troponin or rate-control plan if present", "order", "Cardio/HF handoff must keep volume, renal/electrolyte and rhythm/ischemia tasks visible.", refs);
  if (gdmtPlan) {
    appendTask(plan, gdmtPlan, "discharge", "HFrEF handoff should include GDMT readiness and contraindications, not just monitoring.", refs, gdmtCaution ? "normal" : "low");
  }
  appendAp(
    plan,
    "Cardio / HF / rhythm",
    `Cardiac issue; verify volume status, oxygen need, ischemia/rhythm context, diuretic response and renal/electrolyte safety${hasHfrEf ? "; review HFrEF GDMT readiness before discharge" : ""}.`,
    plan.facts.objectiveFacts,
    [gdmtPlan, "document volume/O2 status", "trend Cr/K with diuresis", "f/u ECG/troponin/rate-control tasks when relevant"].filter(Boolean),
    refs,
  );
}

function applyRenalRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "renal-aki-electrolytes")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "renal-aki-electrolytes")?.sourceRefs ?? [sourceRefs.localInpatient];
  const potassium = maxNumberAfter(/\bk\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const creatinine = maxNumberAfter(/\b(?:cr|creatinine)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const sodiumMin = minNumberAfter(/\b(?:na|sodium)\s*[:=]?\s*(\d{2,3})/gi, text);
  const sodiumMax = maxNumberAfter(/\b(?:na|sodium)\s*[:=]?\s*(\d{2,3})/gi, text);
  const hasDysnatremia = (sodiumMin !== null && sodiumMin <= 125) || (sodiumMax !== null && sodiumMax >= 155) || /\b(hyponat|hypernat)\b/i.test(text);
  const severeDysnatremia =
    (sodiumMin !== null && sodiumMin <= 120) ||
    (sodiumMax !== null && sodiumMax >= 160) ||
    /\b(?:seizure|ams|confusion|coma)[^.]{0,40}\b(?:hyponat|hypernat|na\b)|\b(?:hyponat|hypernat|na\b)[^.]{0,40}\b(?:seizure|ams|confusion|coma)\b/i.test(text);
  const actionableRenal = /\b(aki|ckd|esrd|dialysis|renal consult|hyperkal|hypokal|oliguria|anuria|hold acei|hold arb|nephrotoxin|contrast)\b/i.test(text) ||
    (potassium !== null && (potassium >= 5.5 || potassium < 3)) ||
    (creatinine !== null && creatinine >= 1.5) ||
    hasDysnatremia;
  if (!actionableRenal) return;
  if ((potassium !== null && potassium >= 6) || /ecg change|peaked t|oliguria|anuria|dialysis/i.test(text)) {
    appendRedFlag(plan, "AKI/electrolyte danger signal", "HyperK, ECG change, oliguria/anuria or dialysis signal needs explicit handoff.", "urgent", refs);
  }
  if (severeDysnatremia) {
    appendRedFlag(plan, `Severe Na disorder${sodiumMin !== null ? `, Na ${sodiumMin}` : sodiumMax !== null ? `, Na ${sodiumMax}` : ""}`, "Severe dysnatremia or neuro symptom needs correction-rate and etiology handoff.", "urgent", refs);
  }
  appendTask(
    plan,
    hasDysnatremia
      ? "trend Cr/K/Na and I/O; clarify Na correction rate, osm/volume status, meds/contrast and renal consult need"
      : "trend Cr/K and I/O; review nephrotoxins, ACEi/ARB/diuretics, contrast and renal consult need",
    "lab",
    "AKI/electrolyte handoff should preserve renal trajectory, dangerous K/Na shifts and medication/contrast safety.",
    refs,
    (potassium !== null && potassium >= 5.5) || severeDysnatremia ? "urgent" : "normal",
  );
  appendAp(
    plan,
    hasDysnatremia ? "AKI / electrolyte / Na" : "AKI / electrolyte",
    `Renal/electrolyte issue${creatinine ? `, Cr up to ${creatinine}` : ""}${potassium ? `, K up to ${potassium}` : ""}${sodiumMin !== null && sodiumMin <= 125 ? `, Na low ${sodiumMin}` : ""}${sodiumMax !== null && sodiumMax >= 155 ? `, Na high ${sodiumMax}` : ""}; trend trajectory, I/O, medication/contrast safety and renal/dialysis need.`,
    plan.facts.objectiveFacts,
    [
      hasDysnatremia ? "trend Na correction rate/osm/volume status" : "trend Cr/K",
      "strict I/O if relevant",
      "review nephrotoxins/contrast/ACEi/ARB/diuretics",
      "consider renal consult/dialysis indication",
    ],
    refs,
  );
}

function applyPulmRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "pulm-o2-pna-copd-pe")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "pulm-o2-pna-copd-pe")?.sourceRefs ?? [sourceRefs.localInpatient];
  const minSpo2 = minNumberAfter(/\b(?:spo2|sat)\s*[:=]?\s*(\d{2,3})/gi, text);
  const pco2 = maxNumberAfter(/\b(?:pco2|co2)\s*[:=]?\s*(\d{2,3})/gi, text);
  const peConcern = /\b(?:pe|pulmonary embol|ctpa|v\/q|d-dimer|ddimer|rv strain)\b/i.test(text) && !/\b(?:no|without|negative for|r\/o negative)\s+(?:pe|pulmonary embol)/i.test(text);
  const obstructiveSignal = /\b(copd|asthma|wheeze|bronchodilator|steroid|methylpred|hypercap|pco2|co2 retention|bipap|niv)\b/i.test(text);
  const pneumoniaSignal = /\b(pna|pneumonia|aspirat|sputum|infiltrate|consolidation)\b/i.test(text);
  const aspirationSignal = /\b(aspirat|dysphag|swallow|ng feeding|choking)\b/i.test(text);
  const activeOxygenSignal = /\b(o2\s*(?:nc|mask|need|require|l\/min|lpm|[1-9]\s*l)|oxygen|desat|hypox|respiratory failure|hfno|bipap|niv)\b/i.test(text) ||
    (minSpo2 !== null && minSpo2 <= 92);
  const actionablePulm = pneumoniaSignal || obstructiveSignal || activeOxygenSignal || peConcern ||
    (minSpo2 !== null && minSpo2 <= 92);
  if (!actionablePulm) return;
  const activeVentSignal = /intubat/i.test(text) && !/extubat/i.test(text);
  if (/respiratory failure|hfno|bipap|desat|hypox/i.test(text) || activeVentSignal || peConcern || (pco2 !== null && pco2 >= 60) || (minSpo2 !== null && minSpo2 < 90)) {
    appendRedFlag(plan, "Respiratory/O2 escalation signal", "Pulmonary trigger with hypoxemia, respiratory failure or PE concern.", "urgent", refs);
  }
  const title = peConcern
    ? "PE concern / anticoag"
    : obstructiveSignal
      ? "COPD/asthma exacerbation"
      : aspirationSignal
        ? "Aspiration / PNA"
        : pneumoniaSignal
          ? "PNA / O2"
          : "Pulmonary / O2";
  const summary = peConcern
    ? "PE/VTE concern; track hemodynamics/O2, CTPA/VQ/LE Doppler, RV strain/trop/BNP and anticoag vs bleeding risk."
    : obstructiveSignal
      ? `Obstructive airway issue${pco2 ? `, CO2 up to ${pco2}` : ""}; verify O2 target, bronchodilator/steroid response, ABG/VBG and NIV/escalation need.`
      : pneumoniaSignal
        ? "PNA/aspiration issue; track O2, CXR/CT, sputum/Cx when useful, Abx response/de-escalation and swallow risk."
        : "Pulmonary issue; verify O2 requirement, imaging result, treatment response, weaning plan and respiratory deterioration threshold.";
  const planItems = peConcern
    ? ["f/u CTPA/VQ/LE Doppler if pending", "check RV strain/trop/BNP if high-risk PE", "review anticoag vs bleeding/Plt/procedure risk", "define O2/hemodynamic escalation threshold"]
    : obstructiveSignal
      ? ["trend O2/SpO2 and CO2 if hypercapnic", "review bronchodilator/steroid/Abx indications", "f/u ABG/VBG/CXR if pending", "define NIV/intubation threshold if worsening"]
      : pneumoniaSignal
        ? ["trend O2/SpO2 and fever curve", "f/u CXR/CT and sputum/Cx if pending", "review Abx duration/de-escalation", aspirationSignal ? "swallow/aspiration precautions" : "weaning/dispo plan"]
        : ["trend O2/SpO2", "f/u CXR/CT if pending", "review Abx/bronchodilator/anticoag plan as relevant"];
  appendTask(plan, planItems.slice(0, 2).join("; "), peConcern ? "imaging" : "order", "Pulmonary handoff should preserve O2 trajectory, imaging and treatment response.", refs);
  appendAp(plan, title, summary, [...plan.facts.objectiveFacts, ...plan.facts.antibiotics], planItems, refs);
}

function applyGiRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "gi-bleed-anemia")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "gi-bleed-anemia")?.sourceRefs ?? [sourceRefs.localInpatient];
  const hb = minNumberAfter(/\b(?:hb|hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const resolvedHemodynamicContext = /\b(?:shock|sepsis|hypotension)[^.]{0,40}\b(?:resolved|improved)|\b(?:resolved|improved)[^.]{0,40}\b(?:shock|sepsis|hypotension)|\bnorepi\s+(?:stopped|off)|\boff\s+(?:pressor|norepi)/i.test(text);
  const upperGiSignal = /\b(hematemesis|coffee ground|melena|ugib|upper gi|duodenal ulcer|gastric ulcer|ppi|pantoprazole|egd)\b/i.test(text);
  const antithromboticSignal = /\b(anticoag|doac|warfarin|heparin|apixaban|rivaroxaban|aspirin|clopidogrel|antiplatelet)\b/i.test(text);
  const activeBleedingSignal = /\b(active bleed|gi bleed|melena|hematemesis|hematochezia|transfusion|endoscopy|egd|colonoscopy|hold anticoag|brbpr|rectal bleeding)\b/i.test(text);
  const hemodynamicBleedSignal = /\b(shock|hypotension)\b/i.test(text) && !resolvedHemodynamicContext;
  const actionableBleed = activeBleedingSignal || hemodynamicBleedSignal ||
    (hb !== null && hb < 8);
  if (!actionableBleed) return;
  if (activeBleedingSignal || hemodynamicBleedSignal || (hb !== null && hb < 7)) {
    appendRedFlag(plan, "Active bleeding or severe anemia signal", "Bleeding/Hb signal requires handoff of hemodynamics, transfusion and scope plan.", "urgent", refs);
  }
  appendTask(
    plan,
    upperGiSignal
      ? "trend Hb/V/S; confirm PPI, EGD timing, transfusion/T&S and antithrombotic hold-resume"
      : "trend Hb/V/S; clarify transfusion, scope/procedure and anticoag/antiplatelet hold-resume plan",
    "lab",
    "Bleeding/anemia handoff must keep Hb trend, procedure and antithrombotic decisions visible.",
    refs,
    hb !== null && hb < 8 ? "urgent" : "normal",
  );
  appendAp(
    plan,
    upperGiSignal ? "UGIB / anemia" : "Bleeding / anemia",
    hb
      ? `Bleeding/anemia concern, Hb nadir ${hb}; verify V/S, Hb trend, transfusion/T&S, scope/procedure and antithrombotic decision.`
      : "Bleeding/anemia concern; verify V/S, Hb trend, transfusion/T&S, scope/procedure and antithrombotic decision.",
    plan.facts.objectiveFacts,
    [
      "trend Hb/V/S",
      "T&S/transfusion if indicated",
      upperGiSignal ? "confirm PPI + EGD timing" : "f/u scope/procedure plan",
      antithromboticSignal ? "review anticoag/antiplatelet hold-resume" : "check antithrombotic exposure",
    ],
    refs,
  );
}

function applyEndocrineRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "endocrine-glucose-dka-hhs")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "endocrine-glucose-dka-hhs")?.sourceRefs ?? [sourceRefs.localInpatient];
  const glucoseMax = maxNumberAfter(/\b(?:glucose|sugar|glu|ac|pc)\s*[:=]?\s*(\d{2,4})/gi, text);
  const glucoseMin = minNumberAfter(/\b(?:glucose|sugar|glu|ac|pc)\s*[:=]?\s*(\d{2,4})/gi, text);
  const anionGap = maxNumberAfter(/\b(?:anion gap|ag)\s*[:=]?\s*(\d{1,2})/gi, text);
  const hco3 = minNumberAfter(/\b(?:hco3|bicarb|bicarbonate)\s*[:=]?\s*(\d{1,2})/gi, text);
  const ph = minNumberAfter(/\bph\s*[:=]?\s*(\d(?:\.\d+)?)/gi, text);
  const potassium = maxNumberAfter(/\bk\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const dkaHhsSignal =
    /\b(dka|hhs|ketone|ketosis)\b/i.test(text) ||
    ((glucoseMax !== null && glucoseMax >= 400) && ((anionGap !== null && anionGap >= 18) || (hco3 !== null && hco3 < 18) || (ph !== null && ph < 7.3)));
  const hasInsulinNutritionRisk = /\b(insulin|npo|poor intake|tube feed|ng feeding|tpn|steroid|dexamethasone|prednisolone)\b/i.test(text);
  const hasActiveGlucoseContext =
    dkaHhsSignal ||
    (glucoseMin !== null && glucoseMin < 70) ||
    (glucoseMax !== null && glucoseMax >= 250) ||
    /\b(hypogly|hypergly|dka|hhs|ketone|insulin drip|anion gap|acidosis)\b/i.test(text) ||
    ((glucoseMax !== null || glucoseMin !== null) && hasInsulinNutritionRisk);
  if (!hasActiveGlucoseContext) return;
  if (dkaHhsSignal || (glucoseMin !== null && glucoseMin < 70) || (glucoseMax !== null && glucoseMax >= 400)) {
    appendRedFlag(plan, "High-risk glucose signal", "Hypoglycemia, severe hyperglycemia or DKA/HHS signal requires concrete plan.", "urgent", refs);
  }
  appendTask(
    plan,
    dkaHhsSignal
      ? "track glucose, AG/HCO3/pH, K and insulin/IVF transition readiness"
      : glucoseMin !== null && glucoseMin < 70
        ? "review hypoglycemia trigger, nutrition/insulin timing and repeat glucose checks"
        : "review glucose trend, insulin/nutrition plan and BMP/K follow-up if relevant",
    "lab",
    "Endocrine handoff should preserve glucose trajectory and electrolyte/insulin safety.",
    refs,
    dkaHhsSignal || (glucoseMin !== null && glucoseMin < 70) ? "urgent" : "normal",
  );
  appendAp(
    plan,
    dkaHhsSignal ? "DKA/HHS / glucose" : glucoseMin !== null && glucoseMin < 70 ? "Hypoglycemia" : "Glucose control",
    dkaHhsSignal
      ? `DKA/HHS physiology${glucoseMax ? `, glucose up to ${glucoseMax}` : ""}${anionGap ? `, AG ${anionGap}` : ""}${hco3 ? `, HCO3 ${hco3}` : ""}${ph ? `, pH ${ph}` : ""}${potassium ? `, K ${potassium}` : ""}; verify insulin/IVF/electrolyte plan and gap-closure transition.`
      : glucoseMin !== null && glucoseMin < 70
        ? `Hypoglycemia, glucose low ${glucoseMin}; identify insulin/nutrition/renal trigger and repeat checks.`
        : "Glucose/endocrine issue; verify glucose trajectory, insulin/nutrition plan and BMP/K context when relevant.",
    plan.facts.objectiveFacts,
    dkaHhsSignal
      ? ["trend glucose + AG/HCO3/pH", "track K before/during insulin", "verify IVF/insulin plan", "transition to SC insulin when gap closed/eating"]
      : glucoseMin !== null && glucoseMin < 70
        ? ["repeat glucose after correction", "review insulin/nutrition timing", "check renal/steroid/infection trigger"]
        : ["trend glucose", "review insulin/nutrition plan", "f/u BMP/K if clinically relevant"],
    refs,
  );
}

function applyHemeOncRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "heme-onc-safety")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "heme-onc-safety")?.sourceRefs ?? [sourceRefs.localInpatient];
  const { wbc, anc, hasLowWbc, hasSevereWbc, hasLowAnc } = leukopeniaContext(text);
  const displayWbc = preferredDisplayWbc(text);
  const wbcText = formatWbc(displayWbc);
  const hasCancerWorkup = /\b(chemo|chemotherapy|malign|cancer|carcinoma|tumou?r|mass|pathology|biopsy|lymphoma|leukemia|metasta)\b/i.test(text);
  const plateletMin = minNumberAfter(/\b(?:plt|platelet)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const potassium = maxNumberAfter(/\bk\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const creatinine = maxNumberAfter(/\b(?:cr|creatinine)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const uricAcid = maxNumberAfter(/\buric acid\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const phosphorus = maxNumberAfter(/\b(?:phos|phosphate|p)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const tlsSignal =
    /\b(tls|tumor lysis|rasburicase|allopurinol)\b/i.test(text) ||
    (/\b(lymphoma|leukemia|chemo|chemotherapy|bulky tumor)\b/i.test(text) &&
      ((uricAcid !== null && uricAcid >= 8) || (phosphorus !== null && phosphorus >= 5) || (potassium !== null && potassium >= 5.5) || (creatinine !== null && creatinine >= 1.5)));
  const thrombocytopeniaSignal = (plateletMin !== null && plateletMin < 50) || /\b(thrombocytopenia|low platelet)\b/i.test(text);
  const hasNeutropenicFeverContext = /\b(neutropenic fever|febrile neutropen)\b/i.test(text) || ((hasSevereWbc || hasLowAnc) && feverOrInfectionContext(text));
  const title = tlsSignal
    ? "TLS / onc safety"
    : hasNeutropenicFeverContext
    ? "Neutropenic fever / leukopenia"
    : hasCancerWorkup
      ? "Heme/Onc safety"
      : "Immunosuppression / leukopenia";
  if (!currentlyAfebrile(text) && /\b(febrile neutropen|neutropenic fever|fever|febrile)\b/i.test(text) && (/neutropen|chemo|anc/i.test(text) || hasLowAnc)) {
    appendRedFlag(plan, "Febrile neutropenia safety signal", "Cancer/immunosuppression with fever/neutropenia requires urgent culture/Abx/isolation review.", "urgent", refs);
  } else if (hasNeutropenicFeverContext && (hasSevereWbc || hasLowAnc)) {
    appendRedFlag(
      plan,
      `Recent/resolving neutropenic fever or leukopenic infection risk${wbcText ? `, WBC ${wbcText}` : ""}${anc ? `, ANC ${anc}` : ""}`,
      "Fever may be resolved, but severe leukopenia/neutropenia keeps infection recurrence and Abx/isolation decisions clinically important.",
      "today",
      refs,
    );
  }
  if (tlsSignal) {
    appendRedFlag(plan, "Tumor lysis / onc metabolic risk", "Malignancy/chemo context with uric acid, phosphate, K or Cr signal needs explicit electrolyte/renal handoff.", "urgent", refs);
  }
  if (thrombocytopeniaSignal && /\b(bleed|anticoag|heparin|doac|warfarin|apixaban|rivaroxaban|procedure)\b/i.test(text)) {
    appendRedFlag(plan, `Thrombocytopenia with bleeding/anticoag tradeoff${plateletMin ? `, Plt ${plateletMin}` : ""}`, "Low platelets plus bleeding, procedure or anticoagulation context needs explicit risk tradeoff.", "today", refs);
  }
  appendTask(
    plan,
    tlsSignal
      ? "trend TLS labs: K/Phos/Ca/uric acid/Cr; verify hydration/rasburicase-allopurinol and heme plan"
      : thrombocytopeniaSignal
        ? "trend Plt/Hb; review bleeding, procedure and anticoag/antiplatelet plan"
        : "verify ANC/WBC recovery, fever curve, cultures/Abx need, isolation and ID/primary-team contact if immunosuppressed",
    tlsSignal || hasCancerWorkup ? "consult" : "lab",
    tlsSignal
      ? "Oncology handoff must keep TLS metabolic/renal risk visible."
      : thrombocytopeniaSignal
        ? "Thrombocytopenia handoff should keep bleeding/procedure/anticoag tradeoffs visible."
        : "Immunosuppression/leukopenia handoff must keep fever, ANC/WBC and infection-risk actions visible.",
    refs,
    tlsSignal || (hasNeutropenicFeverContext && !currentlyAfebrile(text)) ? "urgent" : "normal",
  );
  if (hasCancerWorkup) {
    appendTask(plan, "f/u pathology/staging/biopsy and thrombosis/bleeding plan if cancer workup active", "other", "Cancer workups often hinge on pending pathology/staging and anticoagulation tradeoffs.", refs, "normal");
  }
  appendAp(
    plan,
    title,
    tlsSignal
      ? `Onc metabolic risk${uricAcid ? `, UA ${uricAcid}` : ""}${phosphorus ? `, Phos ${phosphorus}` : ""}${potassium ? `, K ${potassium}` : ""}${creatinine ? `, Cr ${creatinine}` : ""}; verify TLS labs, renal trajectory, hydration/urate-lowering plan and heme input.`
      : thrombocytopeniaSignal
        ? `Thrombocytopenia${plateletMin ? `, Plt ${plateletMin}` : ""}; verify bleeding/procedure/anticoag tradeoff and platelet trend.`
        : hasCancerWorkup
      ? "Heme/onc safety context; verify fever/ANC or immunosuppression risk, pathology/staging status, and thrombosis/bleeding tradeoff."
      : `Immunosuppressed or leukopenic host${wbcText ? `, WBC ${wbcText}` : ""}${anc ? `, ANC ${anc}` : ""}; verify fever status, ANC/WBC recovery, infection source and Abx/isolation threshold.`,
    [...plan.facts.immunocompromisedSignals, ...plan.facts.pendingItems],
    tlsSignal
      ? ["trend K/Phos/Ca/UA/Cr", "verify hydration/urate-lowering plan", "review renal/I/O status", "contact heme/onc if worsening"]
      : thrombocytopeniaSignal
        ? ["trend Plt/Hb", "check bleeding/procedure plan", "review anticoag/antiplatelet hold-resume", "clarify transfusion threshold if needed"]
        : hasCancerWorkup
      ? ["verify ANC/fever and isolation status", "f/u cultures/Abx/onc-ID plan if febrile", "f/u pathology/staging", "review VTE/bleeding tradeoff"]
      : ["verify ANC/WBC recovery and fever curve", "clarify infection source and culture need", "review Abx/isolation threshold", "contact ID/primary team if unstable or febrile"],
    refs,
  );
}

function makeEmptyPlan(facts: ClinicalFactBundle): GeneratedClinicalPlan {
  return {
    facts,
    ruleMatches: matchKnowledgePacks(facts),
    redFlags: [],
    todayTasks: [],
    problemBasedAP: [],
    handoffWarnings: [],
    printSummary: "",
    sbarRecommendation: "",
    needsReview: false,
  };
}

function looksLikeDispositionLine(line: string) {
  if (/\b(dispo|disposition|dc\b|discharge\s+(?:plan|planning|home|to|target|barrier|med|summary)|home|transfer|snf|rehab|opd|follow-up)\b/i.test(line)) {
    return true;
  }
  return !/\b(?:ear|wound|skin|nasal|purulent|bloody)?\s*discharge\s+for\s+\d/i.test(line);
}

function normalizedClinicalKey(value: string) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function mergeSourceRefs(...groups: ClinicalSourceRef[][]) {
  const seen = new Set<string>();
  const merged: ClinicalSourceRef[] = [];
  groups.flat().forEach((ref) => {
    if (seen.has(ref.id)) return;
    seen.add(ref.id);
    merged.push(ref);
  });
  return merged.length > 0 ? merged : [sourceRefs.localInpatient];
}

function dedupeRedFlags(flags: GeneratedClinicalPlan["redFlags"]) {
  const merged = new Map<string, GeneratedClinicalPlan["redFlags"][number]>();
  flags.forEach((flag) => {
    const key = normalizedClinicalKey(`${flag.text}|${flag.reason}`);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, flag);
      return;
    }
    merged.set(key, {
      ...existing,
      severity: existing.severity === "urgent" || flag.severity === "urgent" ? "urgent" : existing.severity,
      sourceRefs: mergeSourceRefs(existing.sourceRefs, flag.sourceRefs),
    });
  });
  return Array.from(merged.values());
}

function dedupeTodayTasks(tasks: GeneratedClinicalPlan["todayTasks"]) {
  const merged = new Map<string, GeneratedClinicalPlan["todayTasks"][number]>();
  tasks.forEach((task) => {
    const key = normalizedClinicalKey(`${task.priority}|${task.category}|${task.text}|${task.reason}`);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, task);
      return;
    }
    merged.set(key, {
      ...existing,
      priority: existing.priority === "urgent" || task.priority === "urgent" ? "urgent" : existing.priority,
      sourceRefs: mergeSourceRefs(existing.sourceRefs, task.sourceRefs),
    });
  });
  return Array.from(merged.values());
}

function finalizePlan(plan: GeneratedClinicalPlan) {
  plan.facts.dischargeDisposition = plan.facts.dischargeDisposition.filter(looksLikeDispositionLine);
  plan.redFlags = dedupeRedFlags(plan.redFlags);
  plan.todayTasks = dedupeTodayTasks(plan.todayTasks);
  plan.problemBasedAP = plan.problemBasedAP
    .filter((item) => item.problemTitle.trim())
    .filter((item, index, items) => items.findIndex((next) => next.problemTitle.toLowerCase() === item.problemTitle.toLowerCase()) === index)
    .sort((left, right) => problemPriorityScore(right.problemTitle, right.assessmentSummary) - problemPriorityScore(left.problemTitle, left.assessmentSummary))
    .slice(0, 8);
  const summaryBits = dedupe([
    ...plan.ruleMatches.map((match) => match.title),
    ...plan.redFlags.map((flag) => flag.text),
    ...plan.todayTasks.map((task) => task.text),
    ...plan.facts.dischargeDisposition,
  ]).slice(0, 8);
  plan.printSummary = removeGenericFiller(summaryBits).join("; ");
  plan.sbarRecommendation = dedupe([
    ...plan.todayTasks.map((task) => `${task.priority === "urgent" ? "Urgent: " : ""}${task.text}`),
    ...plan.redFlags.map((flag) => `Call/verify: ${flag.text}`),
    ...compactDispositionFacts(plan.facts.dischargeDisposition, 3, 120).map((line) => `Disposition: ${line}`),
  ]).slice(0, 8).join("; ");
  plan.handoffWarnings = plan.redFlags.map((flag) => flag.text);
  plan.needsReview = plan.ruleMatches.some((match) => match.needsReview) || plan.facts.uncertainty.length > 0;
  return plan;
}

function problemPriorityScore(title: string, assessment: string) {
  const text = `${title} ${assessment}`.toLowerCase();
  if (/neutropenic|febrile neutropen|leukopen|anc|immunosupp/.test(text)) return 90;
  if (/sepsis|shock|hypotension|lactate|tumor lysis|\btls\b/.test(text)) return 85;
  if (/bleed|hb\s*(?:<|nadir)?\s*[0-7]|respiratory failure|hypox|pe\/vte|pulmonary embol|stroke|ich|acs|rvr|hyperk|severe na|dka|hhs/.test(text)) return 80;
  if (/infection|pna|copd|asthma|oxygen|aki|renal|hyponat|hypernat|thrombocytopenia|ramsay|zoster|ear infection/.test(text)) return 70;
  return 50;
}

export function applyClinicalKnowledgeToFacts(facts: ClinicalFactBundle): GeneratedClinicalPlan {
  if (stableVitalsOnly(facts.sourceText)) {
    return finalizePlan({
      facts,
      ruleMatches: [],
      redFlags: [],
      todayTasks: [],
      problemBasedAP: [],
      handoffWarnings: [],
      printSummary: "",
      sbarRecommendation: "",
      needsReview: false,
    });
  }

  const plan = makeEmptyPlan(facts);
  const text = corpusFromFacts(facts);
  applyNeuroRules(plan, text);
  applyInfectionRules(plan, text);
  applyCardioRules(plan, text);
  applyRenalRules(plan, text);
  applyPulmRules(plan, text);
  applyGiRules(plan, text);
  applyEndocrineRules(plan, text);
  applyHemeOncRules(plan, text);
  return finalizePlan(plan);
}

export function applyClinicalKnowledgeToText(sourceText: string, context?: RuleContext) {
  return applyClinicalKnowledgeToFacts(buildClinicalFactBundle(sourceText, context));
}

function draftToText(draft: AiSoapDraft, rawText: string) {
  return [
    rawText,
    draft.oneLiner,
    draft.admissionSummary,
    draft.isbarHandoff,
    draft.subjective.chiefConcern,
    ...draft.subjective.symptoms,
    ...draft.subjective.importantSymptoms,
    ...draft.subjective.overnightEvents,
    ...draft.subjective.importantOvernightEvents,
    ...draft.objective.vitals.map((item) => `${item.name} ${item.value} ${item.interpretation}`),
    ...draft.objective.bloodSugars.map((item) => `${item.name} ${item.value} ${item.interpretation}`),
    ...draft.objective.labs.map((item) => `${item.name} ${item.value} ${item.unit} ${item.interpretation}`),
    ...draft.objective.images.map((item) => `${item.studyType} ${item.impression || item.finding}`),
    ...draft.assessmentPlan.map((item) => `${item.problemTitle} ${item.assessmentSummary} ${item.evidenceOrCourseItems.join(" ")} ${item.planItems.join(" ")}`),
    ...draft.tasks.map((item) => item.text),
    ...draft.redFlags.map((item) => `${item.text} ${item.reason}`),
    ...draft.dischargeIssues,
  ].filter(Boolean).join("\n");
}

export function applyClinicalKnowledgeToAiSoapDraft(draft: AiSoapDraft, rawText: string, context?: RuleContext): AiSoapDraft {
  const plan = applyClinicalKnowledgeToText(draftToText(draft, rawText), context);
  const reasoning = hasClinicalReasoning(draft.clinicalReasoning) ? draft.clinicalReasoning : undefined;
  const reasoningAp = reasoning
    ? reasoning.activeProblemsRanked
        .filter((item) => item.problem.trim() && item.status !== "resolved")
        .slice(0, 8)
        .map((item) => ({
          problemTitle: item.problem,
          assessmentSummary: item.whyImportant,
          evidenceOrCourseItems: item.evidence,
          planItems: item.todayPlan,
          isImportant: true,
        }))
    : [];
  const redFlags = [
    ...draft.redFlags.filter((item) => !isGenericFiller(item.text)),
    ...plan.redFlags.map((flag) => ({ text: flag.text, reason: `Clinical rule: ${flag.reason}` })),
  ];
  const tasks = [
    ...(reasoning
      ? reasoning.activeProblemsRanked.flatMap((item) =>
          item.todayPlan.map((text) => ({
            text,
            priority: item.callThresholds.length > 0 ? "urgent" as TaskPriority : "normal" as TaskPriority,
            dueDate: "",
            category: "other",
          })),
        )
      : []),
    ...(reasoning
      ? reasoning.missingDataNeeded.map((text) => ({
          text: `clarify ${text}`,
          priority: "normal" as TaskPriority,
          dueDate: "",
          category: "other",
        }))
      : []),
    ...draft.tasks.filter((task) => !isGenericFiller(task.text)),
    ...plan.todayTasks.map((task) => ({
      text: task.text,
      priority: task.priority,
      dueDate: "",
      category: task.category,
    })),
  ];
  const assessmentPlan = [
    ...reasoningAp,
    ...draft.assessmentPlan.filter((item) => !isGenericFiller(`${item.problemTitle} ${item.assessmentSummary}`)),
    ...plan.problemBasedAP.map((item) => ({
      problemTitle: item.problemTitle,
      assessmentSummary: item.assessmentSummary,
      evidenceOrCourseItems: item.evidenceOrCourseItems,
      planItems: item.planItems,
      isImportant: item.isImportant,
    })),
  ];
  const thinkingPrompts = [
    ...draft.thinkingPrompts,
    ...(reasoning
      ? reasoning.missingDataNeeded.slice(0, 6).map((item) => ({
          prompt: `Clarify ${item}`,
          reason: "AI clinical reasoning marked this as missing data needed for safe handoff.",
        }))
      : []),
    ...(plan.needsReview
      ? [{
          prompt: `Review rule matches: ${plan.ruleMatches.map((match) => match.title).join(", ")}`,
          reason: "Clinical Knowledge Base matched high-yield inpatient patterns; clinician confirmation required.",
        }]
      : []),
  ];
  return {
    ...draft,
    redFlags: dedupeRuleObjects(redFlags, "text"),
    tasks: dedupeRuleObjects(tasks, "text"),
    assessmentPlan: dedupeRuleObjects(assessmentPlan, "problemTitle"),
    thinkingPrompts,
    oneLiner: formatReasoningOneLiner(reasoning) || draft.oneLiner,
    admissionSummary: formatReasoningAdmissionSummary(reasoning, plan) || draft.admissionSummary || formatRuleBasedAdmissionSummary(plan),
    isbarHandoff: formatReasoningSbar(reasoning, plan) || draft.isbarHandoff || formatRuleBasedSbar(plan),
  };
}

export function applyClinicalKnowledgeToPatientImportDraft(draft: PatientImportDraft): PatientImportDraft {
  const plan = applyClinicalKnowledgeToText([
    draft.sourceExcerpt,
    draft.primaryDiagnosis,
    draft.oneLiner,
    draft.admissionSummary,
    draft.underlyingDiseases,
    draft.activeProblems,
    draft.hospitalCourseHighlights,
    draft.importantRedFlags,
    draft.tasks.map((task) => task.text).join("\n"),
    draft.dischargePlan,
    draft.disposition,
  ].join("\n"));
  return {
    ...draft,
    activeProblems: dedupe([draft.activeProblems, ...plan.problemBasedAP.map((item) => item.problemTitle)]).join("\n"),
    importantRedFlags: dedupe([draft.importantRedFlags, ...plan.redFlags.map((flag) => `!${flag.text} - Reason: ${flag.reason}`)]).join("\n"),
    tasks: dedupeRuleObjects([
      ...draft.tasks,
      ...plan.todayTasks.map((task) => ({
        text: task.text,
        priority: task.priority,
        dueDate: "",
        category: task.category,
      })),
    ], "text"),
    admissionSummary: draft.admissionSummary || formatRuleBasedAdmissionSummary(plan),
    uncertainty: dedupe([
      ...draft.uncertainty,
      ...(plan.needsReview ? [`Review rule matches: ${plan.ruleMatches.map((match) => match.title).join(", ")}`] : []),
    ]),
  };
}

function isGenericFiller(value: string) {
  return removeGenericFiller([value]).length === 0;
}

function dedupeRuleObjects<T extends Record<string, unknown>>(items: T[], key: keyof T): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = String(item[key] ?? "").toLowerCase().trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function formatRuleBasedAdmissionSummary(plan: GeneratedClinicalPlan) {
  const diagnosis = compactDocFacts([...plan.facts.diagnoses, ...plan.facts.activeProblems], 2, 120).join("; ");
  const pmh = compactDocFacts(plan.facts.pmh, 3, 90).join("; ");
  const course = compactDocFacts([...plan.facts.hospitalCourse, ...plan.facts.objectiveFacts, ...plan.facts.antibiotics], 3, 110).join("; ");
  const active = compactList(plan.problemBasedAP.map((item) => shortProblemTitle(item.problemTitle)), 4, 60).join("; ");
  const pending = compactList(
    [
      ...plan.todayTasks.map((task) => task.text),
      ...plan.facts.pendingItems,
      ...compactDispositionFacts(plan.facts.dischargeDisposition, 2, 90),
    ],
    4,
    100,
  ).join("; ");
  return [
    diagnosis ? `Admitted/managed for ${diagnosis}.` : "",
    pmh ? `PMH/context: ${pmh}.` : "",
    course ? `Key course/data: ${course}.` : "",
    active || pending ? `Active issues: ${active || "needs review"}; today/pending/dispo: ${pending || "needs review"}.` : "",
  ].filter(Boolean).join(" ");
}

function compactSnippet(value: string, maxLength = 140) {
  const compacted = value
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:bed|room|rm|dx|diagnosis|pmh|underlying|icu course|hospital course|course|today|tasks?|pending|lab|image|red flags?|disposition|vs|v\/s|pe)(?:\s*[:：-]\s*|\s+)/i, "")
    .replace(/^rule-matched\s+[^;]+;\s*/i, "")
    .replace(/\bverify\b/gi, "confirm")
    .trim();
  if (compacted.length <= maxLength) return cleanSnippetTail(compacted);
  const words = compacted.split(" ");
  const kept: string[] = [];
  words.forEach((word) => {
    const next = [...kept, word].join(" ");
    if (next.length <= maxLength) kept.push(word);
  });
  return cleanSnippetTail(kept.join(" ") || compacted.slice(0, maxLength).trim());
}

function compactList(values: string[], maxItems: number, maxLength = 140) {
  return dedupe(values.map((value) => compactSnippet(value, maxLength)).filter(Boolean)).slice(0, maxItems);
}

function cleanSnippetTail(value: string) {
  let clean = value.replace(/\s+[+,;:-]\s*$/g, "").trim();
  for (let index = 0; index < 2; index += 1) {
    clean = clean.replace(/\s+\b(?:if|and|or|with|without|w\/|for|to|from|of|the|a|an|when|as)\b\.?$/i, "").trim();
  }
  return clean;
}

function compactDocFacts(values: string[], maxItems: number, maxLength = 130) {
  return compactList(
    values.filter((value) => {
      if (/^\s*(?:bed|room|rm|tasks?|lab|image|red flags?)(?:\b|\s*[:：-])/i.test(value)) return false;
      const compacted = compactSnippet(value, maxLength);
      return compacted.length > 3 && !/^(?:icu|course|today|dx|pmh)$/i.test(compacted);
    }),
    maxItems,
    maxLength,
  );
}

function compactDispositionFacts(values: string[], maxItems: number, maxLength = 110) {
  return compactList(
    values
      .map((value) => {
        const clean = compactSnippet(value, 180);
        const match = clean.match(/\b(?:discharge|dispo|dc|rehab|snf|home|opd|follow-up)[^.;\n]*/i);
        return match?.[0] ?? clean;
      })
      .filter((value) => /\b(?:discharge|dispo|dc|rehab|snf|home|opd|follow-up)\b/i.test(value)),
    maxItems,
    maxLength,
  );
}

function planLinePriority(value: string) {
  const lower = value.toLowerCase();
  let score = 0;
  if (/gdmt|acei|arb|arni|beta|bb|sglt2|mra/.test(lower)) score += 40;
  if (/culture|abx|antibiotic|source/.test(lower)) score += 32;
  if (/cr\/k|renal|i\/o|hyperk|aki|na correction|osm|dialysis/.test(lower)) score += 30;
  if (/o2|spo2|oxygen|wean|hypox|aspirat|co2|bipap|niv|ctpa|rv strain|pe\b/.test(lower)) score += 28;
  if (/hb|bleed|transfusion|anticoag|antiplatelet|scope|egd|ppi|plt/.test(lower)) score += 26;
  if (/anion gap|hco3|ketone|insulin|hypogly|tls|uric|phos|rasburicase/.test(lower)) score += 24;
  if (/pending|f\/u|follow|clarify|review|confirm|trend/.test(lower)) score += 10;
  return score;
}

function prioritizePlanLines(values: string[]) {
  return [...values].sort((left, right) => planLinePriority(right) - planLinePriority(left));
}

function shortProblemTitle(value: string) {
  return value
    .replace(/^Infection\s*\/\s*sepsis$/i, "Infx/sepsis")
    .replace(/^Cardio\s*\/\s*HF\s*\/\s*rhythm$/i, "HF/rhythm")
    .replace(/^AKI\s*\/\s*electrolyte$/i, "AKI/electrolyte")
    .replace(/^AKI\s*\/\s*electrolyte\s*\/\s*Na$/i, "AKI/Na")
    .replace(/^Pulmonary\s*\/\s*O2$/i, "Pulm/O2")
    .replace(/^PNA\s*\/\s*O2$/i, "PNA/O2")
    .replace(/^Aspiration\s*\/\s*PNA$/i, "Asp PNA")
    .replace(/^COPD\/asthma exacerbation$/i, "COPD/asthma")
    .replace(/^PE concern\s*\/\s*anticoag$/i, "PE/anticoag")
    .replace(/^Bleeding\s*\/\s*anemia$/i, "Bleed/anemia")
    .replace(/^UGIB\s*\/\s*anemia$/i, "UGIB/anemia")
    .replace(/^Glucose control$/i, "Glu")
    .replace(/^DKA\/HHS\s*\/\s*glucose$/i, "DKA/HHS")
    .replace(/^Hypoglycemia$/i, "HypoGlu")
    .replace(/^TLS\s*\/\s*onc safety$/i, "TLS")
    .replace(/^Heme\/Onc safety$/i, "Heme/Onc")
    .replace(/^Stroke\s*\/\s*neuro deficit$/i, "Neuro")
    .replace(/^Neutropenic fever\s*\/\s*leukopenia$/i, "NF/leukopenia");
}

function compactAssessmentPhrase(item: GeneratedClinicalPlan["problemBasedAP"][number]) {
  const title = item.problemTitle;
  const summary = item.assessmentSummary;
  if (/infection|sepsis/i.test(title)) return "source/Cx/Abx, fever/lactate/hemodyn.";
  if (/cardio|hf|rhythm/i.test(title)) {
    return /gdmt/i.test(summary) ? "volume/rhythm; Cr/K + HFrEF GDMT readiness." : "volume/O2, rhythm/ischemia, diuresis + Cr/K.";
  }
  if (/aki|electrolyte/i.test(title)) {
    const cr = summary.match(/\bCr up to [0-9.]+/i)?.[0] ?? "";
    const k = summary.match(/\bK up to [0-9.]+/i)?.[0] ?? "";
    const na = summary.match(/\bNa (?:low|high) [0-9.]+/i)?.[0] ?? "";
    return `${[cr, k, na].filter(Boolean).join(", ") || "renal trend"}; I/O + med/contrast safety.`;
  }
  if (/pe concern/i.test(title)) return "CTPA/VQ, RV strain, O2/hemodyn + anticoag/bleed risk.";
  if (/copd|asthma/i.test(title)) return "O2/CO2, bronchodilator/steroid response, NIV threshold.";
  if (/pulmonary|o2|pna|aspiration/i.test(title)) return "O2 need, image/Cx, Abx response/weaning.";
  if (/bleed|anemia|ugib/i.test(title)) return "Hb/V/S; transfusion/scope/PPI + antithrombotic plan.";
  if (/dka|hhs/i.test(title)) return "Glu/AG/HCO3/K, insulin/IVF and transition readiness.";
  if (/glucose|hypogly/i.test(title)) return "Glu trend, insulin/nutrition, BMP/K if unstable.";
  if (/tls/i.test(title)) return "TLS labs K/Phos/Ca/UA/Cr, renal/I/O + heme plan.";
  if (/thrombocytopenia/i.test(title)) return "Plt/Hb trend, bleeding/procedure/anticoag tradeoff.";
  return compactSnippet(summary, 120);
}

function mergeSituationParts(parts: string[]) {
  const kept: string[] = [];
  parts.map((part) => compactSnippet(part, 140)).filter(Boolean).forEach((part) => {
    const lower = part.toLowerCase();
    if (kept.some((existing) => existing.toLowerCase().includes(lower))) return;
    const containedIndex = kept.findIndex((existing) => lower.includes(existing.toLowerCase()));
    if (containedIndex >= 0) {
      kept.splice(containedIndex, 1, part);
      return;
    }
    kept.push(part);
  });
  return kept.slice(0, 2).join("; ");
}

export function hasClinicalReasoning(reasoning: ClinicalReasoningBundle | undefined): reasoning is ClinicalReasoningBundle {
  return Boolean(
    reasoning &&
      (reasoning.primaryRisk.trim() ||
        reasoning.currentClinicalState.trim() ||
        reasoning.activeProblemsRanked.some((item) => item.problem.trim())),
  );
}

function formatReasoningOneLiner(reasoning: ClinicalReasoningBundle | undefined) {
  if (!hasClinicalReasoning(reasoning)) return "";
  const lead = reasoning.primaryRisk || reasoning.currentClinicalState;
  const topProblems = reasoning.activeProblemsRanked
    .filter((item) => item.problem.trim() && item.status !== "resolved")
    .slice(0, 2)
    .map((item) => item.problem);
  return compactList([lead, ...topProblems], 3, 90).join("; ");
}

export function formatReasoningAdmissionSummary(
  reasoning: ClinicalReasoningBundle | undefined,
  fallbackPlan?: GeneratedClinicalPlan,
) {
  if (!hasClinicalReasoning(reasoning)) return "";
  const topProblems = reasoning.activeProblemsRanked.filter((item) => item.status !== "resolved").slice(0, 4);
  const evidence = compactList(reasoning.whyThisMatters.map((item) => `${item.fact} -> ${item.implication}`), 3, 110);
  const tasks = compactList(
    [
      ...topProblems.flatMap((item) => item.todayPlan),
      ...reasoning.missingDataNeeded.map((item) => `clarify ${item}`),
      ...(fallbackPlan?.todayTasks.map((task) => task.text) ?? []),
    ],
    4,
    110,
  );
  return [
    `${compactSnippet(reasoning.primaryRisk || reasoning.currentClinicalState, 150)}.`,
    topProblems.length > 0 ? `Active: ${topProblems.map((item) => compactSnippet(item.problem, 45)).join("; ")}.` : "",
    evidence.length > 0 ? `Basis: ${evidence.join("; ")}.` : "",
    tasks.length > 0 ? `Today/pending: ${tasks.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

export function formatReasoningSbar(reasoning: ClinicalReasoningBundle | undefined, fallbackPlan?: GeneratedClinicalPlan) {
  if (!hasClinicalReasoning(reasoning)) return "";
  const activeProblems = reasoning.activeProblemsRanked.filter((item) => item.status !== "resolved").slice(0, 5);
  const background = compactList(
    [
      reasoning.currentClinicalState,
      ...reasoning.whyThisMatters.map((item) => `${item.fact} (${item.implication})`),
      ...(fallbackPlan?.facts.pmh ?? []),
    ],
    4,
    140,
  ).join("; ");
  const assessment = activeProblems.length > 0
    ? activeProblems
        .map((item) => {
          const evidence = compactList(item.evidence, 1, 80);
          return `- ${compactSnippet(item.problem, 55)} (${item.status}): ${compactSnippet(item.whyImportant, 100)}${evidence.length ? ` [${evidence.join("; ")}]` : ""}`;
        })
        .join("\n")
    : "- Assessment needs clinician review.";
  const recommendations = compactList(
    [
      ...activeProblems.flatMap((item) => item.todayPlan.map((plan) => `${item.problem}: ${plan}`)),
      ...activeProblems.flatMap((item) => item.callThresholds.map((threshold) => `Call/threshold: ${threshold}`)),
      ...reasoning.missingDataNeeded.map((item) => `Clarify: ${item}`),
      ...(fallbackPlan?.todayTasks.map((task) => task.text) ?? []),
    ],
    8,
    150,
  );
  return [
    `Situation: ${compactSnippet(reasoning.primaryRisk || reasoning.currentClinicalState, 180)}`,
    `Background: ${background || "Background not fully extracted."}`,
    "Assessment:",
    assessment,
    "Recommendation:",
    ...(recommendations.length > 0 ? recommendations.map((item) => `- ${item}`) : ["- Clarify today's tasks and call thresholds."]),
  ].join("\n");
}

export function formatReasoningWeeklySummary(reasoning: ClinicalReasoningBundle | undefined, fallbackPlan?: GeneratedClinicalPlan) {
  if (!hasClinicalReasoning(reasoning)) return "";
  const activeProblems = reasoning.activeProblemsRanked.filter((item) => item.status !== "resolved").slice(0, 5);
  const course = compactList(
    [
      reasoning.currentClinicalState,
      ...reasoning.whyThisMatters.map((item) => `${item.fact} -> ${item.implication}`),
      ...(fallbackPlan?.facts.hospitalCourse ?? []),
      ...(fallbackPlan?.facts.todayUpdates ?? []),
    ],
    4,
    120,
  );
  const apLines = activeProblems.map((item) => {
    const evidence = compactList(item.evidence, 1, 70);
    const plans = compactList(prioritizePlanLines(item.todayPlan), 2, 80);
    return [
      `- ${compactSnippet(item.problem, 60)} (${item.status}): ${compactSnippet(item.whyImportant, 105)}`,
      evidence.length > 0 ? `  Data: ${evidence.join("; ")}` : "",
      plans.length > 0 ? `  Plan: ${plans.join("; ")}` : "",
    ].filter(Boolean).join("\n");
  });
  const pending = compactList(
    [
      ...activeProblems.flatMap((item) => item.todayPlan),
      ...activeProblems.flatMap((item) => item.callThresholds.map((threshold) => `Call/threshold: ${threshold}`)),
      ...reasoning.missingDataNeeded.map((item) => `Clarify: ${item}`),
      ...compactDispositionFacts(fallbackPlan?.facts.dischargeDisposition ?? [], 2, 100),
    ],
    6,
    110,
  );
  return [
    "Weekly Summary",
    `Current focus: ${compactSnippet(reasoning.primaryRisk || reasoning.currentClinicalState, 180)}.`,
    "",
    "Timeline / Key Course",
    ...(course.length > 0 ? course.map((line) => `- ${line}`) : ["- Course not fully extracted; review source notes."]),
    "",
    "Problem-Based A/P",
    ...(apLines.length > 0 ? apLines : ["- No confident problem-based reasoning output; review source notes."]),
    "",
    "Pending / Disposition",
    ...(pending.length > 0 ? pending.map((line) => `- ${line}`) : ["- Clarify pending studies, tasks, call thresholds, and disposition."]),
    reasoning.resolvedOrLessImportant.length > 0 ? "" : "",
    reasoning.resolvedOrLessImportant.length > 0 ? "Resolved / Lower Priority" : "",
    ...reasoning.resolvedOrLessImportant.slice(0, 5).map((line) => `- ${compactSnippet(line, 140)}`),
  ].filter((line, index, array) => line.trim() || array[index - 1]?.trim()).join("\n");
}

function handoffLead(plan: GeneratedClinicalPlan) {
  const text = corpusFromFacts(plan.facts);
  const { wbc, anc, hasLowWbc, hasSevereWbc, hasLowAnc } = leukopeniaContext(text);
  const displayWbc = preferredDisplayWbc(text);
  const hasHemeSignal = hasMatch(plan.ruleMatches, "heme-onc-safety") || plan.problemBasedAP.some((item) => /neutropenic|leukopenia|immunosuppression/i.test(item.problemTitle));
  const neutropenicFeverTerm = /\b(neutropenic fever|febrile neutropen)\b/i.test(text);
  if ((neutropenicFeverTerm || ((hasSevereWbc || hasLowAnc || hasLowWbc) && hasHemeSignal && feverOrInfectionContext(text)))) {
    const lab = [displayWbc !== null ? `WBC ${formatWbc(displayWbc)}` : "", anc !== null ? `ANC ${anc}` : ""].filter(Boolean).join(", ");
    const fever = currentlyAfebrile(text) ? "fever currently resolved/afebrile" : "fever status needs confirmation";
    return `Recent/resolving neutropenic fever or leukopenic infection risk${lab ? ` (${lab}; ${fever})` : ` (${fever})`}`;
  }

  const redFlag = plan.redFlags[0]?.text;
  if (redFlag) return redFlag;
  return "";
}

function formatProblemAssessment(plan: GeneratedClinicalPlan) {
  const problemLines = plan.problemBasedAP.slice(0, 5).map((item) => {
    return `- ${shortProblemTitle(item.problemTitle)}: ${compactAssessmentPhrase(item)}`;
  });
  const flagLines = plan.redFlags.slice(0, 2).map((flag) => `- * ${compactSnippet(flag.text, 100)}`);
  return [...problemLines, ...flagLines].join("\n") || "- Assessment needs clinician review.";
}

function formatProblemRecommendations(plan: GeneratedClinicalPlan) {
  const taskLines = plan.todayTasks.slice(0, 5).map((task) => {
    const prefix = task.priority === "urgent" ? "Urgent" : "Today";
    return `- ${prefix}: ${compactSnippet(task.text, 150)}`;
  });
  const flagLines = plan.redFlags.slice(0, 2).map((flag) => `- Call/verify: ${compactSnippet(flag.text, 120)}`);
  const dispoLines = compactDispositionFacts(
    plan.facts.dischargeDisposition.filter((line) => /\b(dispo|discharge|rehab|snf|home)\b/i.test(line)),
    2,
    120,
  ).map((line) => `- Disposition: ${line}`);
  return dedupe([...taskLines, ...flagLines, ...dispoLines]).join("\n") || "- Clarify today's tasks and call thresholds.";
}

export function formatRuleBasedSbar(plan: GeneratedClinicalPlan) {
  const riskLead = handoffLead(plan);
  const problemLead = compactList(plan.problemBasedAP.map((item) => shortProblemTitle(item.problemTitle)), 4, 70).join("; ");
  const lead = mergeSituationParts([riskLead, problemLead]);
  const situation = compactSnippet(
    lead ||
      compactList([...plan.facts.diagnoses, ...plan.facts.activeProblems], 1, 120)[0] ||
      plan.ruleMatches.map((match) => match.title).join(", ") ||
      "Needs clinical review",
    180,
  );
  const backgroundFacts = compactDocFacts([...plan.facts.pmh, ...plan.facts.hospitalCourse], 3, 120);
  const background = backgroundFacts.join("; ") || "Background not fully extracted.";
  const assessment = formatProblemAssessment(plan);
  const recommendation = formatProblemRecommendations(plan);
  return [
    `Situation: ${situation}`,
    `Background: ${background}`,
    "Assessment:",
    assessment,
    "Recommendation:",
    recommendation,
  ].join("\n");
}

export function formatRuleBasedWeeklySummary(plan: GeneratedClinicalPlan) {
  const diagnosis = compactList([handoffLead(plan), ...plan.problemBasedAP.map((item) => shortProblemTitle(item.problemTitle))], 4, 90).join("; ");
  const course = compactDocFacts([...plan.facts.hospitalCourse, ...plan.facts.todayUpdates, ...plan.facts.antibiotics], 5, 120);
  const apLines = plan.problemBasedAP.slice(0, 6).map((item) => {
    const plans = compactList(prioritizePlanLines(item.planItems), 2, 80);
    return [
      `- ${shortProblemTitle(item.problemTitle)}: ${compactAssessmentPhrase(item)}`,
      plans.length > 0 ? `  Plan: ${plans.join("; ")}` : "",
    ].filter(Boolean).join("\n");
  });
  const pending = compactList(
    [
      ...plan.todayTasks.map((task) => `${task.priority === "urgent" ? "Urgent: " : ""}${task.text}`),
      ...plan.facts.pendingItems,
      ...compactDispositionFacts(plan.facts.dischargeDisposition, 2, 100),
      ...plan.redFlags.map((flag) => `Call/verify: ${flag.text}`),
    ],
    6,
    120,
  );

  return [
    "Weekly Summary",
    diagnosis ? `Current focus: ${diagnosis}.` : "Current focus: needs clinician review.",
    "",
    "Timeline / Key Course",
    ...(course.length > 0 ? course.map((line) => `- ${line}`) : ["- Course not fully extracted; review source notes."]),
    "",
    "Problem-Based A/P",
    ...(apLines.length > 0 ? apLines : ["- No confident problem-based rule output; review source notes."]),
    "",
    "Pending / Disposition",
    ...(pending.length > 0 ? pending.map((line) => `- ${line}`) : ["- Clarify pending studies, tasks, call thresholds, and disposition."]),
  ].join("\n").trim();
}
