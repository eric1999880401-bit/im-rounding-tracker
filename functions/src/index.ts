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

const taskCategories = new Set(["lab", "imaging", "consult", "discharge", "family", "order", "other"]);

const stringSchema = { type: "string" } as const;
const booleanSchema = { type: "boolean" } as const;

const clinicalReasoningSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currentClinicalState",
    "primaryRisk",
    "whyThisMatters",
    "activeProblemsRanked",
    "resolvedOrLessImportant",
    "missingDataNeeded",
    "noiseToIgnore",
  ],
  properties: {
    currentClinicalState: stringSchema,
    primaryRisk: stringSchema,
    whyThisMatters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "source", "implication"],
        properties: {
          fact: stringSchema,
          source: stringSchema,
          implication: stringSchema,
        },
      },
    },
    activeProblemsRanked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problem", "status", "whyImportant", "evidence", "todayPlan", "callThresholds"],
        properties: {
          problem: stringSchema,
          status: { type: "string", enum: ["active", "improving", "resolved", "uncertain"] },
          whyImportant: stringSchema,
          evidence: { type: "array", items: stringSchema },
          todayPlan: { type: "array", items: stringSchema },
          callThresholds: { type: "array", items: stringSchema },
        },
      },
    },
    resolvedOrLessImportant: { type: "array", items: stringSchema },
    missingDataNeeded: { type: "array", items: stringSchema },
    noiseToIgnore: { type: "array", items: stringSchema },
  },
} as const;

const aiSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "oneLiner",
    "admissionSummary",
    "isbarHandoff",
    "clinicalReasoning",
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
    clinicalReasoning: clinicalReasoningSchema,
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
  required: ["documentType", "title", "conciseSummary", "clinicalReasoning", "sections", "followUpItems", "uncertainty"],
  properties: {
    documentType: {
      type: "string",
      enum: ["admissionNote", "admissionSummary", "dischargeHospitalCourse", "weeklySummary", "isbar"],
    },
    title: stringSchema,
    conciseSummary: stringSchema,
    clinicalReasoning: clinicalReasoningSchema,
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

const roundSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["soapText", "warnings", "highlightHints"],
  properties: {
    soapText: stringSchema,
    warnings: { type: "array", items: stringSchema },
    highlightHints: { type: "array", items: stringSchema },
  },
} as const;

const patientImportDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "status",
    "matchPatientId",
    "sourceIndex",
    "bed",
    "patientCode",
    "age",
    "sex",
    "attending",
    "teamOrService",
    "primaryDiagnosis",
    "oneLiner",
    "chiefComplaint",
    "todayUpdates",
    "vitalSigns",
    "physicalExam",
    "labText",
    "imageText",
    "admissionSummary",
    "underlyingDiseases",
    "activeProblems",
    "hospitalCourseHighlights",
    "importantRedFlags",
    "tasks",
    "antibioticsProceduresConsults",
    "dischargePlan",
    "disposition",
    "uncertainty",
    "sourceExcerpt",
  ],
  properties: {
    id: stringSchema,
    status: { type: "string", enum: ["new", "updateCandidate"] },
    matchPatientId: stringSchema,
    sourceIndex: { type: "number" },
    bed: stringSchema,
    patientCode: stringSchema,
    age: stringSchema,
    sex: { type: "string", enum: ["M", "F", "Other", ""] },
    attending: stringSchema,
    teamOrService: stringSchema,
    primaryDiagnosis: stringSchema,
    oneLiner: stringSchema,
    chiefComplaint: stringSchema,
    todayUpdates: stringSchema,
    vitalSigns: stringSchema,
    physicalExam: stringSchema,
    labText: stringSchema,
    imageText: stringSchema,
    admissionSummary: stringSchema,
    underlyingDiseases: stringSchema,
    activeProblems: stringSchema,
    hospitalCourseHighlights: stringSchema,
    importantRedFlags: stringSchema,
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
          category: { type: "string", enum: ["lab", "imaging", "consult", "discharge", "family", "order", "other"] },
        },
      },
    },
    antibioticsProceduresConsults: { type: "array", items: stringSchema },
    dischargePlan: stringSchema,
    disposition: stringSchema,
    uncertainty: { type: "array", items: stringSchema },
    sourceExcerpt: stringSchema,
  },
} as const;

const patientBatchImportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["drafts"],
  properties: {
    drafts: {
      type: "array",
      items: patientImportDraftSchema,
    },
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
  };
}

interface RoundSoapCallableInput {
  patientId?: unknown;
  selectedDate?: unknown;
  sourceType?: unknown;
  workflowMode?: unknown;
  rawText?: unknown;
  currentSoapBaseline?: unknown;
  deidentifiedConfirmed?: unknown;
  qualityMode?: unknown;
  userStyleProfile?: unknown;
  patientContext?: CallableInput["patientContext"];
}

interface DocumentCallableInput {
  patientId?: unknown;
  documentType?: unknown;
  rawText?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  deidentifiedConfirmed?: unknown;
  storeRawText?: unknown;
  qualityMode?: unknown;
}

interface PatientBatchCallableInput {
  rawText?: unknown;
  deidentifiedConfirmed?: unknown;
  importMode?: unknown;
  targetPatientId?: unknown;
  existingPatients?: unknown;
}

type PatientBatchImportMode = "newAdmission" | "existingInpatient";

interface ExistingPatientForBatch {
  id: string;
  bed: string;
  patientCode: string;
  age: string;
  sex: string;
  attending: string;
  teamOrService: string;
  primaryDiagnosis: string;
  oneLiner: string;
  underlyingDiseases: string;
  activeProblems: string;
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

function sanitizeQualityMode(value: unknown) {
  const mode = String(value ?? "").trim();
  if (mode === "highAccuracy") return "highAccuracy";
  if (mode === "balanced") return "balanced";
  return "fast";
}

function getModelForQuality(qualityMode: "fast" | "balanced" | "highAccuracy") {
  if (qualityMode === "highAccuracy") {
    return process.env.OPENAI_MODEL_HIGH_ACCURACY || process.env.OPENAI_MODEL_BALANCED || getModel();
  }
  if (qualityMode === "balanced") {
    return process.env.OPENAI_MODEL_BALANCED || getModel();
  }
  return process.env.OPENAI_MODEL_FAST || getModel();
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
  };
}

