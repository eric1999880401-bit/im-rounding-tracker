import type { DailyNotesByPatient, SoapCorrectionRule, SoapEditLineChange, SoapEditTrace } from "./types";

export interface SoapCorrectionLearningSummary {
  fingerprint: string;
  reviewedAiSaveCount: number;
  acceptedAiDraftCount: number;
  confidence: "none" | "early" | "established";
  rules: SoapCorrectionRule[];
  tendencies: string[];
}

const correctionRuleText: Record<SoapCorrectionRule, string> = {
  mergeActionOnlyAp: "Merge action-only A/P headings into the matching diagnosis.",
  singleTreatmentOwner: "State each antibiotic, oxygen, culture, and treatment under one problem only.",
  interpretObjectiveInAp: "Do not repeat raw V/S, lab, or image data in A/P without interpretation.",
  separateTasksOrdersDc: "Keep medication orders in Orders, one-time actions in Tasks, and disposition barriers in DC.",
  preserveReviewedApTitles: "Preserve clinician-reviewed A/P titles and update evidence or treatment beneath them.",
  addSourceBackedProblems: "Add a distinct A/P problem when today's source supports a new active organ problem the clinician would otherwise add manually.",
  preserveReviewedOrders: "Treat reviewed medication orders as authoritative; replace only source-supported changes and never restore a superseded order.",
  preferSparseTasks: "Keep Tasks sparse: retain only pending one-time work and remove routine monitoring or duplicated plans.",
  preferConciseAp: "Prefer shorter synthesized A/P lines over copied course, objective data, or repeated plans.",
  retainDecisiveEvidence: "Keep one decisive value, date, study, culture, or treatment detail when it changes assessment or plan.",
};

