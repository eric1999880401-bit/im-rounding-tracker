// Per-domain clinical rule blocks (neuro, infection, cardio, renal, pulm, GI, endocrine, heme/onc).
// Extracted from clinicalKnowledge.ts (Phase 4 refactor). Each rule appends
// red flags, tasks, and A/P items to the generated plan when its domain signals
// are supported by the source text.
import type { GeneratedClinicalPlan } from "../types";
import { specificAntibioticPlan } from "../clinicalFieldRouter";
import { clinicalKnowledgePacks, sourceRefs } from "./references";
import {
  appendAp,
  appendRedFlag,
  appendTask,
  hasMatch,
  currentlyAfebrile,
  dedupe,
  feverOrInfectionContext,
  formatWbc,
  hasCurrentStableBloodPressure,
  hasResolvedHemodynamicShock,
  hasUnresolvedShockSignal,
  latestBloodPressure,
  latestNumberAfter,
  leukopeniaContext,
  linesMatching,
  maxBloodPressure,
  maxNumberAfter,
  minAnc,
  minNumberAfter,
  minWbc,
  preferredDisplayWbc,
} from "./ruleHelpers";

export function applyNeuroRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "neuro-stroke")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "neuro-stroke")?.sourceRefs ?? [sourceRefs.localInpatient];
  const { maxSbp, maxDbp } = maxBloodPressure(text);
  const hasIchSignal =
    /\b(ich|intracranial hemorrhage|hemorrhagic)\b/i.test(text) &&
    !/\b(?:no|without|w\/o|negative for|r\/o|rule out)\s+(?:ich|intracranial hemorrhage|hemorrhage)\b/i.test(text);
  const hasReperfusionOrIch = /\b(tpa|tnk|alteplase|thrombolysis|thrombectomy|evt)\b/i.test(text) || hasIchSignal;

  const hasAcuteNeuroWorsening =
    /\b(?:decreased consciousness|coma|seizure|new weakness|aphasia|new focal|acute neuro)\b/i.test(text) ||
    /\b(?:worse|worsening|progress|declin)[^.]{0,40}\b(?:weakness|aphasia|dysarthria|consciousness|focal|nihss|stroke|seizure)\b/i.test(text);
  const hasStrokeLikeContext =
    /\b(?:ais|acute ischemic stroke|subacute stroke|recent stroke|new stroke|tia|nihss|thrombectomy|evt|alteplase|tnk|thrombolysis|aphasia|hemiplegia|facial droop|new focal|neuro deficit|stroke protocol|stroke survey|brain infarct)\b/i.test(text);
  const hasObstructiveGiDysphagia =
    /\b(?:esophageal|oesophageal|hypopharyngeal|pharyngeal|obstructive|tumou?r|scc|j-?tube|feeding jejunostomy)\b[\s\S]{0,80}\bdysphagia\b|\bdysphagia\b[\s\S]{0,80}\b(?:esophageal|oesophageal|hypopharyngeal|pharyngeal|obstructive|tumou?r|scc|j-?tube|feeding jejunostomy)\b/i.test(text);
  const hasNeuroSwallowSignal =
    /\b(?:dysphagia|swallow screen|aspiration risk)\b/i.test(text) &&
    !hasObstructiveGiDysphagia &&
    /\b(?:ais|acute ischemic stroke|recent stroke|new stroke|tia|brain infarct|aphasia|dysarthria|facial droop|hemip|new focal|swallow screen)\b/i.test(text) &&
    !/\b(?:old|prior|remote)\s+(?:cva|stroke|lacunar infarct|brain infarct)\b/i.test(text);
  const hasActiveStrokeOrNeuroCare =
    hasStrokeLikeContext ||
    hasNeuroSwallowSignal ||
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

