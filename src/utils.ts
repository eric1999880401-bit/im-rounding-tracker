import type {
  DischargePrepStatus,
  AssessmentPlanItem,
  ActiveProblemItem,
  DailyNote,
  DailyNotesByPatient,
  HighlightLine,
  ImageStudyEntry,
  LabReport,
  ParsedLabItem,
  Patient,
  PhysicalExamEntry,
  PatientStatus,
  PatientTask,
  SortMode,
} from "./types";
import {
  findLabDictionaryItem,
  labAliasPattern,
  labCatalog,
  labGroupFor,
  normalizeLabDisplayName,
} from "./data/labDictionary";

export { labCatalog } from "./data/labDictionary";

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

export function formatDateLabel(dateKey: string) {
  return normalizeDateKey(dateKey).replace(/-/g, "/");
}

export function getActivePatients(patients: Patient[]) {
  return patients.filter((patient) => patient.status === "active");
}

export function textToItems(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getUnderlyingDiseaseItems(patient: Patient) {
  return patient.underlyingDiseaseItems.length > 0
    ? patient.underlyingDiseaseItems
    : textToItems(patient.underlyingDiseases);
}

export function getActiveProblemItems(patient: Patient) {
  if (patient.activeProblemStructuredItems.length > 0) {
    return [...patient.activeProblemStructuredItems]
      .sort((a, b) => a.order - b.order)
      .map((item) => (item.note ? `${item.title}: ${item.note}` : item.title))
      .filter(Boolean);
  }

  return patient.activeProblemItems.length > 0
    ? patient.activeProblemItems
    : textToItems(patient.activeProblems);
}

export function summarizeItems(items: string[], fallback = "-") {
  if (items.length === 0) return fallback;
  return items.join("; ");
}

export function splitHighlightLines(value: string): HighlightLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const important = line.startsWith("!");
      const text = important ? line.slice(1).trim() : line;

      function parseLine(nextText: string): HighlightLine {
        const kind: HighlightLine["kind"] = /^=.+=$/.test(nextText)
          ? "section"
          : /^\d+\./.test(nextText)
            ? "numbered"
            : /^(->|=>|\u2192|\u21d2)/.test(nextText)
              ? "arrow"
              : nextText.startsWith("-")
                ? "dash"
                : "normal";

        return {
          important,
          kind,
          text:
            kind === "dash"
              ? nextText.slice(1).trim()
              : kind === "section"
                ? nextText.replace(/^=+|=+$/g, "").trim()
                : nextText,
        };
      }

      const inlineArrow = text.match(/(=>|->|\u2192|\u21d2)/);
      if (inlineArrow?.index && inlineArrow.index > 0) {
        const mainText = text.slice(0, inlineArrow.index).trim();
        const arrowText = `${inlineArrow[1]} ${text.slice(inlineArrow.index + inlineArrow[0].length).trim()}`;
        return [parseLine(mainText), parseLine(arrowText)];
      }

      return [parseLine(text)];
    })
    .filter((line) => line.text);
}

export function stripColorMarkup(value: string) {
  return value.replace(/\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi, "$2");
}

export function importantLines(value: string) {
  return splitHighlightLines(value).filter((line) => line.important);
}

export function plainClinicalText(value: string, fallback = "-") {
  const text = splitHighlightLines(stripColorMarkup(value)).map((line) => line.text).join("; ");
  return text || fallback;
}

