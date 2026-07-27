import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();
const db = getFirestore();

const MAX_RAW_TEXT_CHARS = 18000;
const MAX_REVIEWED_SOAP_CHARS = 24000;
const AUDIT_PAYLOAD_PURGE_BATCH_SIZE = 400;
const AUDIT_PAYLOAD_PURGE_MAX_BATCHES = 20;
const AI_DRAFT_RAW_TEXT_PURGE_BATCH_SIZE = 400;
const AI_DRAFT_RAW_TEXT_PURGE_MAX_BATCHES = 20;
const EXPIRED_AI_DRAFT_PURGE_BATCH_SIZE = 400;
const EXPIRED_AI_DRAFT_PURGE_MAX_BATCHES = 20;
const EXPIRED_AI_JOB_PURGE_BATCH_SIZE = 400;
const EXPIRED_AI_JOB_PURGE_MAX_BATCHES = 20;

import { aiDocumentDraftSchema, aiSoapDraftSchema, patientBatchImportSchema, roundSoapDraftSchema } from "./schemas";
import { documentTypes, sourceTypes } from "./types";
import type { CallableInput, DocumentCallableInput, DocumentType, PatientBatchCallableInput, PollRoundSoapCallableInput, RoundSoapCallableInput, SourceType } from "./types";
import { OPENAI_API_KEY, extractOutputText, extractRefusal, getModel, getModelForQuality, getOpenAiApiKey, getOpenAiErrorMessage, getResponseTuning, openAiBackgroundState, openAiHttpsError, postOpenAiResponse, retrieveOpenAiResponse, sanitizeQualityMode } from "./openai";
import type { AiQualityMode } from "./openai";
import { getRoundSoapMaxOutputTokens, resolveDocumentQuality, resolveRoundSoapQuality, ROUND_SOAP_FUNCTION_TIMEOUT_SECONDS, ROUND_SOAP_OPENAI_RESPONSE_TIMEOUT_MS, roundSoapHistoryLimit, shouldUseBackgroundRoundSoap } from "./modelRouting";
import { asPlainObject, compactDailyNote, compactPatientContext, findTargetPatientForBatch, sanitizeExistingPatientsForBatch, sanitizePatientBatchImportMode, sanitizePatientBatchOutput, sanitizePatientContext, sanitizeUserStyleProfile, truncateString } from "./sanitize";
import { MAX_ROUND_SOAP_RAW_CHARS, prepareRoundSoapSource, type RoundSoapWorkflowMode } from "./sourceCompaction";
import { buildSoapPatch } from "./soapPatch";
import { formatStructuredRoundSoapDraft, parseStructuredRoundSoapDraft } from "./roundSoapContract";
import { admissionSummaryStyleBullets, documentInstructions, makeBatchImportPrompt, makeDocumentPrompt, makePrompt } from "./prompts";
import { makeRoundSoapPrompt } from "./roundSoapPrompt";
import { AI_DRAFT_RAW_TEXT_RETENTION_DAYS, buildAiDraftRawTextRetention } from "./rawTextRetention";

async function createPatientAiDraftAtomically(
  patientRef: DocumentReference,
  draftRef: DocumentReference,
  draftData: DocumentData,
) {
  await db.runTransaction(async (transaction) => {
    const latestPatient = await transaction.get(patientRef);
    if (!latestPatient.exists) {
      throw new HttpsError(
        "not-found",
        "Patient was deleted before the AI draft could be saved. No draft was persisted.",
      );
    }
    transaction.create(draftRef, draftData);
  });
}

