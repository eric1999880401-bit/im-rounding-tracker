import { stripClinicalMarkup } from "./clinicalLineClassifier";
import { findLabDictionaryItem } from "./data/labDictionary";

export type ObjectiveLineKind = "vs" | "pe" | "lab" | "image" | "other";

export interface SanitizedObjectiveLine {
  original: string;
  text: string;
  kind: ObjectiveLineKind;
}

const objectivePrefixPattern = /^(?:O|Objective|Other|V\/S|VS|Vitals?|PE|Physical exam|Labs?|Image|Img)\s*[:\uFF1A]\s*/i;
const explicitObjectivePrefixPattern = /^(V\/S|VS|Vitals?|PE|Physical exam|Labs?|Image|Img)\s*[:\uFF1A]\s*/i;
const labLabelPattern = /\b(?:WBC|Neu|Neut|Lym|Mono|Eos|Baso|NRBC|RBC|Hb|Hgb|Hct|MCV|MCH|MCHC|RDW|Plt|Platelet|MPV|MDW|BUN|Cr|CRE|Creatinine|e?GFR|Na|K|Cl|Ca|Mg|Phos|P|Osm|AST|ALT|ALP|GGT|T-?Bil|D-?Bil|Alb|PT|INR|aPTT|CRP|hsCRP|PCT|Lactate|pH|pCO2|pO2|HCO3|BE)\b/gi;
const labResultPattern = /\b(?:WBC|Neu|Neut|Lym|Mono|Eos|Baso|NRBC|RBC|Hb|Hgb|Hct|MCV|MCH|MCHC|RDW|Plt|Platelet|MPV|MDW|BUN|Cr|CRE|Creatinine|e?GFR|Na|K|Cl|Ca|Mg|Phos|P|Osm|AST|ALT|ALP|GGT|T-?Bil|D-?Bil|Alb|PT|INR|aPTT|CRP|hsCRP|PCT|Lactate|pH|pCO2|pO2|HCO3|BE)\s*(?:[:=]\s*)?[<>]?\s*-?\d+(?:\.\d+)?/i;
const positionalLabValuePattern = /^[<>]?-?\d+(?:,\d{3})*(?:\.\d+)?%?(?:\*+|[HL]|[\u2191\u2193\u2197\u2198])?$/i;
const compactBloodGasPattern = /\b(ABG|VBG)\s*[:=]?\s*([<>]?-?\d+(?:\.\d+)?)\s*\/\s*([<>]?-?\d+(?:\.\d+)?)\s*\/\s*([<>]?-?\d+(?:\.\d+)?)\s*\/\s*([<>]?-?\d+(?:\.\d+)?)(?:\s*\/\s*([<>]?-?\d+(?:\.\d+)?))?/i;

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
    compactBloodGasPattern.test(body) ||
    labResultPattern.test(body) ||
    /\b(?:blood|urine|sputum|CSF|stool)\s*(?:culture|Cx)\b|\b(?:B\/C|BCx|U\/C|UCx)\b/i.test(body) ||
    /\b(?:stool\s*)?(?:O\s*&\s*P|O\/P|occult blood|FOBT|C\.?\s*difficile|C\.?\s*diff)\b/i.test(body)
  ) return "lab";
  if (/\b(?:conscious|alert|clear breath|crackles|wheez|murmur|tender|edema|jaundice|abd(?:omen|ominal)|bowel sounds?|motor|strength)\b/i.test(body)) return "pe";
  return "";
}

export function normalizeCompactBloodGasLine(value: string) {
  const line = String(value ?? "").trim();
  const match = line.match(compactBloodGasPattern);
  if (!match) return line;
  const prefix = line.slice(0, match.index ?? 0).trim();
  const suffix = line.slice((match.index ?? 0) + match[0].length).replace(/^[\s,;:.]+/, "").trim();
  const values = [
    `pH ${match[2]}`,
    `pCO2 ${match[3]}`,
    `pO2 ${match[4]}`,
    `HCO3 ${match[5]}`,
    match[6] ? `BE ${match[6]}` : "",
  ].filter(Boolean).join(", ");
  return [prefix, `${match[1].toUpperCase()}: ${values}`, suffix].filter(Boolean).join(" ");
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
  const positionalColumns = hasHeaderCue ? positionalLabColumns(body) : [];
  const recognizedColumns = positionalColumns.filter((column) => column.label).length;
  const analyteTokens = positionalColumns.filter((column) => /[A-Za-z]/.test(column.raw) && !/^20\d{2}[-/]/.test(column.raw)).length;
  return (hasHeaderCue && recognizedColumns >= 2 && analyteTokens >= 2) || (labels.size >= 8 && resultCount < Math.ceil(labels.size * 0.5));
}

