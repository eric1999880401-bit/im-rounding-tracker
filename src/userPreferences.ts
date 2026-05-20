import type {
  DailyNotesByPatient,
  Patient,
  PrintDensity,
  RoundingLayoutPreferences,
  RoundingLayoutPreset,
  RoundingLayoutSection,
  UserAiStyleProfile,
  UserPreferences,
} from "./types";
import { parseSoapText } from "./soapDraft";
import { classifyClinicalLine } from "./clinicalLineClassifier";

export const roundingLayoutSections: Array<{ id: RoundingLayoutSection; label: string }> = [
  { id: "redFlags", label: "Red flag (AI)" },
  { id: "subjective", label: "S" },
  { id: "objectiveVitals", label: "O: V/S" },
  { id: "objectivePhysicalExam", label: "O: PE" },
  { id: "objectiveLabs", label: "O: Lab" },
  { id: "objectiveImages", label: "O: Image" },
  { id: "assessmentPlan", label: "A/P" },
  { id: "orders", label: "Orders" },
  { id: "tasks", label: "Tasks" },
  { id: "dcBarriers", label: "DC barriers" },
  { id: "dcPrep", label: "Meds / OPD / Cert" },
];

export const defaultVisibleRoundingSections: Record<RoundingLayoutSection, boolean> = {
  redFlags: true,
  subjective: true,
  objectiveVitals: true,
  objectivePhysicalExam: true,
  objectiveLabs: true,
  objectiveImages: true,
  assessmentPlan: true,
  orders: true,
  tasks: true,
  dcBarriers: true,
  dcPrep: true,
};

export const layoutPresetLabels: Record<RoundingLayoutPreset, string> = {
  compactSoap: "Compact SOAP",
  fullSoap: "Full SOAP",
  taskDcFocused: "Task/DC focused",
};

export function visibleSectionsForPreset(preset: RoundingLayoutPreset): Record<RoundingLayoutSection, boolean> {
  if (preset === "fullSoap") return { ...defaultVisibleRoundingSections };
  if (preset === "taskDcFocused") {
    return {
      ...defaultVisibleRoundingSections,
      objectivePhysicalExam: false,
      objectiveImages: false,
      assessmentPlan: false,
    };
  }
  return { ...defaultVisibleRoundingSections };
}

export const defaultRoundingLayoutPreferences: RoundingLayoutPreferences = {
  preset: "compactSoap",
  visibleSections: visibleSectionsForPreset("compactSoap"),
  printDensity: "compact",
  boardDensity: "compact",
};

export const defaultPreferences: UserPreferences = {
  theme: "system",
  language: "en",
  roundingLayout: defaultRoundingLayoutPreferences,
};

function normalizePrintDensity(value: unknown, fallback: PrintDensity): PrintDensity {
  return value === "normal" || value === "compact" || value === "ultra-compact" ? value : fallback;
}

function normalizePreset(value: unknown): RoundingLayoutPreset {
  return value === "fullSoap" || value === "taskDcFocused" ? value : "compactSoap";
}

export function normalizeRoundingLayoutPreferences(value: unknown): RoundingLayoutPreferences {
  const source = (value && typeof value === "object" ? value : {}) as Partial<RoundingLayoutPreferences>;
  const preset = normalizePreset(source.preset);
  const base = visibleSectionsForPreset(preset);
  const customVisible = (source.visibleSections && typeof source.visibleSections === "object" ? source.visibleSections : {}) as Partial<Record<RoundingLayoutSection, boolean>>;
  return {
    preset,
    visibleSections: Object.fromEntries(
      roundingLayoutSections.map((section) => [section.id, typeof customVisible[section.id] === "boolean" ? customVisible[section.id] : base[section.id]]),
    ) as Record<RoundingLayoutSection, boolean>,
    printDensity: normalizePrintDensity(source.printDensity, defaultRoundingLayoutPreferences.printDensity),
    boardDensity: normalizePrintDensity(source.boardDensity, defaultRoundingLayoutPreferences.boardDensity),
  };
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = (value && typeof value === "object" ? value : {}) as Partial<UserPreferences>;
  return {
    theme: source.theme === "light" || source.theme === "dark" || source.theme === "system" ? source.theme : defaultPreferences.theme,
    language: source.language === "zh-TW" ? "zh-TW" : "en",
    roundingLayout: normalizeRoundingLayoutPreferences(source.roundingLayout),
    aiStyleProfile: normalizeUserAiStyleProfile(source.aiStyleProfile),
  };
}

