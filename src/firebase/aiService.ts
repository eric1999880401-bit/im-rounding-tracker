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

interface PendingRoundSoapGeneration {
  status: "pending";
  jobId: string;
  model: string;
  qualityMode: "fast" | "balanced" | "highAccuracy";
  pollAfterMs: number;
}

type CompletedRoundSoapGeneration = GenerateRoundSoapResult & { status: "completed" };

type StartRoundSoapGenerationResult = GenerateRoundSoapResult | PendingRoundSoapGeneration;
type PollRoundSoapGenerationResult = PendingRoundSoapGeneration | CompletedRoundSoapGeneration;

const startRoundSoapGenerationCallable = httpsCallable<GenerateRoundSoapInput, StartRoundSoapGenerationResult>(
  functions,
  "generateRoundSoap",
  { timeout: 60_000 },
);

const pollRoundSoapGenerationCallable = httpsCallable<{ jobId: string }, PollRoundSoapGenerationResult>(
  functions,
  "pollRoundSoapGeneration",
  { timeout: 30_000 },
);

function isPendingRoundSoapGeneration(value: StartRoundSoapGenerationResult | PollRoundSoapGenerationResult): value is PendingRoundSoapGeneration {
  return "status" in value && value.status === "pending" && typeof value.jobId === "string";
}

function retryableSoapPollError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  const code = String(value?.code ?? "").toLowerCase();
  const message = String(value?.message ?? "").toLowerCase();
  return code.includes("unavailable") || /network|fetch|connection|status check timed out|could not be checked/.test(message);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
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
  try {
    const result = await generateClinicalDocumentCallable(input);
    return result.data;
  } catch (error) {
    throw new Error(aiCallableMessage(error, "AI document generation"));
  }
}

async function runRoundSoapGeneration(input: GenerateRoundSoapInput) {
  const started = await startRoundSoapGenerationCallable({ ...input, supportsBackgroundPolling: true });
  if (!isPendingRoundSoapGeneration(started.data)) return started.data;

  const deadlineAt = Date.now() + ROUND_SOAP_CALLABLE_TIMEOUT_MS - 10_000;
  let nextPollMs = Math.max(800, Math.min(5_000, started.data.pollAfterMs || 2_000));
  let consecutivePollErrors = 0;
  while (Date.now() + nextPollMs < deadlineAt) {
    await wait(nextPollMs);
    try {
      const polled = await pollRoundSoapGenerationCallable({ jobId: started.data.jobId });
      consecutivePollErrors = 0;
      if (isPendingRoundSoapGeneration(polled.data)) {
        nextPollMs = Math.max(800, Math.min(5_000, polled.data.pollAfterMs || 2_000));
        continue;
      }
      const { status: _status, ...completed } = polled.data;
      return completed as GenerateRoundSoapResult;
    } catch (pollError) {
      consecutivePollErrors += 1;
      if (consecutivePollErrors <= 3 && retryableSoapPollError(pollError)) {
        nextPollMs = Math.min(5_000, 1_000 * (consecutivePollErrors + 1));
        continue;
      }
      throw pollError;
    }
  }
  throw new Error("SOAP generation exceeded the extended background-job window. The current SOAP was preserved; retry with the same source.");
}

function outputCompletionFailure(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  const text = `${String(value?.code ?? "")} ${String(value?.message ?? "")}`.toLowerCase();
  return /max_output_tokens|stopped before completing|returned no soap draft|malformed soap json/.test(text);
}

export async function generateRoundSoap(input: GenerateRoundSoapInput) {
  try {
    try {
      return await runRoundSoapGeneration({ ...input, retryAttempt: 0 });
    } catch (error) {
      if (!outputCompletionFailure(error)) throw error;
      return await runRoundSoapGeneration({ ...input, retryAttempt: 1 });
    }
  } catch (error) {
    throw new Error(aiCallableMessage(error, "SOAP generation"));
  }
}
