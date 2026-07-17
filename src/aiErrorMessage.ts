export function aiCallableMessage(error: unknown, feature: string) {
  const value = error as { code?: string; message?: string; details?: unknown };
  const code = String(value?.code ?? "").toLowerCase();
  const message = String(value?.message ?? "").trim();
  const details = typeof value?.details === "string" ? value.details.trim() : "";
  const text = message && message.toLowerCase() !== "internal" ? message : details;

  if (code.includes("deadline-exceeded")) {
    return `${feature} exceeded the extended generation time limit. The current SOAP was preserved. Retry with the same model; you do not need to shorten the transfer record or choose a lower-quality model.`;
  }
  if (code.includes("unauthenticated")) return "Sign in again, then retry.";
  if (code.includes("not-found")) return `${feature} is not available. Check the Functions deployment and configured OpenAI model route.`;
  if (code.includes("failed-precondition")) return `${feature} is not configured. Check OPENAI_API_KEY in Firebase Functions.`;
  if (code.includes("invalid-argument")) return `${feature} could not run because the request was incomplete or unsafe. Check de-identification; only split the raw export when it exceeds the displayed maximum.`;
  if (code.includes("permission-denied")) return `${feature} is blocked by OpenAI or Firebase permissions. Check the API key, model access, and function logs.`;
  if (code.includes("resource-exhausted")) return "AI quota or rate limit reached. Retry later or check OpenAI billing/limits.";
  if (code.includes("unavailable")) {
    if (text && !/^(?:unavailable|functions\/unavailable|ai service is temporarily unavailable)/i.test(text)) return text;
    return "AI service is temporarily unavailable. Retry later.";
  }
  if (code.includes("data-loss")) {
    if (text && !/^(?:data-loss|functions\/data-loss)/i.test(text)) return text;
    return "AI returned malformed output. Retry generation; no patient data was saved.";
  }
  if (code.includes("internal")) return `${feature} failed inside Firebase Functions. Check function logs for OpenAI key/model/schema errors.`;
  if (text && !/^internal$/i.test(text)) return text;
  return `${feature} failed. No patient data was saved.`;
}
