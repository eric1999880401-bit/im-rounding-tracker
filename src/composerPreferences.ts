// Remembers the SOAP composer's UI-only toolbar choices (editor format, AI
// quality) across sessions so they are not re-picked every time. These are
// display/cost preferences, not patient data — localStorage is appropriate
// (the no-localStorage rule applies to patient data only).

const STORAGE_PREFIX = "imrt.composer.";

function readPref(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Ignore quota/private-mode failures; the choice simply won't persist.
  }
}

export function readComposerPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = readPref(key, fallback) as T;
  return allowed.includes(value) ? value : fallback;
}

export function writeComposerPref(key: string, value: string) {
  writePref(key, value);
}
