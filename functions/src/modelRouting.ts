import type { DocumentType } from "./types";

export type AiQualityMode = "fast" | "balanced" | "highAccuracy";
export type AiWorkload = "batch" | "intake" | "roundSoapDaily" | "roundSoapFull" | "document";

export const DEFAULT_FAST_MODEL = "gpt-5.4-mini-2026-03-17";
export const DEFAULT_BALANCED_MODEL = "gpt-5.4-2026-03-05";
export const DEFAULT_HIGH_ACCURACY_MODEL = "gpt-5.5-2026-04-23";
export const DEFAULT_MODEL = DEFAULT_BALANCED_MODEL;

export function getModel() {
  return process.env.OPENAI_MODEL_BALANCED || process.env.OPENAI_MODEL || DEFAULT_BALANCED_MODEL;
}

export function sanitizeQualityMode(value: unknown): AiQualityMode {
  const mode = String(value ?? "").trim();
  if (mode === "highAccuracy") return "highAccuracy";
  if (mode === "fast") return "fast";
  return "balanced";
}

export function getModelForQuality(qualityMode: AiQualityMode) {
  if (qualityMode === "highAccuracy") {
    return process.env.OPENAI_MODEL_HIGH_ACCURACY || DEFAULT_HIGH_ACCURACY_MODEL;
  }
  if (qualityMode === "balanced") {
    return process.env.OPENAI_MODEL_BALANCED || process.env.OPENAI_MODEL || DEFAULT_BALANCED_MODEL;
  }
  return process.env.OPENAI_MODEL_FAST || DEFAULT_FAST_MODEL;
}

function modelAlias(model: string) {
  if (/^gpt-5\.5-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.5";
  if (/^gpt-5\.4-mini-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.4-mini";
  if (/^gpt-5\.4-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.4";
  return "";
}

export function getModelCandidates(model: string, qualityMode: AiQualityMode) {
  const candidates = [model, modelAlias(model)];
  if (qualityMode === "highAccuracy") {
    const balanced = getModelForQuality("balanced");
    candidates.push(balanced, modelAlias(balanced));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function getResponseTuning(qualityMode: AiQualityMode, workload: AiWorkload) {
  const reasoningEffort = qualityMode === "fast"
    ? "low"
    : qualityMode === "highAccuracy"
      ? "medium"
      : workload === "roundSoapDaily"
        ? "low"
        : "medium";
  const maxOutputTokens = workload === "batch" ? 16000 : workload === "document" ? 8000 : workload === "roundSoapFull" ? 7000 : 5000;
  return {
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    prompt_cache_key: `im-rounding:${workload}:v4`,
    textVerbosity: "low" as const,
  };
}

function complexitySignals(value: string) {
  const patterns = [
    /\b(?:icu|pressor|norepi|shock|intubat|ventilat|ards|ecmo)\b/i,
    /\b(?:sepsis|bacteremia|positive culture|source control)\b/i,
    /\b(?:aki|hyperk|oliguria|dialysis|crrt)\b/i,
    /\b(?:bleed|hemorrhage|transfusion|coagulopathy|inr\s*[2-9])\b/i,
    /\b(?:oncology|chemotherapy|neutropen|metastatic|tumou?r lysis)\b/i,
    /\b(?:respiratory failure|high[- ]flow|bipap|cpap|chest tube|pleural effusion)\b/i,
  ];
  return patterns.filter((pattern) => pattern.test(value)).length;
}

export function resolveRoundSoapQuality(requested: AiQualityMode, workflowMode: string, rawText: string): AiQualityMode {
  if (requested === "highAccuracy" || workflowMode === "transferHandoff") return "highAccuracy";
  if (workflowMode === "newSoap" && (rawText.length > 9000 || complexitySignals(rawText) >= 3)) return "highAccuracy";
  return requested;
}

export function resolveDocumentQuality(requested: AiQualityMode, documentType: DocumentType, rawText: string): AiQualityMode {
  if (requested === "highAccuracy") return requested;
  if ((documentType === "admissionNote" || documentType === "admissionSummary") && complexitySignals(rawText) >= 3) return "highAccuracy";
  return requested;
}

export function roundSoapHistoryLimit(workflowMode: string) {
  if (workflowMode === "transferHandoff") return 10;
  if (workflowMode === "newSoap") return 5;
  return 3;
}
