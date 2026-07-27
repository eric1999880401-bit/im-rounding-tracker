import type { DailyNote, Patient } from "./types";

export type DailyNotesReadiness = Record<string, boolean>;
export interface ClinicalSnapshotMetadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

const bedCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function sortText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedDate(value: unknown) {
  const match = sortText(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Normalizes only an explicit source date; missing/invalid input stays missing. */
export function normalizeOptionalDateKey(value: unknown) {
  return normalizedDate(value);
}

function sortableDate(value: unknown) {
  return normalizedDate(value);
}

export function resolveLegacyDailyNoteLabDate(documentDate: string, storedLabDate: unknown) {
  const normalizedDocumentDate = normalizedDate(documentDate) || sortText(documentDate);
  return normalizedDate(storedLabDate) || normalizedDocumentDate;
}

/** Legacy/corrupt revisions must not trap the editor in a permanent conflict. */
export function normalizeSoapVersion(value: unknown) {
  const version = Number(value);
  return Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
}

/**
 * DITTO copies the reviewed SOAP verbatim except for its exact Date header,
 * which must describe the target note rather than the source note.
 */
export function retargetSoapDateHeader(text: string, targetDate: string) {
  if (!targetDate) return text;
  return String(text).replace(
    /^([ \t]*Date[ \t]*:[ \t]*)([^\r\n]*?)([ \t]*)$/im,
    (_match, prefix: string, _oldDate: string, trailing: string) => `${prefix}${targetDate}${trailing}`,
  );
}

export function sortPatientsByBed(patients: readonly Patient[]): Patient[] {
  return [...patients].sort((left, right) => {
    const leftBed = sortText(left.bed);
    const rightBed = sortText(right.bed);

    if (!leftBed && rightBed) return 1;
    if (leftBed && !rightBed) return -1;

    const bedComparison = bedCollator.compare(leftBed, rightBed);
    if (bedComparison !== 0) return bedComparison;
    return sortText(left.id).localeCompare(sortText(right.id));
  });
}

export function sortDailyNotesDesc(notes: readonly DailyNote[]): DailyNote[] {
  return [...notes].sort((left, right) => {
    const dateComparison = sortableDate(right.date).localeCompare(sortableDate(left.date));
    if (dateComparison !== 0) return dateComparison;

    const rightUpdatedAt = sortText(right.updatedAt || right.createdAt);
    const leftUpdatedAt = sortText(left.updatedAt || left.createdAt);
    return rightUpdatedAt.localeCompare(leftUpdatedAt);
  });
}

export function recentDailyNotesOnOrBefore(
  notes: readonly DailyNote[],
  selectedDate: string,
  limit: number,
): DailyNote[] {
  if (limit <= 0) return [];
  return sortDailyNotesDesc(
    notes.filter((note) => {
      const date = sortableDate(note.date);
      return Boolean(date) && date <= selectedDate;
    }),
  ).slice(0, limit);
}

export function reconcileDailyNotesReadiness(
  current: DailyNotesReadiness,
  patientIds: readonly string[],
): DailyNotesReadiness {
  return Object.fromEntries(patientIds.map((patientId) => [patientId, current[patientId] === true]));
}

export function patientDailyNotesAreReady(readiness: DailyNotesReadiness, patientId: string) {
  return readiness[patientId] === true;
}

export function snapshotIsServerConfirmed(metadata: ClinicalSnapshotMetadata) {
  return !metadata.fromCache && !metadata.hasPendingWrites;
}

export function markDailyNotesSnapshotReady(
  readiness: DailyNotesReadiness,
  patientId: string,
  metadata: ClinicalSnapshotMetadata,
): DailyNotesReadiness {
  if (!snapshotIsServerConfirmed(metadata) || readiness[patientId] === true) return readiness;
  return { ...readiness, [patientId]: true };
}

export function allPatientDailyNotesAreReady(
  readiness: DailyNotesReadiness,
  patientIds: readonly string[],
) {
  return patientIds.every((patientId) => patientDailyNotesAreReady(readiness, patientId));
}

export function clinicalDataSnapshotsAreReady(
  patientListServerReady: boolean,
  dailyNotesReadiness: DailyNotesReadiness,
  patientIds: readonly string[],
) {
  return patientListServerReady && allPatientDailyNotesAreReady(dailyNotesReadiness, patientIds);
}
