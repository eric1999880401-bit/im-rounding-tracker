import { stripClinicalMarkup } from "./clinicalLineClassifier";

export type ObjectiveLineKind = "vs" | "pe" | "lab" | "image" | "other";

export interface SanitizedObjectiveLine {
  original: string;
  text: string;
  kind: ObjectiveLineKind;
}

const objectivePrefixPattern = /^(?:O|Objective|Other|V\/S|VS|Vitals?|PE|Physical exam|Labs?|Image|Img)\s*[:\uFF1A]\s*/i;
const explicitObjectivePrefixPattern = /^(V\/S|VS|Vitals?|PE|Physical exam|Labs?|Image|Img)\s*[:\uFF1A]\s*/i;
const labLabelPattern = /\b(?:WBC|Neu|Neut|Lym|Mono|Eos|Baso|NRBC|RBC|Hb|Hgb|Hct|MCV|MCH|MCHC|RDW|Plt|Platelet|MPV|MDW|BUN|Cr|CRE|Creatinine|e?GFR|Na|K|Cl|Ca|Mg|Phos|P|Osm|AST|ALT|ALP|GGT|T-?Bil|D-?Bil|Alb|PT|INR|aPTT|CRP|hsCRP|PCT|Lactate)\b/gi;
const labResultPattern = /\b(?:WBC|Neu|Neut|Lym|Mono|Eos|Baso|NRBC|RBC|Hb|Hgb|Hct|MCV|MCH|MCHC|RDW|Plt|Platelet|MPV|MDW|BUN|Cr|CRE|Creatinine|e?GFR|Na|K|Cl|Ca|Mg|Phos|P|Osm|AST|ALT|ALP|GGT|T-?Bil|D-?Bil|Alb|PT|INR|aPTT|CRP|hsCRP|PCT|Lactate)\s*(?:[:=]\s*)?[<>]?\s*-?\d+(?:\.\d+)?/i;
const positionalLabValuePattern = /^[<>]?-?\d+(?:,\d{3})*(?:\.\d+)?%?(?:\*+|[HL])?$/i;

const canonicalLabLabels: Record<string, string> = {
  neut: "Neu",
  hgb: "Hb",
  platelet: "Plt",
  cre: "Cr",
  creatinine: "Cr",
  gfr: "eGFR",
  egfr: "eGFR",
  phos: "P",
  crp: "CRP",
  hscrp: "hsCRP",
};

function withoutTone(value: string) {
  return String(value ?? "").trim().replace(/^!!?\s*/, "").replace(/^\*\s+/, "").trim();
}

function tonePrefix(value: string) {
  const match = String(value ?? "").trim().match(/^(!!?|\*)\s*/);
  if (!match) return "";
  return match[1] === "!!" ? "!! " : "! ";
}

