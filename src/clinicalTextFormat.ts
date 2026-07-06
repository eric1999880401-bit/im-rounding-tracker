// Clinical text formatting helpers (line splitting, color markup, safe truncation).
// Extracted from utils.ts (Phase 1 refactor).
import type { HighlightLine, Patient } from "./types";

export function textToItems(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}


export function summarizeItems(items: string[], fallback = "-") {
  if (items.length === 0) return fallback;
  return items.join("; ");
}

export function splitHighlightLines(value: string): HighlightLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const tone = line.startsWith("!!") ? "critical" : line.startsWith("!") ? "important" : undefined;
      const important = Boolean(tone);
      const text = important ? line.replace(/^!+\s*/, "").trim() : line;

      function parseLine(nextText: string): HighlightLine {
        const kind: HighlightLine["kind"] = /^=.+=$/.test(nextText)
          ? "section"
          : /^\d+\./.test(nextText)
            ? "numbered"
            : /^(->|=>|\u2192|\u21d2)/.test(nextText)
              ? "arrow"
              : nextText.startsWith("-")
                ? "dash"
                : "normal";

        return {
          important,
          tone,
          kind,
          text:
            kind === "dash"
              ? nextText.slice(1).trim()
              : kind === "section"
                ? nextText.replace(/^=+|=+$/g, "").trim()
                : nextText,
        };
      }

      const inlineArrow = text.match(/(=>|->|\u2192|\u21d2)/);
      if (inlineArrow?.index && inlineArrow.index > 0) {
        const mainText = text.slice(0, inlineArrow.index).trim();
        const arrowText = `${inlineArrow[1]} ${text.slice(inlineArrow.index + inlineArrow[0].length).trim()}`;
        return [parseLine(mainText), parseLine(arrowText)];
      }

      return [parseLine(text)];
    })
    .filter((line) => line.text);
}

