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
  const hasStrokeContext = /\b(ais|ischemic stroke|acute stroke|cva|tia|nihss|thrombectomy|evt)\b|中風|腦梗|缺血性腦/.test(lower);
  if (!hasStrokeContext) return false;

  const hasStrictBpException =
    /\b(tpa|alteplase|thrombolysis|post[-\s]?tpa|ich|intracranial hemorrhage|hemorrhagic stroke|aortic dissection|stemi|nstemi|acs|mi)\b|腦出血|主動脈剝離/.test(
      lower,
    );
  if (hasStrictBpException) return false;

  const { maxSbp, maxDbp } = maxBloodPressureInText(value);
  return maxSbp > 0 && maxSbp < 220 && maxDbp < 120;
}

function lineLooksLikeBpRedFlag(value: string) {
  return /bp|b\/p|sbp|dbp|hypertension|htn|blood pressure|血壓/i.test(value) &&
    /urgent|red flag|uncontrolled|severe|critical|call|高|危/i.test(value);
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
    admissionSummary: cleanClinicalLines(item.admissionSummary, 5, 900),
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
    "- admissionSummary: 2-4 compact attending-rounds sentences. Include why admitted, key PMH/context, major prior course, active issues, today/pending/disposition.",
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
    "- admissionSummary: 3-4 compact attending-rounds sentences. Include admission reason, PMH/context, major course, current active problems, today/pending/dispo. Leave empty only if the pasted text has no admission/course context.",
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
    isbar: "SBAR handoff note",
  };
  return labels[documentType];
}

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
    "Do not use bullet lists unless the requested document type is SBAR or weekly summary A/P.",
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
      "Return exactly three sections in this order: Weekly Summary, Problem-Based A/P, Pending / Disposition.",
      "Weekly Summary content must start with the current clinical focus and primary risk, not a generic date phrase.",
      "Weekly Summary is one compact paragraph summarizing the selected SOAP notes by clinical trajectory: active issue, response to treatment, unresolved risk, and why still admitted.",
      "Problem-Based A/P should follow progress-note/SOAP logic: active problems only, short assessment plus concrete plan; omit stable inactive problems.",
      "Pending / Disposition should include pending labs/images/consults, discharge barriers, target disposition, and follow-up needs.",
      "Exclude trivial normal daily updates and copied full lab panels unless they changed management.",
      "Use followUpItems only for critical pending items not already captured in Pending / Disposition.",
    ],
    isbar: [
      "Return exactly four sections in this exact order: Situation, Background, Assessment, Recommendation.",
      "Follow the standard SBAR pattern: current situation, pertinent background, clinical assessment, and requested/recommended action.",
      "Target total length: 8-12 short clinical lines, under 180 words when possible.",
      "Situation: lead with clinicalReasoning.primaryRisk. Include bed/code if available, age/sex, attending/service if relevant, current working Dx, why handoff is needed now, and current status; never use name, full MRN, birthday, phone, address, or ID.",
      "Background: include only high-yield PMH, important prior hospital events, key procedures, antibiotics, consults, and major image/lab findings that matter for handoff.",
      "Assessment: use ranked active problems from clinicalReasoning with evidence and severity; avoid vague labels without source facts.",
      "Recommendation: include today/overnight actions, pending labs/images/consults, contingency plans, call thresholds, discharge/disposition plan, and missing data from clinicalReasoning.",
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
      throw new HttpsError("internal", getOpenAiErrorMessage(openAiResponse.status, responseBody));
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
              "admissionSummary must be attending-ready: why admitted, important PMH/context, major hospital course, current active problems, today/pending/disposition, in 3-5 compact sentences.",
              "isbarHandoff must use headings Situation, Background, Assessment, Recommendation, with contingency plans, pending tasks, red flags, and call parameters when available.",
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
