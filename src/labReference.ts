import type { ParsedLabItem } from "./types";
import { findLabDictionaryItem, normalizeLabDisplayName } from "./data/labDictionary";

interface LabReferenceRange {
  ref: string;
  unit?: string;
}

const commonReferenceRanges: Record<string, LabReferenceRange> = {
  WBC: { ref: "4.0-10.0", unit: "k/uL" },
  Hb: { ref: "12-16", unit: "g/dL" },
  Hct: { ref: "36-46", unit: "%" },
  Plt: { ref: "150-400", unit: "k/uL" },
  Neu: { ref: "40-75", unit: "%" },
  Na: { ref: "135-145", unit: "mmol/L" },
  K: { ref: "3.5-5.1", unit: "mmol/L" },
  Cl: { ref: "98-107", unit: "mmol/L" },
  BUN: { ref: "7-20", unit: "mg/dL" },
  Cr: { ref: "0.6-1.3", unit: "mg/dL" },
  Ca: { ref: "8.5-10.5", unit: "mg/dL" },
  Mg: { ref: "1.7-2.4", unit: "mg/dL" },
  P: { ref: "2.5-4.5", unit: "mg/dL" },
  AST: { ref: "<40", unit: "U/L" },
  ALT: { ref: "<40", unit: "U/L" },
  "T-Bil": { ref: "0.2-1.2", unit: "mg/dL" },
  Alb: { ref: "3.5-5.0", unit: "g/dL" },
  CRP: { ref: "<0.5", unit: "mg/dL" },
  Lactate: { ref: "0.5-2.2", unit: "mmol/L" },
  INR: { ref: "0.9-1.1" },
  Glucose: { ref: "70-140", unit: "mg/dL" },
};

export function labReferenceForLabel(label: string): LabReferenceRange | undefined {
  const normalized = normalizeLabDisplayName(label);
  return commonReferenceRanges[normalized] ?? commonReferenceRanges[findLabDictionaryItem(label)?.displayName ?? ""];
}

export function labReferenceText(label: string) {
  const reference = labReferenceForLabel(label);
  if (!reference) return "";
  return `ref ${reference.ref}${reference.unit ? ` ${reference.unit}` : ""}`;
}

export function labItemReferenceText(item: ParsedLabItem) {
  const label = item.name || item.label;
  const reference = labReferenceForLabel(label);
  if (!reference) return "";
  const unit = item.unit || reference.unit || "";
  return [
    `${label} ${item.value}${unit ? ` ${unit}` : ""}`,
    item.previousValue ? `prev ${item.previousValue}` : "",
    `ref ${reference.ref}${reference.unit ? ` ${reference.unit}` : ""}`,
  ].filter(Boolean).join(" | ");
}

export function printLabReferenceSuffix(label: string, unit = "") {
  const reference = labReferenceForLabel(label);
  if (!reference) return "";
  return `(ref ${reference.ref}${unit || reference.unit ? ` ${unit || reference.unit}` : ""})`;
}
