// Lab text parsing, lab focus/interpretation summaries. Extracted from utils.ts (Phase 1 refactor).
import type { DailyNote, LabReport, ParsedLabItem, Patient } from "./types";
import {
  findLabDictionaryItem,
  labAliasPattern,
  labGroupFor,
  normalizeLabDisplayName,
} from "./data/labDictionary";
import { dateFromClinicalText, normalizeDateKey, stripLeadingClinicalDate, todayKey } from "./dates";
import { plainClinicalText } from "./clinicalTextFormat";

function todayDate() {
  return todayKey();
}

const labValuePattern = "([<>]?[0-9]+(?:\\.[0-9]+)?%?\\+?)";
const labFlagPattern = "(?:\\s*(?:\\[?([HL])\\]?|([↑↓↗↘])|\\b(high|low|elevated|decreased|positive|negative|pos|neg|reactive|nonreactive|detected|not detected)\\b))?";
const labUnitPattern = "(ng\\/mL|ng\\/L|pg\\/mL|ug\\/mL|µg\\/mL|mcg\\/mL|mg\\/dL|g\\/dL|k\\/uL|10\\^3\\/uL|mmol\\/L|mEq\\/L|U\\/L|IU\\/L|%)";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitAfterMatch(line: string, matchIndex: number | undefined, value: string) {
  if (matchIndex === undefined || !value) return "";
  const after = line.slice(matchIndex);
  return after.match(new RegExp(`${escapeRegExp(value)}\\s*${labUnitPattern}`, "i"))?.[1] ?? "";
}

function normalizeLabNote(...values: Array<string | undefined>) {
  const raw = values.find((value) => value && value.trim())?.trim() ?? "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (raw === "↑" || raw === "↗" || lower === "h" || lower === "high" || lower === "elevated") return "H";
  if (raw === "↓" || raw === "↘" || lower === "l" || lower === "low" || lower === "decreased") return "L";
  if (lower === "pos") return "positive";
  if (lower === "neg") return "negative";
  return raw;
}

function normalizeGenericLabLabel(value: string) {
  const clean = value
    .replace(/^(?:lab|labs|latest|today|repeat|trend)\s+/i, "")
    .replace(/\b(?:level|value|result)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:=-]+|[,;:=-]+$/g, "")
    .trim();
  const dictionary = findLabDictionaryItem(clean);
  if (dictionary) return dictionary.displayName;
  const canonical = canonicalLabKey(clean);
  if (canonical && canonical.toLowerCase() !== clean.toLowerCase()) return canonical;
  return /^[A-Za-z0-9+./-]{2,4}$/.test(clean) ? clean.replace(/[a-z]/g, (letter) => letter.toUpperCase()) : clean;
}

function shouldSkipGenericLabLabel(value: string) {
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 30) return true;
  if (findLabDictionaryItem(clean)) return true;
  const compact = clean.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compact || /^\d+$/.test(compact)) return true;
  return /^(bp|hr|rr|bt|temp|spo2|sat|fio2|ef|pasp|day|date|age|bed|room|rm|pt|patient|code|dose|qd|bid|tid|qid|mg|kg|cm|min|hour|hr|afebrile|febrile|fever)$/i.test(compact);
}

function parsedLabItem(
  label: string,
  value: string,
  previousValue: string,
  important: boolean,
  groupHint: string,
  note = "",
  unitOverride = "",
): ParsedLabItem {
  const dictionaryItem = findLabDictionaryItem(label);
  const normalizedLabel = normalizeLabDisplayName(label);
  const dictionaryGroup = dictionaryItem?.group ?? labGroupFor(normalizedLabel);
  const group = groupHint || dictionaryGroup;
  const commonUnit = dictionaryItem?.commonUnits[0] ?? "";
  const unit = unitOverride || (/^Troponin(?:\s+[IT])?$/i.test(normalizedLabel) ? "" : commonUnit);

  return {
    label: normalizedLabel,
    name: normalizedLabel,
    value,
    previousValue,
    group,
    important,
    isImportant: important,
    unit: unit === "%" && value.includes("%") ? "" : unit,
    color: "",
    note,
  };
}