function sanitizeUserStyleProfile(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const allowedTerms = new Set([
    "w/",
    "w/o",
    "s/p",
    "c/f",
    "r/o",
    "f/u",
    "cont",
    "Abx",
    "Cx",
    "B/C",
    "U/C",
    "Sputum Cx",
    "PNA",
    "UTI",
    "RF",
    "AKI",
    "CKD",
    "ESRD",
    "HD",
    "CHF",
    "HF",
    "AF",
    "CAD",
    "DM",
    "HTN",
    "COPD",
    "SpO2",
    "O2",
    "NC",
    "RA",
    "CT",
    "CXR",
    "MRI",
    "U/S",
    "EGD",
    "TTE",
    "OPD",
    "DC",
    "PRN",
  ]);
  const taskStyle = String(source.taskStyle ?? "concise");
  const apVoice = String(source.apVoice ?? "terse");
  const apOrganization = String(source.apOrganization ?? "problemStatusPlan");
  const abbreviationStyle = String(source.abbreviationStyle ?? "moderate");
  return {
    styleSummary: asStringArray(source.styleSummary).slice(0, 6),
    apVoice: ["terse", "balanced", "descriptive"].includes(apVoice) ? apVoice : "terse",
    apOrganization: ["problemStatusPlan", "problemEvidencePlan", "problemPlan", "mixed"].includes(apOrganization) ? apOrganization : "problemStatusPlan",
    abbreviationStyle: ["minimal", "moderate", "heavy"].includes(abbreviationStyle) ? abbreviationStyle : "moderate",
    preferredTerms: asStringArray(source.preferredTerms).filter((term) => allowedTerms.has(term)).slice(0, 12),
    taskStyle: ["concise", "checklist", "detailed"].includes(taskStyle) ? taskStyle : "concise",
    sectionOrder: asStringArray(source.sectionOrder).filter((item) => ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"].includes(item)).slice(0, 7),
    typicalApProblemCount: Math.max(1, Math.min(8, Number(source.typicalApProblemCount ?? source.apProblemCount) || 4)),
    typicalApLineLimit: Math.max(1, Math.min(4, Number(source.typicalApLineLimit ?? source.apLineLimit) || 2)),
  };
}

function truncateString(value: unknown, maxChars = 1200) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxChars);
}

function normalizeTextKey(value: string) {
  return value.toLowerCase().replace(/[\s#_\-.]/g, "").trim();
}

function sanitizeExistingPatientsForBatch(value: unknown): ExistingPatientForBatch[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 200)
    .map((item) => asPlainObject(item))
    .map((item) => ({
      id: truncateString(item.id, 120),
      bed: truncateString(item.bed, 80),
      patientCode: truncateString(item.patientCode, 120),
      age: truncateString(item.age, 12),
      sex: truncateString(item.sex, 20),
      attending: truncateString(item.attending, 120),
      teamOrService: truncateString(item.teamOrService, 120),
      primaryDiagnosis: truncateString(item.primaryDiagnosis, 220),
      oneLiner: truncateString(item.oneLiner, 240),
      underlyingDiseases: truncateString(item.underlyingDiseases, 500),
      activeProblems: truncateString(item.activeProblems, 500),
    }))
    .filter((item) => item.id && (item.bed || item.patientCode));
}

function sanitizePatientBatchImportMode(value: unknown): PatientBatchImportMode {
  return value === "newAdmission" ? "newAdmission" : "existingInpatient";
}

function findTargetPatientForBatch(targetPatientId: unknown, existingPatients: ExistingPatientForBatch[]) {
  const targetId = truncateString(targetPatientId, 120);
  if (!targetId) return undefined;
  return existingPatients.find((patient) => patient.id === targetId);
}

function isGenericClinicalFiller(value: string) {
  const clean = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!clean) return true;

  const hasConcreteTrigger =
    /\d|if\b|when\b|call\b|threshold|pending|f\/u|follow|repeat|hold|start|stop|resume|taper|consult|culture|lactate|troponin|\bk\b|\bcr\b|\bhb\b|o2|fio2|shock|bleed|fever|hypo|hyper|transfus/i.test(clean);
  if (hasConcreteTrigger) return false;

  return [
    "monitor closely",
    "continue to monitor",
    "close monitoring",
    "clinical correlation recommended",
    "follow clinically",
    "supportive care",
    "continue current management",
    "watch for deterioration",
    "no acute issue",
    "stable condition",
  ].some((phrase) => clean === phrase || clean.includes(phrase));
}

