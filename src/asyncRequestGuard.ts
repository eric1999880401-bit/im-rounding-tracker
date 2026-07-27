export interface PatientRequestIdentity {
  requestId: number;
  patientId: string;
}

export interface DocumentRequestIdentity<DocumentType extends string = string> extends PatientRequestIdentity {
  documentType: DocumentType;
}

export interface PatientContextRequestIdentity extends PatientRequestIdentity {
  selectedDate: string;
  contextKey: string;
}

export interface DocumentContextRequestIdentity<DocumentType extends string = string>
  extends DocumentRequestIdentity<DocumentType> {
  contextKey: string;
}

export function isLatestRequest(request: PatientRequestIdentity, latestRequestId: number) {
  return request.requestId === latestRequestId;
}

export function canApplyPatientRequest(
  request: PatientRequestIdentity,
  latestRequestId: number,
  currentPatientId: string,
) {
  return isLatestRequest(request, latestRequestId) && request.patientId === currentPatientId;
}

export function canApplyDocumentRequest<DocumentType extends string>(
  request: DocumentRequestIdentity<DocumentType>,
  latestRequestId: number,
  currentPatientId: string,
  currentDocumentType: DocumentType,
) {
  return (
    canApplyPatientRequest(request, latestRequestId, currentPatientId) &&
    request.documentType === currentDocumentType
  );
}

export function canApplyPatientContextRequest(
  request: PatientContextRequestIdentity,
  latestRequestId: number,
  currentPatientId: string,
  currentSelectedDate: string,
  currentContextKey: string,
) {
  return (
    canApplyPatientRequest(request, latestRequestId, currentPatientId) &&
    request.selectedDate === currentSelectedDate &&
    request.contextKey === currentContextKey
  );
}

export function isPatientContextDraftBoundToSelection(
  binding: Pick<PatientContextRequestIdentity, "patientId" | "selectedDate"> | null,
  currentPatientId: string,
  currentSelectedDate: string,
) {
  return Boolean(
    binding &&
      binding.patientId === currentPatientId &&
      binding.selectedDate === currentSelectedDate,
  );
}

export function canApplyDocumentContextRequest<DocumentType extends string>(
  request: DocumentContextRequestIdentity<DocumentType>,
  latestRequestId: number,
  currentPatientId: string,
  currentDocumentType: DocumentType,
  currentContextKey: string,
) {
  return (
    canApplyDocumentRequest(
      request,
      latestRequestId,
      currentPatientId,
      currentDocumentType,
    ) && request.contextKey === currentContextKey
  );
}

export function isPatientReviewBoundToContext(
  binding: PatientContextRequestIdentity | null,
  currentPatientId: string,
  currentSelectedDate: string,
  currentContextKey: string,
) {
  return Boolean(
    binding &&
      binding.patientId === currentPatientId &&
      binding.selectedDate === currentSelectedDate &&
      binding.contextKey === currentContextKey,
  );
}

export function isDocumentReviewBoundToContext<DocumentType extends string>(
  binding: DocumentContextRequestIdentity<DocumentType> | null,
  currentPatientId: string,
  currentDocumentType: DocumentType,
  currentContextKey: string,
) {
  return Boolean(
    binding &&
      binding.patientId === currentPatientId &&
      binding.documentType === currentDocumentType &&
      binding.contextKey === currentContextKey,
  );
}

export function isDocumentDraftBoundToSelection<DocumentType extends string>(
  binding: DocumentRequestIdentity<DocumentType> | null,
  currentPatientId: string,
  currentDocumentType: DocumentType,
) {
  return Boolean(
    binding &&
      binding.patientId === currentPatientId &&
      binding.documentType === currentDocumentType,
  );
}
