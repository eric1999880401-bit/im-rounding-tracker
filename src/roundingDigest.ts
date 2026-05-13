import type { DailyNote, Patient } from "./types";
import {
  formatDateLabel,
  getActiveProblemItems,
  getLabFocusSummary,
  getUnderlyingDiseaseItems,
  pendingDischargePrep,
  plainClinicalText,
  splitHighlightLines,
} from "./utils";

type DigestMode = "board" | "rounds";

interface DigestOptions {
  mode?: DigestMode;
  hideCompletedTasks?: boolean;
}

export interface RoundingDigest {
  diagnosis: string;
  risks: string;
  issues: string;
  redFlags: string;
  subjective: string;
  objective: string;
  lab: string;
  image: string;
  assessmentPlan: string;
  tasks: string;
  discharge: string;
  urgentLines: string[];
  attendingSummary: string;
}

function digestLimits(mode: DigestMode) {
  if (mode === "rounds") {
    return {
      chars: 54,
      detailChars: 66,
      redFlags: 3,
      diagnosis: 4,
      risks: 5,
      issues: 4,
      subjective: 3,
      objective: 1,
      pe: 2,
      images: 2,
      ap: 4,
      tasks: 5,
      urgent: 5,
    };
  }

  return {
    chars: 40,
    detailChars: 52,
    redFlags: 2,
      diagnosis: 3,
      risks: 4,
      issues: 3,
      subjective: 2,
      objective: 1,
      pe: 1,
      images: 1,
    ap: 3,
    tasks: 3,
    urgent: 3,
  };
}

