import type { DailyNotesByPatient, SoapEditLineChange, SoapEditTrace } from "./types";

export interface SoapCorrectionLearningSummary {
  fingerprint: string;
  reviewedAiSaveCount: number;
  acceptedAiDraftCount: number;
  tendencies: string[];
}

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
  const acceptedAiDraftCount = traces.filter((trace) => trace.acceptedAiDraftWithoutEdits).length;
  const tendencies = [
    actionOnlyCount > 0 ? "Merge action-only A/P headings into the matching diagnosis." : "",
    duplicateTreatmentCount > 0 ? "State each antibiotic, oxygen, culture, and treatment under one problem only." : "",
    objectiveRestatementCount > 0 ? "Do not repeat raw V/S, lab, or image data in A/P without interpretation." : "",
    taskDcCount > 0 ? "Keep one-time actions in Tasks and disposition barriers in DC, not in A/P." : "",
    traces.length > 0 && acceptedAiDraftCount / traces.length >= 0.6 ? "Preserve the current reviewed SOAP voice and section structure with minimal rewriting." : "",
  ].filter(Boolean);

  return {
    fingerprint: traces.length > 0 ? fnv1a(traces.map(stableTraceKey).join("\n")) : "",
    reviewedAiSaveCount: traces.length,
    acceptedAiDraftCount,
    tendencies,
  };
}
