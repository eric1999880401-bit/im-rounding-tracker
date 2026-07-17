// OpenAI configuration, response extraction, and error mapping. Extracted from index.ts (Phase 3 refactor).
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";
import { getModelCandidates, OPENAI_RESPONSE_TIMEOUT_MS } from "./modelRouting";
import type { AiQualityMode } from "./modelRouting";

export {
  DEFAULT_BALANCED_MODEL,
  DEFAULT_FAST_MODEL,
  DEFAULT_HIGH_ACCURACY_MODEL,
  DEFAULT_MODEL,
  getModel,
  getModelCandidates,
  getModelForQuality,
  getResponseTuning,
  sanitizeQualityMode,
} from "./modelRouting";
export type { AiQualityMode, AiWorkload } from "./modelRouting";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

export function getOpenAiApiKey() {
  try {
    const secretValue = OPENAI_API_KEY.value();
    if (secretValue) return secretValue;
  } catch {
    // Local emulator fallback below.
  }

  return process.env.OPENAI_API_KEY ?? "";
}

function isModelUnavailable(status: number, responseBody: Record<string, unknown>) {
  const errorInfo = responseBody.error as { code?: unknown } | undefined;
  return status === 404 || errorInfo?.code === "model_not_found";
}

export async function postOpenAiResponse(params: {
  apiKey: string;
  model: string;
  qualityMode: AiQualityMode;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  background?: boolean;
  deferBackground?: boolean;
}) {
  const candidates = getModelCandidates(params.model, params.qualityMode);
  let lastResponse: Response | null = null;
  let lastBody: Record<string, unknown> = {};
  let usedModel = params.model;
  const requestStartedAt = Date.now();
  const requestTimeoutMs = params.timeoutMs ?? OPENAI_RESPONSE_TIMEOUT_MS;
  const requestDeadlineAt = requestStartedAt + requestTimeoutMs;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    usedModel = candidate;
    const remainingMs = requestDeadlineAt - Date.now();
    if (remainingMs < 1_000) {
      throw new HttpsError(
        "deadline-exceeded",
        "OpenAI did not finish the SOAP draft in time. The current SOAP was preserved; retry generation.",
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remainingMs);
    const candidateStartedAt = Date.now();
    logger.info("OpenAI response request started", {
      model: candidate,
      qualityMode: params.qualityMode,
      candidateIndex,
      candidateCount: candidates.length,
      timeoutMs: requestTimeoutMs,
    });

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...params.payload,
          model: candidate,
          ...(params.background ? { background: true, store: false } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        logger.warn("OpenAI response request exceeded deadline", {
          model: candidate,
          qualityMode: params.qualityMode,
          durationMs: Date.now() - candidateStartedAt,
        });
        throw new HttpsError(
          "deadline-exceeded",
          "OpenAI did not finish the SOAP draft in time. The current SOAP was preserved; retry generation.",
        );
      }
      logger.error("OpenAI response request failed before a response", {
        model: candidate,
        qualityMode: params.qualityMode,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw new HttpsError("unavailable", "OpenAI could not be reached. Retry generation; no patient data was saved.");
    } finally {
      clearTimeout(timeoutId);
    }

    let body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (params.background && response.ok && ["queued", "in_progress"].includes(String(body.status ?? ""))) {
      const responseId = typeof body.id === "string" ? body.id : "";
      if (!responseId) throw new HttpsError("data-loss", "OpenAI started a background SOAP draft without a response ID. Retry generation.");
      logger.info("OpenAI background response queued", { model: candidate, qualityMode: params.qualityMode, responseId });
      if (params.deferBackground) {
        return {
          response,
          body,
          model: candidate,
          pendingResponseId: responseId,
        };
      }
      let transientPollFailures = 0;
      while (["queued", "in_progress"].includes(String(body.status ?? ""))) {
        const pollRemainingMs = requestDeadlineAt - Date.now();
        if (pollRemainingMs < 3_000) {
          const cancelController = new AbortController();
          const cancelTimeout = setTimeout(() => cancelController.abort(), 2_000);
          await fetch(`https://api.openai.com/v1/responses/${responseId}/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${params.apiKey}` },
            signal: cancelController.signal,
          }).catch(() => undefined);
          clearTimeout(cancelTimeout);
          throw new HttpsError(
            "deadline-exceeded",
            "The high-quality SOAP draft did not finish within five minutes. The current SOAP was preserved; retry without shortening the transfer record.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, Math.max(500, pollRemainingMs - 1_000))));
        const pollController = new AbortController();
        const pollTimeout = setTimeout(() => pollController.abort(), Math.min(15_000, Math.max(1_000, pollRemainingMs - 500)));
        try {
          response = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
            headers: { Authorization: `Bearer ${params.apiKey}` },
            signal: pollController.signal,
          });
          body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok && (response.status === 429 || response.status >= 500)) {
            transientPollFailures += 1;
            if (transientPollFailures <= 3) {
              logger.warn("OpenAI background SOAP poll returned a transient status", {
                model: candidate,
                responseStatus: response.status,
                transientPollFailures,
              });
              body = { status: "in_progress" };
              continue;
            }
          } else if (response.ok) {
            transientPollFailures = 0;
          }
        } catch (error) {
          if (pollController.signal.aborted || (error instanceof Error && error.name === "AbortError")) continue;
          transientPollFailures += 1;
          if (transientPollFailures <= 3) {
            logger.warn("OpenAI background SOAP poll failed transiently", {
              model: candidate,
              errorName: error instanceof Error ? error.name : "unknown",
              transientPollFailures,
            });
            continue;
          }
          throw new HttpsError("unavailable", "OpenAI background SOAP status could not be checked. Retry generation; no patient data was saved.");
        } finally {
          clearTimeout(pollTimeout);
        }
        if (!response.ok) break;
      }
      logger.info("OpenAI background response finished", {
        model: candidate,
        qualityMode: params.qualityMode,
        responseId,
        responseStatus: String(body.status ?? "unknown"),
        durationMs: Date.now() - candidateStartedAt,
      });
      if (response.ok && String(body.status ?? "completed") !== "completed") {
        const terminalStatus = String(body.status ?? "failed");
        throw new HttpsError("unavailable", `OpenAI background SOAP generation ended with status '${terminalStatus}'. Retry generation; no patient data was saved.`);
      }
    }
    logger.info("OpenAI response request completed", {
      model: candidate,
      qualityMode: params.qualityMode,
      status: response.status,
      durationMs: Date.now() - candidateStartedAt,
    });
    lastResponse = response;
    lastBody = body;
    if (response.ok || !isModelUnavailable(response.status, body)) break;
    logger.warn("OpenAI model unavailable; trying configured fallback", { model: candidate });
  }

  if (!lastResponse) throw new HttpsError("internal", "OpenAI request could not be started.");
  return { response: lastResponse, body: lastBody, model: usedModel, pendingResponseId: "" };
}

export function openAiBackgroundState(responseBody: Record<string, unknown>) {
  const status = String(responseBody.status ?? "").toLowerCase();
  if (status === "queued" || status === "in_progress") return "pending" as const;
  if (status === "completed" || (!status && (responseBody.output_text || responseBody.output))) return "completed" as const;
  return "terminal-error" as const;
}

export async function retrieveOpenAiResponse(params: {
  apiKey: string;
  responseId: string;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
  try {
    const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(params.responseId)}`, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new HttpsError("unavailable", "The SOAP job status check timed out. It will be retried automatically; no patient data was saved.");
    }
    logger.warn("OpenAI background response retrieval failed", {
      responseId: params.responseId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("unavailable", "The SOAP job status could not be checked. It will be retried automatically; no patient data was saved.");
  } finally {
    clearTimeout(timeoutId);
  }
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
    return "The selected GPT-5.6 model is unavailable. Check OPENAI_MODEL_BALANCED / FAST / HIGH_ACCURACY in Firebase Functions.";
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