function cleanClinicalLines(value: unknown, maxLines = 10, maxChars = 1400) {
  return truncateString(value, maxChars * 2)
    .split(/\r?\n|;(?=\s*[A-Z#]|\s*[\u4e00-\u9fff])/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isGenericClinicalFiller(line))
    .slice(0, maxLines)
    .join("\n")
    .slice(0, maxChars);
}

function cleanClinicalArray(value: unknown, maxItems = 8, maxCharsPerItem = 180) {
  return asStringArray(value)
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, maxCharsPerItem))
    .filter((item) => !isGenericClinicalFiller(item))
    .slice(0, maxItems);
}

function maxBloodPressureInText(value: string) {
  const matches = value.matchAll(/\b(?:bp|b\/p|sbp|blood pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi);
  let maxSbp = 0;
  let maxDbp = 0;
  for (const match of matches) {
    maxSbp = Math.max(maxSbp, Number(match[1] ?? 0));
    maxDbp = Math.max(maxDbp, Number(match[2] ?? 0));
  }

  return { maxSbp, maxDbp };
}

function shouldSuppressStrokeBpRedFlag(value: string) {
  const lower = value.toLowerCase();
  const hasStrokeContext = /\b(ais|ischemic stroke|acute stroke|cva|tia|nihss|thrombectomy|evt)\b/.test(lower);
  if (!hasStrokeContext) return false;

  const hasStrictBpException =
    /\b(tpa|alteplase|thrombolysis|post[-\s]?tpa|ich|intracranial hemorrhage|hemorrhagic stroke|aortic dissection|stemi|nstemi|acs|mi)\b/.test(
      lower,
    );
  if (hasStrictBpException) return false;

  const { maxSbp, maxDbp } = maxBloodPressureInText(value);
  return maxSbp > 0 && maxSbp < 220 && maxDbp < 120;
}

function lineLooksLikeBpRedFlag(value: string) {
  return /bp|b\/p|sbp|dbp|hypertension|htn|blood pressure/i.test(value) &&
    /urgent|red flag|uncontrolled|severe|critical|call/i.test(value);
}

function filterStrokePermissiveBpRedFlags(redFlags: string, allText: string) {
  if (!shouldSuppressStrokeBpRedFlag(allText)) return redFlags;

  return redFlags
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !lineLooksLikeBpRedFlag(line))
    .join("\n");
}

function matchExistingPatient(
  draft: { bed: string; patientCode: string; matchPatientId: string },
  existingPatients: ExistingPatientForBatch[],
) {
  const modelMatch = existingPatients.find((patient) => patient.id && patient.id === draft.matchPatientId);
  if (modelMatch) return modelMatch;

  const bedKey = normalizeTextKey(draft.bed);
  const codeKey = normalizeTextKey(draft.patientCode);
  if (codeKey) {
    const codeMatch = existingPatients.find((patient) => normalizeTextKey(patient.patientCode) === codeKey);
    if (codeMatch) return codeMatch;
  }

  if (bedKey) {
    return existingPatients.find((patient) => normalizeTextKey(patient.bed) === bedKey);
  }

  return undefined;
}

function sanitizeImportTask(value: unknown) {
  const item = asPlainObject(value);
  const text = truncateString(item.text, 180).replace(/\s+/g, " ").trim();
  if (isGenericClinicalFiller(text)) return null;

  const priority = item.priority === "urgent" || item.priority === "low" ? item.priority : "normal";
  const category = taskCategories.has(String(item.category ?? "")) ? String(item.category) : "other";
  return {
    text,
    priority,
    dueDate: truncateString(item.dueDate, 20),
    category,
  };
}

function sanitizeImportDraft(
  value: unknown,
  index: number,
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  targetPatient?: ExistingPatientForBatch,
) {
  const item = asPlainObject(value);
  const tasks = Array.isArray(item.tasks)
    ? item.tasks.map((task) => sanitizeImportTask(task)).filter((task): task is NonNullable<typeof task> => Boolean(task))
    : [];
  const baseDraft = {
    id: truncateString(item.id, 120) || `import-${index + 1}`,
    status: item.status === "updateCandidate" ? "updateCandidate" : "new",
    matchPatientId: truncateString(item.matchPatientId, 120),
    sourceIndex: typeof item.sourceIndex === "number" ? item.sourceIndex : index,
    bed: truncateString(item.bed, 80),
    patientCode: truncateString(item.patientCode, 120),
    age: truncateString(item.age, 12),
    sex: item.sex === "M" || item.sex === "F" || item.sex === "Other" ? item.sex : "",
    attending: truncateString(item.attending, 120),
    teamOrService: truncateString(item.teamOrService, 120),
    primaryDiagnosis: truncateString(item.primaryDiagnosis, 240),
    oneLiner: truncateString(item.oneLiner, 300),
    chiefComplaint: truncateString(item.chiefComplaint, 240),
    todayUpdates: cleanClinicalLines(item.todayUpdates, 5, 700),
    vitalSigns: cleanClinicalLines(item.vitalSigns, 4, 500),
    physicalExam: cleanClinicalLines(item.physicalExam, 5, 700),
    labText: cleanClinicalLines(item.labText, 10, 1200),
    imageText: cleanClinicalLines(item.imageText, 8, 1000),
    admissionSummary: cleanClinicalLines(item.admissionSummary, 3, 420),
    underlyingDiseases: cleanClinicalLines(item.underlyingDiseases, 8, 700),
    activeProblems: cleanClinicalLines(item.activeProblems, 8, 900),
    hospitalCourseHighlights: cleanClinicalLines(item.hospitalCourseHighlights, 8, 900),
    importantRedFlags: cleanClinicalLines(item.importantRedFlags, 6, 700),
    tasks,
    antibioticsProceduresConsults: cleanClinicalArray(item.antibioticsProceduresConsults, 8, 160),
    dischargePlan: truncateString(item.dischargePlan, 350),
    disposition: truncateString(item.disposition, 220),
    uncertainty: cleanClinicalArray(item.uncertainty, 5, 180),
    sourceExcerpt: truncateString(item.sourceExcerpt, 700),
  };
  const allText = [
    rawText,
    baseDraft.primaryDiagnosis,
    baseDraft.oneLiner,
    baseDraft.todayUpdates,
    baseDraft.vitalSigns,
    baseDraft.physicalExam,
    baseDraft.labText,
    baseDraft.imageText,
    baseDraft.activeProblems,
    baseDraft.hospitalCourseHighlights,
    baseDraft.importantRedFlags,
  ].join("\n");
  const matchedPatient = targetPatient ?? matchExistingPatient(baseDraft, existingPatients);
  const uncertainty = targetPatient
    ? [
        ...baseDraft.uncertainty,
        "Target patient was selected by clinician; verify imported fields before saving.",
      ].slice(0, 6)
    : baseDraft.uncertainty;

  return {
    ...baseDraft,
    status: matchedPatient ? "updateCandidate" : baseDraft.status,
    matchPatientId: matchedPatient?.id ?? "",
    bed: baseDraft.bed || matchedPatient?.bed || "",
    patientCode: baseDraft.patientCode || matchedPatient?.patientCode || "",
    age: baseDraft.age || matchedPatient?.age || "",
    sex: baseDraft.sex || matchedPatient?.sex || "",
    attending: baseDraft.attending || matchedPatient?.attending || "",
    teamOrService: baseDraft.teamOrService || matchedPatient?.teamOrService || "",
    primaryDiagnosis: baseDraft.primaryDiagnosis || matchedPatient?.primaryDiagnosis || "",
    oneLiner: baseDraft.oneLiner || matchedPatient?.oneLiner || matchedPatient?.primaryDiagnosis || "",
    underlyingDiseases: baseDraft.underlyingDiseases || matchedPatient?.underlyingDiseases || "",
    activeProblems: baseDraft.activeProblems || matchedPatient?.activeProblems || "",
    importantRedFlags: filterStrokePermissiveBpRedFlags(baseDraft.importantRedFlags, allText),
    tasks: baseDraft.tasks.filter((task) => {
      if (!shouldSuppressStrokeBpRedFlag(allText)) return true;
      return !lineLooksLikeBpRedFlag(task.text);
    }),
    uncertainty,
  };
}

function targetUpdateText(rawText: string) {
  const marker = "Pasted update/report for this target patient:";
  const markerIndex = rawText.indexOf(marker);
  return markerIndex >= 0 ? rawText.slice(markerIndex + marker.length).trim() : rawText;
}

function fallbackTargetImportDraft(rawText: string, targetPatient: ExistingPatientForBatch) {
  const updateText = targetUpdateText(rawText);
  const reportLike = /\b(impression|report|ct|mri|cxr|echo|sono|ultrasound|x-ray|xray|image|imaging)\b/i.test(updateText);
  const labLike = /\b(lab|wbc|hb|hgb|plt|cr|bun|na|k|inr|pt|aptt|lactate|crp|pct|troponin|bnp|culture|vanco)\b/i.test(updateText);

  return {
    id: "target-update-1",
    status: "updateCandidate",
    matchPatientId: targetPatient.id,
    sourceIndex: 0,
    bed: targetPatient.bed,
    patientCode: targetPatient.patientCode,
    age: targetPatient.age,
    sex: targetPatient.sex,
    attending: targetPatient.attending,
    teamOrService: targetPatient.teamOrService,
    primaryDiagnosis: targetPatient.primaryDiagnosis,
    oneLiner: targetPatient.oneLiner || targetPatient.primaryDiagnosis,
    chiefComplaint: "",
    todayUpdates: reportLike || labLike ? "" : updateText.slice(0, 700),
    vitalSigns: "",
    physicalExam: "",
    labText: labLike ? updateText : "",
    imageText: reportLike ? updateText : "",
    admissionSummary: "",
    underlyingDiseases: targetPatient.underlyingDiseases,
    activeProblems: targetPatient.activeProblems,
    hospitalCourseHighlights: reportLike || labLike ? "" : updateText.slice(0, 700),
    importantRedFlags: "",
    tasks: [],
    antibioticsProceduresConsults: [],
    dischargePlan: "",
    disposition: "",
    uncertainty: ["AI returned no draft; this is a target-patient fallback for clinician review."],
    sourceExcerpt: updateText.slice(0, 700),
  };
}

function sanitizePatientBatchOutput(
  value: unknown,
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  targetPatient?: ExistingPatientForBatch,
) {
  const output = asPlainObject(value);
  const rawDrafts = Array.isArray(output.drafts) ? output.drafts : [];
  const draftSource = rawDrafts.length > 0 ? rawDrafts : targetPatient ? [fallbackTargetImportDraft(rawText, targetPatient)] : [];
  return draftSource
    .slice(0, 40)
    .map((item, index) => sanitizeImportDraft(item, index, rawText, existingPatients, targetPatient))
    .filter((draft) => draft.bed || draft.patientCode || draft.primaryDiagnosis || draft.oneLiner || draft.admissionSummary);
}

function makeBatchImportPrompt(
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  importMode: PatientBatchImportMode,
  targetPatient?: ExistingPatientForBatch,
) {
  const modeInstructions = importMode === "existingInpatient"
    ? [
        "Import mode: existing inpatient / transfer-in.",
        "- The pasted text may include old admission notes, two-week hospital course, weekly summaries, latest progress, labs, and image reports.",
        "- Prioritize compressed major hospital course, current active problems, last 24h changes, meaningful labs/images, current A/P, tasks, discharge barriers, and disposition.",
        "- admissionSummary should be a transfer-in course summary, not a full admission note. Avoid old resolved daily details unless they explain current risk or pending work.",
        "- Do not frame the patient as a new admission unless the source clearly says this is a new admission today.",
      ]
    : [
        "Import mode: new admissions / mixed list.",
        "- Prioritize why admitted, HPI/brief presentation, key PMH, initial active problems, initial A/P, immediate tasks, and disposition.",
      ];
  const targetInstructions = targetPatient
    ? [
        "",
        "Selected target patient:",
        JSON.stringify(targetPatient, null, 2),
        "",
        "Target-patient update rules:",
        "- The pasted clinical text belongs to this one selected existing patient.",
        "- Return exactly one draft unless the text is unusable.",
        "- Mark status updateCandidate and set matchPatientId to the selected target id.",
        "- Reuse target bed, patientCode, age/sex, attending/service, Dx, PMH, and active problems unless the pasted text clearly updates them.",
        "- Do not create a new patient because the pasted update lacks bed or patient code.",
        "- If the text is only an imaging/lab/consult report, put it in imageText/labText/todayUpdates as appropriate and leave admissionSummary empty unless there is enough course context.",
      ]
    : [];
  return [
    "Task:",
    "Extract a pasted inpatient internal medicine service list, handover, or admission batch into patient review cards.",
    ...modeInstructions,
    ...targetInstructions,
    "",
    "Existing active patients for duplicate matching:",
    JSON.stringify(existingPatients, null, 2),
    "",
    "Extraction rules:",
    "- Split the pasted text into distinct patients. Use bed, patient code, service headers, diagnosis blocks, or admission separators when present.",
    "- Never save or imply auto-save. These are review drafts only.",
    "- If bed or patientCode exactly matches an existing active patient, mark status updateCandidate and set matchPatientId to that existing id. Otherwise status new and matchPatientId empty.",
    "- Reuse existing IM Rounding Tracker fields: bed, patientCode, age, sex, attending, service, diagnosis, PMH, active problems, course, red flags, tasks, discharge/disposition.",
    "- Do not invent missing facts. Use empty strings/arrays when absent. Put uncertainty only for real ambiguity that blocks safe review.",
    ...admissionSummaryStyleBullets.map((line) => `- ${line}`),
    "- admissionSummary: write the same 3-min patient presentation style: one-liner why admitted, chronological focused HPI with pertinent positives/negatives, key PMH/context, objective anchors (V/S, PE, key labs/micro/images), active assessment, today/pending/dispo; leave empty if there is no admission/course context.",
    "- oneLiner: one short diagnosis-oriented line.",
    "- todayUpdates: last 24h subjective/overnight/transfer status only.",
    "- vitalSigns: current meaningful V/S and O2 support.",
    "- physicalExam: clinically relevant PE only.",
    "- labText: latest meaningful lab panel/trends/cultures as compact raw lab text. Keep unusual but relevant labs, tumor markers, drug levels, cultures, coagulation, ABG/VBG, etc.",
    "- imageText: latest meaningful imaging/procedure reports as compact raw text.",
    "- underlyingDiseases: PMH/comorbidities only. activeProblems: current inpatient problems only. Do not duplicate PMH into active problems unless it is actively managed now.",
    "- hospitalCourseHighlights: key prior events/treatments/procedures/consult decisions only, not every trivial daily note.",
    "- importantRedFlags: immediate safety or call-threshold issues only. Include concrete trigger/threshold when available.",
    "- tasks: concrete actions only, usually starting with f/u, repeat, call, consult, order, hold, resume, taper, arrange, educate, DC.",
    "- antibioticsProceduresConsults: concise list of Abx/procedures/consults when available.",
    "- dischargePlan and disposition should capture target, barriers, placement, OPD, home O2, meds/certificates, and reminders when available.",
    "",
    "Clinical rule starter pack:",
    "- Stroke/neuro: include neuro deficit, dysphagia/NPO, antiplatelet/anticoag, statin, image pending, rehab/dispo. For acute ischemic stroke without tPA/EVT/ICH/ACS/aortic dissection, do not label BP as urgent uncontrolled if SBP <220 and DBP <120; instead note permissive HTN/BP goal only if useful.",
    "- Infection/sepsis: prioritize fever, suspected source, cultures pending, antibiotics, lactate, shock/hypotension, source control.",
    "- Cardio: prioritize HF volume status/O2/diuresis, ACS chest pain/troponin/ECG, AF/RVR rate/anticoag, BNP when useful.",
    "- Renal: prioritize AKI/CKD, Cr trend, K, I/O, contrast exposure, ACEi/ARB/diuretic cautions, nephro tasks.",
    "- Endocrine: prioritize hypo/hyperglycemia, DKA/HHS signals, insulin changes, glucose monitoring tasks.",
    "- GI/anemia: prioritize active bleeding, Hb trend, transfusion, endoscopy, anticoag/antiplatelet decisions.",
    "- Pulmonary: prioritize O2 requirement, pneumonia Abx, COPD/asthma exacerbation, PE concern, respiratory failure/escalation.",
    "",
    "Quality rules:",
    "- Keep fragments short and clinically useful. Avoid copied full lab panels, copied PMH paragraphs, duplicated diagnoses, and boilerplate.",
    "- Do not write generic filler such as monitor closely, continue current management, clinical correlation, or stable condition unless paired with a concrete trigger or action.",
    "- Do not repeat patient names, full MRNs, birthdays, phone numbers, addresses, or identifiable details.",
    "",
    "Pasted de-identified text:",
    rawText,
  ].join("\n");
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
    "- First decide CURRENT status from the latest dated progress note, V/S, labs, and active orders. Historical ED/admission events belong in course only unless they are still active today.",
    "- If shock/hypotension occurred on arrival but later BP recovered, off pressor, or latest BP is stable, do not put shock in current V/S, redFlags, tasks, or A/P. If relevant, mention only as 'initial fluid-responsive hypotension/shock, resolved' in course/admission summary.",
    "- Subjective: patient-reported symptoms, new complaints, family concerns, and overnight events only. Do not put labs, imaging, plans, or consultant recommendations here.",
    "- Objective: V/S, bedside sugar, PE, labs, and imaging only. PE is bedside exam only; never put CT/MRI/CXR/EGD/report/impression text in PE. Mark isImportant true only for abnormal, changing, management-relevant, or handoff-relevant data.",
    "- A/P: active problems that change today's management or attending-level understanding. Each problem should have a short label, evidence/course, and concrete plan. Do not create A/P for stable routine values.",
    "- Tasks: actionable work for today or overnight, including f/u labs/images/cultures, consult calls, orders, family communication, discharge paperwork, and reminders.",
    "- Red flags: immediate safety or call-threshold items only, such as unstable V/S, active bleeding, sepsis/shock concern, ACS/stroke concern, worsening oxygenation, dangerous electrolyte/glucose/renal changes, or high-risk pending result.",
    "- Stroke/neuro: for suspected acute ischemic stroke without tPA/EVT/ICH/ACS/aortic dissection context, permissive hypertension is expected; do not call BP urgently uncontrolled unless SBP >=220, DBP >=120, or another strict indication is present.",
    "- Discharge issues: barriers, target date, placement, home oxygen, OPD/follow-up, medications, certificates, or family/social issues affecting discharge.",
    "- Thinking prompts: questions for clinician review only when the text suggests a real diagnostic or management uncertainty; avoid generic textbook prompts.",
    "- Consult/nursing notes often become tasks, red flags, discharge issues, or overnight events; do not promote them to confirmed diagnoses unless supported by the source text or existing context.",
    "- Lab-only or image-only input should usually produce objective findings plus tasks/red flags if needed, not a new admissionSummary or broad SOAP rewrite.",
    "- Prefer short hand-written clinical fragments over polished prose. Examples: 'AKI on CKD, Cr 2.1 from 1.4, hold ACEi, f/u I/O'; 'CXR RLL opacity, cont ceftriaxone, f/u sputum Cx'.",
    "",
  ].join("\n");
  const intakeTargets = [
    "Messy chart extraction target:",
    "- Product target is SOAP-first: pasted data should become one readable physician SOAP note, not many independent cards.",
    "- Compose every SOAP-facing field so it can be printed in this exact order: header context, S, O with V/S/PE/Lab/Image, A/P with '# problem' logic, then Tasks/DC.",
    "- Do not rely on rule labels as clinical judgment. Avoid labels such as Heme/Onc safety, TLS/onc safety, Cardio/HF/rhythm unless the source clearly supports the specific active problem.",
    "- Lab text should preserve source values, dates, arrows/trends, and clinically meaningful abnormalities. Do not let generic lab categories override the pasted lab line.",
    "- First fill clinicalReasoning before composing SOAP-facing text.",
    "- clinicalReasoning.primaryRisk must answer: what would a covering IM physician need to know first, and what could deteriorate or change management today/overnight?",
    "- clinicalReasoning.whyThisMatters must cite short source facts from the pasted text or allowed context; every important conclusion needs a visible basis.",
    "- clinicalReasoning.activeProblemsRanked must rank problems by current clinical risk and management relevance, not by diagnosis order in the chart.",
    "- clinicalReasoning.missingDataNeeded should list key facts needed for safe handoff, e.g. ANC when WBC is very low, culture status, fever curve, O2 requirement, I/O, Cr/K trend, anticoag plan, discharge blocker.",
    "- clinicalReasoning.noiseToIgnore should list stable normals, duplicated history, boilerplate, and stale issues that should not appear in SOAP.",
    "- Treat pasted text as unordered chart fragments; remove duplicated, stale, administrative, and low-signal lines.",
    "- Keep current problems separate from resolved course. Do not revive a resolved ICU/ED problem as today's red flag just because the word appears in history.",
    "- Surface only information that changes rounding, orders, handoff safety, discharge planning, or attending-level understanding.",
    "- Prioritize: why admitted, important PMH, active problems, major prior hospital course, today's meaningful updates, tasks/pending items/red flags, key labs/images/antibiotics/procedures/consults/disposition.",
    "- Keep all output concise and scannable. Use common IM abbreviations when unambiguous.",
    "- Compression target is complete but compressed: preserve active problems, abnormal trends, Abx/procedure/consult status, pending tasks, and DC barriers while shortening wording.",
    "- Prefer common shorthand: w/, w/o, s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, Sputum Cx, PNA, UTI, AKI/CKD/ESRD/HD, RF, CHF/HF, AF, CAD, DM, HTN, COPD, SpO2/O2, NC/RA, CXR/CT/MRI/U/S, EGD, OPD.",
    "- Use DC for discharge; reserve d/c only for discontinue. Avoid rare or ambiguous abbreviations.",
    ...admissionSummaryStyleBullets.map((line) => `- ${line}`),
    "- admissionSummary: write the same 3-min patient presentation style: one-liner admission reason, chronological focused HPI with pertinent positives/negatives, key PMH/context, objective anchors (V/S, PE, key labs/micro/images), active assessment, today/pending/dispo. Leave empty only if the pasted text has no admission/course context.",
    "- isbarHandoff: concise SBAR with headings exactly Situation, Background, Assessment, Recommendation. Include red flags, pending tasks, contingency/call parameters, and disposition. Leave empty only if there is too little patient context.",
    "- Remove boilerplate and generic phrases like monitor closely, continue current management, clinical correlation, and stable condition unless tied to a concrete trigger, action, or call threshold.",
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

function openAiHttpsError(status: number, responseBody: Record<string, unknown>) {
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
    admissionSummary: patient.admissionBriefFreeText ?? patient.generatedAdmissionSummary ?? "",
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
    soapText: note.soapText ?? "",
    soapStatus: note.soapStatus ?? "",
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
    isbar: "SBAR handoff note",
  };
  return labels[documentType];
}

const admissionSummaryZh = {
  because: "\u56e0",
  admitted: "\u4f4f\u9662",
  background: "\u80cc\u666f",
  arrivalOrTransfer: "\u5230\u9662/\u8f49\u5165\u6642",
  through: "\u7d93",
  after: "\u5f8c",
  nowFocus: "\u76ee\u524d\u91cd\u9ede",
  todayPending: "\u4eca\u65e5\u5f85",
};

const admissionSummaryStyleBullets = [
  "Admission summary/oral brief style: follow the standard 3-min patient presentation used at IM morning rounds, in 6-8 short mixed Chinese-English clinical sentences, not an English paragraph, full H&P, or copied admission note.",
  "Use abbreviation-forward inpatient IM style: s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, Sputum Cx, PNA, UTI, AKI/CKD, RF, HF, AF, CAD, DM, HTN, COPD, O2/SpO2, NC/RA, CXR/CT/MRI/U/S, EGD, DC, OPD.",
  `Keep Dx/PMH, organisms, drug names, procedures, image studies, lab values, devices, and consult services in English; use Chinese only for connective clinical judgment such as ${admissionSummaryZh.because}, ${admissionSummaryZh.background}, ${admissionSummaryZh.arrivalOrTransfer}, ${admissionSummaryZh.through}, ${admissionSummaryZh.after}, ${admissionSummaryZh.nowFocus}, ${admissionSummaryZh.todayPending}.`,
  "3-min presentation order without headings: 1) one-liner identification: age/sex + key PMH context + chief concern/reason for admission, 2) focused HPI in chronological order with pertinent positives AND pertinent negatives, 3) relevant PMH/high-risk meds/allergy only, 4) key objective anchors: V/S + O2, focused PE findings, then 2-4 key labs/micro/image/procedure results with exact values/dates, 5) one summary statement that synthesizes who the patient is and the leading diagnosis, 6) problem-based assessment ranked by acuity, 7) plan: today's actions, pending work, consults, disposition/contingency.",
  `Sentence skeleton: [age/sex if known] ${admissionSummaryZh.because} [reason/Dx] ${admissionSummaryZh.admitted}. ${admissionSummaryZh.background} [PMH/context]. ${admissionSummaryZh.arrivalOrTransfer} [severity/HPI chronology + pertinent positives/negatives], ${admissionSummaryZh.through} [ED/ICU/transfer treatment] ${admissionSummaryZh.after} [response]. Key O [V/S/O2 + focused PE + 2-4 key labs/micro/image/procedure]. ${admissionSummaryZh.nowFocus} [summary statement + ranked active assessment], ${admissionSummaryZh.todayPending} [pending/plan/dispo].`,
  "If a 1-min ultra-short brief is explicitly requested, compress the same order into 3-5 sentences without dropping the one-liner, key objective anchors, or active assessment/plan.",
  "For a very simple patient, 4-5 sentences is acceptable; complex admission/transfer should use 6-8 concise source-grounded sentences.",
  "Use the phrase Key O for objective anchors and include 3-5 key V/S/O2, lab/micro, image, procedure, or response anchors. Do not output mojibake or placeholder symbols.",
  "Prioritize life-threatening or admission-defining problems first; include exact values/dates when they change assessment or plan.",
  "Omit full ROS, full PMH, unrelated remote history, stable normal data, copied full lab panels, and routine medication lists.",
  "Do not write 'The patient is', full admission-note prose, copied full lab panels, routine normal data, or generic filler.",
];

function documentInstructions(documentType: DocumentType) {
  const shared = [
    "First fill clinicalReasoning before composing document sections.",
    "clinicalReasoning.primaryRisk must state what a covering IM physician needs to know first, including partially improved but still unsafe states.",
    "clinicalReasoning.activeProblemsRanked must rank by current clinical risk and management relevance, not by the order of source notes.",
    "clinicalReasoning.whyThisMatters must cite short source facts and implications so the clinician can independently review the basis.",
    "clinicalReasoning.noiseToIgnore should name stable normals, duplicated history, and boilerplate that should not enter the final note.",
    "Final document text must be a concise projection of clinicalReasoning, not generic AI prose.",
    "Use concise inpatient IM style with common unambiguous medical abbreviations.",
    "Do not invent missing data; mark absent or unclear details in uncertainty.",
    "Preserve dates, lab values, units, medication names, image findings, and pending items exactly when available.",
    "Use de-identified content only; do not repeat names, full MRNs, IDs, birthday, phone, address, or identifiable image details.",
    "Do not use bullet lists unless the requested document type is SBAR.",
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
      ...admissionSummaryStyleBullets,
      "Create a 3-min oral patient presentation ready to read aloud at attending rounds and paste into the rounding list.",
      "Write like a senior IM resident presenting at morning rounds: diagnosis-oriented, clinically selective, abbreviation-forward, and mixed Chinese-English.",
      "Follow the 3-min presentation order: one-liner identification, chronological focused HPI with pertinent positives/negatives, relevant PMH/meds/allergy, key V/S + focused PE, key labs/micro/images, summary statement, problem-based assessment, today/pending/disposition plan.",
      "Emphasize why admitted, important PMH/context, key positive/negative findings, active problems, major prior course, today's important changes, initial/current treatment, and pending/disposition decisions.",
      "Exclude trivial daily stable updates unless they affect management, safety, discharge, or handoff.",
      "Keep the default 3-min compact brief to 6-8 short sentences for complex patients; simple patients may be 4-5 sentences, still telegraphic and oral-ready.",
      "Use conciseSummary as the best one-paragraph presentation.",
    ],
    dischargeHospitalCourse: [
      "Return exactly one section with heading Hospital Course.",
      "Write one hospital-course paragraph only, not bullet points and not problem-by-problem headings.",
      "Start the paragraph exactly with: After admission,",
      "Be specific: preserve source-grounded dates, key lab values/trends, culture results, oxygen status, image/procedure names, antibiotics, consultations, complications, and treatment response when available.",
      "End the paragraph with: under relative stable condition, the patient was discharged w/ [disposition/follow-up/DC meds/OPD plan if available].",
      "Do not write separate discharge medication, follow-up appointment, assessment/plan, or problem headings unless the detail is essential inside the course paragraph.",
      "Keep followUpItems empty unless an item is critical to mention separately.",
    ],
    weeklySummary: [
      "Return one section with heading Weekly Summary.",
      "Write a usable weekly hospital-course/interim summary for the next covering physician, not a generic paragraph.",
      "Paragraph format only: no bullet lists, numbered lists, problem headings, or separate A/P section.",
      "Use 5-8 short source-grounded clinical sentences in this order: 1) why admitted/why still here, 2) this week's trajectory with dated milestones and exact values, 3) current active problems/status, 4) pending work, contingencies, and disposition barrier.",
      "Preserve concrete anchors when available: dates, VS/O2 trend, WBC/Hb/Cr/K/LFT/INR/CRP/lactate trend, culture results, Abx name/day, procedure/date/result, image study/date/key finding, consult recommendation, and DC barrier.",
      "Problem content should be synthesized by active issue and trajectory; do not copy the daily A/P forward or list every task.",
      "Use concise inpatient IM style with common abbreviations. Avoid generic phrases such as current focus, monitor closely, continue management, and needs clinical review unless paired with a specific action or missing data.",
      "Exclude stable inactive problems, routine normals, copied full lab panels, and completed tasks unless they explain current decisions.",
      "Weave pending labs/images/consults, discharge barriers, target disposition, follow-up needs, and if/then contingencies into the paragraph.",
      "Use followUpItems only for critical pending items not already captured in the paragraph.",
    ],
    isbar: [
      "Return exactly four sections in this exact order: Situation, Background, Assessment, Recommendation.",
      "Follow the standard SBAR pattern: current situation, pertinent background, clinical assessment, and requested/recommended action.",
      "Target total length: 8-12 short clinical lines, under 180 words when possible.",
      "Situation: lead with clinicalReasoning.primaryRisk. Include bed/code if available, age/sex, attending/service if relevant, current working Dx, why handoff is needed now, and current status; never use name, full MRN, birthday, phone, address, or ID.",
      "Background: include only high-yield PMH, important prior hospital events, key procedures, antibiotics, consults, and major image/lab findings that matter for handoff.",
      "Assessment: use ranked active problems from clinicalReasoning with evidence and severity; avoid vague labels without source facts.",
      "Recommendation: include today/overnight actions, pending labs/images/consults, contingency plans, call thresholds, discharge/disposition plan, and missing data from clinicalReasoning.",
      "Recommendation must not paste a medication order list. Convert order information into actions such as clarify Abx duration/Cx, hold/resume anticoagulation plan, glucose parameters, I/O or renal follow-up.",
      "Do not include routine normal data, duplicated diagnosis paragraphs, generic legal disclaimers, empty sections, long admission-note prose, copied full lab panels, or low-signal stable daily updates.",
      "Do not use generic filler such as monitor closely unless paired with a specific trigger, call threshold, or action.",
      "Put pending tasks and uncertainty inside Recommendation when possible; use followUpItems or uncertainty only if a critical item does not fit in the four sections.",
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

function makeRoundSoapPrompt(params: {
  sourceType: SourceType;
  workflowMode: string;
  selectedDate: string;
  rawText: string;
  currentSoapBaseline: string;
  patientContext: Record<string, unknown>;
  userStyleProfile?: ReturnType<typeof sanitizeUserStyleProfile>;
  dailyNotes: Array<Record<string, unknown>>;
}) {
  const modeInstruction =
    params.workflowMode === "dailyUpdate"
      ? [
          "Workflow mode: Daily update.",
          "- Treat the current reviewed SOAP baseline as already clinician-reviewed and generally correct.",
          "- Do not rewrite the whole note. Add or revise only new clinically meaningful V/S, labs, images, symptoms, course, A/P details, tasks, orders, and DC blockers from pasted fields.",
          "- If the pasted source contains only V/S, update only O/V/S unless those vitals create a new safety issue.",
          "- If the pasted source contains only Lab, update only O/Lab and, when needed, append a short status/plan phrase under the matching existing A/P problem title. Do not rebuild the whole A/P.",
          "- If the pasted source contains only Image, update only O/Image with study/date/key finding. Never move image reports into PE.",
          "- If the pasted source contains only orders/medications, update only Tasks/Order summaries. Do not create new A/P problems from orders alone.",
          "- Exception: if the order is a concrete antibiotic/culture update and an infection A/P already exists or is clearly supported, reflect drug/route/dose/frequency/start date/day count/indication/culture follow-up under the matching infection A/P.",
          "- If pasted text says a task/result is done or resolved, remove or update that task in the SOAP instead of carrying it forward.",
          "- Do not change diagnosis/PMH/A/P structure unless today's pasted data clearly changes the clinical problem list.",
          "- Preserve existing A/P problem titles by default. Only add a new problem if today's pasted text clearly supports a new active problem.",
          "- Preserve the baseline user's A/P title wording, shorthand, and line style. If a baseline title is '# PNA / bacteremia', do not rename it to a generic textbook title unless the pasted source proves the diagnosis changed.",
          "- Each changed line must be traceable to the pasted source. Do not add broad management boilerplate, generic differential diagnoses, or normal-stable chronic problems just because they exist in context.",
          "- It is acceptable for Daily update output to be nearly identical to baseline with only one O/Lab, O/V/S, task, order, or matching A/P line changed.",
          "- If pasted data is malformed, too narrow, or unrelated, preserve baseline sections and add a short warning instead of writing a full replacement note.",
          "- Do not add a separate 'clinical improvement' A/P problem. Merge improvement, response to Abx/procedure, culture updates, and lab trends under the matching existing problem.",
        ].join("\n")
      : params.workflowMode === "newSoap"
        ? [
            "Workflow mode: New SOAP.",
            "- This is the first inpatient SOAP after admission. Use admission context plus pasted V/S/labs/images/course to write a complete first SOAP.",
            "- Build a fresh A/P from active admission problems and today's objective data.",
            "- Keep admission history concise; do not copy the full admission note.",
          ].join("\n")
        : [
            "Workflow mode: Transfer / handoff SOAP.",
            "- This is the receiving team's first SOAP after transfer or handoff.",
            "- Synthesize admission context, prior SOAP/handoff, course, consults, labs, images, procedures, antibiotics, and current status into one usable SOAP.",
            "- Distinguish resolved prior events from active receiving-team problems.",
          ].join("\n");

  return [
    "Task:",
    "Update one clinician-reviewed inpatient IM SOAP note from the pasted de-identified source text.",
    "",
    "Output format requirements:",
    "- Return SOAP text only inside JSON soapText.",
    "- Use this exact section order: header context, S:, O:, A/P:, Tasks:, DC:. Medication/order items still belong under Tasks: but should start with 'Order:' or a clear medication/order phrase so the editor can display them in the medication-order section.",
    "- Header should include bed/code/age-sex if known, Dx, PMH if high-yield, attending/date if useful.",
    "- The medication/order display section is called \u85e5\u56d1. Use 'Order:' for order-related lines; do not place medication summaries inside unrelated tasks.",
    "- O must use fixed order V/S, PE, Lab, Image. Put imaging reports under Image, never PE.",
    "- In O/Image, always preserve the study name/date/key finding when pasted imaging exists, e.g. 'Image: CXR 5/22 ...' or 'Image: CT A/P 5/21 ...'.",
    "- A/P must use '# problem' blocks, 3-5 active problems maximum.",
    "- Do not mechanically preserve source headings or split by every symptom/test/procedure. Choose the dominant active clinical problems the rounding physician would present.",
    "- Each A/P problem may have only 1-2 bullets. Merge status, key evidence, and concrete plan into compact clinician lines.",
    "- Do not split one clinical problem into separate A/P lines for symptom, procedure, image, current status, and drug; combine them under the same problem.",
    "- If antibiotics are present, the matching A/P problem must preserve drug name plus route/dose/frequency when available, start date/day count when available, indication/source, and culture follow-up/de-escalation plan. Example: '# MRSA/Enterococcus bacteremia' then '- Teicoplanin 400 mg IV qd 5/13- (D3) for B/C MRSA/Enterococcus; f/u B/C clearance/susceptibility, define duration/source.'",
    "- When compressing, do not omit active organ dysfunction or explanatory complications. Preserve supported elevated LFT/transaminitis/hyperbilirubinemia/coagulopathy, pleural effusion/chylothorax/hypoxemic RF, AKI/Cr change, infection/sepsis, bleeding/anemia, thrombus, or active cancer-treatment complications.",
    "- If a problem is supported by objective data, name it clinically instead of hiding it inside a vague symptom label. Example: write 'Malignant pleural effusion/chylothorax, RF improving' rather than only 'Dyspnea improving'.",
    "- Use common clear clinician abbreviations when they save space: w/, w/o, s/p, c/f, r/o, f/u, cont, Abx, Cx, B/C, U/C, Sputum Cx, PNA, UTI, AKI/CKD/ESRD/HD, RF, CHF/HF, AF, CAD, DM, HTN, COPD, SpO2/O2, NC/RA, CXR/CT/MRI/U/S, EGD, TTE, OPD.",
    "- Use DC for discharge; reserve d/c only for discontinue. Avoid rare or ambiguous abbreviations.",
    "- Compression means tighter wording, not omission: keep active problems, key abnormal trends, Abx/procedure/consult status, tasks, and DC barriers.",
    "- Tasks must be 2-5 maximum and only actionable/timed/pending items.",
    "- DC only if disposition, discharge blockers, OPD, meds, certificates, or placement are relevant.",
    "- The whole SOAP should be short enough for a rounding print list. Prefer one defensible short phrase over many low-value details.",
    "- Ignore text explicitly labeled as old duplicate, copy-noise, random noise, or 'ignore'. Do not carry that wording into SOAP.",
    "- Keep language concise, physician-style, and defensible. No rule labels, no dashboard tags, no code-like parser labels.",
    "- Do not write generic tasks such as monitor closely, review VTE risk, trend TLS labs unless the source supports the exact issue.",
    "- Preserve exact lab values, dates, antibiotics, cultures, image study names/dates, procedures, consults, and pending items.",
    "- If lab parser/category would conflict with pasted lab line, trust pasted text and warn instead of rewriting values.",
    "- If source says shock/hypotension resolved or latest BP stable, do not create active shock red flag/A/P.",
    "- Red/high-risk facts can be marked with a leading ! in soapText; important therapies/pending items can be left as normal text.",
    "- If user style profile is provided, match the user's writing style: wording density, shorthand habit, A/P organization, section order, and task phrasing.",
    "- Treat styleSummary and preferredTerms as strong voice guidance: imitate the reviewed SOAP style and abbreviations when clinically safe, instead of defaulting to generic textbook prose.",
    "- If currentSoapBaseline exists, preserve its A/P title style, term choices, terse wording, and task phrasing unless the pasted source clearly requires a change.",
    "- Treat typical A/P problem count and line limit only as weak density hints, not as targets. Clinical correctness and the user's reviewed baseline style matter more than exact numbers.",
    "",
    modeInstruction,
    "",
    "Selected date:",
    params.selectedDate || "(not provided)",
    "",
    "Source type:",
    params.sourceType,
    "",
    "Workflow mode:",
    params.workflowMode,
    "",
    "Allowed patient context:",
    JSON.stringify(params.patientContext, null, 2),
    "",
    "User style profile, abstract only; do not infer patient facts from it:",
    JSON.stringify(params.userStyleProfile ?? {}, null, 2),
    "",
    "Recent saved daily notes, newest last or selected by date when available:",
    JSON.stringify(params.dailyNotes, null, 2),
    "",
    "Current reviewed SOAP baseline to update:",
    params.currentSoapBaseline || "(none)",
    "",
    "Pasted de-identified source text:",
    params.rawText,
  ].join("\n");
}

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
          format: {
            type: "json_schema",
            name: "patient_batch_import_draft",
            description: "Bulk patient import draft cards for clinician review in IM Rounding Tracker.",
            strict: true,
            schema: patientBatchImportSchema,
          },
        },
      }),
    });

    const responseBody = (await openAiResponse.json().catch(() => ({}))) as Record<string, unknown>;
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
      logger.error("Failed to parse OpenAI batch import JSON", { error });
      throw new HttpsError("internal", "OpenAI returned malformed patient import JSON.");
    }

    const rawTextPreview = rawText.slice(0, 700);
    const drafts = sanitizePatientBatchOutput(parsedDraft, rawText, existingPatients, targetPatient);

    return {
      draftId: admin.firestore().collection("_aiDraftIds").doc().id,
      drafts,
      model,
      rawTextPreview,
    };
  },
);

