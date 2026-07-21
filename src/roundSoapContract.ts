import { extractActiveAntibioticNames } from "./antibioticPlan";
import { classifyClinicalLine, type ClinicalLineKind } from "./clinicalLineClassifier";
import { buildCanonicalLabDataset, labSelectionKeysFromText } from "./labDataset";
import { formatLabVisualSummaryLinesFromText } from "./labVisualSummary";
import { normalizeObjectiveLabExportLines, objectiveKindFromLine } from "./objectiveLineSanitizer";
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
  const rawOLines = [
    ...objective.vitalSigns.map((text) => editorLine(text.replace(/^(?:V\/S|VS|Vitals?)\s*:\s*/i, ""), "vs")),
    ...objective.physicalExam.map((text) => editorLine(text.replace(/^(?:PE|Physical exam)\s*:\s*/i, ""), "pe")),
    ...objective.labs.map((item) => editorLine(`${item.panel}: ${item.values}`.replace(/^Lab\s*:\s*/i, ""), "lab")),
    ...objective.microbiology.map((text) => editorLine(`Micro: ${text.replace(/^(?:Lab\s*:\s*)?Micro\s*:\s*/i, "")}`, "lab")),
    ...objective.imaging.map((item) => editorLine(`${[item.study, item.date].filter(Boolean).join(" ")}: ${item.finding}`, "image")),
    ...objective.pathology.map((item) => editorLine(`Pathology: ${[item.specimen, item.date].filter(Boolean).join(" ")}: ${item.result}`, "other")),
    ...objective.other.map((text) => editorLine(text, "other")),
  ].filter((line) => line.text);
  const originalLines = new Map<string, SoapEditorLine[]>();
  rawOLines.forEach((line) => {
    const key = clean(line.text).toLowerCase();
    originalLines.set(key, [...(originalLines.get(key) ?? []), line]);
  });
  const oLines = normalizeObjectiveLabExportLines(rawOLines.map((line) => line.text))
    .map((text) => {
      const key = clean(text).toLowerCase();
      const originals = originalLines.get(key) ?? [];
      const original = originals.shift();
      if (original) return original;
      return editorLine(text, objectiveKindFromLine(text, "other"));
    });

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
  return [fields.vitals, fields.labs, fields.images, fields.orders, fields.other, fields.admission, fields.lastSoap, fields.rawSource]
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

function sourceLabEditorLines(
  fields: RoundSoapSourceFields,
  selectedLabs: StructuredRoundSoapDraft["objective"]["labs"] = [],
) {
  const dataset = buildCanonicalLabDataset(String(fields.labs ?? ""));
  const validIds = new Set(dataset.latestItems.map((item) => item.id).filter(Boolean));
  const preferredItemIds = selectedLabs
    .flatMap((item) => item.sourceIds ?? [])
    .filter((id) => validIds.has(id));
  // Older deployed functions do not return sourceIds. Label selection keeps
  // those responses useful while exact values still come only from source.
  const preferredLabels = selectedLabs
    .filter((item) => !(item.sourceIds ?? []).some((id) => validIds.has(id)))
    .flatMap((item) => labSelectionKeysFromText(item.values));
  return formatLabVisualSummaryLinesFromText(String(fields.labs ?? ""), {
    includePlain: true,
    preferredItemIds,
    preferredLabels,
  })
    .map((text) => editorLine(text.replace(/^Lab\s*:\s*/i, ""), "lab"))
    .filter((line) => line.text);
}

function isMicrobiologyLabLine(line: SoapEditorLine) {
  return /(?:^|\b)(?:Micro\s*:|B\/C\b|BCx\b|Blood Cx\b|U\/C\b|UCx\b|Urine Cx\b|CSF Cx\b|Sputum Cx\b|blood culture|urine culture|sputum culture|CSF culture)/i.test(line.text);
}