interface PositionalLabColumn {
  raw: string;
  label: string;
}

function positionalLabHeaderTokens(value: string) {
  const body = plainObjectiveBody(value);
  const withoutCue = body
    .replace(/^.*?(?:\u5831\u544a\u6642\u9593|\u6aa2\u9a57\u9805\u76ee|report\s*time|reported\s*at|test\s*name|analyte)\s*[:\uFF1A]?\s*/i, "")
    .trim();
  const tokens = (withoutCue.includes("\t") ? withoutCue.split("\t") : withoutCue.split(/\s+/))
    .map((token) => token.replace(/^[,;:]+|[,;:]+$/g, "").trim())
    // Empty tab cells are real table columns and must retain their position.
    .filter((token) => withoutCue.includes("\t") || Boolean(token));
  while (/^(?:CBC(?:\/DC)?|DC|hematology|chemistry|biochemistry|renal|electrolytes?|coagulation|\u8840\u6db2|\u751f\u5316|\u8840\u6e05|\u51dd\u8840|\u5c3f\u6db2)$/i.test(tokens[0] ?? "")) {
    tokens.shift();
  }
  return tokens;
}

function positionalLabColumns(value: string): PositionalLabColumn[] {
  return positionalLabHeaderTokens(value).map((raw) => {
    if (!raw || /^(?:flag|abn|abnormal|unit|units?|ref|reference|range|status|comment|note|\u55ae\u4f4d|\u53c3\u8003\u503c|\u7570\u5e38|\u5099\u8a3b)$/i.test(raw)) {
      return { raw, label: "" };
    }
    const dictionary = findLabDictionaryItem(raw);
    const fallback = canonicalLabLabels[raw.toLowerCase()] ?? "";
    const generic = /^[A-Za-z][A-Za-z0-9.+/%_-]{0,23}$/.test(raw) ? raw.replace(/\.$/, "") : "";
    return { raw, label: dictionary?.displayName || fallback || generic };
  });
}

function positionalLabRow(value: string, columns: PositionalLabColumn[]) {
  const body = plainObjectiveBody(value);
  const date = body.match(/^\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/)?.[1] ?? "";
  const tabDelimited = body.includes("\t");
  const afterDate = date ? body.slice(body.indexOf(date) + date.length) : body;
  // Remove the date-column delimiter, but preserve an immediately following
  // empty tab cell because it represents a missing result for column 1.
  let withoutDate = tabDelimited
    ? afterDate.replace(/^[ ]+/, "").replace(/^\t/, "")
    : afterDate.replace(/^\s+\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim();
  let rawTokens = tabDelimited
    ? withoutDate.split("\t").map((token) => token.trim())
    : withoutDate.split(/\s+/).filter(Boolean);
  if (tabDelimited && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(rawTokens[0] ?? "")) rawTokens = rawTokens.slice(1);
  const tokens: string[] = [];
  rawTokens.forEach((token) => {
    if (!tabDelimited && /^(?:\*+|[HL]|[\u2191\u2193\u2197\u2198])$/i.test(token) && tokens.length > 0) {
      tokens[tokens.length - 1] += token;
      return;
    }
    tokens.push(token);
  });
  const numericCount = tokens.filter((token) => positionalLabValuePattern.test(token)).length;
  if (columns.length < 2 || numericCount < (tabDelimited ? 1 : 2)) return "";
  if (!tabDelimited && numericCount < Math.min(columns.length, tokens.length) * 0.5) return "";
  // Space-delimited exports cannot represent empty cells. If the counts do
  // not match, positional assignment would silently shift every later value.
  // Reject that ambiguous row rather than display a confidently wrong lab.
  if (!tabDelimited && tokens.length !== columns.length) return "";

  const items = columns.flatMap((column, index) => {
    const label = column.label;
    const rawValue = tokens[index] ?? "";
    if (!label || !positionalLabValuePattern.test(rawValue)) return [];
    const markedAbnormal = /\*|[HL\u2191\u2193\u2197\u2198]$/i.test(rawValue);
    const cleanValue = rawValue.replace(/\*+|[HL\u2191\u2193\u2197\u2198]$/gi, "");
    return cleanValue ? [`${label} ${cleanValue}${markedAbnormal ? "*" : ""}`] : [];
  });
  if (items.length < (tabDelimited ? 1 : 2)) return "";
  return `${date ? `${date} ` : ""}${items.join(", ")}`.trim();
}

function isLabTableSectionHeading(value: string) {
  const body = plainObjectiveBody(value);
  const match = body.match(/^\[([^\]]{1,32})\]$/);
  if (!match) return false;
  return /(?:\u8840\u6db2|\u751f\u5316|\u8840\u6e05|\u51dd\u8840|\u5c3f\u6db2|\u514d\u75ab|CBC|hematology|chemistry|coagulation|urine|immunology|lab)/i.test(match[1]);
}

