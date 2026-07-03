// Shared text/numeric helpers and plan-append primitives for clinical rules.
// Extracted from clinicalKnowledge.ts (Phase 4 refactor).
import type {
  ClinicalFactBundle,
  ClinicalRuleMatch,
  ClinicalRuleSeverity,
  ClinicalSourceRef,
  GeneratedClinicalPlan,
  TaskCategory,
  TaskPriority,
} from "../types";
import type { KnowledgeScope } from "./references";

export function cleanText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export function lineText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

export function splitLines(value: string) {
  const normalized = value.replace(
    /\s+(?=(?:dx|diagnosis|pmh|underlying|icu course|hospital course|course|today|overnight|vs|v\/s|pe|lab|image|tasks?|pending|red flags?|disposition|dispo)\b\s*[:：]?)/gi,
    "\n",
  );
  return normalized
    .split(/\r?\n|;(?=\s*[A-Z#]|\s*[0-9]|\s*[\u4e00-\u9fff])/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function dedupe(items: string[]) {
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



export function linesMatching(lines: string[], pattern: RegExp, maxItems = 6) {
  return dedupe(lines.filter((line) => pattern.test(line))).slice(0, maxItems);
}

export function maxBloodPressure(text: string) {
  let maxSbp = 0;
  let maxDbp = 0;
  for (const match of text.matchAll(/\b(?:bp|b\/p|sbp|blood pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi)) {
    maxSbp = Math.max(maxSbp, Number(match[1] ?? 0));
    maxDbp = Math.max(maxDbp, Number(match[2] ?? 0));
  }
  return { maxSbp, maxDbp };
}

export function latestBloodPressure(text: string) {
  const matches = Array.from(text.matchAll(/\b(?:bp|b\/p|blood pressure)\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi));
  const last = matches.length > 0 ? matches[matches.length - 1] : undefined;
  if (!last) return null;
  return { sbp: Number(last[1]), dbp: Number(last[2]) };
}

export function hasCurrentStableBloodPressure(text: string) {
  const stable = (sbp: number, dbp: number) => sbp >= 90 && dbp >= 50;
  for (const match of text.matchAll(/\b(?:current|today|latest|now|v\/s|vs|vital signs?|off service note|on arrival|transfer)\b[\s\S]{0,160}\bbp\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi)) {
    if (stable(Number(match[1]), Number(match[2]))) return true;
  }
  for (const match of text.matchAll(/\bbp\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b[\s\S]{0,100}\b(?:stable|recovered|improved|off pressor|no hypotension)\b/gi)) {
    if (stable(Number(match[1]), Number(match[2]))) return true;
  }
  return false;
}

export function maxNumberAfter(pattern: RegExp, text: string) {
  let max: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) max = Math.max(max ?? value, value);
  }
  return max;
}

export function latestNumberAfter(pattern: RegExp, text: string) {
  let latest: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) latest = value;
  }
  return latest;
}

export function minNumberAfter(pattern: RegExp, text: string) {
  let min: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) min = Math.min(min ?? value, value);
  }
  return min;
}

export function hasResolvedHemodynamicShock(text: string) {
  const latestBp = latestBloodPressure(text);
  const currentBpStable = Boolean(latestBp && latestBp.sbp >= 90 && latestBp.dbp >= 50);
  const recoveryPhrase =
    /(after\s+fluid\s+challenge[\s\S]{0,180}(?:bp|blood pressure)\s+(?:recovered|improved)|(?:bp|blood pressure)\s+(?:recovered|improved)|shock\s+(?:resolved|improved)|(?:resolved|improved)[^.]{0,50}\bshock|off\s+(?:pressor|norepi)|pressor\s+off|norepi\s+(?:stopped|off)|fluid[- ]responsive|hypovolemia\s+(?:was\s+)?impressed|no\s+hypotension)/i.test(text);
  const resolvedCoursePhrase =
    /\b(?:initial|ed|prior|previous|past|5\/7|2026-\d{2}-\d{2})\b[\s\S]{0,80}\b(?:shock|hypotension)|shock\s+after\s+syncope|syncope\/loc[\s\S]{0,80}\bshock|responded\s+to\s+iv\s+fluids?/i.test(text);
  return (currentBpStable || hasCurrentStableBloodPressure(text)) && (recoveryPhrase || resolvedCoursePhrase);
}

export function hasUnresolvedShockSignal(text: string) {
  return /\b(shock|pressor|norepi|hypotension|septic shock)\b/i.test(text) && !hasResolvedHemodynamicShock(text);
}

export function wbcValuesInK(text: string) {
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

export function minWbc(text: string) {
  const values = wbcValuesInK(text);
  if (values.length === 0) return null;
  return Math.min(...values);
}

export function preferredDisplayWbc(text: string) {
  const values = dedupe(wbcValuesInK(text).map((value) => String(value))).map(Number).sort((left, right) => left - right);
  if (values.length === 0) return null;
  const likelyDecimalLabValue = values.find((value) => value > 1.05 && value < 2);
  if (values.includes(1) && likelyDecimalLabValue) return likelyDecimalLabValue;
  return values[0];
}

export function formatWbc(value: number | null) {
  if (value === null) return "";
  return Number.isInteger(value) ? `${value}k` : `${value.toFixed(1).replace(/\.0$/, "")}k`;
}

export function minAnc(text: string) {
  return minNumberAfter(/\banc\s*(?:-|:|=)?\s*(\d+(?:\.\d+)?)/gi, text);
}

export function feverOrInfectionContext(text: string) {
  return /\b(neutropenic fever|febrile neutropen|fever\s*(?:to|up to|38|39)|bt\s*3[89]|temp\s*3[89]|infect|infection|cellulitis|abscess|culture|abx|antibiotic|cef|vanco|mero|pip\/tazo|inf\s+take\s+over|ramsay|zoster|ear\s+swelling|ear\s+discharge)\b/i.test(text);
}

export function currentlyAfebrile(text: string) {
  return /\b(afebrile|no fever|temp\s*3[5-7](?:\.\d)?|bt\s*3[5-7](?:\.\d)?)\b/i.test(text);
}

export function leukopeniaContext(text: string) {
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

export function appendRedFlag(
  plan: GeneratedClinicalPlan,
  text: string,
  reason: string,
  severity: ClinicalRuleSeverity,
  sourceRefsForRule: ClinicalSourceRef[],
) {
  plan.redFlags.push({ text, reason, severity, sourceRefs: sourceRefsForRule });
}

export function appendTask(
  plan: GeneratedClinicalPlan,
  text: string,
  category: TaskCategory,
  reason: string,
  sourceRefsForRule: ClinicalSourceRef[],
  priority: TaskPriority = "normal",
) {
  plan.todayTasks.push({ text, category, reason, priority, sourceRefs: sourceRefsForRule });
}

export function appendAp(
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


export function hasMatch(matches: ClinicalRuleMatch[], id: KnowledgeScope) {
  return matches.some((match) => match.id === id);
}

