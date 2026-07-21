import { extractActiveAntibioticNames } from "./antibioticPlan";
import { classifyClinicalLine, type ClinicalLineKind } from "./clinicalLineClassifier";
import {
  editorDraftToSoapText,
  parseCanonicalSoapTextToEditorDraft,
  parseSoapTextToEditorDraft,
  splitSoapEditorTaskLines,
  type SoapEditorDraft,
  type SoapEditorLine,
  type SoapEditorProblem,
} from "./soapEditorDraft";
import type { RoundSoapSourceFields, RoundSoapWorkflowMode, SoapDeltaReview, SoapDeltaSection } from "./soapDeltaGuardrails";
import type { StructuredRoundSoapDraft } from "./types";
import { createId, stripColorMarkup } from "./utils";

export interface StructuredRoundSoapAcceptance {
  draft: SoapEditorDraft;
  review: SoapDeltaReview;
  fatalErrors: string[];
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function editorLine(text: string, kind: ClinicalLineKind, subtype?: "order"): SoapEditorLine {
  const value = clean(text);
  const classified = classifyClinicalLine(value, { fallbackKind: kind, lockKind: true });
  return {
    id: createId("soap-line"),
    text: value,
    tone: classified.tone === "info" ? "plain" : classified.tone,
    kind,
    ...(subtype ? { subtype } : {}),
  };
}

export function structuredRoundSoapToEditorDraft(value: StructuredRoundSoapDraft): SoapEditorDraft {
  const objective = value.objective;
  const oLines = [
    ...objective.vitalSigns.map((text) => editorLine(text.replace(/^(?:V\/S|VS|Vitals?)\s*:\s*/i, ""), "vs")),
    ...objective.physicalExam.map((text) => editorLine(text.replace(/^(?:PE|Physical exam)\s*:\s*/i, ""), "pe")),
    ...objective.labs.map((item) => editorLine(`${item.panel}: ${item.values}`.replace(/^Lab\s*:\s*/i, ""), "lab")),
    ...objective.microbiology.map((text) => editorLine(`Micro: ${text.replace(/^(?:Lab\s*:\s*)?Micro\s*:\s*/i, "")}`, "lab")),
    ...objective.imaging.map((item) => editorLine(`${[item.study, item.date].filter(Boolean).join(" ")}: ${item.finding}`, "image")),
    ...objective.pathology.map((item) => editorLine(`Pathology: ${[item.specimen, item.date].filter(Boolean).join(" ")}: ${item.result}`, "other")),
    ...objective.other.map((text) => editorLine(text, "other")),
  ].filter((line) => line.text);

  return {
    headerLines: value.headerLines.map((text) => editorLine(text, "header")),
    sLines: value.subjectiveLines.map((text) => editorLine(text, "s")),
    oLines,
    apProblems: value.assessmentPlan.map((problem): SoapEditorProblem => ({
      id: createId("soap-ap"),
      title: clean(problem.problemTitle),
      tone: classifyClinicalLine(problem.problemTitle, { fallbackKind: "ap", lockKind: true }).tone === "critical" ? "critical" : "plain",
      lines: [problem.summary, problem.plan].filter((line) => clean(line)).map((text) => editorLine(text, "ap")),
    })),
    taskLines: [
      ...value.orders.map((text) => editorLine(text.replace(/^Order\s*:\s*/i, ""), "task", "order")),
      ...value.tasks.map((text) => editorLine(text, "task")),
    ],
    dcLines: value.discharge.map((text) => editorLine(text, "dc")),
    warnings: value.warnings.map((text) => editorLine(text, "other")),
    unsortedLines: [],
  };
}

function sourceText(fields: RoundSoapSourceFields) {
  return [fields.vitals, fields.labs, fields.images, fields.orders, fields.other, fields.admission, fields.lastSoap]
    .map((value) => String(value ?? "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean)
      .join("\n"))
    .filter(Boolean)
    .join("\n");
}

function hasText(value: unknown) {
  return clean(value).length > 0;
}

function looksLikeVitals(value: string) {
  return /\b(?:BP|HR|RR|SpO2|SaO2|Temp(?:erature)?|Pulse)\s*[:=]?\s*\d|\bT\s*[:=]?\s*\d{2}(?:\.\d+)?/i.test(value);
}

function sourceVitalLines(value: unknown) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line && looksLikeVitals(line));
  const seen = new Set<string>();
  return lines.flatMap((line) => {
    const text = line
      .replace(/^(\(?\d{4}[-/]\d{1,2}[-/]\d{1,2}\)?\s*)?(?:Vital signs|Vitals?|V\/S|VS)\s*:\s*/i, "$1")
      .trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [editorLine(text, "vs")];
  });
}