function comparisonText(value: string) {
  return plainClinicalText(value, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
}

function isSameClinicalContent(candidate: string, source: string) {
  const left = comparisonText(candidate);
  const right = comparisonText(source);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 120 && longer.includes(shorter) && shorter.length / longer.length > 0.7;
}

function looksLikeFullAdmissionNote(value: string) {
  const clean = value.trim();
  if (!clean) return false;
  const headingMatches = clean.match(/(^|\n)\s*(c\.?c|chief concern|p\.?i|hpi|physical exam|assessment|plan|lab|image)\s*[:：]/gi);
  return clean.length > 1600 || clean.split(/\r?\n/).filter(Boolean).length > 14 || (headingMatches?.length ?? 0) >= 3;
}

export function getAdmissionSummaryText(patient: Patient, options: { allowFallback?: boolean } = {}) {
  const allowFallback = options.allowFallback ?? true;
  const admissionSources = [
    patient.generatedAdmissionNote,
    patient.admissionBriefNotes,
    patient.presentIllnessOrHPI,
    patient.hpiOrAdmissionStory,
  ].filter(Boolean);
  const candidates = [patient.generatedAdmissionSummary, patient.admissionBriefFreeText]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const summary = candidates.find(
    (candidate) =>
      !looksLikeFullAdmissionNote(candidate) &&
      !admissionSources.some((source) => isSameClinicalContent(candidate, source)),
  );

  if (summary) return summary;
  if (!allowFallback) return "";

  return (
    patient.oneLiner ||
    [patient.chiefComplaint || patient.admissionChiefConcern, patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory]
      .filter(Boolean)
      .join("\n")
  );
}

export function emptyAssessmentPlanItem(order = 0): AssessmentPlanItem {
  return {
    id: createId("ap"),
    problemTitle: "",
    assessmentSummary: "",
    evidenceOrCourseItems: [],
    planItems: [],
    category: "activeProblem",
    isImportant: false,
    color: "",
    order,
  };
}

export function emptyActiveProblemItem(order = 0): ActiveProblemItem {
  return {
    id: createId("problem"),
    title: "",
    note: "",
    isImportant: false,
    color: "",
    order,
  };
}

export function emptyDailyNote(date = todayKey()): DailyNote {
  const now = nowIso();
  return {
    date,
    importantRedFlags: "",
    overnightEvents: "",
    subjectiveOrChiefConcern: "",
    vitalSigns: "",
    bloodSugar: "",
    physicalExam: "",
    labSummary: "",
    imageSummary: "",
    assessment: "",
    plan: "",
    dischargePlan: "",
    vsOrder: "",
    rawLabText: "",
    labDate: date,
    labReportTitle: "",
    labReports: [],
    parsedLabItems: [],
    physicalExamEntries: [],
    imageStudyEntries: [],
    assessmentPlanItems: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function dailyNoteFromPatient(patient: Patient, date = todayKey()): DailyNote {
  const now = nowIso();
  return {
    ...emptyDailyNote(date),
    importantRedFlags: patient.importantRedFlags,
    overnightEvents: patient.overnightEvent,
    subjectiveOrChiefConcern: patient.subjectiveOrChiefConcern,
    vitalSigns: patient.vitalSigns,
    bloodSugar: patient.bloodSugar,
    physicalExam: patient.physicalExam,
    labSummary: patient.newLabs,
    imageSummary: patient.newImaging,
    assessment: patient.assessment,
    plan: patient.plan,
    dischargePlan: patient.dischargePlan,
    vsOrder: patient.vsOrder,
    rawLabText: patient.rawLabText || patient.newLabs,
    labDate: patient.labDate || date,
    labReportTitle: patient.labReportTitle,
    labReports: patient.labReports,
    parsedLabItems: patient.parsedLabItems,
    physicalExamEntries: patient.physicalExamEntries,
    imageStudyEntries: patient.imageStudyEntries,
    assessmentPlanItems: patient.assessmentPlanItems,
    createdAt: patient.createdAt || now,
    updatedAt: patient.updatedAt || now,
  };
}

export function patientWithDailyNote(patient: Patient, note?: DailyNote): Patient {
  if (!note) return patient;
  return {
    ...patient,
    importantRedFlags: note.importantRedFlags,
    overnightEvent: note.overnightEvents,
    subjectiveOrChiefConcern: note.subjectiveOrChiefConcern,
    vitalSigns: note.vitalSigns,
    bloodSugar: note.bloodSugar,
    physicalExam: note.physicalExam,
    newLabs: note.labSummary,
    newImaging: note.imageSummary,
    assessment: note.assessment,
    plan: note.plan,
    dischargePlan: note.dischargePlan,
    vsOrder: note.vsOrder,
    rawLabText: note.rawLabText || note.labSummary,
    labDate: note.labDate,
    labReportTitle: note.labReportTitle,
    labReports: note.labReports,
    parsedLabItems: note.parsedLabItems,
    physicalExamEntries: note.physicalExamEntries,
    imageStudyEntries: note.imageStudyEntries,
    assessmentPlanItems: note.assessmentPlanItems,
  };
}

export function latestDailyNote(notes: DailyNote[]) {
  return [...notes].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function hasText(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasItems<T>(items: T[] | undefined) {
  return Array.isArray(items) && items.length > 0;
}

function latestNoteWith(notes: DailyNote[], predicate: (note: DailyNote) => boolean) {
  return [...notes].filter(predicate).sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function getLatestNonEmptyDailyNote(notes: DailyNote[]) {
  return latestNoteWith(notes, (note) =>
    hasText(note.importantRedFlags) ||
    hasText(note.overnightEvents) ||
    hasText(note.subjectiveOrChiefConcern) ||
    hasText(note.vitalSigns) ||
    hasText(note.bloodSugar) ||
    hasText(note.physicalExam) ||
    hasText(note.labSummary) ||
    hasText(note.rawLabText) ||
    hasItems(note.labReports) ||
    hasItems(note.parsedLabItems) ||
    hasText(note.imageSummary) ||
    hasItems(note.imageStudyEntries) ||
    hasText(note.assessment) ||
    hasText(note.plan) ||
    hasItems(note.assessmentPlanItems) ||
    hasText(note.dischargePlan) ||
    hasText(note.vsOrder),
  );
}

function displayString(
  patientValue: string,
  todayNote: DailyNote | undefined,
  notes: DailyNote[],
  noteField: keyof DailyNote,
) {
  const todayValue = String(todayNote?.[noteField] ?? "");
  if (hasText(todayValue)) return todayValue;
  const latestValue = String(latestNoteWith(notes, (note) => hasText(String(note[noteField] ?? "")))?.[noteField] ?? "");
  if (hasText(latestValue)) return latestValue;
  return patientValue;
}

function displayArray<T>(
  patientValue: T[],
  todayNote: DailyNote | undefined,
  notes: DailyNote[],
  noteField: keyof DailyNote,
) {
  if (hasItems(patientValue)) return patientValue;
  const todayValue = todayNote?.[noteField];
  if (Array.isArray(todayValue) && todayValue.length > 0) return todayValue as T[];
  const latestValue = latestNoteWith(notes, (note) => {
    const value = note[noteField];
    return Array.isArray(value) && value.length > 0;
  })?.[noteField];
  if (Array.isArray(latestValue) && latestValue.length > 0) return latestValue as T[];
  return patientValue;
}

export function noteForDateOrFallback(patient: Patient, notes: DailyNote[], date = todayKey()) {
  return notes.find((note) => note.date === date) ?? getLatestNonEmptyDailyNote(notes) ?? dailyNoteFromPatient(patient, date);
}

export function patientForDate(patient: Patient, dailyNotesByPatient: DailyNotesByPatient = {}, date = todayKey()) {
  const notes = dailyNotesByPatient[patient.id] ?? [];
  const todayNote = notes.find((note) => note.date === date);
  const latestLabTextNote = latestNoteWith(notes, (note) => hasText(note.rawLabText) || hasText(note.labSummary));
  const latestLabItemsNote = latestNoteWith(notes, (note) => hasItems(note.parsedLabItems));
  const latestLabReportsNote = latestNoteWith(notes, (note) => hasItems(note.labReports));

  return {
    ...patient,
    importantRedFlags: displayString(patient.importantRedFlags, todayNote, notes, "importantRedFlags"),
    overnightEvent: displayString(patient.overnightEvent, todayNote, notes, "overnightEvents"),
    subjectiveOrChiefConcern: displayString(patient.subjectiveOrChiefConcern, todayNote, notes, "subjectiveOrChiefConcern"),
    vitalSigns: displayString(patient.vitalSigns, todayNote, notes, "vitalSigns"),
    bloodSugar: displayString(patient.bloodSugar, todayNote, notes, "bloodSugar"),
    physicalExam: displayString(patient.physicalExam, todayNote, notes, "physicalExam"),
    newLabs: hasItems(patient.labReports)
      ? patient.newLabs
      : displayString(patient.newLabs, todayNote, notes, "labSummary"),
    rawLabText: hasItems(patient.labReports)
      ? patient.rawLabText
      : String(
          todayNote?.rawLabText?.trim()
            ? todayNote.rawLabText
            : todayNote?.labSummary?.trim()
              ? todayNote.labSummary
              : latestLabTextNote?.rawLabText?.trim()
                ? latestLabTextNote.rawLabText
                : latestLabTextNote?.labSummary ?? patient.rawLabText,
        ),
    labDate: todayNote?.labDate || latestLabReportsNote?.labDate || latestLabTextNote?.labDate || patient.labDate,
    labReportTitle: todayNote?.labReportTitle || latestLabReportsNote?.labReportTitle || latestLabTextNote?.labReportTitle || patient.labReportTitle,
    labReports: displayArray<LabReport>(patient.labReports, todayNote, notes, "labReports"),
    parsedLabItems: hasItems(patient.labReports)
      ? patient.labReports.flatMap((report) => report.items)
      : hasItems(patient.parsedLabItems)
      ? patient.parsedLabItems
      : Array.isArray(todayNote?.parsedLabItems) && todayNote.parsedLabItems.length > 0
        ? todayNote.parsedLabItems
        : latestLabItemsNote?.parsedLabItems ?? patient.parsedLabItems,
    newImaging: hasItems(patient.imageStudyEntries)
      ? patient.newImaging
      : displayString(patient.newImaging, todayNote, notes, "imageSummary"),
    physicalExamEntries: displayArray<PhysicalExamEntry>(patient.physicalExamEntries, todayNote, notes, "physicalExamEntries"),
    imageStudyEntries: displayArray<ImageStudyEntry>(patient.imageStudyEntries, todayNote, notes, "imageStudyEntries"),
    assessment: hasItems(patient.assessmentPlanItems)
      ? patient.assessment
      : displayString(patient.assessment, todayNote, notes, "assessment"),
    plan: hasItems(patient.assessmentPlanItems)
      ? patient.plan
      : displayString(patient.plan, todayNote, notes, "plan"),
    assessmentPlanItems: displayArray<AssessmentPlanItem>(patient.assessmentPlanItems, todayNote, notes, "assessmentPlanItems"),
    dischargePlan: displayString(patient.dischargePlan, todayNote, notes, "dischargePlan"),
    vsOrder: displayString(patient.vsOrder, todayNote, notes, "vsOrder"),
  };
}

export function patientForToday(patient: Patient, dailyNotesByPatient: DailyNotesByPatient = {}) {
  return patientForDate(patient, dailyNotesByPatient, todayKey());
}

export interface PatientDisplaySummary {
  patient: Patient;
  identity: {
    bed: string;
    patientCode: string;
    age: number;
    sex: Patient["sex"];
    attending: string;
    primaryDiagnosis: string;
  };
  redFlags: string;
  underlyingDiseases: string[];
  activeProblems: string[];
  subjective: string;
  vitalSigns: string;
  bloodSugar: string;
  physicalExam: string;
  physicalExamEntries: PhysicalExamEntry[];
  latestLabs: {
    reports: LabReport[];
    items: ParsedLabItem[];
    text: string;
  };
  latestImages: {
    text: string;
    entries: ImageStudyEntry[];
  };
  assessmentPlanItems: AssessmentPlanItem[];
  assessment: string;
  plan: string;
  tasks: PatientTask[];
  dischargeChecklist: {
    meds: DischargePrepStatus;
    opd: DischargePrepStatus;
    certificate: DischargePrepStatus;
  };
  dischargePlan: string;
  dischargeTargetDate: string;
  admissionSummary: string;
  sourceLabels: {
    todayNoteIsEmpty: boolean;
  };
}

export function getPatientDisplaySummary(
  patient: Patient,
  dailyNotesByPatient: DailyNotesByPatient = {},
  date = todayKey(),
): PatientDisplaySummary {
  const notes = dailyNotesByPatient[patient.id] ?? [];
  const todayNote = notes.find((note) => note.date === date);
  const displayPatient = patientForDate(patient, dailyNotesByPatient, date);
  const latestRedFlagNote = latestNoteWith(notes, (note) => hasText(note.importantRedFlags));

  const redFlags = hasText(todayNote?.importantRedFlags)
    ? todayNote?.importantRedFlags ?? ""
    : hasText(patient.importantRedFlags)
      ? patient.importantRedFlags
      : latestRedFlagNote?.importantRedFlags ?? "";

  const labReports = hasItems(patient.labReports) ? patient.labReports : displayPatient.labReports;
  const labItems = hasItems(labReports)
    ? labReports.flatMap((report) => report.items)
    : displayPatient.parsedLabItems;
  const imageEntries = hasItems(patient.imageStudyEntries) ? patient.imageStudyEntries : displayPatient.imageStudyEntries;

  return {
    patient: {
      ...displayPatient,
      importantRedFlags: redFlags,
      labReports,
      parsedLabItems: labItems,
      imageStudyEntries: imageEntries,
    },
    identity: {
      bed: patient.bed,
      patientCode: patient.patientCode,
      age: patient.age,
      sex: patient.sex,
      attending: patient.attending,
      primaryDiagnosis: patient.primaryDiagnosis,
    },
    redFlags,
    underlyingDiseases: getUnderlyingDiseaseItems(patient),
    activeProblems: getActiveProblemItems(patient),
    subjective: displayPatient.subjectiveOrChiefConcern,
    vitalSigns: displayPatient.vitalSigns,
    bloodSugar: displayPatient.bloodSugar,
    physicalExam: displayPatient.physicalExam,
    physicalExamEntries: hasItems(patient.physicalExamEntries) ? patient.physicalExamEntries : displayPatient.physicalExamEntries,
    latestLabs: {
      reports: labReports,
      items: labItems,
      text: displayPatient.rawLabText || displayPatient.newLabs,
    },
    latestImages: {
      text: displayPatient.newImaging,
      entries: imageEntries,
    },
    assessmentPlanItems: hasItems(patient.assessmentPlanItems) ? patient.assessmentPlanItems : displayPatient.assessmentPlanItems,
    assessment: displayPatient.assessment,
    plan: displayPatient.plan,
    tasks: patient.tasks,
    dischargeChecklist: {
      meds: patient.dischargeMedsStatus,
      opd: patient.opdAppointmentStatus,
      certificate: patient.diagnosisCertificateStatus,
    },
    dischargePlan: displayPatient.dischargePlan,
    dischargeTargetDate: patient.dischargeTargetDate,
    admissionSummary: getAdmissionSummaryText(patient),
    sourceLabels: {
      todayNoteIsEmpty: Boolean(!todayNote && getLatestNonEmptyDailyNote(notes)),
    },
  };
}

export function compactClinicalText(value: string, maxLines = 2, fallback = "-") {
  const lines = splitHighlightLines(value);
  if (lines.length === 0) return fallback;

  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  return [...important, ...normal].slice(0, maxLines).map((line) => line.text).join("; ");
}

function todayDate() {
  return todayKey();
}

const labValuePattern = "([<>]?[0-9]+(?:\\.[0-9]+)?%?\\+?)";
const labFlagPattern = "(?:\\s*(?:\\[?([HL])\\]?|([↑↓↗↘])|\\b(high|low|elevated|decreased|positive|negative|pos|neg|reactive|nonreactive|detected|not detected)\\b))?";
const labUnitPattern = "(ng\\/mL|ng\\/L|pg\\/mL|ug\\/mL|µg\\/mL|mcg\\/mL|mg\\/dL|g\\/dL|k\\/uL|10\\^3\\/uL|mmol\\/L|mEq\\/L|U\\/L|IU\\/L|%)";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitAfterMatch(line: string, matchIndex: number | undefined, value: string) {
  if (matchIndex === undefined || !value) return "";
  const after = line.slice(matchIndex);
  return after.match(new RegExp(`${escapeRegExp(value)}\\s*${labUnitPattern}`, "i"))?.[1] ?? "";
}

function normalizeLabNote(...values: Array<string | undefined>) {
  const raw = values.find((value) => value && value.trim())?.trim() ?? "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (raw === "↑" || raw === "↗" || lower === "h" || lower === "high" || lower === "elevated") return "H";
  if (raw === "↓" || raw === "↘" || lower === "l" || lower === "low" || lower === "decreased") return "L";
  if (lower === "pos") return "positive";
  if (lower === "neg") return "negative";
  return raw;
}

function normalizeGenericLabLabel(value: string) {
  const clean = value
    .replace(/^(?:lab|labs|latest|today|repeat|trend)\s+/i, "")
    .replace(/\b(?:level|value|result)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:=-]+|[,;:=-]+$/g, "")
    .trim();
  const dictionary = findLabDictionaryItem(clean);
  if (dictionary) return dictionary.displayName;
  const canonical = canonicalLabKey(clean);
  if (canonical && canonical.toLowerCase() !== clean.toLowerCase()) return canonical;
  return /^[A-Za-z0-9+./-]{2,4}$/.test(clean) ? clean.replace(/[a-z]/g, (letter) => letter.toUpperCase()) : clean;
}

function shouldSkipGenericLabLabel(value: string) {
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 30) return true;
  if (findLabDictionaryItem(clean)) return true;
  const compact = clean.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compact || /^\d+$/.test(compact)) return true;
  return /^(bp|hr|rr|bt|temp|spo2|sat|fio2|ef|pasp|day|date|age|bed|room|rm|pt|patient|code|dose|qd|bid|tid|qid|mg|kg|cm|min|hour|hr|afebrile|febrile|fever)$/i.test(compact);
}

function parsedLabItem(
  label: string,
  value: string,
  previousValue: string,
  important: boolean,
  groupHint: string,
  note = "",
  unitOverride = "",
): ParsedLabItem {
  const dictionaryItem = findLabDictionaryItem(label);
  const normalizedLabel = normalizeLabDisplayName(label);
  const dictionaryGroup = dictionaryItem?.group ?? labGroupFor(normalizedLabel);
  const group = groupHint || dictionaryGroup;
  const commonUnit = dictionaryItem?.commonUnits[0] ?? "";
  const unit = unitOverride || (/^Troponin(?:\s+[IT])?$/i.test(normalizedLabel) ? "" : commonUnit);

  return {
    label: normalizedLabel,
    name: normalizedLabel,
    value,
    previousValue,
    group,
    important,
    isImportant: important,
    unit: unit === "%" && value.includes("%") ? "" : unit,
    color: "",
    note,
  };
}

function parseLabItemsFromLine(line: string, important: boolean, groupHint = "") {
  const items: ParsedLabItem[] = [];
  const directionalKeys = new Set<string>();
  const tumorMarkerPattern = new RegExp(
    `\\b(CA\\s*19[-\\s]?9|CA\\s*125|CA\\s*15[-\\s]?3|AFP|CEA|SCC|PSA)\\s*${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const drugLevelPattern = new RegExp(
    `\\b(Vanco(?:mycin)?|Vancomycin|Digoxin|Phenytoin|Dilantin|Valproate|VPA)(?:\\s+(?:trough|level))?\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const cultureStatusPattern = /\b(Blood culture|B\/C|BCx|Sputum culture|S\/C|SCx|Urine culture|U\/C|UCx)\s*(?:\d{1,2}\/\d{1,2})?\s*(?:[:=-])?\s*(pending|no growth|negative|positive|growth[^,;\n]*)/gi;
  const directionalPattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*${labValuePattern}\\s*(?:->|→|to)\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const genericDirectionalPattern = new RegExp(
    `(?:^|[,;])\\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\\s*${labValuePattern}\\s*(?:->|→|to)\\s*${labValuePattern}${labFlagPattern}`,
    "gi",
  );
  const pattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const genericPattern = new RegExp(
    `(?:^|[,;])\\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\\s*(?:[:=])?\\s*${labValuePattern}(?:\\s*(?:\\(\\s*${labValuePattern}\\s*\\)|from(?:\\s+baseline)?\\s*${labValuePattern}))?${labFlagPattern}`,
    "gi",
  );
  const qualitativePattern = new RegExp(
    `(?:^|\\b)(${labAliasPattern()})\\.?\\s*(?::|=)?\\s*(positive|negative|pos|neg|reactive|nonreactive|detected|not detected|pending|no growth|growth[^,;\\n]*)`,
    "gi",
  );
  const genericQualitativePattern = /(?:^|[,;])\s*([A-Za-z][A-Za-z0-9+./() -]{1,28}?)\s*(?::|=)\s*(positive|negative|pos|neg|reactive|nonreactive|detected|not detected|pending|no growth|growth[^,;\n]*)/gi;
  const uaContext = /\b(UA|urine|urinalysis)\b/i.test(groupHint) || /\b(UA|urine|urinalysis)\s*:?\b/i.test(line);

  Array.from(line.matchAll(tumorMarkerPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[2], match[3] ?? match[4] ?? "", important, groupHint || "Tumor / Special common", normalizeLabNote(match[5], match[6], match[7]), unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(drugLevelPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[2], "", important, groupHint || "Drug levels", normalizeLabNote(match[3], match[4], match[5]), unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(cultureStatusPattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint || "Inflammation / Infection", normalizeLabNote(match[2])));
  });

  Array.from(line.matchAll(directionalPattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[3], match[2], important, groupHint, normalizeLabNote(match[4], match[5], match[6]) || "trend", unitAfterMatch(line, match.index, match[3])));
  });

  Array.from(line.matchAll(genericDirectionalPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    directionalKeys.add(canonicalLabKey(label));
    items.push(parsedLabItem(label, match[3], match[2], important, groupHint || "Other labs", normalizeLabNote(match[4], match[5], match[6]) || "trend", unitAfterMatch(line, match.index, match[3])));
  });

  Array.from(line.matchAll(pattern)).forEach((match) => {
    const dictionaryItem = findLabDictionaryItem(match[1]);
    const normalizedLabel = normalizeLabDisplayName(match[1]);
    if (dictionaryItem?.valueType === "culture") return;
    const matchedText = line.slice(match.index ?? 0);
    if (normalizedLabel === "Ca" && /^ca\s*\d/i.test(matchedText)) return;
    if (directionalKeys.has(canonicalLabKey(normalizedLabel))) return;
    const dictionaryGroup = dictionaryItem?.group ?? labGroupFor(normalizedLabel);
    const group = groupHint || dictionaryGroup;
    const label =
      uaContext && (normalizedLabel === "WBC" || normalizedLabel === "RBC")
        ? `UA ${normalizedLabel}`
        : uaContext && normalizedLabel === "Glucose"
          ? "Glucose urine"
        : normalizedLabel;
    const commonUnit = dictionaryItem?.commonUnits[0] ?? "";
    const inlineUnit = unitAfterMatch(line, match.index, match[2]);
    const unit = inlineUnit || (/^Troponin(?:\s+[IT])?$/i.test(label) ? "" : commonUnit);

    items.push({
      label,
      name: label,
      value: match[2],
      previousValue: match[3] ?? match[4] ?? "",
      group: label.startsWith("UA ") || label === "Glucose urine" ? "Urinalysis" : group,
      important,
      isImportant: important,
      unit: unit === "%" && match[2].includes("%") ? "" : unit,
      color: "",
      note: normalizeLabNote(match[5], match[6], match[7]),
    });
  });

  Array.from(line.matchAll(genericPattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (directionalKeys.has(canonicalLabKey(label)) || shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    const note = normalizeLabNote(match[5], match[6], match[7]);
    const hasContext = Boolean(groupHint) || /\b(lab|cbc|chem|renal|electrolyte|coag|tumou?r|marker|level|culture|serum|plasma|urine)\b/i.test(line);
    const hasSignal = Boolean(note || match[3] || match[4]);
    if (!hasContext && !hasSignal && /\s/.test(label)) return;
    items.push(parsedLabItem(label, match[2], match[3] ?? match[4] ?? "", important, groupHint || "Other labs", note, unitAfterMatch(line, match.index, match[2])));
  });

  Array.from(line.matchAll(qualitativePattern)).forEach((match) => {
    const label = normalizeLabDisplayName(match[1]);
    if (items.some((item) => canonicalLabKey(item.label) === canonicalLabKey(label) && item.value.toLowerCase() === match[2].toLowerCase())) return;
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint, normalizeLabNote(match[2])));
  });

  Array.from(line.matchAll(genericQualitativePattern)).forEach((match) => {
    const label = normalizeGenericLabLabel(match[1]);
    if (shouldSkipGenericLabLabel(label) || findLabDictionaryItem(label)) return;
    if (items.some((item) => canonicalLabKey(item.label) === canonicalLabKey(label))) return;
    items.push(parsedLabItem(label, normalizeLabNote(match[2]) || match[2], "", important, groupHint || "Other labs", normalizeLabNote(match[2])));
  });

  return items;
}

function splitLabLineTitle(line: string) {
  const colonMatch = line.match(/^([^:]{2,32}):\s*(.+)$/);
  if (colonMatch && !findLabDictionaryItem(colonMatch[1])) {
    return { title: colonMatch[1].trim(), body: colonMatch[2].trim() };
  }

  const prefixMatch = line.match(/^(cbc\/dc|cbc|dc|metabolic|renal|electrolytes|liver|lft|coag|coag\.|ua|urine|cardiac|blood gas|abg|vbg)\s+(.+)$/i);
  if (prefixMatch) {
    return { title: prefixMatch[1].replace(/\.$/, "").trim(), body: prefixMatch[2].trim() };
  }

  return { title: "", body: line };
}

function reportId(rawText: string, index: number) {
  return `lab-${index}-${rawText.slice(0, 24).replace(/[^A-Za-z0-9]+/g, "-")}`;
}

export function parseLabText(value: string): ParsedLabItem[] {
  return parseLabReports(value).flatMap((report) => report.items);
}

export function parseLabReports(value: string, date = todayDate(), defaultTitle = ""): LabReport[] {
  const reports: LabReport[] = [];

  value.split(/\r?\n/).forEach((rawLine) => {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) return;

    const important = trimmedLine.startsWith("!");
    const line = important ? trimmedLine.slice(1).trim() : trimmedLine;
    const { title, body } = splitLabLineTitle(line);
    const reportTitle = title || defaultTitle;
    const items = parseLabItemsFromLine(body, important, reportTitle);

    reports.push({
      id: reportId(line, reports.length),
      date,
      title: reportTitle,
      rawText: rawLine,
      items,
    });
  });

  return reports;
}

