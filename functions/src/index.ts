import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

admin.initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_RAW_TEXT_CHARS = 18000;

const sourceTypes = new Set([
  "mixed",
  "dailyUpdate",
  "admission",
  "vitals",
  "lab",
  "image",
  "progress",
  "consult",
  "nursing",
]);

const documentTypes = new Set([
  "admissionNote",
  "admissionSummary",
  "dischargeHospitalCourse",
  "weeklySummary",
  "isbar",
]);

const stringSchema = { type: "string" } as const;
const booleanSchema = { type: "boolean" } as const;

const aiSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "oneLiner",
    "admissionSummary",
    "isbarHandoff",
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
    admissionSummary: stringSchema,
    isbarHandoff: stringSchema,
    subjective: {
      type: "object",
      additionalProperties: false,
      required: ["chiefConcern", "symptoms", "overnightEvents", "importantSymptoms", "importantOvernightEvents"],
      properties: {
        chiefConcern: stringSchema,
        symptoms: { type: "array", items: stringSchema },
        overnightEvents: { type: "array", items: stringSchema },
        importantSymptoms: { type: "array", items: stringSchema },
        importantOvernightEvents: { type: "array", items: stringSchema },
      },
    },
    objective: {
      type: "object",
      additionalProperties: false,
      required: ["vitals", "bloodSugars", "physicalExam", "labs", "images"],
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
        bloodSugars: {
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

const aiDocumentDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "title", "conciseSummary", "sections", "followUpItems", "uncertainty"],
  properties: {
    documentType: {
      type: "string",
      enum: ["admissionNote", "admissionSummary", "dischargeHospitalCourse", "weeklySummary", "isbar"],
    },
    title: stringSchema,
    conciseSummary: stringSchema,
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "content"],
        properties: {
          heading: stringSchema,
          content: stringSchema,
        },
      },
    },
    followUpItems: { type: "array", items: stringSchema },
    uncertainty: { type: "array", items: stringSchema },
  },
} as const;

type SourceType =
  | "mixed"
  | "dailyUpdate"
  | "admission"
  | "vitals"
  | "lab"
  | "image"
  | "progress"
  | "consult"
  | "nursing";

type DocumentType =
  | "admissionNote"
  | "admissionSummary"
  | "dischargeHospitalCourse"
  | "weeklySummary"
  | "isbar";

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

