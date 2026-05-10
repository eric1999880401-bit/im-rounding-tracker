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
    admissionSummary: patient.admissionBriefFreeText || patient.chiefComplaint || patient.presentIllnessOrHPI,
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

function parseLabItemsFromLine(line: string, important: boolean, groupHint = "") {
  const items: ParsedLabItem[] = [];
  const pattern = new RegExp(`(?:^|\\b)(${labAliasPattern()})\\.?\\s*${labValuePattern}(?:\\s*\\(\\s*${labValuePattern}\\s*\\))?`, "gi");
  const uaContext = /\b(UA|urine|urinalysis)\b/i.test(groupHint) || /\b(UA|urine|urinalysis)\s*:?\b/i.test(line);

  Array.from(line.matchAll(pattern)).forEach((match) => {
    const dictionaryItem = findLabDictionaryItem(match[1]);
    const normalizedLabel = normalizeLabDisplayName(match[1]);
    const dictionaryGroup = dictionaryItem?.group ?? labGroupFor(normalizedLabel);
    const group = groupHint || dictionaryGroup;
    const label =
      uaContext && (normalizedLabel === "WBC" || normalizedLabel === "RBC")
        ? `UA ${normalizedLabel}`
        : uaContext && normalizedLabel === "Glucose"
          ? "Glucose urine"
        : normalizedLabel;
    const commonUnit = dictionaryItem?.commonUnits[0] ?? "";

    items.push({
      label,
      name: label,
      value: match[2],
      previousValue: match[3] ?? "",
      group: label.startsWith("UA ") || label === "Glucose urine" ? "Urinalysis" : group,
      important,
      isImportant: important,
      unit: commonUnit === "%" && match[2].includes("%") ? "" : commonUnit,
      color: "",
      note: "",
    });
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