export function isVitalsOnlyDailySource(fields: RoundSoapSourceFields) {
  return hasText(fields.vitals) && ![fields.labs, fields.images, fields.orders, fields.other, fields.admission, fields.lastSoap].some(hasText);
}

function looksLikeLabs(value: string) {
  const labels = value.match(/\b(?:WBC|Neu|Hb|Hgb|Hct|Plt|BUN|Cr|eGFR|Na|K|Cl|Ca|Mg|Phos|AST|ALT|ALP|T-?Bil|Alb|PT|INR|CRP|PCT|lactate|pH|pCO2|HCO3|troponin|BNP)\b/gi) ?? [];
  const numbers = value.match(/(?:^|\s|[:=])([<>]?-?\d+(?:\.\d+)?)(?=\s|[,;/%)]|$)/gm) ?? [];
  return labels.length >= 2 && numbers.length >= 2;
}

function looksLikeImage(value: string) {
  return /\b(?:CXR|CT|MRI|X-?ray|Echo|Sono|Ultrasound|US|PET|ERCP|EGD|Colonoscopy)\b/i.test(value);
}

function looksLikePathology(value: string) {
  return /\b(?:final\s+)?(?:pathology|histopathology|cytology|biopsy result)\b/i.test(value);
}

function objectiveGroups(lines: SoapEditorLine[]) {
  return {
    vs: lines.filter((line) => line.kind === "vs"),
    pe: lines.filter((line) => line.kind === "pe"),
    lab: lines.filter((line) => line.kind === "lab"),
    image: lines.filter((line) => line.kind === "image"),
    other: lines.filter((line) => !["vs", "pe", "lab", "image"].includes(line.kind)),
  };
}

function tokenSet(value: string) {
  return new Set(stripColorMarkup(value).toLowerCase().match(/[a-z][a-z0-9/+.-]{1,}|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}/g) ?? []);
}

function titleSimilarity(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
}

function preserveReviewedProblems(candidate: SoapEditorProblem[], baseline: SoapEditorProblem[]) {
  const used = new Set<string>();
  const merged = candidate.map((problem) => {
    const match = baseline.find((prior) => !used.has(prior.id) && titleSimilarity(problem.title, prior.title) >= 0.6);
    if (!match) return problem;
    used.add(match.id);
    return {
      ...problem,
      title: match.title,
      tone: match.tone,
    };
  });
  baseline.forEach((problem) => {
    if (!used.has(problem.id)) merged.push(problem);
  });
  return merged;
}

