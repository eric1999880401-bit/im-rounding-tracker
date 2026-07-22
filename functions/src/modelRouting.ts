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
  // Daily delta updates need source fidelity and enough visible output budget,
  // not prolonged hidden reasoning. Reserve high effort for first/transfer SOAP.
  const reasoningEffort = workload === "roundSoapDaily"
    ? "low"
    : qualityMode === "fast"
      ? "low"
      : qualityMode === "highAccuracy"
        ? "high"
        : "medium";
  const maxOutputTokens = workload === "batch"
    ? 16000
    : workload === "document"
      ? 8000
      : workload === "roundSoapFull"
        ? qualityMode === "highAccuracy" ? 24_000 : qualityMode === "balanced" ? 12_000 : 8_000
        : qualityMode === "highAccuracy" ? 12_000 : qualityMode === "balanced" ? 8_000 : 6_000;
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
  baselineChars = 0,
  retryAttempt = 0,
) {
  const workload = workflowMode === "dailyUpdate" ? "roundSoapDaily" : "roundSoapFull";
  const base = getResponseTuning(qualityMode, workload).max_output_tokens;
  if (retryAttempt > 0) {
    if (qualityMode === "highAccuracy") return Math.max(base, 32_000);
    if (qualityMode === "balanced") return Math.max(base, 18_000);
    return Math.max(base, 12_000);
  }
  if (workflowMode === "dailyUpdate") {
    const complexBaseline = baselineChars > 3_500 || promptSourceChars + baselineChars > 9_000;
    if (!complexBaseline) return base;
    // The API budget includes hidden reasoning plus strict JSON. A reviewed
    // baseline must fit in full so the model never stops halfway through it.
    if (qualityMode === "highAccuracy") return Math.max(base, 24_000);
    if (qualityMode === "balanced") return Math.max(base, baselineChars > 12_000 ? 18_000 : 12_000);
    return Math.max(base, 6_000);
  }
  const longClinicalSource = workflowMode === "transferHandoff" || workflowMode === "repairSoap" || promptSourceChars > 18_000;
  if (!longClinicalSource) return base;

  // Responses API max_output_tokens includes hidden reasoning tokens. Long transfer
  // records need enough headroom to finish reasoning and still emit strict JSON.
  if (qualityMode === "highAccuracy") return Math.max(base, 32_000);
  if (qualityMode === "balanced") return Math.max(base, 18_000);
  return Math.max(base, 10_000);
}

export function resolveRoundSoapQuality(requested: AiQualityMode, workflowMode: string, rawText: string, baselineText = ""): AiQualityMode {
  if (workflowMode === "repairSoap" && requested === "fast") return "balanced";
  if (requested !== "fast") return requested;
  const baselineProblemCount = (String(baselineText).match(/^\s*#\s+\S/gm) ?? []).length;
  const combined = `${rawText}\n${baselineText}`;
  const highAcuityDomains = [
    /\b(?:ICU|intubat|ventilat|pressor|norepi|shock)\b/i,
    /\b(?:sepsis|bacteremia|meningitis|positive culture|B\/C|BCx)\b/i,
    /\b(?:AKI|CRRT|dialysis|hypernatremia|hyponatremia|hyperkalemia)\b/i,
    /\b(?:respiratory failure|hypox|HFNC|BiPAP|pleural effusion)\b/i,
    /\b(?:active bleed|melena|hematemesis|coagulopathy|INR\s*[3-9])\b/i,
  ].filter((pattern) => pattern.test(combined)).length;
  if (
    workflowMode === "transferHandoff" ||
    rawText.length > 6_000 ||
    baselineText.length > 4_500 ||
    baselineProblemCount >= 4 ||
    highAcuityDomains >= 2
  ) return "balanced";
  return requested;
}

export function resolveDocumentQuality(requested: AiQualityMode, _documentType: DocumentType, _rawText: string): AiQualityMode {
  return requested;
}

export function roundSoapHistoryLimit(workflowMode: string) {
  if (workflowMode === "transferHandoff") return 5;
  if (workflowMode === "newSoap") return 1;
  if (workflowMode === "repairSoap") return 1;
  return 2;
}

export function shouldUseBackgroundRoundSoap(qualityMode: AiQualityMode, workflowMode: string, promptSourceChars: number, baselineChars = 0) {
  return qualityMode === "highAccuracy" || workflowMode === "transferHandoff" || promptSourceChars > 18_000 || baselineChars > 6_000;
}
