import { httpsCallable } from "firebase/functions";
import type {
  AnalyzeClinicalTextInput,
  AnalyzeClinicalTextResult,
  AnalyzePatientBatchTextInput,
  AnalyzePatientBatchTextResult,
  GenerateClinicalDocumentInput,
  GenerateClinicalDocumentResult,
  GenerateRoundSoapInput,
  GenerateRoundSoapResult,
} from "../types";
import { functions } from "./firebase";

const analyzeClinicalTextCallable = httpsCallable<AnalyzeClinicalTextInput, AnalyzeClinicalTextResult>(
  functions,
  "analyzeClinicalText",
);

const generateClinicalDocumentCallable = httpsCallable<GenerateClinicalDocumentInput, GenerateClinicalDocumentResult>(
  functions,
  "generateClinicalDocument",
);

const analyzePatientBatchTextCallable = httpsCallable<AnalyzePatientBatchTextInput, AnalyzePatientBatchTextResult>(
  functions,
  "analyzePatientBatchText",
);

const generateRoundSoapCallable = httpsCallable<GenerateRoundSoapInput, GenerateRoundSoapResult>(
  functions,
  "generateRoundSoap",
);

function aiCallableMessage(error: unknown, feature: string) {
  const value = error as { code?: string; message?: string; details?: unknown };
  const code = String(value?.code ?? "").toLowerCase();
  const message = String(value?.message ?? "").trim();
  const details = typeof value?.details === "string" ? value.details.trim() : "";
  const text = message && message.toLowerCase() !== "internal" ? message : details;

  if (text && !/^internal$/i.test(text)) return text;
  if (code.includes("unauthenticated")) return "Sign in again, then retry.";
  if (code.includes("not-found")) return `${feature} is not available. Check whether Firebase Functions were deployed and OPENAI_MODEL exists.`;
  if (code.includes("failed-precondition")) return `${feature} is not configured. Check OPENAI_API_KEY in Firebase Functions.`;
  if (code.includes("invalid-argument")) return `${feature} could not run because the request was incomplete or unsafe. Check de-identification and pasted text length.`;
  if (code.includes("permission-denied")) return `${feature} is blocked by OpenAI or Firebase permissions. Check the API key, model access, and function logs.`;
  if (code.includes("resource-exhausted")) return "AI quota or rate limit reached. Retry later or check OpenAI billing/limits.";
  if (code.includes("unavailable")) return "AI service is temporarily unavailable. Retry later.";
  if (code.includes("data-loss")) return "AI returned malformed output. Retry generation; no patient data was saved.";
  if (code.includes("internal")) return `${feature} failed inside Firebase Functions. Check function logs for OpenAI key/model/schema errors.`;
  return `${feature} failed. No patient data was saved.`;
}

export async function analyzeClinicalText(input: AnalyzeClinicalTextInput) {
  const result = await analyzeClinicalTextCallable(input);
  return result.data;
}

export async function analyzePatientBatchText(input: AnalyzePatientBatchTextInput) {
  const result = await analyzePatientBatchTextCallable(input);
  return result.data;
}

export async function generateClinicalDocument(input: GenerateClinicalDocumentInput) {
  const result = await generateClinicalDocumentCallable(input);
  return result.data;
}

export async function generateRoundSoap(input: GenerateRoundSoapInput) {
  try {
    const result = await generateRoundSoapCallable(input);
    return result.data;
  } catch (error) {
    throw new Error(aiCallableMessage(error, "SOAP generation"));
  }
}
