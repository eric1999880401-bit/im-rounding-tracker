import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

admin.initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_RAW_TEXT_CHARS = 12000;

const sourceTypes = new Set([
  "mixed",
  "admission",
  "vitals",
  "lab",
  "image",
  "progress",
  "consult",
  "nursing",
]);

const stringSchema = { type: "string" } as const;
const booleanSchema = { type: "boolean" } as const;

const aiSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "oneLiner",
    "subjective",
    "objective",
    "assessmentPlan",
    "redFlags",
    "tasks",
    "dischargeIssues",
    "thinkingPrompts",
    "uncertainty",
  ],
  properties: {
    oneLiner: stringSchema,
    subjective: {
      type: "object",
      additionalProperties: false,
      required: ["chiefConcern", "symptoms", "overnightEvents"],
      properties: {
        chiefConcern: stringSchema,
        symptoms: { type: "array", items: stringSchema },
        overnightEvents: { type: "array", items: stringSchema },
      },
    },
    objective: {
      type: "object",
      additionalProperties: false,
      required: ["vitals", "physicalExam", "labs", "images"],
      properties: {
        vitals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "name", "value", "interpretation", "isAbnormal", "isImportant"],
            properties: {
              date: stringSchema,
              name: stringSchema,
              value: stringSchema,
              interpretation: stringSchema,
              isAbnormal: booleanSchema,
              isImportant: booleanSchema,
            },
          },
        },
        physicalExam: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["system", "finding", "isImportant"],
            properties: {
              system: stringSchema,
              finding: stringSchema,
              isImportant: booleanSchema,
            },
          },
        },
        labs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "date",
              "group",
              "name",
              "value",
              "unit",
              "previousValue",
              "isAbnormal",
              "isImportant",
              "interpretation",
            ],
            properties: {
              date: stringSchema,
              group: stringSchema,
              name: stringSchema,
              value: stringSchema,
              unit: stringSchema,
              previousValue: stringSchema,
              isAbnormal: booleanSchema,
              isImportant: booleanSchema,
              interpretation: stringSchema,
            },
          },
        },
        images: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "studyType", "finding", "impression", "isImportant"],
            properties: {
              date: stringSchema,
              studyType: stringSchema,
              finding: stringSchema,
              impression: stringSchema,
              isImportant: booleanSchema,
            },
          },
        },
      },
    },
    assessmentPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problemTitle", "assessmentSummary", "evidenceOrCourseItems", "planItems", "isImportant"],
        properties: {
          problemTitle: stringSchema,
          assessmentSummary: stringSchema,
          evidenceOrCourseItems: { type: "array", items: stringSchema },
          planItems: { type: "array", items: stringSchema },
          isImportant: booleanSchema,
        },
      },
    },
    redFlags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "reason"],
        properties: {
          text: stringSchema,
          reason: stringSchema,
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "priority", "dueDate", "category"],
        properties: {
          text: stringSchema,
          priority: { type: "string", enum: ["urgent", "normal", "low"] },
          dueDate: stringSchema,
          category: stringSchema,
        },
      },
    },
    dischargeIssues: { type: "array", items: stringSchema },
    thinkingPrompts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "reason"],
        properties: {
          prompt: stringSchema,
          reason: stringSchema,
        },
      },
    },
    uncertainty: { type: "array", items: stringSchema },
  },
} as const;

type SourceType =
  | "mixed"
  | "admission"
  | "vitals"
  | "lab"
  | "image"
  | "progress"
  | "consult"
  | "nursing";

interface CallableInput {
  patientId?: unknown;
  sourceType?: unknown;
  rawText?: unknown;
  deidentifiedConfirmed?: unknown;
  storeRawText?: unknown;
  patientContext?: {
    age?: unknown;
    sex?: unknown;
    pmh?: unknown;
    activeProblems?: unknown;
    currentAssessmentPlan?: unknown;
  };
}

function getOpenAiApiKey() {
  try {
    const secretValue = OPENAI_API_KEY.value();
    if (secretValue) return secretValue;
  } catch {
    // Local emulator fallback below.
  }

  return process.env.OPENAI_API_KEY ?? "";
}

function getModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function sanitizePatientContext(input: CallableInput["patientContext"]) {
  if (!input || typeof input !== "object") return undefined;

  return {
    age: String(input.age ?? "").trim(),
    sex: String(input.sex ?? "").trim(),
    pmh: asStringArray(input.pmh),
    activeProblems: asStringArray(input.activeProblems),
    currentAssessmentPlan: Array.isArray(input.currentAssessmentPlan) ? input.currentAssessmentPlan.slice(0, 20) : [],
  };
}

function extractOutputText(response: Record<string, unknown>) {
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

function extractRefusal(response: Record<string, unknown>) {
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

function makePrompt(sourceType: SourceType, rawText: string, patientContext: ReturnType<typeof sanitizePatientContext>) {
  return [
    "Source type:",
    sourceType,
    "",
    "Allowed patient context, if provided:",
    JSON.stringify(patientContext ?? {}, null, 2),
    "",
    "De-identified clinical text:",
    rawText,
  ].join("\n");
}

function getOpenAiErrorMessage(status: number, responseBody: Record<string, unknown>) {
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

    const patientRef = admin.firestore().doc(`users/${uid}/patients/${patientId}`);
    const patientSnapshot = await patientRef.get();
    if (!patientSnapshot.exists) {
      throw new HttpsError("not-found", "Patient was not found for this signed-in user.");
    }

    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "AI Intake is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const model = getModel();
    const patientContext = sanitizePatientContext(data.patientContext);
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              "You organize de-identified internal medicine clinical text into a SOAP draft.",
              "Return JSON only matching the supplied schema.",
              "Do not invent missing data. Use empty strings or empty arrays when data is absent.",
              "Preserve dates, lab values, units, and abnormal findings exactly when available.",
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
          format: {
            type: "json_schema",
            name: "ai_soap_draft",
            description: "Structured SOAP draft for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: aiSoapDraftSchema,
          },
        },
      }),
    });

    const responseBody = (await openAiResponse.json().catch(() => ({}))) as Record<string, unknown>;
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
      logger.error("Failed to parse OpenAI JSON", { error });
      throw new HttpsError("internal", "OpenAI returned malformed JSON.");
    }

    const rawTextPreview = rawText.slice(0, 700);
    const draftRef = patientRef.collection("aiDrafts").doc();
    await draftRef.set({
      sourceType,
      rawTextPreview,
      ...(storeRawText ? { rawText } : {}),
      draft,
      status: "draft",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
