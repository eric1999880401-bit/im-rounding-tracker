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
  | "dailyUpdate"
  | "admission"
  | "vitals"
  | "lab"
  | "image"
  | "progress"
  | "consult"
  | "nursing";

export type AiDocumentType =
  | "admissionNote"
  | "admissionSummary"
  | "dischargeHospitalCourse"
  | "weeklySummary"
  | "isbar";

export interface ClinicalReasoningBundle {
  currentClinicalState: string;
  primaryRisk: string;
  whyThisMatters: Array<{
    fact: string;
    source: string;
    implication: string;
  }>;
  activeProblemsRanked: Array<{
    problem: string;
    status: "active" | "improving" | "resolved" | "uncertain";
    whyImportant: string;
    evidence: string[];
    todayPlan: string[];
    callThresholds: string[];
  }>;
  resolvedOrLessImportant: string[];
  missingDataNeeded: string[];
  noiseToIgnore: string[];
}

export interface AiSoapDraft {
  oneLiner: string;
  admissionSummary: string;
  isbarHandoff: string;
  clinicalReasoning?: ClinicalReasoningBundle;
  subjective: {
    chiefConcern: string;
    symptoms: string[];
    overnightEvents: string[];
    importantSymptoms: string[];
    importantOvernightEvents: string[];
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
    bloodSugars: Array<{
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

export interface AiDocumentDraft {
  documentType: AiDocumentType;
  title: string;
  conciseSummary: string;
  clinicalReasoning?: ClinicalReasoningBundle;
  sections: Array<{
    heading: string;
    content: string;
  }>;
  followUpItems: string[];
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
  };
}

export interface AnalyzeClinicalTextResult {
  draftId: string;
  draft: AiSoapDraft;
  model: string;
  rawTextPreview: string;
}

export interface GenerateRoundSoapInput {
  patientId: string;
  selectedDate: string;
  sourceType: AiClinicalSourceType;
  workflowMode?: "dailyUpdate" | "newSoap" | "transferHandoff";
  rawText: string;
  currentSoapBaseline: string;
  deidentifiedConfirmed: boolean;
  patientContext?: {
    age?: string | number;
    sex?: string;
    pmh?: string[] | string;
    activeProblems?: string[] | string;
  };
}

export interface GenerateRoundSoapResult {
  draftId: string;
  soapText: string;
  warnings: string[];
  highlightHints: string[];
  model: string;
}

export type PatientImportDraftStatus = "new" | "updateCandidate";

export interface PatientImportDraft {
  id: string;
  status: PatientImportDraftStatus;
  matchPatientId: string;
  sourceIndex: number;
  bed: string;
  patientCode: string;
  age: string;
  sex: PatientSex | "";
  attending: string;
  teamOrService: string;
  primaryDiagnosis: string;
  oneLiner: string;
  chiefComplaint: string;
  todayUpdates: string;
  vitalSigns: string;
  physicalExam: string;
  labText: string;
  imageText: string;
  admissionSummary: string;
  underlyingDiseases: string;
  activeProblems: string;
  hospitalCourseHighlights: string;
  importantRedFlags: string;
  tasks: Array<{
    text: string;
    priority: TaskPriority;
    dueDate: string;
    category: TaskCategory;
  }>;
  antibioticsProceduresConsults: string[];
  dischargePlan: string;
  disposition: string;
  uncertainty: string[];
  sourceExcerpt: string;
}

export interface AnalyzePatientBatchTextInput {
  rawText: string;
  deidentifiedConfirmed: boolean;
  importMode?: "newAdmission" | "existingInpatient";
  targetPatientId?: string;
  existingPatients?: Array<{
    id: string;
    bed: string;
    patientCode: string;
    age?: number | string;
    sex?: Patient["sex"];
    attending?: string;
    teamOrService?: string;
    primaryDiagnosis?: string;
    oneLiner?: string;
    underlyingDiseases?: string;
    activeProblems?: string;
  }>;
}

export interface AnalyzePatientBatchTextResult {
  draftId: string;
  drafts: PatientImportDraft[];
  model: string;
  rawTextPreview: string;
}

export type ClinicalSourceLevel = "A" | "B" | "C" | "D" | "E";

export type ClinicalRuleSeverity = "urgent" | "today" | "routine" | "review";

export interface ClinicalSourceRef {
  id: string;
  level: ClinicalSourceLevel;
  title: string;
  url: string;
  note: string;
  lastReviewed: string;
  owner: string;
  uncertainty?: string;
}

export interface ClinicalFactBundle {
  sourceText: string;
  diagnoses: string[];
  pmh: string[];
  activeProblems: string[];
  objectiveFacts: string[];
  medications: string[];
  antibiotics: string[];
  procedures: string[];
  consults: string[];
  hospitalCourse: string[];
  todayUpdates: string[];
  pendingItems: string[];
  dischargeDisposition: string[];
  immunocompromisedSignals: string[];
  uncertainty: string[];
}

export interface ClinicalRuleMatch {
  id: string;
  scope: string;
  title: string;
  severity: ClinicalRuleSeverity;
  matchedTriggers: string[];
  sourceRefs: ClinicalSourceRef[];
  needsReview: boolean;
}

export interface GeneratedClinicalPlan {
  facts: ClinicalFactBundle;
  ruleMatches: ClinicalRuleMatch[];
  redFlags: Array<{
    text: string;
    reason: string;
    severity: ClinicalRuleSeverity;
    sourceRefs: ClinicalSourceRef[];
  }>;
  todayTasks: Array<{
    text: string;
    priority: TaskPriority;
    category: TaskCategory;
    reason: string;
    sourceRefs: ClinicalSourceRef[];
  }>;
  problemBasedAP: Array<{
    problemTitle: string;
    assessmentSummary: string;
    evidenceOrCourseItems: string[];
    planItems: string[];
    isImportant: boolean;
    sourceRefs: ClinicalSourceRef[];
  }>;
  handoffWarnings: string[];
  printSummary: string;
  sbarRecommendation: string;
  needsReview: boolean;
}

export interface GenerateClinicalDocumentInput {
  patientId: string;
  documentType: AiDocumentType;
  rawText?: string;
  dateFrom?: string;
  dateTo?: string;
  deidentifiedConfirmed: boolean;
  storeRawText?: boolean;
}

export interface GenerateClinicalDocumentResult {
  draftId: string;
  draft: AiDocumentDraft;
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
  soapText?: string;
  soapStatus?: "draft" | "reviewed";
  soapUpdatedAt?: string;
  soapVersion?: number;
  importantRedFlags: string;
  overnightEvents: string;
  subjectiveOrChiefConcern: string;
  vitalSigns: string;
  bloodSugar: string;
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
  generatedAdmissionNote: string;
  generatedAdmissionSummary: string;
  generatedDischargeSummary: string;
  generatedWeeklySummary: string;
  generatedSbarNote: string;
  isNewAdmission: boolean;
  showAdmissionBriefOnPrint: boolean;
  physicalExam: string;
  hospitalCourseHighlights: string;
  importantRedFlags: string;
  vitalSigns: string;
  bloodSugar: string;
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
