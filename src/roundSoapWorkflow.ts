import type { DailyNote } from "./types";

export type RoundSoapWorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff" | "repairSoap";

export interface CanonicalSoapSource {
  text: string;
  source: "selected" | "latest" | "fallback";
}

export function hasSavedSoapText(dailyNotes: DailyNote[]) {
  return dailyNotes.some((note) => Boolean(note.soapText?.trim()));
}

export function deriveInitialRoundSoapWorkflow(dailyNotes: DailyNote[], isNewAdmission = false): RoundSoapWorkflowMode {
  if (hasSavedSoapText(dailyNotes)) return "dailyUpdate";
  if (isNewAdmission || dailyNotes.length === 0) return "newSoap";
  return "dailyUpdate";
}

export function roundSoapBaselineForWorkflow(mode: RoundSoapWorkflowMode, canonical: CanonicalSoapSource) {
  if (mode === "newSoap" && canonical.source === "fallback") return "";
  return canonical.text;
}

export function suggestedRoundSoapWorkflow(sourceText: string): RoundSoapWorkflowMode | "" {
  if (/\b(?:transfer|handoff|sbar|icu\s*(?:transfer|stepdown))\b|(?:轉科|轉入|交班|加護病房轉出)/i.test(sourceText)) {
    return "transferHandoff";
  }
  return "";
}