function numericTokens(value: string) {
  return (value.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map((token) => Number(token))
    .filter(Number.isFinite)
    .map(String);
}

function labFidelityErrors(candidate: SoapEditorDraft, source: string, baselineText: string, sourceHasLabs: boolean) {
  if (!sourceHasLabs) return [];
  const labLines = candidate.oLines.filter((line) => line.kind === "lab");
  if (labLines.length === 0) return ["AI omitted supplied Lab results. The draft was not applied."];
  const allowedNumbers = new Set(numericTokens(`${source}\n${baselineText}`));
  const unsupported = labLines.flatMap((line) => numericTokens(line.text).filter((number) => !allowedNumbers.has(number)).map((number) => `${number} in '${line.text}'`));
  return unsupported.length > 0
    ? [`AI changed or invented Lab value(s): ${unsupported.slice(0, 3).join("; ")}. The draft was not applied.`]
    : [];
}

function repeatedAntibioticErrors(candidate: SoapEditorDraft) {
  const owners = new Map<string, number>();
  candidate.apProblems.forEach((problem, index) => {
    extractActiveAntibioticNames([problem.title, ...problem.lines.map((line) => line.text)].join(" ")).forEach((name) => {
      owners.set(`${name}|${index}`, index);
    });
  });
  const counts = new Map<string, number>();
  owners.forEach((_index, key) => {
    const name = key.split("|")[0];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => `AI repeated ${name} under multiple A/P problems. The draft was not applied.`);
}

function evidenceGroundingErrors(
  value: StructuredRoundSoapDraft,
  baseline: SoapEditorDraft,
  source: string,
  workflowMode: RoundSoapWorkflowMode,
) {
  const sourceOnly = tokenSet(source);
  const sourceAndBaseline = tokenSet(`${source}\n${editorDraftToSoapText(baseline)}`);
  const errors: string[] = [];
  value.assessmentPlan.forEach((problem) => {
    const existing = baseline.apProblems.some((prior) => titleSimilarity(problem.problemTitle, prior.title) >= 0.6);
    if (workflowMode === "dailyUpdate" && existing && problem.sourceEvidence.length === 0) return;
    if (problem.sourceEvidence.length === 0) {
      errors.push(`A/P '${problem.problemTitle}' has no source evidence. The draft was not applied.`);
      return;
    }
    const available = workflowMode === "dailyUpdate" && !existing ? sourceOnly : sourceAndBaseline;
    const grounded = problem.sourceEvidence.some((evidence) => {
      const evidenceTokens = [...tokenSet(evidence)].filter((token) => token.length > 1 || /^\d/.test(token));
      if (evidenceTokens.length === 0) return false;
      const matches = evidenceTokens.filter((token) => available.has(token)).length;
      return matches >= Math.min(2, evidenceTokens.length) || matches / evidenceTokens.length >= 0.6;
    });
    if (!grounded) errors.push(`A/P '${problem.problemTitle}' is not grounded in the pasted source or reviewed baseline. The draft was not applied.`);
  });
  return errors;
}

function criticalApCoverageErrors(value: StructuredRoundSoapDraft, source: string) {
  const labText = value.objective.labs.map((item) => item.values).join(" ");
  const apText = value.assessmentPlan.map((problem) => `${problem.problemTitle} ${problem.summary} ${problem.plan}`).join(" ");
  const errors: string[] = [];
  const observations: Array<{ label: string; pattern: RegExp; isCritical: (value: number) => boolean; apPattern: RegExp }> = [
    { label: "Na", pattern: /\bNa\s*[:=]?\s*(-?\d+(?:\.\d+)?)/gi, isCritical: (number) => number <= 125 || number >= 150, apPattern: /\b(?:Na|sodium|hypernat|hyponat|free[- ]?water)\b/i },
    { label: "K", pattern: /\bK\s*[:=]?\s*(-?\d+(?:\.\d+)?)/gi, isCritical: (number) => number <= 2.8 || number >= 6, apPattern: /\b(?:K|potassium|hyperkal|hypokal)\b/i },
    { label: "Hb", pattern: /\b(?:Hb|Hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, isCritical: (number) => number < 7, apPattern: /\b(?:Hb|Hgb|anemia|bleed|transfus)\b/i },
    { label: "lactate", pattern: /\blactate\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, isCritical: (number) => number >= 4, apPattern: /\b(?:lactate|shock|sepsis|hypoperfusion)\b/i },
    { label: "INR", pattern: /\bINR\s*[:=]?\s*(\d+(?:\.\d+)?)/gi, isCritical: (number) => number >= 5, apPattern: /\b(?:INR|coagul|warfarin|bleed)\b/i },
  ];
  observations.forEach((observation) => {
    for (const match of labText.matchAll(observation.pattern)) {
      const number = Number(match[1]);
      if (observation.isCritical(number) && !observation.apPattern.test(apText)) {
        errors.push(`AI left critical ${observation.label} ${match[1]} only in O without an A/P assessment. The draft was not applied.`);
      }
    }
  });

  const hbValues = [...labText.matchAll(/\b(?:Hb|Hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1]));
  const unsupportedAnemia = value.assessmentPlan.some((problem) => /\b(?:anemia|anaemia|Hb drop)\b/i.test(problem.problemTitle)) &&
    hbValues.length > 0 && hbValues.every((number) => number >= 11) &&
    !/\b(?:anemia|anaemia|Hb drop|bleed|melena|hematemesis|hematochezia|transfus|PRBC)\b/i.test(source);
  if (unsupportedAnemia) errors.push("AI created anemia from an isolated non-anemic Hb value. The draft was not applied.");
  return errors;
}

function duplicatePlanErrors(value: StructuredRoundSoapDraft) {
  const owners = new Map<string, string[]>();
  value.assessmentPlan.forEach((problem) => {
    const plan = clean(problem.plan).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
    if (plan.length < 18) return;
    owners.set(plan, [...(owners.get(plan) ?? []), problem.problemTitle]);
  });
  return [...owners.entries()]
    .filter(([, problems]) => problems.length > 1)
    .map(([, problems]) => `AI repeated the same plan under multiple A/P problems (${problems.join(", ")}). The draft was not applied.`);
}

function sourceCoverageErrors(candidate: SoapEditorDraft, source: string, sourceHasLabs: boolean, sourceHasImages: boolean) {
  const errors: string[] = [];
  const candidateText = editorDraftToSoapText(candidate).toLowerCase();
  extractActiveAntibioticNames(source).forEach((name) => {
    if (!candidateText.includes(name.toLowerCase())) errors.push(`AI omitted current antimicrobial '${name}'. The draft was not applied.`);
  });
  if (sourceHasLabs && !candidate.oLines.some((line) => line.kind === "lab")) errors.push("AI omitted supplied Lab results. The draft was not applied.");
  if (sourceHasImages && !candidate.oLines.some((line) => line.kind === "image")) errors.push("AI omitted supplied imaging. The draft was not applied.");
  if (looksLikePathology(source) && !candidate.oLines.some((line) => /pathology|biopsy|histopath|cytology/i.test(line.text))) {
    errors.push("AI omitted a supplied pathology/biopsy result. The draft was not applied.");
  }
  return errors;
}

function changedSections(before: SoapEditorDraft, after: SoapEditorDraft): SoapDeltaSection[] {
  const beforeO = objectiveGroups(before.oLines);
  const afterO = objectiveGroups(after.oLines);
  const sections: Array<[SoapDeltaSection, unknown, unknown]> = [
    ["header", before.headerLines, after.headerLines],
    ["s", before.sLines, after.sLines],
    ["vs", beforeO.vs, afterO.vs],
    ["pe", beforeO.pe, afterO.pe],
    ["lab", beforeO.lab, afterO.lab],
    ["image", beforeO.image, afterO.image],
    ["other", beforeO.other, afterO.other],
    ["ap", before.apProblems, after.apProblems],
    ["orders", splitSoapEditorTaskLines(before.taskLines).orderLines, splitSoapEditorTaskLines(after.taskLines).orderLines],
    ["tasks", splitSoapEditorTaskLines(before.taskLines).taskOnlyLines, splitSoapEditorTaskLines(after.taskLines).taskOnlyLines],
    ["dc", before.dcLines, after.dcLines],
  ];
  return sections.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([section]) => section);
}

export function applyVitalsOnlyDailyUpdate(
  baselineText: string,
  sourceFields: RoundSoapSourceFields,
): StructuredRoundSoapAcceptance {
  const baseline = parseCanonicalSoapTextToEditorDraft(baselineText);
  const nextVitals = sourceVitalLines(sourceFields.vitals);
  if (nextVitals.length === 0) {
    const message = "No valid V/S values were found. The reviewed SOAP was left unchanged.";
    return {
      draft: baseline,
      fatalErrors: [message],
      review: {
        workflowMode: "dailyUpdate",
        baselineText,
        candidateText: baselineText,
        acceptedText: baselineText,
        changedSections: [],
        warnings: [],
        highRiskWarnings: [message],
      },
    };
  }

  const priorO = objectiveGroups(baseline.oLines);
  const accepted: SoapEditorDraft = {
    ...baseline,
    oLines: [...nextVitals, ...priorO.pe, ...priorO.lab, ...priorO.image, ...priorO.other],
  };
  const acceptedText = editorDraftToSoapText(accepted);
  return {
    draft: accepted,
    fatalErrors: [],
    review: {
      workflowMode: "dailyUpdate",
      baselineText,
      candidateText: acceptedText,
      acceptedText,
      changedSections: changedSections(baseline, accepted).map((id) => ({
        id,
        label: id.toUpperCase(),
        risk: "normal",
        reason: "V/S replaced directly from the pasted source; unrelated reviewed SOAP was preserved.",
        blocked: false,
      })),
      warnings: [],
      highRiskWarnings: [],
    },
  };
}

export function acceptStructuredRoundSoap(params: {
  value: StructuredRoundSoapDraft;
  baselineText: string;
  sourceFields: RoundSoapSourceFields;
  workflowMode: RoundSoapWorkflowMode;
}): StructuredRoundSoapAcceptance {
  if (params.workflowMode === "dailyUpdate" && isVitalsOnlyDailySource(params.sourceFields)) {
    return applyVitalsOnlyDailyUpdate(params.baselineText, params.sourceFields);
  }
  const baseline = parseCanonicalSoapTextToEditorDraft(params.baselineText);
  const generated = structuredRoundSoapToEditorDraft(params.value);
  const source = sourceText(params.sourceFields);
  const sourceHasVitals = hasText(params.sourceFields.vitals) || looksLikeVitals(source);
  const sourceHasLabs = hasText(params.sourceFields.labs) || looksLikeLabs(source);
  const sourceHasImages = hasText(params.sourceFields.images) || looksLikeImage(source);
  const sourceHasOther = hasText(params.sourceFields.other);
  const sourceHasOrders = hasText(params.sourceFields.orders);
  let accepted = generated;

  if (params.workflowMode === "dailyUpdate") {
    const priorO = objectiveGroups(baseline.oLines);
    const nextO = objectiveGroups(generated.oLines);
    const priorTasks = splitSoapEditorTaskLines(baseline.taskLines);
    const nextTasks = splitSoapEditorTaskLines(generated.taskLines);
    accepted = {
      ...generated,
      headerLines: baseline.headerLines,
      sLines: sourceHasOther ? generated.sLines : baseline.sLines,
      oLines: [
        ...(sourceHasVitals ? nextO.vs : priorO.vs),
        ...(sourceHasOther && nextO.pe.length > 0 ? nextO.pe : priorO.pe),
        ...(sourceHasLabs ? nextO.lab : priorO.lab),
        ...(sourceHasImages ? nextO.image : priorO.image),
        ...(sourceHasOther && nextO.other.length > 0 ? nextO.other : priorO.other),
      ],
      apProblems: preserveReviewedProblems(generated.apProblems, baseline.apProblems),
      taskLines: [
        ...(sourceHasOrders ? nextTasks.orderLines : priorTasks.orderLines),
        ...(sourceHasOther ? nextTasks.taskOnlyLines : priorTasks.taskOnlyLines),
      ],
      dcLines: sourceHasOther ? generated.dcLines : baseline.dcLines,
    };
  }

  const fatalErrors = [...new Set([
    ...labFidelityErrors(accepted, source, params.baselineText, sourceHasLabs),
    ...sourceCoverageErrors(accepted, source, sourceHasLabs, sourceHasImages),
    ...repeatedAntibioticErrors(accepted),
    ...evidenceGroundingErrors(params.value, baseline, source, params.workflowMode),
    ...criticalApCoverageErrors(params.value, source),
    ...duplicatePlanErrors(params.value),
  ])];
  const candidateText = editorDraftToSoapText(generated);
  const acceptedText = fatalErrors.length > 0 ? params.baselineText : editorDraftToSoapText(accepted);
  const finalDraft = fatalErrors.length > 0 ? baseline : accepted;
  const changed = changedSections(baseline, finalDraft);
  const warnings = [...new Set([...params.value.warnings])];
  return {
    draft: finalDraft,
    fatalErrors,
    review: {
      workflowMode: params.workflowMode,
      baselineText: params.baselineText,
      candidateText,
      acceptedText,
      changedSections: changed.map((id) => ({
        id,
        label: id === "orders" ? "藥囑" : id.toUpperCase(),
        risk: id === "ap" || id === "orders" || id === "dc" ? "high" : "normal",
        reason: "AI structured block differs from the reviewed baseline.",
        blocked: false,
      })),
      warnings,
      highRiskWarnings: fatalErrors,
    },
  };
}
