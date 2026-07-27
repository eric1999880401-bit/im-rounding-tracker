import type { AiDocumentType, Patient } from "./types";

/**
 * Persist only the document text the clinician can see and edit. Model-only
 * summaries/sections must never hitchhike into patient-master fields.
 */
export function reviewedAiDocumentPatientPatch(
  documentType: AiDocumentType,
  finalText: string,
  updatedAt: string,
): Partial<Patient> {
  const common: Partial<Patient> = { updatedAt };
  if (documentType === "admissionNote") {
    return { ...common, generatedAdmissionNote: finalText, admissionBriefNotes: finalText };
  }
  if (documentType === "admissionSummary") {
    return { ...common, generatedAdmissionSummary: finalText, admissionBriefFreeText: finalText };
  }
  if (documentType === "dischargeHospitalCourse") {
    return { ...common, generatedDischargeSummary: finalText };
  }
  if (documentType === "weeklySummary") {
    return { ...common, generatedWeeklySummary: finalText };
  }
  return { ...common, generatedSbarNote: finalText };
}
