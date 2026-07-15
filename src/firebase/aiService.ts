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
import { aiCallableMessage } from "../aiErrorMessage";
import { DEFAULT_AI_CALLABLE_TIMEOUT_MS, ROUND_SOAP_CALLABLE_TIMEOUT_MS } from "../aiTimeouts";
import { functions } from "./firebase";

const analyzeClinicalTextCallable = httpsCallable<AnalyzeClinicalTextInput, AnalyzeClinicalTextResult>(
  functions,
  "analyzeClinicalText",
  { timeout: DEFAULT_AI_CALLABLE_TIMEOUT_MS },
);

const generateClinicalDocumentCallable = httpsCallable<GenerateClinicalDocumentInput, GenerateClinicalDocumentResult>(
  functions,
  "generateClinicalDocument",
  { timeout: DEFAULT_AI_CALLABLE_TIMEOUT_MS },
);

const analyzePatientBatchTextCallable = httpsCallable<AnalyzePatientBatchTextInput, AnalyzePatientBatchTextResult>(
  functions,
  "analyzePatientBatchText",
  { timeout: DEFAULT_AI_CALLABLE_TIMEOUT_MS },
);

const generateRoundSoapCallable = httpsCallable<GenerateRoundSoapInput, GenerateRoundSoapResult>(
  functions,
  "generateRoundSoap",
  { timeout: ROUND_SOAP_CALLABLE_TIMEOUT_MS },
);

export async function analyzeClinicalText(input: AnalyzeClinicalTextInput) {
  const result = await analyzeClinicalTextCallable(input);
  return result.data;
}

export async function analyzePatientBatchText(input: AnalyzePatientBatchTextInput) {
  const result = await analyzePatientBatchTextCallable(input);
  return result.data;
}

export async function generateClinicalDocument(input: GenerateClinicalDocumentInput) {
  try {
    const result = await generateClinicalDocumentCallable(input);
    return result.data;
  } catch (error) {
    throw new Error(aiCallableMessage(error, "AI document generation"));
  }
}

export async function generateRoundSoap(input: GenerateRoundSoapInput) {
  try {
    const result = await generateRoundSoapCallable(input);
    return result.data;
  } catch (error) {
    throw new Error(aiCallableMessage(error, "SOAP generation"));
  }
}
