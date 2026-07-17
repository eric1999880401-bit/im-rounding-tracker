import type { DocumentType } from "./types";

export type AiQualityMode = "fast" | "balanced" | "highAccuracy";
export type AiWorkload = "batch" | "intake" | "roundSoapDaily" | "roundSoapFull" | "document";

export const DEFAULT_FAST_MODEL = "gpt-5.6-luna";
export const DEFAULT_BALANCED_MODEL = "gpt-5.6-terra";
export const DEFAULT_HIGH_ACCURACY_MODEL = "gpt-5.6-sol";
export const DEFAULT_MODEL = DEFAULT_BALANCED_MODEL;
export const OPENAI_RESPONSE_TIMEOUT_MS = 105_000;
export const ROUND_SOAP_OPENAI_RESPONSE_TIMEOUT_MS = 270_000;
export const ROUND_SOAP_FUNCTION_TIMEOUT_SECONDS = 300;

export function isGpt56Model(model: string) {
  return /^gpt-5\.6(?:$|-(?:sol|terra|luna)(?:-\d{4}-\d{2}-\d{2})?$)/i.test(String(model ?? "").trim());
}

function configuredGpt56Model(value: string | undefined, fallback: string) {
  const configured = String(value ?? "").trim();
  return isGpt56Model(configured) ? configured : fallback;
}

export function getModel() {
  return configuredGpt56Model(process.env.OPENAI_MODEL_BALANCED || process.env.OPENAI_MODEL, DEFAULT_BALANCED_MODEL);
}

export function sanitizeQualityMode(value: unknown): AiQualityMode {
  const mode = String(value ?? "").trim();
  if (mode === "highAccuracy") return "highAccuracy";
  if (mode === "fast") return "fast";
  return "balanced";
}

export function getModelForQuality(qualityMode: AiQualityMode) {
  if (qualityMode === "highAccuracy") {
    return configuredGpt56Model(process.env.OPENAI_MODEL_HIGH_ACCURACY, DEFAULT_HIGH_ACCURACY_MODEL);
  }
  if (qualityMode === "balanced") {
    return configuredGpt56Model(process.env.OPENAI_MODEL_BALANCED || process.env.OPENAI_MODEL, DEFAULT_BALANCED_MODEL);
  }
  return configuredGpt56Model(process.env.OPENAI_MODEL_FAST, DEFAULT_FAST_MODEL);
}

function modelAlias(model: string) {
  if (/^gpt-5\.6-sol-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-sol";
  if (/^gpt-5\.6-terra-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-terra";
  if (/^gpt-5\.6-luna-\d{4}-\d{2}-\d{2}$/i.test(model)) return "gpt-5.6-luna";
  return "";
}

export function getModelCandidates(model: string, qualityMode: AiQualityMode) {
  const primary = configuredGpt56Model(model, getModelForQuality(qualityMode));
  const candidates = [primary, modelAlias(primary)];
  if (qualityMode === "fast") {
    candidates.push(DEFAULT_FAST_MODEL, DEFAULT_BALANCED_MODEL);
  }
  if (qualityMode === "balanced") {
    candidates.push(DEFAULT_BALANCED_MODEL, "gpt-5.6");
  }
  if (qualityMode === "highAccuracy") {
    candidates.push(DEFAULT_HIGH_ACCURACY_MODEL, "gpt-5.6");
  }
  return [...new Set(candidates.filter((candidate) => candidate && isGpt56Model(candidate)))];
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

export function getRoundSoapMaxOutputTokens(
  qualityMode: AiQualityMode,
  workflowMode: string,
  promptSourceChars: number,
) {
  const workload = workflowMode === "dailyUpdate" ? "roundSoapDaily" : "roundSoapFull";
  const base = getResponseTuning(qualityMode, workload).max_output_tokens;
  const longClinicalSource = workflowMode === "transferHandoff" || promptSourceChars > 18_000;
  if (!longClinicalSource) return base;

  // Responses API max_output_tokens includes hidden reasoning tokens. Long transfer
  // records need enough headroom to finish reasoning and still emit strict JSON.
  if (qualityMode === "highAccuracy") return Math.max(base, 14_000);
  if (qualityMode === "balanced") return Math.max(base, 9_000);
  return Math.max(base, 6_000);
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

export function shouldUseBackgroundRoundSoap(qualityMode: AiQualityMode, workflowMode: string, promptSourceChars: number) {
  return qualityMode === "highAccuracy" || workflowMode === "transferHandoff" || promptSourceChars > 18_000;
}
