import type { DailyNote, ParsedLabItem, Patient } from "./types";
import { findLabDictionaryItem } from "./data/labDictionary";
import { buildCanonicalLabDataset, canonicalLabSelectionKey } from "./labDataset";
import { hasChronicRenalContext } from "./labParsing";
import { labReferenceForLabel } from "./labReference";
import {
  isBodyFluidSpecimen,
  labAnalyteLabelForItem,
  labSpecimenIdentityForItem,
  specimenAwareLabDisplayLabel,
  specimenAwareLabSelectionKey,
} from "./labSpecimen";
import { parseLabReports, safeClinicalLine, safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";

const labColorMarkPattern = /\[\[(red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:([\s\S]*?)\]\]/gi;

export type LabVisualGroupId =
  | "cbc"
  | "renalLyte"
  | "liverCoag"
  | "infxPerfusion"
  | "urinalysis"
  | "gas"
  | "fluid"
  | "cardiac"
  | "other";

export type LabVisualTone = "critical" | "important" | "plain";

export interface LabVisualItem {
  sourceId: string;
  key: string;
  label: string;
  value: string;
  previousValue: string;
  unit: string;
  date: string;
  dateIsExplicit: boolean;
  text: string;
  tone: LabVisualTone;
  score: number;
  sourceIndex: number;
  explicitMark: boolean;
  groupId: LabVisualGroupId;
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
  preferredItemIds?: string[];
  preferredLabels?: string[];
  requiredLabels?: string[];
  selectionMode?: "complete" | "aiFocused";
}

interface LabSourceLine {
  raw: string;
  body: string;
  important: boolean;
  items: ParsedLabItem[];
}

const labGroupOrder: Array<{ id: LabVisualGroupId; label: string; keys: string[] }> = [
  { id: "cbc", label: "CBC/DC", keys: ["WBC", "Neu", "ANC", "Hb", "Hct", "Plt", "RBC", "MCV", "RDW", "Lym", "Mono", "Eos", "Baso", "Band"] },
  { id: "renalLyte", label: "Chem/Renal", keys: ["BUN", "Cr", "eGFR", "Na", "K", "Cl", "Ca", "Mg", "P", "Uric acid", "Osm"] },
  { id: "liverCoag", label: "Liver/Coag", keys: ["AST", "ALT", "ALP", "GGT", "T-Bil", "D-Bil", "Alb", "PT", "INR", "aPTT", "D-dimer", "Fibrinogen", "FDP"] },
  { id: "infxPerfusion", label: "Infx/Perfusion", keys: ["CRP", "hsCRP", "PCT", "Lactate", "ESR", "Blood culture", "Sputum culture", "Urine culture", "Microbiology"] },
  { id: "urinalysis", label: "U/A", keys: ["UA WBC", "UA RBC", "LE", "Nitrite", "Bacteria", "Protein", "Glucose urine", "Ketone", "Specific gravity", "pH urine", "Cast"] },
  { id: "gas", label: "ABG/VBG", keys: ["pH", "pCO2", "pO2", "HCO3", "BE", "SaO2", "SpO2"] },
  { id: "fluid", label: "Fluid studies", keys: [] },
  { id: "cardiac", label: "Cardiac", keys: ["Troponin I", "Troponin T", "Troponin", "CK", "CK-MB", "BNP", "NT-proBNP"] },
  { id: "other", label: "Other", keys: [] },
];

const coreDisplayKeys: Record<LabVisualGroupId, string[]> = {
  cbc: ["WBC", "Neu", "ANC", "Hb", "Plt", "Hct"],
  renalLyte: ["BUN", "Cr", "eGFR", "Na", "K", "Mg", "Ca", "P"],
  liverCoag: ["AST", "ALT", "ALP", "T-Bil", "Alb", "PT", "INR", "aPTT"],
  infxPerfusion: ["CRP", "hsCRP", "PCT", "Lactate", "ESR", "Blood culture", "Sputum culture", "Urine culture", "Microbiology"],
  urinalysis: ["UA WBC", "UA RBC", "LE", "Nitrite", "Bacteria", "Protein"],
  gas: ["pH", "pCO2", "pO2", "HCO3", "BE", "SaO2", "SpO2"],
  fluid: [],
  cardiac: ["Troponin I", "Troponin T", "Troponin", "BNP", "NT-proBNP", "CK-MB"],
  other: [],
};

const defaultGroupItemLimits: Record<LabVisualGroupId, number> = {
  cbc: 7,
  renalLyte: 11,
  liverCoag: 8,
  infxPerfusion: 8,
  urinalysis: 8,
  gas: 7,
  fluid: 12,
  cardiac: 6,
  other: 4,
};

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
  return labSpecimenIdentityForItem(item).explicit || Boolean(dictionaryItemFor(item.name || item.label));
}

function labSourceLineFrom(raw: string, requireLabSignal: boolean): LabSourceLine | null {
  const source = String(raw ?? "").trim();
  if (!source) return null;

  const { body: withoutImportantPrefix, important } = splitImportantPrefix(source);
  const { body, hasLabPrefix } = stripLabLinePrefix(withoutImportantPrefix);
  if (!body || (!hasLabPrefix && hasNonLabObjectivePrefix(withoutImportantPrefix))) return null;

  // Parse values from the unmarked text; clinician [[color:...]] segments are re-added as marked visual items.
  const items = parseLabReports(`${important ? "! " : ""}${stripColorMarkup(body)}`).flatMap((report) => report.items);
  if (requireLabSignal && !hasLabPrefix && !items.some(trustedLabItem)) return null;

  return { raw: source, body, important, items };
}

interface MarkedLabSegment {
  markup: string;
  color: string;
  inner: string;
}

function markedLabSegments(value: string): MarkedLabSegment[] {
  const segments: MarkedLabSegment[] = [];
  const pattern = new RegExp(labColorMarkPattern.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(value ?? "")))) {
    const inner = match[2].trim();
    if (inner) segments.push({ markup: match[0], color: match[1].toLowerCase(), inner });
  }
  return segments;
}