interface DocumentCallableInput {
  patientId?: unknown;
  documentType?: unknown;
  rawText?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  deidentifiedConfirmed?: unknown;
  storeRawText?: unknown;
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

function makePrompt(sourceType: SourceType, rawText: string, patientContext: Record<string, unknown> | undefined) {
  const workflowIntent =
    sourceType === "dailyUpdate"
      ? [
          "Workflow intent:",
          "Today update mode. The clinician may paste mixed V/S, labs, image reports, progress snippets, consults, and nursing notes.",
          "Use the existing context as yesterday's baseline only. Return only new or changed clinically relevant items from the pasted text.",
          "If pasted V/S are stable, include them in objective.vitals only when useful for recordkeeping and keep isImportant false; do not create S/O/A/P from stable V/S.",
          "If labs/images are unchanged or non-actionable, omit A/P and red flags unless they change today's management.",
          "If a new diagnosis, complication, discharge blocker, pending task, or safety issue appears, surface it clearly and mark it important.",
          "",
        ].join("\n")
      : "";
  const clinicalRoutingRules = [
    "Clinical routing rules:",
    "- Think like an inpatient IM resident preparing handover: classify each fact into the one place where it is most useful; do not scatter the same fact across multiple fields.",
    "- Subjective: patient-reported symptoms, new complaints, family concerns, and overnight events only. Do not put labs, imaging, plans, or consultant recommendations here.",
    "- Objective: V/S, bedside sugar, PE, labs, and imaging only. Mark isImportant true only for abnormal, changing, management-relevant, or handoff-relevant data.",
    "- A/P: active problems that change today's management or attending-level understanding. Each problem should have a short label, evidence/course, and concrete plan. Do not create A/P for stable routine values.",
    "- Tasks: actionable work for today or overnight, including f/u labs/images/cultures, consult calls, orders, family communication, discharge paperwork, and reminders.",
    "- Red flags: immediate safety or call-threshold items only, such as unstable V/S, active bleeding, sepsis/shock concern, ACS/stroke concern, worsening oxygenation, dangerous electrolyte/glucose/renal changes, or high-risk pending result.",
    "- Discharge issues: barriers, target date, placement, home oxygen, OPD/follow-up, medications, certificates, or family/social issues affecting discharge.",
    "- Thinking prompts: questions for clinician review only when the text suggests a real diagnostic or management uncertainty; avoid generic textbook prompts.",
    "- Consult/nursing notes often become tasks, red flags, discharge issues, or overnight events; do not promote them to confirmed diagnoses unless supported by the source text or existing context.",
    "- Lab-only or image-only input should usually produce objective findings plus tasks/red flags if needed, not a new admissionSummary or broad SOAP rewrite.",
    "- Prefer short hand-written clinical fragments over polished prose. Examples: 'AKI on CKD, Cr 2.1 from 1.4, hold ACEi, f/u I/O'; 'CXR RLL opacity, cont ceftriaxone, f/u sputum Cx'.",
    "",
  ].join("\n");
  const intakeTargets = [
    "Messy chart extraction target:",
    "- Treat pasted text as unordered chart fragments; remove duplicated, stale, administrative, and low-signal lines.",
    "- Surface only information that changes rounding, orders, handoff safety, discharge planning, or attending-level understanding.",
    "- Prioritize: why admitted, important PMH, active problems, major prior hospital course, today's meaningful updates, tasks/pending items/red flags, key labs/images/antibiotics/procedures/consults/disposition.",
    "- Keep all output concise and scannable. Use common IM abbreviations when unambiguous.",
    "- admissionSummary: 3-4 compact attending-rounds sentences. Include admission reason, PMH/context, major course, current active problems, today/pending/dispo. Leave empty only if the pasted text has no admission/course context.",
    "- isbarHandoff: concise iSBAR with headings exactly Identify, Situation, Background, Assessment, Recommendation. Include red flags, pending tasks, contingency/call parameters, and disposition. Leave empty only if there is too little patient context.",
    "- For vitals/lab/image-only source types, do not fabricate admissionSummary or isbarHandoff from isolated data; leave those fields empty unless the pasted text includes enough broader context.",
    "",
  ].join("\n");

  return [
    "Source type:",
    sourceType,
    "",
    workflowIntent,
    clinicalRoutingRules,
    intakeTargets,
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

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function compactPatientContext(data: FirebaseFirestore.DocumentData | undefined) {
  const patient = asPlainObject(data);
  return {
    age: patient.age ?? "",
    sex: patient.sex ?? "",
    admissionDate: patient.admissionDate ?? "",
    primaryDiagnosis: patient.primaryDiagnosis ?? "",
    oneLiner: patient.oneLiner ?? "",
    pmh: patient.underlyingDiseases ?? "",
    activeProblems: patient.activeProblems ?? "",
    chiefComplaint: patient.chiefComplaint ?? patient.admissionChiefConcern ?? "",
    hpi: patient.presentIllnessOrHPI ?? patient.hpiOrAdmissionStory ?? "",
    admissionSummary: patient.generatedAdmissionSummary ?? patient.admissionBriefFreeText ?? "",
    isbarHandoff: patient.generatedSbarNote ?? "",
    admissionNote: patient.generatedAdmissionNote ?? patient.admissionBriefNotes ?? "",
    initialPhysicalExam: patient.initialPhysicalExam ?? "",
    initialLabs: patient.initialLabs ?? "",
    initialImaging: patient.initialImaging ?? "",
    initialAssessment: patient.initialAssessment ?? "",
    initialPlan: patient.initialPlan ?? "",
    earlyHospitalCourse: patient.earlyHospitalCourse ?? "",
    hospitalCourseHighlights: patient.hospitalCourseHighlights ?? "",
    redFlags: patient.importantRedFlags ?? "",
    dischargePlan: patient.dischargePlan ?? "",
    dischargeBarriers: patient.dischargeBarriers ?? "",
    latestVitals: patient.vitalSigns ?? "",
    latestBloodSugar: patient.bloodSugar ?? "",
    latestPE: patient.physicalExam ?? "",
    latestLabs: patient.newLabs ?? patient.rawLabText ?? "",
    latestImages: patient.newImaging ?? "",
    latestAssessment: patient.assessment ?? "",
    latestPlan: patient.plan ?? "",
    currentAssessmentPlan: Array.isArray(patient.assessmentPlanItems)
      ? patient.assessmentPlanItems.slice(0, 12).map((item) => ({
          problemTitle: asPlainObject(item).problemTitle ?? "",
          assessmentSummary: asPlainObject(item).assessmentSummary ?? "",
          planItems: asPlainObject(item).planItems ?? [],
        }))
      : [],
    currentTasks: Array.isArray(patient.tasks)
      ? patient.tasks
          .filter((task) => asPlainObject(task).done !== true)
          .slice(0, 20)
          .map((task) => ({
            text: asPlainObject(task).text ?? "",
            priority: asPlainObject(task).priority ?? "",
            dueDate: asPlainObject(task).dueDate ?? "",
            category: asPlainObject(task).category ?? "",
          }))
      : [],
  };
}

function compactDailyNote(noteId: string, data: FirebaseFirestore.DocumentData) {
  const note = asPlainObject(data);
  return {
    date: String(note.date ?? noteId),
    redFlags: note.importantRedFlags ?? "",
    overnight: note.overnightEvents ?? "",
    subjective: note.subjectiveOrChiefConcern ?? "",
    vitalSigns: note.vitalSigns ?? "",
    bloodSugar: note.bloodSugar ?? "",
    physicalExam: note.physicalExam ?? "",
    labs: note.rawLabText ?? note.labSummary ?? "",
    images: note.imageSummary ?? "",
    assessment: note.assessment ?? "",
    plan: note.plan ?? "",
    dischargePlan: note.dischargePlan ?? "",
  };
}

function documentTypeLabel(documentType: DocumentType) {
  const labels: Record<DocumentType, string> = {
    admissionNote: "Admission note",
    admissionSummary: "Admission summary for quick attending rounds",
    dischargeHospitalCourse: "Discharge hospital course",
    weeklySummary: "Weekly progress summary",
    isbar: "iSBAR handoff note",
  };
  return labels[documentType];
}

function documentInstructions(documentType: DocumentType) {
  const shared = [
    "Use concise inpatient IM style with common unambiguous medical abbreviations.",
    "Do not invent missing data; mark absent or unclear details in uncertainty.",
    "Preserve dates, lab values, units, medication names, image findings, and pending items exactly when available.",
    "Use de-identified content only; do not repeat names, full MRNs, IDs, birthday, phone, address, or identifiable image details.",
    "Do not use bullet lists unless the requested document type is iSBAR.",
  ];

  const byType: Record<DocumentType, string[]> = {
    admissionNote: [
      "Return exactly two sections: C.C and PI.",
      "C.C must be one short paragraph, not a list.",
      "PI must be a clinical case-history paragraph, not bullet points.",
      "Do not create PMH, Baseline, V/S, PE, Lab, Image, Assessment, Plan, Early course, or Pending sections.",
      "If PMH, V/S, lab, image, consult, or nursing data are clinically relevant to the admission story, weave them into the PI paragraph.",
      "Use conciseSummary as a one-sentence admission summary.",
    ],
    admissionSummary: [
      "Create a short attending-rounds admission summary in one compact paragraph.",
      "Write like a senior IM resident's hand-written admission brief: diagnosis-oriented, clinically selective, and ready to paste into the rounding list.",
      "Use this mental order without headings: admitted for/initial presentation, key PMH/context, major course/objective anchors, current active issues and today/pending/disposition.",
      "Emphasize why admitted, important PMH/context, key positive/negative findings, active problems, major prior course, today's important changes, initial/current treatment, and pending/disposition decisions.",
      "Exclude trivial daily stable updates unless they affect management, safety, discharge, or handoff.",
      "Keep to 3-4 sentences; do not output a long admission note or every normal result.",
      "Use conciseSummary as the best one-paragraph presentation.",
    ],
    dischargeHospitalCourse: [
      "Return exactly one section with heading Hospital Course.",
      "Write one hospital-course paragraph only, not bullet points and not problem-by-problem headings.",
      "Include important treatments, major tests, complications, response, current status, and unresolved key issues within that paragraph.",
      "Do not write discharge medications, follow-up appointments, or separate assessment/plan sections unless they are essential to the course paragraph.",
      "Keep followUpItems empty unless an item is critical to mention separately.",
    ],
    weeklySummary: [
      "Return exactly one section with heading Weekly Summary.",
      "The content must start exactly with: During this week,",
      "Write one paragraph only, not bullet points.",
      "Summarize the selected SOAP notes chronologically with key changes, response to treatment, pending issues, and current plan.",
      "Keep followUpItems empty unless an item is critical to mention separately.",
    ],
    isbar: [
      "Return exactly five sections in this exact order: Identify, Situation, Background, Assessment, Recommendation.",
      "Target total length: 8-12 short clinical lines, under 180 words when possible.",
      "Identify: one line with bed/code if available, age/sex, attending/service if relevant, primary Dx/current working Dx; never use name, full MRN, birthday, phone, address, or ID.",
      "Situation: one or two lines describing why the patient needs handoff now and the current clinical status.",
      "Background: include only high-yield PMH, important prior hospital events, key procedures, antibiotics, consults, and major image/lab findings that matter for handoff.",
      "Assessment: include active problems, severity, red flags, and key abnormal objective data requiring attention.",
      "Recommendation: include overnight/today tasks, pending labs/images/consults, contingency plans, call thresholds, discharge/disposition plan, and what not to miss.",
      "Do not include routine normal data, duplicated diagnosis paragraphs, generic legal disclaimers, empty sections, long admission-note prose, copied full lab panels, or low-signal stable daily updates.",
      "Put pending tasks and uncertainty inside Recommendation when possible; use followUpItems or uncertainty only if a critical item does not fit in the five sections.",
    ],
  };

  return [...shared, ...byType[documentType]].join(" ");
}

function makeDocumentPrompt(params: {
  documentType: DocumentType;
  rawText: string;
  dateFrom: string;
  dateTo: string;
  patientContext: Record<string, unknown>;
  dailyNotes: Array<Record<string, unknown>>;
}) {
  return [
    "Document type:",
    documentTypeLabel(params.documentType),
    "",
    "Date range:",
    JSON.stringify({ from: params.dateFrom, to: params.dateTo }),
    "",
    "Allowed de-identified patient context:",
    JSON.stringify(params.patientContext, null, 2),
    "",
    "SOAP notes in requested range:",
    JSON.stringify(params.dailyNotes, null, 2),
    "",
    "Additional de-identified pasted text:",
    params.rawText || "(none)",
  ].join("\n");
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
    const patientContext = {
      ...compactPatientContext(patientSnapshot.data()),
      ...(sanitizePatientContext(data.patientContext) ?? {}),
    };
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
              "Keep all SOAP-facing text concise and easy to scan for inpatient IM rounds.",
              "Always also return admissionSummary and isbarHandoff for pasted admission, mixed, progress, consult, nursing, or daily-update chart text when enough context exists.",
              "admissionSummary must be attending-ready: why admitted, important PMH/context, major hospital course, current active problems, today/pending/disposition, in 3-5 compact sentences.",
              "isbarHandoff must use headings Identify, Situation, Background, Assessment, Recommendation, with contingency plans, pending tasks, red flags, and call parameters when available.",
              "Assume the reviewer slept 3 hours and has seconds per patient: use telegraphic clinical fragments, not polished prose.",
              "Use the allowed patient context only to judge relevance and importance. Do not convert context-only facts into new SOAP draft items unless the pasted text explicitly supports them.",
              "For sourceType dailyUpdate, behave like a delta updater: compare pasted text against context and output only clinically meaningful new/changed items.",
              "For sourceType vitals, return only objective.vitals/objective.bloodSugars plus truly urgent redFlags/tasks caused by those values; leave oneLiner, admissionSummary, isbarHandoff, S, PE, labs, images, A/P, dischargeIssues, and thinkingPrompts empty unless the pasted vital data alone creates an immediate safety issue.",
              "If the source text contains only stable V/S, lab, image, consult, or nursing updates, leave unrelated S, PE, and A/P arrays empty rather than restating prior SOAP context.",
              "Use common, unambiguous medical abbreviations when they save space, such as c/f, r/o, s/p, SOB, CP, N/V, Abd, CV, Resp, Neuro, HEENT, MSK, WBC, Hb, Plt, Cr, Na, K, AST, ALT, CRP, UA, U/C, B/C, CXR, CT, MRI, U/S, Abx, cont, hold, f/u, pending, DC, OPD.",
              "Avoid rare or ambiguous abbreviations, and do not abbreviate in a way that changes clinical meaning.",
              "For diagnosis-like summaries, prefer short clinical labels over prose, e.g. AIS NIHSS3, R MCA stenosis, UTI, PMB, HF, AKI, PNA, sepsis.",
              "Do not copy long PMH medication histories into SOAP-facing fields; preserve PMH concepts as short comorbidity labels when needed.",
              "Route each clinical fact to the single most useful destination: subjective for symptoms/events, objective for measured data, A/P for active management problems, tasks for work to do, redFlags for immediate safety/call thresholds, dischargeIssues for barriers/disposition, and uncertainty/thinkingPrompts only for real clinician-review questions.",
              "Do not convert normal stable V/S, unchanged chronic problems, routine negative imaging, or generic nursing status into A/P items.",
              "Consult recommendations usually belong in tasks or planItems; nursing notes usually belong in overnightEvents, tasks, redFlags, or dischargeIssues depending on urgency.",
              "Red flags must be actionable and specific enough for handoff; avoid vague warnings like 'monitor closely' unless a trigger or threshold is included.",
              "Tasks should start with an action verb when possible: f/u, repeat, call, consult, order, hold, resume, taper, DC, arrange, educate.",
              "For subjective.importantSymptoms and subjective.importantOvernightEvents, include only patient-reported or overnight items that should appear on the board/rounding list; otherwise return empty arrays.",
              "For S/O/A/P importance, be selective: mark isImportant true only when the item affects today's rounds, orders, handoff, discharge readiness, or safety.",
              "Put vital signs in objective.vitals and bedside blood sugar, glucose stick, AC/PC glucose, or SMBG values in objective.bloodSugars.",
              "Prefer concise fragments over long sentences in symptoms, PE findings, interpretations, assessment summaries, evidence items, plan items, red flags, tasks, discharge issues, and thinking prompts.",
              "PE output must contain abnormal/actionable findings only. Avoid full sentences and omit normal exam templates unless a negative finding directly changes management.",
              "Image output must be extremely short: studyType plus the key actionable impression only. Do not copy report prose, numbered lists, or normal/negative details unless they change management.",
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

    const userRef = admin.firestore().doc(`users/${uid}`);
    const patientRef = patientId ? admin.firestore().doc(`users/${uid}/patients/${patientId}`) : null;
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

    const model = getModel();
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
          format: {
            type: "json_schema",
            name: "ai_clinical_document_draft",
            description: "Structured clinical document draft for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: aiDocumentDraftSchema,
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
      throw new HttpsError("internal", "OpenAI returned no JSON document draft.");
    }

    let draft: unknown;
    try {
      draft = JSON.parse(outputText);
    } catch (error) {
      logger.error("Failed to parse OpenAI document JSON", { error });
      throw new HttpsError("internal", "OpenAI returned malformed JSON.");
    }

    const rawTextPreview = rawText.slice(0, 700);
    const draftRef = patientRef ? patientRef.collection("aiDrafts").doc() : userRef.collection("aiDrafts").doc();
    await draftRef.set({
      sourceType: "document",
      documentType,
      ...(patientId ? { patientId } : { patientId: "", standalone: true }),
      rawTextPreview,
      ...(storeRawText ? { rawText } : {}),
      dateFrom,
      dateTo,
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