export const generateRoundSoap = onCall(
  {
    secrets: [OPENAI_API_KEY],
    timeoutSeconds: 120,
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
    const workflowMode = ["dailyUpdate", "newSoap", "transferHandoff"].includes(workflowModeValue)
      ? workflowModeValue
      : "dailyUpdate";
    const rawText = String(data.rawText ?? "").trim();
    const currentSoapBaseline = truncateString(data.currentSoapBaseline, 12000);
    const deidentifiedConfirmed = data.deidentifiedConfirmed === true;
    const qualityMode = sanitizeQualityMode(data.qualityMode);

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
      throw new HttpsError("failed-precondition", "SOAP generation is not configured. Set OPENAI_API_KEY for Firebase Functions.");
    }

    const notesSnapshot = await patientRef.collection("dailyNotes").orderBy("date", "asc").get();
    const dailyNotes = notesSnapshot.docs
      .map((noteDoc) => compactDailyNote(noteDoc.id, noteDoc.data()))
      .slice(-14);
    const patientContext = {
      ...compactPatientContext(patientSnapshot.data()),
      ...(sanitizePatientContext(data.patientContext) ?? {}),
    };
    const userStyleProfile = sanitizeUserStyleProfile(data.userStyleProfile);
    const model = getModelForQuality(qualityMode);
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
              "You are a clinician-facing SOAP note generator for inpatient internal medicine rounds.",
              "Return JSON only matching the supplied schema.",
              "The user will edit before saving; do not write to patient data.",
              "This callable returns a draft only. Never imply that generated SOAP has been saved or has overwritten patient data.",
              "Your job is clinical judgment and concise wording, not structured dashboard extraction.",
              "Produce one complete, readable, check-only SOAP note that can be used for rounds and print.",
              "Do not include patient names, full MRNs, birthdays, phone numbers, addresses, or identifiers.",
            ].join(" "),
          },
          {
            role: "user",
            content: makeRoundSoapPrompt({
              sourceType,
              workflowMode,
              selectedDate,
              rawText,
              currentSoapBaseline,
              patientContext,
              userStyleProfile,
              dailyNotes,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "round_soap_draft",
            description: "Single SOAP text draft for clinician review before saving.",
            strict: true,
            schema: roundSoapDraftSchema,
          },
        },
      }),
    });

    const responseBody = (await openAiResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!openAiResponse.ok) {
      throw openAiHttpsError(openAiResponse.status, responseBody);
    }

    const refusal = extractRefusal(responseBody);
    if (refusal) {
      throw new HttpsError("failed-precondition", refusal);
    }

    const outputText = extractOutputText(responseBody);
    if (!outputText) {
      throw new HttpsError("data-loss", "OpenAI returned no SOAP draft. Retry generation; no patient data was saved.");
    }

    let parsedDraft: unknown;
    try {
      parsedDraft = JSON.parse(outputText);
    } catch (error) {
      logger.error("Failed to parse OpenAI round SOAP JSON", { error, workflowMode, model });
      throw new HttpsError("data-loss", "OpenAI returned malformed SOAP JSON. Retry generation; no patient data was saved.");
    }

    const parsed = asPlainObject(parsedDraft);
    const soapText = truncateString(parsed.soapText, 14000).trim();
    if (!soapText) {
      throw new HttpsError("data-loss", "OpenAI returned an empty SOAP draft. Retry generation; no patient data was saved.");
    }

    return {
      draftId: admin.firestore().collection("_aiDraftIds").doc().id,
      soapText,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item) => truncateString(item, 240)).slice(0, 8) : [],
      highlightHints: Array.isArray(parsed.highlightHints) ? parsed.highlightHints.map((item) => truncateString(item, 180)).slice(0, 12) : [],
      model,
      qualityMode,
    };
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
    const qualityMode = sanitizeQualityMode(data.qualityMode);

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

    const model = getModelForQuality(qualityMode);
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
      qualityMode,
    });

    return {
      draftId: draftRef.id,
      draft,
      model,
      qualityMode,
      rawTextPreview,
    };
  },
);
