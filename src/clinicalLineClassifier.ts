export type ClinicalLineTone = "critical" | "important" | "info" | "plain";

export type ClinicalLineKind =
  | "s"
  | "vs"
  | "pe"
  | "lab"
  | "image"
  | "ap"
  | "task"
  | "dc"
  | "red"
  | "header"
  | "other";

interface ClassifyClinicalLineOptions {
  fallbackKind?: ClinicalLineKind;
  explicitTone?: ClinicalLineTone;
  lockKind?: boolean;
}

export interface ClassifiedClinicalLine {
  kind: ClinicalLineKind;
  label: string;
  tone: ClinicalLineTone;
  text: string;
}

const kindLabels: Record<ClinicalLineKind, string> = {
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "LAB",
  image: "IMG",
  ap: "A/P",
  task: "TASK",
  dc: "DC",
  red: "RED",
  header: "INFO",
  other: "NOTE",
};

export function stripClinicalMarkup(value: string) {
  return String(value ?? "")
    .replace(/\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi, "$2")
    .replace(/^!!+\s*/, "")
    .replace(/^!+\s*/, "")
    .replace(/^\*\s*/, "")
    .trim();
}

export function normalizeClinicalDisplayText(value: string) {
  return stripClinicalMarkup(value)
    .replace(/^(Lab:\s*)!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "$1")
    .replace(/^!?\s*(?:crit|critical|abn|abnormal|trend|anchor)\s+(?:infx|infection|lyte\/renal|renal\/lyte|anemia|heme|cardio|cardiac|liver|gi|nutrition|onc|tumor|glucose|endocrine|coag|other)\s*:\s*/i, "")
    .replace(/^\s*(?:critical|urgent)\s*:\s*/i, "* ")
    .replace(/\[\s*URGENT\s*\]\s*/gi, "* ")
    .replace(/\bhigh-normal\b/gi, "\u2197 nl")
    .replace(/\blow-normal\b/gi, "\u2198 nl")
    .replace(/\bhigh\b/gi, "\u2191")
    .replace(/\blow\b/gi, "\u2193")
    .replace(/\s+/g, " ")
    .trim();
}

function prefixedKind(value: string, fallbackKind: ClinicalLineKind) {
  const match = stripClinicalMarkup(value).match(/^(S|V\/S|VS|Vitals?|PE|Physical exam|Lab|Image|Img|Task|Tasks|DC|Discharge|Prep)\s*:\s*(.*)$/i);
  if (!match) return { kind: fallbackKind, body: stripClinicalMarkup(value) };

  const label = match[1].toLowerCase();
  const body = match[2].trim();
  if (label === "s") return { kind: "s" as const, body };
  if (label === "v/s" || label === "vs" || label.startsWith("vital")) return { kind: "vs" as const, body };
  if (label === "pe" || label.startsWith("physical")) return { kind: "pe" as const, body };
  if (label === "lab") return { kind: "lab" as const, body };
  if (label === "image" || label === "img") return { kind: "image" as const, body };
  if (label === "task" || label === "tasks") return { kind: "task" as const, body };
  if (label === "dc" || label === "discharge" || label === "prep") return { kind: "dc" as const, body };
  return { kind: fallbackKind, body };
}

function inferredKind(text: string, fallbackKind: ClinicalLineKind) {
  const prefixed = prefixedKind(text, fallbackKind);
  if (prefixed.kind !== fallbackKind || prefixed.body !== stripClinicalMarkup(text)) return prefixed;
  const body = prefixed.body;
  if (/\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(body)) return { kind: "vs" as const, body };
  if (/\b(wbc|hb|hgb|plt|cr|bun|na|k\b|ca|mg|phos|lactate|crp|pct|inr|pt|aptt|culture|b\/c|bcx)\b/i.test(body)) {
    return { kind: "lab" as const, body };
  }
  if (/\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|egd|scope|image|impression)\b/i.test(body)) {
    return { kind: "image" as const, body };
  }
  return prefixed;
}

function explicitTone(value: string): ClinicalLineTone | null {
  const trimmed = String(value ?? "").trim();
  if (/^!!/.test(trimmed) || /^\[\[red:/i.test(trimmed)) return "critical";
  if (/^!/.test(trimmed) || /^\*\s+/.test(trimmed) || /^\[\[orange:/i.test(trimmed)) return "important";
  if (/^\[\[blue:/i.test(trimmed)) return "info";
  return null;
}

function criticalSignal(text: string, kind: ClinicalLineKind) {
  return (
    /\b(shock|sepsis|septic|hypotension|desat|hypox|active bleed|melena|hematemesis|stroke|ich|neutropenic fever|positive culture|b\/c|bcx|mrsa|enterococcus)\b/i.test(text) ||
    /\b(lactate\s*(?:[4-9]|\d{2,})|troponin\s*(?:\+|positive|elevated)|inr\s*(?:[3-9]|\d{2,}))\b/i.test(text) ||
    (kind === "lab" && /\b(k\s*(?:[0-2](?:\.\d+)?|[6-9](?:\.\d+)?)|hb\s*(?:[0-7](?:\.\d+)?)|na\s*(?:1[01]\d|[0-9]\d)|wbc\s*(?:[2-9]\d|[0-2](?:\.\d+)?)|plt\s*(?:[0-4]\d)|cr\s*(?:[2-9](?:\.\d+)?|\d{2,}))\b/i.test(text)) ||
    (kind === "vs" && /\b(bp\s*[5-8]\d\/|spo2\s*[0-8]\d|rr\s*[3-9]\d|t\s*3[89]\.|hr\s*1[3-9]\d)\b/i.test(text))
  );
}

function importantSignal(text: string, kind: ClinicalLineKind) {
  return (
    /\b(teicoplanin|vancomycin|cefepime|ceftriaxone|cefazolin|zosyn|pip\/tazo|meropenem|ertapenem|levofloxacin|abx|antibiotic|culture|pending|f\/u|repeat|consult|source control|biopsy|operation|surgery|thoracentesis|paracentesis|tap|drain|j-tube|ng|dc|discharge|opd|certificate|placement)\b/i.test(text) ||
    (kind === "image" && /\b(effusion|chylothorax|tumou?r|mass|metasta|obstruction|perforation|infarct|stenosis|pneumonia|abscess|edema)\b/i.test(text)) ||
    (kind === "task" || kind === "dc")
  );
}

export function classifyClinicalLine(value: string, options: ClassifyClinicalLineOptions = {}): ClassifiedClinicalLine {
  const fallbackKind = options.fallbackKind ?? "other";
  const source = String(value ?? "").trim();
  const inferred = inferredKind(source, fallbackKind);
  const kind = options.lockKind ? fallbackKind : inferred.kind;
  const signalKind = inferred.kind;
  const displayText = normalizeClinicalDisplayText((options.lockKind ? stripClinicalMarkup(source) : inferred.body) || source);
  const forcedTone = options.explicitTone ?? explicitTone(source);
  const critical = fallbackKind === "red" || criticalSignal(source, signalKind);
  const important = importantSignal(source, signalKind);
  const tone =
    forcedTone === "critical" || critical
      ? "critical"
      : forcedTone === "important" || important
        ? "important"
        : forcedTone === "info"
          ? "info"
        : "plain";

  return {
    kind,
    label: kindLabels[kind],
    tone,
    text: displayText || normalizeClinicalDisplayText(source),
  };
}
