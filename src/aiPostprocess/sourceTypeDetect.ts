// Best-effort AI-intake source-type guess from pasted content, so the clinician
// rarely has to touch the dropdown. Narrative admission cues win; otherwise a
// majority of lab / image / vital lines decides. Firebase-free so it is unit
// testable independent of the panel component.
import type { AiClinicalSourceType } from "../types";
import { isImageLine, isLabLine, isVitalLine } from "../clinicalFieldRouter";

export function detectSourceType(text: string): AiClinicalSourceType {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "mixed";
  const lower = text.toLowerCase();
  if (/\b(chief complaint|c\/c|admitted (?:via|for|because|to)|present illness|\bhpi\b|impression of|under the impression)\b/.test(lower)) {
    return "admission";
  }
  let lab = 0;
  let image = 0;
  let vital = 0;
  for (const line of lines) {
    if (isImageLine(line)) image += 1;
    else if (isLabLine(line)) lab += 1;
    else if (isVitalLine(line)) vital += 1;
  }
  const total = lines.length;
  if (image / total >= 0.5) return "image";
  if (lab / total >= 0.5) return "lab";
  if (vital / total >= 0.5) return "vitals";
  return "mixed";
}
