import { classifyClinicalLine, normalizeClinicalDisplayTextPreservingMarks, type ClinicalLineKind } from "./clinicalLineClassifier";
import { isOrderSoapLine, stripOrderLinePrefix } from "./userPreferences";

export type PrintVisualKind = Extract<ClinicalLineKind, "s" | "vs" | "pe" | "lab" | "image" | "ap" | "task" | "dc" | "red" | "other">;

export interface PrintVisualItem {
  kind: PrintVisualKind;
  label: string;
  text: string;
  tone: "critical" | "important" | "info" | "plain";
}

export interface PrintLineItem {
  raw: string;
  text: string;
  hidden?: boolean;
}

export interface PrintPriorityOptions {
  fallbackKind: PrintVisualKind;
  maxItems?: number;
  maxChars?: number;
}

export function cleanPrintLine(value: string) {
  return String(value ?? "")
    .replace(/\s+-\s*Reason:\s*.*$/i, "")
    .replace(/\s*\(\s*source:\s*AI\s*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function removePrintEllipsis(value: string) {
  return value
    .replace(/\bClarify current and HBV if\.{3}/i, "Clarify immunosupp/HBV status")
    .replace(/\bif\.{3}$/i, "")
    .replace(/\s*\.{3,}\s*/g, " ")
    .replace(/\s+(?:and|or|if|with|for|to|of)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function displayPrintLine(value: string) {
  return removePrintEllipsis(
    cleanPrintLine(value)
      .replace(/^!+/, "")
      .replace(/^((?:Dx|PMH|Issues|Red flags|Date|Attending|S|V\/S|VS|PE|Lab|Image|Img|A\/P|AP|Tasks?|DC|Order|Orders?|藥囑)\s*[:：]\s*)!+\s*/i, "$1")
      .replace(/^(Lab:\s*)!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "$1")
      .replace(/^!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "")
      .replace(/^(\w[\w/ ]{0,12}:\s*)!?\s*(?:critical|urgent)\s*:\s*/i, "$1* ")
      .replace(/^\s*(?:critical|urgent)\s*:\s*/i, "* ")
      .replace(/\b(?:critical|urgent)\s*:\s*/gi, "* ")
      .replace(/\[\s*URGENT\s*\]\s*/gi, "* ")
      .replace(/\bhigh-normal\b/gi, "\u2197 nl")
      .replace(/\blow-normal\b/gi, "\u2198 nl")
      .replace(/\bhigh\b/gi, "\u2191")
      .replace(/\blow\b/gi, "\u2193")
      .trim(),
  );
}

function visualPrintText(value: string) {
  return normalizeClinicalDisplayTextPreservingMarks(displayPrintLine(value)).replace(
    /^(S|V\/S|VS|Vitals?|PE|Physical exam|Lab|Image|Img|Task|Tasks|DC|Discharge|Prep)\s*:\s*/i,
    "",
  );
}

function cleanPrintTail(value: string) {
  let clean = value.replace(/\s+[+,;:-]\s*$/g, "").trim();
  for (let index = 0; index < 2; index += 1) {
    clean = clean
      .replace(/\s+(?:w\/|!+)\.?$/i, "")
      .replace(/\s+\b(?:if|and|or|with|without|for|to|from|of|the|a|an|when|as|no)\b\.?$/i, "")
      .replace(/\s+\b(?:check|review|confirm|correct|verify|monitor|coordinate|consider|assess|treat|after|acute|s\/p|ct|mri|cxr|image)\b\.?$/i, "")
      .replace(/\s*,\s*$/g, "")
      .trim();
  }
  return clean;
}

export function shortPrintText(value: string, maxChars = 84) {
  const clean = cleanPrintLine(value)
    .replace(/\bright\b/gi, "R")
    .replace(/\bleft\b/gi, "L")
    .replace(/\bbilateral\b/gi, "B/L")
    .replace(/\bwithout\b/gi, "w/o")
    .replace(/\bwith\b/gi, "w/")
    .replace(/\bsuspected\b/gi, "susp")
    .replace(/\bcompatible with\b/gi, "c/w")
    .replace(/\bconcerning for\b/gi, "c/f")
    .replace(/\bfollow[- ]?up\b/gi, "f/u")
    .replace(/\bacute ischemic stroke\b/gi, "AIS")
    .replace(/\binfarctions?\b/gi, "infarct")
    .replace(/\bhemorrhage\b/gi, "ICH")
    .replace(/\bpneumonia\b/gi, "PNA")
    .replace(/\bperoneal\/tibial CMAP & sural SNAP unelicitable\b/gi, "peroneal/tibial/sural unelicitable")
    .replace(/\bCMAP & sural SNAP\b/gi, "CMAP/SNAP")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxChars) return clean;

  const limit = Math.max(8, maxChars);
  const firstClause = clean.split(/[;\n\u3002\uFF1B]/)[0]?.trim() || clean;
  const words = firstClause.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    const next = [...kept, word].join(" ");
    if (next.length > limit) break;
    kept.push(word);
  }
  return cleanPrintTail(kept.join(" ") || firstClause.slice(0, limit).trim());
}

export function classifyPrintVisualItem(item: { raw: string; text: string }, fallbackKind: PrintVisualKind): PrintVisualItem {
  const source = item.raw || item.text;
  const isDcLine = /^!*\s*DC\s*:/i.test(source);
  const lockedKind = fallbackKind === "task" && isDcLine ? "dc" : fallbackKind;
  const classified = classifyClinicalLine(source, {
    fallbackKind: lockedKind,
    lockKind: lockedKind !== "other" && lockedKind !== "image",
  });
  const label = classified.kind === "task" ? (isOrderSoapLine(source) ? "藥囑" : "T") : classified.label;
  const markedText = visualPrintText(isOrderSoapLine(source) ? stripOrderLinePrefix(source) : source);
  return {
    kind: classified.kind as PrintVisualKind,
    label: label.includes("藥囑") ? "藥囑" : label,
    text: removePrintEllipsis(markedText || (isOrderSoapLine(source) ? stripOrderLinePrefix(classified.text) : classified.text)),
    tone: classified.tone,
  };
}

function splitPrintInput(value: string | string[]) {
  const lines = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n|;\s*|\s+\|\s+/);
  const seen = new Set<string>();
  return lines
    .map((line) => cleanPrintLine(line))
    .filter(Boolean)
    .filter((line) => {
      const key = displayPrintLine(line).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function requiredSignal(line: string, fallbackKind: PrintVisualKind, visual: PrintVisualItem) {
  if (/\[\[(?:red|orange|yellow|blue|green|purple):/i.test(line)) return true;
  if (visual.tone === "critical" || visual.tone === "important") return true;
  if (fallbackKind === "red") return true;
  return /\b(?:positive culture|b\/c|bcx|sputum cx|bile cx|abx|antibiotic|teicoplanin|vancomycin|meropenem|ceftriaxone|levofloxacin|metronidazole|source control|ercp|stent|tap|thoracentesis|paracentesis|procedure|consult|opd|certificate|barrier|discharge tomorrow|restart|hold|apixaban|heparin|warfarin|insulin|pressor|oxygen|crrt|aki|hyperk|hypok|lactate|inr|cr\s*\d|hb\s*\d|plt\s*\d|k\s*\d|wbc\s*\d|ct\b|mri\b|cxr\b|x-?ray|echo\b|sono|ultrasound|egd\b)\b/i.test(line);
}

export function selectPriorityPrintItems(value: string | string[], options: PrintPriorityOptions): PrintLineItem[] {
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
  const unlimited = !Number.isFinite(maxItems);
  const maxChars = options.maxChars ?? 84;
  const decorated = splitPrintInput(value).map((line, index) => {
    const visual = classifyPrintVisualItem({ raw: line, text: displayPrintLine(line) }, options.fallbackKind);
    const required = requiredSignal(line, options.fallbackKind, visual);
    return { line, index, visual, required };
  });

  if (decorated.length === 0) return [];

  const selected = new Set<number>();
  decorated.filter((item) => item.required).forEach((item) => selected.add(item.index));
  decorated
    .filter((item) => !item.required)
    .forEach((item) => {
      if (selected.size < maxItems) selected.add(item.index);
    });

  const hiddenRoutine = decorated.filter((item) => !selected.has(item.index)).length;
  const output: PrintLineItem[] = decorated
    .filter((item) => selected.has(item.index))
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      const text = item.required || unlimited ? displayPrintLine(item.line) : shortPrintText(item.line, maxChars);
      return { raw: text, text };
    })
    .filter((item) => item.text);

  if (hiddenRoutine > 0) {
    output.push({
      raw: `+${hiddenRoutine} routine hidden`,
      text: `+${hiddenRoutine} routine hidden`,
      hidden: true,
    });
  }

  return output;
}

export function isComplexPrintDraft(draft: {
  header: string[];
  sLines: string[];
  oLines: string[];
  apProblems: Array<{ title: string; lines: string[] }>;
  taskLines: string[];
  dcLines: string[];
}) {
  const text = [
    ...draft.header,
    ...draft.sLines,
    ...draft.oLines,
    ...draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...draft.taskLines,
    ...draft.dcLines,
  ].join(" ");
  const imageCount = draft.oLines.filter((line) => /\b(?:image|img|ct|mri|cxr|sono|echo|ercp|egd)\b/i.test(line)).length;
  const highYieldTaskCount = draft.taskLines.filter((line) => {
    const visual = classifyPrintVisualItem({ raw: line, text: displayPrintLine(line) }, "task");
    return visual.tone === "critical" || visual.tone === "important";
  }).length;
  return (
    /\b(?:icu|transfer|sepsis|septic|shock|pressor|norepi|crrt|aki|hyperk|hypok|respiratory failure|hypox|o2|oxygen|nippv|bipap|hfref|anticoag|apixaban|heparin|warfarin|bleed|cholangitis|bacteremia|positive culture|abx|antibiotic|source control)\b/i.test(text) ||
    draft.apProblems.length >= 4 ||
    imageCount >= 2 ||
    highYieldTaskCount >= 3
  );
}
