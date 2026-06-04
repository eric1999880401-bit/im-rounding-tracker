import type { DailyNote, ParsedLabItem, Patient } from "./types";
import { findLabDictionaryItem } from "./data/labDictionary";
import { labReferenceForLabel } from "./labReference";
import { parseLabReports, safeClinicalLine, stripColorMarkup } from "./utils";

export type LabVisualGroupId =
  | "cbc"
  | "renalLyte"
  | "liverCoag"
  | "infxPerfusion"
  | "gas"
  | "cardiac"
  | "other";

export type LabVisualTone = "critical" | "important" | "plain";

export interface LabVisualItem {
  key: string;
  label: string;
  value: string;
  previousValue: string;
  text: string;
  tone: LabVisualTone;
  score: number;
}

export interface LabVisualGroup {
  id: LabVisualGroupId;
  label: string;
  tone: LabVisualTone;
  items: LabVisualItem[];
  text: string;
}

export interface LabVisualSummary {
  groups: LabVisualGroup[];
  lines: string[];
  text: string;
}

export interface LabVisualSummaryOptions {
  patient?: Patient;
  maxGroups?: number;
  maxItemsPerGroup?: number;
  maxCharsPerGroup?: number;
  includePlain?: boolean;
  includeLabPrefix?: boolean;
}

interface LabSourceLine {
  raw: string;
  body: string;
  important: boolean;
  items: ParsedLabItem[];
}

const labGroupOrder: Array<{ id: LabVisualGroupId; label: string; keys: string[] }> = [
  { id: "cbc", label: "CBC", keys: ["WBC", "Neu", "Hb", "Hct", "Plt", "RBC", "MCV", "RDW", "Lym", "Mono", "Eos", "Baso", "Band"] },
  { id: "renalLyte", label: "Renal/Lyte", keys: ["Cr", "BUN", "eGFR", "Na", "K", "Cl", "Ca", "Mg", "P", "Uric acid", "Osm"] },
  { id: "liverCoag", label: "Liver/Coag", keys: ["AST", "ALT", "ALP", "GGT", "T-Bil", "D-Bil", "Alb", "PT", "INR", "aPTT", "D-dimer", "Fibrinogen", "FDP"] },
  { id: "infxPerfusion", label: "Infx/Perfusion", keys: ["CRP", "PCT", "Lactate", "ESR", "Blood culture", "Sputum culture", "Urine culture"] },
  { id: "gas", label: "ABG/VBG", keys: ["pH", "pCO2", "pO2", "HCO3", "BE", "SaO2", "SpO2"] },
  { id: "cardiac", label: "Cardiac", keys: ["Troponin I", "Troponin T", "Troponin", "CK", "CK-MB", "BNP", "NT-proBNP"] },
  { id: "other", label: "Other", keys: [] },
];

const groupOrderIndex = new Map(labGroupOrder.map((group, index) => [group.id, index]));
const displayOrder = new Map(labGroupOrder.flatMap((group) => group.keys.map((key, index) => [`${group.id}|${key}`, index])));

function splitInputLines(value: string | string[]) {
  return (Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/))
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
}

