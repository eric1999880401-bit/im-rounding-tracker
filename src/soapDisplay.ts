import { normalizeClinicalDisplayTextPreservingMarks } from "./clinicalLineClassifier";
import { safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";

export interface SoapHeaderDisplayFallbacks {
  dx?: string;
  issues?: string;
  pmh?: string;
}

const HEADER_PREFIX = /^(Dx|Issues|PMH|PHx|Code|Allergy|Isolation|Attending|Date|HD\/POD|Red flags)\s*:\s*/i;
const EMBEDDED_SECTION = /\s+(?=(?:PHx|PMHx|PMH|CC|Chief complaint|PI|HPI|ED(?:\s+(?:Lab|course|treatment))?|Lab|Image|Imaging|Impression|Imp|Assessment|A\/P|AP|Plan|Tasks?|Orders?|Meds?|DC|Discharge|S|O|V\/S|VS|PE)\s*:)/i;

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
  return /^(?:\d{1,3}\s*(?:yo|y\/o|\/\s*[MF])?|\d{1,3}\/[MF]|[MF]\/?\d{1,3})$/i.test(stripColorMarkup(value).trim());
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
      const polluted = boundary >= 0;
      const isolated = polluted ? body.slice(0, boundary).trim() : body;
      const fallback = fallbackForLabel(label, fallbacks);
      const nextBody = fallback && (polluted || !isolated || looksLikeIdentityOnly(isolated))
        ? fallback
        : isolated;
      if (!nextBody) return;
      const canonicalLabel = /^phx$/i.test(label) ? "PMH" : label;
      display = `${canonicalLabel}: ${nextBody}`;
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
