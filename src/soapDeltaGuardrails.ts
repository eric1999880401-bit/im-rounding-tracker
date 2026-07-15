import { classifyClinicalLine } from "./clinicalLineClassifier";
import { imageStudyKey } from "./clinicalFieldRouter";
import { formatSoapDraft, parseSoapText, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { parseLabReports, safeClinicalLine, safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";
import type { SoapPatch } from "./types";

export type RoundSoapWorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff";

export type SoapDeltaSection =
  | "header"
  | "s"
  | "vs"
  | "pe"
  | "lab"
  | "image"
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
}

const sectionLabels: Record<SoapDeltaSection, string> = {
  header: "Header",
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "Lab",
  image: "Image",
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
  if (/^(?:image|img)\s*:/i.test(text) || /\b(?:CT|MRI|CXR|sono|ultrasound|US\b|echo|ERCP|EGD|colonoscopy|impression)\b/i.test(text)) return "image";
  if (/^(?:v\/s|vs|vitals?)\s*:/i.test(text) || /\b(?:BP|HR|RR|SpO2|T\s*\d|afebrile|pressor|norepi|oxygen|O2|NC\s*\d*L?|RA)\b/i.test(text)) return "vs";
  if (/^pe\s*:.*\b(?:shock|pressor|norepi|hemodynamic|BP|SpO2|oxygen|O2|NC\s*\d*L?|RA)\b/i.test(text)) return "vs";
  if (/^pe\s*:/i.test(text)) return "pe";
  if (/^(?:lab)\s*:/i.test(text) || /\b(?:WBC|Neu|Hb|Hct|Plt|platelet|INR|PT|aPTT|T-?bil|D-?bil|AST|ALT|ALP|GGT|Cr|BUN|Na|K\b|Mg|Ca|Phos|lactate|CRP|troponin|culture|Cx|B\/C|BCx)\b/i.test(text)) return "lab";
  const classified = classifyClinicalLine(line, { fallbackKind: "other" });
  if (classified.kind === "vs") return "vs";
  if (classified.kind === "lab") return "lab";
  if (classified.kind === "image") return "image";
  return "pe";
}

function splitObjective(lines: string[]): ObjectiveGroups {
  const groups: ObjectiveGroups = { vs: [], pe: [], lab: [], image: [] };
  lines.forEach((line) => groups[lineKind(line)].push(line));
  return groups;
}

function mergeObjective(groups: ObjectiveGroups, maxItems = 18) {
  return uniqueLines(
    [
      ...groups.vs.map((line) => ensureObjectivePrefix(line, "V/S")),
      ...groups.pe.map((line) => ensureObjectivePrefix(line, "PE")),
      ...groups.lab.map((line) => ensureObjectivePrefix(line, "Lab")),
      ...groups.image.map((line) => ensureObjectivePrefix(line, "Image")),
    ],
    maxItems,
  );
}

function ensureObjectivePrefix(line: string, prefix: "V/S" | "PE" | "Lab" | "Image") {
  const clean = String(line ?? "").trim();
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

const highYieldMedicationPattern = /\b(?:teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|ceftazidime|unasyn|pip\/?tazo|zosyn|meropenem|imipenem|ertapenem|azithro(?:mycin)?|levofloxacin|ciprofloxacin|metronidazole|linezolid|daptomycin|apixaban|heparin|warfarin|insulin|norepi(?:nephrine)?|vasopressin)\b/gi;

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
  const medicationNames = [...new Set((source.match(highYieldMedicationPattern) ?? []).map((item) => item.toLowerCase()))];
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

function sourceProfile(fields: RoundSoapSourceFields) {
  const other = String(fields.other ?? "");
  const hasVitals = sourceHas(fields.vitals);
  const hasLabs = sourceHas(fields.labs);
  const hasImages = sourceHas(fields.images);
  const hasOrders = sourceHas(fields.orders);
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
  if (hasOrders) allowed.add("orders");
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
    if (/\b(cholangitis|sepsis|infection|infect|bacteremia|pna|pneumonia|abx|antibiotic|culture|cx|ercp|source control)\b/.test(value)) return "infection";
    return "";
  };
  return bucketFrom(title) || bucketFrom(text);
}

function findMatchingProblems(problem: SoapApProblem, problems: SoapApProblem[]) {
  const key = apKey(problem.title);
  const exact = problems.filter((candidate) => {
    const candidateKey = apKey(candidate.title);
    return Boolean(key && candidateKey && (key.includes(candidateKey) || candidateKey.includes(key)));
  });
  const bucket = problemBucket(problem);
  const bucketMatches = bucket ? problems.filter((candidate) => problemBucket(candidate) === bucket && !exact.includes(candidate)) : [];
  return [...bucketMatches, ...exact];
}

function mergeApProblemsForDaily(baseline: SoapApProblem[], candidate: SoapApProblem[], allowNewProblem: boolean, sourceText = "") {
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
    const candidateText = candidateLines.join(" ");
    const staleObjectivePattern = /\b(?:wbc|hb|hgb|plt|cr|bun|na|k\b|ast|alt|t-?bil|inr|lactate|crp|cxr|ct\b|mri\b|echo\b|sono|ultrasound)\b/i;
    if (staleObjectivePattern.test(line) && staleObjectivePattern.test(candidateText)) return false;
    return /\b(?:abx|antibiotic|teicoplanin|vancomycin|ceftriaxone|cefepime|meropenem|zosyn|pip\/tazo|culture|b\/c|bcx|source control|ercp|stent|drain|tube|dc|discharge|opd|certificate|hold|resume|restart|apixaban|heparin|warfarin)\b/i.test(line);
  };
  const compactProblemLines = (baselineLines: string[], candidateLines: string[]) => {
    const updatedLines = uniqueLines(candidateLines, 3);
    if (updatedLines.length === 0) return uniqueLines(baselineLines, 2);
    const protectedCarryForward = baselineLines
      .filter((line) => shouldCarryForwardApLine(line, updatedLines))
      .filter((line) => !hasEquivalentLine(updatedLines, line));
    return uniqueLines([...updatedLines, ...protectedCarryForward], 2);
  };
  const next = baseline.map((problem) => {
    const matches = findMatchingProblems(problem, candidate);
    if (matches.length === 0 || matches.every((match) => match.lines.length === 0)) return problem;
    const candidateLines = matches.flatMap((match) => match.lines);
    return {
      title: problem.title,
      lines: compactProblemLines(problem.lines, candidateLines),
    };
  });
  const baselineTitles = apTitles(baseline);
  const candidateTitles = apTitles(candidate);
  const removedTitles = baselineTitles.filter((title) => !candidateTitles.some((candidateTitle) => title.includes(candidateTitle) || candidateTitle.includes(title)));
  if (removedTitles.length > 0 && baseline.length > 0) {
    highRiskWarnings.push("AI attempted to remove or rename existing A/P problem(s); baseline A/P titles were preserved.");
  }
  const unmatched = candidate.filter((problem) => !findMatchingProblem(problem, baseline));
  const realNewProblems = unmatched.filter((problem) => {
    const text = `${problem.title} ${problem.lines.join(" ")}`;
    if (/\b(clinical improvement|improving after|improvement after|post[- ]?procedure improvement)\b/i.test(problem.title)) return false;
    return Boolean(problemBucket(problem) || /\b(new|acute|positive|worsening|thrombus|bleed|respiratory failure|effusion|aki|lft|coag)\b/i.test(text));
  });
  if (allowNewProblem && next.length < 5) {
    const openSlots = Math.max(0, 5 - next.length);
    next.push(...realNewProblems.slice(0, openSlots).map((problem) => ({ title: safeClinicalLine(problem.title, 90), lines: uniqueLines(problem.lines, 2) })));
    if (realNewProblems.length > openSlots) warnings.push("AI suggested multiple new A/P problems; only the highest-yield were applied for Daily update.");
  } else if (realNewProblems.length > 0) {
    warnings.push("AI suggested new A/P problem(s) from limited daily source; they were held for review.");
  }
  return { apProblems: next.slice(0, Math.max(5, baseline.length)), warnings, highRiskWarnings };
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

function enrichLabLineWithPreviousValues(line: string, previousValues: Map<string, string>) {
  let next = line;
  const candidateItems = parseLabReports(line).flatMap((report) => report.items);
  candidateItems.forEach((item) => {
    const key = labItemKey(item.name || item.label);
    const current = labValueKey(String(item.value ?? ""));
    const previous = labValueKey(String(item.previousValue ?? "")) || previousValues.get(key) || "";
    if (!key || !current || !previous || previous === current) return;

    const labelAlternates = [item.label, item.name].filter(Boolean).map((value) => escapeRegExp(String(value))).join("|");
    if (!labelAlternates) return;
    const currentPattern = escapeRegExp(String(item.value ?? ""));
    const pattern = new RegExp(`\\b(${labelAlternates})\\.?\\s*(${currentPattern})(?!\\s*(?:\\(|from\\b))`, "i");
    next = next.replace(pattern, (_match, label, value) => `${label} ${value} (${previous})`);
  });
  return next;
}

function mergeLabLinesForDaily(baseline: string[], candidate: string[], maxItems = 12) {
  const candidateLines = uniqueLines(candidate, maxItems);
  if (candidateLines.length === 0) return baseline;
  const previousValues = previousLabValues(baseline);
  return uniqueLines(candidateLines.map((line) => enrichLabLineWithPreviousValues(line, previousValues)), maxItems);
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
  (["vs", "pe", "lab", "image"] as const).forEach((section) => {
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
  };

  (["vs", "pe", "lab", "image"] as const).forEach((section) => {
    const differs = !sameLines(baseObjective[section], candidateObjective[section]);
    if (!differs) return;
    if (profile.allowed.has(section)) {
      if (section === "vs") {
        nextObjective[section] = uniqueLines(candidateObjective[section], 4);
      } else if (section === "lab") {
        nextObjective[section] = mergeLabLinesForDaily(baseObjective[section], candidateObjective[section], 12);
      } else if (section === "image") {
        // A fresh report for the same study (e.g., today's CXR) replaces the stale line instead of stacking under it.
        const newestCandidateImages = newestImageStudyLines(candidateObjective.image, 8);
        const incomingStudyKeys = new Set(newestCandidateImages.map(imageStudyKey).filter(Boolean));
        const baselineWithoutReplacedStudies = baseObjective.image.filter((line) => {
          const key = imageStudyKey(line);
          return !key || !incomingStudyKeys.has(key);
        });
        nextObjective[section] = mergeDailyLines(baselineWithoutReplacedStudies, newestCandidateImages, { maxItems: 8 });
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
    ? mergeDailyLines(baselineTasks.orders, candidateTasks.orders, { maxItems: 10 })
    : baselineTasks.orders;
  const taskSourceAllowsUpdate = profile.allowed.has("tasks");
  const filteredTasks = filterUnsupportedDailyLines(candidateTasks.tasks, fields, baselineText, "Task");
  const baselineOpenTasks = baselineTasks.tasks.filter((task) => !taskExplicitlyCompleted(task, pastedSourceText));
  const candidateOpenTasks = filteredTasks.accepted.filter((task) => !taskExplicitlyCompleted(task, pastedSourceText));
  const nextTasks = taskSourceAllowsUpdate
    ? mergeDailyLines(baselineOpenTasks, candidateOpenTasks, { maxItems: 10 })
    : baselineTasks.tasks;
  warnings.push(...filteredTasks.warnings);
  if (!sameLines(baselineTasks.orders, candidateTasks.orders)) {
    pushChanged(changed, "orders", profile.allowed.has("orders") ? "Orders updated from pasted order field" : "AI changed orders without matching source field", profile.allowed.has("orders") ? "normal" : "high", !profile.allowed.has("orders"));
  }
  if (!sameLines(baselineTasks.tasks, candidateTasks.tasks)) {
    pushChanged(changed, "tasks", taskSourceAllowsUpdate ? "Tasks updated from pasted course/task field" : "AI changed tasks without matching source field", taskSourceAllowsUpdate ? "normal" : "high", !taskSourceAllowsUpdate);
  }

  let nextApProblems = baseline.apProblems;
  if (!sameProblems(baseline.apProblems, candidate.apProblems)) {
    if (profile.allowed.has("ap")) {
      const filteredAp = filterUnsupportedDailyAp(candidate.apProblems, fields, baselineText);
      warnings.push(...filteredAp.warnings);
      const merged = mergeApProblemsForDaily(
        baseline.apProblems,
        filteredAp.problems,
        profile.allowed.has("s") || profile.allowed.has("pe") || profile.allowed.has("lab") || profile.allowed.has("image"),
        pastedSourceText,
      );
      nextApProblems = merged.apProblems;
      warnings.push(...merged.warnings);
      highRiskWarnings.push(...merged.highRiskWarnings);
      pushChanged(changed, "ap", "A/P updated only under preserved problem structure", merged.highRiskWarnings.length > 0 ? "high" : "normal", false);
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
  const baseline = parseSoapText(baselineText);
  const parsedCandidate = parseSoapText(candidateText || baselineText);
  const malformedDailyCandidate = workflowMode === "dailyUpdate" && candidateText.trim().length > 0 && !hasSoapBody(parsedCandidate);
  const protectedCandidate = carryForwardProtectedDraft(baseline, parsedCandidate);
  const candidate = workflowMode === "dailyUpdate" ? parsedCandidate : protectedCandidate.draft;
  const normalizedBaselineText = formatSoapDraft(baseline);
  const normalizedCandidateText = formatSoapDraft(candidate);
  const coverageWarnings = sourceCoverageWarnings(sourceFieldsText(sourceFields), normalizedCandidateText);
  if (workflowMode !== "dailyUpdate") {
    return {
      workflowMode,
      baselineText: normalizedBaselineText,
      candidateText: normalizedCandidateText,
      acceptedText: normalizedCandidateText,
      changedSections: analyzeChangedSections(baseline, candidate),
      warnings: uniqueLines([...candidateWarnings, ...protectedCandidate.warnings, ...coverageWarnings], 8),
      highRiskWarnings: protectedCandidate.warnings.length > 0 ? protectedCandidate.warnings : [],
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
