import { classifyClinicalLine } from "./clinicalLineClassifier";
import { imageStudyKey } from "./clinicalFieldRouter";
import { ensureAntibioticApInDraft, extractActiveAntibioticNames } from "./antibioticPlan";
import {
  parseMedicationOrders,
  summarizeMedicationOrders,
  type MedicationOrderCategory,
} from "./medicationOrderParser";
import { formatLabVisualSummaryFromLines } from "./labVisualSummary";
import { isPathologyResultLine, objectiveKindFromLine, prefixedObjectiveLine, sanitizeObjectiveLines } from "./objectiveLineSanitizer";
import { formatSoapDraft, parseSoapText, splitGuidedSoapSource, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { parseLabReports, safeClinicalLine, safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";
import type { SoapPatch } from "./types";

export type RoundSoapWorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff" | "repairSoap";

export type SoapDeltaSection =
  | "header"
  | "s"
  | "vs"
  | "pe"
  | "lab"
  | "image"
  | "other"
  | "ap"
  | "orders"
  | "tasks"
  | "dc";

export interface RoundSoapSourceFields {
  vitals?: string;
  labs?: string;
  images?: string;
  orders?: string;
  other?: string;
  admission?: string;
  lastSoap?: string;
  // Validator-only copy of the paste before table routing/sanitization.
  rawSource?: string;
}

export interface SoapDeltaChangedSection {
  id: SoapDeltaSection;
  label: string;
  risk: "normal" | "high";
  reason: string;
  blocked: boolean;
}

export interface SoapDeltaReview {
  workflowMode: RoundSoapWorkflowMode;
  baselineText: string;
  candidateText: string;
  acceptedText: string;
  changedSections: SoapDeltaChangedSection[];
  warnings: string[];
  highRiskWarnings: string[];
}

interface ObjectiveGroups {
  vs: string[];
  pe: string[];
  lab: string[];
  image: string[];
  other: string[];
}

const sectionLabels: Record<SoapDeltaSection, string> = {
  header: "Header",
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "Lab",
  image: "Image",
  other: "O/Other",
  ap: "A/P",
  orders: "\u85e5\u56d1",
  tasks: "Tasks",
  dc: "DC",
};
sectionLabels.orders = "\u85e5\u56d1";

function normalizeLine(value: string) {
  return stripColorMarkup(String(value ?? ""))
    .replace(/^!+\s*/, "")
    .replace(/^[-*#]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeLines(values: string[]) {
  return values.map(normalizeLine).filter(Boolean).join("\n");
}

function uniqueLines(values: string[], maxItems = 20) {
  const seen = new Set<string>();
  const next: string[] = [];
  values
    .map((line) => safeClinicalLinePreservingMarks(line, 160))
    .filter((line) => !isObviousPastedNoise(line))
    .filter(Boolean)
    .forEach((line) => {
      const key = normalizeLine(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      next.push(line);
    });
  return next.slice(0, maxItems);
}

function isObviousPastedNoise(line: string) {
  return /\b(?:ignore old duplicate|random copy-noise|copy-noise)\b/i.test(line);
}

function sameLines(a: string[], b: string[]) {
  return normalizeLines(a) === normalizeLines(b);
}

function sameProblems(a: SoapApProblem[], b: SoapApProblem[]) {
  return normalizeLines(a.flatMap((problem) => [problem.title, ...problem.lines])) === normalizeLines(b.flatMap((problem) => [problem.title, ...problem.lines]));
}

function meaningfulTokens(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "with",
    "without",
    "from",
    "for",
    "this",
    "that",
    "today",
    "patient",
    "continue",
    "cont",
    "follow",
    "up",
    "monitor",
    "closely",
    "stable",
    "improving",
    "improved",
    "pending",
  ]);
  return String(value ?? "")
    .toLowerCase()
    .match(/[a-z][a-z0-9/+-]{1,}|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}/g)
    ?.filter((token) => !stopWords.has(token)) ?? [];
}

function lineHasSourceSupport(line: string, sourceText: string, baselineText: string) {
  const clean = normalizeLine(line);
  if (!clean) return true;
  if (baselineText && baselineText.toLowerCase().includes(clean)) return true;
  const source = sourceText.toLowerCase();
  if (source.includes(clean)) return true;

  const tokens = meaningfulTokens(line);
  if (tokens.length === 0) return true;
  const sourceTokens = new Set(meaningfulTokens(sourceText));
  const matching = tokens.filter((token) => sourceTokens.has(token));
  const hasNumericAnchor = tokens.some((token) => /^\d/.test(token) && sourceTokens.has(token));
  const hasClinicalAnchor = matching.some((token) =>
    /^(?:bp|hr|rr|spo2|o2|nc|ra|wbc|hb|plt|cr|bun|na|sodium|hypernatremia|hyponatremia|k|inr|lactate|crp|cx|b\/c|bcx|uc|c\/s|ct|cxr|mri|us|abx|cef|ceftriaxone|vanco|vancomycin|mero|meropenem|teicoplanin|apixaban|heparin|insulin|lasix|aki|pna|uti|sepsis|shock|bleed|dc|opd|rehab)$/i.test(token),
  );
  return hasNumericAnchor || hasClinicalAnchor || matching.length >= Math.min(2, tokens.length);
}

function filterUnsupportedDailyLines(lines: string[], fields: RoundSoapSourceFields, baselineText: string, sectionLabel: string) {
  const sourceText = sourceFieldsText(fields);
  const blocked: string[] = [];
  const accepted = lines.filter((line) => {
    const supported = lineHasSourceSupport(line, sourceText, baselineText);
    if (!supported) blocked.push(line);
    return supported;
  });
  return {
    accepted,
    warnings: blocked.length > 0 ? [`${sectionLabel} line(s) without pasted-source support were held for review.`] : [],
  };
}

function filterUnsupportedDailyAp(problems: SoapApProblem[], fields: RoundSoapSourceFields, baselineText: string) {
  const warnings: string[] = [];
  const filtered = problems.map((problem) => {
    const titleSupported = lineHasSourceSupport(problem.title, sourceFieldsText(fields), baselineText);
    const lines = filterUnsupportedDailyLines(problem.lines, fields, baselineText, "A/P").accepted;
    if (problem.lines.length > lines.length || (!titleSupported && !problemBucket(problem))) {
      warnings.push("A/P line(s) without pasted-source support were held for review.");
    }
    if (!titleSupported && lines.length === 0) {
      warnings.push("Unsupported A/P problem title was held for review.");
      return { title: "", lines: [] };
    }
    return { title: problem.title, lines };
  }).filter((problem) => problem.title || problem.lines.length > 0);
  return {
    problems: filtered,
    warnings: uniqueLines(warnings, 2),
  };
}

function lineKind(line: string): keyof ObjectiveGroups {
  const text = String(line ?? "").replace(/^!+\s*/, "");
  const sanitizedKind = objectiveKindFromLine(text);
  if (isPathologyResultLine(text)) return "other";
  if (sanitizedKind === "vs" || sanitizedKind === "pe" || sanitizedKind === "lab" || sanitizedKind === "image") return sanitizedKind;
  if (/^(?:image|img)\s*:/i.test(text) || /\b(?:CT|MRI|CXR|sono|ultrasound|US\b|echo|ERCP|EGD|colonoscopy|impression)\b/i.test(text)) return "image";
  if (/^(?:v\/s|vs|vitals?)\s*:/i.test(text) || /\b(?:BP|HR|RR|SpO2|T\s*\d|afebrile|pressor|norepi|oxygen|O2|NC\s*\d*L?|RA)\b/i.test(text)) return "vs";
  if (/^pe\s*:.*\b(?:shock|pressor|norepi|hemodynamic|BP|SpO2|oxygen|O2|NC\s*\d*L?|RA)\b/i.test(text)) return "vs";
  if (/^pe\s*:/i.test(text)) return "pe";
  if (/^(?:lab)\s*:/i.test(text) || /\b(?:WBC|Neu|Hb|Hct|Plt|platelet|INR|PT|aPTT|T-?bil|D-?bil|AST|ALT|ALP|GGT|Cr|BUN|Na|K\b|Mg|Ca|Phos|lactate|CRP|troponin|culture|Cx|B\/C|BCx)\b/i.test(text)) return "lab";
  const classified = classifyClinicalLine(line, { fallbackKind: "other" });
  if (classified.kind === "vs") return "vs";
  if (classified.kind === "lab") return "lab";
  if (classified.kind === "image") return "image";
  return "other";
}

function splitObjective(lines: string[]): ObjectiveGroups {
  const groups: ObjectiveGroups = { vs: [], pe: [], lab: [], image: [], other: [] };
  sanitizeObjectiveLines(lines).accepted.forEach((line) => {
    const kind = line.kind === "other" ? lineKind(line.text) : line.kind;
    groups[kind].push(line.text);
  });
  return groups;
}

function mergeObjective(groups: ObjectiveGroups, maxItems = 18) {
  return uniqueLines(
    [
      ...groups.vs.map((line) => ensureObjectivePrefix(line, "V/S")),
      ...groups.pe.map((line) => ensureObjectivePrefix(line, "PE")),
      ...groups.lab.map((line) => ensureObjectivePrefix(line, "Lab")),
      ...groups.image.map((line) => ensureObjectivePrefix(line, "Image")),
      ...groups.other,
    ],
    maxItems,
  );
}

function ensureObjectivePrefix(line: string, prefix: "V/S" | "PE" | "Lab" | "Image") {
  const sanitized = sanitizeObjectiveLines([line]).accepted[0];
  const clean = sanitized?.text ?? "";
  if (!clean) return "";
  const tone = clean.match(/^!+\s*/)?.[0] ?? "";
  const withoutTone = clean.replace(/^!+\s*/, "").trim();
  const existing = withoutTone.match(/^(v\/s|vs|vitals?|pe|physical exam|lab|image|img)\s*:\s*(.+)$/i);
  if (existing) {
    const existingKind = existing[1].toLowerCase();
    const targetMatches =
      (prefix === "V/S" && /^(?:v\/s|vs|vitals?)$/.test(existingKind)) ||
      (prefix === "PE" && /^(?:pe|physical exam)$/.test(existingKind)) ||
      (prefix === "Lab" && existingKind === "lab") ||
      (prefix === "Image" && /^(?:image|img)$/.test(existingKind));
    if (targetMatches) return clean;
    return `${tone}${prefix}: ${existing[2]}`.trim();
  }
  return `${prefix}: ${clean}`;
}

function isOrderLine(line: string) {
  const text = String(line ?? "").replace(/^!+\s*/, "").trim();
  if (/^\s*\u85e5\u56d1\s*[:\uFF1A]/i.test(text)) return true;
  if (/^\s*(?:order|orders?|meds?|\u85e5\u56d1)\s*[:\uFF1A]/i.test(text)) return true;
  if (/^\s*(?:check|monitor|f\/u|follow|repeat|update|arrange|call|obtain|assess)\b/i.test(text)) return false;
  return (
    /^\s*(?:order|orders?|meds?|\u85e5\u56d1)\s*[:\uFF1A]/i.test(text) ||
    /^\s*(?:Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*:/i.test(text) ||
    /\b(?:teicoplanin|vancomycin|ceftriaxone|cefepime|zosyn|pip\/tazo|meropenem|levofloxacin|heparin|apixaban|warfarin|insulin|lasix|furosemide|steroid|methylpred|oxygen|morphine|fentanyl)\b/i.test(text)
  );
}

function sanitizeDraftObjective(draft: SoapDraft) {
  const sanitized = sanitizeObjectiveLines(draft.oLines);
  return {
    draft: {
      ...draft,
      oLines: sanitized.accepted.map(prefixedObjectiveLine),
    },
    rejected: sanitized.rejected,
  };
}

const highYieldNonAntibioticMedicationPattern = /\b(?:apixaban|heparin|warfarin|insulin|norepi(?:nephrine)?|vasopressin)\b/gi;

function criticalSourceLabTokens(value: string) {
  const next: string[] = [];
  const pattern = /\b(Na|K|Cr|Hb|Hgb|INR|AST|ALT|lactate)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const label = match[1];
    const key = label.toLowerCase();
    const numeric = Number(match[2]);
    const critical =
      (key === "na" && (numeric <= 125 || numeric >= 150)) ||
      (key === "k" && (numeric <= 3 || numeric >= 5.5)) ||
      (key === "cr" && numeric >= 2) ||
      ((key === "hb" || key === "hgb") && numeric < 8) ||
      (key === "inr" && numeric >= 3) ||
      ((key === "ast" || key === "alt") && numeric >= 200) ||
      (key === "lactate" && numeric >= 2);
    if (critical) next.push(`${label} ${match[2]}`);
  }
  return [...new Set(next)];
}

function sourceCoverageWarnings(sourceText: string, candidateText: string) {
  const source = String(sourceText ?? "");
  const candidate = String(candidateText ?? "");
  const warnings: string[] = [];
  const medicationNames = [
    ...extractActiveAntibioticNames(source),
    ...new Set((source.match(highYieldNonAntibioticMedicationPattern) ?? []).map((item) => item.toLowerCase())),
  ];
  medicationNames.forEach((name) => {
    if (!candidate.toLowerCase().includes(name)) warnings.push(`AI omitted source medication '${name}'; verify A/P or Orders before saving.`);
  });
  criticalSourceLabTokens(source).forEach((token) => {
    if (!candidate.toLowerCase().includes(token.toLowerCase())) warnings.push(`AI omitted high-yield source lab '${token}'; verify O/Lab and A/P before saving.`);
  });
  ["CXR", "CT", "MRI", "Echo"].forEach((study) => {
    if (new RegExp(`\\b${study}\\b`, "i").test(source) && !new RegExp(`\\b${study}\\b`, "i").test(candidate)) {
      warnings.push(`AI omitted source study '${study}'; verify O/Image before saving.`);
    }
  });
  return warnings;
}

export function soapBaselineHash(value: string) {
  let hash = 0x811c9dc5;
  const text = String(value ?? "").trim();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function soapPatchMatchesBaseline(patch: SoapPatch | undefined, baselineText: string) {
  return !patch || patch.baselineHash === soapBaselineHash(baselineText);
}

function splitTasks(lines: string[]) {
  const highYield = lines.filter((line) => !isLowValueRoutineOrderLine(line));
  return {
    orders: highYield.filter(isOrderLine),
    tasks: highYield.filter((line) => !isOrderLine(line)),
  };
}

function isLowValueRoutineOrderLine(line: string) {
  const text = String(line ?? "").toLowerCase();
  if (!/\b(routine|pantoprazole|ppi|senna|softener|vitamin|acetaminophen prn|prn fever)\b/.test(text)) return false;
  return !/\b(gi bleed|ugib|melena|hematemesis|active bleed|steroid|anticoag|apixaban|warfarin|heparin|insulin|abx|antibiotic|culture|source)\b/.test(text);
}

function sourceHas(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function sourceFieldsText(fields: RoundSoapSourceFields) {
  return [
    fields.vitals,
    fields.labs,
    fields.images,
    fields.orders,
    fields.other,
    fields.admission,
    fields.lastSoap,
  ]
    .filter(sourceHas)
    .join("\n");
}

function uniqueSourceValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [text];
  });
}

function mergeSourceText(...values: unknown[]) {
  return uniqueSourceValues(values).join("\n");
}

function sourceObjectiveInputs(fields: RoundSoapSourceFields) {
  const distinctSource = uniqueSourceValues([
    fields.vitals,
    fields.labs,
    fields.images,
    fields.orders,
    fields.other,
    fields.admission,
    fields.lastSoap,
  ]).join("\n");
  const routed = splitGuidedSoapSource(distinctSource);
  return {
    vitals: mergeSourceText(fields.vitals, routed.vitals),
    labs: mergeSourceText(fields.labs, routed.labs),
    images: mergeSourceText(fields.images, routed.images),
    other: mergeSourceText(fields.other, routed.other),
  };
}

function sourceFragments(value: string) {
  return String(value ?? "")
    .split(/\r?\n|(?<=[.;])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isUsableSourceLabLine(value: string) {
  const text = stripColorMarkup(String(value ?? ""));
  const hasNumericResult = /\b(?:WBC|Neu|Neut|Lym|Mono|Eos|Baso|RBC|Hb|Hgb|Hct|MCV|MCH|MCHC|RDW|Plt|Platelet|MPV|MDW|BUN|Cr|CRE|Creatinine|e?GFR|Na|K|Cl|Ca|Mg|Phos|P|Osm|AST|ALT|ALP|GGT|T-?Bil|D-?Bil|Alb|PT|INR|aPTT|CRP|hsCRP|PCT|Lactate|pH|pCO2|pO2|HCO3|BE|Troponin|BNP)\s*(?:[:=]\s*)?[<>]?\s*-?\d+(?:\.\d+)?/i.test(text);
  const hasMicroResult = /\b(?:blood|urine|sputum|CSF|stool)\s*(?:culture|Cx)\b.*\b(?:positive|negative|growth|isolated|NGTD|susceptib|resistan|pending)\b|\b(?:B\/C|BCx|U\/C|UCx)\b.*\b(?:positive|negative|growth|NGTD|pending)\b/i.test(text);
  const hasStoolResult = /\b(?:O\s*&\s*P|O\/P|occult blood|FOBT|C\.?\s*difficile|C\.?\s*diff)\b.*\b(?:positive|negative|neg\.?|detected|not detected)\b/i.test(text);
  return hasNumericResult || hasMicroResult || hasStoolResult;
}

function sourceVitalsLines(value: string) {
  return uniqueLines(
    sourceFragments(value)
      .filter((line) => /\b(?:BP|HR|RR|SpO2|SaO2|temperature|temp|pulse)\s*[:=]?\s*\d|\bT\s*[:=]?\s*\d{2}(?:\.\d+)?|\b(?:afebrile|febrile|room air|RA|nasal cannula|NC\s*\d*\s*L)\b/i.test(line))
      .map((line) => line
        .replace(/^(?:V\/S|VS|Vitals?)\s*[:\uFF1A]\s*/i, "")
        .replace(/\s+(?=(?:BP|HR|RR|SpO2|SaO2|T(?:emp(?:erature)?)?|Pulse)\b)/gi, ", ")
        .replace(/,\s*,+/g, ", ")
        .trim()),
    4,
  );
}

function lineNumericTokens(value: string) {
  return String(value ?? "").match(/-?\d+(?:\.\d+)?/g)?.map((item) => item.replace(/^0+(?=\d)/, "")) ?? [];
}

function lineUsesSourceNumbers(line: string, sourceLines: string[]) {
  const candidateNumbers = lineNumericTokens(line);
  if (candidateNumbers.length < 2) return false;
  const sourceNumbers = new Set(lineNumericTokens(sourceLines.join("\n")));
  return candidateNumbers.every((value) => sourceNumbers.has(value));
}

function sourceLabLines(value: string) {
  const summary = formatLabVisualSummaryFromLines(value, { includeLabPrefix: true });
  return uniqueLines(summary.lines.filter(isUsableSourceLabLine), 12);
}

function sourceImageLines(value: string) {
  const studyPattern = /\b(?:CT|MRI|CXR|X-?ray|echo|sono|ultrasound|US|ERCP|EGD|colonoscopy|bronchoscopy|PET)\b|\bimpression\s*:/i;
  const lines: string[] = [];
  let current = "";
  sourceFragments(value).forEach((fragment) => {
    const clean = fragment.replace(/^(?:Image|Img|Imaging)\s*[:\uFF1A]\s*/i, "").trim();
    if (!clean) return;
    if (studyPattern.test(clean)) {
      if (current) lines.push(current);
      current = clean;
      return;
    }
    if (current) current = `${current} ${clean}`;
  });
  if (current) lines.push(current);
  return newestImageStudyLines(uniqueLines(lines, 10), 8);
}

function sourcePathologyLines(value: string) {
  return uniqueLines(
    sourceFragments(value)
      .filter(isPathologyResultLine)
      .map((line) => {
        const body = line
          .replace(/^(?:O|Other)\s*[:\uFF1A]\s*/i, "")
          .replace(/^(?:Final\s+)?Pathology\s*[:\uFF1A,-]?\s*/i, "")
          .trim();
        return body ? `Pathology: ${body}` : "";
      }),
    4,
  );
}

function sourceObjectiveFacts(fields: RoundSoapSourceFields): ObjectiveGroups {
  const inputs = sourceObjectiveInputs(fields);
  return {
    vs: sourceVitalsLines(inputs.vitals),
    pe: [],
    lab: sourceLabLines(inputs.labs),
    image: sourceImageLines(inputs.images),
    other: sourcePathologyLines(mergeSourceText(inputs.other, fields.admission, fields.lastSoap)),
  };
}

function hemoglobinObservations(value: string) {
  const observations: Array<{ current: number; previous: number | null }> = [];
  const pattern = /\b(?:Hb|Hgb|hemoglobin)\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*(?:\(|from\s+|<-|->|to\s+)(\d+(?:\.\d+)?))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(value ?? ""))) !== null) {
    observations.push({
      current: Number(match[1]),
      previous: match[2] ? Number(match[2]) : null,
    });
  }
  return observations.filter((item) => Number.isFinite(item.current));
}

