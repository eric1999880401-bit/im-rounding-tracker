import { httpsCallable } from "firebase/functions";
import type {
  AnalyzeClinicalTextInput,
  AnalyzeClinicalTextResult,
  GenerateClinicalDocumentInput,
  GenerateClinicalDocumentResult,
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

export async function analyzeClinicalText(input: AnalyzeClinicalTextInput) {
  const result = await analyzeClinicalTextCallable(input);
  return result.data;
}

export async function generateClinicalDocument(input: GenerateClinicalDocumentInput) {
  const result = await generateClinicalDocumentCallable(input);
  return result.data;
}
