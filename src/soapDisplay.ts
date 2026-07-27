import { normalizeClinicalDisplayTextPreservingMarks } from "./clinicalLineClassifier";
import { safeClinicalLine, safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";

export interface SoapHeaderDisplayFallbacks {
  dx?: string;
  issues?: string;
  pmh?: string;
}

const HEADER_PREFIX = /^(Dx|Issues|PMH|PHx|Code|Allergy|Isolation|Attending|Date|HD\/POD|Red flags)\s*:\s*/i;
const EMBEDDED_SECTION = /\s+(?=(?:PHx|PMHx|PMH|CC|Chief complaint|PI|HPI|ED(?:\s+(?:Lab|course|treatment))?|Lab|Image|Imaging|Impression|Imp|Assessment|A\/P|AP|Plan|Tasks?|Orders?|Meds?|DC|Discharge|S|O|V\/S|VS|PE)\s*:)/i;
const DIAGNOSIS_PREFIX = /^(?:Dx|Diagnosis|Impression|Imp)\s*:\s*/i;
const LOW_VALUE_PROBLEM = /^(?:problem|active problem|monitoring|disposition|discharge|nutrition|deconditioning|prior|history of|resolved)\b/i;
const DIAGNOSIS_STATUS_SUFFIX = /\s*[,;]\s*(?:active|improving|improved|stable|worsening|resolved|under treatment|on treatment)\s*$/i;
const DIAGNOSIS_TRAJECTORY_TAIL = /\s*(?:[,;]\s*)?\b(?:improving|improved|stable|worsening|resolved)\b(?:\s+(?:on|with|after|s\/p)\b.*)?$/i;

function stripMatchingPrefix(value: string, label: string) {
  return value.replace(new RegExp(`^${label.replace("/", "\\/")}\\s*:\\s*`, "i"), "").trim();
}

function fallbackForLabel(label: string, fallbacks: SoapHeaderDisplayFallbacks) {
  if (/^dx$/i.test(label)) return stripMatchingPrefix(fallbacks.dx ?? "", "Dx");
  if (/^issues$/i.test(label)) return stripMatchingPrefix(fallbacks.issues ?? "", "Issues");
  if (/^(?:pmh|phx)$/i.test(label)) return stripMatchingPrefix(fallbacks.pmh ?? "", "PMH");
  return "";
}

function looksLikeIdentityOnly(value: string) {
  return /^(?:\d{1,3}\/[MF]|\d{1,3}[MF]|[MF]\/?\d{1,3}|\d{1,3}\s*(?:yo|y\/o|\/\s*[MF])?)$/i.test(stripColorMarkup(value).trim());
}

function diagnosisBody(value: string) {
  const normalized = normalizeClinicalDisplayTextPreservingMarks(value)
    .replace(DIAGNOSIS_PREFIX, "")
    .trim();
  const boundary = normalized.search(EMBEDDED_SECTION);
  return (boundary >= 0 ? normalized.slice(0, boundary) : normalized)
    .replace(/^\s*(?:\d{1,3}\/[MF]|\d{1,3}[MF]|[MF]\/?\d{1,3}|\d{1,3}\s*(?:yo|y\/o))\s*[:|,-]?\s*/i, "")
    .replace(DIAGNOSIS_STATUS_SUFFIX, "")
    .replace(DIAGNOSIS_TRAJECTORY_TAIL, "")
    .replace(/^[#\s]+/, "")
    .replace(/[.;,|\s]+$/, "")
    .trim();
}

function diagnosisTokens(value: string) {
  const normalizedConcepts = stripColorMarkup(value)
    .toLowerCase()
    .replace(/\b(?:cap|hap|vap|pna|pneumonia)\b/g, " pneumonia ")
    .replace(/\b(?:chf|hf|heart failure)\b/g, " heartfailure ")
    .replace(/\b(?:aki|acute kidney injury)\b/g, " aki ")
    .replace(/\b(?:ckd|chronic kidney disease)\b/g, " ckd ")
    .replace(/\b(?:rf|respiratory failure)\b/g, " respiratoryfailure ");
  return new Set(
    normalizedConcepts
      .match(/[a-z][a-z0-9+/-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? [],
  );
}

function similarDiagnosis(left: string, right: string) {
  const a = diagnosisTokens(left);
  const b = diagnosisTokens(right);
  if (a.size === 0 || b.size === 0) return false;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.min(a.size, b.size) >= 0.65;
}

function compactDiagnosisCandidate(value: string, maxChars = 76) {
  const body = diagnosisBody(value);
  if (!body || LOW_VALUE_PROBLEM.test(body)) return "";
  if (body.length <= maxChars) return body;
  const clause = body.split(/\s*[;|]\s*|\.\s+/)[0]?.trim() ?? body;
  if (clause.length <= maxChars) return clause;
  return safeClinicalLine(clause, maxChars);
}

function diagnosisLooksPolluted(value: string) {
  const plain = stripColorMarkup(value);
  return (
    plain.length > 115 ||
    EMBEDDED_SECTION.test(plain) ||
    /\b(?:attending|chief complaint|hospital course|ed course|v\/s|spo2|wbc|hb|plt|cr|bun|cxr|ct|mri)\s*:/i.test(plain) ||
    (plain.match(/[.!?]/g) ?? []).length > 1
  );
}

export function conciseSoapDiagnosisForDisplay(params: {
  headerLines?: string[];
  apTitles?: string[];
  fallbacks?: string[];
  maxItems?: number;
  maxChars?: number;
}) {
  const maxItems = params.maxItems ?? 2;
  const maxChars = params.maxChars ?? 110;
  const explicitDx = (params.headerLines ?? [])
    .filter((line) => DIAGNOSIS_PREFIX.test(normalizeClinicalDisplayTextPreservingMarks(line)))
    .map(diagnosisBody)
    .filter((line) => line && !diagnosisLooksPolluted(line));
  const apTitles = (params.apTitles ?? [])
    .map((line) => compactDiagnosisCandidate(line))
    .filter(Boolean);
  const fallbacks = (params.fallbacks ?? [])
    .map((line) => compactDiagnosisCandidate(line))
    .filter((line) => line && !diagnosisLooksPolluted(line));

  const selected: string[] = [];
  [...explicitDx, ...apTitles, ...fallbacks].forEach((candidate) => {
    if (selected.length >= maxItems) return;
    const compact = compactDiagnosisCandidate(candidate);
    if (!compact || selected.some((existing) => similarDiagnosis(existing, compact))) return;
    const projected = [...selected, compact].join(" | ");
    if (projected.length > maxChars && selected.length > 0) return;
    selected.push(compact);
  });
  return selected.join(" | ");
}

/**
 * Display-only cleanup for canonical SOAP headers. A malformed AI one-liner can
 * contain an entire admission note ("Dx: ... PHx: ... CC: ..."). Keep the
 * persisted reviewed SOAP untouched, but never let that spill into Board or
 * Print. A concise digest fallback is preferred when one is available.
 */
export function soapHeaderLinesForDisplay(
  lines: string[],
  fallbacks: SoapHeaderDisplayFallbacks = {},
  options: { maxLines?: number; maxChars?: number } = {},
) {
  const maxLines = options.maxLines ?? 6;
  const maxChars = options.maxChars ?? 130;
  const seen = new Set<string>();
  const result: string[] = [];

  lines.forEach((rawLine) => {
    if (result.length >= maxLines) return;
    const normalized = normalizeClinicalDisplayTextPreservingMarks(rawLine);
    if (!normalized) return;
    const prefix = normalized.match(HEADER_PREFIX);
    let display = normalized;

    if (prefix) {
      const label = prefix[1];
      const body = normalized.slice(prefix[0].length).trim();
      const boundary = body.search(EMBEDDED_SECTION);
      const polluted = boundary >= 0 || (/^dx$/i.test(label) && diagnosisLooksPolluted(body));
      const isolated = polluted ? body.slice(0, boundary).trim() : body;
      const fallback = fallbackForLabel(label, fallbacks);
      const nextBody = fallback && (/^dx$/i.test(label) || polluted || !isolated || looksLikeIdentityOnly(isolated))
        ? fallback
        : isolated;
      if (!nextBody) return;
      const canonicalLabel = /^phx$/i.test(label) ? "PMH" : label;
      display = `${canonicalLabel}: ${nextBody}`;
    } else if (!looksLikeIdentityOnly(normalized)) {
      // Header lines must be identity or an explicit clinical header. Free-form
      // admission prose belongs in S/O/A/P and must never spill into Board/Print.
      return;
    }

    display = safeClinicalLinePreservingMarks(display, maxChars).trim();
    if (!display) return;
    const key = stripColorMarkup(display).replace(/\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(display);
  });

  return result;
}

/** Remove legacy inline severity markers after punctuation without touching the source text. */
export function cleanInlineClinicalMarkers(value: string) {
  return normalizeClinicalDisplayTextPreservingMarks(value)
    .replace(/(^|[:;,/])\s*!{1,2}\s+(?=\S)/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
