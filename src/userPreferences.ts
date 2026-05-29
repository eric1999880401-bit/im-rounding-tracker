import type {
  DailyNotesByPatient,
  KeywordHighlightColor,
  KeywordHighlightMatchMode,
  KeywordHighlightRule,
  KeywordHighlightStyle,
  OrderDisplayMode,
  Patient,
  PrintDensity,
  PrintFontSize,
  PrintLineSpacing,
  PrintPadding,
  RoundingLayoutPreferences,
  RoundingLayoutPreset,
  RoundingLayoutSection,
  UserAiStyleProfile,
  UserPreferences,
} from "./types";
import { parseSoapText } from "./soapDraft";
import { classifyClinicalLine } from "./clinicalLineClassifier";
import { stripOrderLinePrefix } from "./medicationOrderParser";

export const roundingLayoutSections: Array<{ id: RoundingLayoutSection; label: string }> = [
  { id: "redFlags", label: "Red flag (AI)" },
  { id: "subjective", label: "S" },
  { id: "objectiveVitals", label: "O: V/S" },
  { id: "objectivePhysicalExam", label: "O: PE" },
  { id: "objectiveLabs", label: "O: Lab" },
  { id: "objectiveImages", label: "O: Image" },
  { id: "assessmentPlan", label: "A/P" },
  { id: "orders", label: "藥囑" },
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
  apDisplayMode: "separate",
  orderDisplayMode: "summary",
  printDensity: "normal",
  boardDensity: "compact",
  printFontSize: "default",
  printLineSpacing: "normal",
  printPadding: "balanced",
};

export const defaultPreferences: UserPreferences = {
  theme: "system",
  language: "en",
  roundingLayout: defaultRoundingLayoutPreferences,
  keywordHighlightRules: [],
};

function normalizePrintDensity(value: unknown, fallback: PrintDensity): PrintDensity {
  return value === "normal" || value === "compact" || value === "ultra-compact" ? value : fallback;
}

function normalizePreset(value: unknown): RoundingLayoutPreset {
  return value === "fullSoap" || value === "taskDcFocused" ? value : "compactSoap";
}

function normalizeOrderDisplayMode(value: unknown): OrderDisplayMode {
  return value === "category" || value === "collapsed" ? value : "summary";
}

function normalizePrintFontSize(value: unknown): PrintFontSize {
  return value === "small" || value === "large" ? value : "default";
}

function normalizePrintLineSpacing(value: unknown): PrintLineSpacing {
  return value === "tight" || value === "airy" ? value : "normal";
}

function normalizePrintPadding(value: unknown): PrintPadding {
  return value === "dense" ? value : "balanced";
}

function normalizeKeywordHighlightColor(value: unknown): KeywordHighlightColor {
  return value === "red" || value === "orange" || value === "yellow" || value === "blue" || value === "green" || value === "purple" ? value : "yellow";
}

function normalizeKeywordHighlightStyle(value: unknown): KeywordHighlightStyle {
  return value === "text" ? "text" : "highlight";
}

function normalizeKeywordHighlightMatchMode(value: unknown): KeywordHighlightMatchMode {
  return value === "exact" || value === "contains" ? value : "containsInsensitive";
}

