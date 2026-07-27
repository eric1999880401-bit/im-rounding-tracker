export interface ClinicalSaveState {
  persistedSoapVersion: number;
  expectedSoapVersion: number;
  patientExists: boolean;
  persistedPatientUpdatedAt: string;
  expectedPatientUpdatedAt?: string;
}

export function clinicalSaveConflictReason(state: ClinicalSaveState) {
  if (state.persistedSoapVersion !== state.expectedSoapVersion) {
    return `SOAP save conflict: this note changed from version ${state.expectedSoapVersion} to ${state.persistedSoapVersion}. Reload and review before saving again.`;
  }
  if (!state.patientExists) return "SOAP save conflict: the patient record no longer exists.";
  if (
    state.expectedPatientUpdatedAt !== undefined
    && state.persistedPatientUpdatedAt !== state.expectedPatientUpdatedAt
  ) {
    return "Patient save conflict: this patient changed in another tab or device. Reload and review before saving SOAP.";
  }
  return "";
}