export function applyInfectionRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "infection-sepsis")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "infection-sepsis")?.sourceRefs ?? [sourceRefs.localInpatient];
  const lactate = latestNumberAfter(/\blactate\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const latestBp = latestBloodPressure(text);
  const hasRamsayEarInfection = /\b(ramsay|zoster|ear\s+swelling|ear\s+discharge|facial\s+weakness|cnvii|cn\s*vii)\b/i.test(text);
  const shockKeyword = /shock|pressor|norepi|hypotension|septic shock/i.test(text);
  const cultureSignal = /\b(?:b\/c|bcx|blood culture|sputum culture|urine culture|culture)\b/i.test(text);
  const bacteremiaSignal = /\b(bacteremia|blood culture.*positive|bcx.*positive|gram[- ](?:positive|negative)|gpc|gnb)\b/i.test(text);
  const sourceControlNeed = /\b(abscess|empyema|cholangitis|obstruct|obstruction|drain|source control|ercp|debridement)\b/i.test(text);
  const antibioticPlan = specificAntibioticPlan(text);
  const resolvedShockContext = hasResolvedHemodynamicShock(text);
  const currentHemodynamicSignal =
    !resolvedShockContext &&
    ((lactate !== null && lactate >= 4) ||
      (latestBp !== null && latestBp.sbp < 90) ||
      (lactate !== null && lactate >= 2 && latestBp !== null && latestBp.sbp <= 95));
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
      : antibioticPlan
        ? antibioticPlan
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
    hasRamsayEarInfection ? "Ramsay Hunt / ear infection" : bacteremiaSignal ? "Bacteremia / infection" : "Infection / sepsis",
    hasRamsayEarInfection
      ? "Ear/zoster infection with cranial nerve involvement; clarify antiviral/Abx duration, fever trend, hearing/eye care, and ENT/ID follow-up."
      : sourceControlNeed
        ? "Infection with source-control issue; track Cx, Abx response, fever/WBC, hemodynamics and drainage/procedure status."
        : bacteremiaSignal
          ? `Bacteremia/infx; ${antibioticPlan || "f/u Cx clearance/susceptibility, source, Abx duration/de-escalation"} and fever/WBC.`
          : `Infection concern; ${antibioticPlan || "verify source, Cx status, Abx coverage/de-escalation"}, fever/WBC and hemodynamics if unstable.`,
    [...plan.facts.objectiveFacts, ...plan.facts.antibiotics, ...plan.facts.consults],
    hasRamsayEarInfection
      ? ["confirm antiviral/Abx duration", "f/u fever curve/culture if obtained", "clarify ENT/ID follow-up", "eye care/hearing follow-up if facial palsy or hearing deficit"]
      : [
          antibioticPlan || "",
          "confirm source",
          cultureSignal || bacteremiaSignal ? "f/u cultures/susceptibility" : "f/u Cx only if obtained/indicated",
          antibioticPlan ? "" : "review Abx/de-escalation",
          sourceControlNeed ? "verify source control/procedure response" : "trend fever/WBC/lactate if relevant",
        ].filter(Boolean),
    refs,
  );
}

