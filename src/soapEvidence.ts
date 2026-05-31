import { parseSoapText, type SoapDraft } from "./soapDraft";

export type SoapEvidenceWarningKind = "missingHeader" | "antibioticGap" | "followUpGap";
export type SoapEvidenceSeverity = "critical" | "important";

export interface SoapEvidenceLineRef {
  section: "header" | "s" | "o" | "ap" | "tasks" | "dc" | "warnings";
  line: string;
  index: number;
}

export interface SoapSourceRef {
  section: SoapEvidenceLineRef["section"];
  line: string;
  sourceField: string;
  excerpt: string;
}

export interface SoapEvidenceWarning {
  id: string;
  kind: SoapEvidenceWarningKind;
  severity: SoapEvidenceSeverity;
  message: string;
  refs: SoapEvidenceLineRef[];
}

export interface SoapWhyItem {
  id: string;
  label: string;
  refs: SoapEvidenceLineRef[];
}

export interface SoapEvidenceBundle {
  missingData: SoapEvidenceWarning[];
  why: SoapWhyItem[];
  sourceRefs: SoapSourceRef[];
}

export type SoapSourceFields = Record<string, unknown>;

interface IndexedSoapLine extends SoapEvidenceLineRef {
  searchable: string;
}

const ABX_PATTERN =
  /\b(?:abx|antibiotic|ceftriaxone|cefepime|cefazolin|ceftazidime|ceftaroline|cefuroxime|cefmetazole|ampicillin|sulbactam|unasyn|augmentin|amoxicillin|piperacillin|tazobactam|pip\/?tazo|zosyn|meropenem|ertapenem|imipenem|vancomycin|vanco|teicoplanin|linezolid|daptomycin|levofloxacin|moxifloxacin|ciprofloxacin|azithro(?:mycin)?|clarithro(?:mycin)?|doxy(?:cycline)?|metronidazole|flagyl|clindamycin|bactrim|tmp-?smx|acyclovir|fluconazole|micafungin)\b/i;
const CULTURE_OR_SOURCE_PATTERN = /\b(?:b\/c|bcx|blood culture|sputum|urine culture|u\/c|wound culture|culture|cx|source|pna|pneumonia|uti|cellulitis|abscess|cholangitis|line infection|bacteremia|sepsis)\b/i;
const DURATION_PATTERN = /\b(?:\d{1,2}\/\d{1,2}\s*-|day\s*\d+|d\s*\d+|x\s*\d+\s*d|for\s*\d+\s*d|stop date|duration|de-?escalat|until|through)\b/i;

const FOLLOW_UP_RULES = [
  {
    id: "aki-hyperk-follow-up",
    trigger: /\b(?:aki|acute kidney|renal failure|cr\s*(?:[>=]?\s*)?\d|creatinine|hyperk|hyperkal|k\s*(?:[>=]\s*)?(?:5\.[5-9]|6(?:\.\d)?|7(?:\.\d)?))\b/i,
    followUp: /\b(?:repeat|trend|f\/u|follow|bmp|cmp|cr\/k|renal follow|renal consult|lytes|electrolyte|i\/o|urine|uop|hold|nephrotoxin|acei|arb|lokelma|kayexalate|calcium gluconate|insulin|dialysis|consult)\b/i,
    message: "AKI/hyperK signal needs obvious Cr/K, urine output, medication, repeat-lab, or renal follow-up.",
  },
  {
    id: "sepsis-follow-up",
    trigger: /\b(?:sepsis|septic|shock|lactate|bacteremia|fever.*hypotension|hypotension.*fever)\b/i,
    followUp: /\b(?:culture|b\/c|bcx|cx|lactate|source|source control|abx|antibiotic|fluid|bp|pressor|map|id\b|repeat|trend)\b/i,
    message: "Sepsis-like signal needs culture/source, lactate/hemodynamic, antibiotic, or source-control follow-up.",
  },
  {
    id: "bleeding-follow-up",
    trigger: /\b(?:bleed|bleeding|melena|hematemesis|hematochezia|ugib|gib|hb\s*(?:[<=]?\s*)?(?:[5-7](?:\.\d)?|drop)|anemia.*hypotension)\b/i,
    followUp: /\b(?:repeat|trend|cbc|serial\s+(?:hb|hgb)|transfus|prbc|type\s*&\s*screen|t&s|egd|scope|gi consult|consult gi|ppi|hold.*(?:ac|anticoag|apixaban|heparin|warfarin)|inr|coag)\b/i,
    message: "Bleeding-like signal needs Hb/CBC trend, transfusion, endoscopy/GI, coagulopathy, or anticoagulation follow-up.",
  },
] as const;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return normalizeKey(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 12);
}