export function labSummary(items: ParsedLabItem[], fallbackText = "", maxItems = 8) {
  if (items.length === 0) return plainClinicalText(fallbackText, "-");

  const wbc = items.find((item) => item.label === "WBC");
  const neu = items.find((item) => item.label === "N" || item.label === "Neu");
  const cr = items.find((item) => item.label === "Cr");
  const egfr = items.find((item) => item.label === "eGFR");
  const used = new Set<ParsedLabItem>();
  const result: string[] = [];

  if (wbc) {
    used.add(wbc);
    result.push(`WBC ${Number(wbc.value) >= 1000 ? `${(Number(wbc.value) / 1000).toFixed(1)}k` : wbc.value}`);
  }

  if (neu) {
    used.add(neu);
    result.push(`N${neu.value}%`);
  }

  items.forEach((item) => {
    if (used.has(item) || item.group === "Urinalysis" || item.label === "Cr" || item.label === "eGFR") return;
    const prev = item.previousValue ? `(${item.previousValue})` : "";
    result.push(`${item.group ? `${item.group} ` : ""}${item.label}${item.value}${prev}`);
    used.add(item);
  });

  if (cr || egfr) {
    if (cr) used.add(cr);
    if (egfr) used.add(egfr);
    result.push(`Cr ${cr?.value ?? "-"}/eGFR${egfr?.value ?? "-"}`);
  }

  items
    .filter((item) => item.group === "Urinalysis" && !used.has(item))
    .forEach((item) => {
      const prev = item.previousValue ? `(${item.previousValue})` : "";
      result.push(`${item.label}${item.value}${prev}`);
      used.add(item);
    });

  return result.slice(0, maxItems).join(", ") || "-";
}

