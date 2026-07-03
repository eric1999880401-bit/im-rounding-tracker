// Change highlighting for the rounding list. A line is "carried forward" when
// essentially the same content appeared in the most recent prior daily note.
// Rendering dims carried-forward lines so today's new or changed lines stand
// out. Any value/number change breaks the key match, so a trend like
// "Cr 1.4" -> "Cr 2.1" is treated as changed and stays at full emphasis.

import type { DailyNote } from "./types";
import { parseSoapText } from "./soapDraft";
import { stripClinicalMarkup } from "./clinicalLineClassifier";

// Content key: markup and section labels removed, case and punctuation folded,
// so cosmetic differences match but any changed value does not.
export function soapLineDeltaKey(value: string) {
  return stripClinicalMarkup(value)
    .replace(/^(?:S|V\/S|VS|PE|Lab|Image|Img|A\/P|AP|Tasks?|DC|Order|Orders?|藥囑|Dx|PMH|Issues|Red flags?)\s*[:：]\s*/i, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function linesFromSoapText(soapText: string) {
  const draft = parseSoapText(soapText);
  return [
    ...draft.header,
    ...draft.sLines,
    ...draft.oLines,
    ...draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...draft.taskLines,
    ...draft.dcLines,
  ];
}

// Keys of every line in the most recent note strictly before `currentDate` that
// has SOAP text. Empty when there is no prior note (nothing gets dimmed).
export function buildCarriedForwardKeys(notes: DailyNote[] = [], currentDate: string): Set<string> {
  const prior = notes
    .filter((note) => note.date < currentDate && note.soapText?.trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!prior?.soapText) return new Set();

  const keys = new Set<string>();
  linesFromSoapText(prior.soapText).forEach((line) => {
    const key = soapLineDeltaKey(line);
    if (key) keys.add(key);
  });
  return keys;
}

export function isCarriedForwardLine(line: string, carriedKeys: Set<string>) {
  if (carriedKeys.size === 0) return false;
  const key = soapLineDeltaKey(line);
  return key.length > 0 && carriedKeys.has(key);
}