function sourceHasMeaningfulAnemiaEvidence(value: string) {
  const text = String(value ?? "")
    .replace(/\b(?:no|denies|without)\s+(?:overt\s+)?(?:active\s+)?bleed(?:ing)?\b/gi, "")
    .replace(/\bno\s+(?:known\s+)?anemia\b/gi, "");
  if (/\b(?:anemia|anaemia|acute blood loss|symptomatic anemia|hb drop)\b/i.test(text)) return true;
  if (/\b(?:melena|hematemesis|hematochezia|active bleed(?:ing)?|prbc|transfus(?:e|ed|ion)|iron deficiency|iron replacement|epoetin|erythropoietin)\b/i.test(text)) return true;
  // This is an automatic A/P promotion gate, not a diagnostic anemia cutoff.
  // Mild isolated Hb values remain objective data unless the source supplies clinical context.
  return hemoglobinObservations(text).some((item) =>
    item.current < 8 || (item.previous !== null && item.previous - item.current >= 2),
  );
}

function titleHasAnemia(value: string) {
  return /\b(?:anemia|anaemia|hb drop)\b/i.test(value);
}

function stripUnsupportedAnemiaTitle(value: string) {
  return String(value ?? "")
    .replace(/\b(?:mild\s+|chronic\s+)?(?:anemia|anaemia|hb drop)\b/gi, "")
    .replace(/\s*[/,+&]\s*(?=$)/g, "")
    .replace(/^\s*[/,+&]\s*|\s*[/,+&]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function filterUnsupportedAnemiaProblem(
  candidate: SoapDraft,
  baseline: SoapDraft,
  sourceText: string,
  workflowMode: RoundSoapWorkflowMode,
) {
  const reviewedBaselineHasAnemia = (workflowMode === "dailyUpdate" || workflowMode === "repairSoap") && baseline.apProblems.some((problem) => titleHasAnemia(problem.title));
  if (reviewedBaselineHasAnemia || sourceHasMeaningfulAnemiaEvidence(sourceText)) {
    return { draft: candidate, warnings: [] as string[] };
  }

  let changed = false;
  const apProblems = candidate.apProblems.flatMap((problem) => {
    if (!titleHasAnemia(problem.title)) return [problem];
    const nextTitle = stripUnsupportedAnemiaTitle(problem.title);
    changed = true;
    if (!nextTitle || /^(?:mild|chronic|stable|active problem)$/i.test(nextTitle)) return [];
    return [{ ...problem, title: nextTitle }];
  });

  return {
    draft: changed ? { ...candidate, apProblems } : candidate,
    warnings: changed
      ? ["Unsupported standalone anemia A/P was removed; the supplied Hb remains in O/Lab for clinician review."]
      : [],
  };
}

const medicationSourceSignalPattern = /\b(?:abx|antibiotics?|anti-infective|teicoplanin|vancomycin|vanco|cef\w*|pip\/?tazo|piptazo|zosyn|meropenem|ertapenem|azithro\w*|levofloxacin|ciprofloxacin|metronidazole|linezolid|daptomycin|heparin|enoxaparin|apixaban|rivaroxaban|warfarin|insulin|norepi\w*|vasopressin|furosemide|lasix|steroid|predni\w*|methylpred\w*|oxygen|o2|tube feed|tpn|ivf|kcl|mgso4)\b/i;
const namedAntiInfectivePattern = /\b(?:teicoplanin|vancomycin|vanco|cef\w*|pip\/?tazo|piptazo|zosyn|meropenem|ertapenem|azithro\w*|levofloxacin|ciprofloxacin|metronidazole|linezolid|daptomycin)\b/i;
const medicationTransitionPattern = /\b(?:start(?:ed)?|add(?:ed)?|switch(?:ed)?|change[ds]?|replace[ds]?|broaden(?:ed)?|de-?escalat(?:e|ed)|hold|withhold|resume[ds]?|restart(?:ed)?|stop(?:ped)?|discontinue[ds]?|d\/?c)\b/i;

function likelyMedicationSourceLines(fields: RoundSoapSourceFields) {
  const explicit = String(fields.orders ?? "").trim();
  if (explicit) return explicit;
  return String(fields.other ?? "")
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => medicationSourceSignalPattern.test(line) && (medicationTransitionPattern.test(line) || /\b(?:on|cont(?:inue)?|day\s*\d+|\d{1,2}\/\d{1,2}\s*-)\b/i.test(line)))
    .join("\n");
}

function sourceMedicationOrders(fields: RoundSoapSourceFields) {
  const source = likelyMedicationSourceLines(fields);
  return source ? parseMedicationOrders(source) : [];
}

function sourceOrderIsSpecific(order: ReturnType<typeof parseMedicationOrders>[number]) {
  if (order.category === "antiInfective") {
    return namedAntiInfectivePattern.test(order.rawText) || order.action === "stop" || order.action === "complete";
  }
  return Boolean(order.medicationName && !/^(?:monitoring|oxygen|abx|antibiotics?)$/i.test(order.medicationName));
}

function sourceOrderLines(fields: RoundSoapSourceFields) {
  const explicitOrders = String(fields.orders ?? "").trim().length > 0;
  const orders = sourceMedicationOrders(fields).filter((order) => {
    if (!explicitOrders && !sourceOrderIsSpecific(order)) return false;
    return !order.hiddenReason || medicationTransitionPattern.test(order.rawText) || order.action !== "other";
  });
  return summarizeMedicationOrders(orders, { mode: "category", maxLines: 8 })
    .map((line) => `Order: ${line.replace(/[\s,;]+$/g, "")}`);
}

function orderCategory(line: string): MedicationOrderCategory | "" {
  return parseMedicationOrders(String(line ?? ""))[0]?.category ?? "";
}

function mergeOrderLinesForDaily(
  baseline: string[],
  candidate: string[],
  fields: RoundSoapSourceFields,
  maxItems = 12,
) {
  const sourceDerived = sourceOrderLines(fields);
  const sourceDerivedCategories = new Set(sourceDerived.map(orderCategory).filter(Boolean));
  const candidateSupported = candidate.filter((line) => {
    if (!lineHasSourceSupport(line, sourceFieldsText(fields), baseline.join("\n"))) return false;
    const category = orderCategory(line);
    return !category || !sourceDerivedCategories.has(category);
  });
  const incoming = uniqueLines([...sourceDerived, ...candidateSupported], maxItems);
  if (incoming.length === 0) return baseline;

  const sourceOrders = sourceMedicationOrders(fields);
  const authoritativeCategories = new Set<MedicationOrderCategory>();
  sourceOrders.forEach((order) => {
    if (sourceOrderIsSpecific(order) && (String(fields.orders ?? "").trim() || medicationTransitionPattern.test(order.rawText) || order.action !== "other")) {
      authoritativeCategories.add(order.category);
    }
  });
  const incomingCategories = new Set(incoming.map(orderCategory).filter(Boolean));
  const carriedBaseline = baseline.filter((line) => {
    const category = orderCategory(line);
    return !category || !authoritativeCategories.has(category) || !incomingCategories.has(category);
  });
  return uniqueLines([...incoming, ...carriedBaseline], Math.max(maxItems, incoming.length + carriedBaseline.length));
}

function sourceProfile(fields: RoundSoapSourceFields) {
  const other = String(fields.other ?? "");
  const hasVitals = sourceHas(fields.vitals);
  const hasLabs = sourceHas(fields.labs);
  const hasImages = sourceHas(fields.images);
  const hasOrders = sourceHas(fields.orders) || sourceOrderLines(fields).length > 0;
  const hasOther = sourceHas(fields.other);
  const allowed = new Set<SoapDeltaSection>();
  if (hasVitals) allowed.add("vs");
  if (hasLabs) {
    allowed.add("lab");
    allowed.add("ap");
  }
  if (hasImages) {
    allowed.add("image");
    allowed.add("ap");
  }
  if (hasOrders) {
    allowed.add("orders");
    allowed.add("ap");
  }
  if (hasOther) {
    allowed.add("s");
    allowed.add("ap");
    allowed.add("tasks");
    if (/\b(?:pe|physical exam|crackles|wheez|edema|jaundice|abd(?:omen|ominal)?|tender|murmur|clear breath|bs )\b/i.test(other)) {
      allowed.add("pe");
    }
    if (/\b(dc|discharge|opd|certificate|meds?|barrier|placement)\b/i.test(other)) allowed.add("dc");
    if (/\b(bp|hr|rr|spo2|v\/s|vs|vitals?|fever|afebrile)\b/i.test(other)) allowed.add("vs");
    if (/\b(wbc|hb|plt|cr|bun|na|k\b|lactate|crp|inr|culture|b\/c|bcx)\b/i.test(other)) allowed.add("lab");
    if (/\b(ct|mri|cxr|echo|sono|ultrasound|image|impression)\b/i.test(other)) allowed.add("image");
    if (isPathologyResultLine(other)) allowed.add("other");
    if (/\b(order|meds?|abx|antibiotic|hold|resume|stop|start|continue|insulin|heparin|lasix)\b/i.test(other)) allowed.add("orders");
  }
  return {
    allowed,
    onlyVitals: hasVitals && !hasLabs && !hasImages && !hasOrders && !hasOther,
    onlyLabs: hasLabs && !hasVitals && !hasImages && !hasOrders && !hasOther,
    onlyImages: hasImages && !hasVitals && !hasLabs && !hasOrders && !hasOther,
    onlyOrders: hasOrders && !hasVitals && !hasLabs && !hasImages && !hasOther,
  };
}

function apKey(title: string) {
  return normalizeLine(title)
    .replace(/\b(improving|worsening|stable|persistent|resolved|acute|chronic|s\/p|with|w\/)\b/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function apTitles(problems: SoapApProblem[]) {
  return problems.map((problem) => apKey(problem.title)).filter(Boolean);
}

function findMatchingProblem(problem: SoapApProblem, problems: SoapApProblem[]) {
  return findMatchingProblems(problem, problems)[0];
}

function problemBucket(problem: SoapApProblem | string) {
  const title = typeof problem === "string" ? problem.toLowerCase() : problem.title.toLowerCase();
  const text = typeof problem === "string" ? title : `${problem.title} ${problem.lines.join(" ")}`.toLowerCase();
  const bucketFrom = (value: string) => {
    if (/\b(aki|ckd|renal|cr\b|creatinine|bun|hyperk|hypok|potassium|na\b|sodium|hypernat|hyponat|lyte|electrolyte|uo|urine)\b/.test(value)) return "renal";
    if (/\b(pleural|effusion|dyspnea|oxygen|o2|spo2|resp|rf|cxr|thoracentesis|tap|pulm)\b/.test(value)) return "resp";
    if (/\b(hb|anemia|cytopenia|plt|platelet|inr|coag|bleed|apixaban|warfarin|anticoag|ac\b)\b/.test(value)) return "heme";
    if (/\b(dm|glucose|insulin|hypergly)\b/.test(value)) return "endo";
    if (/\b(hfref|heart failure|af\b|cardio|diuretic|lasix)\b/.test(value)) return "cardio";
    if (/\b(cholangitis|sepsis|infection|infect|bacteremia|cap|hap|vap|pna|pneumonia|aspiration|abx|antibiotics?|culture|cx|ercp|source control)\b/.test(value)) return "infection";
    if (/\b(liver|hepatic|transaminitis|lft|ast|alt|bilirubin|cholestasis|coagulopathy)\b/.test(value)) return "liver";
    if (/\b(gi bleed|ugib|lgib|melena|hematemesis|hematochezia|diarrhea|ileus|obstruction|pancreatitis)\b/.test(value)) return "gi";
    if (/\b(stroke|cva|seizure|delirium|encephalopathy|ams|altered mental|neuro)\b/.test(value)) return "neuro";
    if (/\b(cancer|carcinoma|scc|adenoca|lymphoma|leukemia|tumou?r|metasta|chemo|radiation)\b/.test(value)) return "oncology";
    if (/\b(malnutrition|nutrition|tube feed|feeding|j-?tube|peg|tpn)\b/.test(value)) return "nutrition";
    return "";
  };
  return bucketFrom(title) || bucketFrom(text);
}

function problemSignatures(problem: SoapApProblem | string) {
  const text = typeof problem === "string" ? problem.toLowerCase() : `${problem.title} ${problem.lines.join(" ")}`.toLowerCase();
  const signatures: string[] = [];
  const add = (signature: string, pattern: RegExp) => {
    if (pattern.test(text)) signatures.push(signature);
  };
  add("aki", /\b(?:aki|acute kidney injury|cr rise|renal dysfunction)\b/);
  add("ckd", /\b(?:ckd|chronic kidney disease|esrd|dialysis|hemodialysis)\b/);
  add("sodium", /\b(?:hypernatremia|hyponatremia|na\s*[<>]?\s*\d+)\b/);
  add("potassium", /\b(?:hyperkalemia|hypokalemia|k\s*[<>]?\s*\d+)\b/);
  add("pna", /\b(?:pna|pneumonia|cap|hap|vap|aspiration)\b/);
  add("sepsis", /\b(?:sepsis|septic shock)\b/);
  add("bacteremia", /\b(?:bacteremia|bloodstream infection)\b/);
  add("resp-failure", /\b(?:respiratory failure|hypoxemic|hypercapnic|rf\b)\b/);
  add("effusion", /\b(?:pleural effusion|chylothorax|thoracentesis)\b/);
  add("heart-failure", /\b(?:heart failure|hfref|hfpef|adhf)\b/);
  add("arrhythmia", /\b(?:af\b|afib|rvr|arrhythmia)\b/);
  if (sourceHasMeaningfulAnemiaEvidence(text)) signatures.push("anemia");
  add("bleeding", /\b(?:bleed|melena|hematemesis|hematochezia)\b/);
  add("liver", /\b(?:liver injury|transaminitis|elevated lft|ast\s*\d+|alt\s*\d+)\b/);
  return [...new Set(signatures)];
}

function findStrictSourceProblemMatch(problem: SoapApProblem, problems: SoapApProblem[]) {
  const key = apKey(problem.title);
  const signatures = problemSignatures(problem);
  return problems.find((candidate) => {
    const candidateKey = apKey(candidate.title);
    if (key && candidateKey && (key === candidateKey || key.includes(candidateKey) || candidateKey.includes(key))) return true;
    const candidateSignatures = problemSignatures(candidate);
    return signatures.length > 0 && candidateSignatures.length > 0 && signatures.some((item) => candidateSignatures.includes(item));
  });
}

function findMatchingProblems(problem: SoapApProblem, problems: SoapApProblem[]) {
  const key = apKey(problem.title);
  const exact = problems.filter((candidate) => {
    const candidateKey = apKey(candidate.title);
    return Boolean(key && candidateKey && (key.includes(candidateKey) || candidateKey.includes(key)));
  });
  const bucket = problemBucket(problem);
  const bucketMatches = bucket ? problems.filter((candidate) => problemBucket(candidate) === bucket && !exact.includes(candidate)) : [];
  const sourceSignatures = problemSignatures(problem);
  const compatibleBucketMatches = bucketMatches.filter((candidate) => {
    const candidateSignatures = problemSignatures(candidate);
    return sourceSignatures.length === 0 || candidateSignatures.length === 0 || sourceSignatures.some((item) => candidateSignatures.includes(item));
  });
  return [...exact, ...compatibleBucketMatches];
}

function problemMatchScore(candidate: SoapApProblem, baseline: SoapApProblem) {
  const candidateKey = apKey(candidate.title);
  const baselineKey = apKey(baseline.title);
  if (!candidateKey || !baselineKey) return 0;
  if (candidateKey === baselineKey) return 100;
  if (candidateKey.includes(baselineKey) || baselineKey.includes(candidateKey)) return 90;

  const candidateTokens = new Set(meaningfulTokens(candidate.title));
  const baselineTokens = new Set(meaningfulTokens(baseline.title));
  const sharedTokens = [...candidateTokens].filter((token) => baselineTokens.has(token));
  if (sharedTokens.length > 0) return 60 + sharedTokens.length;
  if (problemBucket(candidate) !== problemBucket(baseline) || !problemBucket(candidate)) return 0;

  const candidateSignatures = problemSignatures(candidate);
  const baselineSignatures = problemSignatures(baseline);
  if (candidateSignatures.length > 0 && baselineSignatures.length > 0 && !candidateSignatures.some((item) => baselineSignatures.includes(item))) return 0;
  return 20;
}

function apLineDomains(line: string) {
  const text = String(line ?? "");
  const domains: string[] = [];
  if (/\b(?:abx|antibiotics?|anti-infective|teicoplanin|vancomycin|vanco|cef\w*|pip\/?tazo|piptazo|zosyn|meropenem|ertapenem|azithro\w*|levofloxacin|ciprofloxacin|metronidazole|linezolid|daptomycin)\b/i.test(text)) {
    domains.push("med:antiInfective");
  }
  const medication = parseMedicationOrders(text)[0];
  if (medication && medication.category !== "routine" && medicationSourceSignalPattern.test(text)) domains.push(`med:${medication.category}`);
  if (/\b(?:culture|b\/c|bcx|sputum cx|urine cx|micro)\b/i.test(text)) domains.push("micro");
  if (/\b(?:o2|oxygen|nc\s*\d|hfnc|bipap|ventilator|intubat|extubat|spo2)\b/i.test(text)) domains.push("resp-support");
  if (/\b(?:cxr|ct\b|mri\b|echo\b|sono|ultrasound|ercp|egd|colonoscopy)\b/i.test(text)) domains.push("study");
  if (/\b(?:procedure|drain|stent|tap|thoracentesis|biopsy|operation|surgery)\b/i.test(text)) domains.push("procedure");
  if (/\b(?:cr|bun|egfr|uo|urine output)\s*[:=]?\s*\d/i.test(text)) domains.push("lab:renal");
  if (/\b(?:na|k|mg|ca|phos|p)\s*[:=]?\s*\d/i.test(text)) domains.push("lab:lyte");
  if (/\b(?:wbc|neu|anc|crp|pct|lactate)\s*[:=]?\s*\d/i.test(text)) domains.push("lab:infection");
  if (/\b(?:hb|hgb|plt|inr|pt|aptt)\s*[:=]?\s*\d/i.test(text)) domains.push("lab:heme");
  if (/\b(?:ast|alt|bilirubin|t-?bil|d-?bil|alp|ggt)\s*[:=]?\s*\d/i.test(text)) domains.push("lab:liver");
  return [...new Set(domains)];
}

function lineHasProblemAffinity(problem: SoapApProblem, line: string) {
  if (hasEquivalentLine(problem.lines, line)) return true;
  const targetSignatures = problemSignatures(problem);
  const lineSignatures = problemSignatures(line);
  if (targetSignatures.some((signature) => lineSignatures.includes(signature))) return true;

  const targetBucket = problemBucket(problem);
  const lineBucket = problemBucket(line);
  if (targetBucket && lineBucket === targetBucket) return true;

  const bucketPlanPatterns: Record<string, RegExp> = {
    renal: /\b(?:free[- ]?water|water deficit|fluid balance|i\/o|daily weight|bmp|renal dose|nephrotox|dialysis|hd\b|trend (?:na|sodium|k|cr|bun)|repeat (?:na|sodium|k|cr|bun))\b/i,
    resp: /\b(?:wean (?:o2|oxygen)|pulm rehab|breathing training|bronchodilator|nebul|nIV|BiPAP|HFNC|ventilator|airway|repeat CXR)\b/i,
    infection: /\b(?:source control|de-?escalat|culture clearance|repeat (?:culture|b\/c|bcx)|ID follow|antibiotic duration)\b/i,
    heme: /\b(?:transfus|trend (?:cbc|hb|hgb|plt|inr)|repeat (?:cbc|hb|hgb|plt|inr)|bleeding precaution)\b/i,
    cardio: /\b(?:telemetry|rate control|rhythm control|volume status|daily weight|repeat echo|cardiology follow)\b/i,
    liver: /\b(?:trend (?:lft|ast|alt|bilirubin|inr)|repeat (?:lft|ast|alt|bilirubin|inr)|hepatotoxic)\b/i,
    neuro: /\b(?:neuro check|delirium precaution|seizure precaution|mental status)\b/i,
    oncology: /\b(?:pathology|staging|oncology follow|tumou?r board|chemo|radiation)\b/i,
    nutrition: /\b(?:tube feed|feeding tolerance|nutrition consult|calorie|enteral|parenteral)\b/i,
  };
  return Boolean(targetBucket && bucketPlanPatterns[targetBucket]?.test(line));
}

function mergeProblemLines(baselineLines: string[], candidateLines: string[], sourceText: string) {
  let updatedLines = uniqueLines(candidateLines, 3);
  const hasSpecificAntiInfective = updatedLines.some((line) => namedAntiInfectivePattern.test(stripColorMarkup(line)));
  if (hasSpecificAntiInfective) {
    updatedLines = updatedLines.filter((line) => !/^\s*(?:continue|cont)\s+(?:current\s+)?(?:IV\s+)?(?:Abx|antibiotics?)\.?\s*$/i.test(stripColorMarkup(line)));
  }
  if (updatedLines.length === 0) return uniqueLines(baselineLines, 3);
  const updatedDomains = new Set(updatedLines.flatMap(apLineDomains));
  const medicationWasSuperseded = /\b(?:completed|done|discontinued|stopped|switched|changed|replaced|de-?escalated)\b/i.test(sourceText);
  const carryForward = baselineLines.filter((line) => {
    if (hasEquivalentLine(updatedLines, line)) return false;
    if (/\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:/i.test(line)) return true;
    const domains = apLineDomains(line);
    if (medicationWasSuperseded && domains.some((domain) => domain.startsWith("med:") && updatedDomains.has(domain))) return false;
    return domains.length === 0 || !domains.some((domain) => updatedDomains.has(domain));
  });
  return uniqueLines([...updatedLines, ...carryForward], Math.max(3, updatedLines.length + carryForward.length)).slice(0, 3);
}

function mergeApProblemsForDaily(
  baseline: SoapApProblem[],
  candidate: SoapApProblem[],
  allowNewProblem: boolean,
  sourceText = "",
  trustedNewProblemTitles = new Set<string>(),
) {
  const warnings: string[] = [];
  const highRiskWarnings: string[] = [];
  const shouldCarryForwardApLine = (line: string, candidateLines: string[]) => {
    if (!isProtectedLine(line)) return false;
    if (/\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:/i.test(line)) return true;
    if (
      /\b(?:completed|done|discontinued|stopped)\b/i.test(sourceText) &&
      /\bcontinue\b.*\b(?:abx|antibiotics?|teicoplanin|vancomycin|cef\w*|meropenem|ertapenem|pip\/?tazo|zosyn)\b/i.test(line) &&
      /\b(?:abx|antibiotics?|teicoplanin|vancomycin|cef\w*|meropenem|ertapenem|pip\/?tazo|zosyn)\b/i.test(sourceText)
    ) return false;
    const lineMedicationDomains = apLineDomains(line).filter((domain) => domain.startsWith("med:"));
    const candidateMedicationDomains = new Set(candidateLines.flatMap(apLineDomains).filter((domain) => domain.startsWith("med:")));
    if (medicationTransitionPattern.test(sourceText) && lineMedicationDomains.some((domain) => candidateMedicationDomains.has(domain))) return false;
    const candidateText = candidateLines.join(" ");
    const staleObjectivePattern = /\b(?:wbc|hb|hgb|plt|cr|bun|na|k\b|ast|alt|t-?bil|inr|lactate|crp|cxr|ct\b|mri\b|echo\b|sono|ultrasound)\b/i;
    if (staleObjectivePattern.test(line) && staleObjectivePattern.test(candidateText)) return false;
    return /\b(?:abx|antibiotic|teicoplanin|vancomycin|ceftriaxone|cefepime|meropenem|zosyn|pip\/tazo|culture|b\/c|bcx|source control|ercp|stent|drain|tube|dc|discharge|opd|certificate|hold|resume|restart|apixaban|heparin|warfarin)\b/i.test(line);
  };
  const assignments = new Map<number, SoapApProblem>();
  const usedBaseline = new Set<number>();
  const unmatched: SoapApProblem[] = [];
  candidate.forEach((problem) => {
    const ranked = baseline
      .map((baselineProblem, index) => ({ index, score: usedBaseline.has(index) ? 0 : problemMatchScore(problem, baselineProblem) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const match = ranked[0];
    if (!match) {
      unmatched.push(problem);
      return;
    }
    usedBaseline.add(match.index);
    assignments.set(match.index, problem);
  });
  const next = baseline.map((problem, index) => {
    const match = assignments.get(index);
    if (!match || match.lines.length === 0) return problem;
    const mergedLines = mergeProblemLines(problem.lines, match.lines, sourceText);
    const mergedDomains = new Set(mergedLines.flatMap(apLineDomains));
    const medicationWasSuperseded = /\b(?:completed|done|discontinued|stopped|switched|changed|replaced|de-?escalated)\b/i.test(sourceText);
    const protectedCarryForward = problem.lines
      .filter((line) => shouldCarryForwardApLine(line, mergedLines))
      .filter((line) => !(
        medicationWasSuperseded &&
        apLineDomains(line).some((domain) => domain.startsWith("med:") && mergedDomains.has(domain))
      ))
      .filter((line) => !hasEquivalentLine(mergedLines, line));
    return {
      title: problem.title,
      lines: uniqueLines([...mergedLines, ...protectedCarryForward], Math.max(3, mergedLines.length + protectedCarryForward.length)).slice(0, 3),
    };
  });
  const baselineTitles = apTitles(baseline);
  const candidateTitles = apTitles(candidate);
  const removedTitles = baselineTitles.filter((title) => !candidateTitles.some((candidateTitle) => title.includes(candidateTitle) || candidateTitle.includes(title)));
  if (removedTitles.length > 0 && baseline.length > 0) {
    highRiskWarnings.push("AI attempted to remove or rename existing A/P problem(s); baseline A/P titles were preserved.");
  }
  const realNewProblems = unmatched.filter((problem) => {
    const text = `${problem.title} ${problem.lines.join(" ")}`;
    if (/\b(clinical improvement|improving after|improvement after|post[- ]?procedure improvement)\b/i.test(problem.title)) return false;
    if (titleHasAnemia(problem.title) && !sourceHasMeaningfulAnemiaEvidence(sourceText)) return false;
    const explicitlyTrusted = trustedNewProblemTitles.has(apKey(problem.title));
    const diagnosisSupported = lineHasSourceSupport(problem.title, sourceText, "") || explicitlyTrusted;
    return diagnosisSupported && Boolean(explicitlyTrusted || problemBucket(problem) || /\b(new|acute|positive|worsening|thrombus|bleed|respiratory failure|effusion|aki|lft|coag)\b/i.test(text));
  });
  if (unmatched.length > realNewProblems.length) {
    warnings.push("Unsupported new A/P label(s) were held; treatment and objective data were routed to supported problems only.");
  }
  if (allowNewProblem && next.length < 7) {
    const openSlots = Math.max(0, 7 - next.length);
    next.push(...realNewProblems.slice(0, openSlots).map((problem) => ({ title: safeClinicalLine(problem.title, 90), lines: uniqueLines(problem.lines, 2) })));
    if (realNewProblems.length > openSlots) warnings.push("AI suggested multiple new A/P problems; only the highest-yield were applied for Daily update.");
  } else if (realNewProblems.length > 0) {
    warnings.push("AI suggested new A/P problem(s) from limited daily source; they were held for review.");
  }
  return { apProblems: next.slice(0, Math.max(7, baseline.length)), warnings, highRiskWarnings };
}

function protectedLines(draft: SoapDraft) {
  return [
    ...draft.header,
    ...draft.sLines,
    ...draft.oLines,
    ...draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...draft.taskLines,
    ...draft.dcLines,
  ].filter(isProtectedLine);
}

function isProtectedLine(line: string) {
  const text = String(line ?? "");
  if (!text.trim()) return false;
  if (/\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:/i.test(text)) return true;
  if (/^!/.test(text.trim())) return true;
  const classified = classifyClinicalLine(text, { fallbackKind: "other" });
  if (classified.tone === "critical" || classified.tone === "important") return true;
  return /\b(abx|antibiotic|teicoplanin|vancomycin|ceftriaxone|cefepime|meropenem|culture|b\/c|bcx|pending|source|de-escalation|duration|dc|discharge|opd|certificate|meds?|aki|ckd|cr\s*\d|bun|hyperk|hypok|k\s*\d|lft|ast|alt|bilirubin|inr|coag|hb\s*\d|plt\s*\d|bleed|o2|oxygen|spo2|rf|effusion|chylothorax|ct\b|mri\b|cxr\b|echo\b|sono|ultrasound|ercp|egd|biopsy|procedure|consult|drain|tube|port-a)\b/i.test(text);
}

function mergeDailyLines(
  baseline: string[],
  candidate: string[],
  options: { maxItems: number; replacePlainBaseline?: boolean } = { maxItems: 8 },
) {
  const candidateLines = uniqueLines(candidate, options.maxItems);
  if (candidateLines.length === 0) return baseline;
  const baselineProtected = baseline.filter(isProtectedLine);
  const baselinePlain = options.replacePlainBaseline ? [] : baseline.filter((line) => !isProtectedLine(line));
  const maxItems = Math.max(options.maxItems, candidateLines.length + baselineProtected.length + baselinePlain.length);
  return uniqueLines([...candidateLines, ...baselineProtected, ...baselinePlain], maxItems);
}

function subjectiveDomains(line: string) {
  const text = String(line ?? "");
  const domains: string[] = [];
  if (/\b(?:dyspnea|sob|shortness of breath|breathless)\b/i.test(text)) domains.push("dyspnea");
  if (/\b(?:cough|sputum)\b/i.test(text)) domains.push("cough");
  if (/\b(?:fever|febrile|afebrile|chills)\b/i.test(text)) domains.push("fever");
  if (/\b(?:chest pain|pain)\b/i.test(text)) domains.push("pain");
  if (/\b(?:n\/v|nausea|vomit|diarrhea|constipation)\b/i.test(text)) domains.push("gi");
  if (/\b(?:poor intake|appetite|oral intake)\b/i.test(text)) domains.push("intake");
  if (/\b(?:dizziness|weakness|confusion|delirium|ams)\b/i.test(text)) domains.push("neuro");
  return domains;
}

function mergeSubjectiveLinesForDaily(baseline: string[], candidate: string[], maxItems = 6) {
  const candidateLines = uniqueLines(candidate, maxItems);
  if (candidateLines.length === 0) return baseline;
  const incomingDomains = new Set(candidateLines.flatMap(subjectiveDomains));
  const carryForward = baseline.filter((line) => {
    const domains = subjectiveDomains(line);
    return domains.length === 0 || !domains.some((domain) => incomingDomains.has(domain));
  });
  return uniqueLines([...candidateLines, ...carryForward], Math.max(maxItems, candidateLines.length + carryForward.length));
}

function newestImageStudyLines(lines: string[], maxItems = 8) {
  const seenStudies = new Set<string>();
  const selected: string[] = [];
  [...lines].reverse().forEach((line) => {
    const key = imageStudyKey(line);
    if (key && seenStudies.has(key)) return;
    if (key) seenStudies.add(key);
    selected.push(line);
  });
  return uniqueLines(selected.reverse(), maxItems);
}

function taskExplicitlyCompleted(task: string, sourceText: string) {
  if (/\b(?:bx|biopsy|pathology|histology|cytology)\b/i.test(task) && isPathologyResultLine(sourceText)) return true;
  if (!/\b(?:completed|done|passed|resolved|final negative|discontinued|stopped)\b/i.test(sourceText)) return false;
  if (/\b(?:ambulat\w*|walk\w*|exertional oxygen|oxygen saturation)\b/i.test(task) && /\b(?:ambulat\w*|walk\w*)\b.*\b(?:completed|done|passed)\b|\b(?:completed|done|passed)\b.*\b(?:ambulat\w*|walk\w*)\b/i.test(sourceText)) return true;
  if (/\b(?:culture|b\/c|bcx)\b/i.test(task) && /\b(?:culture|b\/c|bcx)\b.*\b(?:final negative|completed|done)\b|\b(?:final negative|completed|done)\b.*\b(?:culture|b\/c|bcx)\b/i.test(sourceText)) return true;
  return false;
}

function labItemKey(label: string) {
  return String(label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function labValueKey(value: string) {
  return String(value ?? "").trim().replace(/,/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function previousLabValues(lines: string[]) {
  const values = new Map<string, string>();
  parseLabReports(lines.join("\n")).forEach((report) => {
    report.items.forEach((item) => {
      const key = labItemKey(item.name || item.label);
      const value = labValueKey(String(item.value ?? ""));
      if (!key || !value || values.has(key)) return;
      values.set(key, value);
    });
  });
  return values;
}

function numericLabValue(value: string) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function sourceEvidenceLine(sourceText: string, pattern: RegExp) {
  const line = String(sourceText ?? "")
    .split(/\r?\n|(?<=[.;!?])\s+/)
    .map((item) => item
      .replace(/^(?:Lab|Image|V\/S|Other update \/ task \/ course)\s*:\s*/i, "")
      .replace(/^(?:today|overnight|course|update)\s*:\s*/i, "")
      .trim())
    .find((item) => pattern.test(item));
  return safeClinicalLine(line ?? "", 140);
}

function explicitSourceApBlocks(sourceText: string): SoapApProblem[] {
  if (!/(?:^|\n)\s*(?:A\/P|AP)\s*:|(?:^|\n)\s*#+\s*\S/im.test(sourceText)) return [];
  const parsedProblems = parseSoapText(sourceText).apProblems
    .map((problem) => ({
      title: safeClinicalLine(problem.title.replace(/^!{1,2}\s*/, ""), 90),
      lines: uniqueLines(problem.lines.map((line) => line.replace(/^!{1,2}\s*/, "")), 2),
    }))
    .filter((problem) => problem.title && !/^problem$/i.test(problem.title));
  if (parsedProblems.length > 0) return parsedProblems.slice(0, 7);

  // Accept an explicitly pasted clinician A/P even when the surrounding text
  // is not a complete SOAP document. This is source evidence, not an inferred
  // diagnosis, so the delta guard must not silently discard it.
  const problems: SoapApProblem[] = [];
  let current: SoapApProblem | null = null;
  let inAp = false;
  String(sourceText ?? "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^(?:A\/P|AP)\s*:/i.test(line)) {
      inAp = true;
      return;
    }
    if (/^(?:S|O|Tasks?|DC|Discharge)\s*:/i.test(line)) {
      inAp = false;
      current = null;
      return;
    }
    const titleMatch = line.match(/^#+\s*(.+)$/);
    if (titleMatch) {
      inAp = true;
      current = { title: safeClinicalLine(titleMatch[1], 90), lines: [] };
      if (current.title) problems.push(current);
      return;
    }
    if (!inAp || !current) return;
    const detail = safeClinicalLine(line.replace(/^(?:[-*\u2022]|\d+[.)])\s*/, ""), 170);
    if (detail && current.lines.length < 2) current.lines.push(detail);
  });
  return problems.slice(0, 7);
}

function explicitSourceProblems(sourceText: string): SoapApProblem[] {
  const rules: Array<{ title: string; pattern: RegExp }> = [
    { title: "AKI", pattern: /\b(?:AKI|acute kidney injury)\b/i },
    { title: "Hypernatremia", pattern: /\bhypernatremia\b/i },
    { title: "Hyponatremia", pattern: /\bhyponatremia\b/i },
    { title: "Hyperkalemia", pattern: /\bhyperkalemia\b/i },
    { title: "Hypokalemia", pattern: /\bhypokalemia\b/i },
    { title: "Liver injury / coagulopathy", pattern: /\b(?:acute liver injury|hepatic injury|transaminitis|elevated LFTs?|coagulopathy)\b/i },
    { title: "Hypoxemic respiratory failure", pattern: /\b(?:acute hypoxemic respiratory failure|hypoxemic RF|new oxygen requirement)\b/i },
    { title: "Sepsis / bacteremia", pattern: /\b(?:new sepsis|septic shock|bacteremia|bloodstream infection)\b/i },
    { title: "GI bleeding", pattern: /\b(?:GI bleed|UGIB|LGIB|melena|hematemesis|hematochezia)\b/i },
    { title: "AF with RVR", pattern: /\b(?:AF(?:ib)?\s+(?:with\s+)?RVR|atrial fibrillation\s+(?:with\s+)?RVR)\b/i },
    { title: "Acute decompensated HF", pattern: /\b(?:acute decompensated (?:heart failure|HF)|ADHF)\b/i },
    { title: "Delirium / encephalopathy", pattern: /\b(?:new delirium|acute encephalopathy|new AMS|altered mental status)\b/i },
    { title: "Acute thrombosis", pattern: /\b(?:new DVT|new PE|acute thrombus|acute thrombosis)\b/i },
  ];
  const ruleProblems = rules.flatMap((rule) => {
    if (!rule.pattern.test(sourceText)) return [];
    const evidence = sourceEvidenceLine(sourceText, rule.pattern);
    return evidence ? [{ title: rule.title, lines: [evidence] }] : [];
  });
  const combined: SoapApProblem[] = [];
  [...explicitSourceApBlocks(sourceText), ...ruleProblems].forEach((problem) => {
    const existing = findStrictSourceProblemMatch(problem, combined);
    if (!existing) {
      combined.push(problem);
      return;
    }
    existing.lines = uniqueLines([...existing.lines, ...problem.lines], 2);
  });
  return combined;
}

function labDerivedSourceProblems(fields: RoundSoapSourceFields, baseline: SoapDraft): SoapApProblem[] {
  const labSource = [fields.labs, fields.other].filter(sourceHas).join("\n");
  if (!labSource) return [];
  const currentItems = parseLabReports(labSource).flatMap((report) => report.items);
  if (currentItems.length === 0) return [];
  const baselineValues = previousLabValues(splitObjective(baseline.oLines).lab);
  const latest = new Map<string, { label: string; value: string; previous: string }>();
  currentItems.forEach((item) => {
    const label = String(item.name || item.label || "").trim();
    const key = labItemKey(label);
    const value = labValueKey(String(item.value ?? ""));
    if (!key || !value) return;
    latest.set(key, { label, value, previous: labValueKey(String(item.previousValue ?? "")) || baselineValues.get(key) || "" });
  });

  const problems: SoapApProblem[] = [];
  const add = (title: string, evidence: string) => {
    const key = apKey(title);
    if (!evidence || problems.some((problem) => apKey(problem.title) === key)) return;
    problems.push({ title, lines: [evidence] });
  };
  const cr = latest.get("cr") ?? latest.get("creatinine");
  if (cr) {
    const current = numericLabValue(cr.value);
    const previous = numericLabValue(cr.previous);
    if (current !== null && previous !== null && (current - previous >= 0.3 || current >= previous * 1.5)) {
      add("Cr rise / renal dysfunction", `Cr ${cr.value}(${cr.previous})`);
    }
  }
  const na = latest.get("na") ?? latest.get("sodium");
  const naValue = numericLabValue(na?.value ?? "");
  if (na && naValue !== null && naValue <= 130) add("Hyponatremia", `Na ${na.value}${na.previous ? `(${na.previous})` : ""}`);
  if (na && naValue !== null && naValue >= 150) add("Hypernatremia", `Na ${na.value}${na.previous ? `(${na.previous})` : ""}`);
  const potassium = latest.get("k") ?? latest.get("potassium");
  const potassiumValue = numericLabValue(potassium?.value ?? "");
  if (potassium && potassiumValue !== null && potassiumValue <= 3) add("Hypokalemia", `K ${potassium.value}${potassium.previous ? `(${potassium.previous})` : ""}`);
  if (potassium && potassiumValue !== null && potassiumValue >= 5.5) add("Hyperkalemia", `K ${potassium.value}${potassium.previous ? `(${potassium.previous})` : ""}`);
  const ast = latest.get("ast");
  const alt = latest.get("alt");
  const liverValues = [ast, alt].filter(Boolean) as Array<{ label: string; value: string; previous: string }>;
  if (liverValues.some((item) => (numericLabValue(item.value) ?? 0) >= 200)) {
    add("Liver injury / transaminitis", liverValues.map((item) => `${item.label} ${item.value}${item.previous ? `(${item.previous})` : ""}`).join(", "));
  }
  const hb = latest.get("hb") ?? latest.get("hgb") ?? latest.get("hemoglobin");
  const hbValue = numericLabValue(hb?.value ?? "");
  const hbPrevious = numericLabValue(hb?.previous ?? "");
  if (hb && hbValue !== null && (hbValue < 8 || (hbPrevious !== null && hbPrevious - hbValue >= 2))) {
    add("Anemia / Hb drop", `Hb ${hb.value}${hb.previous ? `(${hb.previous})` : ""}`);
  }
  return problems;
}

function sourceBackedProblems(fields: RoundSoapSourceFields, baseline: SoapDraft) {
  const sourceText = sourceFieldsText(fields);
  const medicationUpdates: SoapApProblem[] = [];
  const antiInfectiveOrder = sourceMedicationOrders(fields)
    .find((order) => order.category === "antiInfective" && sourceOrderIsSpecific(order));
  const antiInfectiveLine = antiInfectiveOrder
    ? (summarizeMedicationOrders([antiInfectiveOrder], { mode: "category", maxLines: 1 })[0] ?? "")
      .replace(/^Abx\s*:\s*/i, "")
      .replace(/[\s,;]+$/g, "")
    : "";
  const infectionProblem = baseline.apProblems.find((problem) => problemBucket(problem) === "infection");
  if (antiInfectiveLine && infectionProblem) {
    const cultureLine = sourceEvidenceLine(sourceText, /\b(?:culture|b\/c|bcx)\b.*\b(?:pending|positive|negative|growth|ngtd|clearance)\b/i);
    medicationUpdates.push({
      title: infectionProblem.title,
      lines: [safeClinicalLine([antiInfectiveLine, cultureLine].filter(Boolean).join("; "), 180)],
    });
  }
  const combined = [
    ...explicitSourceProblems(sourceText),
    ...labDerivedSourceProblems(fields, baseline),
    ...medicationUpdates,
  ];
  const next: SoapApProblem[] = [];
  combined.forEach((problem) => {
    const existing = findStrictSourceProblemMatch(problem, next);
    if (!existing) {
      next.push(problem);
      return;
    }
    const incomingHasObjectiveEvidence = problem.lines.some((line) => apLineDomains(line).some((domain) => domain.startsWith("lab:")));
    const existingLines = existing.lines.filter((line) => {
      if (!incomingHasObjectiveEvidence) return true;
      const normalizedTitle = apKey(existing.title);
      const normalizedLine = apKey(line.replace(/\b(?:new|acute|today)\b/gi, ""));
      return !normalizedTitle || !normalizedLine || !(normalizedTitle.includes(normalizedLine) || normalizedLine.includes(normalizedTitle));
    });
    existing.lines = uniqueLines([
      ...problem.lines,
      ...existingLines.filter((line) => !hasEquivalentLine(problem.lines, line)),
    ], 2);
  });
  return next;
}

function enrichLabLineWithPreviousValues(line: string, previousValues: Map<string, string>) {
  let next = line;
  const candidateItems = parseLabReports(line).flatMap((report) => report.items);
  candidateItems.forEach((item) => {
    const key = labItemKey(item.name || item.label);
    const current = labValueKey(String(item.value ?? ""));
    const sourcePrevious = labValueKey(String(item.previousValue ?? ""));
    if (sourcePrevious) return;
    const previous = previousValues.get(key) || "";
    if (!key || !current || !previous || previous === current) return;

    const labelAlternates = [item.label, item.name].filter(Boolean).map((value) => escapeRegExp(String(value))).join("|");
    if (!labelAlternates) return;
    const currentPattern = escapeRegExp(String(item.value ?? ""));
    const pattern = new RegExp(`\\b(${labelAlternates})\\.?\\s*(${currentPattern})(?:\\s*[↑↓↗↘])?(?!\\s*(?:\\(|from\\b|(?:->|→)))`, "i");
    const currentNumeric = Number(current.replace(/,/g, ""));
    const previousNumeric = Number(previous.replace(/,/g, ""));
    const direction = Number.isFinite(currentNumeric) && Number.isFinite(previousNumeric) && currentNumeric !== previousNumeric
      ? currentNumeric > previousNumeric ? "↑" : "↓"
      : "";
    next = next.replace(pattern, (_match, label, value) => `${label} ${value}${direction}(${previous})`);
  });
  return next;
}

function mergeLabLinesForDaily(baseline: string[], candidate: string[], maxItems = 12) {
  const candidateLines = uniqueLines(candidate, maxItems);
  if (candidateLines.length === 0) return baseline;
  const previousValues = previousLabValues(baseline);
  return uniqueLines(candidateLines.map((line) => enrichLabLineWithPreviousValues(line, previousValues)), maxItems);
}

function labVisualGroupKey(line: string) {
  return stripColorMarkup(String(line ?? ""))
    .replace(/^!+\s*/, "")
    .replace(/^Lab\s*:\s*/i, "")
    .match(/^(CBC\/DC|Chem\/Renal|Liver\/Coag|Micro|ABG\/VBG|Cardiac|Other)\s*:/i)?.[1]
    ?.toLowerCase() ?? "";
}

function ensureSourceObjectiveCoverage(draft: SoapDraft, fields: RoundSoapSourceFields) {
  const facts = sourceObjectiveFacts(fields);
  const groups = splitObjective(draft.oLines);
  const warnings: string[] = [];

  if (facts.vs.length > 0 && groups.vs.length === 0) {
    groups.vs = facts.vs;
    warnings.push("O/V/S was omitted by AI and restored from pasted source.");
  }

  if (facts.lab.length > 0) {
    const candidateCanonical = formatLabVisualSummaryFromLines(groups.lab, { includeLabPrefix: true }).lines;
    const candidateKeys = new Set(candidateCanonical.map(labVisualGroupKey).filter(Boolean));
    const missingLabGroups = facts.lab.filter((line) => {
      const key = labVisualGroupKey(line);
      return !key || !candidateKeys.has(key);
    });
    if (groups.lab.length === 0) {
      groups.lab = facts.lab;
      warnings.push("O/Lab was omitted by AI and restored from pasted source.");
    } else if (missingLabGroups.length > 0) {
      groups.lab = uniqueLines([...groups.lab, ...missingLabGroups], 12);
      warnings.push("Missing O/Lab group(s) were restored from pasted source.");
    }
  }

  if (facts.image.length > 0) {
    const candidateStudyKeys = new Set(groups.image.map(imageStudyKey).filter(Boolean));
    const missingStudies = facts.image.filter((line) => {
      const key = imageStudyKey(line);
      return !key || !candidateStudyKeys.has(key);
    });
    if (missingStudies.length > 0) {
      groups.image = newestImageStudyLines([...groups.image, ...missingStudies], 8);
      warnings.push("O/Image study omitted by AI was restored from pasted source.");
    }
  }

  if (facts.other.length > 0) {
    const missingPathology = facts.other.filter((line) => !hasEquivalentLine(groups.other, line));
    if (missingPathology.length > 0) {
      groups.other = uniqueLines([...groups.other, ...missingPathology], 6);
      warnings.push("Final pathology omitted by AI was restored to O from pasted source.");
    }
  }

  return {
    draft: { ...draft, oLines: mergeObjective(groups, 24) },
    warnings,
  };
}

function hasEquivalentLine(lines: string[], target: string) {
  const key = normalizeLine(target);
  return Boolean(key && lines.some((line) => {
    const lineKey = normalizeLine(line);
    return Boolean(lineKey && (lineKey.includes(key) || key.includes(lineKey)));
  }));
}

function carryForwardProtectedDraft(baseline: SoapDraft, candidate: SoapDraft) {
  let changed = false;
  const next: SoapDraft = {
    ...candidate,
    apProblems: candidate.apProblems.map((problem) => ({ ...problem, lines: [...problem.lines] })),
    taskLines: [...candidate.taskLines],
    dcLines: [...candidate.dcLines],
  };

  baseline.apProblems.forEach((baselineProblem) => {
    const protectedApLines = baselineProblem.lines.filter(isProtectedLine);
    if (protectedApLines.length === 0 && !isProtectedLine(baselineProblem.title)) return;
    let target = findMatchingProblem(baselineProblem, next.apProblems);
    if (!target) {
      target = { title: baselineProblem.title, lines: [] };
      next.apProblems.push(target);
      changed = true;
    }
    const missingLines = protectedApLines.filter((line) => !hasEquivalentLine(next.apProblems.flatMap((problem) => problem.lines), line));
    if (missingLines.length > 0) {
      target.lines = uniqueLines([...missingLines, ...target.lines], 2);
      changed = true;
    }
  });

  const missingTasks = baseline.taskLines.filter((line) => isProtectedLine(line) && !hasEquivalentLine(next.taskLines, line));
  if (missingTasks.length > 0) {
    next.taskLines = uniqueLines([...next.taskLines, ...missingTasks], 8);
    changed = true;
  }
  const missingDc = baseline.dcLines.filter((line) => isProtectedLine(line) && !hasEquivalentLine(next.dcLines, line));
  if (missingDc.length > 0) {
    next.dcLines = uniqueLines([...next.dcLines, ...missingDc], 6);
    changed = true;
  }

  return {
    draft: next,
    warnings: changed ? ["Protected antibiotic/culture/DC item(s) were carried forward from reviewed SOAP."] : [],
  };
}

function totalLineCount(draft: SoapDraft) {
  return draft.header.length + draft.sLines.length + draft.oLines.length + draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]).length + draft.taskLines.length + draft.dcLines.length;
}

function hasSoapBody(draft: SoapDraft) {
  return draft.sLines.length > 0 || draft.oLines.length > 0 || draft.apProblems.length > 0 || draft.taskLines.length > 0 || draft.dcLines.length > 0;
}

function changedSection(id: SoapDeltaSection, reason: string, risk: "normal" | "high" = "normal", blocked = false): SoapDeltaChangedSection {
  return { id, label: sectionLabels[id], reason, risk, blocked };
}

function pushChanged(changed: SoapDeltaChangedSection[], id: SoapDeltaSection, reason: string, risk: "normal" | "high" = "normal", blocked = false) {
  if (changed.some((item) => item.id === id && item.blocked === blocked)) return;
  changed.push(changedSection(id, reason, risk, blocked));
}

function analyzeChangedSections(baseline: SoapDraft, candidate: SoapDraft) {
  const changed: SoapDeltaChangedSection[] = [];
  if (!sameLines(baseline.header, candidate.header)) pushChanged(changed, "header", "Header changed");
  if (!sameLines(baseline.sLines, candidate.sLines)) pushChanged(changed, "s", "Subjective changed");
  const baseObjective = splitObjective(baseline.oLines);
  const candidateObjective = splitObjective(candidate.oLines);
  (["vs", "pe", "lab", "image", "other"] as const).forEach((section) => {
    if (!sameLines(baseObjective[section], candidateObjective[section])) pushChanged(changed, section, `${sectionLabels[section]} changed`);
  });
  if (!sameProblems(baseline.apProblems, candidate.apProblems)) pushChanged(changed, "ap", "A/P changed");
  const baseTasks = splitTasks(baseline.taskLines);
  const candidateTasks = splitTasks(candidate.taskLines);
  if (!sameLines(baseTasks.orders, candidateTasks.orders)) pushChanged(changed, "orders", "Medication/orders changed");
  if (!sameLines(baseTasks.tasks, candidateTasks.tasks)) pushChanged(changed, "tasks", "Tasks changed");
  if (!sameLines(baseline.dcLines, candidate.dcLines)) pushChanged(changed, "dc", "DC changed");
  return changed;
}

function draftForDailyUpdate(baseline: SoapDraft, candidate: SoapDraft, fields: RoundSoapSourceFields, _selectedDate = "") {
  const profile = sourceProfile(fields);
  const objectiveFacts = sourceObjectiveFacts(fields);
  const warnings: string[] = [];
  const highRiskWarnings: string[] = [];
  const changed: SoapDeltaChangedSection[] = [];
  const baselineText = formatSoapDraft(baseline);
  const baseObjective = splitObjective(baseline.oLines);
  const candidateObjective = splitObjective(candidate.oLines);
  const nextObjective: ObjectiveGroups = {
    vs: baseObjective.vs,
    pe: baseObjective.pe,
    lab: baseObjective.lab,
    image: baseObjective.image,
    other: baseObjective.other,
  };

  (["vs", "pe", "lab", "image", "other"] as const).forEach((section) => {
    const sourceOwnedLines = objectiveFacts[section];
    if (sourceOwnedLines.length > 0) {
      if (section === "vs") {
        const exactCandidate = candidateObjective.vs.filter((line) => lineUsesSourceNumbers(line, sourceOwnedLines));
        nextObjective.vs = uniqueLines(exactCandidate.length > 0 ? exactCandidate : sourceOwnedLines, 4);
      } else if (section === "lab") {
        nextObjective.lab = mergeLabLinesForDaily(baseObjective.lab, sourceOwnedLines, 12);
      } else if (section === "image") {
        const incomingImages = newestImageStudyLines(sourceOwnedLines, 8);
        const incomingStudyKeys = new Set(incomingImages.map(imageStudyKey).filter(Boolean));
        const carryForward = baseObjective.image.filter((line) => {
          const key = imageStudyKey(line);
          return !key || !incomingStudyKeys.has(key);
        });
        nextObjective.image = mergeDailyLines(carryForward, incomingImages, { maxItems: 8 });
      } else if (section === "other") {
        const incomingPathology = sourceOwnedLines;
        const carryForward = baseObjective.other.filter((line) => !incomingPathology.some((sourceLine) => isPathologyResultLine(sourceLine) && isPathologyResultLine(line)));
        nextObjective.other = mergeDailyLines(carryForward, incomingPathology, { maxItems: 6 });
      }
      if (!sameLines(baseObjective[section], nextObjective[section])) {
        pushChanged(changed, section, `${sectionLabels[section]} updated deterministically from pasted source`);
      }
      return;
    }

    const differs = !sameLines(baseObjective[section], candidateObjective[section]);
    if (!differs) return;
    if (profile.allowed.has(section)) {
      if (section === "vs") {
        nextObjective[section] = uniqueLines(candidateObjective[section], 4);
      } else if (section === "lab") {
        const sourceLabLines = sourceHas(fields.labs)
          ? formatLabVisualSummaryFromLines(fields.labs ?? "", { includeLabPrefix: true }).lines
          : [];
        nextObjective[section] = mergeLabLinesForDaily(
          baseObjective[section],
          sourceLabLines.length > 0 ? sourceLabLines : candidateObjective[section],
          12,
        );
      } else if (section === "image") {
        // A fresh report for the same study (e.g., today's CXR) replaces the stale line instead of stacking under it.
        const newestCandidateImages = newestImageStudyLines(candidateObjective.image, 8);
        const incomingStudyKeys = new Set(newestCandidateImages.map(imageStudyKey).filter(Boolean));
        const baselineWithoutReplacedStudies = baseObjective.image.filter((line) => {
          const key = imageStudyKey(line);
          return !key || !incomingStudyKeys.has(key);
        });
        nextObjective[section] = mergeDailyLines(baselineWithoutReplacedStudies, newestCandidateImages, { maxItems: 8 });
      } else if (section === "other") {
        const supportedOther = filterUnsupportedDailyLines(candidateObjective.other, fields, baselineText, "O/Other");
        warnings.push(...supportedOther.warnings);
        const incomingHasPathology = supportedOther.accepted.some(isPathologyResultLine);
        const carryForward = incomingHasPathology
          ? baseObjective.other.filter((line) => !isPathologyResultLine(line))
          : baseObjective.other;
        nextObjective.other = mergeDailyLines(carryForward, supportedOther.accepted, { maxItems: 6 });
      } else {
        nextObjective[section] = mergeDailyLines(baseObjective[section], candidateObjective[section], { maxItems: 5 });
      }
      pushChanged(changed, section, `${sectionLabels[section]} updated from pasted field`);
    } else {
      pushChanged(changed, section, `AI changed ${sectionLabels[section]} without matching source field`, "high", true);
      highRiskWarnings.push(`${sectionLabels[section]} change blocked: no matching pasted field.`);
    }
  });

  const baselineTasks = splitTasks(baseline.taskLines);
  const candidateTasks = splitTasks(candidate.taskLines);
  const pastedSourceText = sourceFieldsText(fields);
  const nextOrders = profile.allowed.has("orders")
    ? mergeOrderLinesForDaily(baselineTasks.orders, candidateTasks.orders, fields, 12)
    : baselineTasks.orders;
  const taskSourceAllowsUpdate = profile.allowed.has("tasks");
  const filteredTasks = filterUnsupportedDailyLines(candidateTasks.tasks, fields, baselineText, "Task");
  const baselineOpenTasks = baselineTasks.tasks.filter((task) => !taskExplicitlyCompleted(task, pastedSourceText));
  const candidateOpenTasks = filteredTasks.accepted.filter((task) => !taskExplicitlyCompleted(task, pastedSourceText));
  const nextTasks = taskSourceAllowsUpdate
    ? mergeDailyLines(baselineOpenTasks, candidateOpenTasks, { maxItems: 10 })
    : baselineTasks.tasks;
  warnings.push(...filteredTasks.warnings);
  if (!sameLines(baselineTasks.orders, nextOrders)) {
    pushChanged(changed, "orders", "Medication/orders updated from pasted source");
  } else if (!sameLines(baselineTasks.orders, candidateTasks.orders) && !profile.allowed.has("orders")) {
    pushChanged(changed, "orders", "AI changed orders without matching source field", "high", true);
  }
  if (!sameLines(baselineTasks.tasks, candidateTasks.tasks)) {
    pushChanged(changed, "tasks", taskSourceAllowsUpdate ? "Tasks updated from pasted course/task field" : "AI changed tasks without matching source field", taskSourceAllowsUpdate ? "normal" : "high", !taskSourceAllowsUpdate);
  }

  const candidateApProblems = candidate.apProblems.map((problem) => ({ ...problem, lines: [...problem.lines] }));
  const backedProblems = sourceBackedProblems(fields, baseline);
  backedProblems.forEach((problem) => {
    const match = findMatchingProblem(problem, candidateApProblems);
    if (match) {
      const baselineMatch = baseline.apProblems.find((baselineProblem) => problemMatchScore(problem, baselineProblem) > 0);
      match.title = baselineMatch?.title ?? problem.title;
      const sourceDomains = new Set(problem.lines.flatMap(apLineDomains));
      const supplementalLines = match.lines.filter((line) => {
        if (hasEquivalentLine(problem.lines, line)) return false;
        if (!baselineMatch && !lineHasProblemAffinity(problem, line)) return false;
        const domains = apLineDomains(line);
        return domains.length === 0 || !domains.some((domain) => sourceDomains.has(domain));
      });
      match.lines = uniqueLines([
        ...problem.lines,
        ...supplementalLines,
      ], 2);
    } else {
      candidateApProblems.push(problem);
    }
  });
  let nextApProblems = baseline.apProblems;
  if (!sameProblems(baseline.apProblems, candidateApProblems)) {
    if (profile.allowed.has("ap")) {
      const filteredAp = filterUnsupportedDailyAp(candidateApProblems, fields, baselineText);
      warnings.push(...filteredAp.warnings);
      const merged = mergeApProblemsForDaily(
        baseline.apProblems,
        filteredAp.problems,
        profile.allowed.has("s") || profile.allowed.has("pe") || profile.allowed.has("lab") || profile.allowed.has("image") || profile.allowed.has("other"),
        pastedSourceText,
        new Set(backedProblems.map((problem) => apKey(problem.title))),
      );
      nextApProblems = merged.apProblems;
      warnings.push(...merged.warnings);
      highRiskWarnings.push(...merged.highRiskWarnings);
      if (!sameProblems(baseline.apProblems, nextApProblems)) {
        pushChanged(changed, "ap", "A/P updated under clinician-preserved problem structure", merged.highRiskWarnings.length > 0 ? "high" : "normal", false);
      }
    } else {
      pushChanged(changed, "ap", "AI changed A/P without matching source field", "high", true);
      highRiskWarnings.push("A/P change blocked: source was limited to V/S/orders or unrelated fields.");
    }
  }

  const filteredDc = filterUnsupportedDailyLines(candidate.dcLines, fields, baselineText, "DC");
  const hasNewDischargeTarget = /\b(?:dc|discharge)\b[^\n]*(?:today|tomorrow|\d{4}-\d{2}-\d{2})|\b(?:today|tomorrow)\b[^\n]*(?:dc|discharge)\b/i.test(pastedSourceText);
  const baselineDcForMerge = hasNewDischargeTarget
    ? baseline.dcLines.filter((line) => !/\btarget\b|\b\d{4}-\d{2}-\d{2}\b/i.test(line))
    : baseline.dcLines;
  const candidateDcForMerge = hasNewDischargeTarget
    ? filteredDc.accepted.filter((line) => !/\btarget\b|\b\d{4}-\d{2}-\d{2}\b/i.test(line) || pastedSourceText.toLowerCase().includes(line.toLowerCase()))
    : filteredDc.accepted;
  const nextDc = profile.allowed.has("dc")
    ? mergeDailyLines(baselineDcForMerge, candidateDcForMerge, { maxItems: 8 })
    : baseline.dcLines;
  warnings.push(...filteredDc.warnings);
  if (!sameLines(baseline.dcLines, candidate.dcLines)) {
    pushChanged(changed, "dc", profile.allowed.has("dc") ? "DC updated from pasted source" : "AI changed DC without discharge source", profile.allowed.has("dc") ? "normal" : "high", !profile.allowed.has("dc"));
  }

  if (!sameLines(baseline.header, candidate.header)) {
    pushChanged(changed, "header", "AI changed header/Dx/PMH in Daily update", "high", true);
    highRiskWarnings.push("Header/Dx/PMH change blocked for Daily update.");
  }
  const filteredS = filterUnsupportedDailyLines(candidate.sLines, fields, baselineText, "S");
  warnings.push(...filteredS.warnings);
  if (!sameLines(baseline.sLines, candidate.sLines)) {
    if (profile.allowed.has("s")) pushChanged(changed, "s", "S updated from pasted course/symptom field");
    else {
      pushChanged(changed, "s", "AI changed S without symptom/course source", "high", true);
      highRiskWarnings.push("S change blocked: no symptom/course field was pasted.");
    }
  }

  const candidateText = [
    ...candidate.header,
    ...candidate.sLines,
    ...candidate.oLines,
    ...candidate.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...candidate.taskLines,
    ...candidate.dcLines,
  ];
  protectedLines(baseline).forEach((line) => {
    const key = normalizeLine(line);
    if (key && !candidateText.some((candidateLine) => normalizeLine(candidateLine).includes(key) || key.includes(normalizeLine(candidateLine)))) {
      highRiskWarnings.push(`Protected item possibly removed by AI: ${safeClinicalLine(line, 80)}`);
    }
  });
  if (totalLineCount(candidate) < Math.floor(totalLineCount(baseline) * 0.65)) {
    highRiskWarnings.push("AI output was much shorter than baseline; unrelated deletions were blocked where possible.");
  }

  const draftBeforeAntibiotics = {
      header: baseline.header,
      sLines: profile.allowed.has("s")
        ? mergeSubjectiveLinesForDaily(baseline.sLines, filteredS.accepted, 6)
        : baseline.sLines,
      oLines: mergeObjective(nextObjective, 22),
      apProblems: nextApProblems,
      taskLines: uniqueLines([...nextOrders, ...nextTasks], Math.max(10, nextOrders.length + nextTasks.length)),
      dcLines: nextDc,
      warnings: uniqueLines([...baseline.warnings, ...candidate.warnings], 5),
    } satisfies SoapDraft;
  return {
    draft: draftBeforeAntibiotics,
    changed,
    warnings,
    highRiskWarnings,
  };
}

export function guardRoundSoapDelta({
  workflowMode,
  baselineText,
  candidateText,
  sourceFields,
  candidateWarnings = [],
  selectedDate = "",
}: {
  workflowMode: RoundSoapWorkflowMode;
  baselineText: string;
  candidateText: string;
  sourceFields: RoundSoapSourceFields;
  candidateWarnings?: string[];
  selectedDate?: string;
}): SoapDeltaReview {
  const baselineSanitized = sanitizeDraftObjective(parseSoapText(baselineText));
  const candidateSanitized = sanitizeDraftObjective(parseSoapText(candidateText || baselineText));
  const baseline = baselineSanitized.draft;
  const parsedCandidate = candidateSanitized.draft;
  const sourceText = sourceFieldsText(sourceFields);
  const significanceFiltered = filterUnsupportedAnemiaProblem(parsedCandidate, baseline, sourceText, workflowMode);
  const activeAntibiotics = extractActiveAntibioticNames(sourceText);
  const beforeAntibioticText = formatSoapDraft(significanceFiltered.draft).toLowerCase();
  const missingAntibiotics = activeAntibiotics.filter((name) => !beforeAntibioticText.includes(name));
  const antibioticGroundedCandidate = ensureAntibioticApInDraft(significanceFiltered.draft, sourceText, selectedDate);
  const objectiveGrounded = ensureSourceObjectiveCoverage(antibioticGroundedCandidate, sourceFields);
  const sourceGroundedCandidate = objectiveGrounded.draft;
  const afterAntibioticText = formatSoapDraft(sourceGroundedCandidate).toLowerCase();
  const restoredAntibiotics = missingAntibiotics.filter((name) => afterAntibioticText.includes(name));
  const fidelityWarnings = [
    ...(baselineSanitized.rejected.length > 0
      ? ["Legacy lab export header(s) without result values were hidden from this preview; Save reviewed SOAP to persist the cleanup."]
      : []),
    ...(candidateSanitized.rejected.length > 0
      ? ["AI lab export header(s) without result values were rejected before reaching the editor."]
      : []),
    ...significanceFiltered.warnings,
    ...objectiveGrounded.warnings,
    ...(restoredAntibiotics.length > 0
      ? [`Restored source-grounded active antimicrobial(s) omitted by AI: ${restoredAntibiotics.join(", ")}.`]
      : []),
  ];
  const malformedDailyCandidate = workflowMode === "dailyUpdate" && candidateText.trim().length > 0 && !hasSoapBody(parsedCandidate);
  const protectedCandidate = carryForwardProtectedDraft(baseline, sourceGroundedCandidate);
  const candidate = workflowMode === "dailyUpdate" || workflowMode === "repairSoap"
    ? sourceGroundedCandidate
    : protectedCandidate.draft;
  const normalizedBaselineText = formatSoapDraft(baseline);
  const normalizedCandidateText = formatSoapDraft(candidate);
  const coverageWarnings = sourceCoverageWarnings(sourceText, normalizedCandidateText);
  if (workflowMode !== "dailyUpdate") {
    return {
      workflowMode,
      baselineText: normalizedBaselineText,
      candidateText: normalizedCandidateText,
      acceptedText: normalizedCandidateText,
      changedSections: analyzeChangedSections(baseline, candidate),
      warnings: uniqueLines([
        ...candidateWarnings,
        ...fidelityWarnings,
        ...(workflowMode === "repairSoap" ? [] : protectedCandidate.warnings),
        ...coverageWarnings,
      ], 8),
      highRiskWarnings: workflowMode === "repairSoap" || protectedCandidate.warnings.length === 0
        ? []
        : protectedCandidate.warnings,
    };
  }

  const daily = draftForDailyUpdate(baseline, candidate, sourceFields, selectedDate);
  const acceptedText = formatSoapDraft(daily.draft);
  return {
    workflowMode,
    baselineText: normalizedBaselineText,
    candidateText: normalizedCandidateText,
    acceptedText,
    changedSections: daily.changed,
    warnings: uniqueLines([
      ...candidateWarnings,
      ...fidelityWarnings,
      ...coverageWarnings,
      ...(malformedDailyCandidate ? ["AI returned malformed SOAP text; reviewed baseline was preserved except source-supported local guardrails."] : []),
      ...daily.warnings,
    ], 8),
    highRiskWarnings: uniqueLines([
      ...(malformedDailyCandidate ? ["Malformed daily SOAP draft blocked; no unsupported rewrite was applied."] : []),
      ...daily.highRiskWarnings,
    ], 8),
  };
}

function replaceSection(current: SoapDraft, source: SoapDraft, section: SoapDeltaSection): SoapDraft {
  if (section === "header") return { ...current, header: source.header };
  if (section === "s") return { ...current, sLines: source.sLines };
  if (section === "ap") return { ...current, apProblems: source.apProblems };
  if (section === "dc") return { ...current, dcLines: source.dcLines };
  if (section === "orders" || section === "tasks") {
    const currentTasks = splitTasks(current.taskLines);
    const sourceTasks = splitTasks(source.taskLines);
    return {
      ...current,
      taskLines: uniqueLines(
        [
          ...(section === "orders" ? sourceTasks.orders : currentTasks.orders),
          ...(section === "tasks" ? sourceTasks.tasks : currentTasks.tasks),
        ],
        8,
      ),
    };
  }
  const currentObjective = splitObjective(current.oLines);
  const sourceObjective = splitObjective(source.oLines);
  currentObjective[section] = sourceObjective[section];
  return { ...current, oLines: mergeObjective(currentObjective) };
}

export function restoreSoapDeltaSection(currentText: string, baselineText: string, section: SoapDeltaSection) {
  return formatSoapDraft(replaceSection(parseSoapText(currentText), parseSoapText(baselineText), section));
}

export function acceptSoapDeltaSection(currentText: string, candidateText: string, section: SoapDeltaSection) {
  return formatSoapDraft(replaceSection(parseSoapText(currentText), parseSoapText(candidateText), section));
}