export function formatLabItem(item: ParsedLabItem) {
  const label = item.name ?? item.label;
  const value =
    label === "WBC" && Number(item.value) >= 1000 ? `${(Number(item.value) / 1000).toFixed(1)}k` : item.value;
  return { label, value, previous: item.previousValue ? `prev ${item.previousValue}` : "" };
}

interface LabObservation {
  key: string;
  label: string;
  value: string;
  unit: string;
  previousValue: string;
  date: string;
  item: ParsedLabItem;
}

interface LabFocusEntry {
  key: string;
  text: string;
  score: number;
  category: string;
  anchor: boolean;
  critical: boolean;
  trend: boolean;
}

export interface LabFocusSummary {
  critical: string[];
  trend: string[];
  anchors: string[];
  hiddenCount: number;
  text: string;
}

export interface LabFocusOptions {
  maxCritical?: number;
  maxTrend?: number;
  maxAnchors?: number;
  separator?: string;
}

function numericLabValue(value: string) {
  const normalized = value.replace(/,/g, "").match(/[<>]?\s*(-?\d+(?:\.\d+)?)/)?.[1];
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalLabKey(label: string) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("ntprobnp") || normalized.includes("ntprobnp")) return "NT-proBNP";
  if (normalized === "probnp") return "NT-proBNP";
  if (normalized.includes("bnp")) return "BNP";
  if (normalized.includes("vanco")) return "Vancomycin";
  if (normalized.includes("hba1c") || normalized === "a1c") return "HbA1c";
  if (normalized === "chol" || normalized.includes("cholesterol")) return "Cholesterol";
  if (normalized === "tg" || normalized.includes("triglyceride")) return "TG";
  if (normalized === "ldl" || normalized.includes("ldlc")) return "LDL";
  if (normalized === "wbc") return "WBC";
  if (normalized === "neu" || normalized.includes("neutrophil")) return "Neu";
  if (normalized === "hb" || normalized === "hgb" || normalized.includes("hemoglobin")) return "Hb";
  if (normalized === "plt" || normalized.includes("platelet")) return "Plt";
  if (normalized === "cr" || normalized.includes("creatinine")) return "Cr";
  if (normalized === "egfr") return "eGFR";
  if (normalized === "bun") return "BUN";
  if (normalized === "na" || normalized === "sodium") return "Na";
  if (normalized === "k" || normalized === "potassium") return "K";
  if (normalized === "ca" || normalized === "calcium") return "Ca";
  if (normalized === "mg" || normalized === "magnesium") return "Mg";
  if (normalized === "p" || normalized === "phos" || normalized === "phosphate") return "P";
  if (normalized === "uricacid" || normalized === "uaacid") return "Uric acid";
  if (normalized.includes("lactate")) return "Lactate";
  if (normalized === "crp") return "CRP";
  if (normalized === "pct" || normalized.includes("procalcitonin")) return "PCT";
  if (normalized.includes("ddimer")) return "D-dimer";
  if (normalized === "inr") return "INR";
  if (normalized === "pt") return "PT";
  if (normalized === "aptt" || normalized === "ptt") return "aPTT";
  if (normalized.includes("glucose") || normalized === "ac" || normalized === "pc" || normalized.includes("sugar")) return "Glucose";
  if (normalized === "alt" || normalized === "gpt") return "ALT";
  if (normalized === "ast" || normalized === "got") return "AST";
  if (normalized.includes("albumin") || normalized === "alb") return "Alb";
  if (normalized.includes("bilirubin") || normalized === "bili") return "Bilirubin";
  if (normalized === "ca125") return "CA125";
  if (normalized === "cea") return "CEA";
  if (normalized === "scc") return "SCC";
  if (normalized === "esr") return "ESR";
  if (normalized === "fib" || normalized.includes("fibrinogen")) return "Fibrinogen";
  if (normalized === "ldh") return "LDH";
  if (normalized.includes("troponini") || normalized === "tni" || normalized === "hstni") return "Troponin I";
  if (normalized.includes("troponint") || normalized === "tnt" || normalized === "hstnt") return "Troponin T";
  if (normalized === "troponin" || normalized === "trop") return "Troponin";
  return normalizeLabDisplayName(label);
}

