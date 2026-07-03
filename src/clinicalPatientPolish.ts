import { applyClinicalKnowledgeToText, formatRuleBasedSbar, formatRuleBasedWeeklySummary } from "./clinicalKnowledge";
import { specificAntibioticPlan } from "./clinicalFieldRouter";
import { compactMedicalAbbreviations } from "./medicalAbbreviations";
import type { AssessmentPlanItem, DailyNote, GeneratedClinicalPlan, Patient, PatientTask, TaskCategory, TaskPriority } from "./types";
import { nowIso, safeClinicalLine } from "./utils";
import { stripInlineFiller } from "./aiPostprocess/genericFiller";

function cleanLine(value: string, maxChars = 220) {
  const clean = stripInlineFiller(
    value
      .replace(/\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:([^\]]+)\]\]/gi, "$1")
      .replace(/\bwith done\b/gi, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return safeClinicalLine(compactMedicalAbbreviations(clean), maxChars);
}

function cleanTail(value: string) {
  return safeClinicalLine(value, value.length);
}

function extractToken(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function compactRiskLabel(value: string) {
  const wbc = extractToken(value, /\bWBC\s*([0-9.]+\s*k?)/i);
  const anc = extractToken(value, /\bANC\s*([0-9]+)/i);
  const labs = [wbc ? `WBC ${wbc.replace(/\s+/g, "")}` : "", anc ? `ANC ${anc}` : ""].filter(Boolean).join(", ");
  if (/(neutropenic|leukopen|anc|wbc)/i.test(value)) {
    return `!NF/leukopenia${labs ? ` (${labs})` : ""}`;
  }
  return cleanLine(value, 180);
}

function compactTaskText(value: string) {
  const clean = cleanLine(value, 170);
  const antibioticPlan = specificAntibioticPlan(clean);
  if (antibioticPlan) return antibioticPlan;
  if (/anc\/wbc|wbc recovery|fever curve|cultures\/abx|isolation/i.test(clean)) {
    return "f/u CBC diff/ANC, fever, Cx/Abx, isolation";
  }
  if (/ramsay|zoster|ear|antiviral|ent\/id|ent\s+follow|id\s+follow/i.test(clean)) {
    return "confirm antiviral/Abx duration + ENT/ID f/u";
  }
  if (/antibiotic|abx|culture|coverage|de-escalation|source control/i.test(clean)) {
    return "f/u Cx; confirm Abx coverage/duration/source";
  }
  return clean;
}

function isNfLeukopeniaTitle(value: string) {
  return /\b(?:nf|neutropenic|leukopenia|leukopenic)\b/i.test(value);
}

function compactEvidenceLines(lines: string[], problemTitle: string) {
  const lowerTitle = problemTitle.toLowerCase();
  const cleaned = lines.map((line) => cleanLine(line, 110)).filter(Boolean);
  const filtered = cleaned.filter((line) => {
    const lower = line.toLowerCase();
    if (/^(verify|confirm|clarify|review|f\/u|follow|call|contact|trend|monitor|order|arrange)\b/i.test(line)) return false;
    if (/\b(?:if|and|or|with|for|to)$/i.test(line)) return false;
    if (lowerTitle.includes("ramsay") && /(neutropenic|nf\/|leukopen|wbc|anc|afebrile|temp|\bbp\b|\brr\b|low-normal|normal)/i.test(lower)) return false;
    if (isNfLeukopeniaTitle(lowerTitle) && /^(neutropenic fever|nf\b|nf\/leukopenia)/i.test(lower)) return false;
    return true;
  });
  return dedupeByKey(filtered, (line) => line).slice(0, 2);
}

function compactPlanLines(lines: string[], problemTitle: string) {
  const lowerTitle = problemTitle.toLowerCase();
  const joined = lines.join("\n");
  const antibioticPlan = specificAntibioticPlan(joined);
  if (lowerTitle.includes("neutropenic") || lowerTitle.includes("leukopen")) {
    return ["f/u CBC diff/ANC", antibioticPlan || "Cx/Abx + isolation", "call if fever/unstable VS"];
  }
  if (/infection|bacteremia|sepsis/.test(lowerTitle)) {
    return dedupeByKey([antibioticPlan, ...lines.map(compactTaskText)].filter(Boolean), (line) => line).slice(0, 3);
  }
  if (lowerTitle.includes("ramsay")) {
    return ["confirm antiviral/Abx duration", "ENT/ID f/u", "eye/hearing care PRN"];
  }
  if (lowerTitle.includes("heme/onc") || lowerTitle.includes("cancer") || lowerTitle.includes("onc")) {
    return dedupeByKey(lines.map(compactTaskText).filter(Boolean), (line) => line)
      .filter((line) => !/review VTE\/bleed risk/i.test(line))
      .slice(0, 3);
  }
  return dedupeByKey(lines.map(compactTaskText).filter(Boolean), (line) => line).slice(0, 3);
}

function apItemText(item: AssessmentPlanItem) {
  return [item.problemTitle, item.assessmentSummary, ...item.evidenceOrCourseItems, ...item.planItems].join("\n");
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function patientRuleContext(patient: Patient, notes: DailyNote[], selectedDate: string) {
  const selectedNotes = notes
    .filter((note) => note.date <= selectedDate)
    .slice(-7)
    .map((note) =>
      [
        note.date,
        note.overnightEvents,
        note.subjectiveOrChiefConcern,
        note.vitalSigns,
        note.bloodSugar,
        note.rawLabText || note.labSummary,
        note.imageSummary,
        note.dischargePlan,
      ].filter(Boolean).join(" "),
    )
    .join("\n");

  return [
    patient.primaryDiagnosis,
    patient.underlyingDiseases,
    patient.admissionPMH,
    patient.activeProblems,
    patient.hospitalCourseHighlights,
    patient.vitalSigns,
    patient.bloodSugar,
    patient.newLabs || patient.rawLabText,
    patient.newImaging,
    patient.dischargePlan,
    patient.tasks.map((task) => task.text).join("\n"),
    selectedNotes,
  ].filter(Boolean).join("\n");
}

function ruleApToAssessmentPlanItem(item: GeneratedClinicalPlan["problemBasedAP"][number], index: number): AssessmentPlanItem {
  const originalTitle = cleanLine(item.problemTitle, 80);
  const title = originalTitle
    .replace(/^Neutropenic fever\s*\/\s*leukopenia$/i, "NF / leukopenia")
    .replace(/^Ramsay Hunt\s*\/\s*ear infection$/i, "Ramsay Hunt / ear infx")
    .replace(/^Bil leg numbness\s*\/\s*weakness$/i, "B/L leg numb/weak");
  const lowerTitle = title.toLowerCase();
  const summaryText = [item.assessmentSummary, ...item.evidenceOrCourseItems].join(" ");
  const antibioticPlan = specificAntibioticPlan([summaryText, ...item.planItems].join("\n"));
  const wbc = extractToken(summaryText, /\bWBC\s*([0-9.]+\s*k?)/i);
  const anc = extractToken(summaryText, /\bANC\s*([0-9]+)/i);
  const cr = extractToken(summaryText, /\bCr\s*(?:up to\s*)?([0-9.]+)/i);
  const k = extractToken(summaryText, /\bK\s*(?:up to\s*)?([0-9.]+)/i);
  const hb = extractToken(summaryText, /\bHb\s*(?:nadir\s*)?([0-9.]+)/i);
  const labText = [wbc ? `WBC ${wbc.replace(/\s+/g, "")}` : "", anc ? `ANC ${anc}` : ""].filter(Boolean).join(", ");
  const assessment = isNfLeukopeniaTitle(lowerTitle)
    ? `NF/leukopenia${labText ? `: ${labText}` : ""}; f/u ANC, fever, Cx/Abx, isolation.`
    : lowerTitle.includes("ramsay")
      ? "L ear/zoster + CN palsy; f/u antiviral/Abx duration, ENT/ID."
      : lowerTitle.includes("b/l leg")
        ? "NCV: sensorimotor polyneuropathy; ABI pending."
        : /infection|sepsis/i.test(lowerTitle)
          ? antibioticPlan || "source/Cx/Abx; trend fever/WBC/lactate."
        : /cardio|hf|rhythm/i.test(lowerTitle)
          ? /gdmt/i.test(summaryText)
            ? "volume/rhythm; Cr/K + HFrEF GDMT readiness."
            : "volume/O2, rhythm/ischemia; trend Cr/K."
        : /aki|electrolyte/i.test(lowerTitle)
          ? `${[cr ? `Cr ${cr}` : "", k ? `K ${k}` : ""].filter(Boolean).join(", ") || "renal trend"}; I/O, renal-dose meds.`
        : /pulmonary|o2/i.test(lowerTitle)
          ? "O2/aspiration; CXR/CT, wean/escalation threshold."
        : /bleed|anemia/i.test(lowerTitle)
          ? `${hb ? `Hb ${hb}; ` : ""}trend Hb/Plt/V/S; bleeding/anticoag plan.`
        : /heme\/onc|onc safety|cancer|malign/i.test(lowerTitle)
          ? /j-?tube|jejunostomy|nutrition|malnutrition|dysphag/i.test(summaryText)
            ? "SCC with J-tube nutrition; Onc f/u/staging."
            : "Cancer staging / Onc plan."
        : cleanLine(item.assessmentSummary, 120);
  return {
    id: `rule-ap-${index}-${item.problemTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    problemTitle: title,
    assessmentSummary: assessment,
    evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
    planItems: compactPlanLines(item.planItems, title),
    category: "activeProblem",
    isImportant: item.isImportant,
    color: "",
    order: index,
  };
}

function isDuplicateOfRule(item: AssessmentPlanItem, ruleItems: AssessmentPlanItem[]) {
  const title = item.problemTitle.toLowerCase();
  return ruleItems.some((ruleItem) => {
    const ruleTitle = ruleItem.problemTitle.toLowerCase();
    if (/(neutropenic|nf|leukopen)/.test(ruleTitle) && /(neutropenic|nf|leukopen|infection|sepsis)/.test(title)) return true;
    if (ruleTitle.includes("ramsay") && /(ramsay|ear|zoster|infection)/.test(title)) return true;
    return ruleTitle === title;
  });
}

function cleanExistingApItem(item: AssessmentPlanItem, index: number): AssessmentPlanItem {
  const title = cleanLine(item.problemTitle, 80)
    .replace(/^Bil leg numbness\s*\/\s*weakness$/i, "B/L leg numb/weak")
    .replace(/^SLE\s*\/\s*HBV carrier\s*\/\s*TR with pHTN$/i, "SLE / HBV / TR-pHTN");
  const lowerTitle = title.toLowerCase();
  const assessment = lowerTitle.includes("b/l leg")
    ? "NCV: sensorimotor polyneuropathy; ABI pending."
    : lowerTitle.includes("ramsay")
      ? "Ramsay Hunt/CN palsy; f/u antiviral/Abx duration, ENT/ID."
    : lowerTitle.includes("sle")
      ? "Comorbidity context for infx risk/meds."
      : cleanLine(item.assessmentSummary, 120);
  return {
    ...item,
    id: item.id || `existing-ap-${index}`,
    problemTitle: title,
    assessmentSummary: assessment,
    evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
    planItems: compactPlanLines(item.planItems, title),
    order: index,
  };
}

function finalSanitizeApItem(item: AssessmentPlanItem, index: number): AssessmentPlanItem {
  const title = cleanLine(item.problemTitle, 80)
    .replace(/^Neutropenic fever\s*\/\s*leukopenia$/i, "NF / leukopenia")
    .replace(/^Ramsay Hunt\s*\/\s*ear infection$/i, "Ramsay Hunt / ear infx")
    .replace(/^Bil leg numbness\s*\/\s*weakness$/i, "B/L leg numb/weak")
    .replace(/^SLE\s*\/\s*HBV carrier\s*\/\s*TR with pHTN$/i, "SLE / HBV / TR-pHTN");
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("ramsay")) {
    return {
      ...item,
      problemTitle: title,
      assessmentSummary: "Ramsay Hunt/CN palsy; f/u antiviral/Abx duration, ENT/ID.",
      evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
      planItems: ["confirm antiviral/Abx duration", "ENT/ID f/u", "eye/hearing care PRN"],
      order: index,
    };
  }
  if (lowerTitle.includes("b/l leg")) {
    return {
      ...item,
      problemTitle: title,
      assessmentSummary: "NCV: sensorimotor polyneuropathy; ABI pending.",
      evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
      planItems: item.planItems.length > 0 ? compactPlanLines(item.planItems, title) : ["f/u ABI"],
      order: index,
    };
  }
  if (lowerTitle.includes("sle")) {
    return {
      ...item,
      problemTitle: title,
      assessmentSummary: "Comorbidity context for infx risk/meds.",
      evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
      planItems: compactPlanLines(item.planItems, title),
      order: index,
    };
  }
  if (lowerTitle.includes("heme/onc") || lowerTitle.includes("cancer") || lowerTitle.includes("onc")) {
    return {
      ...item,
      problemTitle: title.replace(/^Heme\/Onc safety$/i, "Heme/Onc"),
      assessmentSummary: /j-?tube|jejunostomy|nutrition|malnutrition|dysphag/i.test(apItemText(item))
        ? "SCC with J-tube nutrition; Onc f/u/staging."
        : "Cancer staging / Onc plan.",
      evidenceOrCourseItems: compactEvidenceLines(item.evidenceOrCourseItems, title),
      planItems: compactPlanLines(item.planItems, title),
      order: index,
    };
  }
  return { ...item, problemTitle: title, order: index };
}

function conciseRedFlagLines(plan: GeneratedClinicalPlan) {
  const sbarSituation = formatRuleBasedSbar(plan).match(/^Situation:\s*(.+)$/m)?.[1] ?? "";
  if (/neutropenic|leukopenic|leukopenia|anc|wbc/i.test(sbarSituation)) {
    return [compactRiskLabel(sbarSituation)];
  }

  return dedupeByKey(
    [
      ...plan.redFlags.map((flag) => compactRiskLabel(flag.text)),
    ].filter(Boolean),
    (line) => line,
  ).slice(0, 1);
}

function hasTaskEvidence(text: string, context: string) {
  const combined = `${context}\n${text}`;
  if (/trend\s+tls\s+labs|tls labs|tls\s*\/\s*onc/i.test(text) && !/\b(?:tumou?r lysis|tls concern|tls risk|rasburicase|allopurinol|uric acid\s*[:=]?\s*\d|phos(?:phate)?\s*[:=]?\s*\d|ldh\s*[:=]?\s*\d)\b/i.test(combined)) {
    return false;
  }
  if (/cbc diff\/anc|anc\/wbc|fever curve|isolation/i.test(text) && !/\b(?:neutropen|febrile|fever|anc\s*\d|wbc\s*(?:[0-3](?:\.\d+)?|[0-3]\d{2,3}))\b/i.test(combined)) {
    return false;
  }
  if (/review\s+vte\/bleed|vte\/bleed risk/i.test(text) && !/\b(?:vte|pe\b|dvt|anticoag|heparin|doac|warfarin|apixaban|bleed|plt|platelet|procedure|biopsy|egd|surgery)\b/i.test(combined)) {
    return false;
  }
  if (/transfusion|egd|t&s|ppi|scope/i.test(text) && !/\b(?:active bleed|melena|hematemesis|hematochezia|transfusion|egd|scope|hb\s*[0-7](?:\.\d+)?)\b/i.test(combined)) {
    return false;
  }
  return true;
}

function shouldKeepGeneratedTask(text: string, context: string) {
  const clean = cleanLine(text, 160);
  if (!clean) return false;
  if (!hasTaskEvidence(clean, context)) return false;
  const hasAction = /\b(?:f\/u|follow|pending|repeat|trend|monitor|check|order|consult|arrange|define|confirm|clarify|review|continue|start|stop|hold|resume|culture|b\/c|bcx)\b/i.test(clean);
  const hasTarget = /\b(?:culture|b\/c|bcx|cx|abx|antibiotic|teicoplanin|vanco|cef|mero|duration|source|cbc|anc|wbc|hb|plt|cr|k\b|na|o2|spo2|j-?tube|feeding|nutrition|pathology|staging|onc|opd|discharge|certificate)\b/i.test(clean);
  if (!hasAction || !hasTarget) return false;
  if (/^f\/u pathology\/staging(?: and onc plan)?$/i.test(clean) && !/\b(?:pathology|biopsy|staging|onc|cancer|scc|malign)\b/i.test(context)) return false;
  return true;
}

function taskFromRule(text: string, priority: TaskPriority, category: TaskCategory, index: number): PatientTask {
  const compactText = compactTaskText(text);
  return {
    id: `rule-task-${index}-${compactText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`,
    text: compactText,
    done: false,
    priority,
    category,
    dueDate: "",
    createdAt: nowIso(),
    completedAt: "",
  };
}

function ruleTaskPriorityScore(text: string) {
  const clean = text.toLowerCase();
  if (/blood culture|b\/c|bcx|teicoplanin|abx duration|source/.test(clean)) return 100;
  if (/anc\/wbc|wbc recovery|fever curve|cultures\/abx|isolation|cbc diff/.test(clean)) return 60;
  if (/antiviral|antibiotic|abx|ent|id follow/.test(clean)) return 80;
  if (/abi|ncv|neuro|rehab/.test(clean)) return 60;
  return 50;
}

export function buildConcisePatientClinicalUpdate(patient: Patient, notes: DailyNote[], selectedDate: string): Patient {
  const contextText = patientRuleContext(patient, notes, selectedDate);
  const plan = applyClinicalKnowledgeToText(contextText, {
    pmh: [patient.underlyingDiseases, patient.admissionPMH].filter(Boolean),
    activeProblems: [patient.primaryDiagnosis, patient.activeProblems].filter(Boolean),
    today: selectedDate,
  });
  const redFlagLines = conciseRedFlagLines(plan);
  const ruleTasks = plan.todayTasks
    .filter((task) => shouldKeepGeneratedTask(task.text, contextText))
    .sort((left, right) => ruleTaskPriorityScore(right.text) - ruleTaskPriorityScore(left.text))
    .slice(0, 3)
    .map((task, index) => taskFromRule(task.text, task.priority, task.category, index));
  const nextTasks = dedupeByKey([...ruleTasks, ...patient.tasks.filter((task) => !/^rule-task-/.test(task.id))], (task) => task.text)
    .slice(0, 16)
    .map((task) => ({ ...task, createdAt: task.createdAt || nowIso() }));
  const sbar = formatRuleBasedSbar(plan);
  const weeklySummary = formatRuleBasedWeeklySummary(plan);
  const oneLiner = (sbar.match(/^Situation:\s*(.+)$/m)?.[1] ?? "").trim();

  return {
    ...patient,
    oneLiner: oneLiner || patient.oneLiner,
    importantRedFlags: redFlagLines.length > 0 ? redFlagLines.join("\n") : patient.importantRedFlags,
    tasks: nextTasks,
    generatedSbarNote: patient.generatedSbarNote,
    generatedWeeklySummary: patient.generatedWeeklySummary,
    updatedAt: nowIso(),
  };
}