export const purgeExpiredClinicalAuditPayloads = onSchedule(
  {
    schedule: "every day 03:15",
    timeZone: "Asia/Taipei",
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    let deletedAuditPayloads = 0;
    for (let batchIndex = 0; batchIndex < AUDIT_PAYLOAD_PURGE_MAX_BATCHES; batchIndex += 1) {
      const snapshot = await db
        .collectionGroup("clinicalAuditPayloads")
        .where("expiresAt", "<=", new Date())
        .limit(AUDIT_PAYLOAD_PURGE_BATCH_SIZE)
        .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((payloadDoc) => batch.delete(payloadDoc.ref));
      await batch.commit();
      deletedAuditPayloads += snapshot.size;
      if (snapshot.size < AUDIT_PAYLOAD_PURGE_BATCH_SIZE) break;
    }

    let scrubbedAiDraftSources = 0;
    for (let batchIndex = 0; batchIndex < AI_DRAFT_RAW_TEXT_PURGE_MAX_BATCHES; batchIndex += 1) {
      const snapshot = await db
        .collectionGroup("aiDrafts")
        .where("rawTextExpiresAt", "<=", new Date())
        .limit(AI_DRAFT_RAW_TEXT_PURGE_BATCH_SIZE)
        .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((draftDoc) => {
        batch.update(draftDoc.ref, {
          rawText: FieldValue.delete(),
          rawTextPreview: FieldValue.delete(),
          rawTextExpiresAt: FieldValue.delete(),
        });
      });
      await batch.commit();
      scrubbedAiDraftSources += snapshot.size;
      if (snapshot.size < AI_DRAFT_RAW_TEXT_PURGE_BATCH_SIZE) break;
    }

    // Pre-retention drafts have no rawTextExpiresAt marker. AI drafts are not
    // source-of-truth records, so delete every expired draft by server
    // createdAt. This bounded sweep removes legacy raw source without
    // repeatedly scanning or rewriting the full collection forever.
    const expiredDraftCutoff = new Date(
      Date.now() - AI_DRAFT_RAW_TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    let deletedExpiredAiDrafts = 0;
    for (let batchIndex = 0; batchIndex < EXPIRED_AI_DRAFT_PURGE_MAX_BATCHES; batchIndex += 1) {
      const snapshot = await db
        .collectionGroup("aiDrafts")
        .where("createdAt", "<=", expiredDraftCutoff)
        .limit(EXPIRED_AI_DRAFT_PURGE_BATCH_SIZE)
        .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((draftDoc) => batch.delete(draftDoc.ref));
      await batch.commit();
      deletedExpiredAiDrafts += snapshot.size;
      if (snapshot.size < EXPIRED_AI_DRAFT_PURGE_BATCH_SIZE) break;
    }

    let deletedExpiredAiJobs = 0;
    for (let batchIndex = 0; batchIndex < EXPIRED_AI_JOB_PURGE_MAX_BATCHES; batchIndex += 1) {
      const snapshot = await db
        .collectionGroup("aiJobs")
        .where("expiresAt", "<=", new Date())
        .limit(EXPIRED_AI_JOB_PURGE_BATCH_SIZE)
        .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((jobDoc) => batch.delete(jobDoc.ref));
      await batch.commit();
      deletedExpiredAiJobs += snapshot.size;
      if (snapshot.size < EXPIRED_AI_JOB_PURGE_BATCH_SIZE) break;
    }

    logger.info("Expired clinical text retention purge completed", {
      deletedAuditPayloads,
      scrubbedAiDraftSources,
      deletedExpiredAiDrafts,
      deletedExpiredAiJobs,
    });
  },
);

export const analyzePatientBatchText = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required before using Bulk Patient Import.");
    }

    const data = request.data as PatientBatchCallableInput;
    const rawText = String(data.rawText ?? "").trim();
    const deidentifiedConfirmed = data.deidentifiedConfirmed === true;
    const existingPatients = sanitizeExistingPatientsForBatch(data.existingPatients);
    const importMode = sanitizePatientBatchImportMode(data.importMode);
    const targetPatient = importMode === "existingInpatient"
      ? findTargetPatientForBatch(data.targetPatientId, existingPatients)
      : undefined;

    if (!deidentifiedConfirmed) {
      throw new HttpsError("failed-precondition", "Confirm that the text is de-identified before batch analysis.");
    }

    if (rawText.length < 40) {
      throw new HttpsError("invalid-argument", "Paste a longer de-identified service list or handover batch.");
    }

    if (rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new HttpsError("invalid-argument", `Text is too long. Limit input to ${MAX_RAW_TEXT_CHARS} characters.`);
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "Bulk Patient Import is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const requestedModel = getModel();
    const qualityMode: AiQualityMode = "balanced";
    const tuning = getResponseTuning(qualityMode, "batch");
    const { response: openAiResponse, body: responseBody, model } = await postOpenAiResponse({
      apiKey,
      model: requestedModel,
      qualityMode,
      payload: {
        reasoning: tuning.reasoning,
        max_output_tokens: tuning.max_output_tokens,
        prompt_cache_key: tuning.prompt_cache_key,
        input: [
          {
            role: "system",
            content: [
              "You extract de-identified inpatient internal medicine batch handover text into structured review drafts.",
              "Return JSON only matching the supplied schema.",
              "The output is draft only. A clinician must review each card before saving.",
              "AI extracts and classifies facts into slots; deterministic rules and clinician review decide what is saved.",
              "Do not invent missing facts, do not repeat identifying details, and do not produce freeform narrative outside the schema.",
              "Use terse hospital-rounds language with common unambiguous abbreviations.",
              "Preserve clinical substance but compress wording with w/, w/o, s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, PNA, UTI, AKI/CKD, SpO2/O2, NC/RA, CXR/CT, OPD, and DC for discharge.",
            ].join(" "),
          },
          {
            role: "user",
            content: makeBatchImportPrompt(rawText, existingPatients, importMode, targetPatient),
          },
        ],
        text: {
          verbosity: tuning.textVerbosity,
          format: {
            type: "json_schema",
            name: "patient_batch_import_draft",
            description: "Bulk patient import draft cards for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: patientBatchImportSchema,
          },
        },
      },
    });

    if (!openAiResponse.ok) {
      throw openAiHttpsError(openAiResponse.status, responseBody);
    }

    const refusal = extractRefusal(responseBody);
    if (refusal) {
      throw new HttpsError("failed-precondition", refusal);
    }

    const outputText = extractOutputText(responseBody);
    if (!outputText) {
      throw new HttpsError("internal", "OpenAI returned no patient import draft.");
    }

    let parsedDraft: unknown;
    try {
      parsedDraft = JSON.parse(outputText);
    } catch (error) {
      // JSON.parse messages can embed part of the malformed clinical output.
      // Log classification only, never the Error object/message/stack.
      logger.error("Failed to parse OpenAI batch import JSON", {
        errorName: error instanceof Error ? error.name : "unknown",
        model,
      });
      throw new HttpsError("internal", "OpenAI returned malformed patient import JSON.");
    }

    const rawTextPreview = rawText.slice(0, 700);
    const drafts = sanitizePatientBatchOutput(parsedDraft, rawText, existingPatients, targetPatient);

    return {
      draftId: db.collection("_aiDraftIds").doc().id,
      drafts,
      model,
      rawTextPreview,
    };
  },
);

interface RoundSoapJobData {
  kind: "roundSoap";
  patientId: string;
  responseId: string;
  model: string;
  qualityMode: AiQualityMode;
  requestedQualityMode?: AiQualityMode;
  workflowMode: RoundSoapWorkflowMode;
  baselineHash: string;
  sourceCompacted: boolean;
  originalChars: number;
  promptChars: number;
  omittedBlocks: number;
  createdAt?: unknown;
  expiresAt?: unknown;
}

