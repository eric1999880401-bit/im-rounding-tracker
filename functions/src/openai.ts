// OpenAI configuration, response extraction, and error mapping. Extracted from index.ts (Phase 3 refactor).
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const DEFAULT_MODEL = "gpt-5.4-mini";

export function getOpenAiApiKey() {
  try {
    const secretValue = OPENAI_API_KEY.value();
    if (secretValue) return secretValue;
  } catch {
    // Local emulator fallback below.
  }

  return process.env.OPENAI_API_KEY ?? "";
}

export function getModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function sanitizeQualityMode(value: unknown) {
  const mode = String(value ?? "").trim();
  if (mode === "highAccuracy") return "highAccuracy";
  if (mode === "balanced") return "balanced";
  return "fast";
}

export function getModelForQuality(qualityMode: "fast" | "balanced" | "highAccuracy") {
  if (qualityMode === "highAccuracy") {
    return process.env.OPENAI_MODEL_HIGH_ACCURACY || process.env.OPENAI_MODEL_BALANCED || getModel();
  }
  if (qualityMode === "balanced") {
    return process.env.OPENAI_MODEL_BALANCED || getModel();
  }
  return process.env.OPENAI_MODEL_FAST || getModel();
}

export function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content)
      : [];
    for (const contentItem of content) {
      const nextItem = contentItem as { type?: string; text?: unknown; refusal?: unknown };
      if ((nextItem.type === "output_text" || typeof nextItem.text === "string") && typeof nextItem.text === "string") {
        return nextItem.text;
      }
    }
  }

  return "";
}

export function extractRefusal(response: Record<string, unknown>) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content)
      : [];
    for (const contentItem of content) {
      const nextItem = contentItem as { refusal?: unknown };
      if (typeof nextItem.refusal === "string" && nextItem.refusal) return nextItem.refusal;
    }
  }

  return "";
}

export function getOpenAiErrorMessage(status: number, responseBody: Record<string, unknown>) {
  const errorInfo = responseBody.error as { code?: unknown; type?: unknown } | undefined;
  const code = typeof errorInfo?.code === "string" ? errorInfo.code : "";
  const type = typeof errorInfo?.type === "string" ? errorInfo.type : "";

  logger.warn("OpenAI Responses API error", { status, code, type });

  if (status === 401 || code === "invalid_api_key") {
    return "OpenAI API key is invalid. Update OPENAI_API_KEY in Firebase Functions.";
  }

  if (status === 403) {
    return "OpenAI API key is not authorized for this request.";
  }

  if (status === 404 || code === "model_not_found") {
    return "OpenAI model is unavailable. Update OPENAI_MODEL in Firebase Functions.";
  }

  if (status === 429) {
    return "OpenAI rate limit or quota was reached. Check the OpenAI project billing and limits.";
  }

  if (status >= 500) {
    return "OpenAI service is temporarily unavailable. Try again later.";
  }

  return "OpenAI request failed. Check the Firebase Functions logs for details.";
}

export function openAiHttpsError(status: number, responseBody: Record<string, unknown>) {
  const errorInfo = responseBody.error as { code?: unknown; type?: unknown } | undefined;
  const code = typeof errorInfo?.code === "string" ? errorInfo.code : "";
  const message = getOpenAiErrorMessage(status, responseBody);

  if (status === 401 || code === "invalid_api_key") {
    return new HttpsError("failed-precondition", message);
  }
  if (status === 403) {
    return new HttpsError("permission-denied", message);
  }
  if (status === 404 || code === "model_not_found") {
    return new HttpsError("not-found", message);
  }
  if (status === 429) {
    return new HttpsError("resource-exhausted", message);
  }
  if (status >= 500) {
    return new HttpsError("unavailable", message);
  }
  return new HttpsError("internal", message);
}
