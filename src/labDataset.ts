import { compactLabKey, findLabDictionaryItem } from "./data/labDictionary";
import { parseLabReports } from "./labParsing";
import { normalizeCompactBloodGasLine, normalizeLabTableSourceText } from "./objectiveLineSanitizer";
import type { ParsedLabItem } from "./types";

export interface CanonicalLabItem extends ParsedLabItem {
  id: string;
  date: string;
  dateIsExplicit: boolean;
}

export interface CanonicalLabDataset {
  normalizedText: string;
  allItems: CanonicalLabItem[];
  latestItems: CanonicalLabItem[];
  rejectedMetadata: string[];
}

function selectionKey(item: Pick<ParsedLabItem, "label" | "name">) {
  const label = String(item.name || item.label || "").trim();
  const dictionary = findLabDictionaryItem(label);
  return dictionary?.key ?? compactLabKey(label).toLowerCase();
}

export function canonicalLabSelectionKey(value: string) {
  const dictionary = findLabDictionaryItem(value);
  return dictionary?.key ?? compactLabKey(value).toLowerCase();
}

function safeIdPart(value: string) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function hasExplicitLeadingDate(value: string) {
  return /^\s*!?\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/.test(String(value ?? ""));
}

function normalizedLabUnit(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function comparableLabUnits(current: Pick<ParsedLabItem, "unit">, previous: Pick<ParsedLabItem, "unit">) {
  return normalizedLabUnit(current.unit) === normalizedLabUnit(previous.unit);
}

function chronologicallyEligiblePrior(
  current: Pick<CanonicalLabItem, "date" | "dateIsExplicit">,
  previous: Pick<CanonicalLabItem, "date" | "dateIsExplicit">,
) {
  if (!current.dateIsExplicit || !previous.dateIsExplicit) return true;
  return previous.date <= current.date;
}

function withStableIds(value: string) {
  const normalized = normalizeLabTableSourceText(
    String(value ?? "").split(/\r?\n/).map(normalizeCompactBloodGasLine).join("\n"),
  );
  const seen = new Set<string>();
  const allItems: CanonicalLabItem[] = [];

  parseLabReports(normalized.text).forEach((report, reportIndex) => {
    report.items.forEach((item, itemIndex) => {
      const key = selectionKey(item);
      if (!key || !String(item.value ?? "").trim()) return;
      const duplicateKey = `${key}|${report.date}|${item.value}|${item.unit ?? ""}|${item.note ?? ""}`.toLowerCase();
      if (seen.has(duplicateKey)) return;
      seen.add(duplicateKey);
      allItems.push({
        ...item,
        id: `lab-${safeIdPart(key)}-${safeIdPart(report.date || "undated")}-${reportIndex}-${itemIndex}`,
        // Date remains internal display/AI context and is not a schema change.
        date: report.date,
        dateIsExplicit: hasExplicitLeadingDate(report.rawText),
      });
    });
  });

  return { normalized, allItems };
}

export function buildCanonicalLabDataset(value: string): CanonicalLabDataset {
  const { normalized, allItems } = withStableIds(value);
  const byKey = new Map<string, CanonicalLabItem[]>();
  allItems.forEach((item) => {
    const key = selectionKey(item);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  });

  const latestItems = [...byKey.values()].flatMap((items) => {
    const sorted = [...items].sort((left, right) => {
      const dateDifference = right.date.localeCompare(left.date);
      if (dateDifference) return dateDifference;
      // Sources are merged oldest-to-newest. When two results share a date (or
      // have no date), the later source occurrence is the current value.
      return allItems.indexOf(right) - allItems.indexOf(left);
    });
    const latest = sorted[0];
    if (!latest) return [];
    if (latest.previousValue) return [latest];
    // "Previous" is the immediately preceding observation, even when the
    // value is unchanged. Never skip back to an older different result.
    const previous = sorted[1];
    if (!previous ||
        !chronologicallyEligiblePrior(latest, previous) ||
        !comparableLabUnits(latest, previous)) return [latest];
    return [{ ...latest, previousValue: previous.value }];
  });

  return {
    normalizedText: normalized.text,
    allItems,
    latestItems,
    rejectedMetadata: normalized.rejected,
  };
}

export function buildCanonicalLabTimelineDataset(
  currentValue: string,
  previousValue: string,
): CanonicalLabDataset {
  const current = buildCanonicalLabDataset(currentValue);
  if (!previousValue.trim() || current.latestItems.length === 0) return current;

  const previous = buildCanonicalLabDataset(previousValue);
  const previousByKey = new Map(
    previous.latestItems.map((item) => [selectionKey(item), item]),
  );
  return {
    ...current,
    // Current source IDs stay unchanged so AI selections remain valid when the
    // client later verifies them against today's pasted source.
    latestItems: current.latestItems.map((item) => {
      if (String(item.previousValue ?? "").trim()) return item;
      const prior = previousByKey.get(selectionKey(item));
      if (!prior ||
          !chronologicallyEligiblePrior(item, prior) ||
          !comparableLabUnits(item, prior)) return item;
      return { ...item, previousValue: prior.value };
    }),
  };
}

export function canonicalLabFactsForAi(dataset: CanonicalLabDataset, maxItems = 100) {
  return dataset.latestItems.slice(0, maxItems).map((item) => {
    const date = item.date;
    const unit = String(item.unit ?? "").trim();
    const previous = String(item.previousValue ?? "").trim();
    const flag = String(item.note ?? "").trim();
    return [
      `[${item.id}]`,
      `${item.name || item.label} ${item.value}${unit ? ` ${unit}` : ""}`,
      previous ? `(previous ${previous})` : "",
      date ? `date ${date}` : "",
      flag ? `flag ${flag}` : "",
    ].filter(Boolean).join("; ");
  });
}

export function labSelectionKeysFromText(value: string) {
  return [...new Set(
    parseLabReports(String(value ?? ""))
      .flatMap((report) => report.items)
      .map((item) => selectionKey(item))
      .filter(Boolean),
  )];
}