function roundSoapCompactionWarning(job: Pick<RoundSoapJobData, "sourceCompacted" | "workflowMode" | "originalChars" | "promptChars">) {
  if (!job.sourceCompacted) return "";
  return `Long ${job.workflowMode === "transferHandoff" ? "transfer" : "clinical"} source condensed automatically (${job.originalChars.toLocaleString()} -> ${job.promptChars.toLocaleString()} characters); no manual shortening was required.`;
}

function parseRoundSoapResponse(responseBody: Record<string, unknown>, workflowMode: RoundSoapWorkflowMode, model: string) {
  const refusal = extractRefusal(responseBody);
  if (refusal) throw new HttpsError("failed-precondition", refusal);

  const outputText = extractOutputText(responseBody);
  if (!outputText) {
    throw new HttpsError("data-loss", "OpenAI returned no SOAP draft. Retry generation; no patient data was saved.");
  }

  let parsedDraft: unknown;
  try {
    parsedDraft = JSON.parse(outputText);
  } catch (error) {
    logger.error("Failed to parse OpenAI round SOAP JSON", {
      errorName: error instanceof Error ? error.name : "unknown",
      workflowMode,
      model,
    });
    throw new HttpsError("data-loss", "OpenAI returned malformed SOAP JSON. Retry generation; no patient data was saved.");
  }

  const structuredDraft = parseStructuredRoundSoapDraft(parsedDraft);
  const soapText = formatStructuredRoundSoapDraft(structuredDraft);
  if (!soapText) {
    throw new HttpsError("data-loss", "OpenAI returned an empty SOAP draft. Retry generation; no patient data was saved.");
  }
  if (soapText.length > MAX_REVIEWED_SOAP_CHARS) {
    throw new HttpsError("data-loss", "OpenAI returned an overlong SOAP draft. Retry generation; no patient data was saved.");
  }

  return {
    soapText,
    structuredDraft,
    warnings: structuredDraft.warnings.map((item) => truncateString(item, 240)),
    highlightHints: structuredDraft.highlightHints.map((item) => truncateString(item, 180)).slice(0, 12),
  };
}

function roundSoapResult(params: {
  responseBody: Record<string, unknown>;
  workflowMode: RoundSoapWorkflowMode;
  qualityMode: AiQualityMode;
  model: string;
  baselineHash: string;
  sourceCompacted: boolean;
  originalChars: number;
  promptChars: number;
  routingWarning?: string;
  patch?: ReturnType<typeof buildSoapPatch>;
  parsed?: ReturnType<typeof parseRoundSoapResponse>;
}) {
  const parsed = params.parsed ?? parseRoundSoapResponse(params.responseBody, params.workflowMode, params.model);
  const compactionWarning = roundSoapCompactionWarning(params);
  return {
    draftId: db.collection("_aiDraftIds").doc().id,
    soapText: parsed.soapText,
    structuredDraft: parsed.structuredDraft,
    mode: params.workflowMode === "dailyUpdate" ? "patch" as const : "full" as const,
    ...(params.workflowMode === "dailyUpdate"
      ? { patch: params.patch ?? { baselineHash: params.baselineHash, changedSections: [] } }
      : {}),
    warnings: [params.routingWarning, compactionWarning, ...parsed.warnings].filter(Boolean).slice(0, 8),
    highlightHints: parsed.highlightHints,
    model: params.model,
    qualityMode: params.qualityMode,
  };
}

