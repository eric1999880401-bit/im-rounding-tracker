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
import { specificAntibioticPlan } from "./clinicalFieldRouter";
import { compactMedicalAbbreviations } from "./medicalAbbreviations";
import { removeGenericFiller } from "./aiPostprocess/genericFiller";
import { looksLikeStructuredAdmissionBrief } from "./clinicalTextFormat";

import { clinicalKnowledgePacks, sourceRefs } from "./clinicalRules/references";
import {
  cleanText,
  currentlyAfebrile,
  dedupe,
  feverOrInfectionContext,
  formatWbc,
  hasMatch,
  hasUnresolvedShockSignal,
  leukopeniaContext,
  maxBloodPressure,
  maxNumberAfter,
  minNumberAfter,
  preferredDisplayWbc,
  hasCurrentStableBloodPressure,
  hasResolvedHemodynamicShock,
  lineText,
  linesMatching,
  splitLines,
} from "./clinicalRules/ruleHelpers";
import {
  applyCardioRules,
  applyEndocrineRules,
  applyGiRules,
  applyHemeOncRules,
  applyInfectionRules,
  applyNeuroRules,
  applyPulmRules,
  applyRenalRules,
} from "./clinicalRules/domainRules";

export { clinicalKnowledgePacks } from "./clinicalRules/references";

interface RuleContext {
  pmh?: string[];
  activeProblems?: string[];
  today?: string;
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
  facts.antibiotics = dedupe(linesMatching(lines, /\b(abx|antibiotic|cef|pip\/tazo|tazocin|zosyn|vanco|vancomycin|teicoplanin|mero|meropenem|imipenem|ertapenem|levo|azithro|ampicillin|sulbactam|metronidazole|linezolid|daptomycin)\b/i, 16));
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
    admissionSummary: looksLikeStructuredAdmissionBrief(draft.admissionSummary)
      ? draft.admissionSummary
      : formatReasoningAdmissionSummary(reasoning, plan, { length: "threeMinute" }) || draft.admissionSummary || formatRuleBasedAdmissionSummary(plan, { length: "threeMinute" }),
    isbarHandoff: formatReasoningSbar(reasoning, plan) || draft.isbarHandoff || formatRuleBasedSbar(plan),
  };
}