function labDisplayLabel(key: string) {
  if (key === "Cholesterol") return "Chol";
  if (key === "Glucose") return "Glu";
  if (key === "P") return "Phos";
  return key;
}

function labQualitativeLevel(key: string, item: ParsedLabItem) {
  const text = `${item.value} ${item.note ?? ""}`.toLowerCase();
  if (!text.trim()) return 0;
  if (/\b(?:h|high|elevated|l|low|decreased|positive|pos|reactive|detected|growth|trend)\b|[↑↓↗↘]/i.test(text)) return 1;
  if (/\bpending\b/i.test(text) && /culture|cx|bcx|ucx|scx/i.test(key)) return 1;
  return 0;
}

function labFocusSuffix(item: ParsedLabItem) {
  const note = String(item.note ?? "").trim();
  if (!note || note === "trend") return "";
  if (note.toLowerCase() === String(item.value ?? "").trim().toLowerCase()) return "";
  if (note === "H") return "↑";
  if (note === "L") return "↓";
  if (/^(positive|detected|reactive|growth)/i.test(note)) return "+";
  return ` ${note}`;
}

function labFocusUnitText(key: string, item: ParsedLabItem) {
  const unit = String(item.unit ?? "").trim();
  if (!unit) return "";
  if (/^(?:Troponin|Troponin I|Troponin T|Vancomycin|BNP|NT-proBNP|PCT)$/i.test(key)) return ` ${unit}`;
  return "";
}

function labClinicalNumericValue(key: string, value: number | null) {
  if (value === null) return null;
  if ((key === "WBC" || key === "Plt") && value > 1000) return value / 1000;
  return value;
}

function labDirection(key: string, value: number, previous: number | null) {
  if (previous === null || value === previous) return "";
  const arrow = value > previous ? "\u2191" : "\u2193";
  return `${arrow}(${formatLabFocusValue(key, previous)})`;
}