function timestampMillis(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

export const generateRoundSoap = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: ROUND_SOAP_FUNCTION_TIMEOUT_SECONDS,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required before using SOAP generation.");
    }

    const data = request.data as RoundSoapCallableInput;
    const uid = request.auth.uid;
    const patientId = String(data.patientId ?? "").trim();
    const selectedDate = truncateString(data.selectedDate, 20);
    const sourceType = String(data.sourceType ?? "dailyUpdate") as SourceType;
    const workflowModeValue = String(data.workflowMode ?? "dailyUpdate");
    const workflowMode = ["dailyUpdate", "newSoap", "transferHandoff", "repairSoap"].includes(workflowModeValue)
      ? workflowModeValue
      : "dailyUpdate";
    const rawText = String(data.rawText ?? "").trim();
    const currentSoapBaseline = truncateString(data.currentSoapBaseline, MAX_REVIEWED_SOAP_CHARS);
    const deidentifiedConfirmed = data.deidentifiedConfirmed === true;
    const requestedQualityMode = sanitizeQualityMode(data.qualityMode);
    const qualityMode = resolveRoundSoapQuality(requestedQualityMode, workflowMode, rawText, currentSoapBaseline);
    const routingWarning = qualityMode !== requestedQualityMode
      ? "Efficient mode was automatically raised to Recommended for this complex existing SOAP to protect clinical fidelity."
      : "";
    const supportsBackgroundPolling = data.supportsBackgroundPolling === true;
    const retryAttempt = Math.max(0, Math.min(1, Number(data.retryAttempt) || 0));
    const requestStartedAt = Date.now();

    if (!patientId) {
      throw new HttpsError("invalid-argument", "patientId is required.");
    }

    if (!sourceTypes.has(sourceType)) {
      throw new HttpsError("invalid-argument", "Invalid SOAP source type.");
    }

    if (!deidentifiedConfirmed) {
      throw new HttpsError("failed-precondition", "Confirm that the pasted text is de-identified before SOAP generation.");
    }

    if (rawText.length < 10) {
      throw new HttpsError("invalid-argument", "Paste more de-identified clinical text before SOAP generation.");
    }

    if (rawText.length > MAX_ROUND_SOAP_RAW_CHARS) {
      throw new HttpsError("invalid-argument", `The pasted record exceeds ${MAX_ROUND_SOAP_RAW_CHARS.toLocaleString()} characters. Split only the raw export; do not manually summarize or remove clinical details.`);
    }

    const preparedSource = prepareRoundSoapSource(rawText, workflowMode as RoundSoapWorkflowMode);

    const patientRef = db.doc(`users/${uid}/patients/${patientId}`);
    const patientSnapshot = await patientRef.get();
    if (!patientSnapshot.exists) {
      throw new HttpsError("not-found", "Patient was not found for this signed-in user.");
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "SOAP generation is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const historyLimit = roundSoapHistoryLimit(workflowMode);
    const notesSnapshot = await patientRef.collection("dailyNotes").orderBy("date", "desc").limit(historyLimit).get();
    const dailyNotes = notesSnapshot.docs
      .map((noteDoc) => compactDailyNote(noteDoc.id, noteDoc.data()))
      .reverse();
    const patientContext = {
      ...compactPatientContext(patientSnapshot.data()),
      ...(sanitizePatientContext(data.patientContext) ?? {}),
    };
    const userStyleProfile = sanitizeUserStyleProfile(data.userStyleProfile);
    const requestedModel = getModelForQuality(qualityMode);
    const tuning = getResponseTuning(qualityMode, workflowMode === "dailyUpdate" ? "roundSoapDaily" : "roundSoapFull");
    const background = shouldUseBackgroundRoundSoap(qualityMode, workflowMode, preparedSource.promptChars, currentSoapBaseline.length);
    const maxOutputTokens = getRoundSoapMaxOutputTokens(qualityMode, workflowMode, preparedSource.promptChars, currentSoapBaseline.length, retryAttempt);
    logger.info("generateRoundSoap request prepared", {
      workflowMode,
      sourceType,
      qualityMode,
      requestedModel,
      rawTextChars: rawText.length,
      promptSourceChars: preparedSource.promptChars,
      sourceCompacted: preparedSource.compacted,
      sourceBlocksOmitted: preparedSource.omittedBlocks,
      baselineChars: currentSoapBaseline.length,
      historyNotes: dailyNotes.length,
      maxOutputTokens,
      background,
      supportsBackgroundPolling,
      retryAttempt,
    });
    const { response: openAiResponse, body: responseBody, model, pendingResponseId } = await postOpenAiResponse({
      apiKey,
      model: requestedModel,
      qualityMode,
      timeoutMs: ROUND_SOAP_OPENAI_RESPONSE_TIMEOUT_MS,
      background,
      deferBackground: background && supportsBackgroundPolling,
      payload: {
        reasoning: retryAttempt > 0
          ? { effort: "low" }
          : workflowMode === "repairSoap" && qualityMode === "highAccuracy"
          ? { effort: "medium" }
          : tuning.reasoning,
        max_output_tokens: maxOutputTokens,
        prompt_cache_key: `${tuning.prompt_cache_key}:${workflowMode}`,
        input: [
          {
            role: "system",
            content: [
              "Create clinician-reviewed inpatient internal medicine SOAP drafts.",
              "Prioritize current active problems and exact source facts; never invent a diagnosis, value, date, medication, result, or plan.",
              "Return only JSON matching the strict schema and do not expose private reasoning.",
              "This is a preview only and never writes patient data.",
              "Do not repeat names, full MRNs, birthdays, phone numbers, addresses, or other identifiers.",
            ].join(" "),
          },
          {
            role: "user",
            content: makeRoundSoapPrompt({
              sourceType,
              workflowMode,
              selectedDate,
              rawText: preparedSource.text,
              currentSoapBaseline,
              patientContext,
              userStyleProfile,
              dailyNotes,
              sourcePreparationNote: preparedSource.compacted
                ? `Long ${workflowMode === "transferHandoff" ? "transfer" : "clinical"} source was deterministically deduplicated and reduced from ${preparedSource.originalChars.toLocaleString()} to ${preparedSource.promptChars.toLocaleString()} characters. Clinical anchors and the latest status were prioritized; do not infer omitted facts.`
                : "",
            }),
          },
        ],
        text: {
          verbosity: tuning.textVerbosity,
          format: {
            type: "json_schema",
            name: "round_soap_draft",
            description: "Structured SOAP block draft for clinician review before saving.",
            strict: true,
            schema: roundSoapDraftSchema,
          },
        },
      },
    });

    if (!openAiResponse.ok) {
      throw openAiHttpsError(openAiResponse.status, responseBody);
    }

    const baselineHash = buildSoapPatch(currentSoapBaseline, currentSoapBaseline, "").baselineHash;
    if (pendingResponseId) {
      const jobRef = db.collection(`users/${uid}/aiJobs`).doc();
      const job: RoundSoapJobData = {
        kind: "roundSoap",
        patientId,
        responseId: pendingResponseId,
        model,
        qualityMode,
        requestedQualityMode,
        workflowMode: workflowMode as RoundSoapWorkflowMode,
        baselineHash,
        sourceCompacted: preparedSource.compacted,
        originalChars: preparedSource.originalChars,
        promptChars: preparedSource.promptChars,
        omittedBlocks: preparedSource.omittedBlocks,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      };
      await jobRef.set(job);
      logger.info("generateRoundSoap background job handed off", {
        jobId: jobRef.id,
        workflowMode,
        qualityMode,
        model,
        durationMs: Date.now() - requestStartedAt,
      });
      return {
        status: "pending" as const,
        jobId: jobRef.id,
        model,
        qualityMode,
        pollAfterMs: 2_000,
      };
    }

    const parsedResponse = parseRoundSoapResponse(responseBody, workflowMode as RoundSoapWorkflowMode, model);
    const result = roundSoapResult({
      responseBody,
      workflowMode: workflowMode as RoundSoapWorkflowMode,
      qualityMode,
      model,
      baselineHash,
      sourceCompacted: preparedSource.compacted,
      originalChars: preparedSource.originalChars,
      promptChars: preparedSource.promptChars,
      routingWarning,
      patch: workflowMode === "dailyUpdate" ? buildSoapPatch(currentSoapBaseline, parsedResponse.soapText, rawText) : undefined,
      parsed: parsedResponse,
    });
    logger.info("generateRoundSoap draft completed", {
      workflowMode,
      qualityMode,
      model,
      durationMs: Date.now() - requestStartedAt,
      soapTextChars: result.soapText.length,
    });
    return result;
  },
);