export function applyCardioRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "cardio-hf-acs-af")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "cardio-hf-acs-af")?.sourceRefs ?? [sourceRefs.localInpatient];
  const unresolvedShockSignal = hasUnresolvedShockSignal(text);
  const ef = minNumberAfter(/\b(?:ef|lvef)\s*[:=]?\s*(\d{1,2})\s*%?/gi, text);
  const hasHfrEf =
    /\b(hfref|heart failure with reduced ef|reduced ef|systolic hf)\b/i.test(text) ||
    (/\b(hf|heart failure|chf)\b/i.test(text) && ef !== null && ef <= 40);
  const currentBp = latestBloodPressure(text);
  const potassium = maxNumberAfter(/\bk\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const creatinine = maxNumberAfter(/\b(?:cr|creatinine)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const gdmtCaution = unresolvedShockSignal || (currentBp !== null && currentBp.sbp < 95) || (potassium !== null && potassium >= 5.5) || (creatinine !== null && creatinine >= 2.5);
  const gdmtPlan = hasHfrEf
    ? gdmtCaution
      ? "review HFrEF GDMT readiness/contraindications before DC; defer or adjust ACEi/ARB/ARNI, BB, SGLT2i, MRA if hypotension, AKI, hyperK or shock"
      : "review HFrEF GDMT before DC: ACEi/ARB/ARNI, evidence BB, SGLT2i, MRA as tolerated"
    : "";
  const highRiskCardioSignal = /chest pain|stemi|nstemi|acs|troponin.*(rise|up|elevat)|rvr|pulmonary edema|respiratory failure/i.test(text) || unresolvedShockSignal;
  const activeCardioSignal = highRiskCardioSignal || hasHfrEf || /\b(?:afib|atrial fibrillation|af\s+with\s+rvr|rapid ventricular)\b/i.test(text);
  if (!activeCardioSignal && !gdmtPlan) return;
  if (highRiskCardioSignal) {
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

export function applyRenalRules(plan: GeneratedClinicalPlan, text: string) {
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

export function applyPulmRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "pulm-o2-pna-copd-pe")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "pulm-o2-pna-copd-pe")?.sourceRefs ?? [sourceRefs.localInpatient];
  const minSpo2 = minNumberAfter(/\b(?:spo2|sat)\s*[:=]?\s*(\d{2,3})/gi, text);
  const pco2 = maxNumberAfter(/\b(?:pco2|co2)\s*[:=]?\s*(\d{2,3})/gi, text);
  const peConcern = /\b(?:pulmonary embol|ctpa|v\/q|d-dimer|ddimer|rv strain|pe concern)\b/i.test(text) && !/\b(?:no|without|negative for|r\/o negative)\s+(?:pe|pulmonary embol)/i.test(text);
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

export function applyGiRules(plan: GeneratedClinicalPlan, text: string) {
  if (!hasMatch(plan.ruleMatches, "gi-bleed-anemia")) return;
  const refs = clinicalKnowledgePacks.find((pack) => pack.id === "gi-bleed-anemia")?.sourceRefs ?? [sourceRefs.localInpatient];
  const hb = minNumberAfter(/\b(?:hb|hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const resolvedHemodynamicContext = hasResolvedHemodynamicShock(text);
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

export function applyEndocrineRules(plan: GeneratedClinicalPlan, text: string) {
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

export function applyHemeOncRules(plan: GeneratedClinicalPlan, text: string) {
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
  const ldh = maxNumberAfter(/\bldh\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  const feedingAccessSignal = /\b(j-?tube|jejunostomy|feeding tube|tube feeding|malnutrition|po intolerance|dysphagia)\b/i.test(text);
  const vteBleedRelevant = /\b(vte|pe\b|dvt|anticoag|heparin|doac|warfarin|apixaban|rivaroxaban|bleed|plt|platelet|procedure|biopsy|egd|surgery)\b/i.test(text);
  const explicitTlsContext = /\b(?:tumou?r lysis|tls concern|tls risk|rasburicase|allopurinol)\b/i.test(text);
  const tlsLabEvidence = (uricAcid !== null && uricAcid >= 8) || (phosphorus !== null && phosphorus >= 5) || (ldh !== null && ldh > 250);
  const tlsSignal =
    (explicitTlsContext && (tlsLabEvidence || /\b(?:lymphoma|leukemia|chemo|chemotherapy|bulky tumor)\b/i.test(text))) ||
    (/\b(lymphoma|leukemia|chemo|chemotherapy|bulky tumor)\b/i.test(text) &&
      (tlsLabEvidence || ((potassium !== null && potassium >= 5.5) && (creatinine !== null && creatinine >= 1.5))));
  const thrombocytopeniaSignal = (plateletMin !== null && plateletMin < 50) || /\b(thrombocytopenia|low platelet)\b/i.test(text);
  const hasNeutropenicFeverContext = /\b(neutropenic fever|febrile neutropen)\b/i.test(text) || ((hasSevereWbc || hasLowAnc) && feverOrInfectionContext(text));
  const title = tlsSignal
    ? "TLS / onc safety"
    : hasNeutropenicFeverContext
    ? "Neutropenic fever / leukopenia"
    : hasCancerWorkup
      ? "Cancer / staging-nutrition"
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
        : hasNeutropenicFeverContext || hasLowWbc || hasLowAnc
          ? "f/u CBC diff/ANC, fever curve, Cx/Abx, isolation need"
          : feedingAccessSignal
            ? "f/u staging/Onc plan and J-tube nutrition tolerance"
            : "f/u pathology/staging and Onc plan",
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
    appendTask(
      plan,
      vteBleedRelevant ? "f/u pathology/staging; review VTE/bleed risk if procedure/anticoag issue" : "f/u pathology/staging and Onc plan",
      "other",
      "Cancer workups should preserve staging, nutrition route and concrete Onc follow-up.",
      refs,
      "normal",
    );
  }
  appendAp(
    plan,
    title,
    tlsSignal
      ? `Onc metabolic risk${uricAcid ? `, UA ${uricAcid}` : ""}${phosphorus ? `, Phos ${phosphorus}` : ""}${potassium ? `, K ${potassium}` : ""}${creatinine ? `, Cr ${creatinine}` : ""}; verify TLS labs, renal trajectory, hydration/urate-lowering plan and heme input.`
      : thrombocytopeniaSignal
        ? `Thrombocytopenia${plateletMin ? `, Plt ${plateletMin}` : ""}; verify bleeding/procedure/anticoag tradeoff and platelet trend.`
        : hasCancerWorkup
      ? `Cancer/staging${feedingAccessSignal ? " with J-tube/nutrition issue" : ""}; keep Onc plan, pathology/imaging and VTE/bleed risk visible.`
      : `Immunosuppressed or leukopenic host${wbcText ? `, WBC ${wbcText}` : ""}${anc ? `, ANC ${anc}` : ""}; verify fever status, ANC/WBC recovery, infection source and Abx/isolation threshold.`,
    [...plan.facts.immunocompromisedSignals, ...plan.facts.pendingItems],
    tlsSignal
      ? ["trend K/Phos/Ca/UA/Cr", "verify hydration/urate-lowering plan", "f/u BUN/Cr + I/O, urine output", "contact heme/onc if worsening"]
      : thrombocytopeniaSignal
        ? ["trend Plt/Hb", "check bleeding/procedure plan", "review anticoag/antiplatelet hold-resume", "clarify transfusion threshold if needed"]
      : hasCancerWorkup
      ? [
          feedingAccessSignal ? "f/u J-tube/nutrition tolerance" : "f/u pathology/staging",
          "Onc follow-up",
          vteBleedRelevant ? "review VTE/bleed risk if procedure/anticoag issue" : "",
        ].filter(Boolean)
      : ["f/u ANC/WBC + fever curve", "clarify infection source/Cx", "review Abx/isolation threshold"],
    refs,
  );
}