function plainObjectiveBody(value: string) {
  let next = withoutTone(stripClinicalMarkup(value));
  for (let index = 0; index < 6; index += 1) {
    const stripped = next.replace(objectivePrefixPattern, "").trim();
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

export function stripRepeatedObjectivePrefixes(value: string) {
  let body = withoutTone(value);
  for (let index = 0; index < 6; index += 1) {
    const stripped = body.replace(objectivePrefixPattern, "").trim();
    if (stripped === body) break;
    body = stripped;
  }
  return `${tonePrefix(value)}${body}`.trim();
}

function explicitObjectiveKind(value: string): ObjectiveLineKind | "" {
  const match = withoutTone(stripClinicalMarkup(value)).match(explicitObjectivePrefixPattern);
  const label = String(match?.[1] ?? "").toLowerCase();
  if (!label) return "";
  if (label === "v/s" || label === "vs" || label.startsWith("vital")) return "vs";
  if (label === "pe" || label.startsWith("physical")) return "pe";
  if (label.startsWith("lab")) return "lab";
  if (label === "image" || label === "img") return "image";
  return "";
}

function contentObjectiveKind(body: string): ObjectiveLineKind | "" {
  if (isPathologyResultLine(body)) return "other";
  if (/\b(?:CT|MRI|CXR|X-?ray|echo|sono|ultrasound|US|ERCP|EGD|colonoscopy|bronchoscopy|PET)\b|\bimpression\s*:/i.test(body)) return "image";
  if (/\b(?:BP|HR|RR|SpO2|SaO2)\s*[:=]?\s*\d|\bT\s*[:=]?\s*\d{2}(?:\.\d+)?|\b(?:afebrile|room air|RA|nasal cannula|NC\s*\d*\s*L)\b/i.test(body)) return "vs";
  if (
    labResultPattern.test(body) ||
    /\b(?:blood|urine|sputum|CSF|stool)\s*(?:culture|Cx)\b|\b(?:B\/C|BCx|U\/C|UCx)\b/i.test(body) ||
    /\b(?:stool\s*)?(?:O\s*&\s*P|O\/P|occult blood|FOBT|C\.?\s*difficile|C\.?\s*diff)\b/i.test(body)
  ) return "lab";
  if (/\b(?:conscious|alert|clear breath|crackles|wheez|murmur|tender|edema|jaundice|abd(?:omen|ominal)|bowel sounds?|motor|strength)\b/i.test(body)) return "pe";
  return "";
}

export function isPathologyResultLine(value: string) {
  const body = plainObjectiveBody(value);
  const explicitReport = /\b(?:final\s+)?(?:pathology|histology|cytology|IHC|immunohistochem\w*)\b|\bbiopsy\s*(?:result|report|pathology)\b/i.test(body);
  const biopsyDiagnosis = /\bbiopsy\b/i.test(body) && /\b(?:adenocarcinoma|squamous(?:\s+cell)?\s+carcinoma|carcinoma|malignan\w*|lymphoma|dysplasia|benign|negative\s+for\s+malignancy|consistent\s+with)\b/i.test(body);
  return explicitReport || biopsyDiagnosis;
}

export function normalizeLegacyLabTrendSyntax(value: string) {
  return String(value ?? "").replace(
    /(\b[A-Za-z][A-Za-z0-9./-]{0,15}\s+)(-?\d+(?:\.\d+)?%?)\s*\((-?\d+(?:\.\d+)?%?)\)\s*([\u2191\u2193])(?:\((-?\d+(?:\.\d+)?%?)\))?/g,
    (full, label: string, current: string, previous: string, arrow: string, repeatedPrevious?: string) => {
      if (repeatedPrevious && repeatedPrevious.replace(/%$/, "") !== previous.replace(/%$/, "")) return full;
      return `${label}${current}${arrow}(${previous})`;
    },
  );
}

export function objectiveKindFromLine(value: string, fallback: ObjectiveLineKind = "other"): ObjectiveLineKind {
  const body = plainObjectiveBody(value);
  const explicit = explicitObjectiveKind(value);
  const content = contentObjectiveKind(body);
  // Clear content evidence wins over an incorrect AI prefix (for example,
  // "Image: Blood Cx ..." or "PE: stool O&P negative").
  return content || explicit || fallback;
}

export function isLabReportHeaderNoise(value: string) {
  const body = plainObjectiveBody(value);
  if (!body) return false;
  const labels = new Set([...body.matchAll(new RegExp(labLabelPattern.source, "gi"))].map((match) => match[0].toLowerCase()));
  const resultCount = [...body.matchAll(new RegExp(labResultPattern.source, "gi"))].length;
  const hasHeaderCue = /(?:\u5831\u544a\u6642\u9593|\u6aa2\u9a57\u9805\u76ee|report\s*time|reported\s*at|test\s*name|analyte|reference\s*range)/i.test(body);
  if (resultCount >= Math.max(2, Math.ceil(labels.size * 0.5))) return false;
  return (hasHeaderCue && labels.size >= 3) || (labels.size >= 8 && resultCount < Math.ceil(labels.size * 0.5));
}

function positionalLabLabels(value: string) {
  const body = plainObjectiveBody(value);
  return [...body.matchAll(new RegExp(labLabelPattern.source, "gi"))].map((match) => {
    const raw = match[0];
    return canonicalLabLabels[raw.toLowerCase()] ?? raw;
  });
}

function positionalLabRow(value: string, labels: string[]) {
  const body = plainObjectiveBody(value);
  const date = body.match(/^\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/)?.[1] ?? "";
  const withoutDate = date
    ? body.slice(body.indexOf(date) + date.length).replace(/^\s+\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim()
    : body;
  const rawTokens = withoutDate.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  rawTokens.forEach((token) => {
    if (/^\*+$/.test(token) && tokens.length > 0) {
      tokens[tokens.length - 1] += token;
      return;
    }
    tokens.push(token);
  });
  const numericCount = tokens.filter((token) => positionalLabValuePattern.test(token)).length;
  if (labels.length < 2 || numericCount < 2 || numericCount < Math.min(labels.length, tokens.length) * 0.5) return "";

  const items = labels.flatMap((label, index) => {
    const rawValue = tokens[index] ?? "";
    if (!positionalLabValuePattern.test(rawValue)) return [];
    const markedAbnormal = /\*|[HL]$/i.test(rawValue);
    const cleanValue = rawValue.replace(/\*+/g, "");
    return cleanValue ? [`${label} ${cleanValue}${markedAbnormal ? "*" : ""}`] : [];
  });
  if (items.length < 2) return "";
  return `${items.some((item) => /\*$/.test(item)) ? "! " : ""}${date ? `${date} ` : ""}${items.join(", ")}`.trim();
}

export function isLabReportValueRowNoise(value: string) {
  const body = plainObjectiveBody(value);
  if (!/^\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/.test(body)) return false;
  if (labResultPattern.test(body) || /\b(?:BP|HR|RR|SpO2|SaO2|CT|MRI|CXR|culture|Cx)\b/i.test(body)) return false;
  const withoutDate = body.replace(/^\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/, "").trim();
  return withoutDate.split(/\s+/).filter((token) => positionalLabValuePattern.test(token)).length >= 3;
}

export function normalizeLabTableSourceText(value: string) {
  const accepted: string[] = [];
  const rejected: string[] = [];
  let pendingLabels: string[] = [];

  String(value ?? "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (isLabReportHeaderNoise(line)) {
      pendingLabels = positionalLabLabels(line);
      rejected.push(line);
      return;
    }
    if (pendingLabels.length > 0) {
      const reconstructed = positionalLabRow(line, pendingLabels);
      pendingLabels = [];
      if (reconstructed) {
        accepted.push(reconstructed);
        return;
      }
    }
    if (isLabReportValueRowNoise(line)) {
      rejected.push(line);
      return;
    }
    accepted.push(line);
  });

  return { text: accepted.join("\n"), lines: accepted, rejected };
}

export function sanitizeObjectiveLines(lines: string[]) {
  const accepted: SanitizedObjectiveLine[] = [];
  const rejected: string[] = [];
  lines.forEach((line) => {
    const original = String(line ?? "").trim();
    if (!original) return;
    if (isLabReportHeaderNoise(original) || isLabReportValueRowNoise(original)) {
      rejected.push(original);
      return;
    }
    const kind = objectiveKindFromLine(original);
    const stripped = stripRepeatedObjectivePrefixes(original);
    const text = kind === "lab" ? normalizeLegacyLabTrendSyntax(stripped) : stripped;
    if (!text) return;
    accepted.push({ original, text, kind });
  });
  return { accepted, rejected };
}

export function prefixedObjectiveLine(line: Pick<SanitizedObjectiveLine, "text" | "kind">) {
  const tone = tonePrefix(line.text);
  const body = withoutTone(line.text);
  const prefix = line.kind === "vs" ? "V/S" : line.kind === "pe" ? "PE" : line.kind === "lab" ? "Lab" : line.kind === "image" ? "Image" : "";
  return prefix ? `${tone}${prefix}: ${body}`.trim() : `${tone}${body}`.trim();
}