export const pollRoundSoapGeneration = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required before checking SOAP generation.");
    }

    const data = request.data as PollRoundSoapCallableInput;
    const jobId = String(data.jobId ?? "").trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(jobId)) {
      throw new HttpsError("invalid-argument", "A valid SOAP generation job ID is required.");
    }

    const jobRef = db.doc(`users/${request.auth.uid}/aiJobs/${jobId}`);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "This SOAP generation job expired or was already completed. Generate the draft again; no patient data was saved.");
    }

    const stored = snapshot.data() as Partial<RoundSoapJobData>;
    if (stored.kind !== "roundSoap" || !stored.responseId || !stored.patientId) {
      await jobRef.delete();
      throw new HttpsError("data-loss", "The SOAP generation job metadata was invalid. Generate the draft again; no patient data was saved.");
    }
    if (timestampMillis(stored.expiresAt) > 0 && timestampMillis(stored.expiresAt) <= Date.now()) {
      await jobRef.delete();
      throw new HttpsError("deadline-exceeded", "The high-quality SOAP job exceeded the extended generation window. The current SOAP was preserved; retry with the same source.");
    }

    const jobPatientRef = db.doc(`users/${request.auth.uid}/patients/${stored.patientId}`);
    const jobPatientSnapshot = await jobPatientRef.get();
    if (!jobPatientSnapshot.exists) {
      await jobRef.delete();
      throw new HttpsError(
        "not-found",
        "The patient was deleted before this SOAP draft completed. The background job was removed and no result was returned.",
      );
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "SOAP generation is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const { response, body } = await retrieveOpenAiResponse({
      apiKey,
      responseId: stored.responseId,
      timeoutMs: 15_000,
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        logger.warn("OpenAI SOAP job poll returned a transient status", {
          jobId,
          responseStatus: response.status,
        });
        return { status: "pending" as const, jobId, pollAfterMs: 3_000 };
      }
      await jobRef.delete();
      throw openAiHttpsError(response.status, body);
    }

    const state = openAiBackgroundState(body);
    if (state === "pending") {
      return { status: "pending" as const, jobId, pollAfterMs: 2_000 };
    }

    const workflowMode = ["dailyUpdate", "newSoap", "transferHandoff", "repairSoap"].includes(String(stored.workflowMode))
      ? stored.workflowMode as RoundSoapWorkflowMode
      : "dailyUpdate";
    const qualityMode = sanitizeQualityMode(stored.qualityMode);
    const requestedQualityMode = stored.requestedQualityMode ? sanitizeQualityMode(stored.requestedQualityMode) : qualityMode;
    const model = truncateString(stored.model, 80) || getModelForQuality(qualityMode);

    if (state === "completed") {
      try {
        const result = roundSoapResult({
          responseBody: body,
          workflowMode,
          qualityMode,
          model,
          baselineHash: String(stored.baselineHash ?? ""),
          sourceCompacted: stored.sourceCompacted === true,
          originalChars: Number(stored.originalChars ?? 0),
          promptChars: Number(stored.promptChars ?? 0),
          routingWarning: requestedQualityMode !== qualityMode
            ? "Efficient mode was automatically raised to Recommended for this complex existing SOAP to protect clinical fidelity."
            : "",
        });
        const consumeStatus = await db.runTransaction(async (transaction) => {
          const [latestJob, latestPatient] = await Promise.all([
            transaction.get(jobRef),
            transaction.get(jobPatientRef),
          ]);
          if (!latestJob.exists) return "job-missing" as const;
          transaction.delete(jobRef);
          return latestPatient.exists ? "completed" as const : "patient-missing" as const;
        });
        if (consumeStatus === "job-missing") {
          throw new HttpsError(
            "not-found",
            "This SOAP generation job expired or was already completed. Generate the draft again; no patient data was saved.",
          );
        }
        if (consumeStatus === "patient-missing") {
          throw new HttpsError(
            "not-found",
            "The patient was deleted before this SOAP draft completed. The background job was removed and no result was returned.",
          );
        }
        logger.info("generateRoundSoap background job completed", {
          jobId,
          workflowMode,
          qualityMode,
          model,
          soapTextChars: result.soapText.length,
        });
        return { status: "completed" as const, ...result };
      } catch (error) {
        await jobRef.delete();
        throw error;
      }
    }

    const responseError = asPlainObject(body.error);
    const incompleteDetails = asPlainObject(body.incomplete_details);
    const terminalStatus = truncateString(body.status, 40) || "failed";
    const errorCode = truncateString(responseError.code, 80);
    const errorType = truncateString(responseError.type, 80);
    const incompleteReason = truncateString(incompleteDetails.reason, 120);
    logger.warn("OpenAI SOAP background job ended without a completed draft", {
      jobId,
      terminalStatus,
      errorCode,
      errorType,
      incompleteReason,
    });
    await jobRef.delete();

    if (terminalStatus === "incomplete") {
      throw new HttpsError(
        "data-loss",
        `OpenAI stopped before completing the SOAP draft${incompleteReason ? ` (${incompleteReason})` : ""}. Retry generation; no patient data was saved.`,
      );
    }
    if (errorCode === "rate_limit_exceeded" || errorType === "rate_limit_error") {
      throw new HttpsError("resource-exhausted", "OpenAI rate limit was reached while generating this SOAP. Retry shortly; no patient data was saved.");
    }
    throw new HttpsError(
      "unavailable",
      `OpenAI could not complete the background SOAP job${errorCode ? ` (${errorCode})` : ""}. Retry generation; no patient data was saved.`,
    );
  },
);