function stripReferenceText(value: string) {
  return String(value ?? "")
    .replace(
      /\s*\(?\bref(?:erence)?(?:\s*range)?\s*[:=]?\s*[<>]?\d+(?:\.\d+)?(?:\s*[-–]\s*[<>]?\d+(?:\.\d+)?)?(?:\s*[A-Za-z/%^0-9]+)?\s*\)?/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function splitImportantPrefix(value: string) {
  const clean = String(value ?? "").trim();
  const match = clean.match(/^(!{1,2})\s*(.+)$/);
  if (!match) return { body: clean, important: false };
  return { body: match[2].trim(), important: true };
}

function stripLabLinePrefix(value: string) {
  const match = value.match(/^(?:Lab|Labs?)\s*[:：]\s*(.*)$/i);
  return {
    body: match ? match[1].trim() : value.trim(),
    hasLabPrefix: Boolean(match),
  };
}

function hasNonLabObjectivePrefix(value: string) {
  return /^(?:V\/S|VS|Vitals?|PE|Physical exam|Image|Img|Task|Tasks?|DC|Discharge|Order|Orders?)\s*[:：]/i.test(value.trim());
}

function dictionaryItemFor(label: string) {
  return findLabDictionaryItem(label);
}

function trustedLabItem(item: ParsedLabItem) {
  return Boolean(dictionaryItemFor(item.name || item.label));
}

function labSourceLineFrom(raw: string, requireLabSignal: boolean): LabSourceLine | null {
  const source = String(raw ?? "").trim();
  if (!source) return null;

  const { body: withoutImportantPrefix, important } = splitImportantPrefix(source);
  const { body, hasLabPrefix } = stripLabLinePrefix(withoutImportantPrefix);
  if (!body || (!hasLabPrefix && hasNonLabObjectivePrefix(withoutImportantPrefix))) return null;

  const items = parseLabReports(`${important ? "! " : ""}${body}`).flatMap((report) => report.items);
  if (requireLabSignal && !hasLabPrefix && !items.some(trustedLabItem)) return null;

  return { raw: source, body, important, items };
}

function normalizeNumber(value: string) {
  const match = String(value ?? "").replace(/,/g, "").match(/[<>]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function comparisonNumber(label: string, value: string) {
  const numeric = normalizeNumber(value);
  if (numeric === null) return null;
  if (label === "WBC" && numeric >= 1000) return numeric / 1000;
  if (label === "Plt" && numeric >= 10000) return numeric / 1000;
  return numeric;
}

function trimNumeric(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/g, "").replace(/\.$/, "");
}

function displayLabValue(label: string, value: string) {
  const clean = stripReferenceText(value);
  const numeric = normalizeNumber(clean);
  if (numeric === null) return clean;
  if (label === "WBC" && numeric >= 1000) return `${trimNumeric(numeric / 1000)}k`;
  if (label === "Plt" && numeric >= 10000) return `${trimNumeric(numeric / 1000)}k`;
  return clean;
}

function labelForItem(item: ParsedLabItem) {
  return dictionaryItemFor(item.name || item.label)?.displayName ?? item.name ?? item.label;
}

function noteDirection(item: ParsedLabItem) {
  const note = String(item.note ?? "").toLowerCase();
  if (note === "h" || note.includes("high") || note.includes("elevated")) return "↑";
  if (note === "l" || note.includes("low") || note.includes("decreased")) return "↓";
  return "";
}

function referenceDirection(label: string, value: string) {
  const numeric = comparisonNumber(label, value);
  const reference = labReferenceForLabel(label)?.ref;
  if (numeric === null || !reference) return "";

  const range = reference.match(/^\s*([0-9.]+)\s*-\s*([0-9.]+)\s*$/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (Number.isFinite(low) && numeric < low) return "↓";
    if (Number.isFinite(high) && numeric > high) return "↑";
  }

  const lessThan = reference.match(/^\s*<\s*([0-9.]+)\s*$/);
  if (lessThan) {
    const high = Number(lessThan[1]);
    if (Number.isFinite(high) && numeric > high) return "↑";
  }

  const greaterThan = reference.match(/^\s*>\s*([0-9.]+)\s*$/);
  if (greaterThan) {
    const low = Number(greaterThan[1]);
    if (Number.isFinite(low) && numeric < low) return "↓";
  }

  return "";
}

function trendDirection(label: string, value: string, previousValue: string) {
  const current = comparisonNumber(label, value);
  const previous = comparisonNumber(label, previousValue);
  if (current === null || previous === null || current === previous) return "";
  return current > previous ? "↑" : "↓";
}

function groupIdForItem(item: ParsedLabItem): LabVisualGroupId {
  const dictionaryGroup = dictionaryItemFor(item.name || item.label)?.group ?? "";
  if (dictionaryGroup === "CBC / DC") return "cbc";
  if (dictionaryGroup === "Renal / Electrolytes") return "renalLyte";
  if (dictionaryGroup === "Liver / GI" || dictionaryGroup === "Coagulation") return "liverCoag";
  if (dictionaryGroup === "Inflammation / Infection") return "infxPerfusion";
  if (dictionaryGroup === "ABG / VBG") return "gas";
  if (dictionaryGroup === "Cardiac") return "cardiac";
  return "other";
}

function toneForText(label: string, value: string, item: ParsedLabItem): LabVisualTone {
  const previousValue = String(item.previousValue ?? "").trim();
  const numeric = comparisonNumber(label, value);
  if (numeric !== null) {
    if (label === "K" && (numeric < 3 || numeric > 5.5)) return "critical";
    if (label === "Na" && (numeric < 130 || numeric > 150)) return "critical";
    if (label === "Hb" && numeric < 8) return "critical";
    if (label === "Plt" && numeric < 50) return "critical";
    if (label === "WBC" && (numeric < 2 || numeric > 20)) return "critical";
    if (label === "Cr" && numeric >= 2) return "critical";
    if ((label === "AST" || label === "ALT") && numeric >= 200) return "critical";
    if (label === "INR" && numeric >= 3) return "critical";
    if (label === "Lactate" && numeric >= 4) return "critical";
  }
  if (item.important || item.isImportant) return "important";
  if (previousValue && trendDirection(label, value, previousValue)) return "important";
  if (noteDirection(item) || referenceDirection(label, value)) return "important";
  return "plain";
}

function scoreForItem(groupId: LabVisualGroupId, label: string, tone: LabVisualTone, sourceIndex: number) {
  const toneScore = tone === "critical" ? 300 : tone === "important" ? 200 : 0;
  const groupScore = Math.max(0, 80 - (groupOrderIndex.get(groupId) ?? 99) * 8);
  const labelScore = Math.max(0, 40 - (displayOrder.get(`${groupId}|${label}`) ?? 40));
  return toneScore + groupScore + labelScore - sourceIndex / 1000;
}

function visualItemFromParsed(item: ParsedLabItem, sourceIndex = 0): LabVisualItem | null {
  if (!trustedLabItem(item)) return null;
  const label = labelForItem(item);
  const value = String(item.value ?? "").trim();
  if (!label || !value) return null;

  const previousValue = String(item.previousValue ?? "").trim();
  const direction = previousValue ? trendDirection(label, value, previousValue) : noteDirection(item) || referenceDirection(label, value);
  const previous = previousValue ? `(${displayLabValue(label, previousValue)})` : "";
  const text = `${label} ${displayLabValue(label, value)}${direction}${previous}`;
  const groupId = groupIdForItem(item);
  const tone = toneForText(label, value, item);

  return {
    key: label.toLowerCase(),
    label,
    value,
    previousValue,
    text,
    tone,
    score: scoreForItem(groupId, label, tone, sourceIndex),
  };
}

function cleanOtherText(source: LabSourceLine) {
  return stripReferenceText(stripColorMarkup(source.body))
    .replace(/^!+\s*/, "")
    .replace(/^(?:Crit|Critical|Abn|Abnormal|Trend|Anchor|Ref)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeVisualItems(items: LabVisualItem[]) {
  const byKey = new Map<string, LabVisualItem>();
  items.forEach((item) => {
    const existing = byKey.get(item.key);
    if (!existing || item.score >= existing.score) byKey.set(item.key, item);
  });
  return [...byKey.values()];
}

function buildGroupsFromVisualItems(items: LabVisualItem[], options: LabVisualSummaryOptions) {
  const maxItems = options.maxItemsPerGroup ?? Number.POSITIVE_INFINITY;
  const maxGroups = options.maxGroups ?? Number.POSITIVE_INFINITY;
  const groups = new Map<LabVisualGroupId, LabVisualItem[]>();

  items.forEach((item) => {
    const parsedLikeItem = { label: item.label, name: item.label, value: item.value } satisfies ParsedLabItem;
    const groupId = groupIdForItem(parsedLikeItem);
    groups.set(groupId, [...(groups.get(groupId) ?? []), item]);
  });

  return labGroupOrder
    .map((group) => {
      const sourceItems = dedupeVisualItems(groups.get(group.id) ?? [])
        .sort((left, right) => {
          const leftOrder = displayOrder.get(`${group.id}|${left.label}`) ?? 99;
          const rightOrder = displayOrder.get(`${group.id}|${right.label}`) ?? 99;
          return leftOrder - rightOrder || right.score - left.score || left.label.localeCompare(right.label);
        })
        .slice(0, maxItems);
      if (sourceItems.length === 0) return null;
      const tone: LabVisualTone = sourceItems.some((item) => item.tone === "critical")
        ? "critical"
        : sourceItems.some((item) => item.tone === "important")
          ? "important"
          : "plain";
      const rawText = `${group.label}: ${sourceItems.map((item) => item.text).join(", ")}`;
      return {
        id: group.id,
        label: group.label,
        tone,
        items: sourceItems,
        text: options.maxCharsPerGroup ? safeClinicalLine(rawText, options.maxCharsPerGroup) : rawText,
      } satisfies LabVisualGroup;
    })
    .filter((group): group is LabVisualGroup => Boolean(group))
    .slice(0, maxGroups);
}

export function buildLabVisualSummaryFromItems(items: ParsedLabItem[], options: LabVisualSummaryOptions = {}) {
  const includePlain = options.includePlain ?? true;
  const visualItems = items
    .map((item, index) => visualItemFromParsed(item, index))
    .filter((item): item is LabVisualItem => Boolean(item))
    .filter((item) => includePlain || item.tone !== "plain");
  return buildGroupsFromVisualItems(visualItems, options);
}

export function buildLabVisualSummaryFromText(value: string, options: LabVisualSummaryOptions = {}) {
  const sourceLines = splitInputLines(value)
    .map((line) => labSourceLineFrom(line, false))
    .filter((line): line is LabSourceLine => Boolean(line));
  const visualItems: LabVisualItem[] = [];

  sourceLines.forEach((source, sourceIndex) => {
    const trustedItems = source.items.filter(trustedLabItem);
    trustedItems.forEach((item) => {
      const visualItem = visualItemFromParsed(item, sourceIndex);
      if (visualItem && ((options.includePlain ?? true) || visualItem.tone !== "plain")) visualItems.push(visualItem);
    });

    if (trustedItems.length === 0 || source.items.some((item) => !trustedLabItem(item))) {
      const text = cleanOtherText(source);
      if (text) {
        visualItems.push({
          key: `other|${sourceIndex}|${text.toLowerCase()}`,
          label: "Other",
          value: text,
          previousValue: "",
          text,
          tone: source.important ? "important" : "plain",
          score: scoreForItem("other", "Other", source.important ? "important" : "plain", sourceIndex),
        });
      }
    }
  });

  return buildGroupsFromVisualItems(visualItems, options);
}

export function buildPatientLabVisualSummary(patient: Patient, notes: DailyNote[] = [], options: LabVisualSummaryOptions = {}) {
  const items: ParsedLabItem[] = [];
  patient.labReports.forEach((report) => items.push(...report.items));
  items.push(...patient.parsedLabItems);
  notes.forEach((note) => {
    note.labReports.forEach((report) => items.push(...report.items));
    items.push(...note.parsedLabItems);
  });

  if (items.length > 0) return buildLabVisualSummaryFromItems(items, { ...options, patient });
  return buildLabVisualSummaryFromText(
    [
      patient.rawLabText,
      patient.newLabs,
      patient.initialLabs,
      ...notes.flatMap((note) => [note.rawLabText, note.labSummary]),
    ]
      .filter(Boolean)
      .join("\n"),
    { ...options, patient },
  );
}

export function formatLabVisualSummaryLines(groups: LabVisualGroup[]) {
  return groups.map((group) => group.text);
}

export function formatLabVisualSummaryLinesFromText(value: string, options: LabVisualSummaryOptions = {}) {
  return formatLabVisualSummaryLines(buildLabVisualSummaryFromText(value, options));
}

export function formatLabVisualSummaryFromLines(value: string | string[], options: LabVisualSummaryOptions = {}): LabVisualSummary {
  const includeLabPrefix = options.includeLabPrefix ?? true;
  const groups = buildLabVisualSummaryFromText(splitInputLines(value).join("\n"), options);
  const lines = groups.map((group) => `${includeLabPrefix ? "Lab: " : ""}${group.text}`);
  return {
    groups,
    lines,
    text: lines.join("\n"),
  };
}

export function formatObjectiveLabVisualSummaryLines(objectiveLines: string | string[], options: LabVisualSummaryOptions = {}) {
  const lines = splitInputLines(objectiveLines);
  const labLineIndexes = new Set<number>();
  const labLines: string[] = [];

  lines.forEach((line, index) => {
    if (labSourceLineFrom(line, true)) {
      labLineIndexes.add(index);
      labLines.push(line);
    }
  });

  if (labLines.length === 0) return lines;
  const summary = formatLabVisualSummaryFromLines(labLines, { ...options, includeLabPrefix: true });
  if (summary.lines.length === 0) return lines;

  let inserted = false;
  return lines.flatMap((line, index) => {
    if (!labLineIndexes.has(index)) return [line];
    if (inserted) return [];
    inserted = true;
    return summary.lines;
  });
}