export function isLayoutSectionVisible(layout: RoundingLayoutPreferences | undefined, section: RoundingLayoutSection) {
  return normalizeRoundingLayoutPreferences(layout).visibleSections[section];
}

export function isSoapHeaderLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  return !/^Red flags:/i.test(line.trim()) || isLayoutSectionVisible(layout, "redFlags");
}

export function isObjectiveSoapLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  const kind = classifyClinicalLine(line, { fallbackKind: "other" }).kind;
  if (kind === "vs") return isLayoutSectionVisible(layout, "objectiveVitals");
  if (kind === "lab") return isLayoutSectionVisible(layout, "objectiveLabs");
  if (kind === "image") return isLayoutSectionVisible(layout, "objectiveImages");
  return isLayoutSectionVisible(layout, "objectivePhysicalExam");
}

function isOrderLine(line: string) {
  return /^\s*(?:order|orders?)\s*:/i.test(line) || /\b(order|check|repeat|trend|monitor)\b/i.test(line);
}

export function isTaskSoapLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  return isOrderLine(line) ? isLayoutSectionVisible(layout, "orders") : isLayoutSectionVisible(layout, "tasks");
}

export function isDcSoapLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  const isPrep = /\b(meds?|opd|certificate|cert|diagnosis certificate|診斷|帶藥|門診)\b/i.test(line);
  return isPrep ? isLayoutSectionVisible(layout, "dcPrep") : isLayoutSectionVisible(layout, "dcBarriers");
}

const abbreviationWhitelist = [
  "w/",
  "s/p",
  "r/o",
  "f/u",
  "Abx",
  "Cx",
  "B/C",
  "PNA",
  "RF",
  "AKI",
  "CKD",
  "ESRD",
  "HD",
  "CT",
  "CXR",
  "TTE",
  "OPD",
  "DC",
  "PRN",
];

function median(values: number[], fallback: number) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) return fallback;
  return clean[Math.floor(clean.length / 2)];
}

export function normalizeUserAiStyleProfile(value: unknown): UserAiStyleProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<UserAiStyleProfile>;
  return {
    apProblemCount: Math.max(1, Math.min(6, Number(source.apProblemCount) || 4)),
    apLineLimit: Math.max(1, Math.min(3, Number(source.apLineLimit) || 2)),
    preferredTerms: Array.isArray(source.preferredTerms)
      ? source.preferredTerms.map(String).filter((term) => abbreviationWhitelist.includes(term)).slice(0, 12)
      : [],
    taskStyle: source.taskStyle === "detailed" || source.taskStyle === "checklist" ? source.taskStyle : "concise",
    sectionOrder: Array.isArray(source.sectionOrder)
      ? source.sectionOrder.map(String).filter((item) => ["Header", "S", "O", "A/P", "Tasks", "DC"].includes(item)).slice(0, 6)
      : ["Header", "S", "O", "A/P", "Tasks", "DC"],
    updatedAt: String(source.updatedAt ?? ""),
  };
}

export function buildUserAiStyleProfile(patients: Patient[], dailyNotesByPatient: DailyNotesByPatient): UserAiStyleProfile {
  const reviewedTexts = patients.flatMap((patient) =>
    (dailyNotesByPatient[patient.id] ?? [])
      .filter((note) => note.soapText?.trim() && note.soapStatus === "reviewed")
      .map((note) => String(note.soapText ?? "").trim())
      .filter(Boolean),
  );
  const drafts = reviewedTexts.map(parseSoapText);
  const apCounts = drafts.map((draft) => draft.apProblems.length).filter((count) => count > 0);
  const apLineCounts = drafts.flatMap((draft) => draft.apProblems.map((problem) => Math.max(1, problem.lines.length)));
  const taskLengths = drafts.flatMap((draft) => draft.taskLines.map((line) => line.length));
  const allText = reviewedTexts.join("\n");
  const preferredTerms = abbreviationWhitelist
    .map((term) => ({ term, count: (allText.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((item) => item.term)
    .slice(0, 10);

  const taskMedian = median(taskLengths, 55);
  return {
    apProblemCount: median(apCounts, 4),
    apLineLimit: median(apLineCounts, 2),
    preferredTerms,
    taskStyle: taskMedian > 90 ? "detailed" : taskMedian > 55 ? "checklist" : "concise",
    sectionOrder: ["Header", "S", "O", "A/P", "Tasks", "DC"],
    updatedAt: new Date().toISOString(),
  };
}