function cleanDigestLine(value: string) {
  return value
    .replace(/\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi, "$2")
    .replace(/\s+-\s*Reason:\s*.*$/i, "")
    .replace(/\s*\(\s*source:\s*AI\s*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function shortDigestText(value: string, maxChars = 52) {
  const clean = cleanDigestLine(value)
    .replace(/\bright\b/gi, "R")
    .replace(/\bleft\b/gi, "L")
    .replace(/\bbilateral\b/gi, "B/L")
    .replace(/\bwithout\b/gi, "w/o")
    .replace(/\bwith\b/gi, "w/")
    .replace(/\bsuspected\b/gi, "susp")
    .replace(/\bcompatible with\b/gi, "c/w")
    .replace(/\bconcerning for\b/gi, "c/f")
    .replace(/\bfollow[- ]?up\b/gi, "f/u")
    .replace(/\bacute ischemic stroke\b/gi, "AIS")
    .replace(/\binfarctions?\b/gi, "infarct")
    .replace(/\bhemorrhage\b/gi, "ICH")
    .replace(/\bpneumonia\b/gi, "PNA")
    .replace(/\bperoneal\/tibial CMAP & sural SNAP unelicitable\b/gi, "peroneal/tibial/sural unelicitable")
    .replace(/\bCMAP & sural SNAP\b/gi, "CMAP/SNAP")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxChars) return clean;

  const firstClause = clean.split(/[;\n]/)[0]?.trim() || clean;
  if (firstClause.length <= maxChars) return firstClause;

  const words = firstClause.split(" ");
  const kept: string[] = [];
  words.forEach((word) => {
    const next = [...kept, word].join(" ");
    if (next.length <= maxChars) kept.push(word);
  });

  return kept.join(" ") || firstClause.slice(0, maxChars).trim();
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map(cleanDigestLine)
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function clinicalDedupeKey(value: string) {
  return cleanDigestLine(value)
    .replace(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*[:/-]?\s*/i, "")
    .replace(/^(?:ct|cta|mri|mra|cxr|xray|x-ray|u\/s|us|sono|ultrasound|image|study)(?:\s+[^:]{0,28})?:\s*/i, "")
    .replace(/^(?:neuro|heent|cv|resp|chest|abd|gi|gu|ext|skin|msk|general|gen|ob|gyn|pe)\s*:\s*/i, "")
    .replace(/\bright\b|\brt\b/gi, "r")
    .replace(/\bleft\b|\blt\b/gi, "l")
    .replace(/\bbilateral\b|\bbilat\b|\bbil\b/gi, "bl")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function uniqueClinicalLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map(cleanDigestLine)
    .filter(Boolean)
    .filter((line) => {
      const key = clinicalDedupeKey(line) || line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function joinTags(tags: string[], maxItems: number) {
  return uniqueLines(tags).slice(0, maxItems).join(", ");
}

const problemStopWords = new Set([
  "acute",
  "chronic",
  "with",
  "without",
  "and",
  "or",
  "for",
  "from",
  "rule",
  "out",
  "suspect",
  "suspected",
  "possible",
  "probable",
  "problem",
  "plan",
]);

function clinicalItems(value: string) {
  const text = plainClinicalText(value, "");
  if (!text || text === "-") return [];
  return text.split(/\s*;\s*|\r?\n/).map(cleanDigestLine).filter(Boolean);
}

function compactList(items: string[], maxItems: number, maxChars: number) {
  return uniqueLines(items)
    .slice(0, maxItems)
    .map((item) => shortDigestText(item, maxChars))
    .filter(Boolean)
    .join("; ");
}

function compactText(value: string, maxItems: number, maxChars: number) {
  return compactList(clinicalItems(value), maxItems, maxChars);
}

function highlightedClinicalItems(value: string) {
  return splitHighlightLines(value)
    .map((line, index) => ({
      index,
      important: line.important,
      text: cleanDigestLine(line.text),
    }))
    .filter((line) => line.text);
}

function subjectiveSignalScore(value: string) {
  const text = value.toLowerCase();
  let score = 0;
  if (/!|urgent|critical|new|worse|persistent|severe|acute|unable|poor|decrease|increase|drop/.test(text)) score += 4;
  if (/dyspnea|sob|chest pain|cp\b|desat|hypox|fever|chill|shock|hypot|tachy|syncope|fall|seizure|ams|deliri/.test(text)) {
    score += 5;
  }
  if (/weak|numb|aphasia|dysarth|facial|dizziness|vertigo|headache|swallow|dysphag|aspirat|chok/.test(text)) score += 4;
  if (/bleed|melena|hematochezia|hematuria|vaginal|pain|vomit|diarrhea|constipat|oliguria|urine|edema/.test(text)) score += 4;
  if (/family|refuse|poor intake|insomnia|anxiety|agitat|confus/.test(text)) score += 2;
  if (/\d/.test(text)) score += 1;
  if (/\b(no acute|stable|unchanged|comfortable|well|ok|fine)\b/.test(text)) score -= 3;
  return score;
}

function compactPriorityText(value: string, maxItems: number, maxChars: number) {
  const highlighted = highlightedClinicalItems(value);
  const important = highlighted.filter((item) => item.important);
  const highSignal = highlighted.filter((item) => !item.important && subjectiveSignalScore(item.text) >= 5);
  const candidates = important.length > 0 ? important : highSignal;

  return uniqueLines(candidates.map((item) => item.text))
    .map((item, index) => ({ item, index, score: subjectiveSignalScore(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .map((entry) => shortDigestText(entry.item, maxChars))
    .filter(Boolean)
    .join("; ");
}

function topSubjectiveSignals(patient: Patient, maxItems: number, maxChars: number) {
  const highlighted = [...highlightedClinicalItems(patient.overnightEvent), ...highlightedClinicalItems(patient.subjectiveOrChiefConcern)];
  const important = highlighted.filter((item) => item.important);
  const candidates = important.length > 0 ? important : highlighted.filter((item) => subjectiveSignalScore(item.text) >= 5);

  return uniqueLines(candidates.map((item) => item.text))
    .map((item, index) => ({ item, index, score: subjectiveSignalScore(item) }))
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxItems)
    .map((entry) => shortDigestText(entry.item, maxChars))
    .filter(Boolean);
}

function splitClinicalClauses(value: string) {
  return cleanDigestLine(value)
    .replace(/\b\d+\.\s*/g, "; ")
    .split(/\s*(?:;|\n|, and | and )\s*/i)
    .map(cleanDigestLine)
    .filter(Boolean);
}

function lowValueClause(value: string) {
  return /\b(unremarkable|normal|no acute|no definite|no evidence|negative for|within normal|stable|unchanged|mild atrophy|elderly|small vessel disease|degenerative|pulse \+|no cv angle|no cva)\b/i.test(
    value,
  );
}

function clinicalSignalScore(value: string, kind: "image" | "pe") {
  const text = value.toLowerCase();
  let score = 0;
  if (/!|critical|urgent|pending|new|acute|worsen|progress/.test(text)) score += 5;
  if (
    kind === "image" &&
    /infarct|stroke|ich|hemorrhage|bleed|hypodense|stenosis|occlusion|aneurysm|mass|tumou?r|abscess|pneumonia|edema|effusion|pe\b|dvt|fracture|hematoma|obstruction|pending|unelicitable/.test(
      text,
    )
  ) {
    score += 7;
  }
  if (
    kind === "pe" &&
    /weak|palsy|dysarth|aphasia|numb|sensory|motor|nystagmus|facial|pale|jaundice|crackle|wheeze|rales|murmur|jvp|edema|tender|guard|distend|melena|blood|cyanosis|rash|wound|pus|erythem|pooling|discharge/.test(
      text,
    )
  ) {
    score += 7;
  }
  if (/\b(r|l|rt|lt|right|left|bil|b\/l)\b/i.test(text)) score += 1;
  if (/\d/.test(text)) score += 1;
  if (lowValueClause(value)) score -= 8;
  return score;
}

function bestClinicalSignal(value: string, kind: "image" | "pe", maxChars: number) {
  const clauses = splitClinicalClauses(value);
  if (clauses.length === 0) return "";

  const scored = clauses
    .map((clause) => ({ clause, score: clinicalSignalScore(clause, kind) }))
    .sort((a, b) => b.score - a.score || a.clause.length - b.clause.length);
  const best =
    scored.find((entry) => entry.score > 0)?.clause ??
    scored.find((entry) => !lowValueClause(entry.clause))?.clause ??
    scored[0]?.clause ??
    "";

  return shortDigestText(best, maxChars);
}

function shortStudyType(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/mri|mra/i.test(text) && /brain/i.test(text)) return "MRI/MRA brain";
  if (/ct|cta/i.test(text) && /brain/i.test(text)) return "CT/CTA brain";
  if (/cxr|chest x/i.test(text)) return "CXR";
  if (/pelvis/i.test(text) && /mri/i.test(text)) return "MRI pelvis";
  if (/carotid|tcd/i.test(text)) return "Carotid/TCD";
  if (/abi/i.test(text)) return "ABI";
  if (/ncv|emg/i.test(text)) return "NCV/EMG";
  if (/ultrasound|sono|u\/s/i.test(text)) return "U/S";
  return shortDigestText(text, 18);
}

function sidePrefix(text: string) {
  if (/\b(bilateral|bilat|bil|b\/l)\b/i.test(text)) return "B/L";
  if (/\b(left|lt)\b/i.test(text)) return "L";
  if (/\b(right|rt)\b/i.test(text)) return "R";
  return "";
}

function severityPrefix(text: string) {
  if (/high[- ]?grade/i.test(text)) return "high-grade";
  if (/critical/i.test(text)) return "critical";
  if (/severe/i.test(text)) return "severe";
  if (/moderate/i.test(text)) return "mod";
  if (/mild/i.test(text)) return "mild";
  return "";
}

function strokeLocationTags(text: string) {
  const lower = text.toLowerCase();
  const side = sidePrefix(text);
  const tags: string[] = [];
  if (/cerebell/.test(lower)) tags.push(`${side ? `${side} ` : ""}cerebellar`);
  if (/basal ganglia/.test(lower)) tags.push(`${side ? `${side} ` : ""}BG`);
  if (/subcortical/.test(lower)) tags.push(`${side ? `${side} ` : ""}subcortical`);
  if (/pons|pontine/.test(lower)) tags.push("pontine");
  if (/posterior circulation|post circ/.test(lower)) tags.push("post circ");
  if (/mca/.test(lower) && !/stenos/.test(lower)) tags.push(`${side ? `${side} ` : ""}MCA`);
  return tags;
}

function vascularStenosisLabel(text: string) {
  const lower = text.toLowerCase();
  const side = sidePrefix(text);
  const severity = severityPrefix(text);
  const prefix = [side, severity].filter(Boolean).join(" ");
  const mcaSide = side === "B/L" ? "" : side;
  const intracranialPrefix = [mcaSide, severity].filter(Boolean).join(" ");

  if (/ica|internal carotid/.test(lower) && /stenos/.test(lower)) return [prefix, "ICA stenosis"].filter(Boolean).join(" ");
  if (/\bmca\b|middle cerebral/.test(lower) && /stenos/.test(lower)) return [intracranialPrefix, "MCA stenosis"].filter(Boolean).join(" ");
  if (/\baca\b|anterior cerebral/.test(lower) && /stenos/.test(lower)) return [intracranialPrefix, "ACA stenosis"].filter(Boolean).join(" ");
  if (/\bpca\b|posterior cerebral/.test(lower) && /stenos/.test(lower)) return [intracranialPrefix, "PCA stenosis"].filter(Boolean).join(" ");
  if (/carotid/.test(lower) && /stenos/.test(lower)) return [prefix, "carotid stenosis"].filter(Boolean).join(" ");
  if (/carotid/.test(lower) && /\baso\b|atheroscler/.test(lower)) return [side || "B/L", "carotid ASO"].filter(Boolean).join(" ");
  return "";
}

function problemLabel(value: string, maxChars: number) {
  const text = cleanDigestLine(value);
  const lower = text.toLowerCase();
  const vascular = vascularStenosisLabel(text);
  if (vascular) return vascular;

  if (/ischemic stroke|acute stroke|\bais\b|infarct|cva/.test(lower)) {
    const nihss = text.match(/\bnihss\s*[:=]?\s*(\d+)/i)?.[1];
    const tags = [`AIS${nihss ? ` NIHSS${nihss}` : ""}`, ...strokeLocationTags(text)];
    if (/a[\s-]*to[\s-]*a|artery[\s-]*to[\s-]*artery/.test(lower)) tags.push("r/o A-A");
    return joinTags(tags, 4);
  }
  if (/tia/.test(lower)) return "TIA";
  if (/atrial fibrillation|afib|\baf\b/.test(lower) && /\bcad\b|chf|heart failure|\bhtn\b/.test(lower)) {
    const tags = [];
    if (/atrial fibrillation|afib|\baf\b/.test(lower)) tags.push("AF");
    if (/\bcad\b|coronary/.test(lower)) tags.push("CAD");
    if (/chf|heart failure|\bhf\b/.test(lower)) tags.push("HF");
    if (/\bhtn\b|hypertension/.test(lower)) tags.push("HTN");
    return tags.join("/");
  }
  if (/anemia|hb drop|bleed/.test(lower)) return "anemia/bleed";
  if (/urinary tract infection|\buti\b/.test(lower)) return "UTI";
  if (/postmenopausal bleeding|vaginal bleeding|\bpmb\b/.test(lower)) return "PMB";
  if (/diabetes|dm/.test(lower) && /poor|uncontrol|hypergly/.test(lower)) return "DM poor ctrl";
  if (/pneumonia|\bpna\b/.test(lower)) return "PNA";
  if (/acute kidney|\baki\b/.test(lower)) return "AKI";
  if (/dysphag|swallow/.test(lower)) return "dysphagia";
  if (/weak|paresis|palsy|numbness|sensory|dysarth/.test(lower)) return "neuro deficit";

  return shortDigestText(text, maxChars);
}

function diagnosisSummary(patient: Patient, maxItems: number, maxChars: number) {
  const text = [patient.primaryDiagnosis, patient.oneLiner].filter(Boolean).join(" ");
  const diagnosisText = patient.primaryDiagnosis || patient.oneLiner;
  const lower = text.toLowerCase();
  const tags: string[] = [];
  const side = sidePrefix(diagnosisText);
  const nihss = text.match(/\bnihss\s*[:=]?\s*(\d+)/i)?.[1];

  if (/tia/.test(lower) && !/stroke|infarct/.test(lower)) tags.push("TIA");
  if (/ischemic stroke|acute stroke|\bais\b|infarct|cva/.test(lower)) {
    tags.push(`AIS${nihss ? ` NIHSS${nihss}` : ""}`);
  }
  if (/mca/.test(lower) && /stenos/.test(lower)) tags.push(`${side ? `${side} ` : ""}MCA stenosis`);
  if (/ica|carotid/.test(lower) && /stenos/.test(lower)) tags.push(`${side ? `${side} ` : ""}ICA stenosis`);
  if (/basal ganglia/.test(lower)) tags.push(`${side ? `${side} ` : ""}BG`);
  if (/cerebell/.test(lower)) tags.push(`${side ? `${side} ` : ""}cerebellar`);
  if (/pons|pontine/.test(lower)) tags.push("pontine");
  if (/subcortical/.test(lower)) tags.push(`${side ? `${side} ` : ""}subcortical`);
  if (/posterior circulation|post circ/.test(lower)) tags.push("post circ");
  if (/a[\s-]*to[\s-]*a|artery[\s-]*to[\s-]*artery/.test(lower)) tags.push("r/o A-A");
  if (/ramsay/.test(lower)) tags.push("Ramsay Hunt");
  if (/parkinson/.test(lower)) tags.push("Parkinson");
  if (/pneumonia|\bpna\b/.test(lower)) tags.push("PNA");
  if (/sepsis/.test(lower)) tags.push("sepsis");
  if (/urinary tract infection|\buti\b/.test(lower)) tags.push("UTI");
  if (/postmenopausal bleeding|vaginal bleeding|\bpmb\b/.test(lower)) tags.push("PMB");
  if (/diabetes|dm/.test(lower) && /poor|uncontrol|hypergly/.test(lower)) tags.push("DM poor ctrl");
  if (/visual|auditory|hallucination/.test(lower)) tags.push("hallucination");

  return joinTags(tags, maxItems) || shortDigestText(text, maxChars);
}

function riskSummary(patient: Patient, maxItems: number, maxChars: number) {
  const text = [patient.underlyingDiseases, patient.admissionPMH, ...getUnderlyingDiseaseItems(patient)].join(" ");
  const lower = text.toLowerCase();
  const tags: string[] = [];

  if (/\bhtn\b|hypertension/.test(lower)) tags.push("HTN");
  if (/\bdm\b|diabetes|t2dm/.test(lower)) tags.push("DM");
  if (/hyperlipidemia|\bhld\b|dyslipidemia/.test(lower)) tags.push("HLD");
  if (/\baf\b|afib|atrial fibrillation|paroxysmal af/.test(lower)) tags.push("AF");
  if (/\bcad\b|coronary/.test(lower)) tags.push("CAD");
  if (/heart failure|\bhf\b|chf|lvhf|nyha|reduced ef|hfpef|hfref|hfr?ef/.test(lower)) tags.push("HF");
  if (/\bckd\b|esrd|dialysis|renal/.test(lower)) tags.push("CKD");
  if (/tia|stroke|cva/.test(lower)) tags.push("old CVA/TIA");
  if (/\bsle\b|lupus/.test(lower)) tags.push("SLE");
  if (/\bhbv\b|hepatitis b/.test(lower)) tags.push("HBV");
  if (/\bhcv\b|hepatitis c/.test(lower)) tags.push("HCV");
  if (/cirrhosis/.test(lower)) tags.push("cirrhosis");
  if (/copd|asthma/.test(lower)) tags.push("COPD/asthma");
  if (/pulmonary hypertension|phtn/.test(lower)) tags.push("pulm HTN");
  if (/tricuspid regurgitation|\btr\b/.test(lower)) tags.push("TR");
  if (/hypothyroid|hyperthyroid|thyroid/.test(lower)) tags.push("thyroid");
  if (/cancer|malign|carcinoma|tumou?r|ca\b/.test(lower)) tags.push("CA hx");

  return joinTags(tags, maxItems) || compactList(getUnderlyingDiseaseItems(patient), 3, maxChars);
}

function issueSummary(patient: Patient, maxItems: number, maxChars: number) {
  const text = [
    patient.activeProblems,
    ...getActiveProblemItems(patient),
    ...patient.assessmentPlanItems.map((item) => `${item.problemTitle} ${item.assessmentSummary}`),
  ].join(" ");
  const lower = text.toLowerCase();
  const tags: string[] = [];

  if (/urinary tract infection|\buti\b/.test(lower)) tags.push("UTI");
  if (/postmenopausal bleeding|vaginal bleeding|\bpmb\b|ob gyn|obgyn/.test(lower)) tags.push("PMB");
  if (/ischemic stroke|acute stroke|\bais\b|infarct|cva/.test(lower)) tags.push(problemLabel(text, maxChars));
  if (/diabetes|dm/.test(lower) && /poor|uncontrol|hypergly/.test(lower)) tags.push("DM poor ctrl");
  if (/aki|acute kidney|renal function/.test(lower)) tags.push("AKI");
  if (/anemia|bleed|hb drop/.test(lower)) tags.push("anemia/bleed");
  if (/neutropenic|neutropenia|leukopenia|wbc low/.test(lower)) tags.push("neutropenia");
  if (/infection|sepsis|pneumonia|\bpna\b/.test(lower)) tags.push(/pneumonia|\bpna\b/.test(lower) ? "PNA" : "infection");
  if (/dysphag|swallow/.test(lower)) tags.push("dysphagia");
  if (/carotid|mca|ica/.test(lower) && /stenos/.test(lower)) tags.push("large-vessel stenosis");
  if (/weak|paresis|palsy|numbness|sensory/.test(lower)) tags.push("neuro deficit");

  return joinTags(tags, maxItems) || compactList(getActiveProblemItems(patient).map((item) => problemLabel(item, maxChars)), maxItems, maxChars);
}

function importantObjectiveText(value: string, maxChars: number, maxItems: number) {
  const importantPattern =
    /abnormal|important|\bfever\b|\bfebrile\b|hypotherm|tachy|brady|hypot|hypert|shock|desat|hypox|spo2|oxygen|nasal|nc\b|o2\b|high|low|elevat|drop|worse|hypergly|hypogly|bleed|pain|unstable/i;
  const normalOnlyPattern = /\bafebrile\b|\bnormal\b|\bwnl\b|\bstable\b|within normal/i;
  const items = highlightedClinicalItems(value).filter((item) => {
    if (item.important) return true;
    if (normalOnlyPattern.test(item.text) && !/(abnormal|important|hypot|hypert|tachy|brady|desat|hypox|high|low|elevat|drop|worse|hypergly|hypogly|bleed|pain|unstable)/i.test(item.text)) {
      return false;
    }
    return importantPattern.test(item.text);
  });
  return compactList(items.map((item) => item.text), maxItems, maxChars);
}

function shortDateSortValue(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function labFocusText(patient: Patient, notes: DailyNote[], mode: DigestMode) {
  const labFocus = getLabFocusSummary(patient, notes, {
    maxCritical: 2,
    maxTrend: mode === "rounds" ? 3 : 2,
    maxAnchors: 2,
    separator: "\n",
  });
  const text = labFocus.text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\+\d+\s+labs\b/i.test(line))
    .join("\n");

  return { text, labFocus };
}

function compactDateLabel(date: string) {
  const formatted = formatDateLabel(date);
  const parts = formatted.split("/");
  if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`;
  return formatted;
}

function imageFindingLabel(studyType: string, value: string, maxChars: number) {
  const text = cleanDigestLine(`${studyType} ${value}`);
  const lower = text.toLowerCase();
  const vascular = vascularStenosisLabel(text);
  if (vascular) return vascular;

  if (/hematoma/.test(lower)) {
    const side = sidePrefix(text);
    if (/inguinal/.test(lower)) return [side, "inguinal hematoma"].filter(Boolean).join(" ");
    return [side, "hematoma"].filter(Boolean).join(" ");
  }

  if (/cerebell/.test(lower) && /infarct|stroke|acute|restricted diffusion|dwi/.test(lower)) {
    const side = sidePrefix(text);
    return [side, "cerebellar infarct"].filter(Boolean).join(" ");
  }
  if (/infarct|stroke|restricted diffusion|dwi/.test(lower)) {
    const locations = strokeLocationTags(text);
    return locations.length > 0 ? `${locations.join(", ")} infarct` : "infarct";
  }
  if (/cerebell/.test(lower)) return [sidePrefix(text), "cerebellar lesion"].filter(Boolean).join(" ");
  if (/mastoiditis/.test(lower)) return [sidePrefix(text), "mastoiditis"].filter(Boolean).join(" ");
  if (/hemorrhage|bleed|ich/.test(lower)) return [sidePrefix(text), "ICH"].filter(Boolean).join(" ");
  if (/pneumonia|\bpna\b/.test(lower)) return "PNA";
  if (/effusion/.test(lower)) return "effusion";
  if (/peroneal|tibial|sural|unelicitable|cmap|snap/i.test(text)) return "peroneal/tibial/sural unelicitable";

  return bestClinicalSignal(value, "image", maxChars);
}

function imageSummaryText(patient: Patient, maxItems: number, maxChars: number) {
  const structured = [...patient.imageStudyEntries]
    .filter((entry) => entry.impression.trim() || entry.finding.trim() || entry.studyType.trim())
    .sort((a, b) => shortDateSortValue(b.date).localeCompare(shortDateSortValue(a.date)))
    .map((entry) => {
      const raw = entry.impression || entry.finding || entry.note || entry.studyType;
      return {
        score: clinicalSignalScore(raw, "image") + Number(entry.isImportant) * 10,
        text: [
          entry.date ? compactDateLabel(entry.date) : "",
          shortStudyType(entry.studyType) || "Image",
          imageFindingLabel(entry.studyType, raw, maxChars),
        ]
          .filter(Boolean)
          .join(": "),
      };
    })
    .filter((entry) => entry.score >= 7)
    .map((entry) => entry.text);
  const legacy = highlightedClinicalItems(patient.newImaging)
    .map((line) => ({
      score: clinicalSignalScore(line.text, "image") + Number(line.important) * 10,
      text: imageFindingLabel("", line.text, maxChars),
    }))
    .filter((entry) => entry.score >= 7)
    .map((entry) => entry.text);
  return uniqueClinicalLines([...structured, ...legacy])
    .slice(0, maxItems)
    .join("\n");
}

function peSummaryText(patient: Patient, maxItems: number, maxChars: number) {
  const structured = [...patient.physicalExamEntries]
    .filter((entry) => entry.finding.trim() || entry.system.trim())
    .map((entry) => {
      const raw = entry.finding || entry.note || entry.system;
      const signal = bestClinicalSignal(raw, "pe", maxChars);
      const score = clinicalSignalScore(raw, "pe") + Number(entry.isImportant) * 10;
      return {
        score,
        text: [entry.system, signal].filter(Boolean).join(": "),
      };
    });
  const legacy = highlightedClinicalItems(patient.physicalExam).map((line) => ({
    score: clinicalSignalScore(line.text, "pe") + Number(line.important) * 10,
    text: bestClinicalSignal(line.text, "pe", maxChars),
  }));
  const ranked = [...structured, ...legacy]
    .filter((item) => item.text.trim() && item.score >= 7)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .map((item) => item.text);
  return uniqueClinicalLines(ranked)
    .slice(0, maxItems)
    .map((item) => shortDigestText(item, maxChars))
    .filter(Boolean)
    .join("; ");
}

function objectiveSummaryText(patient: Patient, maxItems: number, maxChars: number) {
  const vitalImportant = importantObjectiveText(patient.vitalSigns, maxChars, maxItems);
  const sugarImportant = importantObjectiveText(patient.bloodSugar, maxChars, maxItems);
  const pe = peSummaryText(patient, maxItems, maxChars);
  return [
    vitalImportant ? `V/S: ${vitalImportant}` : "",
    sugarImportant ? `Sugar: ${sugarImportant}` : "",
    pe ? `PE: ${pe}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function assessmentPlanSummaryText(patient: Patient, maxItems: number, maxChars: number) {
  function isOperationalTaskLine(value: string) {
    const lower = value.toLowerCase();
    const hasTaskWords = /找|聯絡|通知|報告|計畫|出來|安排|預約|請|call|contact|arrange|pending|follow/.test(lower);
    const hasClinicalProblem = /stroke|ais|tia|stenos|infarct|bleed|anemia|uti|pna|pneumonia|aki|hf|cad|af|dm|htn|cancer|tumou?r|infection|sepsis|dysphag|weak|palsy|pain|hematoma|fracture/.test(
      lower,
    );
    return hasTaskWords && !hasClinicalProblem;
  }

  function assessmentImportanceScore(value: string, itemImportant = false) {
    const lower = value.toLowerCase();
    let score = itemImportant ? 100 : 0;
    if (/stroke|ais|tia|infarct|ich|hemorrhage|bleed|anemia|hb drop|sepsis|shock|resp failure|hypox|desat|acs|mi|arrhythm|af\b/.test(lower)) score += 14;
    if (/cancer|carcinoma|tumou?r|\bca\b|mass|metasta|cervical|malign|biopsy|pathology/.test(lower)) score += 13;
    if (/aki|renal failure|hf|heart failure|pna|pneumonia|uti|infection|dysphag|aspirat|fracture|hematoma/.test(lower)) score += 10;
    if (/stenos|occlusion|aneurysm|thromb|embol|dvt|pe\b/.test(lower)) score += 9;
    if (/pending|f\/u|follow|consult|hold|resume|repeat|monitor|titrate|adjust|dc|discharge/.test(lower)) score += 3;
    if (/\d/.test(lower)) score += 1;

    const context = [
      patient.primaryDiagnosis,
      patient.oneLiner,
      patient.activeProblems,
      patient.importantRedFlags,
      patient.newImaging,
      patient.rawLabText,
      patient.newLabs,
    ]
      .join(" ")
      .toLowerCase();
    const titleWords = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !problemStopWords.has(word));
    const matchedWords = titleWords.filter((word) => context.includes(word));
    score += Math.min(matchedWords.length, 3) * 3;
    return score;
  }

  function assessmentDetailScore(value: string, source: "assessment" | "evidence" | "plan") {
    const lower = value.toLowerCase();
    let score = source === "plan" ? 3 : source === "assessment" ? 2 : 1;
    if (/pending|f\/u|follow|consult|biopsy|pathology|culture|repeat|monitor|trend|hold|resume|adjust|titrate|start|stop|switch|abx|antiplatelet|anticoag|statin|rehab|swallow|ng|foley|oxygen|diuresis|dc|discharge/.test(lower)) score += 7;
    if (/stroke|ais|tia|ich|sepsis|shock|resp failure|hypox|desat|bleed|hb|aki|hf|pna|uti|cancer|carcinoma|tumou?r|mass|stenos|occlusion|dvt|pe\b|fracture|hematoma/.test(lower)) score += 6;
    if (/\d/.test(lower)) score += 2;
    if (lowValueClause(value) || /\b(stable|no change|unchanged|continue same|cont same)\b/i.test(value)) score -= 4;
    return score;
  }

  function bestAssessmentDetail(lines: string[]) {
    return lines
      .map((line, index) => ({
        line: cleanDigestLine(line),
        index,
        score: assessmentDetailScore(line, index === 0 ? "assessment" : "evidence"),
      }))
      .filter((entry) => entry.line)
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.line ?? "";
  }

  function assessmentItemLine(item: Patient["assessmentPlanItems"][number]) {
    const label = problemLabel(item.problemTitle || item.assessmentSummary, Math.min(24, maxChars));
    const candidates = [
      ...item.planItems.map((line) => ({
        line,
        score: assessmentDetailScore(line, "plan"),
      })),
      ...(item.assessmentSummary ? [{ line: item.assessmentSummary, score: assessmentDetailScore(item.assessmentSummary, "assessment") }] : []),
      ...item.evidenceOrCourseItems.map((line) => ({
        line,
        score: assessmentDetailScore(line, "evidence"),
      })),
    ]
      .filter((entry) => cleanDigestLine(entry.line))
      .sort((a, b) => b.score - a.score || a.line.length - b.line.length);
    const detail = candidates[0]?.line ?? "";
    const detailKey = clinicalDedupeKey(detail);
    const labelKey = clinicalDedupeKey(label);

    if (!detail || detailKey === labelKey) return label;

    const detailChars = Math.max(18, maxChars - label.length - 2);
    const detailText = shortDigestText(detail, detailChars);
    if (!detailText || clinicalDedupeKey(detailText) === labelKey) return label;
    return shortDigestText(`${label}: ${detailText}`, Math.max(maxChars, label.length + detailText.length + 2));
  }

  function legacyAssessmentLine(value: string) {
    const label = problemLabel(value, Math.min(24, maxChars));
    const detail = bestAssessmentDetail(splitClinicalClauses(value));
    if (!detail || clinicalDedupeKey(detail) === clinicalDedupeKey(label)) return label;
    const detailText = shortDigestText(detail, Math.max(18, maxChars - label.length - 2));
    return shortDigestText(`${label}: ${detailText}`, Math.max(maxChars, label.length + detailText.length + 2));
  }

  if (patient.assessmentPlanItems.length === 0) {
    const legacyItems = [...clinicalItems(patient.assessment), ...clinicalItems(patient.plan)]
      .filter((item) => !isOperationalTaskLine(item))
      .map((item, index) => ({ item, index, score: assessmentImportanceScore(item) }))
      .filter((item) => item.score >= 8)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => legacyAssessmentLine(item.item));

    return uniqueLines(legacyItems)
      .slice(0, maxItems)
      .join("\n");
  }

  const scoredItems = [...patient.assessmentPlanItems]
    .filter((item) => item.category !== "underlyingDisease")
    .filter((item) => !isOperationalTaskLine(`${item.problemTitle} ${item.assessmentSummary}`))
    .map((item) => {
      const source = [
        item.problemTitle,
        item.assessmentSummary,
        ...item.evidenceOrCourseItems,
        ...item.planItems,
      ].join(" ");
      return {
        item,
        score: assessmentImportanceScore(source, item.isImportant),
      };
    });

  return scoredItems
    .filter((entry) => entry.score >= 8)
    .sort((a, b) => b.score - a.score || a.item.order - b.item.order)
    .slice(0, maxItems)
    .map(({ item }) => assessmentItemLine(item))
    .filter(Boolean)
    .join("\n");
}

function taskSummaryText(patient: Patient, hideCompleted: boolean, maxItems: number, maxChars: number) {
  const tasks = hideCompleted ? patient.tasks.filter((task) => !task.done) : patient.tasks;
  const sortedTasks = [...tasks].sort((a, b) => {
    const priority = { urgent: 0, normal: 1, low: 2 };
    return priority[a.priority] - priority[b.priority];
  });
  const orderLines = clinicalItems(patient.vsOrder).map((line) => `Order: ${shortDigestText(line, maxChars)}`);
  const taskLines = sortedTasks.map((task) => {
    const text = task.text.trim().startsWith("!") ? task.text.trim().slice(1).trim() : task.text;
    return `${task.priority === "urgent" ? "! " : ""}${shortDigestText(text, maxChars)}${task.dueDate ? ` (${task.dueDate})` : ""}`;
  });
  return uniqueLines([...orderLines, ...taskLines])
    .slice(0, maxItems)
    .filter(Boolean)
    .join("\n");
}

function redFlagText(patient: Patient, maxItems: number, maxChars: number) {
  return compactList(clinicalItems(patient.importantRedFlags), maxItems, maxChars);
}

function subjectiveText(patient: Patient, maxItems: number, maxChars: number) {
  const subjective = compactPriorityText(patient.subjectiveOrChiefConcern, maxItems, maxChars);
  const overnight = compactPriorityText(patient.overnightEvent, maxItems, maxChars);
  return [overnight ? `ON: ${overnight}` : "", subjective ? `S: ${subjective}` : ""].filter(Boolean).join("\n");
}

function dischargeText(patient: Patient, maxChars: number) {
  const pending = pendingDischargePrep(patient);
  return [
    patient.dischargeTargetDate ? `Target: ${patient.dischargeTargetDate}` : "",
    pending.length > 0 ? `Pending: ${pending.join("/")}` : "",
    compactText(patient.dischargePlan, 1, maxChars),
    patient.dischargeBarriers ? `Barrier: ${shortDigestText(patient.dischargeBarriers, maxChars)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getRoundingDigest(
  patient: Patient,
  notes: DailyNote[] = [],
  options: DigestOptions = {},
): RoundingDigest {
  const mode = options.mode ?? "board";
  const limits = digestLimits(mode);
  const lab = labFocusText(patient, notes, mode);
  const diagnosis = diagnosisSummary(patient, limits.diagnosis, limits.detailChars);
  const risks = riskSummary(patient, limits.risks, limits.chars);
  const issues = issueSummary(patient, limits.issues, limits.chars);
  const redFlags = redFlagText(patient, limits.redFlags, limits.detailChars);
  const subjective = subjectiveText(patient, limits.subjective, limits.detailChars);
  const objective = objectiveSummaryText(patient, limits.objective, limits.detailChars);
  const image = imageSummaryText(patient, limits.images, limits.detailChars);
  const assessmentPlan = assessmentPlanSummaryText(patient, limits.ap, limits.detailChars);
  const tasks = taskSummaryText(patient, options.hideCompletedTasks ?? true, limits.tasks, limits.detailChars);
  const discharge = dischargeText(patient, limits.detailChars);
  const urgentTasks = patient.tasks
    .filter((task) => !task.done && (task.priority === "urgent" || task.text.trim().startsWith("!")))
    .slice(0, 2)
    .map((task) => shortDigestText(task.text.replace(/^!+/, "").trim(), limits.detailChars));
  const vitalSignals = [
    importantObjectiveText(patient.vitalSigns, limits.detailChars, 1),
    importantObjectiveText(patient.bloodSugar, limits.detailChars, 1),
  ].filter(Boolean);
  const subjectiveSignals = topSubjectiveSignals(patient, 1, limits.detailChars).map((line) => `S: ${line}`);
  const labSignals = lab.labFocus.critical.map((line) => `Lab: ${line}`);
  const assessmentLines = assessmentPlan.split(/\n|;/).map((line) => line.trim()).filter(Boolean).slice(0, 2);
  const urgentAssessmentLines = assessmentLines
    .filter((line) => /ais|acute stroke|stroke|tia|ich|sepsis|shock|acs|stemi|nstemi|resp failure|hypox|desat|bleed|hb drop|aki/i.test(line))
    .map((line) => `A/P: ${line}`);
  const urgentLines = uniqueLines([
    ...clinicalItems(redFlags),
    ...subjectiveSignals,
    ...vitalSignals,
    ...urgentTasks,
    ...labSignals,
    ...urgentAssessmentLines,
  ]).slice(0, limits.urgent);
  const attendingSummary = uniqueLines([
    diagnosis ? `Dx: ${diagnosis}` : "",
    issues ? `Issues: ${issues}` : "",
    subjective,
    lab.text,
    ...assessmentLines.map((line) => `A/P: ${line}`),
  ])
    .slice(0, mode === "rounds" ? 5 : 4)
    .join("\n");

  return {
    diagnosis,
    risks,
    issues,
    redFlags,
    subjective,
    objective,
    lab: lab.text,
    image,
    assessmentPlan,
    tasks,
    discharge,
    urgentLines,
    attendingSummary,
  };
}
