// Single source of truth for generic AI filler detection (Phase 2 refactor).
// Product rule (AGENTS.md): generic phrases like "monitor closely" are only
// allowed when paired with a concrete trigger, threshold, or action.
// Keep the phrase list in sync with isGenericClinicalFiller in functions/src.

export const GENERIC_FILLER_PHRASES = [
  "monitor closely",
  "continue to monitor",
  "close monitoring",
  "continue current management",
  "clinical correlation recommended",
  "clinical correlation",
  "follow clinically",
  "supportive care",
  "watch for deterioration",
  "no acute issue",
  "stable condition",
] as const;

const phraseAlternatives = GENERIC_FILLER_PHRASES.join("|");
const fillerAnywherePattern = new RegExp(`\\b(?:${phraseAlternatives})\\b`, "i");
const fillerLineEndPattern = new RegExp(`(?:${phraseAlternatives})[.!]?$`, "i");
const fillerWholeLinePattern = new RegExp(`^(?:recommendation:\\s*)?(?:${phraseAlternatives})[.!]?$`, "i");
const strippablePhrasePattern = /\b(?:monitor closely|continue current management)\b\.?/gi;

// A line with any of these is treated as concrete enough to keep even when it
// also contains a filler phrase ("watch for deterioration, call if SBP <90").
export const CONCRETE_TRIGGER_PATTERN =
  /\d|if\b|when\b|call\b|threshold|pending|f\/u|follow(?!\s+clinically)|repeat|hold|start|stop|resume|taper|consult|culture|lactate|troponin|\bk\b|\bcr\b|\bhb\b|o2|fio2|shock|bleed|fever|hypo|hyper|transfus|glucose|anc|pathology/i;

export function hasConcreteTrigger(value: string) {
  return CONCRETE_TRIGGER_PATTERN.test(value);
}

export function containsGenericFiller(value: string) {
  return fillerAnywherePattern.test(value);
}

export function isEntirelyGenericFiller(value: string) {
  return fillerWholeLinePattern.test(value.trim());
}

export function isGenericFillerLine(value: string) {
  const clean = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!clean) return true;
  if (hasConcreteTrigger(clean)) return false;
  return fillerLineEndPattern.test(clean);
}

export function removeGenericFiller(items: string[]) {
  return items.filter((item) => !isGenericFillerLine(item));
}

export function stripInlineFiller(value: string) {
  return value.replace(strippablePhrasePattern, "");
}