function indexedLinesFromDraft(draft: SoapDraft): IndexedSoapLine[] {
  const lines: IndexedSoapLine[] = [];
  const add = (section: IndexedSoapLine["section"], values: string[]) => {
    values.forEach((value, index) => {
      const line = cleanText(value);
      if (line) lines.push({ section, line, index, searchable: normalizeKey(line) });
    });
  };

  add("header", draft.header);
  add("s", draft.sLines);
  add("o", draft.oLines);
  draft.apProblems.forEach((problem, problemIndex) => {
    const title = cleanText(problem.title);
    if (title) lines.push({ section: "ap", line: title, index: problemIndex, searchable: normalizeKey(title) });
    problem.lines.forEach((value, lineIndex) => {
      const line = cleanText(value);
      if (line) lines.push({ section: "ap", line, index: lineIndex, searchable: normalizeKey(line) });
    });
  });
  add("tasks", draft.taskLines);
  add("dc", draft.dcLines);
  add("warnings", draft.warnings);
  return lines;
}

function lineRef(line: IndexedSoapLine): SoapEvidenceLineRef {
  return { section: line.section, line: line.line, index: line.index };
}

function addWarning(warnings: SoapEvidenceWarning[], warning: SoapEvidenceWarning) {
  if (warnings.some((item) => item.id === warning.id)) return;
  warnings.push(warning);
}

function deriveMissingHeaderWarnings(lines: IndexedSoapLine[], warnings: SoapEvidenceWarning[]) {
  const headerText = lines.filter((line) => line.section === "header").map((line) => line.line).join("\n");
  const refs = lines.filter((line) => line.section === "header").slice(0, 2).map(lineRef);
  const hasCode = /\bcode\s*(?:status)?\b/i.test(headerText);
  const hasAllergy = /\b(?:allerg(?:y|ies)|nka|nkda)\b/i.test(headerText);

  if (!hasCode || /\bcode\s*(?:status)?\s*:\s*(?:missing|unknown|unclear|not documented)\b/i.test(headerText)) {
    addWarning(warnings, {
      id: "missing-code-status",
      kind: "missingHeader",
      severity: "critical",
      message: "Code status missing or unclear in SOAP header.",
      refs,
    });
  }
  if (!hasAllergy || /\ballerg(?:y|ies)\s*:\s*(?:missing|unknown|unclear|not documented)\b/i.test(headerText)) {
    addWarning(warnings, {
      id: "missing-allergy",
      kind: "missingHeader",
      severity: "critical",
      message: "Allergy missing or unclear in SOAP header.",
      refs,
    });
  }
}

function deriveAntibioticWarnings(lines: IndexedSoapLine[], warnings: SoapEvidenceWarning[]) {
  const abxLines = lines.filter((line) => ABX_PATTERN.test(line.line));
  if (abxLines.length === 0) return;
  const allText = lines.map((line) => line.line).join("\n");
  const missingCultureOrSource = !CULTURE_OR_SOURCE_PATTERN.test(allText);
  const missingDuration = !DURATION_PATTERN.test(allText);
  if (!missingCultureOrSource && !missingDuration) return;

  addWarning(warnings, {
    id: "antibiotic-culture-source-duration",
    kind: "antibioticGap",
    severity: "important",
    message: `Antibiotic present; clarify ${[
      missingCultureOrSource ? "culture/source" : "",
      missingDuration ? "day count/duration or stop/de-escalation plan" : "",
    ].filter(Boolean).join(" and ")}.`,
    refs: abxLines.slice(0, 3).map(lineRef),
  });
}

