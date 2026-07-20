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
  if (!body || labResultPattern.test(body)) return false;
  const labels = new Set([...body.matchAll(new RegExp(labLabelPattern.source, "gi"))].map((match) => match[0].toLowerCase()));
  const hasHeaderCue = /(?:\u5831\u544a\u6642\u9593|\u6aa2\u9a57\u9805\u76ee|report\s*time|reported\s*at|test\s*name|analyte|reference\s*range)/i.test(body);
  return (hasHeaderCue && labels.size >= 3) || labels.size >= 8;
}

export function sanitizeObjectiveLines(lines: string[]) {
  const accepted: SanitizedObjectiveLine[] = [];
  const rejected: string[] = [];
  lines.forEach((line) => {
    const original = String(line ?? "").trim();
    if (!original) return;
    if (isLabReportHeaderNoise(original)) {
      rejected.push(original);
      return;
    }
    const text = stripRepeatedObjectivePrefixes(original);
    if (!text) return;
    accepted.push({ original, text, kind: objectiveKindFromLine(original) });
  });
  return { accepted, rejected };
}

export function prefixedObjectiveLine(line: Pick<SanitizedObjectiveLine, "text" | "kind">) {
  const tone = tonePrefix(line.text);
  const body = withoutTone(line.text);
  const prefix = line.kind === "vs" ? "V/S" : line.kind === "pe" ? "PE" : line.kind === "lab" ? "Lab" : line.kind === "image" ? "Image" : "";
  return prefix ? `${tone}${prefix}: ${body}`.trim() : `${tone}${body}`.trim();
}
