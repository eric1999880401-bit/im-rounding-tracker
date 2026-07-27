import type { DailyNote, Patient } from "./types";

export interface BulkReviewRevision {
  patientId: string;
  patientUpdatedAt: string;
  noteDate: string;
  noteExists: boolean;
  noteSoapVersion: number;
  noteUpdatedAt: string;
}

function persistedSoapVersion(note: Pick<DailyNote, "soapVersion"> | undefined) {
  if (!note) return 0;
  const version = Number(note.soapVersion);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

export function captureBulkReviewRevision(
  patient: Pick<Patient, "id" | "updatedAt" | "persistedUpdatedAt">,
  note: Pick<DailyNote, "soapVersion" | "updatedAt"> | undefined,
  noteDate: string,
): BulkReviewRevision {
  return {
    patientId: patient.id,
    patientUpdatedAt: patient.persistedUpdatedAt ?? patient.updatedAt,
    noteDate,
    noteExists: Boolean(note),
    noteSoapVersion: persistedSoapVersion(note),
    noteUpdatedAt: String(note?.updatedAt ?? ""),
  };
}

export function bulkReviewConflictReason(
  reviewed: BulkReviewRevision | undefined,
  current: BulkReviewRevision,
) {
  if (!reviewed) return "Bulk import review is not bound to a patient revision. Analyze the source again.";
  if (reviewed.patientId !== current.patientId) {
    return "Bulk import patient identity changed after review. Analyze the source again.";
  }
  if (reviewed.noteDate !== current.noteDate) {
    return "The rounding date changed after bulk review. Analyze the source again for today's note.";
  }
  if (reviewed.patientUpdatedAt !== current.patientUpdatedAt) {
    return "This patient changed in another tab or device after bulk review. Reload and analyze again.";
  }
  if (
    reviewed.noteExists !== current.noteExists
    || reviewed.noteSoapVersion !== current.noteSoapVersion
    || reviewed.noteUpdatedAt !== current.noteUpdatedAt
  ) {
    return "This daily note changed after bulk review. Reload and analyze again; no reviewed draft was applied.";
  }
  return "";
}