export const analyzeClinicalText = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required before using AI Intake.");
    }

    const data = request.data as CallableInput;
    const uid = request.auth.uid;
    const patientId = String(data.patientId ?? "").trim();
    const sourceType = String(data.sourceType ?? "mixed") as SourceType;
    const rawText = String(data.rawText ?? "").trim();
    const deidentifiedConfirmed = data.deidentifiedConfirmed === true;
    const storeRawText = data.storeRawText === true;

    if (!patientId) {
      throw new HttpsError("invalid-argument", "patientId is required.");
    }

    if (!sourceTypes.has(sourceType)) {
      throw new HttpsError("invalid-argument", "Invalid clinical source type.");
    }

    if (!deidentifiedConfirmed) {
      throw new HttpsError("failed-precondition", "Confirm that the text is de-identified before analysis.");
    }

    if (rawText.length < 20) {
      throw new HttpsError("invalid-argument", "Paste more de-identified clinical text before analysis.");
    }

    if (rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new HttpsError("invalid-argument", `Text is too long. Limit input to ${MAX_RAW_TEXT_CHARS} characters.`);
    }

    const patientRef = db.doc(`users/${uid}/patients/${patientId}`);
    const patientSnapshot = await patientRef.get();
    if (!patientSnapshot.exists) {
      throw new HttpsError("not-found", "Patient was not found for this signed-in user.");
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "AI Intake is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const requestedModel = getModel();
    const qualityMode: AiQualityMode = "balanced";
    const tuning = getResponseTuning(qualityMode, "intake");
    const patientContext = {
      ...compactPatientContext(patientSnapshot.data()),
      ...(sanitizePatientContext(data.patientContext) ?? {}),
    };
    const { response: openAiResponse, body: responseBody, model } = await postOpenAiResponse({
      apiKey,
      model: requestedModel,
      qualityMode,
      payload: {
        reasoning: tuning.reasoning,
        max_output_tokens: tuning.max_output_tokens,
        prompt_cache_key: tuning.prompt_cache_key,
        input: [
          {
            role: "system",
            content: [
              "You organize de-identified internal medicine clinical text into a SOAP draft.",
              "Return JSON only matching the supplied schema.",
              "The app now displays your output as one editable SOAP note. Make each JSON field read as part of a concise human SOAP note, not as dashboard cards.",
              "Target display order is header, S, O (V/S, PE, Lab, Image), A/P '# problem' blocks, Tasks, DC.",
              "AI clinical judgment should choose the A/P and tasks. Deterministic rules are only guardrails and validators; do not expect the app to rescue vague or generic plans.",
              "Use AI clinical reasoning explicitly: identify the main current risk, evidence, ranked active problems, missing data, and noise before writing the SOAP-facing fields.",
              "clinicalReasoning is the source of truth for what matters; SOAP-facing fields must be concise projections of that reasoning, not freeform prose.",
              "If the patient's most important issue is risk after partial improvement, state it directly, e.g. resolved fever but persistent leukopenia, improving oxygenation but still on O2, AKI improving but K/Cr still unsafe.",
              "Do not invent missing data. Use empty strings or empty arrays when data is absent.",
              "Preserve dates, lab values, units, and abnormal findings exactly when available.",
              "Keep all SOAP-facing text concise and easy to scan for inpatient IM rounds.",
              "Before writing SOAP-facing fields, decide current status from the latest dated note/V/S/labs. Historical admission or ED events are course, not current problems.",
              "If shock or hypotension occurred earlier but the source later says BP recovered, off pressor, fluid-responsive, or latest BP is stable, do not output current shock/hypotension in V/S, redFlags, tasks, or A/P.",
              "If resolved shock is clinically relevant, phrase it only as resolved course, e.g. 'initial fluid-responsive hypotension, now BP stable'.",
              "Always also return admissionSummary and isbarHandoff for pasted admission, mixed, progress, consult, nursing, or daily-update chart text when enough context exists.",
              ...admissionSummaryStyleBullets,
              "admissionSummary must be attending-ready 1-min oral brief: who/why admitted, focused HPI/ED or transfer course, relevant PMH/context, key V/S/lab/micro/image/procedure anchors, current assessment, and today/pending/disposition in 3-5 short mixed Chinese-English sentences by default.",
              "isbarHandoff must use headings Situation, Background, Assessment, Recommendation, with contingency plans, pending tasks, red flags, and call parameters when available.",
              "Assume the reviewer slept 3 hours and has seconds per patient: use telegraphic clinical fragments, not polished prose.",
              "Use the allowed patient context only to judge relevance and importance. Do not convert context-only facts into new SOAP draft items unless the pasted text explicitly supports them.",
              "For sourceType dailyUpdate, behave like a delta updater: compare pasted text against context and output only clinically meaningful new/changed items.",
              "For sourceType vitals, return only objective.vitals/objective.bloodSugars plus truly urgent redFlags/tasks caused by those values; leave oneLiner, admissionSummary, isbarHandoff, S, PE, labs, images, A/P, dischargeIssues, and thinkingPrompts empty unless the pasted vital data alone creates an immediate safety issue.",
              "If the source text contains only stable V/S, lab, image, consult, or nursing updates, leave unrelated S, PE, and A/P arrays empty rather than restating prior SOAP context.",
              "Use common, unambiguous medical abbreviations when they save space, such as w/, w/o, c/f, r/o, s/p, f/u, cont, SOB, CP, N/V, Abd, CV, Resp, Neuro, HEENT, MSK, WBC, Hb, Plt, Cr, Na, K, AST, ALT, CRP, UA, U/C, B/C, Sputum Cx, CXR, CT, MRI, U/S, Abx, PNA, UTI, AKI, CKD, ESRD, HD, RF, CHF/HF, AF, CAD, DM, HTN, COPD, SpO2/O2, NC/RA, EGD, pending, DC, OPD.",
              "Use DC for discharge; reserve d/c only for discontinue. Avoid rare or ambiguous abbreviations, and do not abbreviate in a way that changes clinical meaning.",
              "Compression means tighter wording, not omission: preserve active problems, key abnormal trends, Abx/procedure/consult status, actionable tasks, and DC barriers.",
              "For diagnosis-like summaries, prefer short clinical labels over prose, e.g. AIS NIHSS3, R MCA stenosis, UTI, PMB, HF, AKI, PNA, sepsis.",
              "Do not copy long PMH medication histories into SOAP-facing fields; preserve PMH concepts as short comorbidity labels when needed.",
              "Route each clinical fact to the single most useful destination: subjective for symptoms/events, objective for measured data, A/P for active management problems, tasks for work to do, redFlags for immediate safety/call thresholds, dischargeIssues for barriers/disposition, and uncertainty/thinkingPrompts only for real clinician-review questions.",
              "Do not convert normal stable V/S, unchanged chronic problems, routine negative imaging, or generic nursing status into A/P items.",
              "Consult recommendations usually belong in tasks or planItems; nursing notes usually belong in overnightEvents, tasks, redFlags, or dischargeIssues depending on urgency.",
              "Red flags must be actionable and specific enough for handoff; avoid vague warnings like 'monitor closely' unless a trigger or threshold is included.",
              "For acute ischemic stroke without tPA/EVT/ICH/ACS/aortic dissection context, do not label BP as urgent uncontrolled if SBP <220 and DBP <120; use permissive HTN/BP-goal wording only when helpful.",
              "Tasks should start with an action verb when possible: f/u, repeat, call, consult, order, hold, resume, taper, DC, arrange, educate.",
              "For subjective.importantSymptoms and subjective.importantOvernightEvents, include only patient-reported or overnight items that should appear on the board/rounding list; otherwise return empty arrays.",
              "For S/O/A/P importance, be selective: mark isImportant true only when the item affects today's rounds, orders, handoff, discharge readiness, or safety.",
              "Put vital signs in objective.vitals and bedside blood sugar, glucose stick, AC/PC glucose, or SMBG values in objective.bloodSugars.",
              "Prefer concise fragments over long sentences in symptoms, PE findings, interpretations, assessment summaries, evidence items, plan items, red flags, tasks, discharge issues, and thinking prompts.",
              "PE output must contain abnormal/actionable findings only. Avoid full sentences and omit normal exam templates unless a negative finding directly changes management.",
              "Never place CT/MRI/CXR/EGD report text, report impressions, or HPI/admission narrative inside physicalExam. PE is bedside exam only.",
              "Image output must be extremely short: studyType plus the key actionable impression only. Do not copy report prose, numbered lists, or normal/negative details unless they change management.",
              "For image reports, extract only study/date plus key impression. Do not copy clinical history, report boilerplate, technique, or long narrative.",
              "A/P output must be compact: problemTitle under 6 words, assessmentSummary under 12 words, evidenceOrCourseItems under 8 words each, planItems under 8 words each.",
              "A/P output should include the active diagnoses that matter today, not the first or easiest diagnosis. If today's pasted data does not change assessment/plan, return an empty assessmentPlan array.",
              "Do not repeat the same fact across assessmentSummary, evidence, and plan; keep the most useful place only.",
              "Tasks and red flags should be action labels under 10 words when possible.",
              "Identify possible red flags, pending tasks, discharge issues, uncertainty, and thinking prompts.",
              "Thinking prompts are questions for clinician review, not medical orders.",
              "Do not include patient names, full MRNs, ID numbers, birthday, phone, address, or identifiable image details.",
              "If identifiers appear in the text, do not repeat them; mention de-identification concern in uncertainty.",
              "The output is draft only and must be reviewed by a clinician before saving.",
            ].join(" "),
          },
          {
            role: "user",
            content: makePrompt(sourceType, rawText, patientContext),
          },
        ],
        text: {
          verbosity: tuning.textVerbosity,
          format: {
            type: "json_schema",
            name: "ai_soap_draft",
            description: "Structured SOAP draft for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: aiSoapDraftSchema,
          },
        },
      },
    });

    if (!openAiResponse.ok) {
      throw new HttpsError("internal", getOpenAiErrorMessage(openAiResponse.status, responseBody));
    }

    const refusal = extractRefusal(responseBody);
    if (refusal) {
      throw new HttpsError("failed-precondition", refusal);
    }

    const outputText = extractOutputText(responseBody);
    if (!outputText) {
      throw new HttpsError("internal", "OpenAI returned no JSON draft.");
    }

    let draft: unknown;
    try {
      draft = JSON.parse(outputText);
    } catch (error) {
      logger.error("Failed to parse OpenAI JSON", {
        errorName: error instanceof Error ? error.name : "unknown",
        model,
      });
      throw new HttpsError("internal", "OpenAI returned malformed JSON.");
    }

    const rawTextPreview = storeRawText ? rawText.slice(0, 700) : "";
    const draftRef = patientRef.collection("aiDrafts").doc();
    await createPatientAiDraftAtomically(patientRef, draftRef, {
      sourceType,
      rawTextPreview,
      rawTextChars: rawText.length,
      ...buildAiDraftRawTextRetention(rawText, storeRawText),
      draft,
      status: "draft",
      createdAt: FieldValue.serverTimestamp(),
      model,
    });

    return {
      draftId: draftRef.id,
      draft,
      model,
      rawTextPreview,
    };
  },
);