export function stripColorMarkup(value: string) {
  return value.replace(/\[\[(red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:([\s\S]*?)\]\]/gi, "$2");
}

export function hasColorMarkup(value: string) {
  return /\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:/i.test(String(value ?? ""));
}

export function stripMarkdownEmphasis(value: string) {
  return String(value ?? "").replace(/\*\*([\s\S]*?)\*\*/g, "$1").replace(/\*\*/g, "");
}

export function safeClinicalLinePreservingMarks(value: string, maxChars = 120) {
  const source = String(value ?? "");
  if (!hasColorMarkup(source)) return safeClinicalLine(source, maxChars);
  // Truncation or tail cleanup could split a [[color:...]] token, so marked lines only get whitespace normalization.
  return source
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSpecificImagingTail(value: string) {
  return /\b(?:brain|head|neck|chest|lung|abd(?:omen|ominal)?|a\/p|ap|pelvis|pelvic|spine|cervical|thoracic|lumbar|sinus|cardiac|coronary)\s+(?:CT|MRI|CXR)\.?$/i.test(value)
    || /\b(?:CT|MRI)\s+(?:brain|head|neck|chest|lung|abd(?:omen|ominal)?|a\/p|ap|pelvis|pelvic|spine|cervical|thoracic|lumbar|sinus|cardiac|coronary)\.?$/i.test(value)
    || /\b(?:pending|f\/u|follow(?:-?up)?|repeat|order|arrange|scheduled|review|check)\s+(?:CT|MRI|CXR)\.?$/i.test(value);
}

function stripDanglingImagingAcronym(value: string) {
  if (!/\b(?:CT|MRI|CXR)\.?$/i.test(value) || hasSpecificImagingTail(value)) return value;
  return value.replace(/\s+\b(?:CT|MRI|CXR)\.?$/i, "").trim();
}

export function cleanClinicalTail(value: string, options: { stripDanglingImagingAcronym?: boolean } = {}) {
  let clean = value
    .replace(/\s+[+,;:/-]\s*$/g, "")
    .replace(/\s+\.\s*$/g, ".")
    .trim();
  const danglingTail =
    /(?:^|\s)(?:if|and|or|with|without|w\/|for|to|from|of|the|a|an|when|as|in|on|by|after|before|through|via|define|confirm|clarify|review|monitor|trend|repeat|continue|maintain|start|stop|hold|resume|call|contact|arrange|source|duration|coverage|feeding|course|image|still|remain(?:s|ing)?)\.?$/i;
  for (let index = 0; index < 4; index += 1) {
    const next = clean.replace(danglingTail, "").replace(/\s+[+,;:/-]\s*$/g, "").trim();
    if (next === clean) break;
    clean = next;
  }
  if (options.stripDanglingImagingAcronym) {
    clean = stripDanglingImagingAcronym(clean);
  }
  return clean;
}

export function safeClinicalLine(value: string, maxChars = 120) {
  const clean = stripColorMarkup(String(value ?? ""))
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return cleanClinicalTail(clean);

  const limit = Math.max(12, maxChars);
  const hardSlice = clean.slice(0, limit).trimEnd();
  const clauseCandidates = [
    hardSlice.lastIndexOf(";"),
    hardSlice.lastIndexOf("."),
    hardSlice.lastIndexOf(","),
  ].filter((index) => index >= Math.min(18, Math.max(8, limit - 18)));
  const clauseCut = clauseCandidates.length > 0 ? Math.max(...clauseCandidates) : -1;
  if (clauseCut > 0) return cleanClinicalTail(hardSlice.slice(0, clauseCut), { stripDanglingImagingAcronym: true });

  const lastSpace = hardSlice.lastIndexOf(" ");
  if (lastSpace >= Math.min(16, limit - 1)) return cleanClinicalTail(hardSlice.slice(0, lastSpace), { stripDanglingImagingAcronym: true });
  return cleanClinicalTail(hardSlice, { stripDanglingImagingAcronym: true });
}

export function importantLines(value: string) {
  return splitHighlightLines(value).filter((line) => line.important);
}

export function plainClinicalText(value: string, fallback = "-") {
  const text = splitHighlightLines(stripColorMarkup(value)).map((line) => line.text).join("; ");
  return text || fallback;
}

function comparisonText(value: string) {
  return plainClinicalText(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
}

function isSameClinicalContent(candidate: string, source: string) {
  const left = comparisonText(candidate);
  const right = comparisonText(source);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 120 && longer.includes(shorter) && shorter.length / longer.length > 0.7;
}

function looksLikeFullAdmissionNote(value: string) {
  const clean = value.trim();
  if (!clean) return false;
  // The structured brief format (PHx:/CC:/PI:/ED Lab:/Imp:) is exactly what
  // the summary field is supposed to hold — its headings must not get it
  // misclassified as a pasted full admission note and dropped from print.
  if (looksLikeStructuredAdmissionBrief(clean) && clean.length <= 1600) return false;
  const headingMatches = clean.match(/(^|\n)\s*(c\.?c|chief concern|p\.?i|hpi|physical exam|assessment|plan|lab|image)\s*[:：]/gi);
  return clean.length > 1600 || clean.split(/\r?\n/).filter(Boolean).length > 14 || (headingMatches?.length ?? 0) >= 3;
}

export function getAdmissionSummaryText(patient: Patient, options: { allowFallback?: boolean } = {}) {
  const allowFallback = options.allowFallback ?? true;
  const admissionSources = [
    patient.generatedAdmissionNote,
    patient.admissionBriefNotes,
    patient.presentIllnessOrHPI,
    patient.hpiOrAdmissionStory,
  ].filter(Boolean);
  const candidates = [patient.admissionBriefFreeText, patient.generatedAdmissionSummary]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const summary = candidates.find(
    (candidate) =>
      !looksLikeFullAdmissionNote(candidate) &&
      !admissionSources.some((source) => isSameClinicalContent(candidate, source)),
  );

  if (summary) return stripMarkdownEmphasis(summary);
  if (!allowFallback) return "";

  return (
    patient.oneLiner ||
    [patient.chiefComplaint || patient.admissionChiefConcern, patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory]
      .filter(Boolean)
      .join("\n")
  );
}

export function compactClinicalText(value: string, maxLines = 2, fallback = "-") {
  const lines = splitHighlightLines(value);
  if (lines.length === 0) return fallback;

  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  return [...important, ...normal].slice(0, maxLines).map((line) => line.text).join("; ");
}


// True when the text already follows the structured admission brief format
// (age/sex line + labeled PHx/CC/PI sections). Used to stop downstream
// formatters from rebuilding or flattening a brief that is already correct.
export function looksLikeStructuredAdmissionBrief(value: string) {
  const plain = stripMarkdownEmphasis(stripColorMarkup(value));
  return /\bPHx\s*:/i.test(plain) && /\bCC\s*:/i.test(plain) && /\b(?:PI|HPI)\s*:/i.test(plain);
}