function formatNumeric(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatLabFocusValue(key: string, value: number) {
  if (key === "WBC" && value >= 1000) return `${formatNumeric(value / 1000)}k`;
  if (key === "Plt" && value >= 1000) return `${formatNumeric(value / 1000)}k`;
  if ((key === "WBC" || key === "Plt") && value < 1000) return formatNumeric(value);
  return formatNumeric(value);
}

function labAbnormalLevel(key: string, value: number | null) {
  if (value === null) return 0;

  switch (key) {
    case "Hb":
      return value < 8 || value > 18 ? 2 : value < 10 || value > 17 ? 1 : 0;
    case "WBC":
      return value > 20 || value < 2 ? 2 : value > 12 || value < 4 ? 1 : 0;
    case "Neu":
      return value > 80 || value < 40 ? 1 : 0;
    case "Plt":
      return value < 50 ? 2 : value < 100 || value > 450 ? 1 : 0;
    case "Cr":
      return value >= 2 ? 2 : value > 1.3 ? 1 : 0;
    case "BUN":
      return value >= 50 ? 2 : value > 25 ? 1 : 0;
    case "eGFR":
      return value < 30 ? 2 : value < 60 ? 1 : 0;
    case "Na":
      return value < 130 || value > 150 ? 2 : value < 135 || value > 145 ? 1 : 0;
    case "K":
      return value < 3 || value > 5.5 ? 2 : value < 3.5 || value > 5 ? 1 : 0;
    case "Ca":
      return value < 7 || value > 12 ? 2 : value < 8.5 || value > 10.5 ? 1 : 0;
    case "Mg":
      return value < 1.2 || value > 3 ? 2 : value < 1.6 || value > 2.6 ? 1 : 0;
    case "P":
      return value < 2 || value > 6 ? 2 : value < 2.5 || value > 4.5 ? 1 : 0;
    case "Uric acid":
      return value >= 10 ? 2 : value >= 7 ? 1 : 0;
    case "Glucose":
      return value < 70 || value >= 300 ? 2 : value >= 180 ? 1 : 0;
    case "HbA1c":
      return value >= 7 ? 1 : 0;
    case "LDL":
      return value >= 100 ? 1 : 0;
    case "TG":
      return value >= 200 ? 1 : 0;
    case "BNP":
      return value >= 100 ? 1 : 0;
    case "NT-proBNP":
      return value >= 300 ? 1 : 0;
    case "Lactate":
      return value >= 4 ? 2 : value >= 2 ? 1 : 0;
    case "CRP":
      return value > 0.5 ? 1 : 0;
    case "PCT":
      return value >= 2 ? 2 : value >= 0.5 ? 1 : 0;
    case "D-dimer":
      return value > 500 ? 1 : 0;
    case "ESR":
      return value > 30 ? 1 : 0;
    case "Fibrinogen":
      return value > 450 || value < 180 ? 1 : 0;
    case "INR":
      return value >= 3 ? 2 : value >= 1.5 ? 1 : 0;
    case "PT":
      return value >= 18 ? 2 : value > 14 ? 1 : 0;
    case "aPTT":
      return value >= 60 ? 2 : value > 36 ? 1 : 0;
    case "Alb":
      return value < 3 ? 1 : 0;
    case "AST":
    case "ALT":
      return value >= 200 ? 2 : value >= 80 ? 1 : 0;
    case "LDH":
      return value >= 500 ? 2 : value >= 250 ? 1 : 0;
    case "Troponin":
    case "Troponin I":
    case "Troponin T":
      return 0;
    default:
      return 0;
  }
}

function meaningfulLabDelta(key: string, value: number | null, previous: number | null) {
  if (value === null || previous === null) return false;
  const delta = Math.abs(value - previous);
  const percent = previous === 0 ? 1 : delta / Math.abs(previous);

  switch (key) {
    case "Hb":
      return delta >= 0.8;
    case "WBC":
      return delta >= 2;
    case "Plt":
      return delta >= 50 || percent >= 0.25;
    case "Cr":
      return delta >= 0.3 || percent >= 0.25;
    case "BUN":
      return delta >= 10 || percent >= 0.3;
    case "eGFR":
      return delta >= 10 || percent >= 0.25;
    case "Na":
      return delta >= 3;
    case "K":
      return delta >= 0.4;
    case "Ca":
    case "Mg":
    case "P":
      return delta >= 0.5 || percent >= 0.2;
    case "Uric acid":
      return delta >= 1 || percent >= 0.25;
    case "Glucose":
      return delta >= 50;
    case "Lactate":
      return delta >= 1;
    case "CRP":
    case "PCT":
      return delta >= 1 || percent >= 0.3;
    case "BNP":
    case "NT-proBNP":
      return percent >= 0.3;
    case "Troponin":
    case "Troponin I":
    case "Troponin T":
      return percent >= 0.2;
    case "LDH":
      return delta >= 100 || percent >= 0.25;
    default:
      return percent >= 0.35;
  }
}

function patientLabContext(patient: Patient) {
  return [
    patient.primaryDiagnosis,
    patient.oneLiner,
    patient.activeProblems,
    ...patient.activeProblemItems,
    ...patient.activeProblemStructuredItems.map((item) => `${item.title} ${item.note}`),
    patient.underlyingDiseases,
    ...patient.underlyingDiseaseItems,
    patient.hospitalCourseHighlights,
    patient.earlyHospitalCourse,
    patient.rawLabText,
    patient.newLabs,
    patient.importantRedFlags,
    patient.dischargePlan,
    ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary} ${item.evidenceOrCourseItems.join(" ")} ${item.planItems.join(" ")}`),
  ]
    .join(" ")
    .toLowerCase();
}

function labFocusCategory(key: string, patient: Patient) {
  const context = patientLabContext(patient);
  const hasInfection = /\b(infection|bacteremia|sepsis|septic|fever|febrile|culture|b\/c|bcx|pna|pneumonia|uti|abscess|lactate|abx|antibiotic)\b/.test(context);
  const hasRenalOrElectrolyte = /\b(aki|ckd|renal|dialysis|crrt|oliguria|hyperk|hypok|electrolyte|dehydrat|tumou?r lysis|tls)\b/.test(context);
  const hasAnemiaOrBleeding = /\b(anemia|bleed|bleeding|melena|hematemesis|hematochezia|hematuria|transfusion|anticoag|antiplatelet|thrombocytopenia)\b/.test(context);
  const hasCancerOrNutrition = /\b(cancer|tumou?r|malign|carcinoma|scc|chemo|onc|j-?tube|jejunostomy|nutrition|malnutrition|poor intake|dysphag|tube feeding)\b/.test(context);
  const hasTls = /\b(tls|tumou?r lysis|uric acid|rasburicase|allopurinol)\b/.test(context);
  const hasCardiac = /\b(hf|heart failure|acs|mi|troponin|arrhythm|af\b|pulmonary edema)\b/.test(context);

  if (hasInfection && ["WBC", "Neu", "Lactate", "CRP", "PCT", "Blood culture", "Sputum culture", "Urine culture"].includes(key)) {
    return "Infx";
  }
  if (hasAnemiaOrBleeding && ["Hb", "Plt", "PT", "INR", "aPTT", "Fibrinogen"].includes(key)) return "Anemia/bleed";
  if ((hasRenalOrElectrolyte || hasTls) && ["BUN", "Cr", "eGFR", "Na", "K", "Ca", "Mg", "P", "Uric acid", "LDH"].includes(key)) {
    return hasTls && ["K", "Ca", "P", "Uric acid", "Cr", "LDH"].includes(key) ? "TLS" : "Renal/electrolyte";
  }
  if (["Na", "K", "Ca", "Mg", "P"].includes(key)) return "Renal/electrolyte";
  if (hasCardiac && ["Troponin", "Troponin I", "Troponin T", "BNP", "NT-proBNP", "Cr", "K"].includes(key)) return "Cardiac";
  if (hasCancerOrNutrition && ["Alb", "Hb", "Ca", "Mg", "P", "Uric acid", "LDH", "CA125", "CEA", "SCC", "CA19-9"].includes(key)) {
    return hasTls && ["K", "Ca", "P", "Uric acid", "Cr", "LDH"].includes(key) ? "TLS" : "Onc/nutrition";
  }
  return "";
}

function isDiseaseAnchorLab(key: string, patient: Patient) {
  const context = [
    patient.primaryDiagnosis,
    patient.activeProblems,
    ...patient.activeProblemItems,
    ...patient.activeProblemStructuredItems.map((item) => `${item.title} ${item.note}`),
    patient.underlyingDiseases,
    ...patient.underlyingDiseaseItems,
    ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary}`),
  ]
    .join(" ")
    .toLowerCase();

  const hasStroke = /stroke|cva|tia|ischemic|infarct|nihss|carotid|mca|aca|pca|pons|basal ganglia/.test(context);
  const hasHf = /heart failure|\bhf\b|chf|lvhf|nyha|pulmonary edema|hfr?ef|reduced ef/.test(context);
  const hasDm = /\bdm\b|diabetes|hypergly/.test(context);
  const hasRenal = /\backi\b|\bckd\b|renal|esrd|dialysis/.test(context);
  const hasBleeding = /bleed|bleeding|anemia|melena|hematemesis|hematuria|vaginal|postmenopausal|ob gyn|obgyn/.test(context);
  const hasLiver = /cirrhosis|hepatitis|liver|jaundice/.test(context);
  const hasCancerOrGyn = /cancer|tumor|malign|carcinoma|ca\?|ca |gyn|ob|ovary|ovarian|cervical|uterine|postmenopausal/.test(context);
  const hasInfection = /infection|bacteremia|sepsis|septic|fever|culture|b\/c|bcx|pneumonia|pna|uti|abx|antibiotic/.test(context);
  const hasNutrition = /j-?tube|jejunostomy|nutrition|malnutrition|poor intake|dysphag|tube feeding/.test(context);
  const hasTls = /tls|tumou?r lysis|uric acid|rasburicase|allopurinol/.test(context);

  if (hasStroke && ["HbA1c", "LDL", "TG", "Cholesterol"].includes(key)) return true;
  if (hasHf && ["BNP", "NT-proBNP", "Cr", "eGFR", "Na", "K"].includes(key)) return true;
  if (hasDm && ["HbA1c", "Glucose", "Cr", "eGFR"].includes(key)) return true;
  if (hasInfection && ["WBC", "Neu", "Lactate", "CRP", "PCT", "Blood culture", "Sputum culture", "Urine culture"].includes(key)) return true;
  if (hasRenal && ["BUN", "Cr", "eGFR", "K", "Na", "Ca", "Mg", "P"].includes(key)) return true;
  if (hasBleeding && ["Hb", "Plt", "PT", "INR", "aPTT"].includes(key)) return true;
  if (hasLiver && ["AST", "ALT", "Bilirubin", "Alb", "INR"].includes(key)) return true;
  if (hasCancerOrGyn && ["CA125", "CEA", "SCC", "CA19-9", "Hb", "Alb", "Ca", "Mg", "P", "LDH"].includes(key)) return true;
  if (hasNutrition && ["Alb", "Mg", "P", "Ca", "Hb"].includes(key)) return true;
  if (hasTls && ["K", "P", "Ca", "Uric acid", "Cr", "LDH"].includes(key)) return true;
  return false;
}

