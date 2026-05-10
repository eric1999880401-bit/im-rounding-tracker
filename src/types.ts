export type PatientStatus = "active" | "discharged" | "archived";

export type PatientSex = "M" | "F" | "Other";

export type TaskPriority = "urgent" | "normal" | "low";

export type TaskCategory =
  | "lab"
  | "imaging"
  | "consult"
  | "discharge"
  | "family"
  | "order"
  | "other";

export type PrintDensity = "normal" | "compact" | "ultra-compact";

export type SortMode = "bed" | "dischargeDate" | "urgentFirst";

export type DischargePrepStatus = "pending" | "done" | "notNeeded";

export type AiClinicalSourceType =
  | "mixed"
  | "admission"
  | "vitals"
  | "lab"
  | "image"
  | "progress"
  | "consult"
  | "nursing";

export interface AiSoapDraft {
  oneLiner: string;
  subjective: {
    chiefConcern: string;
    symptoms: string[];
    overnightEvents: string[];
  };
  objective: {
    vitals: Array<{
      date: string;
      name: string;
      value: string;
      interpretation: string;
      isAbnormal: boolean;
      isImportant: boolean;
    }>;
    physicalExam: Array<{
      system: string;
      finding: string;
      isImportant: boolean;
    }>;
    labs: Array<{
      date: string;
      group: string;
      name: string;
      value: string;
      unit: string;
      previousValue: string;
      isAbnormal: boolean;
      isImportant: boolean;
      interpretation: string;
    }>;
    images: Array<{
      date: string;
      studyType: string;
      finding: string;
      impression: string;
      isImportant: boolean;
    }>;
  };
  assessmentPlan: Array<{
    problemTitle: string;
    assessmentSummary: string;
    evidenceOrCourseItems: string[];
    planItems: string[];
    isImportant: boolean;
  }>;
  redFlags: Array<{
    text: string;
    reason: string;
  }>;
  tasks: Array<{
    text: string;
    priority: TaskPriority;
    dueDate: string;
    category: string;
  }>;
  dischargeIssues: string[];
  thinkingPrompts: Array<{
    prompt: string;
    reason: string;
  }>;
  uncertainty: string[];
}

export interface AiThinkingPrompt {
  id: string;
  prompt: string;
  reason: string;
  kind: "thinkingPrompt" | "uncertainty";
  createdAt: string;
}

export interface AnalyzeClinicalTextInput {
  patientId: string;
  sourceType: AiClinicalSourceType;
  rawText: string;
  deidentifiedConfirmed: boolean;
  storeRawText?: boolean;
  patientContext?: {
    age?: string;
    sex?: string;
    pmh?: string[];
    activeProblems?: string[];
    currentAssessmentPlan?: unknown[];
  };
}

export interface AnalyzeClinicalTextResult {
  draftId: string;
  draft: AiSoapDraft;
  model: string;
  rawTextPreview: string;
}

export interface HighlightLine {
  text: string;
  important: boolean;
  kind?: "normal" | "numbered" | "arrow" | "dash" | "section";
}

export interface ParsedLabItem {
  id?: string;
  label: string;
  name?: string;
  displayName?: string;
  value: string;
  unit?: string;
  previousValue?: string;
  group?: string;
  color?: string;
  important?: boolean;
  isImportant?: boolean;
  note?: string;
}

export interface LabReport {
  id: string;
  date: string;
  title: string;
  rawText: string;
  items: ParsedLabItem[];
}

export interface PhysicalExamEntry {
  id: string;
  date: string;
  system: string;
  finding: string;
  isImportant: boolean;
  color: string;
  note: string;
}

export interface ImageStudyEntry {
  id: string;
  date: string;
  studyType: string;
  finding: string;
  impression: string;
  isImportant: boolean;
  color: string;
  note: string;
}

export type AssessmentPlanCategory = "activeProblem" | "underlyingDisease" | "other";

export interface AssessmentPlanItem {
  id: string;
  problemTitle: string;
  assessmentSummary: string;
  evidenceOrCourseItems: string[];
  planItems: string[];
  category: AssessmentPlanCategory;
  isImportant: boolean;
  color: string;
  order: number;
}

export interface ActiveProblemItem {
  id: string;
  title: string;
  note: string;
  isImportant: boolean;
  color: string;
  order: number;
}

export interface PatientTask {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  category: TaskCategory;
  dueDate: string;
  createdAt: string;
  completedAt: string;
}

export interface DailyNote {
  date: string;
  importantRedFlags: string;
  overnightEvents: string;
  subjectiveOrChiefConcern: string;
  physicalExam: string;
  labSummary: string;
  imageSummary: string;
  assessment: string;
  plan: string;
  dischargePlan: string;
  vsOrder: string;
  rawLabText: string;
  labDate: string;
  labReportTitle: string;
  labReports: LabReport[];
  parsedLabItems: ParsedLabItem[];
  physicalExamEntries: PhysicalExamEntry[];
  imageStudyEntries: ImageStudyEntry[];
  assessmentPlanItems: AssessmentPlanItem[];
  updatedAt: string;
  createdAt: string;
}

export type DailyNotesByPatient = Record<string, DailyNote[]>;

export type ThemePreference = "light" | "dark" | "system";
export type LanguagePreference = "en" | "zh-TW";

export interface UserPreferences {
  theme: ThemePreference;
  language: LanguagePreference;
}

export interface PhonebookContact {
  id: string;
  name: string;
  roleOrUnit: string;
  phone: string;
  note: string;
  isImportant: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MiscTask {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  dueDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyTopic {
  id: string;
  topic: string;
  note: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Patient {
  id: string;
  bed: string;
  patientCode: string;
  oneLiner: string;
  age: number;
  sex: PatientSex;
  underlyingDiseases: string;
  underlyingDiseaseItems: string[];
  attending: string;
  teamOrService: string;
  admissionDate: string;
  primaryDiagnosis: string;
  activeProblems: string;
  activeProblemItems: string[];
  activeProblemStructuredItems: ActiveProblemItem[];
  chiefComplaint: string;
  presentIllnessOrHPI: string;
  admissionBriefFreeText: string;
  admissionChiefConcern: string;
  hpiOrAdmissionStory: string;
  baselineFunction: string;
  admissionPMH: string;
  initialPhysicalExam: string;
  initialLabs: string;
  initialImaging: string;
  initialAssessment: string;
  initialPlan: string;
  earlyHospitalCourse: string;
  admissionBriefNotes: string;
  isNewAdmission: boolean;
  showAdmissionBriefOnPrint: boolean;
  physicalExam: string;
  hospitalCourseHighlights: string;
  importantRedFlags: string;
  rawLabText: string;
  labDate: string;
  labReportTitle: string;
  labReports: LabReport[];
  parsedLabItems: ParsedLabItem[];
  physicalExamEntries: PhysicalExamEntry[];
  imageStudyEntries: ImageStudyEntry[];
  dischargeMedsStatus: DischargePrepStatus;
  opdAppointmentStatus: DischargePrepStatus;
  diagnosisCertificateStatus: DischargePrepStatus;
  overnightEvent: string;
  subjectiveOrChiefConcern: string;
  newLabs: string;
  newImaging: string;
  assessment: string;
  plan: string;
  assessmentPlanItems: AssessmentPlanItem[];
  dischargePlan: string;
  dischargeTargetDate: string;
  dischargeBarriers: string;
  specialAttention: string;
  vsOrder: string;
  status: PatientStatus;
  tasks: PatientTask[];
  aiThinkingPrompts: AiThinkingPrompt[];
  updatedAt: string;
  createdAt: string;
}
