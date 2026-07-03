// Deterministic backstop that rewrites vague AI follow-up phrases into the
// concrete lab/study the phrase implies (e.g. "review renal function" ->
// "f/u BUN/Cr, K"). Rewrites wording only; it must never add tests or
// treatments beyond the standard panel named by the vague phrase itself.
// Keep in sync with vagueFollowUpRewrites in functions/src/index.ts.

const VAGUE_FOLLOW_UP_VERBS = "(?:review|monitor|check|follow|trend|assess|watch|evaluate|track)";

const VAGUE_FOLLOW_UP_REWRITES: Array<[RegExp, string]> = [
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?(?:renal|kidney)\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u BUN/Cr, K"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?(?:liver|hepatic)\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u AST/ALT/T-bil, INR"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?electrolytes?\\b`, "gi"), "f/u Na/K/Ca/Mg/P"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?blood\\s+counts?\\b`, "gi"), "f/u CBC (Hb/WBC/Plt)"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?(?:blood\\s+sugars?|glycemic\\s+control)\\b`, "gi"), "f/u fingerstick glucose (AC/HS)"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?coagulation(?:\\s+profile)?\\b`, "gi"), "f/u PT/INR, aPTT"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?thyroid\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u TSH, fT4"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?(?:inflammatory|infection)\\s+markers?\\b`, "gi"), "f/u WBC/CRP"],
  [new RegExp(`\\b${VAGUE_FOLLOW_UP_VERBS}\\s+(?:the\\s+)?(?:oxygenation|respiratory)\\s+status\\b`, "gi"), "f/u SpO2/O2 demand, ABG if worsening"],
  // Interventions: convert bare treatment nouns into executable wording with a
  // decision parameter and response check. Never adds doses or new drugs.
  [/\b(?:iv|ivf|aggressive|adequate|maintain|give|encourage|keep)\s+hydration\b(?:\s+(?:therapy|status))?/gi, "IVF — clarify type/rate; recheck BP, UO"],
  [/\bhydration\s+therapy\b/gi, "IVF — clarify type/rate; recheck BP, UO"],
  [/^(\s*[-*!]?\s*)hydration\s*$/gim, "$1IVF — clarify type/rate; recheck BP, UO"],
  [/\bcorrect(?:ion\s+of)?\s+(?:the\s+)?electrolyte(?:\s+(?:imbalances?|abnormalit(?:y|ies)|derangements?))?s?\b/gi, "replete K/Mg/Ca as indicated; recheck lytes after repletion"],
  [/\b(?:optimize|improve|ensure|provide)\s+(?:adequate\s+)?pain\s+(?:control|management)\b/gi, "titrate analgesics; reassess pain score"],
  [/\b(?:optimize|manage|address)\s+(?:the\s+)?volume\s+status\b/gi, "adjust IVF/diuretic per exam; check I/O, daily weight"],
  [/\b(?:optimize|improve|ensure)\s+(?:the\s+)?glycemic\s+control\b/gi, "adjust insulin per fingerstick glucose (AC/HS)"],
];

export function concretizeVagueFollowUps(value: string) {
  return VAGUE_FOLLOW_UP_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
