import type { DocumentType } from "./types";

export type AiQualityMode = "fast" | "balanced" | "highAccuracy";
export type AiWorkload = "batch" | "intake" | "roundSoapDaily" | "roundSoapFull" | "document";

export const DEFAULT_FAST_MODEL = "gpt-5.6-luna";
export const DEFAULT_BALANCED_MODEL = "gpt-5.6-terra";
export const DEFAULT_HIGH_ACCURACY_MODEL = "gpt-5.6-sol";
export const DEFAULT_MODEL = DEFAULT_BALANCED_MODEL;
export const OPENAI_RESPONSE_TIMEOUT_MS = 105_000;
export const ROUND_SOAP_OPENAI_RESPONSE_TIMEOUT_MS = 145_000;
export const ROUND_SOAP_FUNCTION_TIMEOUT_SECONDS = 180;

const LEGACY_FAST_MODEL = "gpt-5.4-mini-2026-03-17";
const LEGACY_BALANCED_MODEL = "gpt-5.4-2026-03-05";
const LEGACY_HIGH_ACCURACY_MODEL = "gpt-5.5-2026-04-23";

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
  if (/^gpt-5\.6-sol-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-sol";
  if (/^gpt-5\.6-terra-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-terra";
  if (/^gpt-5\.6-luna-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-luna";
  if (/^gpt-5\.5-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.5";
  if (/^gpt-5\.4-mini-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.4-mini";
  if (/^gpt-5\.4-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.4";
  return "";
}

export function getModelCandidates(model: string, qualityMode: AiQualityMode) {
  const candidates = [model, modelAlias(model)];
  if (qualityMode === "fast") {
    candidates.push(DEFAULT_FAST_MODEL, LEGACY_FAST_MODEL, modelAlias(LEGACY_FAST_MODEL));
  }
  if (qualityMode === "balanced") {
    candidates.push(DEFAULT_BALANCED_MODEL, LEGACY_BALANCED_MODEL, modelAlias(LEGACY_BALANCED_MODEL));
  }
  if (qualityMode === "highAccuracy") {
    candidates.push(DEFAULT_HIGH_ACCURACY_MODEL, LEGACY_HIGH_ACCURACY_MODEL, modelAlias(LEGACY_HIGH_ACCURACY_MODEL));
    const balanced = getModelForQuality("balanced");
    candidates.push(balanced, modelAlias(balanced), DEFAULT_BALANCED_MODEL, LEGACY_BALANCED_MODEL, modelAlias(LEGACY_BALANCED_MODEL));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function getResponseTuning(qualityMode: AiQualityMode, workload: AiWorkload) {
  const reasoningEffort = qualityMode === "fast"
    ? "low"
    : qualityMode === "highAccuracy"
      ? "high"
      : "medium";
  const maxOutputTokens = workload === "batch"
    ? 16000
    : workload === "document"
      ? 8000
      : workload === "roundSoapFull"
        ? qualityMode === "highAccuracy" ? 6000 : qualityMode === "balanced" ? 4500 : 3500
        : qualityMode === "highAccuracy" ? 4500 : qualityMode === "balanced" ? 3200 : 2400;
  return {
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    prompt_cache_key: `im-rounding:${workload}:v5`,
    textVerbosity: "low" as const,
  };
}

export function resolveRoundSoapQuality(requested: AiQualityMode, _workflowMode: string, _rawText: string): AiQualityMode {
  return requested;
}

export function resolveDocumentQuality(requested: AiQualityMode, _documentType: DocumentType, _rawText: string): AiQualityMode {
  return requested;
}

export function roundSoapHistoryLimit(workflowMode: string) {
  if (workflowMode === "transferHandoff") return 5;
  if (workflowMode === "newSoap") return 1;
  return 2;
}