function uniqueEditorLines(lines: SoapEditorLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = stripColorMarkup(line.text).replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLines(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
}

function sourceImageEditorLines(fields: RoundSoapSourceFields) {
  const candidates = hasText(fields.images)
    ? sourceLines(fields.images)
    : sourceLines(fields.rawSource).filter(looksLikeImage);
  return uniqueEditorLines(candidates.map((text) => editorLine(text.replace(/^(?:Image|Img|Imaging)\s*:\s*/i, ""), "image")));
}

function sourcePathologyEditorLines(fields: RoundSoapSourceFields) {
  return uniqueEditorLines(
    sourceLines([fields.images, fields.other, fields.admission, fields.rawSource].filter(Boolean).join("\n"))
      .filter(looksLikePathology)
      .map((text) => editorLine(`Pathology: ${text.replace(/^Pathology\s*:\s*/i, "")}`, "other")),
  );
}

function sourceOrderEditorLines(fields: RoundSoapSourceFields) {
  return uniqueEditorLines(sourceLines(fields.orders).map((text) => editorLine(text.replace(/^(?:Order|Orders?|Meds?|Medication)\s*:\s*/i, ""), "task", "order")));
}

function imageStudyKey(value: string) {
  const text = stripColorMarkup(value).toLowerCase();
  if (/\bcxr\b|chest\s*x-?ray/.test(text)) return "cxr";
  if (/(?:chest|thorax).*\bct\b|\bct\b.*(?:chest|thorax)/.test(text)) return "ct-chest";
  if (/brain.*\bct\b|\bct\b.*brain/.test(text)) return "ct-brain";
  if (/(?:abd|abdominal|abdomen).*\bct\b|\bct\b.*(?:abd|abdominal|abdomen)/.test(text)) return "ct-abdomen";
  if (/\bmri\b/.test(text)) return `mri-${text.match(/\bmri\b\s*(?:of\s*)?([a-z]+)/)?.[1] ?? "other"}`;
  if (/\b(?:echo|echocardiogram|tte)\b/.test(text)) return "echo";
  return text.match(/\b(?:ct|pet|ultrasound|sono|egd|ercp|colonoscopy)\b/)?.[0] ?? text.slice(0, 48);
}

function mergeDailyImages(prior: SoapEditorLine[], incoming: SoapEditorLine[]) {
  if (incoming.length === 0) return prior;
  const incomingKeys = new Set(incoming.map((line) => imageStudyKey(line.text)));
  return uniqueEditorLines([...prior.filter((line) => !incomingKeys.has(imageStudyKey(line.text))), ...incoming]);
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

function problemEvidenceIsGrounded(
  problem: StructuredRoundSoapDraft["assessmentPlan"][number],
  baseline: SoapEditorDraft,
  source: string,
  workflowMode: RoundSoapWorkflowMode,
) {
  const existing = baseline.apProblems.some((prior) => titleSimilarity(problem.problemTitle, prior.title) >= 0.6);
  if (workflowMode === "dailyUpdate" && existing) return true;
  const available = tokenSet(workflowMode === "dailyUpdate" ? source : `${source}\n${editorDraftToSoapText(baseline)}`);
  const evidence = problem.sourceEvidence.length > 0
    ? problem.sourceEvidence.join(" ")
    : `${problem.problemTitle} ${problem.summary}`;
  const evidenceTokens = [...tokenSet(evidence)].filter((token) => token.length > 1 || /^\d/.test(token));
  if (evidenceTokens.length === 0) return false;
  const matches = evidenceTokens.filter((token) => available.has(token)).length;
  return matches >= Math.min(2, evidenceTokens.length) || matches / evidenceTokens.length >= 0.6;
}

function sanitizeCandidateApProblems(
  value: StructuredRoundSoapDraft,
  generated: SoapEditorDraft,
  baseline: SoapEditorDraft,
  source: string,
  workflowMode: RoundSoapWorkflowMode,
  authoritativeLabText: string,
) {
  const allowedNumbers = new Set(numericTokens(`${source}\n${editorDraftToSoapText(baseline)}`));
  const hbValues = [...authoritativeLabText.matchAll(/\b(?:Hb|Hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1]));
  return generated.apProblems.flatMap((problem, index) => {
    const structured = value.assessmentPlan[index];
    if (!structured || !problemEvidenceIsGrounded(structured, baseline, source, workflowMode)) return [];
    const unsupportedAnemia = /\b(?:anemia|anaemia|Hb drop)\b/i.test(problem.title) &&
      hbValues.length > 0 && hbValues.every((number) => number >= 11) &&
      !/\b(?:anemia|anaemia|Hb drop|bleed|melena|hematemesis|hematochezia|transfus|PRBC)\b/i.test(source);
    if (unsupportedAnemia) return [];
    const lines = problem.lines.filter((line) => {
      if (!/\b(?:Na|sodium|K|potassium|Hb|Hgb|Cr|creatinine|eGFR|INR|lactate|CRP)\b/i.test(line.text)) return true;
      return numericTokens(line.text).every((number) => allowedNumbers.has(number));
    });
    return [{ ...problem, lines }];
  });
}

function stripRepeatedAntibioticClause(value: string, antibiotic: string) {
  const escaped = antibiotic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  const parts = value.split(/;\s*|(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => pattern.test(part))) return value;
  return parts.filter((part) => !pattern.test(part)).join("; ");
}

function sanitizeRepeatedApContent(problems: SoapEditorProblem[]) {
  const next = problems.map((problem) => ({ ...problem, lines: problem.lines.map((line) => ({ ...line })) }));
  const seenLines = new Set<string>();
  next.forEach((problem) => {
    problem.lines = problem.lines.filter((line) => {
      const key = stripColorMarkup(line.text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
      if (key.length < 18 || !seenLines.has(key)) {
        if (key.length >= 18) seenLines.add(key);
        return true;
      }
      return false;
    });
  });

  const antibioticNames = [...new Set(extractActiveAntibioticNames(next.map((problem) => `${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).join("\n")))];
  antibioticNames.forEach((name) => {
    const ownerIndexes = next.flatMap((problem, index) =>
      extractActiveAntibioticNames(`${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).some((item) => item.toLowerCase() === name.toLowerCase()) ? [index] : [],
    );
    if (ownerIndexes.length < 2) return;
    const owner = ownerIndexes.sort((left, right) => {
      const score = (index: number) => /\b(?:infection|sepsis|pna|pneumonia|uti|meningitis|bacteremia|cellulitis|abscess|osteomyelitis)\b/i.test(next[index].title) ? 10 : 0;
      return score(right) - score(left) || left - right;
    })[0];
    ownerIndexes.filter((index) => index !== owner).forEach((index) => {
      next[index].lines = next[index].lines.flatMap((line) => {
        const text = stripRepeatedAntibioticClause(line.text, name);
        return text ? [{ ...line, text }] : [];
      });
    });
  });
  return next;
}

function attachSourceAntibioticsToAp(problems: SoapEditorProblem[], orderLines: SoapEditorLine[]) {
  const next = problems.map((problem) => ({ ...problem, lines: problem.lines.map((line) => ({ ...line })) }));
  orderLines.forEach((order) => {
    const antibiotics = extractActiveAntibioticNames(order.text);
    antibiotics.forEach((name) => {
      const allApText = next.map((problem) => `${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).join("\n");
      if (allApText.toLowerCase().includes(name.toLowerCase())) return;
      const owner = next.find((problem) => /\b(?:infection|sepsis|pna|pneumonia|uti|meningitis|bacteremia|cellulitis|abscess|osteomyelitis)\b/i.test(problem.title));
      if (!owner) return;
      owner.lines.push(editorLine(order.text, "ap"));
    });
  });
  return next;
}

function actionableModelWarnings(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))].filter((warning) =>
    /\b(?:critical|unstable|active bleeding|shock|code status|allergy|cannot verify|conflicting)\b/i.test(warning) &&
    !/\b(?:not supplied|not provided|without .*result|uncontextualized)\b/i.test(warning),
  );
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
  const sourceOwnedLabs = sourceHasLabs ? sourceLabEditorLines(params.sourceFields, params.value.objective.labs) : [];
  const sourceOwnedVitals = sourceHasVitals ? sourceVitalLines(params.sourceFields.vitals) : [];
  const sourceOwnedImages = sourceHasImages ? sourceImageEditorLines(params.sourceFields) : [];
  const sourceOwnedPathology = looksLikePathology(source) ? sourcePathologyEditorLines(params.sourceFields) : [];
  const sourceOwnedOrders = sourceHasOrders ? sourceOrderEditorLines(params.sourceFields) : [];
  const sourceOwnedLabText = sourceOwnedLabs.map((line) => line.text).join(" ");
  const generatedO = objectiveGroups(generated.oLines);
  const generatedTasks = splitSoapEditorTaskLines(generated.taskLines);
  const groundedProblems = sanitizeCandidateApProblems(
    params.value,
    generated,
    baseline,
    source,
    params.workflowMode,
    sourceOwnedLabText,
  );
  // Exact O/Lab values belong to the source parser, not the language model.
  // The same source-owned policy restores omitted vitals, imaging, pathology,
  // and orders instead of rejecting an otherwise useful draft.
  const repairedGenerated: SoapEditorDraft = {
    ...generated,
    oLines: [
      ...(sourceOwnedVitals.length > 0 ? sourceOwnedVitals : generatedO.vs),
      ...generatedO.pe,
      ...(sourceOwnedLabs.length > 0
        ? uniqueEditorLines([...sourceOwnedLabs, ...generatedO.lab.filter(isMicrobiologyLabLine)])
        : generatedO.lab),
      ...(sourceOwnedImages.length > 0 ? sourceOwnedImages : generatedO.image),
      ...uniqueEditorLines([...generatedO.other, ...sourceOwnedPathology]),
    ],
    apProblems: sanitizeRepeatedApContent(attachSourceAntibioticsToAp(groundedProblems, sourceOwnedOrders)),
    taskLines: uniqueEditorLines([...sourceOwnedOrders, ...generatedTasks.orderLines, ...generatedTasks.taskOnlyLines]),
  };
  let accepted = repairedGenerated;

  if (params.workflowMode === "dailyUpdate") {
    const priorO = objectiveGroups(baseline.oLines);
    const nextO = objectiveGroups(repairedGenerated.oLines);
    const priorTasks = splitSoapEditorTaskLines(baseline.taskLines);
    const nextTasks = splitSoapEditorTaskLines(repairedGenerated.taskLines);
    const mergedProblems = preserveReviewedProblems(repairedGenerated.apProblems, baseline.apProblems);
    accepted = {
      ...repairedGenerated,
      headerLines: baseline.headerLines,
      sLines: sourceHasOther ? repairedGenerated.sLines : baseline.sLines,
      oLines: [
        ...(sourceHasVitals ? nextO.vs : priorO.vs),
        ...(sourceHasOther && nextO.pe.length > 0 ? nextO.pe : priorO.pe),
        ...(sourceHasLabs ? nextO.lab : priorO.lab),
        ...(sourceHasImages ? mergeDailyImages(priorO.image, nextO.image) : priorO.image),
        ...(sourceHasOther && nextO.other.length > 0 ? uniqueEditorLines([...priorO.other, ...nextO.other]) : priorO.other),
      ],
      apProblems: sanitizeRepeatedApContent(attachSourceAntibioticsToAp(mergedProblems, sourceOwnedOrders)),
      taskLines: [
        ...(sourceHasOrders ? uniqueEditorLines([...priorTasks.orderLines, ...nextTasks.orderLines]) : priorTasks.orderLines),
        ...(sourceHasOther ? nextTasks.taskOnlyLines : priorTasks.taskOnlyLines),
      ],
      dcLines: sourceHasOther ? repairedGenerated.dcLines : baseline.dcLines,
    };
  }

  const fatalErrors: string[] = [];
  const candidateText = editorDraftToSoapText(generated);
  const acceptedText = editorDraftToSoapText(accepted);
  const finalDraft = accepted;
  const changed = changedSections(baseline, finalDraft);
  const warnings = actionableModelWarnings(params.value.warnings);
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
