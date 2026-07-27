function canonicalizePrivacyContext(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalizePrivacyContext);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizePrivacyContext(item)]),
    );
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  return value;
}

/**
 * Creates a deterministic binding for the exact source and patient context that
 * the clinician reviewed. This value is kept in component state only; it is not
 * persisted or sent to the backend.
 */
export function createAiPrivacyContextFingerprint(...parts: unknown[]): string {
  return JSON.stringify(parts.map(canonicalizePrivacyContext));
}

export function bindDeidentifiedConfirmation(checked: boolean, currentFingerprint: string): string {
  return checked ? currentFingerprint : "";
}

export function isDeidentifiedConfirmationCurrent(
  confirmedFingerprint: string,
  currentFingerprint: string,
): boolean {
  return Boolean(confirmedFingerprint) && confirmedFingerprint === currentFingerprint;
}
