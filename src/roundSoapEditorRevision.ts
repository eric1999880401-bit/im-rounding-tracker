import type { DailyNote } from "./types";

export interface RoundSoapEditorRevision {
  patientId: string;
  selectedDate: string;
  /** Patient-document revision loaded with this editor draft. */
  patientUpdatedAt: string;
  /** Firestore optimistic-lock version that this editor draft was based on. */
  soapVersion: number;
  /** Exact subscribed/local note snapshot used to build the draft. */
  note: DailyNote | undefined;
}

function normalizedExistingSoapVersion(note: DailyNote | undefined) {
  if (!note) return 0;
  const version = Number(note.soapVersion);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

export function captureRoundSoapEditorRevision(
  patientId: string,
  selectedDate: string,
  note: DailyNote | undefined,
  patientUpdatedAt: string,
): RoundSoapEditorRevision {
  return {
    patientId,
    selectedDate,
    patientUpdatedAt,
    soapVersion: normalizedExistingSoapVersion(note),
    note,
  };
}

export function roundSoapEditorRevisionMatchesSelection(
  revision: RoundSoapEditorRevision,
  patientId: string,
  selectedDate: string,
) {
  return revision.patientId === patientId && revision.selectedDate === selectedDate;
}

/**
 * A subscribed snapshot may refresh the editor base only while the editor is
 * clean. Keeping the original object while dirty is intentional: the next
 * transaction must submit the version the clinician actually edited, so a
 * newer remote note produces a conflict instead of being overwritten.
 */
export function reconcileRoundSoapEditorRevision(
  current: RoundSoapEditorRevision,
  patientId: string,
  selectedDate: string,
  subscribedNote: DailyNote | undefined,
  patientUpdatedAt: string,
  preserveCurrent: boolean,
) {
  if (preserveCurrent) return current;
  const subscribedRevision = captureRoundSoapEditorRevision(
    patientId,
    selectedDate,
    subscribedNote,
    patientUpdatedAt,
  );
  if (
    roundSoapEditorRevisionMatchesSelection(current, patientId, selectedDate)
    && subscribedRevision.soapVersion < current.soapVersion
  ) {
    // A just-committed local revision can lead its subscription briefly. Never
    // regress it, or a rapid second save would submit an older base version.
    return current;
  }
  return subscribedRevision;
}
