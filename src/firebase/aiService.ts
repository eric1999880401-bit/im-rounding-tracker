import { httpsCallable } from "firebase/functions";
import type { AnalyzeClinicalTextInput, AnalyzeClinicalTextResult } from "../types";
import { functions } from "./firebase";

const analyzeClinicalTextCallable = httpsCallable<AnalyzeClinicalTextInput, AnalyzeClinicalTextResult>(
  functions,
  "analyzeClinicalText",
);

export async function analyzeClinicalText(input: AnalyzeClinicalTextInput) {
  const result = await analyzeClinicalTextCallable(input);
  return result.data;
}