function parseLabItemsFromLine(line: string, important: boolean, groupHint = "") {
  if (/^\s*(?:U\/?A|urine|urinalysis)\s*$/i.test(groupHint)) groupHint = "Urinalysis";
  const items: ParsedLabItem[] = [];
  const directionalKeys = new Set<string>();
  const tumorMarkerPattern = new RegExp(
    `\\b(CA\\s*19[-\\s]?9|CA\\s*125|CA\\s*15[-\\s]?3|AFP|CEA|SCC|PSA)\\s*${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const drugLevelPattern = new RegExp(
    `\\b(Vanco(?:mycin)?|Vancomycin|Digoxin|Phenytoin|Dilantin|Valproate|VPA)(?:\\s+(?:trough|level))?\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const cultureStatusPattern = /\b(Blood culture|B\/C|BCx|Sputum culture|S\/C|SCx|Urine culture|U\/C|UCx)\s*(?:\d{1,2}\/\d{1,2})?\s*(?:[:=-])?\s*(pending|no growth|negative|positive|growth[^,;\n]*)/gi;
  // "[:=]?" after the alias: clinicians write "Cortisol: 5.2" / "TSH = 0.8";
  // without it the dictionary pattern misses and the generic pattern skips
  // dictionary labels, so the value vanished entirely.
  const directionalPattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*(?:[:=]\\s*)?${labValuePattern}\\s*(?:->|→|to)\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const genericDirectionalPattern = new RegExp(
    `(?:^|[,;])\\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\\s*${labValuePattern}\\s*(?:->|→|to)\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const pattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*(?:[:=]\\s*)?${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const genericPattern = new RegExp(
    `(?:^|[,;])\\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\\s*(?:[:=])?\\s*${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const qualitativePattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*(?::|=)?\\s*(positive|negative|pos|neg|reactive|nonreactive|detected|not detected|pending|no growth|growth[^,;\\n]*)`,
    "gi",
  );
  const genericQualitativePattern = /(?:^|[,;])\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\s*(?::|=)\s*(positive|negative|pos|neg|reactive|nonreactive|detected|not detected|pending|no growth|growth[^,;\n]*)/gi;
  // "U/A" (with slash) is the common bedside spelling — without it, urine
  // WBC >1000 / RBC land in the blood CBC line as a fake critical count.
  const uaContext = /\b(U\/?A|urine|urinalysis)\b/i.test(groupHint) || /\b(U\/?A|urine|urinalysis)\s*:?\b/i.test(line);

  // Composite slash pairs like "BUN/Cr 33/0.63" or "AST/ALT 20/18": split the
  // label list and the value list positionally so each lab gets its own value.
  // Without this the generic matcher grabs "Cr 33" (the BUN number) — a
  // dangerous misread. Only fires when every label part is a known lab and the
  // label/value counts match, so dates ("5/13") and ratios never trigger it.
  const slashPairPattern = /(?:^|[\s,;(])([A-Za-z][A-Za-z0-9-]*(?:\/[A-Za-z][A-Za-z0-9-]*)+)\s*[:=]?\s*([<>]?[0-9][0-9.]*%?(?:\/[<>]?[0-9][0-9.]*%?)+)/g;
  Array.from(line.matchAll(slashPairPattern)).forEach((match) => {
    const labelParts = match[1].split("/").map((part) => part.trim()).filter(Boolean);
    const valueParts = match[2].split("/").map((part) => part.trim()).filter(Boolean);
    if (labelParts.length < 2 || labelParts.length !== valueParts.length) return;
    if (!labelParts.every((part) => findLabDictionaryItem(part))) return;
    // Claim the composite label ("BUN/Cr") so the generic matcher does not
    // re-emit it as a single bogus item with the first value.
    directionalKeys.add(canonicalLabKey(match[1]));
    labelParts.forEach((labelPart, index) => {
      const label = normalizeLabDisplayName(labelPart);
      const key = canonicalLabKey(label);
      if (directionalKeys.has(key)) return;
      directionalKeys.add(key);
      items.push(parsedLabItem(label, valueParts[index], "", important, groupHint));
    });
  });

  Array.from(line.matchAll(tumorMarkerPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[2], match[3] ?? match[4] ?? "", important, groupHint || "Tumor / Special common", normalizeLabNote(match[5], match[6], match[7]), unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(drugLevelPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[2], "", important, groupHint || "Drug levels", normalizeLabNote(match[3], match[4], match[5]), unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(cultureStatusPattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint || "Inflammation / Infection", normalizeLabNote(match[2])));
  });

  Array.from(line.matchAll(directionalPattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[3], match[2], important, groupHint, normalizeLabNote(match[4], match[5], match[6]) || "trend", unitAfterMatch(line, match.index, match[3])));
  });

  Array.from(line.matchAll(genericDirectionalPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[3], match[2], important, groupHint || "Other labs", normalizeLabNote(match[4], match[5], match[6]) || "trend", unitAfterMatch(line, match.index, match[3])));
  });

  Array.from(line.matchAll(pattern)).forEach((match) => {
    const dictionaryItem = findLabDictionaryItem(match[1]);
    const normalizedLabel = normalizeLabDisplayName(match[1]);
    if (dictionaryItem?.valueType === "culture") return;
    const matchedText = line.slice(match.index ?? 0);
    if (normalizedLabel === "Ca" && /^ca\s*\d/i.test(matchedText)) return;
    if (directionalKeys.has(canonicalLabKey(normalizedLabel))) return;
    const dictionaryGroup = dictionaryItem?.group ?? labGroupFor(normalizedLabel);
    const group = groupHint || dictionaryGroup;
    const label =
      uaContext && (normalizedLabel === "WBC" || normalizedLabel === "RBC")
        ? `UA ${normalizedLabel}`
        : uaContext && normalizedLabel === "Glucose"
          ? "Glucose urine"
        : normalizedLabel;
    const commonUnit = dictionaryItem?.commonUnits[0] ?? "";
    const inlineUnit = unitAfterMatch(line, match.index, match[2]);
    const unit = inlineUnit || (/^Troponin(?:\s+[IT])?$/i.test(label) ? "" : commonUnit);

    items.push({
      label,
      name: label,
      value: match[2],
      previousValue: match[3] ?? match[4] ?? "",
      group: label.startsWith("UA ") || label === "Glucose urine" ? "Urinalysis" : group,
      important,
      isImportant: important,
      unit: unit === "%" && match[2].includes("%") ? "" : unit,
      color: "",
      note: normalizeLabNote(match[5], match[6], match[7]),
    });
  });

  Array.from(line.matchAll(genericPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (directionalKeys.has(canonicalLabKey(label)) || shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    const note = normalizeLabNote(match[5], match[6], match[7]);
    const hasContext = Boolean(groupHint) || /\b(lab|cbc|chem|renal|electrolyte|coag|tumou?r|marker|level|culture|serum|plasma|urine)\b/i.test(line);
    const hasSignal = Boolean(note || match[3] || match[4]);
    if (!hasContext && !hasSignal && /\s/.test(label)) return;
    items.push(parsedLabItem(label, match[2], match[3] ?? match[4] ?? "", important, groupHint || "Other labs", note, unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(qualitativePattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    if (items.some((item) => canonicalLabKey(item.label) === canonicalLabKey(label) && item.value.toLowerCase() === match[2].toLowerCase())) return;
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint, normalizeLabNote(match[2])));
  });

  Array.from(line.matchAll(genericQualitativePattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    if (items.some((item) => canonicalLabKey(item.label) === canonicalLabKey(label))) return;
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint || "Other labs", normalizeLabNote(match[2])));
  });

  // Drop a leftover composite "A/B" item when both parts already exist as their
  // own split-out items (e.g. a stray "Na/K 137" alongside real Na and K).
  return items.filter((item) => {
    if (!item.label.includes("/")) return true;
    const parts = item.label.split("/").map((part) => part.trim());
    if (parts.length < 2 || !parts.every((part) => findLabDictionaryItem(part))) return true;
    const bothSplitOut = parts.every((part) =>
      items.some((other) => other !== item && canonicalLabKey(other.label) === canonicalLabKey(part)),
    );
    return !bothSplitOut;
  });
}

function splitLabLineTitle(line: string) {
  const colonMatch = line.match(/^([^:]{2,32}):\s*(.+)$/);
  if (colonMatch && !findLabDictionaryItem(colonMatch[1])) {
    return { title: colonMatch[1].trim(), body: colonMatch[2].trim() };
  }

  const prefixMatch = line.match(/^(cbc\/dc|cbc|dc|metabolic|renal|electrolytes|liver|lft|coag|coag\.|u\/?a|urine|cardiac|blood gas|abg|vbg)\s+(.+)$/i);
  if (prefixMatch) {
    return { title: prefixMatch[1].replace(/\.$/, "").trim(), body: prefixMatch[2].trim() };
  }

  return { title: "", body: line };
}

function reportId(rawText: string, index: number) {
  return `lab-${index}-${rawText.slice(0, 24).replace(/[^A-Za-z0-9]+/g, "-")}`;
}

export function parseLabText(value: string): ParsedLabItem[] {
  return parseLabReports(value).flatMap((report) => report.items);
}

export function parseLabReports(value: string, date = todayDate(), defaultTitle = ""): LabReport[] {
  const reports: LabReport[] = [];
  const fallbackDate = normalizeDateKey(date);

  value.split(/\r?\n/).forEach((rawLine) => {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) return;

    const important = trimmedLine.startsWith("!");
    const lineWithDate = important ? trimmedLine.slice(1).trim() : trimmedLine;
    const leadingDate = lineWithDate.match(/^\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/)?.[0] ?? "";
    const lineDate = leadingDate ? dateFromClinicalText(leadingDate, fallbackDate) : fallbackDate;
    const line = stripLeadingClinicalDate(lineWithDate);
    const { title, body } = splitLabLineTitle(line);
    const reportTitle = title || defaultTitle;
    const items = parseLabItemsFromLine(body, important, reportTitle);

    reports.push({
      id: reportId(line, reports.length),
      date: lineDate,
      title: reportTitle,
      rawText: rawLine,
      items,
    });
  });

  return reports;
}

export function labSummary(items: ParsedLabItem[], fallbackText = "", maxItems = 8) {
  if (items.length === 0) return plainClinicalText(fallbackText, "-");

  const wbc = items.find((item) => item.label === "WBC");
  const neu = items.find((item) => item.label === "N" || item.label === "Neu");
  const cr = items.find((item) => item.label === "Cr");
  const egfr = items.find((item) => item.label === "eGFR");
  const used = new Set<ParsedLabItem>();
  const result: string[] = [];

  if (wbc) {
    used.add(wbc);
    result.push(`WBC ${Number(wbc.value) >= 1000 ? `${(Number(wbc.value) / 1000).toFixed(1)}k` : wbc.value}`);
  }

  if (neu) {
    used.add(neu);
    result.push(`N${neu.value}%`);
  }

  items.forEach((item) => {
    if (used.has(item) || item.group === "Urinalysis" || item.label === "Cr" || item.label === "eGFR") return;
    const prev = item.previousValue ? `(${item.previousValue})` : "";
    result.push(`${item.group ? `${item.group} ` : ""}${item.label}${item.value}${prev}`);
    used.add(item);
  });

  if (cr || egfr) {
    if (cr) used.add(cr);
    if (egfr) used.add(egfr);
    result.push(`Cr ${cr?.value ?? "-"}/eGFR${egfr?.value ?? "-"}`);
  }

  items
    .filter((item) => item.group === "Urinalysis" && !used.has(item))
    .forEach((item) => {
      const prev = item.previousValue ? `(${item.previousValue})` : "";
      result.push(`${item.label}${item.value}${prev}`);
      used.add(item);
    });

  return result.slice(0, maxItems).join(", ") || "-";
}

export function formatLabItem(item: ParsedLabItem) {
  const label = item.name ?? item.label;
  const value =
    label === "WBC" && Number(item.value) >= 1000 ? `${(Number(item.value) / 1000).toFixed(1)}k` : item.value;
  return { label, value, previous: item.previousValue ? `prev ${item.previousValue}` : "" };
}

interface LabObservation {
  key: string;
  label: string;
  value: string;
  unit: string;
  previousValue: string;
  date: string;
  item: ParsedLabItem;
}

interface LabFocusEntry {
  key: string;
  text: string;
  score: number;
  category: string;
  anchor: boolean;
  critical: boolean;
  trend: boolean;
  severity: LabFocusSeverity;
}

export type LabFocusSeverity = "critical" | "abnormal" | "trend" | "anchor";

export interface LabFocusSignal {
  severity: LabFocusSeverity;
  category: string;
  text: string;
  display: string;
  important: boolean;
}

export interface LabFocusSummary {
  critical: string[];
  trend: string[];
  anchors: string[];
  signals: LabFocusSignal[];
  hiddenCount: number;
  text: string;
}

export interface LabFocusOptions {
  maxCritical?: number;
  maxTrend?: number;
  maxAnchors?: number;
  separator?: string;
}

function numericLabValue(value: string) {
  const normalized = value.replace(/,/g, "").match(/[<>]?\s*(-?\d+(?:\.\d+)?)/)?.[1];
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalLabKey(label: string) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("ntprobnp") || normalized.includes("ntprobnp")) return "NT-proBNP";
  if (normalized === "probnp") return "NT-proBNP";
  if (normalized.includes("bnp")) return "BNP";
  if (normalized.includes("vanco")) return "Vancomycin";
  if (normalized.includes("hba1c") || normalized === "a1c") return "HbA1c";
  if (normalized === "chol" || normalized.includes("cholesterol")) return "Cholesterol";
  if (normalized === "tg" || normalized.includes("triglyceride")) return "TG";
  if (normalized === "ldl" || normalized.includes("ldlc")) return "LDL";
  if (normalized === "wbc") return "WBC";
  if (normalized === "neu" || normalized.includes("neutrophil")) return "Neu";
  if (normalized === "hb" || normalized === "hgb" || normalized.includes("hemoglobin")) return "Hb";
  if (normalized === "plt" || normalized.includes("platelet")) return "Plt";
  if (normalized === "cr" || normalized.includes("creatinine")) return "Cr";
  if (normalized === "egfr") return "eGFR";
  if (normalized === "bun") return "BUN";
  if (normalized === "na" || normalized === "sodium") return "Na";
  if (normalized === "k" || normalized === "potassium") return "K";
  if (normalized === "ca" || normalized === "calcium") return "Ca";
  if (normalized === "mg" || normalized === "magnesium") return "Mg";
  if (normalized === "p" || normalized === "phos" || normalized === "phosphate") return "P";
  if (normalized === "uricacid" || normalized === "uaacid") return "Uric acid";
  if (normalized.includes("lactate")) return "Lactate";
  if (normalized === "crp") return "CRP";
  if (normalized === "pct" || normalized.includes("procalcitonin")) return "PCT";
  if (normalized.includes("ddimer")) return "D-dimer";
  if (normalized === "inr") return "INR";
  if (normalized === "pt") return "PT";
  if (normalized === "aptt" || normalized === "ptt") return "aPTT";
  if (normalized.includes("glucose") || normalized === "ac" || normalized === "pc" || normalized.includes("sugar")) return "Glucose";
  if (normalized === "alt" || normalized === "gpt") return "ALT";
  if (normalized === "ast" || normalized === "got") return "AST";
  if (normalized.includes("albumin") || normalized === "alb") return "Alb";
  if (normalized.includes("bilirubin") || normalized === "bili") return "Bilirubin";
  if (normalized === "ca125") return "CA125";
  if (normalized === "cea") return "CEA";
  if (normalized === "scc") return "SCC";
  if (normalized === "esr") return "ESR";
  if (normalized === "fib" || normalized.includes("fibrinogen")) return "Fibrinogen";
  if (normalized === "ldh") return "LDH";
  if (normalized.includes("troponini") || normalized === "tni" || normalized === "hstni") return "Troponin I";
  if (normalized.includes("troponint") || normalized === "tnt" || normalized === "hstnt") return "Troponin T";
  if (normalized === "troponin" || normalized === "trop") return "Troponin";
  return normalizeLabDisplayName(label);
}

function labDisplayLabel(key: string) {
  if (key === "Cholesterol") return "Chol";
  if (key === "Glucose") return "Glu";
  if (key === "P") return "Phos";
  return key;
}

function labQualitativeLevel(key: string, item: ParsedLabItem) {
  const text = `${item.value} ${item.note ?? ""}`.toLowerCase();
  if (!text.trim()) return 0;
  if (/\b(?:h|high|elevated|l|low|decreased|positive|pos|reactive|detected|growth|trend)\b|[↑↓↗↘]/i.test(text)) return 1;
  if (/\bpending\b/i.test(text) && /culture|cx|bcx|ucx|scx/i.test(key)) return 1;
  return 0;
}

function labFocusSuffix(item: ParsedLabItem) {
  const note = String(item.note ?? "").trim();
  if (!note || note === "trend") return "";
  if (note.toLowerCase() === String(item.value ?? "").trim().toLowerCase()) return "";
  if (note === "H") return "↑";
  if (note === "L") return "↓";
  if (/^(positive|detected|reactive|growth)/i.test(note)) return "+";
  return ` ${note}`;
}

function labFocusUnitText(key: string, item: ParsedLabItem) {
  const unit = String(item.unit ?? "").trim();
  if (!unit) return "";
  if (/^(?:Troponin|Troponin I|Troponin T|Vancomycin|BNP|NT-proBNP|PCT)$/i.test(key)) return ` ${unit}`;
  return "";
}

function labClinicalNumericValue(key: string, value: number | null) {
  if (value === null) return null;
  if ((key === "WBC" || key === "Plt") && value > 1000) return value / 1000;
  return value;
}

function labDirection(key: string, value: number, previous: number | null) {
  if (previous === null || value === previous) return "";
  const arrow = value > previous ? "\u2191" : "\u2193";
  return `${arrow}(${formatLabFocusValue(key, previous)})`;
}

function formatNumeric(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatLabFocusValue(key: string, value: number) {
  if (key === "WBC" && value >= 1000) return `${formatNumeric(value / 1000)}k`;
  if (key === "Plt" && value >= 1000) return `${formatNumeric(value / 1000)}k`;
  if ((key === "WBC" || key === "Plt") && value < 1000) return formatNumeric(value);
  return formatNumeric(value);
}

function labAbnormalLevel(key: string, value: number | null) {
  if (value === null) return 0;

  switch (key) {
    case "Hb":
      return value < 8 || value > 18 ? 2 : value < 10 || value > 17 ? 1 : 0;
    case "WBC":
      return value > 20 || value < 2 ? 2 : value > 12 || value < 4 ? 1 : 0;
    case "Neu":
      return value > 80 || value < 40 ? 1 : 0;
    case "Plt":
      return value < 50 ? 2 : value < 100 || value > 450 ? 1 : 0;
    case "Cr":
      return value >= 2 ? 2 : value > 1.3 ? 1 : 0;
    case "BUN":
      return value >= 50 ? 2 : value > 25 ? 1 : 0;
    case "eGFR":
      return value < 30 ? 2 : value < 60 ? 1 : 0;
    case "Na":
      return value < 130 || value > 150 ? 2 : value < 135 || value > 145 ? 1 : 0;
    case "K":
      return value < 3 || value > 5.5 ? 2 : value < 3.5 || value > 5 ? 1 : 0;
    case "Ca":
      return value < 7 || value > 12 ? 2 : value < 8.5 || value > 10.5 ? 1 : 0;
    case "Mg":
      return value < 1.2 || value > 3 ? 2 : value < 1.6 || value > 2.6 ? 1 : 0;
    case "P":
      return value < 2 || value > 6 ? 2 : value < 2.5 || value > 4.5 ? 1 : 0;
    case "Uric acid":
      return value >= 10 ? 2 : value >= 7 ? 1 : 0;
    case "Glucose":
      return value < 70 || value >= 300 ? 2 : value >= 180 ? 1 : 0;
    case "HbA1c":
      return value >= 7 ? 1 : 0;
    case "LDL":
      return value >= 100 ? 1 : 0;
    case "TG":
      return value >= 200 ? 1 : 0;
    case "BNP":
      return value >= 100 ? 1 : 0;
    case "NT-proBNP":
      return value >= 300 ? 1 : 0;
    case "Lactate":
      return value >= 4 ? 2 : value >= 2 ? 1 : 0;
    case "CRP":
      return value > 0.5 ? 1 : 0;
    case "PCT":
      return value >= 2 ? 2 : value >= 0.5 ? 1 : 0;
    case "D-dimer":
      return value > 500 ? 1 : 0;
    case "ESR":
      return value > 30 ? 1 : 0;
    case "Fibrinogen":
      return value > 450 || value < 180 ? 1 : 0;
    case "INR":
      return value >= 3 ? 2 : value >= 1.5 ? 1 : 0;
    case "PT":
      return value >= 18 ? 2 : value > 14 ? 1 : 0;
    case "aPTT":
      return value >= 60 ? 2 : value > 36 ? 1 : 0;
    case "Alb":
      return value < 3 ? 1 : 0;
    case "AST":
    case "ALT":
      return value >= 200 ? 2 : value >= 80 ? 1 : 0;
    case "LDH":
      return value >= 500 ? 2 : value >= 250 ? 1 : 0;
    case "Troponin":
    case "Troponin I":
    case "Troponin T":
      return 0;
    default:
      return 0;
  }
}

function meaningfulLabDelta(key: string, value: number | null, previous: number | null) {
  if (value === null || previous === null) return false;
  const delta = Math.abs(value - previous);
  const percent = previous === 0 ? 1 : delta / Math.abs(previous);

  switch (key) {
    case "Hb":
      return delta >= 0.8;
    case "WBC":
      return delta >= 2;
    case "Plt":
      return delta >= 50 || percent >= 0.25;
    case "Cr":
      return delta >= 0.3 || percent >= 0.25;
    case "BUN":
      return delta >= 10 || percent >= 0.3;
    case "eGFR":
      return delta >= 10 || percent >= 0.25;
    case "Na":
      return delta >= 3;
    case "K":
      return delta >= 0.4;
    case "Ca":
    case "Mg":
    case "P":
      return delta >= 0.5 || percent >= 0.2;
    case "Uric acid":
      return delta >= 1 || percent >= 0.25;
    case "Glucose":
      return delta >= 50;
    case "Lactate":
      return delta >= 1;
    case "CRP":
    case "PCT":
      return delta >= 1 || percent >= 0.3;
    case "BNP":
    case "NT-proBNP":
      return percent >= 0.3;
    case "Troponin":
    case "Troponin I":
    case "Troponin T":
      return percent >= 0.2;
    case "LDH":
      return delta >= 100 || percent >= 0.25;
    default:
      return percent >= 0.35;
  }
}

function patientLabContext(patient: Patient) {
  return [
    patient.primaryDiagnosis,
    patient.oneLiner,
    patient.activeProblems,
    ...patient.activeProblemItems,
    ...patient.activeProblemStructuredItems.map((item) => `${item.title} ${item.note}`),
    patient.underlyingDiseases,
    ...patient.underlyingDiseaseItems,
    patient.hospitalCourseHighlights,
    patient.earlyHospitalCourse,
    patient.rawLabText,
    patient.newLabs,
    patient.importantRedFlags,
    patient.dischargePlan,
    ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary} ${item.evidenceOrCourseItems.join(" ")} ${item.planItems.join(" ")}`),
  ]
    .join(" ")
    .toLowerCase();
}

// Chronic dialysis context: chronically elevated BUN/Cr is that patient's
// baseline, not a new critical event, so renal values are capped at
// "abnormal" instead of screaming critical/red on every list.
// "\bhd\b(?!\s*#?\s*\d)" avoids hospital-day notation like "HD#3".
export function hasChronicRenalContext(patient?: Patient | null) {
  if (!patient) return false;
  const context = patientLabContext(patient);
  return /\besrd\b|end[-\s]stage renal|dialysis|\bcrrt\b|洗腎|\bhd\b(?!\s*#?\s*\d)/i.test(context);
}

const chronicRenalCappedKeys = new Set(["cr", "bun", "egfr"].map((key) => canonicalLabKey(key)));

function contextAdjustedLabLevel(key: string, level: number, patient?: Patient | null) {
  if (level >= 2 && chronicRenalCappedKeys.has(canonicalLabKey(key)) && hasChronicRenalContext(patient)) return 1;
  return level;
}

function hasSpecificTlsLabContext(context: string) {
  const clean = context
    .replace(/\btrend\s+tls\s+labs?\b/gi, " ")
    .replace(/\btls\s*\/\s*onc safety\b/gi, " ")
    .replace(/\bheme\/onc safety\b/gi, " ");
  const explicitTls = /\b(?:tumou?r lysis|tls concern|tls risk|rasburicase|allopurinol)\b/i.test(clean);
  const tlsSpecificLab = /\b(?:uric acid|phos|phosphate|ldh)\b(?:\s*[:=]?\s*[<>]?\d|\s+(?:high|low|elevated|up|down))/i.test(clean);
  return tlsSpecificLab || (explicitTls && /\b(?:uric acid|phos|phosphate|ldh|rasburicase|allopurinol)\b/i.test(clean));
}

function labFocusCategory(key: string, patient: Patient) {
  const context = patientLabContext(patient);
  const hasInfection = /\b(infection|bacteremia|sepsis|septic|fever|febrile|culture|b\/c|bcx|pna|pneumonia|uti|abscess|lactate|abx|antibiotic)\b/.test(context);
  const hasRenalOrElectrolyte = /\b(aki|ckd|renal|dialysis|crrt|oliguria|hyperk|hypok|electrolyte|dehydrat)\b/.test(context);
  const hasAnemiaOrBleeding = /\b(anemia|bleed|bleeding|melena|hematemesis|hematochezia|hematuria|transfusion|anticoag|antiplatelet|thrombocytopenia)\b/.test(context);
  const hasCancerOrNutrition = /\b(cancer|tumou?r|malign|carcinoma|scc|chemo|onc|j-?tube|jejunostomy|nutrition|malnutrition|poor intake|dysphag|tube feeding)\b/.test(context);
  const hasTls = hasSpecificTlsLabContext(context);
  const hasCardiac = /\b(hf|heart failure|acs|mi|troponin|arrhythm|af\b|pulmonary edema)\b/.test(context);

  if (hasInfection && ["WBC", "Neu", "Lactate", "CRP", "PCT", "Blood culture", "Sputum culture", "Urine culture"].includes(key)) {
    return "Infx";
  }
  if (hasAnemiaOrBleeding && ["Hb", "Plt", "PT", "INR", "aPTT", "Fibrinogen"].includes(key)) return "Anemia";
  if ((hasRenalOrElectrolyte || hasTls) && ["BUN", "Cr", "eGFR", "Na", "K", "Ca", "Mg", "P", "Uric acid", "LDH"].includes(key)) {
    return hasTls && ["K", "Ca", "P", "Uric acid", "Cr", "LDH"].includes(key) ? "TLS" : "Lyte/Renal";
  }
  if (["Na", "K", "Ca", "Mg", "P"].includes(key)) return "Lyte/Renal";
  if (hasCardiac && ["Troponin", "Troponin I", "Troponin T", "BNP", "NT-proBNP", "Cr", "K"].includes(key)) return "Cardiac";
  if (hasCancerOrNutrition && ["Alb", "Hb", "Ca", "Mg", "P", "Uric acid", "LDH", "CA125", "CEA", "SCC", "CA19-9"].includes(key)) {
    return hasTls && ["K", "Ca", "P", "Uric acid", "Cr", "LDH"].includes(key) ? "TLS" : "Onc/nutrition";
  }
  return "";
}

function isDiseaseAnchorLab(key: string, patient: Patient) {
  const context = [
    patient.primaryDiagnosis,
    patient.activeProblems,
    ...patient.activeProblemItems,
    ...patient.activeProblemStructuredItems.map((item) => `${item.title} ${item.note}`),
    patient.underlyingDiseases,
    ...patient.underlyingDiseaseItems,
    ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary}`),
  ]
    .join(" ")
    .toLowerCase();

  const hasStroke = /stroke|cva|tia|ischemic|infarct|nihss|carotid|mca|aca|pca|pons|basal ganglia/.test(context);
  const hasHf = /heart failure|\bhf\b|chf|lvhf|nyha|pulmonary edema|hfr?ef|reduced ef/.test(context);
  const hasDm = /\bdm\b|diabetes|hypergly/.test(context);
  const hasRenal = /\backi\b|\bckd\b|renal|esrd|dialysis/.test(context);
  const hasBleeding = /bleed|bleeding|anemia|melena|hematemesis|hematuria|vaginal|postmenopausal|ob gyn|obgyn/.test(context);
  const hasLiver = /cirrhosis|hepatitis|liver|jaundice/.test(context);
  const hasCancerOrGyn = /cancer|tumor|malign|carcinoma|ca\?|ca |gyn|ob|ovary|ovarian|cervical|uterine|postmenopausal/.test(context);
  const hasInfection = /infection|bacteremia|sepsis|septic|fever|culture|b\/c|bcx|pneumonia|pna|uti|abx|antibiotic/.test(context);
  const hasNutrition = /j-?tube|jejunostomy|nutrition|malnutrition|poor intake|dysphag|tube feeding/.test(context);
  const hasTls = hasSpecificTlsLabContext(context);

  if (hasStroke && ["HbA1c", "LDL", "TG", "Cholesterol"].includes(key)) return true;
  if (hasHf && ["BNP", "NT-proBNP", "Cr", "eGFR", "Na", "K"].includes(key)) return true;
  if (hasDm && ["HbA1c", "Glucose", "Cr", "eGFR"].includes(key)) return true;
  if (hasInfection && ["WBC", "Neu", "Lactate", "CRP", "PCT", "Blood culture", "Sputum culture", "Urine culture"].includes(key)) return true;
  if (hasRenal && ["BUN", "Cr", "eGFR", "K", "Na", "Ca", "Mg", "P"].includes(key)) return true;
  if (hasBleeding && ["Hb", "Plt", "PT", "INR", "aPTT"].includes(key)) return true;
  if (hasLiver && ["AST", "ALT", "Bilirubin", "Alb", "INR"].includes(key)) return true;
  if (hasCancerOrGyn && ["CA125", "CEA", "SCC", "CA19-9", "Hb", "Alb", "Ca", "Mg", "P", "LDH"].includes(key)) return true;
  if (hasNutrition && ["Alb", "Mg", "P", "Ca", "Hb"].includes(key)) return true;
  if (hasTls && ["K", "P", "Ca", "Uric acid", "Cr", "LDH"].includes(key)) return true;
  return false;
}

function shouldShowAnchorLab(key: string, abnormalLevel: number) {
  const persistentAnchorKeys = new Set([
    "HbA1c",
    "LDL",
    "TG",
    "Cholesterol",
    "BNP",
    "NT-proBNP",
    "Blood culture",
    "Sputum culture",
    "Urine culture",
    "CA125",
    "CEA",
    "SCC",
    "CA19-9",
  ]);
  return abnormalLevel >= 1 || persistentAnchorKeys.has(key);
}

function severityLabel(severity: LabFocusSeverity) {
  if (severity === "critical") return "Crit";
  if (severity === "abnormal") return "Abn";
  if (severity === "trend") return "Trend";
  return "Anchor";
}

function entrySeverity(level: number, hasDelta: boolean, anchor: boolean): LabFocusSeverity {
  if (level >= 2) return "critical";
  if (level >= 1) return "abnormal";
  if (hasDelta) return "trend";
  return anchor ? "anchor" : "trend";
}

export type LabInterpretationSeverity = LabFocusSeverity | "normal";

export interface LabInterpretation {
  severity: LabInterpretationSeverity;
  category: string;
  label: string;
  value: string;
  previous: string;
  badge: string;
  important: boolean;
}

function defaultLabFocusCategory(key: string) {
  if (["WBC", "Neu", "Lactate", "CRP", "PCT", "Blood culture", "Sputum culture", "Urine culture"].includes(key)) return "Infx";
  if (["Hb", "Plt", "PT", "INR", "aPTT", "Fibrinogen"].includes(key)) return "Anemia";
  if (["BUN", "Cr", "eGFR", "Na", "K", "Ca", "Mg", "P", "Uric acid", "LDH"].includes(key)) return "Lyte/Renal";
  if (["Troponin", "Troponin I", "Troponin T", "BNP", "NT-proBNP"].includes(key)) return "Cardiac";
  if (["Alb", "CA125", "CEA", "SCC", "CA19-9"].includes(key)) return "Onc/nutrition";
  return "";
}

export function interpretLabItem(item: ParsedLabItem, patient?: Patient): LabInterpretation {
  const key = canonicalLabKey(item.name || item.label);
  const rawValue = numericLabValue(item.value);
  const rawPrevious = numericLabValue(item.previousValue ?? "");
  const value = labClinicalNumericValue(key, rawValue);
  const previous = labClinicalNumericValue(key, rawPrevious);
  const qualitativeLevel = labQualitativeLevel(key, item);
  const level = contextAdjustedLabLevel(key, Math.max(labAbnormalLevel(key, value), qualitativeLevel), patient);
  const hasDelta = meaningfulLabDelta(key, value, previous);
  const anchor = patient ? isDiseaseAnchorLab(key, patient) && shouldShowAnchorLab(key, level) : false;
  const severity: LabInterpretationSeverity = level >= 1 || hasDelta || anchor ? entrySeverity(level, hasDelta, anchor) : "normal";
  const formattedValue = value !== null ? formatLabFocusValue(key, value) : item.value;
  const previousText = item.previousValue ? `prev ${item.previousValue}` : "";

  return {
    severity,
    category: patient ? labFocusCategory(key, patient) : defaultLabFocusCategory(key),
    label: labDisplayLabel(key),
    value: formattedValue,
    previous: previousText,
    badge: severity === "critical" ? "Crit" : severity === "abnormal" ? "Abn" : severity === "trend" ? "Trend" : severity === "anchor" ? "Anchor" : "",
    important: severity === "critical" || severity === "abnormal" || Boolean(item.important || item.isImportant),
  };
}

function groupLabFocusSignals(entries: LabFocusEntry[]): LabFocusSignal[] {
  const categoryOrder = ["Infx", "Anemia", "Lyte/Renal", "TLS", "Cardiac", "Onc/nutrition", ""];
  const severityOrder: LabFocusSeverity[] = ["critical", "abnormal", "trend", "anchor"];
  const groups = new Map<string, LabFocusEntry[]>();
  entries.forEach((entry) => {
    const key = `${entry.severity}|${entry.category}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [aSeverity, aCategory] = a.split("|") as [LabFocusSeverity, string];
      const [bSeverity, bCategory] = b.split("|") as [LabFocusSeverity, string];
      const severityDiff = severityOrder.indexOf(aSeverity) - severityOrder.indexOf(bSeverity);
      if (severityDiff !== 0) return severityDiff;
      return categoryOrder.indexOf(aCategory) - categoryOrder.indexOf(bCategory);
    })
    .map(([key, group]) => {
      const [severity, category] = key.split("|") as [LabFocusSeverity, string];
      const text = group.map((entry) => entry.text).join(", ");
      const prefix = [severityLabel(severity), category].filter(Boolean).join(" ");
      return {
        severity,
        category,
        text,
        display: prefix ? `${prefix}: ${text}` : `${severityLabel(severity)}: ${text}`,
        important: severity === "critical",
      };
    });
}

