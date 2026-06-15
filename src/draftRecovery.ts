export type RecoveryDraftKind = "patientDetail" | "roundSoap";

export interface RecoveryDraftScope {
  kind: RecoveryDraftKind;
  patientId: string;
  selectedDate: string;
}

export interface RecoveryDraft<T> extends RecoveryDraftScope {
  version: 1;
  savedFingerprint: string;
  savedUpdatedAt: string;
  draftUpdatedAt: string;
  payload: T;
}

export interface RecoveryDraftStaleState {
  stale: boolean;
  reason: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DRAFT_PREFIX = "imrt:session-recovery:v1";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function recoveryFingerprint(value: unknown) {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function recoveryDraftKey(scope: RecoveryDraftScope) {
  return [DRAFT_PREFIX, scope.kind, encodeURIComponent(scope.patientId), encodeURIComponent(scope.selectedDate)].join(":");
}

export function getSessionDraftStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecoveryDraft<T>(value: unknown, scope: RecoveryDraftScope): value is RecoveryDraft<T> {
  const draft = value as RecoveryDraft<T>;
  return (
    draft?.version === 1 &&
    draft.kind === scope.kind &&
    draft.patientId === scope.patientId &&
    draft.selectedDate === scope.selectedDate &&
    typeof draft.savedFingerprint === "string" &&
    typeof draft.savedUpdatedAt === "string" &&
    typeof draft.draftUpdatedAt === "string" &&
    "payload" in draft
  );
}

export function readRecoveryDraft<T>(storage: StorageLike | null, scope: RecoveryDraftScope): RecoveryDraft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(recoveryDraftKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecoveryDraft<T>(parsed, scope) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRecoveryDraft<T>(storage: StorageLike | null, draft: RecoveryDraft<T>) {
  if (!storage) return false;
  try {
    storage.setItem(recoveryDraftKey(draft), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeRecoveryDraft(storage: StorageLike | null, scope: RecoveryDraftScope) {
  if (!storage) return;
  try {
    storage.removeItem(recoveryDraftKey(scope));
  } catch {
    // Session draft cleanup should never block the clinical save path.
  }
}

export function recoveryStaleState<T>(
  draft: RecoveryDraft<T>,
  currentSavedFingerprint: string,
  currentSavedUpdatedAt = "",
): RecoveryDraftStaleState {
  if (draft.savedFingerprint !== currentSavedFingerprint) {
    return {
      stale: true,
      reason: "Saved patient/SOAP data changed after this recovery draft was created.",
    };
  }

  if (draft.savedUpdatedAt && currentSavedUpdatedAt && draft.savedUpdatedAt < currentSavedUpdatedAt) {
    return {
      stale: true,
      reason: "A newer saved version exists. Restore only if you intentionally want to review this older local draft.",
    };
  }

  return { stale: false, reason: "" };
}

export function makeRecoveryDraft<T>(
  scope: RecoveryDraftScope,
  payload: T,
  savedBaseline: unknown,
  savedUpdatedAt = "",
): RecoveryDraft<T> {
  return {
    ...scope,
    version: 1,
    savedFingerprint: recoveryFingerprint(savedBaseline),
    savedUpdatedAt,
    draftUpdatedAt: new Date().toISOString(),
    payload,
  };
}