export const generateClinicalDocument = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required before using AI document generation.");
    }

    const data = request.data as DocumentCallableInput;
    const uid = request.auth.uid;
    const patientId = String(data.patientId ?? "").trim();
    const documentType = String(data.documentType ?? "") as DocumentType;
    const rawText = String(data.rawText ?? "").trim();
    const dateFrom = String(data.dateFrom ?? "").trim();
    const dateTo = String(data.dateTo ?? "").trim();
    const deidentifiedConfirmed = data.deidentifiedConfirmed === true;
    const storeRawText = data.storeRawText === true;
    const requestedQualityMode = sanitizeQualityMode(data.qualityMode);
    const qualityMode = resolveDocumentQuality(requestedQualityMode, documentType, rawText);

    if (!documentTypes.has(documentType)) {
      throw new HttpsError("invalid-argument", "Invalid AI document type.");
    }

    if (!deidentifiedConfirmed) {
      throw new HttpsError("failed-precondition", "Confirm that all text and existing patient notes are de-identified before generation.");
    }

    if (rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new HttpsError("invalid-argument", `Text is too long. Limit pasted input to ${MAX_RAW_TEXT_CHARS} characters.`);
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "AI document generation is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const userRef = db.doc(`users/${uid}`);
    const patientRef = patientId ? db.doc(`users/${uid}/patients/${patientId}`) : null;
    const patientSnapshot = patientRef ? await patientRef.get() : null;
    if (patientRef && !patientSnapshot?.exists) {
      throw new HttpsError("not-found", "Patient was not found for this signed-in user.");
    }

    const patientData = patientSnapshot?.data();
    if (patientData && String(patientData.status ?? "active") !== "active") {
      throw new HttpsError("failed-precondition", "AI Documents only supports active patients. Use Other patient for standalone drafts.");
    }

    const notesSnapshot = patientRef ? await patientRef.collection("dailyNotes").orderBy("date", "asc").get() : null;
    const dailyNotes = notesSnapshot
      ? notesSnapshot.docs
          .map((noteDoc) => compactDailyNote(noteDoc.id, noteDoc.data()))
          .filter((note) => (!dateFrom || note.date >= dateFrom) && (!dateTo || note.date <= dateTo))
          .slice(-30)
      : [];

    if (documentType === "weeklySummary" && dailyNotes.length === 0 && rawText.length < 20) {
      throw new HttpsError("invalid-argument", "No SOAP notes were found in the selected date range.");
    }

    if (documentType === "admissionNote" && rawText.length < 20) {
      throw new HttpsError("invalid-argument", "Paste de-identified admission source text before generating an admission note.");
    }

    if (!patientRef && rawText.length < 20) {
      throw new HttpsError("invalid-argument", "Paste de-identified source text before generating a standalone draft.");
    }

    const requestedModel = getModelForQuality(qualityMode);
    const tuning = getResponseTuning(qualityMode, "document");
    const { response: openAiResponse, body: responseBody, model } = await postOpenAiResponse({
      apiKey,
      model: requestedModel,
      qualityMode,
      payload: {
        reasoning: tuning.reasoning,
        max_output_tokens: tuning.max_output_tokens,
        prompt_cache_key: `${tuning.prompt_cache_key}:${documentType}`,
        input: [
          {
            role: "system",
            content: [
              "You write clinician-reviewed internal medicine documentation drafts.",
              "Return JSON only matching the supplied schema.",
              documentInstructions(documentType),
              "The output is a draft only and must be reviewed by the clinician before saving.",
            ].join(" "),
          },
          {
            role: "user",
            content: makeDocumentPrompt({
              documentType,
              rawText,
              dateFrom,
              dateTo,
              patientContext: compactPatientContext(patientData),
              dailyNotes,
            }),
          },
        ],
        text: {
          verbosity: tuning.textVerbosity,
          format: {
            type: "json_schema",
            name: "ai_clinical_document_draft",
            description: "Structured clinical document draft for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: aiDocumentDraftSchema,
          },
        },
      },
    });

    if (!openAiResponse.ok) {
      throw new HttpsError("internal", getOpenAiErrorMessage(openAiResponse.status, responseBody));
    }

    const refusal = extractRefusal(responseBody);
    if (refusal) {
      throw new HttpsError("failed-precondition", refusal);
    }

    const outputText = extractOutputText(responseBody);
    if (!outputText) {
      throw new HttpsError("internal", "OpenAI returned no JSON document draft.");
    }

    let draft: unknown;
    try {
      draft = JSON.parse(outputText);
    } catch (error) {
      logger.error("Failed to parse OpenAI document JSON", {
        errorName: error instanceof Error ? error.name : "unknown",
        model,
      });
      throw new HttpsError("internal", "OpenAI returned malformed JSON.");
    }

    const rawTextPreview = storeRawText ? rawText.slice(0, 700) : "";
    const draftRef = patientRef ? patientRef.collection("aiDrafts").doc() : userRef.collection("aiDrafts").doc();
    const draftData = {
      sourceType: "document",
      documentType,
      ...(patientId ? { patientId } : { patientId: "", standalone: true }),
      rawTextPreview,
      rawTextChars: rawText.length,
      ...buildAiDraftRawTextRetention(rawText, storeRawText),
      dateFrom,
      dateTo,
      draft,
      status: "draft",
      createdAt: FieldValue.serverTimestamp(),
      model,
      qualityMode,
    };
    if (patientRef) {
      await createPatientAiDraftAtomically(patientRef, draftRef, draftData);
    } else {
      await draftRef.set(draftData);
    }

    return {
      draftId: draftRef.id,
      draft,
      model,
      qualityMode,
      rawTextPreview,
    };
  },
);