function collectLabObservations(patient: Patient, notes: DailyNote[] = []) {
  const observations: LabObservation[] = [];

  function addItems(items: ParsedLabItem[], date: string) {
    items.forEach((item) => {
      const label = item.name || item.label;
      if (!label || !String(item.value ?? "").trim()) return;
      observations.push({
        key: canonicalLabKey(label),
        label,
        value: String(item.value ?? ""),
        unit: String(item.unit ?? ""),
        previousValue: String(item.previousValue ?? ""),
        date: normalizeDateKey(date || todayKey()),
        item,
      });
    });
  }

  function addReports(reports: LabReport[], fallbackDate: string) {
    reports.forEach((report) => addItems(report.items, report.date || fallbackDate));
  }

  function addRawText(value: string, date: string) {
    const parsed = parseLabText(value);
    if (parsed.length > 0) addItems(parsed, date);
  }

  addReports(patient.labReports, patient.labDate || todayKey());
  if (patient.labReports.length === 0) addItems(patient.parsedLabItems, patient.labDate || todayKey());
  if (patient.labReports.length === 0 && patient.parsedLabItems.length === 0) {
    addRawText([patient.rawLabText, patient.newLabs].filter(Boolean).join("\n"), patient.labDate || todayKey());
  }
  notes.forEach((note) => {
    addReports(note.labReports, note.labDate || note.date);
    if (note.labReports.length === 0) addItems(note.parsedLabItems, note.labDate || note.date);
    if (note.labReports.length === 0 && note.parsedLabItems.length === 0) {
      addRawText([note.rawLabText, note.labSummary].filter(Boolean).join("\n"), note.labDate || note.date);
    }
  });

  const seen = new Set<string>();
  return observations
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((observation) => {
      const key = [observation.date, observation.key, observation.value, observation.previousValue].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getLabFocusSummary(
  patient: Patient,
  notes: DailyNote[] = [],
  options: LabFocusOptions = {},
): LabFocusSummary {
  const maxCritical = options.maxCritical ?? 2;
  const maxTrend = options.maxTrend ?? 3;
  const maxAnchors = options.maxAnchors ?? 2;
  const separator = options.separator ?? "\n";
  const observations = collectLabObservations(patient, notes);
  const byKey = new Map<string, LabObservation[]>();

  observations.forEach((observation) => {
    const group = byKey.get(observation.key) ?? [];
    group.push(observation);
    byKey.set(observation.key, group);
  });

  const entries: LabFocusEntry[] = [];

  byKey.forEach((group, key) => {
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const latest = ordered[ordered.length - 1];
    const previousObservation = [...ordered].reverse().find((item) => item.date < latest.date && item.value !== latest.value);
    const rawValue = numericLabValue(latest.value);
    const rawPrevious = numericLabValue(latest.previousValue) ?? numericLabValue(previousObservation?.value ?? "");
    const value = labClinicalNumericValue(key, rawValue);
    const previous = labClinicalNumericValue(key, rawPrevious);
    const qualitativeLevel = labQualitativeLevel(key, latest.item);
    const level = contextAdjustedLabLevel(key, Math.max(labAbnormalLevel(key, value), qualitativeLevel), patient);
    const hasDelta = meaningfulLabDelta(key, value, previous);
    const anchor = isDiseaseAnchorLab(key, patient) && shouldShowAnchorLab(key, level);
    const direction = value !== null ? labDirection(key, value, previous) : latest.previousValue ? `(${latest.previousValue})` : "";
    const formattedValue = value !== null ? formatLabFocusValue(key, value) : latest.value;
    const text = `${labDisplayLabel(key)} ${formattedValue}${labFocusUnitText(key, latest.item)}${direction}${labFocusSuffix(latest.item)}`;
    const category = labFocusCategory(key, patient);
    const critical = level >= 2;
    const trend = hasDelta || qualitativeLevel >= 1 || level >= 1;
    const severity = entrySeverity(level, hasDelta, anchor);
    const score =
      level * 100 +
      Number(hasDelta) * 35 +
      Number(anchor) * 25 +
      Number(Boolean(category)) * 45 +
      Number(latest.item.important || latest.item.isImportant) * 40;

    if (critical || trend || anchor) {
      entries.push({ key, text, score, category, anchor, critical, trend, severity });
    }
  });

  const used = new Set<string>();
  const critical = entries
    .filter((entry) => entry.critical)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCritical);
  critical.forEach((entry) => used.add(entry.key));

  const trend = entries
    .filter((entry) => entry.trend && !used.has(entry.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTrend);
  trend.forEach((entry) => used.add(entry.key));

  const anchors = entries
    .filter((entry) => entry.anchor && entry.severity === "anchor" && !used.has(entry.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAnchors);
  anchors.forEach((entry) => used.add(entry.key));

  const hiddenCount = Math.max(entries.length - used.size, 0);
  const criticalSignals = groupLabFocusSignals(critical);
  const trendSignals = groupLabFocusSignals(trend);
  const anchorSignals = groupLabFocusSignals(anchors);
  const signals = [...criticalSignals, ...trendSignals, ...anchorSignals];
  const text = [
    signals.map((signal) => `${signal.important ? "!" : ""}${signal.display}`).join(separator),
    hiddenCount > 0 ? `+${hiddenCount} labs` : "",
  ].filter(Boolean).join(separator);

  return {
    critical: criticalSignals.map((signal) => signal.display),
    trend: trendSignals.map((signal) => signal.display),
    anchors: anchorSignals.map((signal) => signal.display),
    signals,
    hiddenCount,
    text,
  };
}

export function keyLabItems(items: ParsedLabItem[], maxItems = 8) {
  const priority = [
    "WBC",
    "Neu",
    "Hb",
    "Plt",
    "Na",
    "K",
    "Cr",
    "eGFR",
    "Osm",
    "HbA1c",
    "AST",
    "ALT",
    "PT",
    "aPTT",
    "D-dimer",
    "CRP",
    "PCT",
    "Lactate",
    "UA WBC",
    "UA RBC",
    "LE",
  ];
  return [...items]
    .sort((a, b) => {
      const importantOrder = Number(!(a.important || a.isImportant)) - Number(!(b.important || b.isImportant));
      if (importantOrder !== 0) return importantOrder;
      const aIndex = priority.includes(a.label) ? priority.indexOf(a.label) : 99;
      const bIndex = priority.includes(b.label) ? priority.indexOf(b.label) : 99;
      return aIndex - bIndex;
    })
    .slice(0, maxItems);
}