function markedVisualItemsFromText(value: string): LabVisualItem[] {
  const items: LabVisualItem[] = [];
  splitInputLines(value).forEach((line, sourceIndex) => {
    markedLabSegments(line).forEach((segment) => {
      const parsed = parseLabReports(segment.inner).flatMap((report) => report.items).find(trustedLabItem);
      const label = parsed ? labelForItem(parsed) : "Other";
      const value = parsed ? String(parsed.value ?? "").trim() : segment.inner;
      const computedTone = parsed ? toneForText(label, value, parsed) : "plain";
      const tone: LabVisualTone = segment.color === "red" || computedTone === "critical" ? "critical" : "important";
      const groupId = parsed ? groupIdForItem(parsed) : "other";
      items.push({
        sourceId: parsed?.id ?? "",
        key: parsed ? specimenAwareLabSelectionKey(parsed) : `marked|${segment.inner.toLowerCase()}`,
        label,
        value,
        previousValue: parsed ? String(parsed.previousValue ?? "").trim() : "",
        unit: String(parsed?.unit ?? "").trim(),
        date: "",
        dateIsExplicit: false,
        // Keep the clinician's color markup verbatim so renderers show the chosen color.
        text: segment.markup,
        tone,
        score: scoreForItem(groupId, label, tone, sourceIndex) + 500,
        sourceIndex,
        explicitMark: true,
        groupId,
      });
    });
  });
  return items;
}

