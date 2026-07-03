// Shared callable input types and allowed-value sets. Extracted from index.ts (Phase 3 refactor).

export const sourceTypes = new Set([
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

export const documentTypes = new Set([
  "admissionNote",
  "admissionSummary",
  "dischargeHospitalCourse",
  "weeklySummary",
  "isbar",
]);

export const taskCategories = new Set(["lab", "imaging", "consult", "discharge", "family", "order", "other"]);

export type SourceType =
  | "mixed"
  | "dailyUpdate"
  | "admission"
  | "vitals"
  | "lab"
  | "image"
  | "progress"
  | "consult"
  | "nursing";

export type DocumentType =
  | "admissionNote"
  | "admissionSummary"
  | "dischargeHospitalCourse"
  | "weeklySummary"
  | "isbar";

export interface CallableInput {
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

export interface RoundSoapCallableInput {
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

export interface DocumentCallableInput {
  patientId?: unknown;
  documentType?: unknown;
  rawText?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  deidentifiedConfirmed?: unknown;
  storeRawText?: unknown;
  qualityMode?: unknown;
}

export interface PatientBatchCallableInput {
  rawText?: unknown;
  deidentifiedConfirmed?: unknown;
  importMode?: unknown;
  targetPatientId?: unknown;
  existingPatients?: unknown;
}

export type PatientBatchImportMode = "newAdmission" | "existingInpatient";

export interface ExistingPatientForBatch {
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