function normalizeLine(value: string) {
  return String(value ?? "")
    .replace(/^!+\s*/, "")
    .replace(/^[-#*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isActionOnlyApChange(change: SoapEditLineChange) {
  if (change.section !== "ap") return false;
  const before = normalizeLine(change.before);
  return /^(?:continue|cont|complete|start|stop|hold|resume|restart|wean|review|adjust|monitor|follow(?:\s+up)?|f\/u|repeat|check|trend|order|arrange|consult|titrate|transition)\b/.test(before);
}

function isRepeatedTreatmentRemoval(change: SoapEditLineChange) {
  if (change.section !== "ap" || change.kind === "added") return false;
  const before = normalizeLine(change.before);
  return /\b(?:abx|antibiotic|teicoplanin|vancomycin|vanco|cef|meropenem|zosyn|pip\/tazo|oxygen|o2|nc\b|wean|culture|b\/c|bcx)\b/.test(before);
}

function isObjectiveRestatementRemoval(change: SoapEditLineChange) {
  if (change.section !== "ap" || change.kind === "added") return false;
  const before = normalizeLine(change.before);
  return /^(?:v\/s|vs|lab|image|img|cxr|ct\b|mri|echo)\s*:/.test(before) ||
    /\b(?:wbc|hb|hgb|plt|cr|bun|na|k\b|ast|alt|inr|spo2|bp|hr|rr)\s*-?\d/i.test(before);
}

function isApTitle(value: string) {
  return /^\s*#\s*\S/.test(String(value ?? ""));
}

function isApDetail(value: string) {
  return /^\s*-\s*\S/.test(String(value ?? ""));
}

function isDecisiveEvidence(value: string) {
  return /\b(?:\d+(?:\.\d+)?|abx|antibiotic|culture|b\/c|bcx|cxr|ct\b|mri\b|echo\b|procedure|drain|stent|biopsy|cef\w*|vanco\w*|teicoplanin|meropenem|pip\/?tazo|zosyn|apixaban|heparin|insulin|o2|oxygen)\b/i.test(value);
}

function correctionConfidence(traceCount: number): SoapCorrectionLearningSummary["confidence"] {
  if (traceCount === 0) return "none";
  return traceCount >= 3 ? "established" : "early";
}

function stableTraceKey(trace: SoapEditTrace) {
  return [trace.id, trace.savedAt, trace.workflowMode, trace.model, trace.acceptedAiDraftWithoutEdits ? "accepted" : "edited", trace.stats.added, trace.stats.removed, trace.stats.rewritten].join("|");
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function reviewedAiEditTraces(dailyNotesByPatient: DailyNotesByPatient, after = "") {
  return Object.values(dailyNotesByPatient)
    .flat()
    .flatMap((note) => note.soapEditHistory ?? [])
    .filter((trace) => trace.source === "ai" && (!after || trace.savedAt > after))
    .sort((left, right) => left.savedAt.localeCompare(right.savedAt) || left.id.localeCompare(right.id));
}

export function deriveSoapCorrectionLearning(dailyNotesByPatient: DailyNotesByPatient, after = ""): SoapCorrectionLearningSummary {
  const traces = reviewedAiEditTraces(dailyNotesByPatient, after);
  const changes = traces.flatMap((trace) => trace.changes);
  const actionOnlyCount = changes.filter(isActionOnlyApChange).length;
  const duplicateTreatmentCount = changes.filter(isRepeatedTreatmentRemoval).length;
  const objectiveRestatementCount = changes.filter(isObjectiveRestatementRemoval).length;
  const taskDcCount = changes.filter((change) => change.section === "tasks" || change.section === "dc" || change.section === "orders").length;
  const apTitleAdditions = changes.filter((change) => change.section === "ap" && change.kind === "added" && isApTitle(change.after)).length;
  const apTitleRewrites = changes.filter((change) => change.section === "ap" && change.kind === "rewritten" && isApTitle(change.before) && isApTitle(change.after)).length;
  const orderChanges = changes.filter((change) => change.section === "orders").length;
  const taskAdditions = changes.filter((change) => change.section === "tasks" && change.kind === "added").length;
  const taskRemovals = changes.filter((change) => change.section === "tasks" && change.kind === "removed").length;
  const apAdditions = changes.filter((change) => change.section === "ap" && change.kind === "added").length;
  const apRemovals = changes.filter((change) => change.section === "ap" && change.kind === "removed").length;
  const shortenedApRewrites = changes.filter((change) =>
    change.section === "ap" &&
    change.kind === "rewritten" &&
    change.before.length >= change.after.length + 18,
  ).length;
  const decisiveEvidenceAdditions = changes.filter((change) =>
    change.section === "ap" &&
    (change.kind === "added" || change.kind === "rewritten") &&
    isApDetail(change.after) &&
    isDecisiveEvidence(change.after),
  ).length;
  const decisiveEvidenceRemovals = changes.filter((change) =>
    change.section === "ap" &&
    change.kind !== "added" &&
    isApDetail(change.before) &&
    isDecisiveEvidence(change.before),
  ).length;
  const acceptedAiDraftCount = traces.filter((trace) => trace.acceptedAiDraftWithoutEdits).length;
  const rules: SoapCorrectionRule[] = [
    ...(actionOnlyCount > 0 ? ["mergeActionOnlyAp" as const] : []),
    ...(duplicateTreatmentCount > 0 ? ["singleTreatmentOwner" as const] : []),
    ...(objectiveRestatementCount > 0 ? ["interpretObjectiveInAp" as const] : []),
    ...(taskDcCount > 0 ? ["separateTasksOrdersDc" as const] : []),
    ...(apTitleRewrites > 0 || (traces.length > 0 && acceptedAiDraftCount / traces.length >= 0.6) ? ["preserveReviewedApTitles" as const] : []),
    ...(apTitleAdditions > 0 ? ["addSourceBackedProblems" as const] : []),
    ...(orderChanges > 0 ? ["preserveReviewedOrders" as const] : []),
    ...(taskRemovals > taskAdditions ? ["preferSparseTasks" as const] : []),
    ...(apRemovals > apAdditions || shortenedApRewrites > 0 ? ["preferConciseAp" as const] : []),
    ...(decisiveEvidenceAdditions > decisiveEvidenceRemovals ? ["retainDecisiveEvidence" as const] : []),
  ].filter((rule, index, values) => values.indexOf(rule) === index);
  const tendencies = rules.map((rule) => correctionRuleText[rule]);

  return {
    fingerprint: traces.length > 0 ? fnv1a(traces.map(stableTraceKey).join("\n")) : "",
    reviewedAiSaveCount: traces.length,
    acceptedAiDraftCount,
    confidence: correctionConfidence(traces.length),
    rules,
    tendencies,
  };
}