function shouldShowAnchorLab(key: string, abnormalLevel: number) {
  const persistentAnchorKeys = new Set([
    "HbA1c",
    "LDL",
    "TG",
    "Cholesterol",
    "BNP",
    "NT-proBNP",
    "Blood culture",
    "Sputum culture",
    "Urine culture",
    "CA125",
    "CEA",
    "SCC",
    "CA19-9",
  ]);
  return abnormalLevel >= 1 || persistentAnchorKeys.has(key);
}

function formatLabFocusEntryGroups(entries: LabFocusEntry[]) {
  const order = ["Infx", "Anemia/bleed", "Renal/electrolyte", "TLS", "Cardiac", "Onc/nutrition", ""];
  const groups = new Map<string, LabFocusEntry[]>();
  entries.forEach((entry) => {
    const key = entry.category;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([category, group]) => {
      const text = group.map((entry) => entry.text).join(", ");
      return category ? `${category}: ${text}` : text;
    });
}

function collectLabObservations(patient: Patient, notes: DailyNote[] = []) {
  const observations: LabObservation[] = [];

  function addItems(items: ParsedLabItem[], date: string) {
    items.forEach((item) => {
      const label = item.name || item.label;
      if (!label || !String(item.value ?? "").trim()) return;
      observations.push({
        key: canonicalLabKey(label),
        label,
        value: String(item.value ?? ""),
        unit: String(item.unit ?? ""),
        previousValue: String(item.previousValue ?? ""),
        date: normalizeDateKey(date || todayKey()),
        item,
      });
    });
  }

  function addReports(reports: LabReport[], fallbackDate: string) {
    reports.forEach((report) => addItems(report.items, report.date || fallbackDate));
  }

  function addRawText(value: string, date: string) {
    const parsed = parseLabText(value);
    if (parsed.length > 0) addItems(parsed, date);
  }

  addReports(patient.labReports, patient.labDate || todayKey());
  if (patient.labReports.length === 0) addItems(patient.parsedLabItems, patient.labDate || todayKey());
  if (patient.labReports.length === 0 && patient.parsedLabItems.length === 0) {
    addRawText([patient.rawLabText, patient.newLabs].filter(Boolean).join("\n"), patient.labDate || todayKey());
  }
  notes.forEach((note) => {
    addReports(note.labReports, note.labDate || note.date);
    if (note.labReports.length === 0) addItems(note.parsedLabItems, note.labDate || note.date);
    if (note.labReports.length === 0 && note.parsedLabItems.length === 0) {
      addRawText([note.rawLabText, note.labSummary].filter(Boolean).join("\n"), note.labDate || note.date);
    }
  });

  const seen = new Set<string>();
  return observations
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((observation) => {
      const key = [observation.date, observation.key, observation.value, observation.previousValue].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getLabFocusSummary(
  patient: Patient,
  notes: DailyNote[] = [],
  options: LabFocusOptions = {},
): LabFocusSummary {
  const maxCritical = options.maxCritical ?? 2;
  const maxTrend = options.maxTrend ?? 3;
  const maxAnchors = options.maxAnchors ?? 2;
  const separator = options.separator ?? "\n";
  const observations = collectLabObservations(patient, notes);
  const byKey = new Map<string, LabObservation[]>();

  observations.forEach((observation) => {
    const group = byKey.get(observation.key) ?? [];
    group.push(observation);
    byKey.set(observation.key, group);
  });

  const entries: LabFocusEntry[] = [];

  byKey.forEach((group, key) => {
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const latest = ordered[ordered.length - 1];
    const previousObservation = [...ordered].reverse().find((item) => item.date < latest.date && item.value !== latest.value);
    const rawValue = numericLabValue(latest.value);
    const rawPrevious = numericLabValue(latest.previousValue) ?? numericLabValue(previousObservation?.value ?? "");
    const value = labClinicalNumericValue(key, rawValue);
    const previous = labClinicalNumericValue(key, rawPrevious);
    const qualitativeLevel = labQualitativeLevel(key, latest.item);
    const level = Math.max(labAbnormalLevel(key, value), qualitativeLevel);
    const hasDelta = meaningfulLabDelta(key, value, previous);
    const anchor = isDiseaseAnchorLab(key, patient) && shouldShowAnchorLab(key, level);
    const direction = value !== null ? labDirection(key, value, previous) : latest.previousValue ? `(${latest.previousValue})` : "";
    const formattedValue = value !== null ? formatLabFocusValue(key, value) : latest.value;
    const text = `${labDisplayLabel(key)} ${formattedValue}${labFocusUnitText(key, latest.item)}${direction}${labFocusSuffix(latest.item)}`;
    const category = labFocusCategory(key, patient);
    const critical = level >= 2;
    const trend = hasDelta || qualitativeLevel >= 1 || (level >= 1 && !anchor) || level >= 2;
    const score =
      level * 100 +
      Number(hasDelta) * 35 +
      Number(anchor) * 25 +
      Number(Boolean(category)) * 45 +
      Number(latest.item.important || latest.item.isImportant) * 40;

    if (critical || trend || anchor) {
      entries.push({ key, text, score, category, anchor, critical, trend });
    }
  });

  const used = new Set<string>();
  const critical = entries
    .filter((entry) => entry.critical)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCritical);
  critical.forEach((entry) => used.add(entry.key));

  const trend = entries
    .filter((entry) => entry.trend && !used.has(entry.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTrend);
  trend.forEach((entry) => used.add(entry.key));

  const anchors = entries
    .filter((entry) => entry.anchor && !used.has(entry.key))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAnchors);
  anchors.forEach((entry) => used.add(entry.key));

  const hiddenCount = Math.max(entries.length - used.size, 0);
  const sections = [
    critical.length > 0 ? `!Critical: ${formatLabFocusEntryGroups(critical).join("; ")}` : "",
    trend.length > 0 ? `Lab \u0394: ${formatLabFocusEntryGroups(trend).join("; ")}` : "",
    anchors.length > 0 ? `Anchor: ${formatLabFocusEntryGroups(anchors).join("; ")}` : "",
  ].filter(Boolean);
  const text = [sections.join(separator), hiddenCount > 0 ? `+${hiddenCount} labs` : ""].filter(Boolean).join(separator);

  return {
    critical: formatLabFocusEntryGroups(critical),
    trend: formatLabFocusEntryGroups(trend),
    anchors: formatLabFocusEntryGroups(anchors),
    hiddenCount,
    text,
  };
}

export function keyLabItems(items: ParsedLabItem[], maxItems = 8) {
  const priority = [
    "WBC",
    "Neu",
    "Hb",
    "Plt",
    "Na",
    "K",
    "Cr",
    "eGFR",
    "Osm",
    "HbA1c",
    "AST",
    "ALT",
    "PT",
    "aPTT",
    "D-dimer",
    "CRP",
    "PCT",
    "Lactate",
    "UA WBC",
    "UA RBC",
    "LE",
  ];
  return [...items]
    .sort((a, b) => {
      const importantOrder = Number(!(a.important || a.isImportant)) - Number(!(b.important || b.isImportant));
      if (importantOrder !== 0) return importantOrder;
      const aIndex = priority.includes(a.label) ? priority.indexOf(a.label) : 99;
      const bIndex = priority.includes(b.label) ? priority.indexOf(b.label) : 99;
      return aIndex - bIndex;
    })
    .slice(0, maxItems);
}

export function pendingDischargePrep(patient: Patient) {
  const labels: Array<[DischargePrepStatus, string]> = [
    [patient.dischargeMedsStatus, "meds"],
    [patient.opdAppointmentStatus, "OPD"],
    [patient.diagnosisCertificateStatus, "certificate"],
  ];

  return labels.filter(([status]) => status === "pending").map(([, label]) => label);
}

export function hasUpcomingDischarge(patient: Patient) {
  if (patient.status !== "active" || !patient.dischargeTargetDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(`${patient.dischargeTargetDate}T00:00:00`);
  return target.getTime() === today.getTime() || target.getTime() === tomorrow.getTime();
}

export function dischargePrepText(patient: Patient) {
  const symbol = (status: DischargePrepStatus) =>
    status === "done" ? "\u2713" : status === "notNeeded" ? "N/A" : "\u25a1";

  return `Meds ${symbol(patient.dischargeMedsStatus)} / OPD ${symbol(patient.opdAppointmentStatus)} / Cert ${symbol(
    patient.diagnosisCertificateStatus,
  )}`;
}

export function getAttendingName(patient: Patient) {
  return patient.attending.trim() || "Unassigned attending";
}

export function getActiveAttendingNames(patients: Patient[]) {
  const names = getActivePatients(patients)
    .map((patient) => patient.attending.trim())
    .filter(Boolean);

  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function groupPatientsByAttending(patients: Patient[]) {
  return patients.reduce<Record<string, Patient[]>>((groups, patient) => {
    const attending = getAttendingName(patient);
    groups[attending] = [...(groups[attending] ?? []), patient];
    return groups;
  }, {});
}

export function getArchivedPatients(patients: Patient[]) {
  return patients.filter(
    (patient) => patient.status === "discharged" || patient.status === "archived",
  );
}

export function getPendingTasks(patient: Patient[]) {
  return patient.flatMap((item) =>
    item.tasks
      .filter((task) => !task.done)
      .map((task) => ({ patient: item, task })),
  );
}

export function hasUrgentPendingTask(patient: Patient) {
  return patient.tasks.some((task) => !task.done && task.priority === "urgent");
}

export function sortPatients(patients: Patient[], sortMode: SortMode) {
  const sortedPatients = [...patients];

  if (sortMode === "bed") {
    return sortedPatients.sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
  }

  if (sortMode === "dischargeDate") {
    return sortedPatients.sort((a, b) => {
      const dateA = a.dischargeTargetDate || "9999-12-31";
      const dateB = b.dischargeTargetDate || "9999-12-31";
      return dateA.localeCompare(dateB);
    });
  }

  return sortedPatients.sort((a, b) => Number(hasUrgentPendingTask(b)) - Number(hasUrgentPendingTask(a)));
}

export function createTodayFromYesterday(patient: Patient): Patient {
  return {
    ...patient,
    assessmentPlanItems: patient.assessmentPlanItems.map((item) => ({
      ...item,
      evidenceOrCourseItems: [...item.evidenceOrCourseItems],
      planItems: [...item.planItems],
    })),
    // Keep clinically useful S/O/A/P, course, discharge, attention, and current tasks.
    updatedAt: nowIso(),
  };
}

export function emptyPatient(): Patient {
  const now = nowIso();

  return {
    id: createId("p"),
    bed: "",
    patientCode: "",
    oneLiner: "",
    age: 0,
    sex: "M",
    underlyingDiseases: "",
    underlyingDiseaseItems: [],
    attending: "",
    teamOrService: "",
    admissionDate: "",
    primaryDiagnosis: "",
    activeProblems: "",
    activeProblemItems: [],
    activeProblemStructuredItems: [],
    chiefComplaint: "",
    presentIllnessOrHPI: "",
    admissionBriefFreeText: "",
    admissionChiefConcern: "",
    hpiOrAdmissionStory: "",
    baselineFunction: "",
    admissionPMH: "",
    initialPhysicalExam: "",
    initialLabs: "",
    initialImaging: "",
    initialAssessment: "",
    initialPlan: "",
    earlyHospitalCourse: "",
    admissionBriefNotes: "",
    generatedAdmissionNote: "",
    generatedAdmissionSummary: "",
    generatedDischargeSummary: "",
    generatedWeeklySummary: "",
    generatedSbarNote: "",
    isNewAdmission: false,
    showAdmissionBriefOnPrint: false,
    physicalExam: "",
    hospitalCourseHighlights: "",
    importantRedFlags: "",
    vitalSigns: "",
    bloodSugar: "",
    rawLabText: "",
    labDate: todayKey(),
    labReportTitle: "",
    labReports: [],
    parsedLabItems: [],
    physicalExamEntries: [],
    imageStudyEntries: [],
    dischargeMedsStatus: "pending",
    opdAppointmentStatus: "pending",
    diagnosisCertificateStatus: "pending",
    overnightEvent: "",
    subjectiveOrChiefConcern: "",
    newLabs: "",
    newImaging: "",
    assessment: "",
    plan: "",
    assessmentPlanItems: [],
    dischargePlan: "",
    dischargeTargetDate: "",
    dischargeBarriers: "",
    specialAttention: "",
    vsOrder: "",
    status: "active",
    tasks: [],
    aiThinkingPrompts: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyTask(): PatientTask {
  return {
    id: createId("t"),
    text: "",
    done: false,
    priority: "normal",
    category: "other",
    dueDate: "",
    createdAt: nowIso(),
    completedAt: "",
  };
}

export function statusLabel(status: PatientStatus) {
  if (status === "active") return "Active";
  if (status === "discharged") return "Discharged";
  return "Archived";
}
