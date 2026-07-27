// Date and id primitives shared across the app. Extracted from utils.ts (Phase 1 refactor).

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateKey(input: unknown, fallback = todayKey()) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, "0");
    const day = String(input.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const value = String(input ?? "").trim();
  const dateMatch = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return fallback;
}

function yearFromDateKey(dateKey: string) {
  return normalizeDateKey(dateKey).slice(0, 4);
}

export function dateFromClinicalText(value: string, fallback = todayKey()) {
  const text = String(value ?? "");
  const fullDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (fullDate) {
    const [, year, month, day] = fullDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const shortDate = text.match(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?=$|[^\d])/);
  if (shortDate) {
    const [, month, day] = shortDate;
    return `${yearFromDateKey(fallback)}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return normalizeDateKey(fallback);
}

export function stripLeadingClinicalDate(value: string) {
  return value
    .replace(/^\s*20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s*(?:[:：,-]|\s)\s*/i, "")
    .replace(/^\s*\d{1,2}\/\d{1,2}\s*(?:[:：,-]|\s)\s*/i, "")
    .trim();
}

export function formatDateLabel(dateKey: string) {
  const normalized = normalizeDateKey(dateKey, "");
  return normalized ? normalized.replace(/-/g, "/") : "Date missing";
}

