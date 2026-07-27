import type { Patient } from "./types";

/**
 * Apply only the Admission Summary that is visible for clinician review.
 * Source-derived fields must be accepted through their own visible controls;
 * they may not hitchhike on the eventual full-patient save.
 */
export function applyVisibleAdmissionSummaryEdit(
  patient: Patient,
  summary: string,
  updatedAt = new Date().toISOString(),
): Patient {
  return {
    ...patient,
    admissionBriefFreeText: summary,
    updatedAt,
  };
}