function normalizeNumber(value: string) {
  const match = String(value ?? "").replace(/,/g, "").match(/[<>]?\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
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

function displayLabValueWithUnit(label: string, value: string, unit: string) {
  const display = displayLabValue(label, value);
  const normalizedUnit = String(unit ?? "").trim();
  if (!normalizedUnit || String(value).toLowerCase().includes(normalizedUnit.toLowerCase())) return display;
  if (normalizedUnit === "%") return String(value).includes("%") ? display : `${display}%`;
  return `${display} ${normalizedUnit}`;
}

function labelForItem(item: ParsedLabItem) {
  if (labSpecimenIdentityForItem(item).key !== "blood") return specimenAwareLabDisplayLabel(item);
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
  const specimen = labSpecimenIdentityForItem(item);
  if (isBodyFluidSpecimen(specimen)) return "fluid";
  if (specimen.key === "urine") return "urinalysis";
  if (specimen.key === "abg" || specimen.key === "vbg") return "gas";
  if (specimen.key === "stool") return "infxPerfusion";
  if (specimen.key === "other-specimen") return "other";
  if (/^(?:Microbiology|Stool studies)$/i.test(String(item.name || item.label || ""))) return "infxPerfusion";
  const dictionaryGroup = dictionaryItemFor(item.name || item.label)?.group ?? "";
  if (dictionaryGroup === "CBC / DC") return "cbc";
  if (dictionaryGroup === "Renal / Electrolytes") return "renalLyte";
  if (dictionaryGroup === "Liver / GI" || dictionaryGroup === "Coagulation") return "liverCoag";
  if (dictionaryGroup === "Inflammation / Infection") return "infxPerfusion";
  if (dictionaryGroup === "Urinalysis") return "urinalysis";
  if (dictionaryGroup === "ABG / VBG") return "gas";
  if (dictionaryGroup === "Cardiac") return "cardiac";
  return "other";
}

function toneForText(label: string, value: string, item: ParsedLabItem, chronicRenal = false): LabVisualTone {
  const specimen = labSpecimenIdentityForItem(item);
  const analyte = labAnalyteLabelForItem(item);
  if (isBodyFluidSpecimen(specimen)) return "important";
  const previousValue = String(item.previousValue ?? "").trim();
  const numeric = comparisonNumber(specimen.key === "blood" ? label : analyte, value);
  if (specimen.key !== "blood") {
    if (numeric !== null && (specimen.key === "abg" || specimen.key === "vbg")) {
      if (analyte === "pH" && (numeric < 7.2 || numeric > 7.6)) return "critical";
      if (/^pCO2$/i.test(analyte) && (numeric < 20 || numeric > 60)) return "critical";
      if (/^pO2$/i.test(analyte) && numeric < 60) return "critical";
      if (/^HCO3$/i.test(analyte) && (numeric < 15 || numeric > 40)) return "critical";
      if (analyte === "pH" && (numeric < 7.35 || numeric > 7.45)) return "important";
      if (/^pCO2$/i.test(analyte) && (numeric < 35 || numeric > 45)) return "important";
      if (/^pO2$/i.test(analyte) && numeric < 80) return "important";
      if (/^HCO3$/i.test(analyte) && (numeric < 22 || numeric > 26)) return "important";
    }
    if (/\babnormal\b/i.test(String(item.note ?? "")) || item.important || item.isImportant) return "important";
    if (/^(?:LE|Nitrite|Bacteria|Protein|Ketone|Glucose)$/i.test(analyte) &&
        /(?:positive|pos|reactive|detected|present|many|moderate|trace|[1-4]\+)/i.test(`${value} ${item.note ?? ""}`)) return "important";
    if (previousValue && trendDirection(analyte, value, previousValue)) return "important";
    if (noteDirection(item)) return "important";
    return "plain";
  }
  if (numeric !== null) {
    if (label === "K" && (numeric < 3 || numeric > 5.5)) return "critical";
    if (label === "Na" && (numeric < 130 || numeric > 150)) return "critical";
    if (label === "Hb" && numeric < 8) return "critical";
    if (label === "Plt" && numeric < 50) return "critical";
    if (label === "WBC" && (numeric < 2 || numeric > 20)) return "critical";
    if (label === "ANC") {
      const compactUnit = String(item.unit ?? "").replace(/\s+/g, "").toLowerCase();
      const criticalThreshold = /(?:10\^3\/ul|10\^9\/l|k\/ul)/.test(compactUnit) ? 0.5 : 500;
      if (numeric < criticalThreshold) return "critical";
      const importantThreshold = /(?:10\^3\/ul|10\^9\/l|k\/ul)/.test(compactUnit) ? 1.5 : 1500;
      if (numeric < importantThreshold) return "important";
    }
    // ESRD/dialysis: elevated Cr/BUN is that patient's baseline, not critical.
    if (label === "Cr" && numeric >= 2) return chronicRenal ? "important" : "critical";
    if ((label === "AST" || label === "ALT") && numeric >= 200) return "critical";
    if (label === "INR" && numeric >= 3) return "critical";
    if (label === "Lactate" && numeric >= 4) return "critical";
    if ((label === "UA WBC" || label === "UA RBC") && numeric > 5) return "important";
    if (label === "ESR" && numeric > 30) return "important";
    if ((label === "CRP" || label === "hsCRP" || label === "PCT") && numeric > 0) {
      if (referenceDirection(label, value)) return "important";
    }
  }
  if (/^(?:LE|Nitrite|Bacteria|Protein|Ketone|Glucose urine)$/i.test(label) &&
      /(?:positive|pos|reactive|detected|present|many|moderate|trace|[1-4]\+)/i.test(`${value} ${item.note ?? ""}`)) return "important";
  if (/\babnormal\b/i.test(String(item.note ?? ""))) return "important";
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

function visualItemFromParsed(item: ParsedLabItem, sourceIndex = 0, chronicRenal = false): LabVisualItem | null {
  const trusted = trustedLabItem(item);
  const specimen = labSpecimenIdentityForItem(item);
  const analyte = labAnalyteLabelForItem(item);
  const label = specimen.key !== "blood"
    ? specimenAwareLabDisplayLabel(item)
    : trusted
      ? labelForItem(item)
      : String(item.name || item.label || "").trim();
  const value = String(item.value ?? "").trim();
  if (!label || !value) return null;

  const previousValue = String(item.previousValue ?? "").trim();
  const datedItem = item as ParsedLabItem & { date?: string; dateIsExplicit?: boolean };
  const leadingCurrentValue = previousValue
    ? value.match(/^\s*([<>]?\s*-?\d+(?:,\d{3})*(?:\.\d+)?)/)?.[1]?.replace(/\s+/g, "") ?? ""
    : "";
  const displayKey = label;
  const comparisonKey = specimen.key === "blood" ? label : analyte;
  const displayValue = displayLabValue(displayKey, leadingCurrentValue || value);
  // Non-dictionary labs (custom entries, ACTH, ...) still display under Other;
  // they just never get reference-range arrows or numeric criticality.
  const direction = previousValue
    ? trendDirection(comparisonKey, value, previousValue)
    : trusted
      ? noteDirection(item) || (specimen.key === "blood" ? referenceDirection(label, value) : "")
      : noteDirection(item);
  const unit = String(item.unit ?? "").trim();
  const displayUnit = specimen.key === "blood" ? "" : unit;
  const previous = previousValue ? `(${displayLabValueWithUnit(displayKey, previousValue, displayUnit)})` : "";
  const text = `${label} ${displayLabValueWithUnit(displayKey, leadingCurrentValue || value, displayUnit)}${direction}${previous}`;
  const groupId = groupIdForItem(item);
  const tone = trusted
    ? toneForText(label, value, item, chronicRenal)
    : item.important || item.isImportant || noteDirection(item) || /\babnormal\b/i.test(String(item.note ?? ""))
      ? "important"
      : "plain";

  return {
    sourceId: item.id ?? "",
    key: specimenAwareLabSelectionKey(item),
    label,
    value,
    previousValue,
    unit,
    date: String(datedItem.date ?? "").trim(),
    dateIsExplicit: datedItem.dateIsExplicit === true,
    text,
    tone,
    score: scoreForItem(groupId, label, tone, sourceIndex),
    sourceIndex,
    explicitMark: false,
    groupId,
  };
}

function cleanOtherText(source: LabSourceLine) {
  // Marked segments become their own colored items, so drop them from the leftover text.
  return stripReferenceText(String(source.body).replace(new RegExp(labColorMarkPattern.source, "gi"), " "))
    .replace(/^!+\s*/, "")
    .replace(/^(?:Crit|Critical|Abn|Abnormal|Trend|Anchor|Ref)\s*:?\s*/i, "")
    .replace(/\s+,\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;]+\s*|[,;]+$/g, "");
}

function comparableVisualLabUnit(value: string, selectionKey = "") {
  const unit = String(value ?? "").replace(/\s+/g, "").replace(/[µμ]/g, "u").toLowerCase();
  if (/^(?:cells?)?\/(?:ul|mm3)$/.test(unit)) return "count-per-ul";
  if (/^(?:k\/ul|(?:x|×)?10\^?3\/ul|10\^?9\/l)$/.test(unit)) return "thousand-per-ul";
  if (!unit && !selectionKey.startsWith("blood|") && /\|(?:wbc|rbc|anc|totalnucleatedcells|nucleatedcells|cellcount)$/.test(selectionKey)) return "count-per-ul";
  if (!unit && !selectionKey.startsWith("blood|") && /\|(?:pmn|neu|neutrophils?|lym|lymphocytes?|mono|eos|baso)$/.test(selectionKey)) return "%";
  return unit;
}

function visualCellCountScalePerUl(value: string, selectionKey: string) {
  if (!/\|(?:wbc|rbc|anc|totalnucleatedcells|nucleatedcells|cellcount)$/.test(selectionKey)) return null;
  const unit = String(value ?? "").replace(/\s+/g, "").replace(/[µμ]/g, "u").toLowerCase();
  if (!unit || /^(?:cells?)?\/(?:ul|mm3)$/.test(unit)) return 1;
  if (/^k\/ul$/.test(unit)) return 1000;
  const scaled = unit.match(/^(?:x|×)?10\^?(\d{1,2})\/(ul|l)$/);
  if (!scaled) return null;
  return 10 ** (Number(scaled[1]) - (scaled[2] === "l" ? 6 : 0));
}

function visualPreviousValueInCurrentUnit(current: LabVisualItem, previous: LabVisualItem) {
  const currentScale = visualCellCountScalePerUl(current.unit, current.key);
  const previousScale = visualCellCountScalePerUl(previous.unit, previous.key);
  if (currentScale === null || previousScale === null || currentScale === previousScale) return previous.value;
  const match = previous.value.replace(/,/g, "").match(/^([<>]?)\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(%?\+?)$/i);
  if (!match) return previous.value;
  const numeric = Number(match[2]);
  if (!Number.isFinite(numeric)) return previous.value;
  const converted = numeric * previousScale / currentScale;
  const formatted = Number.isInteger(converted) ? String(converted) : converted.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${match[1]}${formatted}${match[3]}`;
}

function withPreviousVisualValue(current: LabVisualItem, previous: LabVisualItem) {
  if (current.explicitMark || current.previousValue) return current;
  const currentUnit = comparableVisualLabUnit(current.unit, current.key);
  const previousUnit = comparableVisualLabUnit(previous.unit, previous.key);
  const currentScale = visualCellCountScalePerUl(current.unit, current.key);
  const previousScale = visualCellCountScalePerUl(previous.unit, previous.key);
  if (currentUnit !== previousUnit && (currentScale === null || previousScale === null)) return current;
  if (current.dateIsExplicit && previous.dateIsExplicit && previous.date > current.date) return current;
  const previousValue = visualPreviousValueInCurrentUnit(current, previous);
  const direction = trendDirection(current.label, current.value, previousValue);
  const tone: LabVisualTone = direction && current.tone === "plain" ? "important" : current.tone;
  const displayUnit = current.key.startsWith("blood|") ? "" : current.unit;
  const currentDisplay = displayLabValueWithUnit(current.label, current.value, displayUnit);
  const previousDisplay = displayLabValueWithUnit(current.label, previousValue, displayUnit);
  return {
    ...current,
    previousValue,
    text: `${current.label} ${currentDisplay}${direction}(${previousDisplay})`,
    tone,
    score: current.score + (tone !== current.tone ? 200 : 0),
  };
}

function dedupeVisualItems(items: LabVisualItem[]) {
  const byKey = new Map<string, LabVisualItem>();
  items.forEach((item) => {
    const existing = byKey.get(item.key);
    if (!existing) {
      byKey.set(item.key, item);
      return;
    }
    if (item.explicitMark !== existing.explicitMark) {
      if (item.explicitMark) byKey.set(item.key, item);
      return;
    }
    if (item.sourceIndex < existing.sourceIndex) {
      byKey.set(item.key, withPreviousVisualValue(item, existing));
      return;
    }
    if (item.sourceIndex > existing.sourceIndex) {
      byKey.set(item.key, withPreviousVisualValue(existing, item));
      return;
    }
    if (item.score >= existing.score) byKey.set(item.key, item);
  });
  return [...byKey.values()];
}

function dedupeNarrativeItems(items: LabVisualItem[]) {
  const byNarrative = new Map<string, LabVisualItem>();
  const retained: LabVisualItem[] = [];
  items.forEach((item) => {
    if (!/^(?:Microbiology|Other)$/i.test(item.label)) return void retained.push(item);
    const narrativeKey = stripColorMarkup(item.text)
      .replace(/^(?:Other|Micro(?:biology)?|Infx(?:\/Perfusion)?)\s*:?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
    if (!narrativeKey) return;
    const existing = byNarrative.get(narrativeKey);
    if (!existing) return void byNarrative.set(narrativeKey, item);
    const existingSpecific = !/^Other$/i.test(existing.label);
    const itemSpecific = !/^Other$/i.test(item.label);
    if (
      (itemSpecific && !existingSpecific) ||
      (item.explicitMark && !existing.explicitMark) ||
      (itemSpecific === existingSpecific && item.score > existing.score)
    ) byNarrative.set(narrativeKey, item);
  });
  return [...retained, ...byNarrative.values()];
}

function buildGroupsFromVisualItems(items: LabVisualItem[], options: LabVisualSummaryOptions) {
  const maxGroups = options.maxGroups ?? Number.POSITIVE_INFINITY;
  const groups = new Map<LabVisualGroupId, LabVisualItem[]>();
  const preferredItemIds = new Set((options.preferredItemIds ?? []).map((value) => String(value).trim()).filter(Boolean));
  const preferredLabels = new Set((options.preferredLabels ?? []).map(canonicalLabSelectionKey).filter(Boolean));
  const requiredLabels = new Set((options.requiredLabels ?? []).map(canonicalLabSelectionKey).filter(Boolean));
  const hasAiSelection = preferredItemIds.size > 0 || preferredLabels.size > 0;
  const isPreferred = (item: LabVisualItem) =>
    Boolean(item.sourceId && preferredItemIds.has(item.sourceId)) || preferredLabels.has(item.key);
  const isRequired = (item: LabVisualItem) => requiredLabels.has(item.key);

  dedupeNarrativeItems(items).forEach((item) => {
    groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  });

  return labGroupOrder
    .map((group) => {
      const maxItems = options.maxItemsPerGroup ?? defaultGroupItemLimits[group.id];
      const coreOrder = new Map(coreDisplayKeys[group.id].map((key, index) => [key, index]));
      const coreLabel = (item: LabVisualItem) => group.id === "gas"
        ? item.label.replace(/^(?:ABG|VBG)\s+/i, "")
        : item.label;
      const orderedItems = dedupeVisualItems(groups.get(group.id) ?? [])
        .sort((left, right) => {
          // Keep familiar panel order for scanning. Visibility (below), not
          // row position, guarantees that critical/abnormal values survive.
          const leftCore = coreOrder.get(coreLabel(left));
          const rightCore = coreOrder.get(coreLabel(right));
          if (leftCore !== undefined || rightCore !== undefined) {
            if (leftCore === undefined) return 1;
            if (rightCore === undefined) return -1;
            const coreDifference = leftCore - rightCore;
            if (coreDifference) return coreDifference;
          }
          const toneRank = (tone: LabVisualTone) => tone === "critical" ? 2 : tone === "important" ? 1 : 0;
          const toneDifference = toneRank(right.tone) - toneRank(left.tone);
          if (toneDifference) return toneDifference;
          const requiredDifference = Number(isRequired(right)) - Number(isRequired(left));
          if (requiredDifference) return requiredDifference;
          const preferredDifference = Number(isPreferred(right)) - Number(isPreferred(left));
          if (preferredDifference) return preferredDifference;
          const leftOrder = displayOrder.get(`${group.id}|${left.label}`) ?? 99;
          const rightOrder = displayOrder.get(`${group.id}|${right.label}`) ?? 99;
          return leftOrder - rightOrder || right.score - left.score || left.label.localeCompare(right.label);
        });
      const focusedItems = orderedItems.filter((item) => {
        if (isPreferred(item) || isRequired(item) || item.tone !== "plain" || item.explicitMark) return true;
        if (options.selectionMode === "aiFocused") return false;
        if (options.selectionMode === "complete") return item.label !== "Other";
        return (group.id !== "other" && coreOrder.has(coreLabel(item))) ||
          (!hasAiSelection && group.id === "other" && item.label !== "Other");
      });
      const selectedItems = new Set(focusedItems.filter((item) => item.tone !== "plain" || item.explicitMark));
      focusedItems.forEach((item) => {
        if (selectedItems.size < maxItems) selectedItems.add(item);
      });
      // Preserve familiar display order after selecting. A group may exceed
      // its soft limit when more than that many high-yield values are present.
      const sourceItems = orderedItems.filter((item) => selectedItems.has(item));
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
        text: options.maxCharsPerGroup ? safeClinicalLinePreservingMarks(rawText, options.maxCharsPerGroup) : rawText,
      } satisfies LabVisualGroup;
    })
    .filter((group): group is LabVisualGroup => Boolean(group))
    .slice(0, maxGroups);
}

export function buildLabVisualSummaryFromItems(items: ParsedLabItem[], options: LabVisualSummaryOptions = {}) {
  const includePlain = options.includePlain ?? true;
  const chronicRenal = hasChronicRenalContext(options.patient);
  const visualItems = items
    .map((item, index) => visualItemFromParsed(item, index, chronicRenal))
    .filter((item): item is LabVisualItem => Boolean(item))
    .filter((item) => includePlain || item.tone !== "plain");
  return buildGroupsFromVisualItems(visualItems, options);
}

export function buildLabVisualSummaryFromText(value: string, options: LabVisualSummaryOptions = {}) {
  const chronicRenal = hasChronicRenalContext(options.patient);
  // Canonical SOAP lines already carry a `Lab:` section prefix. Remove only
  // that display prefix before the broad HIS/LIS parser runs; otherwise a
  // clean `Lab: CBC/DC: WBC ...` line can be mistaken for another report
  // heading and silently lose its plain orientation values.
  const canonicalInput = splitInputLines(value).map((line) => {
    const { body: withoutImportantPrefix, important } = splitImportantPrefix(line);
    const stripped = stripLabLinePrefix(withoutImportantPrefix);
    if (!stripped.hasLabPrefix) return line;
    return `${important ? "! " : ""}${stripped.body}`;
  }).join("\n");
  const dataset = buildCanonicalLabDataset(canonicalInput);
  const sourceLines = splitInputLines(dataset.normalizedText)
    .map((line) => labSourceLineFrom(line, false))
    .filter((line): line is LabSourceLine => Boolean(line));
  const visualItems: LabVisualItem[] = markedVisualItemsFromText(sourceLines.map((line) => line.body).join("\n"));
  sourceLines.forEach((source, sourceIndex) => {
    if (!/\b(?:(?:blood|urine|sputum|csf)\s*(?:culture|cx)|(?:b|u|s)\/?c|(?:bc|uc|sc)x|stool\s+(?:o&p|occult|fobt)|c\.?\s*difficile)\b/i.test(source.body)) return;
    if (source.items.some((item) => /(?:Microbiology|Stool studies|culture|(?:B|U|S)\/?C|(?:BC|UC|SC)x)/i.test(String(item.name || item.label || "")))) return;
    visualItems.push({
      sourceId: "",
      key: `micro|${source.body.toLowerCase().replace(/\s+/g, " ").trim()}`,
      label: "Microbiology",
      value: source.body,
      previousValue: "",
      unit: "",
      date: "",
      dateIsExplicit: false,
      text: source.body,
      tone: "important",
      score: scoreForItem("infxPerfusion", "Microbiology", "important", sourceIndex),
      sourceIndex,
      explicitMark: false,
      groupId: "infxPerfusion",
    });
  });

  dataset.latestItems.forEach((item, sourceIndex) => {
    const visualItem = visualItemFromParsed(item, sourceIndex, chronicRenal);
    if (visualItem && ((options.includePlain ?? true) || visualItem.tone !== "plain")) visualItems.push(visualItem);
  });

  sourceLines.forEach((source, sourceIndex) => {
    // Preserve genuinely unparsed source text only; parsed values come from the canonical dataset above.
    if (source.items.length === 0) {
      const text = cleanOtherText(source);
      if (text) {
        visualItems.push({
          sourceId: "",
          key: `other|${sourceIndex}|${text.toLowerCase()}`,
          label: "Other",
          value: text,
          previousValue: "",
          unit: "",
          date: "",
          dateIsExplicit: false,
          text,
          tone: source.important ? "important" : "plain",
          score: scoreForItem("other", "Other", source.important ? "important" : "plain", sourceIndex),
          sourceIndex,
          explicitMark: false,
          groupId: "other",
        });
      }
    }
  });

  return buildGroupsFromVisualItems(visualItems, options);
}

export function buildLabVisualTimelineSummary(
  currentValue: string,
  previousValue: string,
  options: LabVisualSummaryOptions = {},
) {
  // Compare the complete current and prior datasets before applying AI focus.
  // Otherwise a plain value (for example improving pH/HCO3 in DKA) is removed
  // before its clinically meaningful trajectory can be recognized.
  const comparisonOptions = {
    ...options,
    selectionMode: "complete" as const,
    preferredItemIds: [],
    preferredLabels: [],
    requiredLabels: [],
    maxGroups: Number.POSITIVE_INFINITY,
    maxItemsPerGroup: Number.POSITIVE_INFINITY,
  };
  const currentGroups = buildLabVisualSummaryFromText(currentValue, comparisonOptions);
  if (!previousValue.trim()) return buildGroupsFromVisualItems(currentGroups.flatMap((group) => group.items), options);

  const previousItems = buildLabVisualSummaryFromText(previousValue, comparisonOptions)
    .flatMap((group) => group.items);
  const previousByKey = new Map(previousItems.map((item) => [item.key, item]));
  const timelineItems = currentGroups
    .flatMap((group) => group.items)
    .map((item) => {
      const previous = previousByKey.get(item.key);
      return previous ? withPreviousVisualValue(item, previous) : item;
    });
  return buildGroupsFromVisualItems(timelineItems, options);
}

export function formatLabVisualTimelineLines(
  currentValue: string,
  previousValue: string,
  options: LabVisualSummaryOptions = {},
) {
  return buildLabVisualTimelineSummary(currentValue, previousValue, options).map((group) => group.text);
}

export function buildPatientLabVisualSummary(patient: Patient, notes: DailyNote[] = [], options: LabVisualSummaryOptions = {}) {
  const items: ParsedLabItem[] = [];
  patient.labReports.forEach((report) => items.push(...report.items));
  items.push(...patient.parsedLabItems);
  notes.forEach((note) => {
    note.labReports.forEach((report) => items.push(...report.items));
    items.push(...note.parsedLabItems);
  });

  const textSource = [
    patient.rawLabText,
    patient.newLabs,
    patient.initialLabs,
    ...notes.flatMap((note) => [note.rawLabText, note.labSummary]),
  ]
    .filter(Boolean)
    .join("\n");

  if (items.length > 0) {
    const includePlain = options.includePlain ?? true;
    const chronicRenal = hasChronicRenalContext(patient);
    const parsedVisualItems = items
      .map((item, index) => visualItemFromParsed(item, index, chronicRenal))
      .filter((item): item is LabVisualItem => Boolean(item))
      .filter((item) => includePlain || item.tone !== "plain");
    // Clinician-colored segments live in the raw lab text; merge them so colors survive the structured path too.
    return buildGroupsFromVisualItems([...parsedVisualItems, ...markedVisualItemsFromText(textSource)], { ...options, patient });
  }
  return buildLabVisualSummaryFromText(textSource, { ...options, patient });
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