function importProblemPieces(value: string) {
  return value
    .replace(/\b(Bacteremia \/ infection|Infection \/ sepsis|Cancer \/ staging-nutrition|Heme\/Onc safety|Stroke \/ neuro deficit|UGIB \/ anemia|Bleeding \/ anemia|Cardio \/ HF \/ rhythm|Hypovolemia\/shock syncope|Malnutrition\/PO intolerance with J-tube feeding)\b/gi, "\n$1\n")
    .split(/\r?\n|;/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function hasActiveImportNeuroSignal(text: string) {
  if (/\b(?:no|without|w\/o|negative for|r\/o|rule out)\s+(?:ich|intracranial hemorrhage|hemorrhage)\b/i.test(text)) return false;
  return /\b(?:ais|acute ischemic stroke|recent stroke|new stroke|tia|nihss|aphasia|hemiplegia|facial droop|new focal|acute neuro|neuro worsening|brain infarct)\b/i.test(text);
}

function hasActionableImportBleedingSignal(text: string) {
  const hb = minNumberAfter(/\b(?:hb|hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, text);
  return /\b(active bleed|gi bleed|melena|hematemesis|hematochezia|transfusion|endoscopy|egd|colonoscopy|brbpr|rectal bleeding)\b/i.test(text) || (hb !== null && hb < 8);
}

function hasActiveImportCardioSignal(text: string) {
  return hasUnresolvedShockSignal(text) || /\b(chest pain|stemi|nstemi|acs|troponin.*(?:rise|up|elevat)|rvr|pulmonary edema|respiratory failure|hfref|heart failure|afib|atrial fibrillation)\b/i.test(text);
}

function normalizeImportProblemLine(line: string, sourceText: string) {
  const lower = line.toLowerCase();
  const hasBacteremia = /\b(bacteremia|blood culture|b\/c|bcx|mrsa|enterococcus|s\.?\s*haemolyticus)\b/i.test(sourceText);
  const hasCancer = /\b(scc|cancer|carcinoma|tumou?r|malign|metasta|oncology|chemo)\b/i.test(sourceText);
  const hasTubeNutrition = /\b(j-?tube|jejunostomy|tube feeding|malnutrition|po intolerance|dysphagia)\b/i.test(sourceText);
  const hb = minNumberAfter(/\b(?:hb|hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, sourceText);

  if (/infection|bacteremia|sepsis/.test(lower)) {
    if (hasBacteremia && /mrsa/i.test(sourceText) && /enterococcus/i.test(sourceText)) return "MRSA/Enterococcus bacteremia";
    if (hasBacteremia) return "Bacteremia / infection";
    return "Infection";
  }
  if (/heme\/onc|cancer|staging|onc safety/.test(lower)) {
    if (!hasCancer) return "";
    return hasTubeNutrition ? "SCC with J-tube nutrition/malnutrition" : "Cancer staging / Onc plan";
  }
  if (/stroke|neuro deficit/.test(lower)) return hasActiveImportNeuroSignal(sourceText) ? "Stroke / neuro deficit" : "";
  if (/ugib|bleeding|anemia/.test(lower)) {
    if (hasActionableImportBleedingSignal(sourceText)) return "Bleeding / anemia";
    return hb !== null && hb < 11 ? "Anemia" : "";
  }
  if (/cardio|hf|rhythm/.test(lower)) return hasActiveImportCardioSignal(sourceText) ? "Cardio / HF / rhythm" : "";
  if (/hypovolemia|shock|syncope/.test(lower)) return hasUnresolvedShockSignal(sourceText) ? "Shock / hypotension" : "";
  if (/malnutrition|po intolerance|j-?tube|feeding/.test(lower)) return "J-tube nutrition / malnutrition";
  return compactSnippet(line, 90);
}

function compactImportActiveProblems(draft: PatientImportDraft, plan: GeneratedClinicalPlan, sourceText: string) {
  return compactList(
    [
      ...importProblemPieces(draft.activeProblems),
      ...plan.problemBasedAP.map((item) => item.problemTitle),
    ]
      .map((line) => normalizeImportProblemLine(line, sourceText))
      .filter(Boolean),
    5,
    90,
  ).join("\n");
}

function suppressImportRuleLine(line: string, sourceText: string) {
  const lower = line.toLowerCase();
  const { hasLowWbc, hasLowAnc } = leukopeniaContext(sourceText);
  if (/possible sepsis|shock physiology|hypotension/.test(lower) && hasResolvedHemodynamicShock(sourceText)) return true;
  if (/high-risk cardiac|acs|troponin|rvr|pulmonary edema/.test(lower) && !hasActiveImportCardioSignal(sourceText)) return true;
  if (/active bleeding|severe anemia|transfusion|scope/.test(lower) && !hasActionableImportBleedingSignal(sourceText)) return true;
  if (/febrile neutropenia|anc|isolation/.test(lower) && !(hasLowWbc || hasLowAnc)) return true;
  if (/neuro|stroke|swallow|antithrombotic|statin/.test(lower) && !hasActiveImportNeuroSignal(sourceText)) return true;
  return false;
}

function compactImportRedFlags(draft: PatientImportDraft, plan: GeneratedClinicalPlan, sourceText: string) {
  const draftLines = draft.importantRedFlags
    .split(/\r?\n|;/)
    .map((line) => cleanText(line).replace(/^!+/, "").replace(/\s+-\s*Reason:\s*.*$/i, ""))
    .filter((line) => line && !suppressImportRuleLine(line, sourceText));
  const ruleLines = plan.redFlags
    .map((flag) => flag.text)
    .filter((line) => line && !suppressImportRuleLine(line, sourceText));
  return compactList([...draftLines, ...ruleLines], 3, 180).join("\n");
}

function compactImportTasks(draft: PatientImportDraft, plan: GeneratedClinicalPlan, sourceText: string) {
  return dedupeRuleObjects([
    ...draft.tasks.filter((task) => !suppressImportRuleLine(task.text, sourceText)),
    ...plan.todayTasks
      .filter((task) => !suppressImportRuleLine(task.text, sourceText))
      .map((task) => ({
        text: task.text,
        priority: task.priority,
        dueDate: "",
        category: task.category,
      })),
  ], "text").slice(0, 8);
}

export function applyClinicalKnowledgeToPatientImportDraft(
  draft: PatientImportDraft,
  options: { targetUpdate?: boolean } = {},
): PatientImportDraft {
  const sourceText = [
    draft.sourceExcerpt,
    draft.primaryDiagnosis,
    draft.oneLiner,
    draft.admissionSummary,
    draft.underlyingDiseases,
    draft.todayUpdates,
    draft.vitalSigns,
    draft.physicalExam,
    draft.labText,
    draft.imageText,
    draft.hospitalCourseHighlights,
    draft.dischargePlan,
    draft.disposition,
  ].join("\n");
  const plan = applyClinicalKnowledgeToText(sourceText);
  return {
    ...draft,
    activeProblems: compactImportActiveProblems(draft, plan, sourceText),
    importantRedFlags: compactImportRedFlags(draft, plan, sourceText),
    tasks: compactImportTasks(draft, plan, sourceText),
    admissionSummary: options.targetUpdate ? draft.admissionSummary : draft.admissionSummary || formatRuleBasedAdmissionSummary(plan, { length: "threeMinute" }),
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

type AdmissionBriefLength = "oneMinute" | "threeMinute";

interface AdmissionBriefOptions {
  length?: AdmissionBriefLength;
}

const zhComma = "\uff0c";
const zhSemicolon = "\uff1b";
const zhPeriod = "\u3002";
const admissionBriefZh = {
  because: "\u56e0",
  admitted: "\u4f4f\u9662",
  background: "\u80cc\u666f",
  arrivalOrTransfer: "\u5230\u9662/\u8f49\u5165\u6642",
  through: "\u7d93",
  after: "\u5f8c",
  inHospital: "\u4f4f\u9662\u4e2d",
  nowFocus: "\u76ee\u524d\u91cd\u9ede",
  problems: "\u554f\u984c",
  evidence: "\u4f9d\u64da",
  keyObjective: "\u95dc\u9375O",
  todayPending: "\u4eca\u65e5\u5f85",
};

function admissionBriefLimits(options: AdmissionBriefOptions = {}) {
  const expanded = options.length === "threeMinute";
  return {
    maxSentences: expanded ? 8 : 5,
    diagnosisItems: expanded ? 2 : 1,
    pmhItems: expanded ? 2 : 1,
    severityItems: expanded ? 3 : 2,
    courseItems: expanded ? 4 : 2,
    responseItems: expanded ? 2 : 1,
    objectiveItems: expanded ? 4 : 3,
    activeItems: expanded ? 5 : 3,
    pendingItems: expanded ? 5 : 3,
    factLength: expanded ? 118 : 88,
  };
}

function admissionWhoFragment(sourceText: string) {
  const text = sourceText.replace(/\s+/g, " ");
  const compact = text.match(/\b(\d{1,3})\s*([MF])\b/i);
  if (compact) return `${compact[1]}${compact[2].toUpperCase()}`;
  const verbose = text.match(/\b(\d{1,3})[- ]?(?:year[- ]?old|yo|y\/o)\s*(male|female|man|woman|M|F)\b/i);
  if (!verbose) return "";
  const sex = /^(?:f|woman)/i.test(verbose[2]) ? "F" : "M";
  return `${verbose[1]}${sex}`;
}

function admissionSummaryFactsByPattern(values: string[], pattern: RegExp, maxItems: number, maxLength = 90) {
  return compactList(
    admissionFactFragments(values).filter((value) => pattern.test(value) && !/^\s*new admission\b/i.test(value)),
    maxItems,
    maxLength,
  ).map(abbreviateAdmissionSummaryText);
}

function admissionReasonBrief(value: string) {
  return value
    .split(/,\s*(?=(?:BP|HR|RR|SpO2|O2|NC|RA|lactate|WBC|Hb|Plt|Cr|K|Na)\b)/i)[0]
    .trim();
}

function admissionProblemBrief(item: GeneratedClinicalPlan["problemBasedAP"][number], expanded: boolean) {
  const title = shortProblemTitle(item.problemTitle);
  if (!expanded) return title;
  return `${title}: ${compactAssessmentPhrase(item)}`;
}

function admissionObjectiveAnchors(plan: GeneratedClinicalPlan, maxItems: number, maxLength: number) {
  return admissionSummaryFactsByPattern(
    [
      ...plan.facts.objectiveFacts,
      ...plan.facts.antibiotics,
      ...plan.facts.procedures,
      ...plan.facts.consults,
      ...plan.facts.pendingItems,
    ],
    /\b(?:v\/s|bp|hr|rr|spo2|o2|nc|ra|fio2|wbc|anc|hb|hgb|plt|cr|bun|egfr|na|k\b|mg|ca|phos|lactate|crp|pct|inr|pt|ast|alt|t-?bil|alp|ggt|alb|troponin|bnp|culture|b\/c|bcx|u\/c|ucx|sputum|cxr|ct|mri|echo|ecg|ercp|egd|scope)\b/i,
    maxItems,
    maxLength,
  );
}

export function formatRuleBasedAdmissionSummary(plan: GeneratedClinicalPlan, options: AdmissionBriefOptions = {}) {
  const limits = admissionBriefLimits(options);
  const who = admissionWhoFragment(plan.facts.sourceText);
  const diagnosis = admissionSummaryFacts([...plan.facts.diagnoses, ...plan.facts.activeProblems], limits.diagnosisItems, limits.factLength)
    .map(admissionReasonBrief)
    .join("; ");
  const pmhFacts = admissionSummaryFactsByPattern(
    plan.facts.pmh,
    /\b(?:pmh|ckd|esrd|hd|dm|htn|af|cad|hf|hfr?ef|copd|asthma|cva|stroke|cirrhosis|cancer|scc|chemo|apixaban|warfarin|baseline)\b/i,
    limits.pmhItems,
    limits.factLength,
  );
  const pmh = (pmhFacts.length > 0 ? pmhFacts : admissionSummaryFacts(plan.facts.pmh, limits.pmhItems, limits.factLength)).join("; ");
  const severity = admissionSummaryFactsByPattern(
    [...plan.redFlags.map((flag) => flag.text), ...plan.facts.objectiveFacts],
    /\b(?:bp|hr|rr|spo2|o2|nc|ra|lactate|wbc|hb|plt|cr|k|na|shock|hypotension|sepsis|fever|hypox|icu|pressor|intubat|crrt)\b/i,
    limits.severityItems,
    limits.factLength,
  ).join("; ");
  const treatment = admissionSummaryFactsByPattern(
    [...plan.facts.hospitalCourse, ...plan.facts.procedures, ...plan.facts.antibiotics, ...plan.facts.medications],
    /\b(?:s\/p|started|given|treated|abx|cef|azithro|vanco|mero|pip\/tazo|zosyn|levo|ercp|egd|scope|stent|intubat|extubat|pressor|norepi|ivf|fluid|crrt|hd|transfus|insulin|steroid|bronchodilator|o2|nc|bipap|niv|after\s+b\/c)\b/i,
    limits.courseItems,
    limits.factLength,
  )
    .filter((item) => !pmh || item.toLowerCase() !== pmh.toLowerCase())
    .filter((item) => !diagnosis || item.toLowerCase() !== diagnosis.toLowerCase())
    .join("; ");
  const response = admissionSummaryFactsByPattern(
    plan.facts.todayUpdates,
    /\b(?:now|currently|improv|resolved|off|response|afebrile|stable|extubat|wean|stopped)\b/i,
    limits.responseItems,
    limits.factLength,
  ).join("; ");
  const objective = admissionObjectiveAnchors(plan, limits.objectiveItems, limits.factLength).join("; ");
  const active = compactList(
    plan.problemBasedAP.map((item) => admissionProblemBrief(item, options.length === "threeMinute")),
    limits.activeItems,
    limits.factLength,
  )
    .map(abbreviateAdmissionSummaryText)
    .join("; ");
  const pending = admissionSummaryFacts(
    [
      ...plan.facts.pendingItems,
      ...plan.todayTasks.map((task) => task.text),
      ...plan.problemBasedAP.flatMap((item) => prioritizePlanLines(item.planItems).slice(0, 2)),
      ...compactDispositionFacts(plan.facts.dischargeDisposition, 2, 80),
    ],
    limits.pendingItems,
    limits.factLength,
  ).join("; ");

  const admissionLead = diagnosis ? [who, `${admissionBriefZh.because} ${diagnosis} ${admissionBriefZh.admitted}`].filter(Boolean).join(" ") : "";
  const courseParts = [
    severity ? `${admissionBriefZh.arrivalOrTransfer} ${severity}` : "",
    treatment ? `${admissionBriefZh.through} ${treatment}` : "",
    response ? `${treatment ? admissionBriefZh.after : admissionBriefZh.inHospital} ${response}` : "",
  ].filter(Boolean);
  const activeLine = active ? `${admissionBriefZh.nowFocus} ${active}` : "";
  const pendingLine = pending ? `${admissionBriefZh.todayPending} ${pending}` : "";
  const activeAndPending = options.length === "threeMinute"
    ? [activeLine, pendingLine]
    : [[activeLine, pendingLine].filter(Boolean).join(zhSemicolon)];

  return formatMixedAdmissionSummarySentences([
    admissionLead,
    pmh ? `${admissionBriefZh.background} ${pmh}` : "",
    courseParts.join(zhComma),
    objective ? `${admissionBriefZh.keyObjective} ${objective}` : "",
    ...activeAndPending,
  ], options);
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

function abbreviateAdmissionSummaryText(value: string) {
  return compactMedicalAbbreviations(value)
    .replace(/\bcommunity[- ]?acquired pneumonia\b/gi, "CAP")
    .replace(/\bpneumonia\b/gi, "PNA")
    .replace(/\boxygen requirement\b/gi, "O2 need")
    .replace(/\bblood cultures?\b/gi, "B/C")
    .replace(/\bfollow up\b/gi, "f/u")
    .replace(/\bantibiotics\b/gi, "Abx")
    .replace(/\bdisposition\b/gi, "dispo")
    .replace(/\brehabilitation\b/gi, "rehab")
    .replace(/\bsuspected\b/gi, "c/f")
    .replace(/\bsusceptibility\b/gi, "suscept")
    .replace(/\s+/g, " ")
    .trim();
}

function admissionFactFragments(values: string[]) {
  return values.flatMap((value) =>
    String(value ?? "")
      .split(/\r?\n|;\s*|(?<=\.)\s+(?=[A-Z0-9])/)
      .map((line) => line.replace(/[.;\u3002\uff1b\s]+$/g, "").trim())
      .filter(Boolean),
  );
}

function admissionSummaryFacts(values: string[], maxItems: number, maxLength = 90) {
  return compactList(admissionFactFragments(values), maxItems, maxLength).map(abbreviateAdmissionSummaryText);
}

function formatMixedAdmissionSummarySentences(values: string[], options: AdmissionBriefOptions = {}) {
  const limits = admissionBriefLimits(options);
  return values
    .map((value) => abbreviateAdmissionSummaryText(value).replace(/[.;\u3002\uff1b\s]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, limits.maxSentences)
    .map((value) => `${value}${zhPeriod}`)
    .join("");
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

function looksLikeMedicationOrderLine(value: string) {
  return /\b(?:order|orders?|meds?|藥囑)\s*:/i.test(value) ||
    (/\b(?:iv|po|sc|im|mg|mcg|g|unit|units|qd|bid|tid|qid|q\d+h|prn|stat)\b/i.test(value) &&
      /\b(?:cef|vanco|teico|mero|tazo|zosyn|levo|cipro|heparin|apixaban|warfarin|insulin|lasix|furosemide|morphine|fentanyl|ppi|pantoprazole|steroid|methylpred|prednisolone)\b/i.test(value));
}

function sbarRecommendationLine(value: string) {
  const clean = compactSnippet(value.replace(/^!+\s*/, ""), 150);
  if (!clean) return "";
  if (!looksLikeMedicationOrderLine(clean)) return clean;
  if (/\b(?:abx|antibiotic|cef|vanco|teico|mero|tazo|zosyn|levo|cipro)\b/i.test(clean)) return "Clarify Abx duration, culture follow-up, and source control.";
  if (/\b(?:heparin|apixaban|warfarin|anticoag|antiplatelet|aspirin|clopidogrel)\b/i.test(clean)) return "Clarify anticoag/AP hold-resume plan and bleeding/procedure threshold.";
  if (/\b(?:insulin|glucose|sugar)\b/i.test(clean)) return "Clarify fingerstick glucose schedule (AC/HS or q6h) and insulin adjustment parameters.";
  if (/\b(?:lasix|furosemide|diuretic|ivf|fluid)\b/i.test(clean)) return "Clarify volume plan and I/O target; f/u BUN/Cr, Na/K.";
  return "";
}

function weeklySentence(value: string) {
  const clean = value
    .replace(/\bdisposition\b/gi, "dispo")
    .replace(/\bfollow up\b/gi, "f/u")
    .replace(/\s+/g, " ")
    .replace(/[.;\s]+$/g, "")
    .trim();
  if (!clean) return "";
  return `${clean}${/[。！？!?]$/.test(clean) ? "" : "."}`;
}

function weeklySentences(values: string[], maxSentences = 8) {
  return dedupe(values.map(weeklySentence).filter(Boolean)).slice(0, maxSentences).join(" ");
}

function weeklyAnchorSentence(anchor: string) {
  const clean = compactSnippet(anchor, 155);
  if (!clean) return "This weekly update needs clinician review for the admission/course anchor.";
  if (/^(?:admitted|transferred|presented|initially|this admission|during admission|s\/p|treated|started|found)/i.test(clean)) {
    return weeklySentence(clean);
  }
  return weeklySentence(`During this week, the hospital course centered on ${clean}`);
}

function weeklyTrajectorySentences(values: string[], maxItems: number) {
  return compactDocFacts(values, maxItems, 125).map((item) => weeklySentence(item));
}

function weeklyActiveProblemSentence(problem: string, status: string, assessment: string, evidence: string[], planItems: string[]) {
  const label = compactSnippet(problem, 58);
  const statusText = status && !/active/i.test(status) ? `${status}; ` : "";
  const assessmentText = compactSnippet(assessment, 92);
  const evidenceText = compactList(evidence, 1, 70).join("; ");
  const planText = compactList(prioritizePlanLines(planItems), 1, 78).join("; ");
  const detail = [
    statusText ? `${statusText}${assessmentText}` : assessmentText,
    evidenceText ? `data ${evidenceText}` : "",
    planText ? `plan ${planText}` : "",
  ].filter(Boolean).join("; ");
  return weeklySentence(detail ? `${label}: ${detail}` : label);
}

function weeklyPendingSentence(values: string[]) {
  const pending = compactList(values, 4, 105);
  if (pending.length === 0) return "The next clinician should confirm remaining tasks, monitoring thresholds, and dispo.";
  return weeklySentence(`Pending/dispo remains ${pending.join("; ")}`);
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
  options: AdmissionBriefOptions = {},
) {
  if (!hasClinicalReasoning(reasoning)) return "";
  const limits = admissionBriefLimits(options);
  const topProblems = reasoning.activeProblemsRanked.filter((item) => item.status !== "resolved").slice(0, 4);
  const who = admissionWhoFragment(fallbackPlan?.facts.sourceText ?? "");
  const diagnosis = admissionSummaryFacts([...(fallbackPlan?.facts.diagnoses ?? []), ...(fallbackPlan?.facts.activeProblems ?? [])], 1, limits.factLength)
    .map(admissionReasonBrief)
    .join("; ");
  const pmh = admissionSummaryFacts(fallbackPlan?.facts.pmh ?? [], limits.pmhItems, limits.factLength).join("; ");
  const course = admissionSummaryFacts(
    [...(fallbackPlan?.facts.hospitalCourse ?? []), ...(fallbackPlan?.facts.procedures ?? []), ...(fallbackPlan?.facts.antibiotics ?? [])],
    limits.courseItems,
    limits.factLength,
  ).join("; ");
  const objective = fallbackPlan
    ? admissionObjectiveAnchors(fallbackPlan, limits.objectiveItems, limits.factLength).join("; ")
    : admissionSummaryFacts(reasoning.whyThisMatters.map((item) => item.fact), limits.objectiveItems, limits.factLength).join("; ");
  const evidence = admissionSummaryFacts(reasoning.whyThisMatters.map((item) => `${item.fact} -> ${item.implication}`), 2, limits.factLength);
  const tasks = compactList(
    [
      ...topProblems.flatMap((item) => item.todayPlan),
      ...reasoning.missingDataNeeded.map((item) => `clarify ${item}`),
      ...(fallbackPlan?.todayTasks.map((task) => task.text) ?? []),
    ],
    limits.pendingItems,
    limits.factLength,
  ).map(abbreviateAdmissionSummaryText);
  const active = compactList(topProblems.map((item) => item.problem), limits.activeItems, 52).map(abbreviateAdmissionSummaryText).join("; ");
  const admissionLead = diagnosis
    ? [who, `${admissionBriefZh.because} ${diagnosis} ${admissionBriefZh.admitted}`].filter(Boolean).join(" ")
    : "";
  const currentLead = compactSnippet(reasoning.primaryRisk || reasoning.currentClinicalState, 110);
  const activeLine = active ? `${admissionBriefZh.problems} ${active}` : "";
  const evidenceLine = evidence.length > 0 ? `${admissionBriefZh.evidence} ${evidence.join("; ")}` : "";
  const focusLine = [admissionLead && currentLead ? `${admissionBriefZh.nowFocus} ${currentLead}` : "", activeLine, evidenceLine].filter(Boolean).join(zhSemicolon);
  const pendingLine = tasks.length > 0 ? `${admissionBriefZh.todayPending} ${tasks.join("; ")}` : "";
  const focusAndPending = options.length === "threeMinute"
    ? [focusLine, pendingLine]
    : [[focusLine, pendingLine].filter(Boolean).join(zhSemicolon)];
  return formatMixedAdmissionSummarySentences([
    admissionLead || (currentLead ? `${admissionBriefZh.nowFocus} ${currentLead}` : ""),
    pmh ? `${admissionBriefZh.background} ${pmh}` : "",
    course ? `${admissionBriefZh.arrivalOrTransfer} ${course}` : "",
    objective ? `${admissionBriefZh.keyObjective} ${objective}` : "",
    ...focusAndPending,
  ], options);
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
  ).map(sbarRecommendationLine).filter(Boolean);
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
  const anchor = reasoning.primaryRisk || reasoning.currentClinicalState || compactList(fallbackPlan?.facts.diagnoses ?? [], 1, 120)[0] || "";
  const trajectory = weeklyTrajectorySentences(
    [
      ...reasoning.whyThisMatters.map((item) => `${item.fact} -> ${item.implication}`),
      ...(fallbackPlan?.facts.hospitalCourse ?? []),
      ...(fallbackPlan?.facts.todayUpdates ?? []),
      ...(fallbackPlan?.facts.antibiotics ?? []),
    ],
    2,
  );
  const active = activeProblems.slice(0, 3).map((item) =>
    weeklyActiveProblemSentence(item.problem, item.status, item.whyImportant, item.evidence, item.todayPlan),
  );
  const pending = weeklyPendingSentence(
    [
      ...activeProblems.flatMap((item) => item.todayPlan),
      ...activeProblems.flatMap((item) => item.callThresholds.map((threshold) => `Call/threshold: ${threshold}`)),
      ...reasoning.missingDataNeeded.map((item) => `Clarify: ${item}`),
      ...compactDispositionFacts(fallbackPlan?.facts.dischargeDisposition ?? [], 2, 100),
    ],
  );
  const resolved = compactList(reasoning.resolvedOrLessImportant, 1, 115).map((line) => weeklySentence(`Less active this week was ${line}`));
  return weeklySentences([
    weeklyAnchorSentence(anchor),
    ...trajectory,
    ...active,
    ...resolved,
    pending,
  ]);
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
    const line = sbarRecommendationLine(task.text);
    return line ? `- ${prefix}: ${line}` : "";
  }).filter(Boolean);
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
  const trajectory = weeklyTrajectorySentences([...plan.facts.hospitalCourse, ...plan.facts.todayUpdates, ...plan.facts.antibiotics], 2);
  const active = plan.problemBasedAP.slice(0, 3).map((item) =>
    weeklyActiveProblemSentence(
      shortProblemTitle(item.problemTitle),
      "active",
      compactAssessmentPhrase(item),
      item.evidenceOrCourseItems,
      item.planItems,
    ),
  );
  const pending = weeklyPendingSentence(
    [
      ...plan.todayTasks.map((task) => `${task.priority === "urgent" ? "Urgent: " : ""}${task.text}`),
      ...plan.facts.pendingItems,
      ...compactDispositionFacts(plan.facts.dischargeDisposition, 2, 100),
      ...plan.redFlags.map((flag) => `Call/verify: ${flag.text}`),
    ],
  );

  return weeklySentences([
    weeklyAnchorSentence(diagnosis),
    ...trajectory,
    ...active,
    pending,
  ]);
}

