import { parseLabReports } from "./labParsing";
import { findLabDictionaryItem } from "./data/labDictionary";
import {
  labAnalyteKeyForItem,
  labSpecimenIdentityForItem,
  labSpecimenScopeKey,
  specimenAwareLabDisplayLabel,
  specimenAwareLabSelectionKey,
  stripLeadingLabSpecimen,
  type LabSpecimenKey,
} from "./labSpecimen";
import { normalizeCompactBloodGasLine, normalizeLabTableSourceText } from "./objectiveLineSanitizer";
import type { ParsedLabItem } from "./types";

export interface CanonicalLabItem extends ParsedLabItem {
  id: string;
  date: string;
  dateIsExplicit: boolean;
  specimen: LabSpecimenKey;
  specimenLabel: string;
  specimenScope: string;
  analyteKey: string;
}

export interface CanonicalLabDataset {
  normalizedText: string;
  allItems: CanonicalLabItem[];
  latestItems: CanonicalLabItem[];
  rejectedMetadata: string[];
}

function selectionKey(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  return specimenAwareLabSelectionKey(item);
}

export function canonicalLabSelectionKey(value: string) {
  const scoped = String(value ?? "").trim().match(/^([a-z][a-z0-9-]*(?::[\p{L}\p{N}-]+)*)\|([\p{L}\p{N}-]+)$/iu);
  if (scoped) {
    const specimenKey = scoped[1].split(":", 1)[0].toLowerCase() as LabSpecimenKey;
    const knownSpecimens = new Set<LabSpecimenKey>([
      "blood", "urine", "abg", "vbg", "csf", "pleural-fluid", "ascitic-fluid",
      "synovial-fluid", "pericardial-fluid", "bal", "stool", "other-fluid",
      "other-specimen",
    ]);
    if (knownSpecimens.has(specimenKey)) return `${scoped[1].toLowerCase()}|${scoped[2].toLowerCase()}`;
  }
  const stripped = stripLeadingLabSpecimen(value);
  const dictionaryGroup = findLabDictionaryItem(stripped.body || value)?.group ?? "";
  return specimenAwareLabSelectionKey({
    label: stripped.body || value,
    name: stripped.body || value,
    group: stripped.identity.key === "blood" ? dictionaryGroup : stripped.identity.label,
  });
}

export function canonicalLabItemSelectionKey(item: Pick<ParsedLabItem, "label" | "name" | "group">) {
  return selectionKey(item);
}

function safeIdPart(value: string) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function hasExplicitLeadingDate(value: string) {
  return /^\s*!?\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/.test(String(value ?? ""));
}

function normalizedLabUnit(value: unknown) {
  const compact = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u00b5\u03bc]/g, "u")
    .replace(/\u00b3/g, "3")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (/^(?:cells?)?\/(?:ul|mm\^?3|cumm)$/.test(compact)) return "/ul";
  if (/^k\/ul$/.test(compact)) return "x10^3/ul";
  const scaledCount = compact.match(/^(?:x)?10\^?(\d{1,2})\/(ul|l)$/);
  if (scaledCount) return `10^${scaledCount[1]}/${scaledCount[2]}`;
  return compact;
}

function normalizedLabUnitForItem(item: Pick<ParsedLabItem, "label" | "name" | "group" | "unit">) {
  const explicit = normalizedLabUnit(item.unit);
  if (explicit) return explicit;
  const specimen = labSpecimenIdentityForItem(item);
  if (specimen.key === "blood") return "";
  const analyte = labAnalyteKeyForItem(item);
  if (/^(?:wbc|rbc|anc|totalnucleatedcells|nucleatedcells|cellcount)$/.test(analyte)) return "/ul";
  if (/^(?:pmn|neu|neutrophils?|lym|lymphocytes?|mono|eos|baso)$/.test(analyte)) return "%";
  return "";
}

function equivalentDuplicateValue(left: unknown, right: unknown) {
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
  return normalize(left) === normalize(right);
}

function cellCountScalePerUl(item: Pick<ParsedLabItem, "label" | "name" | "group" | "unit">) {
  const analyte = labAnalyteKeyForItem(item);
  if (!/^(?:wbc|rbc|anc|totalnucleatedcells|nucleatedcells|cellcount)$/.test(analyte)) return null;
  const unit = normalizedLabUnitForItem(item);
  if (unit === "/ul") return 1;
  const scaled = unit.match(/^10\^(\d{1,2})\/(ul|l)$/);
  if (!scaled) return null;
  const exponent = Number(scaled[1]) - (scaled[2] === "l" ? 6 : 0);
  return 10 ** exponent;
}

