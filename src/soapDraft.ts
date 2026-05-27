import { getRoundingDigest } from "./roundingDigest";
import { ensureAntibioticApInDraft } from "./antibioticPlan";
import type { AiSoapDraft, AssessmentPlanItem, DailyNote, Patient, PatientTask, TaskCategory, TaskPriority } from "./types";
import {
  createId,
  dischargePrepText,
  getUnderlyingDiseaseItems,
  nowIso,
  plainClinicalText,
  safeClinicalLine,
  textToItems,
} from "./utils";

export interface SoapApProblem {
  title: string;
  lines: string[];
}

export interface SoapDraft {
  header: string[];
  sLines: string[];
  oLines: string[];
  apProblems: SoapApProblem[];
  taskLines: string[];
  dcLines: string[];
  warnings: string[];
}

export interface SoapDraftPatch {
  patient: Patient;
  dailyNotePatch: Partial<DailyNote>;
}

const SOAP_LINE_LIMIT = 140;
const SOAP_VERSION = 1;
export type SoapEditorFormat = "standard" | "plain" | "compact";

function hasText(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function normalizeKey(value: string) {
  return value
    .replace(/^!+/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanSoapLine(value: unknown, maxChars = SOAP_LINE_LIMIT) {
  return safeClinicalLine(String(value ?? ""), maxChars)
    .replace(/^[-*]\s*/, "")
    .replace(/^#+\s*/, "# ")
    .trim();
}

function uniqueSoapLines(values: unknown[], maxItems = 20, maxChars = SOAP_LINE_LIMIT) {
  const seen = new Set<string>();
  const lines: string[] = [];

  values
    .flatMap((value) => String(value ?? "").split(/\r?\n|;\s+/))
    .map((line) => cleanSoapLine(line, maxChars))
    .filter(Boolean)
    .forEach((line) => {
      const key = normalizeKey(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      lines.push(line);
    });

  return lines.slice(0, maxItems);
}

function compactPatientHeader(patient: Patient) {
  const ageSex = patient.age ? `${patient.age}/${patient.sex}` : patient.sex || "";
  return [patient.bed, patient.patientCode, ageSex].filter(hasText).join(" ");
}

function specificPmh(patient: Patient, fallbackRisks: string[]) {
  const pmhItems = getUnderlyingDiseaseItems(patient);
  const source = [...pmhItems, patient.underlyingDiseases, ...fallbackRisks].join("\n");
  const cancerSource = [
    patient.primaryDiagnosis,
    patient.oneLiner,
    patient.activeProblems,
    patient.underlyingDiseases,
    ...pmhItems,
  ].join("\n");
  const cancerMatch = cancerSource.match(
    /\b(?:hypopharyngeal|esophageal|tonsillar|lung|breast|colon|gastric|hepatic|pancreatic|prostate|bladder|renal|ovarian|cervical|endometrial|thyroid)?\s*(?:SCC|squamous cell carcinoma|adenocarcinoma|cancer|carcinoma)\b(?:[^;\n,.]{0,48})?/i,
  );
  const cleanedItems = uniqueSoapLines(textToItems(source), 5, 70).filter((line) => !/^CA hx$/i.test(line));
  if (cancerMatch && !cleanedItems.some((line) => /scc|cancer|carcinoma/i.test(line))) {
    cleanedItems.unshift(cleanSoapLine(cancerMatch[0], 70));
  }
  return cleanedItems;
}

function prefixedLine(prefix: string, value: string) {
  const clean = cleanSoapLine(value, SOAP_LINE_LIMIT);
  if (!clean) return "";
  return new RegExp(`^${prefix.replace("/", "\\/")}\\s*:`, "i").test(clean) ? clean : `${prefix}: ${clean}`;
}

function cleanLabDisplayLine(value: string) {
  return cleanSoapLine(value, SOAP_LINE_LIMIT)
    .replace(/^Lab\s*:\s*/i, "")
    .replace(/^!+/, "")
    .replace(/^(?:Crit|Critical|Abn|Abnormal|Trend|Anchor|Ref)\s*:?\s*/i, "")
    .replace(/^(?:Infx|Infection|Lyte\/Renal|Renal\/Lyte|Anemia|Heme|Cardio|Cardiac|Liver|GI|Nutrition|Onc|Tumor|Glucose|Endocrine|Coag|Other)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeObjectiveLines(vitalPe: string, lab: string, image: string) {
  const lines: string[] = [];
  uniqueSoapLines(vitalPe.split(/\r?\n/), 4, 120).forEach((line) => {
    if (/^(?:v\/s|vs|vitals?)\s*:/i.test(line) || /\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(line)) {
      lines.push(prefixedLine("V/S", line.replace(/^(?:v\/s|vs|vitals?)\s*:\s*/i, "")));
      return;
    }
    lines.push(prefixedLine("PE", line.replace(/^PE\s*:\s*/i, "")));
  });
  uniqueSoapLines(lab.split(/\r?\n/), 4, 120).forEach((line) => {
    const clean = cleanLabDisplayLine(line);
    if (clean) lines.push(prefixedLine("Lab", clean));
  });
  uniqueSoapLines(image.split(/\r?\n/), 3, 130).forEach((line) => {
    const clean = line.replace(/^(?:Image|Img)\s*:\s*/i, "");
    lines.push(prefixedLine("Image", clean));
  });
  return uniqueSoapLines(lines, 12, 150);
}

function apProblemsFromText(value: string): SoapApProblem[] {
  const problems: SoapApProblem[] = [];
  uniqueSoapLines(value.split(/\r?\n|;\s+/), 8, 150).forEach((line) => {
    const clean = line.replace(/^A\/P\s*:\s*/i, "").trim();
    if (!clean) return;
    const colon = clean.match(/^([^:]{3,72}):\s*(.+)$/);
    if (colon) {
      problems.push({ title: cleanSoapLine(colon[1], 72), lines: uniqueSoapLines([colon[2]], 3, 140) });
      return;
    }
    problems.push({ title: cleanSoapLine(clean, 72), lines: [] });
  });
  return dedupeApProblems(problems).slice(0, 5);
}

function apProblemsFromLegacyItems(items: AssessmentPlanItem[]) {
  return dedupeApProblems(
    items.map((item) => ({
      title: item.problemTitle || item.assessmentSummary,
      lines: uniqueSoapLines(
        [
          item.assessmentSummary && item.assessmentSummary !== item.problemTitle ? item.assessmentSummary : "",
          ...item.evidenceOrCourseItems,
          ...item.planItems,
        ],
        3,
        140,
      ),
    })),
  ).slice(0, 5);
}

function noteHasLegacyAp(note?: DailyNote) {
  return Boolean(
    note &&
      ((Array.isArray(note.assessmentPlanItems) && note.assessmentPlanItems.length > 0) ||
        hasText(note.assessment) ||
        hasText(note.plan)),
  );
}

function legacyApProblemsFromFields(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "") {
  const selectedNote = dailyNotes.find((note) => note.date === selectedDate);
  const legacyNote = noteHasLegacyAp(selectedNote)
    ? selectedNote
    : sortedNotes(dailyNotes).find((note) => !noteSoapText(note) && noteHasLegacyAp(note));

  if (legacyNote?.assessmentPlanItems.length) return apProblemsFromLegacyItems(legacyNote.assessmentPlanItems);
  if (patient.assessmentPlanItems.length > 0) return apProblemsFromLegacyItems(patient.assessmentPlanItems);

  return apProblemsFromText(
    [
      legacyNote?.assessment,
      legacyNote?.plan,
      patient.assessment,
      patient.plan,
    ]
      .filter(hasText)
      .join("\n"),
  );
}

function dedupeApProblems(problems: SoapApProblem[]) {
  const seen = new Set<string>();
  return problems
    .map((problem) => ({
      title: cleanSoapLine(problem.title, 80),
      lines: uniqueSoapLines(problem.lines, 5, 140),
    }))
    .filter((problem) => {
      if (!problem.title && problem.lines.length === 0) return false;
      const key = normalizeKey(problem.title || problem.lines.join(" "));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sortedNotes(notes: DailyNote[]) {
  return [...notes].sort((a, b) => b.date.localeCompare(a.date));
}

function noteSoapText(note?: DailyNote) {
  return String(note?.soapText ?? "").trim();
}

export function getCanonicalSoapText(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "") {
  const selectedNote = dailyNotes.find((note) => note.date === selectedDate);
  const selectedSoap = noteSoapText(selectedNote);
  if (selectedSoap) {
    return {
      text: selectedSoap,
      source: "selected" as const,
      sourceDate: selectedNote?.date ?? selectedDate,
    };
  }

  const latestSoapNote = sortedNotes(dailyNotes).find((note) => noteSoapText(note));
  const latestSoap = noteSoapText(latestSoapNote);
  if (latestSoap) {
    return {
      text: latestSoap,
      source: "latest" as const,
      sourceDate: latestSoapNote?.date ?? "",
    };
  }

  return {
    text: formatSoapDraft(patientToFallbackSoapDraft(patient, dailyNotes, selectedDate)),
    source: "fallback" as const,
    sourceDate: selectedDate,
  };
}

function criticalSoapLine(line: string) {
  return /\b(shock|sepsis|hypotension|desat|hypox|active bleed|melena|hematemesis|stroke|ich|neutropenic fever|lactate|troponin|k\s*(?:[<≤]\s*3|[>≥]\s*5\.5)|hb\s*(?:[<≤]\s*8|drop)|wbc\s*(?:[>≥]\s*12|[<≤]\s*3)|cr\s*(?:[>≥]\s*2)|culture|b\/c|bcx|mrsa|enterococcus)\b/i.test(line);
}

function importantSoapLine(line: string) {
  return /\b(teicoplanin|vancomycin|cef|zosyn|pip\/tazo|meropenem|ertapenem|abx|antibiotic|culture|b\/c|bcx|j-tube|ng|peg|port-a|central line|consult|opd|dc|discharge|pending|f\/u|repeat|hold|resume|source control)\b/i.test(line);
}

export function soapTextWithDerivedHighlights(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const clean = line.trim();
      if (!clean || clean.startsWith("!") || /^#{1,6}\s/.test(clean) || /^(?:S|O|A\/P|Tasks|DC|Warnings)\s*:/i.test(clean)) {
        return line;
      }
      if (criticalSoapLine(clean)) return `!!${line}`;
      if (importantSoapLine(clean)) return line.replace(clean, `[[orange:${clean}]]`);
      return line;
    })
    .join("\n");
}

function addUniqueLine(lines: string[], line: string, maxItems: number, maxChars = SOAP_LINE_LIMIT) {
  const clean = cleanSoapLine(line, maxChars);
  if (!clean) return;
  const key = normalizeKey(clean);
  if (!key || lines.some((existing) => normalizeKey(existing) === key)) return;
  lines.push(clean);
  if (lines.length > maxItems) lines.splice(maxItems);
}

type GuidedSoapSourceSection = "admission" | "vitals" | "labs" | "images" | "orders" | "other";

function guidedSectionKey(label: string): GuidedSoapSourceSection {
  const normalized = label.trim().toLowerCase();
  if (/^(?:v\/s|vs|vitals?)$/.test(normalized)) return "vitals";
  if (/^labs?$/.test(normalized)) return "labs";
  if (/^(?:image|img|imaging)$/.test(normalized)) return "images";
  if (/^(?:orders?|meds?|medication|藥囑)$/.test(normalized)) return "orders";
  if (/^admission$/.test(normalized)) return "admission";
  return "other";
}

function splitGuidedSoapSource(rawText: string): Record<GuidedSoapSourceSection, string> {
  const buckets: Record<GuidedSoapSourceSection, string[]> = {
    admission: [],
    vitals: [],
    labs: [],
    images: [],
    orders: [],
    other: [],
  };
  let current: GuidedSoapSourceSection = "other";

  String(rawText ?? "")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*(Admission|V\/S|VS|Vitals?|Lab|Labs|Image|Img|Imaging|Orders?|Meds?|Medication|藥囑|Description\s*\/\s*other|Other update\s*\/\s*task\s*\/\s*course|Last SOAP\s*\/\s*SBAR)\s*:\s*(.*)$/i);
      if (match) {
        current = guidedSectionKey(match[1]);
        if (match[2].trim()) buckets[current].push(match[2].trim());
        return;
      }
      if (line.trim()) buckets[current].push(line.trim());
    });

  return {
    admission: buckets.admission.join(" "),
    vitals: buckets.vitals.join(" "),
    labs: buckets.labs.join(" "),
    images: buckets.images.join(" "),
    orders: buckets.orders.join(" "),
    other: buckets.other.join(" "),
  };
}

function sourceSentences(value: string) {
  return String(value ?? "")
    .split(/\r?\n|(?<=[.;])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstSourceLine(value: string, pattern: RegExp) {
  return sourceSentences(value).find((line) => pattern.test(line)) ?? "";
}

function removeEmptyApProblems(problems: SoapApProblem[]) {
  return problems.filter((problem) => {
    const text = `${problem.title} ${problem.lines.join(" ")}`;
    return !/^\s*(?:no active A\/P|no active ap|no active problem)\s*$/i.test(text.trim());
  });
}

function addProblem(problems: SoapApProblem[], title: string, lines: unknown[]) {
  const cleanTitle = cleanSoapLine(title, 80);
  const cleanLines = uniqueSoapLines(lines, 2, 160).map((line) => line.replace(/:\s+/g, " - "));
  if (!cleanTitle || cleanLines.length === 0) return;
  const existing = problems.find((problem) => normalizeKey(problem.title) === normalizeKey(cleanTitle));
  if (existing) {
    existing.lines = uniqueSoapLines([...cleanLines, ...existing.lines], 2, 160);
    return;
  }
  problems.push({ title: cleanTitle, lines: cleanLines });
}

function firstMatch(value: string, pattern: RegExp) {
  return String(value ?? "").match(pattern)?.[0] ?? "";
}

function matchingSnippets(value: string, pattern: RegExp, maxItems = 2) {
  return String(value ?? "")
    .split(/[,;]\s+|\.\s+/)
    .map((part) => part.trim())
    .filter((part) => pattern.test(part))
    .slice(0, maxItems)
    .join(", ");
}

function compactProblemLine(parts: unknown[]) {
  return uniqueSoapLines(parts, 6, 80)
    .filter(Boolean)
    .join(", ");
}

export function localRoundSoapFromPaste(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "", rawText = "") {
  const baseline = parseSoapText(getCanonicalSoapText(patient, dailyNotes, selectedDate).text);
  const source = splitGuidedSoapSource(rawText);
  const sourceAll = Object.values(source).join("\n");
  const fragments = sourceSentences(sourceAll);

  sourceSentences(source.admission).forEach((line) => {
    if (/\b(fever|chills|pain|dyspnea|sob|poor intake|cough|chest pain|n\/v|diarrhea)\b/i.test(line)) {
      addUniqueLine(baseline.sLines, line.replace(/^Admission\s*:\s*/i, ""), 5, 140);
    }
  });
  sourceSentences(source.vitals).forEach((line) => {
    if (/^PE\s*:/i.test(line)) {
      addUniqueLine(baseline.oLines, prefixedLine("PE", line.replace(/^PE\s*:\s*/i, "")), 12, 150);
      return;
    }
    addUniqueLine(baseline.oLines, prefixedLine("V/S", line), 12, 160);
  });
  sourceSentences(source.labs).forEach((line) => addUniqueLine(baseline.oLines, prefixedLine("Lab", line), 12, 170));
  sourceSentences(source.images).forEach((line) => addUniqueLine(baseline.oLines, prefixedLine("Image", line), 12, 170));
  sourceSentences(source.other).forEach((line) => {
    if (/^PE\s*:/i.test(line)) addUniqueLine(baseline.oLines, line, 12, 150);
  });

  const nextProblems = removeEmptyApProblems(baseline.apProblems);
  if (/\b(cholangitis|sepsis|biliary|ercp|bile|culture|cx|meropenem|vanco|vancomycin|piperacillin|tazobactam|pip\/?tazo|zosyn)\b/i.test(sourceAll)) {
    addProblem(nextProblems, "Cholangitis / sepsis", [
      compactProblemLine([
        firstMatch(source.labs, /\bWBC\s*[\d.]+/i),
        firstMatch(source.labs, /\blactate\s*[\d.]+(?:\s*[-=]>\s*[\d.]+)?/i),
        firstSourceLine(source.labs, /\b(?:b\/c|blood|bile|culture|cx).*(?:pending|positive|ngtd|growth)/i),
        matchingSnippets(source.orders, /\b(?:meropenem|vanco|vancomycin|piperacillin|tazobactam|pip\/?tazo|zosyn)\b/i, 2),
        matchingSnippets(source.other, /\b(?:ERCP|stent|source control|GI|ID)\b/i, 2),
      ]),
    ]);
  }
  if (/\b(aki|hyperk|hyperkal|cr\s*\d|k\s*\d|lokelma|renal-dose)\b/i.test(sourceAll)) {
    addProblem(nextProblems, "AKI / hyperK", [
      compactProblemLine([
        firstMatch(source.labs, /\bCr\s*[\d.]+(?:\s*from\s*[\d.]+)?/i),
        firstMatch(source.labs, /\bK\s*[\d.]+/i),
        matchingSnippets(source.orders, /\b(?:Lokelma|renal-dose|repeat.*K|CMP|BMP)\b/i, 2),
        matchingSnippets(source.other, /\b(?:repeat.*(?:CMP|BMP|K)|renal-dose)\b/i, 2),
      ]),
    ]);
  }
  if (/\b(pleural effusion|o2|oxygen|spo2|hfref|af\b|apixaban|congestion)\b/i.test(sourceAll)) {
    addProblem(nextProblems, "R pleural effusion/O2 need; HFrEF/AF", [
      compactProblemLine([
        firstMatch(source.vitals, /\bSpO2\s*[\d%]+\s*(?:on\s*)?(?:NC|O2)?\s*\d*L?/i),
        firstSourceLine(source.images, /\bCXR\b[^.]+/i),
        matchingSnippets(source.orders, /\b(?:hold apixaban|O2|Lasix|fluid)\b/i, 2),
      ]),
    ]);
  }

  const treatmentLines = fragments.filter((line) =>
    /\b(teicoplanin|vancomycin|cef|zosyn|pip\/?tazo|piperacillin|tazobactam|meropenem|ertapenem|abx|antibiotic|culture|b\/c|bcx|source control|j-tube|feeding|nutrition|anemia|hb)\b/i.test(line),
  );
  if (treatmentLines.length > 0) {
    const infectionLine = treatmentLines.find((line) => /mrsa|enterococcus|bacteremia|culture|teicoplanin|vancomycin|abx/i.test(line));
    if (infectionLine && !nextProblems.some((problem) => /cholangitis|sepsis|bacteremia|infection|mrsa|enterococcus/i.test(problem.title))) {
      nextProblems.unshift({
        title: /cholangitis|biliary|ercp/i.test(sourceAll) ? "Cholangitis / infection" : "Bacteremia / infection",
        lines: uniqueSoapLines([infectionLine], 3, 140),
      });
    }
  }

  sourceSentences([source.other, source.labs].join(" "))
    .filter((line) => /\b(f\/u|follow|pending|repeat|call|consult|arrange|dc|discharge|opd|culture|cx)\b/i.test(line))
    .forEach((line) => addUniqueLine(baseline.taskLines, line.replace(/^tasks?\s*:\s*/i, ""), 6, 130));
  sourceSentences(source.orders)
    .filter((line) => /\b(meropenem|vanco|vancomycin|piperacillin|tazobactam|pip\/?tazo|zosyn|hold|resume|lokelma|o2|strict i\/o|vs q|insulin|lasix|heparin|apixaban)\b/i.test(line))
    .forEach((line) => addUniqueLine(baseline.taskLines, `Order: ${line}`, 6, 130));
  sourceSentences(source.other)
    .filter((line) => /\b(dc|discharge|not ready|barrier|opd|certificate)\b/i.test(line))
    .forEach((line) => addUniqueLine(baseline.dcLines, line.replace(/^DC\s*:\s*/i, ""), 4, 130));

  const mergedDraft = {
    ...baseline,
    apProblems: dedupeApProblems(nextProblems).slice(0, 5),
    warnings: uniqueSoapLines([...baseline.warnings, "Local demo SOAP merge. Review before saving."], 3, 120),
  } satisfies SoapDraft;

  return formatSoapDraft(ensureAntibioticApInDraft(mergedDraft, [rawText, formatSoapDraft(baseline)].join("\n"), selectedDate));
}

function fallbackAntibioticSourceText(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "") {
  const selectedNote = dailyNotes.find((note) => note.date === selectedDate);
  const legacyNotes = [
    selectedNote,
    ...sortedNotes(dailyNotes).filter((note) => note.date !== selectedDate),
  ].filter(Boolean) as DailyNote[];
  return [
    patient.oneLiner,
    patient.primaryDiagnosis,
    patient.activeProblems,
    patient.chiefComplaint,
    patient.presentIllnessOrHPI,
    patient.admissionBriefFreeText,
    patient.initialAssessment,
    patient.initialPlan,
    patient.earlyHospitalCourse,
    patient.hospitalCourseHighlights,
    patient.importantRedFlags,
    patient.vitalSigns,
    patient.rawLabText,
    patient.newLabs,
    patient.newImaging,
    patient.assessment,
    patient.plan,
    patient.dischargePlan,
    patient.vsOrder,
    ...patient.tasks.map((task) => task.text),
    ...patient.assessmentPlanItems.flatMap((item) => [
      item.problemTitle,
      item.assessmentSummary,
      ...item.evidenceOrCourseItems,
      ...item.planItems,
    ]),
    ...legacyNotes.flatMap((note) => [
      note.importantRedFlags,
      note.overnightEvents,
      note.subjectiveOrChiefConcern,
      note.vitalSigns,
      note.labSummary,
      note.imageSummary,
      note.assessment,
      note.plan,
      note.dischargePlan,
      note.vsOrder,
      note.rawLabText,
      ...note.assessmentPlanItems.flatMap((item) => [
        item.problemTitle,
        item.assessmentSummary,
        ...item.evidenceOrCourseItems,
        ...item.planItems,
      ]),
    ]),
  ]
    .filter(hasText)
    .join("\n");
}

function patientToFallbackSoapDraft(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = ""): SoapDraft {
  const digest = getRoundingDigest(patient, dailyNotes, {
    mode: "rounds",
    hideCompletedTasks: true,
  });
  const snapshot = digest.snapshot;
  const header = uniqueSoapLines(
    [
      compactPatientHeader(patient),
      snapshot.dxCore ? `Dx: ${snapshot.dxCore}` : "",
      snapshot.activeIssues.length > 0 ? `Issues: ${snapshot.activeIssues.slice(0, 4).join(", ")}` : "",
      specificPmh(patient, snapshot.risks).length > 0 ? `PMH: ${specificPmh(patient, snapshot.risks).join(", ")}` : "",
      patient.attending ? `Attending: ${patient.attending}` : "",
      selectedDate ? `Date: ${selectedDate}` : "",
    ],
    7,
    150,
  );
  const prep = dischargePrepText(patient);
  const draft = {
    header,
    sLines: uniqueSoapLines([digest.subjective], 4, 120),
    oLines: makeObjectiveLines(digest.objective, digest.lab, digest.image),
    apProblems: legacyApProblemsFromFields(patient, dailyNotes, selectedDate),
    taskLines: uniqueSoapLines([digest.tasks], 6, 120),
    dcLines: uniqueSoapLines([digest.discharge, prep ? `Prep: ${prep}` : ""], 4, 120),
    warnings: [],
  } satisfies SoapDraft;
  return ensureAntibioticApInDraft(draft, fallbackAntibioticSourceText(patient, dailyNotes, selectedDate), selectedDate);
}

export function patientToSoapDraft(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = ""): SoapDraft {
  const selectedNote = dailyNotes.find((note) => note.date === selectedDate);
  const selectedSoap = noteSoapText(selectedNote);
  if (selectedSoap) return parseSoapText(selectedSoap);

  const latestSoapNote = sortedNotes(dailyNotes).find((note) => noteSoapText(note));
  const latestSoap = noteSoapText(latestSoapNote);
  if (latestSoap) return parseSoapText(latestSoap);

  return patientToFallbackSoapDraft(patient, dailyNotes, selectedDate);
}

function aiVitalLine(vital: AiSoapDraft["objective"]["vitals"][number]) {
  return [vital.date, vital.name, vital.value, vital.interpretation].filter(hasText).join(" ");
}

function aiLabLine(lab: AiSoapDraft["objective"]["labs"][number]) {
  const previous = lab.previousValue ? `from ${lab.previousValue}` : "";
  const marker = lab.isAbnormal ? "abn" : lab.isImportant ? "key" : "";
  return [lab.date, lab.group, `${lab.name} ${lab.value}${lab.unit ? ` ${lab.unit}` : ""}`, previous, marker, lab.interpretation]
    .filter(hasText)
    .join(" ");
}

function aiImageLine(image: AiSoapDraft["objective"]["images"][number]) {
  return [image.date, image.studyType, image.impression || image.finding].filter(hasText).join(": ");
}

function aiDraftAntibioticSourceText(draft: AiSoapDraft) {
  return [
    draft.oneLiner,
    draft.admissionSummary,
    draft.isbarHandoff,
    ...(draft.objective?.labs ?? []).map(aiLabLine),
    ...(draft.objective?.images ?? []).map(aiImageLine),
    ...(draft.assessmentPlan ?? []).flatMap((item) => [
      item.problemTitle,
      item.assessmentSummary,
      ...item.evidenceOrCourseItems,
      ...item.planItems,
    ]),
    ...(draft.tasks ?? []).map((task) => task.text),
    ...(draft.dischargeIssues ?? []),
    ...(draft.uncertainty ?? []),
  ]
    .filter(hasText)
    .join("\n");
}

export function aiSoapDraftToSoapDraft(draft: AiSoapDraft, patient?: Patient, selectedDate = ""): SoapDraft {
  const header = uniqueSoapLines(
    [
      patient ? compactPatientHeader(patient) : "",
      draft.oneLiner ? `Dx: ${draft.oneLiner}` : patient?.primaryDiagnosis ? `Dx: ${patient.primaryDiagnosis}` : "",
      patient ? `PMH: ${specificPmh(patient, []).join(", ")}` : "",
      patient?.attending ? `Attending: ${patient.attending}` : "",
      selectedDate ? `Date: ${selectedDate}` : "",
      draft.redFlags?.length ? `Red flags: ${draft.redFlags.map((item) => item.text).filter(Boolean).slice(0, 3).join("; ")}` : "",
    ],
    7,
    150,
  );
  const sLines = uniqueSoapLines(
    [
      draft.subjective?.chiefConcern,
      ...(draft.subjective?.importantOvernightEvents ?? []),
      ...(draft.subjective?.overnightEvents ?? []),
      ...(draft.subjective?.importantSymptoms ?? []),
      ...(draft.subjective?.symptoms ?? []),
    ],
    5,
    120,
  );
  const oLines = uniqueSoapLines(
    [
      ...(draft.objective?.vitals ?? []).map((item) => prefixedLine("V/S", aiVitalLine(item))),
      ...(draft.objective?.bloodSugars ?? []).map((item) => prefixedLine("Sugar", [item.date, item.name, item.value, item.interpretation].filter(hasText).join(" "))),
      ...(draft.objective?.physicalExam ?? []).map((item) => prefixedLine("PE", [item.system, item.finding].filter(hasText).join(": "))),
      ...(draft.objective?.labs ?? []).map((item) => prefixedLine("Lab", aiLabLine(item))),
      ...(draft.objective?.images ?? []).map((item) => prefixedLine("Image", aiImageLine(item))),
    ],
    14,
    150,
  );
  const apProblems = dedupeApProblems(
    (draft.assessmentPlan ?? []).map((item) => ({
      title: item.problemTitle,
      lines: uniqueSoapLines([item.assessmentSummary, ...item.evidenceOrCourseItems, ...item.planItems], 5, 140),
    })),
  ).slice(0, 6);

  const soapDraft = {
    header,
    sLines,
    oLines,
    apProblems,
    taskLines: uniqueSoapLines((draft.tasks ?? []).map((task) => task.text), 6, 120),
    dcLines: uniqueSoapLines(draft.dischargeIssues ?? [], 4, 120),
    warnings: uniqueSoapLines(draft.uncertainty ?? [], 4, 120),
  } satisfies SoapDraft;

  return ensureAntibioticApInDraft(soapDraft, aiDraftAntibioticSourceText(draft), selectedDate);
}

export function formatSoapDraft(draft: SoapDraft) {
  const sections: string[] = [];
  if (draft.header.length > 0) sections.push(draft.header.join("\n"));
  sections.push(`S:\n${draft.sLines.length > 0 ? draft.sLines.map((line) => `- ${line}`).join("\n") : "- -"}`);
  sections.push(`O:\n${draft.oLines.length > 0 ? draft.oLines.map((line) => `- ${line}`).join("\n") : "- -"}`);
  sections.push(
    `A/P:\n${
      draft.apProblems.length > 0
        ? draft.apProblems
            .map((problem) => [`# ${problem.title || "Problem"}`, ...problem.lines.map((line) => `- ${line}`)].join("\n"))
            .join("\n")
        : "# No active A/P\n- -"
    }`,
  );
  if (draft.taskLines.length > 0) sections.push(`Tasks:\n${draft.taskLines.map((line) => `- ${line}`).join("\n")}`);
  if (draft.dcLines.length > 0) sections.push(`DC:\n${draft.dcLines.map((line) => `- ${line}`).join("\n")}`);
  if (draft.warnings.length > 0) sections.push(`Warnings:\n${draft.warnings.map((line) => `- ${line}`).join("\n")}`);
  return sections.join("\n\n").trim();
}

function compactSoapDraft(draft: SoapDraft): SoapDraft {
  const preferredObjective = [
    ...draft.oLines.filter((line) => /^(?:v\/s|vs|vitals?)\s*:/i.test(line)),
    ...draft.oLines.filter((line) => /^lab\s*:/i.test(line)),
    ...draft.oLines.filter((line) => /^(?:image|img)\s*:/i.test(line)),
    ...draft.oLines.filter((line) => /^(?:pe|physical exam)\s*:/i.test(line)),
    ...draft.oLines.filter((line) => !/^(?:v\/s|vs|vitals?|lab|image|img|pe|physical exam)\s*:/i.test(line)),
  ];

  const compactProblems = selectCompactApProblems(dedupeApProblems(draft.apProblems), 4);

  return {
    header: uniqueSoapLines(draft.header, 5, 120),
    sLines: uniqueSoapLines(draft.sLines, 2, 100),
    oLines: uniqueSoapLines(preferredObjective, 6, 120),
    apProblems: compactProblems.map((problem) => ({
        title: cleanSoapLine(problem.title, 72),
        lines: uniqueSoapLines(problem.lines, 2, 120),
      })),
    taskLines: uniqueSoapLines(draft.taskLines, 5, 110),
    dcLines: uniqueSoapLines(draft.dcLines, 3, 110),
    warnings: uniqueSoapLines(draft.warnings, 2, 100),
  };
}

function scoreApProblem(problem: SoapApProblem) {
  const text = `${problem.title} ${problem.lines.join(" ")}`.toLowerCase();
  let score = 0;
  if (/\b(?:sepsis|bacteremia|pna|pneumonia|infection|abscess|abx|culture|cx)\b/.test(text)) score += 5;
  if (/\b(?:resp|rf|hypox|oxygen|dyspnea|pleural effusion|chylothorax|thoracentesis|tap)\b/.test(text)) score += 5;
  if (/\b(?:lft|liver|transaminitis|bilirubin|inr|coagulopathy|hepatitis|jaundice)\b/.test(text)) score += 5;
  if (/\b(?:aki|renal|creatinine|cr|esrd|hd|hyperk|hypok|hypokalemia|hyperkalemia)\b/.test(text)) score += 4;
  if (/\b(?:hb|anemia|bleed|bleeding|platelet|plt|transfusion)\b/.test(text)) score += 4;
  if (/\b(?:thrombus|thrombosis|embol|dvt|pe)\b/.test(text)) score += 4;
  if (/\b(?:cancer|carcinoma|scc|adenoca|adenocarcinoma|metasta|onc|chemo|rt)\b/.test(text)) score += 3;
  if (/\b(?:review|consider|monitor|follow)\b/.test(text) && score === 0) score -= 1;
  return score;
}

function selectCompactApProblems(problems: SoapApProblem[], maxItems: number) {
  if (problems.length <= maxItems) return problems;
  return problems
    .map((problem, index) => ({ problem, index, score: scoreApProblem(problem) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.problem);
}

export function formatSoapDraftForStyle(draft: SoapDraft, style: SoapEditorFormat = "standard") {
  if (style === "standard") return formatSoapDraft(draft);

  const next = style === "compact" ? compactSoapDraft(draft) : draft;
  if (style === "compact") return formatSoapDraft(next);

  const sections: string[] = [];
  if (next.header.length > 0) sections.push(next.header.join("\n"));
  sections.push(`S:\n${next.sLines.length > 0 ? next.sLines.join("\n") : "-"}`);
  sections.push(`O:\n${next.oLines.length > 0 ? next.oLines.join("\n") : "-"}`);
  sections.push(
    `A/P:\n${
      next.apProblems.length > 0
        ? next.apProblems
            .map((problem, index) => {
              const body = problem.lines.join("; ");
              return `${index + 1}. ${problem.title || "Problem"}${body ? `: ${body}` : ""}`;
            })
            .join("\n")
        : "1. No active A/P"
    }`,
  );
  if (next.taskLines.length > 0) sections.push(`Tasks:\n${next.taskLines.join("\n")}`);
  if (next.dcLines.length > 0) sections.push(`DC:\n${next.dcLines.join("\n")}`);
  if (next.warnings.length > 0) sections.push(`Warnings:\n${next.warnings.join("\n")}`);
  return sections.join("\n\n").trim();
}

function normalizeSoapSymbols(value: string) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\uFF1A\uFE55]/g, ":")
    .replace(/[\uFF1B]/g, ";")
    .replace(/[\uFF01]/g, "!")
    .replace(/[\uFF03]/g, "#")
    .replace(/[\uFF0A\u2217]/g, "*")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219\u00B7\u30FB\uFF65]/g, "-")
    .replace(/\t/g, " ");
}

function stripBullet(value: string) {
  let next = normalizeSoapSymbols(value).trim();
  const critical = /^!!/.test(next);
  const important = /^!+/.test(next);
  const starImportant = /^\*\s+\S/.test(next);
  next = next.replace(/^!+\s*/, "").trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = next;
    next = next.replace(/^(?:[-*•‧・‣▪○●－–—]|[!！])+\s*/, "").trim();
    if (next === previous) break;
  }
  return `${critical ? "!! " : important || starImportant ? "! " : ""}${next}`.trim();
}

function stripSoapBullet(value: string) {
  let next = normalizeSoapSymbols(value).trim();
  const critical = /^!!/.test(next);
  const important = /^!+/.test(next);
  const starImportant = /^\*\s+\S/.test(next);
  next = next.replace(/^!+\s*/, "").trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = next;
    next = next
      .replace(/^(?:[-*]\s*)+/, "")
      .replace(/^\(?\d{1,2}[\.)]\s+/, "")
      .replace(/^\d{1,2}\s*[\u3001]\s*/, "")
      .trim();
    if (next === previous) break;
  }
  return `${critical ? "!! " : important || starImportant ? "! " : ""}${next}`.trim();
}

function sectionRest(line: string, label: string) {
  const normalized = stripSoapBullet(line).replace(/^!\s*/, "");
  const match = normalized.match(new RegExp(`^(?:${label})\\s*:\\s*(.*)$`, "i"));
  return match ? match[1].trim() : null;
}

type SoapSection = "header" | "s" | "o" | "ap" | "tasks" | "dc" | "warnings";

function sectionFromLine(line: string): { section: SoapSection; label: string; rest: string } | null {
  const normalized = stripSoapBullet(line).replace(/^!\s*/, "");
  const match = normalized.match(/^(S|Subjective|O|Objective|A\/P|AP|Assessment\/Plan|Tasks?|TODO|To do|DC|Discharge|Warnings?)\s*(?::\s*(.*)|$)/i);
  if (!match) return null;
  const label = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();
  if (label === "s" || label === "subjective") return { section: "s", label: "S", rest };
  if (label === "o" || label === "objective") return { section: "o", label: "O", rest };
  if (label === "a/p" || label === "ap" || label === "assessment/plan") return { section: "ap", label: "A/P", rest };
  if (label === "task" || label === "tasks" || label === "todo" || label === "to do") return { section: "tasks", label: "Tasks", rest };
  if (label === "dc" || label === "discharge") return { section: "dc", label: "DC", rest };
  return { section: "warnings", label: "Warnings", rest };
}

function problemHeadingText(line: string) {
  const raw = normalizeSoapSymbols(line).trim().replace(/^!+\s*/, "");
  const stripped = stripSoapBullet(line).trim().replace(/^!\s*/, "");
  const hash = stripped.match(/^#+\s*(.+)$/);
  if (hash) return cleanSoapLine(hash[1], 90);
  const numbered = raw.match(/^\(?\d{1,2}[\.)]\s+([^:]{3,90})$/) ?? raw.match(/^\d{1,2}\s*[\u3001]\s*([^:]{3,90})$/);
  return numbered ? cleanSoapLine(numbered[1], 90) : "";
}

function inlineApProblem(line: string) {
  const stripped = stripSoapBullet(line);
  const clean = stripped.replace(/^!+\s*/, "");
  const match = clean.match(/^([^:]{3,80}):\s*(.+)$/);
  if (!match) return null;
  const title = cleanSoapLine(match[1], 72);
  const body = cleanSoapLine(`${stripped.startsWith("!") ? "!" : ""}${match[2]}`, 130);
  if (!title || !body || /^(?:s|o|a\/p|ap|tasks?|dc|v\/s|vs|pe|lab|image|img)$/i.test(title)) return null;
  return { title, body };
}

function normalizedBulletLine(line: string) {
  const stripped = stripSoapBullet(line).trim();
  if (!stripped || stripped === "-") return "";
  return `- ${stripped.replace(/^[-*]\s*/, "").trim()}`;
}

export function normalizeSoapTextForEditor(text: string) {
  const lines: string[] = [];
  let section: SoapSection = "header";

  function pushContent(raw: string) {
    const content = stripSoapBullet(raw).trim();
    if (!content) return;
    if (section === "header") {
      lines.push(content);
      return;
    }
    if (section === "ap") {
      const heading = problemHeadingText(raw);
      if (heading) {
        lines.push(`# ${heading}`);
        return;
      }
      const inline = inlineApProblem(raw);
      if (inline) {
        lines.push(`# ${inline.title}`);
        lines.push(`- ${inline.body}`);
        return;
      }
      lines.push(normalizedBulletLine(raw));
      return;
    }
    lines.push(normalizedBulletLine(raw));
  }

  String(text ?? "").split(/\r?\n/).forEach((rawLine) => {
    const raw = rawLine.trim();
    if (!raw) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      return;
    }

    const sectionLine = sectionFromLine(raw);
    if (sectionLine) {
      section = sectionLine.section;
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`${sectionLine.label}:`);
      if (sectionLine.rest) pushContent(sectionLine.rest);
      return;
    }

    if (problemHeadingText(raw)) section = "ap";
    pushContent(raw);
  });

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatSoapTextForEditorStyle(text: string, style: SoapEditorFormat = "standard") {
  const normalized = normalizeSoapTextForEditor(text);
  return formatSoapDraftForStyle(parseSoapText(normalized), style);
}

export function parseSoapText(text: string): SoapDraft {
  const draft: SoapDraft = { header: [], sLines: [], oLines: [], apProblems: [], taskLines: [], dcLines: [], warnings: [] };
  let section: "header" | "s" | "o" | "ap" | "tasks" | "dc" | "warnings" = "header";
  let currentProblem: SoapApProblem | null = null;

  function ensureProblem(title = "Problem") {
    if (!currentProblem) {
      currentProblem = { title, lines: [] };
      draft.apProblems.push(currentProblem);
    }
    return currentProblem;
  }

  function addLine(rawLine: string) {
    const line = stripSoapBullet(rawLine);
    if (!line || line === "-") return;
    if (section === "s") draft.sLines.push(line);
    else if (section === "o") draft.oLines.push(line);
    else if (section === "tasks") draft.taskLines.push(line);
    else if (section === "dc") draft.dcLines.push(line);
    else if (section === "warnings") draft.warnings.push(line);
    else if (section === "ap") {
      const heading = problemHeadingText(rawLine) || (line.startsWith("#") ? cleanSoapLine(line.replace(/^#\s*/, ""), 80) : "");
      if (heading) {
        currentProblem = { title: heading, lines: [] };
        draft.apProblems.push(currentProblem);
        return;
      }
      const inline = inlineApProblem(rawLine);
      if (inline) {
        currentProblem = { title: inline.title, lines: [inline.body] };
        draft.apProblems.push(currentProblem);
        return;
      }
      const problem = ensureProblem();
      problem.lines.push(line);
    } else if (/^(?:v\/s|vs|vitals?|pe|lab|image|img|ct|mri|cxr|xray|x-ray|echo|sono|ultrasound)\b/i.test(line)) {
      draft.oLines.push(line);
    } else {
      draft.header.push(line);
    }
  }

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const sRest = sectionRest(line, "S|Subjective");
    if (sRest !== null) {
      section = "s";
      if (sRest) addLine(sRest);
      return;
    }
    const oRest = sectionRest(line, "O|Objective");
    if (oRest !== null) {
      section = "o";
      if (oRest) addLine(oRest);
      return;
    }
    const apRest = sectionRest(line, "A\\/P|AP|Assessment\\/Plan");
    if (apRest !== null) {
      section = "ap";
      currentProblem = null;
      if (apRest) addLine(apRest);
      return;
    }
    const taskRest = sectionRest(line, "Tasks?|TODO|To do");
    if (taskRest !== null) {
      section = "tasks";
      if (taskRest) addLine(taskRest);
      return;
    }
    const dcRest = sectionRest(line, "DC|Discharge");
    if (dcRest !== null) {
      section = "dc";
      if (dcRest) addLine(dcRest);
      return;
    }
    const warningRest = sectionRest(line, "Warnings?");
    if (warningRest !== null) {
      section = "warnings";
      if (warningRest) addLine(warningRest);
      return;
    }
    if (problemHeadingText(line)) section = "ap";
    addLine(line);
  });

  return {
    header: uniqueSoapLines(draft.header, 8, 150),
    sLines: uniqueSoapLines(draft.sLines, 6, 130),
    oLines: uniqueSoapLines(draft.oLines, 14, 150),
    apProblems: dedupeApProblems(draft.apProblems),
    taskLines: uniqueSoapLines(draft.taskLines, 8, 130),
    dcLines: uniqueSoapLines(draft.dcLines, 5, 130),
    warnings: uniqueSoapLines(draft.warnings, 5, 130),
  };
}

function splitObjectiveLines(oLines: string[]) {
  const vitalSigns: string[] = [];
  const bloodSugar: string[] = [];
  const physicalExam: string[] = [];
  const labSummary: string[] = [];
  const imageSummary: string[] = [];

  oLines.forEach((line) => {
    const clean = cleanSoapLine(line, 180);
    const plain = clean.replace(/^!\s*/, "");
    if (!clean) return;
    if (/^(?:v\/s|vs|vitals?)\s*:/i.test(plain) || /\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(plain)) {
      vitalSigns.push(plain.replace(/^(?:v\/s|vs|vitals?)\s*:\s*/i, ""));
    } else if (/^(?:sugar|blood sugar|bs)\s*:/i.test(plain)) {
      bloodSugar.push(plain.replace(/^(?:sugar|blood sugar|bs)\s*:\s*/i, ""));
    } else if (/^(?:pe|physical exam)\s*:/i.test(plain)) {
      physicalExam.push(plain.replace(/^(?:pe|physical exam)\s*:\s*/i, ""));
    } else if (/^lab\s*:/i.test(plain)) {
      labSummary.push(plain.replace(/^lab\s*:\s*/i, ""));
    } else if (/^(?:image|img)\s*:/i.test(plain) || /^(?:ct|mri|cxr|xray|x-ray|echo|sono|ultrasound)\b/i.test(plain)) {
      imageSummary.push(plain.replace(/^(?:image|img)\s*:\s*/i, ""));
    } else {
      physicalExam.push(clean);
    }
  });

  return { vitalSigns, bloodSugar, physicalExam, labSummary, imageSummary };
}

function taskPriority(text: string): TaskPriority {
  return /^!|urgent|today|stat|critical|call/i.test(text) ? "urgent" : "normal";
}

function taskCategory(text: string): TaskCategory {
  if (/lab|cbc|hb|wbc|cr|k\b|culture|b\/c|bcx/i.test(text)) return "lab";
  if (/ct|mri|cxr|image|echo|sono|ultrasound/i.test(text)) return "imaging";
  if (/consult|call|id\b|onc|nephro|cardio|neuro|gi\b/i.test(text)) return "consult";
  if (/dc|discharge|opd|meds|certificate/i.test(text)) return "discharge";
  if (/family/i.test(text)) return "family";
  if (/order|start|stop|hold|resume|continue/i.test(text)) return "order";
  return "other";
}

function tasksFromSoapLines(lines: string[], patient: Patient): PatientTask[] {
  const now = nowIso();
  const doneTasks = patient.tasks.filter((task) => task.done);
  const nextTasks = uniqueSoapLines(lines, 8, 130).map((line) => ({
    id: createId("t"),
    text: line.replace(/^!+/, "").trim(),
    done: false,
    priority: taskPriority(line),
    category: taskCategory(line),
    dueDate: "",
    createdAt: now,
    completedAt: "",
  }));
  return [...doneTasks, ...nextTasks];
}

function assessmentItemsFromSoapProblems(problems: SoapApProblem[]): AssessmentPlanItem[] {
  return dedupeApProblems(problems).map((problem, index) => {
    const [summary, ...planItems] = problem.lines;
    return {
      id: createId("ap"),
      problemTitle: problem.title,
      assessmentSummary: summary ?? "",
      evidenceOrCourseItems: summary ? [summary] : [],
      planItems,
      category: "activeProblem",
      isImportant: index < 3,
      color: "",
      order: index,
    };
  });
}

export function soapDraftToPatientPatch(
  draft: SoapDraft,
  patient: Patient,
  selectedDate: string,
  reviewedSoapText = formatSoapDraft(draft),
): SoapDraftPatch {
  const objective = splitObjectiveLines(draft.oLines);
  const apText = draft.apProblems
    .map((problem) => [`# ${problem.title}`, ...problem.lines.map((line) => `- ${line}`)].join("\n"))
    .join("\n");
  const now = nowIso();
  const nextPatient: Patient = {
    ...patient,
    subjectiveOrChiefConcern: draft.sLines.join("\n"),
    vitalSigns: objective.vitalSigns.join("\n"),
    bloodSugar: objective.bloodSugar.join("\n"),
    physicalExam: objective.physicalExam.join("\n"),
    newLabs: objective.labSummary.join("\n"),
    rawLabText: objective.labSummary.join("\n"),
    newImaging: objective.imageSummary.join("\n"),
    assessment: draft.apProblems.map((problem) => problem.title).join("\n"),
    plan: apText,
    dischargePlan: draft.dcLines.join("\n"),
    tasks: tasksFromSoapLines(draft.taskLines, patient),
    updatedAt: now,
  };

  return {
    patient: nextPatient,
    dailyNotePatch: {
      date: selectedDate,
      subjectiveOrChiefConcern: nextPatient.subjectiveOrChiefConcern,
      vitalSigns: nextPatient.vitalSigns,
      bloodSugar: nextPatient.bloodSugar,
      physicalExam: nextPatient.physicalExam,
      labSummary: nextPatient.newLabs,
      rawLabText: nextPatient.rawLabText,
      imageSummary: nextPatient.newImaging,
      assessment: nextPatient.assessment,
      plan: nextPatient.plan,
      dischargePlan: nextPatient.dischargePlan,
      soapText: reviewedSoapText,
      soapStatus: "reviewed",
      soapUpdatedAt: now,
      soapVersion: SOAP_VERSION,
      updatedAt: now,
    },
  };
}

export function soapTextToPatientPatch(text: string, patient: Patient, selectedDate: string) {
  return soapDraftToPatientPatch(parseSoapText(text), patient, selectedDate, text.trim());
}

export function soapPreviewTextFromPatient(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "") {
  return getCanonicalSoapText(patient, dailyNotes, selectedDate).text;
}

export function fallbackSoapTextFromPatient(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "") {
  return formatSoapDraft(patientToFallbackSoapDraft(patient, dailyNotes, selectedDate));
}

export function plainSoapTextSummary(text: string, fallback = "-") {
  return plainClinicalText(text, fallback);
}
