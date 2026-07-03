// Clinical knowledge pack metadata and literature source references.
// Extracted from clinicalKnowledge.ts (Phase 4 refactor).
import type { ClinicalSourceRef } from "../types";

export type KnowledgeScope =
  | "neuro-stroke"
  | "infection-sepsis"
  | "cardio-hf-acs-af"
  | "renal-aki-electrolytes"
  | "pulm-o2-pna-copd-pe"
  | "gi-bleed-anemia"
  | "endocrine-glucose-dka-hhs"
  | "heme-onc-safety";

export interface ClinicalKnowledgePack {
  id: KnowledgeScope;
  title: string;
  scope: string;
  triggers: RegExp[];
  mustNotMiss: string[];
  summaryHints: string[];
  sourceRefs: ClinicalSourceRef[];
}

export const LAST_REVIEWED = "2026-05-17";
export const RULE_OWNER = "IM Rounding Tracker clinical rule draft";

export const sourceRefs = {
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

