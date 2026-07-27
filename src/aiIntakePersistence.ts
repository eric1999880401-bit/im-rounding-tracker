/**
 * Explicit persistence contract for clinician-accepted AI Intake review cards.
 *
 * `assessmentPlan` remains SOAP-preview-only: AiIntake does not emit it as an
 * independently accept/reject card because A/P must be reviewed as one SOAP
 * document. Thinking prompts and uncertainty stay outside SOAP so an AI
 * question is never mislabeled as the clinician's plan.
 */
export type AiIntakeReviewCardKind =
  | "oneLiner"
  | "admissionSummary"
  | "isbarHandoff"
  | "chiefConcern"
  | "symptom"
  | "importantSymptom"
  | "overnightEvent"
  | "importantOvernightEvent"
  | "vital"
  | "bloodSugar"
  | "physicalExam"
  | "lab"
  | "image"
  | "assessmentPlan"
  | "redFlag"
  | "task"
  | "dischargeIssue"
  | "thinkingPrompt"
  | "uncertainty";

export const AI_INTAKE_REVIEW_CARD_DESTINATIONS = {
  oneLiner: ["patient.oneLiner"],
  admissionSummary: ["patient.admissionBriefFreeText", "patient.generatedAdmissionSummary"],
  isbarHandoff: ["patient.generatedSbarNote"],
  chiefConcern: ["patient.subjectiveOrChiefConcern", "dailyNote.subjectiveOrChiefConcern"],
  symptom: ["patient.subjectiveOrChiefConcern", "dailyNote.subjectiveOrChiefConcern"],
  importantSymptom: ["patient.subjectiveOrChiefConcern", "dailyNote.subjectiveOrChiefConcern"],
  overnightEvent: ["patient.overnightEvent", "dailyNote.overnightEvents"],
  importantOvernightEvent: ["patient.overnightEvent", "dailyNote.overnightEvents"],
  vital: ["patient.vitalSigns", "dailyNote.vitalSigns"],
  bloodSugar: ["patient.bloodSugar", "dailyNote.bloodSugar"],
  physicalExam: ["patient.physicalExam", "patient.physicalExamEntries", "dailyNote.physicalExam", "dailyNote.physicalExamEntries"],
  lab: ["patient.newLabs", "patient.rawLabText", "patient.labReports", "patient.parsedLabItems", "dailyNote.labSummary", "dailyNote.rawLabText", "dailyNote.labReports", "dailyNote.parsedLabItems"],
  image: ["patient.newImaging", "patient.imageStudyEntries", "dailyNote.imageSummary", "dailyNote.imageStudyEntries"],
  assessmentPlan: ["soapPreview.assessmentPlan"],
  redFlag: ["patient.importantRedFlags", "dailyNote.importantRedFlags"],
  task: ["patient.tasks"],
  dischargeIssue: ["patient.dischargeBarriers", "dailyNote.dischargePlan"],
  thinkingPrompt: ["patient.aiThinkingPrompts"],
  uncertainty: ["patient.aiThinkingPrompts"],
} as const satisfies Record<AiIntakeReviewCardKind, readonly string[]>;
