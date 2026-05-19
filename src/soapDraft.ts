import { getRoundingDigest } from "./roundingDigest";
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
      if (criticalSoapLine(clean)) return `!${line}`;
      if (importantSoapLine(clean)) return line.replace(clean, `[[blue:${clean}]]`);
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

export function localRoundSoapFromPaste(patient: Patient, dailyNotes: DailyNote[] = [], selectedDate = "", rawText = "") {
  const baseline = parseSoapText(getCanonicalSoapText(patient, dailyNotes, selectedDate).text);
  const fragments = rawText
    .split(/\r?\n|(?<=[.;])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  fragments.forEach((line) => {
    if (/\b(bp|hr|rr|spo2|sat|temp|fever|afebrile|o2|nc|hfno|bipap)\b/i.test(line)) {
      addUniqueLine(baseline.oLines, prefixedLine("V/S", line.replace(/^(?:v\/s|vs|vitals?)\s*:\s*/i, "")), 12, 150);
    } else if (/\b(wbc|hb|hgb|plt|cr|bun|na|k\b|ca|mg|phos|inr|lactate|crp|pct|troponin|bnp|culture|b\/c|bcx)\b/i.test(line)) {
      addUniqueLine(baseline.oLines, prefixedLine("Lab", line.replace(/^lab\s*:\s*/i, "")), 12, 150);
    } else if (/\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|image|imaging|egd|scope)\b/i.test(line)) {
      addUniqueLine(baseline.oLines, prefixedLine("Image", line.replace(/^(?:image|img)\s*:\s*/i, "")), 12, 150);
    } else if (/\b(afebrile|fever|pain|sob|dyspnea|n\/v|weak|dizzy|syncope|overnight|today)\b/i.test(line)) {
      addUniqueLine(baseline.sLines, line, 6, 130);
    }
  });

  const treatmentLines = fragments.filter((line) =>
    /\b(teicoplanin|vancomycin|cef|zosyn|pip\/tazo|meropenem|ertapenem|abx|antibiotic|culture|b\/c|bcx|source control|j-tube|feeding|nutrition|anemia|hb)\b/i.test(line),
  );
  if (treatmentLines.length > 0) {
    const infectionLine = treatmentLines.find((line) => /mrsa|enterococcus|bacteremia|culture|teicoplanin|vancomycin|abx/i.test(line));
    if (infectionLine && !baseline.apProblems.some((problem) => /bacteremia|infection|mrsa|enterococcus/i.test(problem.title))) {
      baseline.apProblems.unshift({
        title: "Bacteremia / infection",
        lines: uniqueSoapLines([infectionLine], 3, 140),
      });
    }
  }

  fragments
    .filter((line) => /\b(f\/u|follow|pending|repeat|call|consult|order|arrange|hold|resume|define|dc|discharge|opd)\b/i.test(line))
    .forEach((line) => addUniqueLine(baseline.taskLines, line.replace(/^tasks?\s*:\s*/i, ""), 6, 130));

  return formatSoapDraft({
    ...baseline,
    apProblems: dedupeApProblems(baseline.apProblems).slice(0, 6),
    warnings: uniqueSoapLines([...baseline.warnings, "Local demo SOAP merge. Review before saving."], 3, 120),
  });
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
  return {
    header,
    sLines: uniqueSoapLines([digest.subjective], 4, 120),
    oLines: makeObjectiveLines(digest.objective, digest.lab, digest.image),
    apProblems: apProblemsFromText(digest.assessmentPlan),
    taskLines: uniqueSoapLines([digest.tasks], 6, 120),
    dcLines: uniqueSoapLines([digest.discharge, prep ? `Prep: ${prep}` : ""], 4, 120),
    warnings: [],
  };
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

  return {
    header,
    sLines,
    oLines,
    apProblems,
    taskLines: uniqueSoapLines((draft.tasks ?? []).map((task) => task.text), 6, 120),
    dcLines: uniqueSoapLines(draft.dischargeIssues ?? [], 4, 120),
    warnings: uniqueSoapLines(draft.uncertainty ?? [], 4, 120),
  };
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

function stripBullet(value: string) {
  return value.replace(/^[-*]\s*/, "").trim();
}

function sectionRest(line: string, label: string) {
  const match = line.match(new RegExp(`^(?:${label})\\s*:\\s*(.*)$`, "i"));
  return match ? match[1].trim() : null;
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
    const line = stripBullet(rawLine);
    if (!line || line === "-") return;
    if (section === "s") draft.sLines.push(line);
    else if (section === "o") draft.oLines.push(line);
    else if (section === "tasks") draft.taskLines.push(line);
    else if (section === "dc") draft.dcLines.push(line);
    else if (section === "warnings") draft.warnings.push(line);
    else if (section === "ap") {
      if (/^#\s*/.test(line)) {
        currentProblem = { title: cleanSoapLine(line.replace(/^#\s*/, ""), 80), lines: [] };
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
    if (/^#\s*/.test(stripBullet(line))) section = "ap";
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
    if (!clean) return;
    if (/^(?:v\/s|vs|vitals?)\s*:/i.test(clean) || /\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(clean)) {
      vitalSigns.push(clean.replace(/^(?:v\/s|vs|vitals?)\s*:\s*/i, ""));
    } else if (/^(?:sugar|blood sugar|bs)\s*:/i.test(clean)) {
      bloodSugar.push(clean.replace(/^(?:sugar|blood sugar|bs)\s*:\s*/i, ""));
    } else if (/^(?:pe|physical exam)\s*:/i.test(clean)) {
      physicalExam.push(clean.replace(/^(?:pe|physical exam)\s*:\s*/i, ""));
    } else if (/^lab\s*:/i.test(clean)) {
      labSummary.push(clean.replace(/^lab\s*:\s*/i, ""));
    } else if (/^(?:image|img)\s*:/i.test(clean) || /^(?:ct|mri|cxr|xray|x-ray|echo|sono|ultrasound)\b/i.test(clean)) {
      imageSummary.push(clean.replace(/^(?:image|img)\s*:\s*/i, ""));
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
  const apItems = assessmentItemsFromSoapProblems(draft.apProblems);
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
    assessmentPlanItems: apItems,
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
      assessmentPlanItems: apItems,
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