function isLabTableMetadataRow(value: string) {
  const body = plainObjectiveBody(value);
  if (/^(?:\u55ae\u4f4d|units?|reference(?:\s+range)?|normal\s+range|ref\.?)(?:\s|:|\uFF1A|$)/i.test(body)) return true;
  const tokens = body.split(/\s+/).filter(Boolean);
  const unitLike = tokens.filter((token) =>
    /^(?:%|(?:10\^?\d+|x10\^?\d+)\/\S+|(?:mL|min|sec|s|U|IU|g|mg|ug|ng|pg|mmol|umol|mEq)(?:\/\S+)+)$/i.test(token),
  ).length;
  return tokens.length >= 2 && unitLike >= 2 && unitLike >= Math.ceil(tokens.length * 0.6);
}

function datedLabRowSortKey(value: string) {
  const match = plainObjectiveBody(value).match(/^\s*(?:(20\d{2})[-/])?(\d{1,2})[-/](\d{1,2})\b/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1] ?? 0);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year * 10000 + month * 100 + day;
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
  let pendingColumns: PositionalLabColumn[] = [];
  let pendingRows: string[] = [];

  const flushPendingRows = () => {
    accepted.push(...pendingRows.sort((left, right) => datedLabRowSortKey(right) - datedLabRowSortKey(left)));
    pendingRows = [];
  };

  String(value ?? "").split(/\r?\n/).forEach((rawLine) => {
    const line = normalizeCompactBloodGasLine(rawLine.trim());
    if (!line) return;
    if (isLabTableSectionHeading(line)) {
      rejected.push(line);
      return;
    }
    if (isLabReportHeaderNoise(line)) {
      flushPendingRows();
      pendingColumns = positionalLabColumns(line);
      rejected.push(line);
      return;
    }
    if (pendingColumns.length > 0) {
      if (isLabTableMetadataRow(line)) {
        rejected.push(line);
        return;
      }
      const reconstructed = positionalLabRow(line, pendingColumns);
      if (reconstructed) {
        pendingRows.push(reconstructed);
        return;
      }
      if (isLabReportValueRowNoise(line)) {
        rejected.push(line);
        return;
      }
      flushPendingRows();
      pendingColumns = [];
    }
    if (isLabReportValueRowNoise(line)) {
      rejected.push(line);
      return;
    }
    accepted.push(line);
  });

  flushPendingRows();

  return { text: accepted.join("\n"), lines: accepted, rejected };
}

// Older reviewed notes may already contain pasted LIS/HIS table metadata.
// Normalize only the Objective lines used by the editor/display path: pure
// headers disappear, while positional result rows are reconstructed. Nothing
// is written back until the clinician explicitly saves the reviewed SOAP.
export function normalizeObjectiveLabExportLines(lines: string[]) {
  if (lines.length === 0) return [];
  return normalizeLabTableSourceText(lines.join("\n")).lines;
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