function deriveFollowUpWarnings(lines: IndexedSoapLine[], warnings: SoapEvidenceWarning[]) {
  for (const rule of FOLLOW_UP_RULES) {
    const triggerLines = lines.filter((line) => rule.trigger.test(line.line));
    if (triggerLines.length === 0) continue;
    const linkedText = triggerLines.map((line) => line.line).join("\n");
    const fullText = lines.map((line) => line.line).join("\n");
    if (rule.followUp.test(linkedText) || rule.followUp.test(fullText)) continue;
    addWarning(warnings, {
      id: rule.id,
      kind: "followUpGap",
      severity: "important",
      message: rule.message,
      refs: triggerLines.slice(0, 3).map(lineRef),
    });
  }
}

function deriveWhyItems(lines: IndexedSoapLine[]): SoapWhyItem[] {
  const groups = [
    { id: "abx-infection", label: "Infection/antibiotic signal", pattern: new RegExp(`${ABX_PATTERN.source}|culture|b\\/c|bcx|bacteremia|sepsis`, "i") },
    { id: "renal-electrolyte", label: "Renal/electrolyte risk", pattern: FOLLOW_UP_RULES[0].trigger },
    { id: "bleeding-anemia", label: "Bleeding/anemia risk", pattern: FOLLOW_UP_RULES[2].trigger },
    { id: "discharge", label: "Discharge/disposition item", pattern: /\b(?:dc|discharge|dispo|snf|rehab|home care|opd|follow-?up)\b/i },
  ];

  return groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      refs: lines.filter((line) => group.pattern.test(line.line)).slice(0, 4).map(lineRef),
    }))
    .filter((item) => item.refs.length > 0);
}

function deriveSourceRefs(lines: IndexedSoapLine[], sourceFields: SoapSourceFields): SoapSourceRef[] {
  const sourceEntries = Object.entries(sourceFields)
    .map(([field, value]) => ({ field, text: cleanText(value) }))
    .filter((entry) => entry.text.length > 0);
  if (sourceEntries.length === 0) return [];

  const refs: SoapSourceRef[] = [];
  for (const line of lines) {
    const lineTokens = tokens(line.line);
    if (lineTokens.length === 0) continue;
    const match = sourceEntries.find((entry) => {
      const sourceKey = normalizeKey(entry.text);
      const sourceTokenCount = tokens(entry.text).length;
      const matched = lineTokens.filter((token) => sourceKey.includes(token)).length;
      return matched >= Math.max(1, Math.min(3, lineTokens.length, sourceTokenCount));
    });
    if (!match) continue;
    refs.push({
      section: line.section,
      line: line.line,
      sourceField: match.field,
      excerpt: match.text.length > 100 ? `${match.text.slice(0, 97).trim()}...` : match.text,
    });
    if (refs.length >= 8) break;
  }
  return refs;
}

export function deriveSoapEvidence(soapText: string, sourceFields: SoapSourceFields = {}): SoapEvidenceBundle {
  const draft = parseSoapText(soapText);
  const lines = indexedLinesFromDraft(draft);
  const missingData: SoapEvidenceWarning[] = [];

  deriveMissingHeaderWarnings(lines, missingData);
  deriveAntibioticWarnings(lines, missingData);
  deriveFollowUpWarnings(lines, missingData);

  return {
    missingData,
    why: deriveWhyItems(lines),
    sourceRefs: deriveSourceRefs(lines, sourceFields),
  };
}