export function normalizeKeywordHighlightRules(value: unknown): KeywordHighlightRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const source = (entry && typeof entry === "object" ? entry : {}) as Partial<KeywordHighlightRule>;
      const pattern = String(source.pattern ?? "").trim();
      return {
        id: String(source.id ?? `keyword-rule-${index}-${(pattern || "new").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
        label: String(source.label ?? pattern).trim() || pattern || "New highlight",
        pattern,
        matchMode: normalizeKeywordHighlightMatchMode(source.matchMode),
        color: normalizeKeywordHighlightColor(source.color),
        style: normalizeKeywordHighlightStyle(source.style),
        enabled: source.enabled !== false,
        priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : index,
      };
    })
    .filter((rule): rule is KeywordHighlightRule => Boolean(rule))
    .sort((a, b) => a.priority - b.priority || a.pattern.localeCompare(b.pattern))
    .slice(0, 50);
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
    apDisplayMode: source.apDisplayMode === "merged" ? "merged" : "separate",
    orderDisplayMode: normalizeOrderDisplayMode(source.orderDisplayMode),
    printDensity: normalizePrintDensity(source.printDensity, defaultRoundingLayoutPreferences.printDensity),
    boardDensity: normalizePrintDensity(source.boardDensity, defaultRoundingLayoutPreferences.boardDensity),
    printFontSize: normalizePrintFontSize(source.printFontSize),
    printLineSpacing: normalizePrintLineSpacing(source.printLineSpacing),
    printPadding: normalizePrintPadding(source.printPadding),
  };
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = (value && typeof value === "object" ? value : {}) as Partial<UserPreferences>;
  return {
    theme: source.theme === "light" || source.theme === "dark" || source.theme === "system" ? source.theme : defaultPreferences.theme,
    language: source.language === "zh-TW" ? "zh-TW" : "en",
    roundingLayout: normalizeRoundingLayoutPreferences(source.roundingLayout),
    keywordHighlightRules: normalizeKeywordHighlightRules(source.keywordHighlightRules),
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

export function isOrderSoapLine(line: string) {
  const text = line.trim().replace(/^!!?\s*/, "").replace(/^\*\s*/, "");
  return (
    /^\s*藥囑\s*[:：]/i.test(text) ||
    /^\s*(?:order|orders?|meds?|藥囑)\s*[:：]/i.test(text) ||
    /^\s*(?:Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*:/i.test(text) ||
    (/\b(?:start|stop|hold|resume|continue|complete|taper|titrate|wean)\b/i.test(text) &&
      /\b(?:abx|antibiotic|cef|vanco|teico|levofloxacin|ciprofloxacin|moxifloxacin|mero|tazo|zosyn|heparin|apixaban|warfarin|insulin|steroid|methylpred|prednisolone|lasix|furosemide|morphine|fentanyl)\b/i.test(text)) ||
    (/\b(?:vs|v\/s|vital|i\/o|input\/output|spo2|glucose|sugar)\b/i.test(text) &&
      /\b(?:q\d+\s*h|q\d+h|qd|bid|tid|qid|ac\/hs|stat|once)\b/i.test(text)) ||
    (/\b(?:iv|po|sc|im|mg|mcg|g|unit|units|q\d+h|qd|bid|tid|qid|prn|stat|x\s*\d+\s*d(?:ay)?s?)\b/i.test(text) &&
      /\b(?:abx|antibiotic|cef|vanco|teico|levo|cipro|mero|tazo|zosyn|morphine|fentanyl|lasix|furosemide|heparin|insulin|ppi|pantoprazole|steroid|methylpred|prednisolone)\b/i.test(text))
  );
}

export { stripOrderLinePrefix };

export function isTaskSoapLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  return isOrderSoapLine(line) ? isLayoutSectionVisible(layout, "orders") : isLayoutSectionVisible(layout, "tasks");
}

export function isDcSoapLineVisible(line: string, layout: RoundingLayoutPreferences | undefined) {
  const isPrep = /\b(meds?|opd|certificate|cert|diagnosis certificate)\b|帶藥|門診|診斷書/i.test(line);
  return isPrep ? isLayoutSectionVisible(layout, "dcPrep") : isLayoutSectionVisible(layout, "dcBarriers");
}

const abbreviationWhitelist = [
  "w/",
  "w/o",
  "s/p",
  "c/f",
  "r/o",
  "f/u",
  "cont",
  "Abx",
  "Cx",
  "B/C",
  "U/C",
  "Sputum Cx",
  "PNA",
  "UTI",
  "RF",
  "AKI",
  "CKD",
  "ESRD",
  "HD",
  "CHF",
  "HF",
  "AF",
  "CAD",
  "DM",
  "HTN",
  "COPD",
  "SpO2",
  "O2",
  "NC",
  "RA",
  "CT",
  "CXR",
  "MRI",
  "U/S",
  "EGD",
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

function normalizeApVoice(value: unknown): UserAiStyleProfile["apVoice"] {
  return value === "descriptive" || value === "balanced" ? value : "terse";
}

function normalizeApOrganization(value: unknown): UserAiStyleProfile["apOrganization"] {
  return value === "problemEvidencePlan" || value === "problemPlan" || value === "mixed" ? value : "problemStatusPlan";
}

function normalizeAbbreviationStyle(value: unknown): UserAiStyleProfile["abbreviationStyle"] {
  return value === "minimal" || value === "heavy" ? value : "moderate";
}

export function normalizeUserAiStyleProfile(value: unknown): UserAiStyleProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<UserAiStyleProfile>;
  const typicalApProblemCount = Math.max(1, Math.min(8, Number(source.typicalApProblemCount ?? (source as { apProblemCount?: unknown }).apProblemCount) || 4));
  const typicalApLineLimit = Math.max(1, Math.min(4, Number(source.typicalApLineLimit ?? (source as { apLineLimit?: unknown }).apLineLimit) || 2));
  const preferredTerms = Array.isArray(source.preferredTerms)
    ? source.preferredTerms.map(String).filter((term) => abbreviationWhitelist.includes(term)).slice(0, 12)
    : [];
  const taskStyle = source.taskStyle === "detailed" || source.taskStyle === "checklist" ? source.taskStyle : "concise";
  const sectionOrder = Array.isArray(source.sectionOrder)
    ? source.sectionOrder.map(String).filter((item) => ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"].includes(item)).slice(0, 7)
    : ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"];
  const apVoice = normalizeApVoice(source.apVoice);
  const apOrganization = normalizeApOrganization(source.apOrganization);
  const abbreviationStyle = normalizeAbbreviationStyle(source.abbreviationStyle);
  const fallbackSummary = [
    `${apVoice} clinician wording`,
    `${apOrganization} A/P organization`,
    `${abbreviationStyle} abbreviation use`,
    `${taskStyle} tasks`,
  ];
  return {
    styleSummary: Array.isArray(source.styleSummary) ? source.styleSummary.map(String).filter(Boolean).slice(0, 6) : fallbackSummary,
    apVoice,
    apOrganization,
    abbreviationStyle,
    preferredTerms,
    taskStyle,
    sectionOrder,
    typicalApProblemCount,
    typicalApLineLimit,
    updatedAt: String(source.updatedAt ?? ""),
  };
}

function inferApVoice(lengths: number[]): UserAiStyleProfile["apVoice"] {
  const typicalLength = median(lengths, 80);
  if (typicalLength <= 75) return "terse";
  if (typicalLength <= 125) return "balanced";
  return "descriptive";
}

function inferApOrganization(drafts: ReturnType<typeof parseSoapText>[]): UserAiStyleProfile["apOrganization"] {
  const problems = drafts.flatMap((draft) => draft.apProblems);
  if (problems.length === 0) return "problemStatusPlan";
  const titles = problems.map((problem) => problem.title).filter(Boolean);
  const planLines = problems.flatMap((problem) => problem.lines).filter(Boolean);
  const statusInTitle = titles.filter((line) => /\b(?:improving|worse|worsening|stable|resolved|persistent|s\/p|on|with|w\/|after|post|pending)\b/i.test(line)).length;
  const treatmentFirst = planLines.filter((line) => /^(?:continue|cont|complete|start|stop|hold|wean|f\/u|follow|order|check|trend|repeat|PRN)\b/i.test(line)).length;
  if (statusInTitle / Math.max(1, titles.length) >= 0.45) return "problemStatusPlan";
  if (treatmentFirst / Math.max(1, planLines.length) >= 0.5) return "problemPlan";
  if (planLines.some((line) => /\b(?:because|given|with|due to|from|s\/p|CT|CXR|Hb|Cr|WBC|INR)\b/i.test(line))) return "problemEvidencePlan";
  return "mixed";
}

function inferAbbreviationStyle(preferredTerms: string[], reviewedTexts: string[]): UserAiStyleProfile["abbreviationStyle"] {
  const lineCount = Math.max(1, reviewedTexts.join("\n").split(/\r?\n/).filter(Boolean).length);
  const density = preferredTerms.length / lineCount;
  if (reviewedTexts.length === 0) return "heavy";
  if (preferredTerms.length >= 6 || density >= 0.18) return "heavy";
  if (preferredTerms.length <= 1 || density < 0.04) return "moderate";
  return "moderate";
}

function styleSummary(profile: Pick<UserAiStyleProfile, "apVoice" | "apOrganization" | "abbreviationStyle" | "preferredTerms" | "taskStyle">) {
  const organizationLabel: Record<UserAiStyleProfile["apOrganization"], string> = {
    problemStatusPlan: "A/P names problem with status, then plan",
    problemEvidencePlan: "A/P keeps key evidence before plan",
    problemPlan: "A/P is problem-to-plan direct",
    mixed: "A/P style is mixed",
  };
  return [
    `${profile.apVoice} clinician shorthand`,
    organizationLabel[profile.apOrganization],
    `${profile.abbreviationStyle} abbreviation use`,
    `Tasks are ${profile.taskStyle}`,
    profile.preferredTerms.length ? `Common terms: ${profile.preferredTerms.slice(0, 6).join(", ")}` : "",
  ].filter(Boolean);
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
  const apLineLengths = drafts.flatMap((draft) => draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines].map((line) => line.length).filter(Boolean)));
  const taskLengths = drafts.flatMap((draft) => draft.taskLines.map((line) => line.length));
  const allText = reviewedTexts.join("\n");
  const preferredTerms = abbreviationWhitelist
    .map((term) => ({ term, count: (allText.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((item) => item.term)
    .slice(0, 10);

  const taskMedian = median(taskLengths, 55);
  const apVoice = inferApVoice(apLineLengths);
  const apOrganization = inferApOrganization(drafts);
  const abbreviationStyle = inferAbbreviationStyle(preferredTerms, reviewedTexts);
  const taskStyle: UserAiStyleProfile["taskStyle"] = taskMedian > 90 ? "detailed" : taskMedian > 55 ? "checklist" : "concise";
  const profile = {
    apVoice,
    apOrganization,
    abbreviationStyle,
    preferredTerms,
    taskStyle,
  };
  return {
    styleSummary: styleSummary(profile),
    apVoice,
    apOrganization,
    abbreviationStyle,
    preferredTerms,
    taskStyle,
    sectionOrder: ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"],
    typicalApProblemCount: median(apCounts, 4),
    typicalApLineLimit: median(apLineCounts, 2),
    updatedAt: new Date().toISOString(),
  };
}