function comparableLabUnits(
  current: Pick<ParsedLabItem, "label" | "name" | "group" | "unit">,
  previous: Pick<ParsedLabItem, "label" | "name" | "group" | "unit">,
) {
  const currentUnit = normalizedLabUnitForItem(current);
  const previousUnit = normalizedLabUnitForItem(previous);
  if (currentUnit === previousUnit) return true;
  return cellCountScalePerUl(current) !== null && cellCountScalePerUl(previous) !== null;
}

function previousValueInCurrentUnit(
  current: Pick<ParsedLabItem, "label" | "name" | "group" | "unit">,
  previous: Pick<ParsedLabItem, "label" | "name" | "group" | "unit" | "value">,
) {
  const currentScale = cellCountScalePerUl(current);
  const previousScale = cellCountScalePerUl(previous);
  if (currentScale === null || previousScale === null || currentScale === previousScale) return previous.value;
  const match = String(previous.value ?? "").trim().match(/^([<>]?)\s*(-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:e[+-]?\d+)?)(%?\+?)$/i);
  if (!match) return previous.value;
  const numeric = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return previous.value;
  const converted = numeric * previousScale / currentScale;
  const formatted = Number.isInteger(converted)
    ? String(converted)
    : converted.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${match[1]}${formatted}${match[3]}`;
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
  const occurrences = new Map<string, number>();
  const allItems: CanonicalLabItem[] = [];

  parseLabReports(normalized.text).forEach((report) => {
    report.items.forEach((item) => {
      const key = selectionKey(item);
      if (!key || !String(item.value ?? "").trim()) return;
      const specimen = labSpecimenIdentityForItem(item);
      const specimenScope = labSpecimenScopeKey(specimen);
      const analyteKey = labAnalyteKeyForItem(item);
      const fingerprint = [
        key,
        report.date,
        item.value,
        item.unit ?? "",
        item.previousValue ?? "",
        item.note ?? "",
      ].join("|").toLowerCase();
      const identityPart = specimen.key === "blood"
        ? safeIdPart(analyteKey)
        : `${safeIdPart(specimenScope)}-${safeIdPart(analyteKey)}`;
      const baseId = `lab-${identityPart}-${safeIdPart(report.date || "undated")}-${stableHash(fingerprint)}`;
      const occurrence = occurrences.get(baseId) ?? 0;
      occurrences.set(baseId, occurrence + 1);
      allItems.push({
        ...item,
        id: occurrence === 0 ? baseId : `${baseId}-${occurrence + 1}`,
        // Date remains internal display/AI context and is not a schema change.
        date: report.date,
        dateIsExplicit: report.dateIsExplicit === true || hasExplicitLeadingDate(report.rawText),
        specimen: specimen.key,
        specimenLabel: specimen.label,
        specimenScope,
        analyteKey,
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
    const previous = sorted.slice(1).find((candidate) => !(
      candidate.date === latest.date &&
      equivalentDuplicateValue(candidate.value, latest.value) &&
      normalizedLabUnitForItem(candidate) === normalizedLabUnitForItem(latest) &&
      String(candidate.note ?? "") === String(latest.note ?? "")
    ));
    if (!previous ||
        !chronologicallyEligiblePrior(latest, previous) ||
        !comparableLabUnits(latest, previous)) return [latest];
    return [{ ...latest, previousValue: previousValueInCurrentUnit(latest, previous) }];
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
      return { ...item, previousValue: previousValueInCurrentUnit(item, prior) };
    }),
  };
}

export function canonicalLabFactsForAi(dataset: CanonicalLabDataset, maxItems = 100) {
  return [...dataset.latestItems]
    .sort((left, right) => selectionKey(left).localeCompare(selectionKey(right)) || left.id.localeCompare(right.id))
    .slice(0, maxItems)
    .map((item) => {
    const date = item.date;
    const unit = String(item.unit ?? "").trim();
    const previous = String(item.previousValue ?? "").trim();
    const flag = String(item.note ?? "").trim();
    return [
      `[${item.id}]`,
      item.specimen === "other-specimen"
        ? `specimen unknown (${item.specimenLabel})`
        : item.specimen === "blood" && !findLabDictionaryItem(item.name || item.label)
          ? ""
          : `specimen ${item.specimenLabel}`,
      `${specimenAwareLabDisplayLabel(item)} ${item.value}${unit ? ` ${unit}` : ""}`,
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
