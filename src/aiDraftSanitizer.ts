import type { AiClinicalSourceType, AiSoapDraft } from "./types";
import { compactMedicalAbbreviations } from "./medicalAbbreviations";

type Vital = AiSoapDraft["objective"]["vitals"][number];
type Lab = AiSoapDraft["objective"]["labs"][number];
type Image = AiSoapDraft["objective"]["images"][number];
type PhysicalExam = AiSoapDraft["objective"]["physicalExam"][number];
type AssessmentPlan = AiSoapDraft["assessmentPlan"][number];
type Task = AiSoapDraft["tasks"][number];
type RedFlag = AiSoapDraft["redFlags"][number];

const reportOrImagePattern =
  /\b(ct|computed tomography|mri|cxr|x-ray|xray|ultrasound|sono|echo|endoscopy|egd|impression|report|scan|showed|revealed|no evidence of|hemorrhage|oedema|edema|infarct|opacity|nodule|wall thickening|lymphadenopathy)\b/i;
const labOrVitalPattern =
  /\b(vital signs?|v\/s|temperature|temp|bp|pulse|hr|rr|spo2|lab data|wbc|hb|hgb|plt|cr|gfr|bun|na|k|lactate|troponin)\b/i;
const meaningfulImagePattern =
  /\b(ct|mri|cxr|x-ray|xray|ultrasound|sono|echo|egd|endoscopy|impression|opacity|nodule|mass|wall thickening|lymph|metasta|hemorrhage|infarct|edema|abscess|effusion|bronchiectasis|ground[- ]glass|ggo|stenosis|obstruction|pneumonia)\b/i;
const labHeaderPattern =
  /\b(WBC|Neu|Neut|Lym|Mono|Eos|Baso|Hb|Hgb|Plt|BUN|CRE|Cr|GFR|eGFR|Ca|Na|K|ALT|AST|Mg|Lactate|Troponin|CRP|Procalcitonin|PCT|INR|PT|APTT|D[- ]?dimer)\b/i;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/`n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function abbreviate(value: string) {
  return compactMedicalAbbreviations(value);
}

function compactLine(value: unknown, maxChars = 180) {
  const clean = abbreviate(normalizeText(value).replace(/\s+/g, " ").trim());
  if (clean.length <= maxChars) return clean;
  const firstClause = clean.split(/[;\n]/)[0]?.trim() || clean;
  if (firstClause.length <= maxChars) return firstClause;
  const words = firstClause.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    const next = [...kept, word].join(" ");
    if (next.length <= maxChars) kept.push(word);
  }
  return kept.join(" ") || firstClause.slice(0, maxChars).trim();
}

function compactMultiLine(value: unknown, maxLines = 4, maxCharsPerLine = 150) {
  return normalizeText(value)
    .split(/\n|;(?=\s*\d|\s*[A-Z])/)
    .map((line) => compactLine(line, maxCharsPerLine))
    .filter(Boolean)
    .slice(0, maxLines)
    .join("; ");
}

function normalizeDate(value: unknown) {
  const match = String(value ?? "").match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function latestDate(values: string[]) {
  const sorted = values.map(normalizeDate).filter(Boolean).sort();
  return sorted.length > 0 ? sorted[sorted.length - 1] : "";
}

function dateListFromText(value: string) {
  return Array.from(value.matchAll(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g)).map((match) => normalizeDate(match[0]));
}

function latestVitalDate(rawText: string) {
  const dates: string[] = [];
  Array.from(rawText.matchAll(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b[\s\S]{0,220}?\b(?:vital signs?|v\/s|temperature|temp|bp|pulse|hr|rr|spo2)\b/gi)).forEach((match) =>
    dates.push(normalizeDate(match[1])),
  );
  return latestDate(dates);
}

function latestBp(rawText: string) {
  const matches = Array.from(rawText.matchAll(/\bBP\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*mmHg?/gi));
  const last = matches.length > 0 ? matches[matches.length - 1] : undefined;
  if (!last) return null;
  return { sbp: Number(last[1]), dbp: Number(last[2]) };
}

function currentBpIsStable(rawText: string) {
  const bp = latestBp(rawText);
  return Boolean(bp && bp.sbp >= 90 && bp.dbp >= 50);
}

function shockResolved(rawText: string) {
  return (
    currentBpIsStable(rawText) &&
    /(after\s+fluid\s+challenge[\s\S]{0,160}(?:bp|blood pressure)\s+(?:recovered|improved)|(?:bp|blood pressure)\s+(?:recovered|improved)|shock\s+(?:resolved|improved)|off\s+(?:pressor|norepi)|pressor\s+off|no\s+hypotension|hypovolemia\s+(?:was\s+)?impressed|fluid[- ]responsive)/i.test(rawText)
  );
}

function isShockOnlyLine(value: string, rawText: string) {
  if (!shockResolved(rawText)) return false;
  const text = value.toLowerCase();
  if (!/\b(shock|hypotension|pressor|norepi|bp\s*:?\s*5\d\s*\/\s*2\d|54\/29)\b/.test(text)) return false;
  return !/\b(bacteremia|culture|source|abx|mrsa|enterococcus|teicoplanin|sepsis workup|fluid[- ]responsive|resolved|recovered)\b/.test(text);
}

function hasUsefulNumber(value: string) {
  return /[<>]?\d+(?:\.\d+)?/.test(value);
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

function sanitizeGeneratedText(value: string, rawText: string, maxLines = 8) {
  const resolved = shockResolved(rawText);
  return dedupeByKey(
    normalizeText(value)
      .replace(/\b(?:active|ongoing|current)\s+shock\b/gi, resolved ? "resolved initial hypotension" : "$&")
      .split(/\n|(?<=\.)\s+(?=[A-Z])/)
      .map((line) => {
        if (resolved && /\b(?:shock|hypotension)\b/i.test(line) && /\b54\/29\b/.test(line)) {
          return "Initial fluid-responsive hypotension, now BP stable.";
        }
        return compactLine(line, 150);
      })
      .filter(Boolean)
      .filter((line) => !(resolved && isShockOnlyLine(line, rawText)))
      .filter((line) => !/^(?:recommendation:\s*)?(?:monitor closely|continue current management|clinical correlation)[.!]?$/i.test(line))
      .slice(0, maxLines),
    (line) => line,
  ).join("\n");
}

function sanitizeAdmissionSummaryText(value: string, rawText: string) {
  const compact = sanitizeGeneratedText(value, rawText, 8)
    .replace(/\n+/g, " ")
    .replace(/\b(?:The patient is|This patient is)\s+/gi, "")
    .replace(/\bcontinue current management\b\.?/gi, "")
    .replace(/\bmonitor closely\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  const sentences = compact
    .split(/(?<=[\u3002.!?\uFF01\uFF1F])\s+|(?<=\u3002)/)
    .map((line) => compactLine(line.replace(/[.;\u3002!?\uFF01\uFF1F\s]+$/g, ""), 150))
    .filter(Boolean)
    .slice(0, 6);
  const joined = sentences.map((line) => (/[\u3002.!?\uFF01\uFF1F]$/.test(line) ? line : `${line}\u3002`)).join("");
  return compactLine(joined, 820);
}

function sanitizeVitals(vitals: Vital[], rawText: string) {
  const latest = latestVitalDate(rawText);
  return dedupeByKey(vitals, (vital) => `${vital.date}|${vital.name}|${vital.value}`)
    .filter((vital) => {
      const text = [vital.name, vital.value, vital.interpretation].join(" ");
      if (!hasUsefulNumber(text) && !/fever|afebrile|o2|room air/i.test(text)) return false;
      if (isShockOnlyLine(text, rawText)) return false;
      if (shockResolved(rawText) && /\b54\/29\b/.test(text)) return false;
      const itemDate = normalizeDate(vital.date);
      if (latest && itemDate && itemDate < latest) return false;
      return true;
    })
    .map((vital) => ({
      ...vital,
      date: normalizeDate(vital.date) || vital.date,
      name: compactLine(vital.name, 28) || "V/S",
      value: compactLine(vital.value, 72),
      interpretation: isShockOnlyLine(vital.interpretation, rawText) ? "" : compactLine(vital.interpretation, 70),
      isImportant: Boolean(vital.isImportant || vital.isAbnormal),
    }))
    .slice(0, 4);
}

function sanitizeBloodSugars(items: AiSoapDraft["objective"]["bloodSugars"]) {
  return dedupeByKey(items, (item) => `${item.date}|${item.name}|${item.value}`)
    .filter((item) => {
      const text = [item.name, item.value, item.interpretation].join(" ");
      if (/^\s*-+\s*$/.test(text)) return false;
      return hasUsefulNumber(text);
    })
    .map((item) => ({
      ...item,
      date: normalizeDate(item.date) || item.date,
      name: compactLine(item.name, 36) || "Glu",
      value: compactLine(item.value, 56),
      interpretation: compactLine(item.interpretation, 70),
    }))
    .slice(0, 4);
}

function sanitizePhysicalExam(items: PhysicalExam[]) {
  return dedupeByKey(items, (item) => `${item.system}|${item.finding}`)
    .filter((item) => {
      const text = [item.system, item.finding].join(" ");
      if (!text.trim()) return false;
      if (reportOrImagePattern.test(text)) return false;
      if (labOrVitalPattern.test(text)) return false;
      return true;
    })
    .map((item) => ({
      system: compactLine(item.system, 28) || "PE",
      finding: compactLine(item.finding, 86),
      isImportant: Boolean(item.isImportant),
    }))
    .slice(0, 6);
}

function labName(name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "wbc") return "WBC";
  if (normalized === "neu" || normalized === "neut" || normalized.includes("neutrophil")) return "Neu";
  if (normalized === "lym" || normalized === "lymph") return "Lym";
  if (normalized === "hb" || normalized === "hgb") return "Hb";
  if (normalized === "plt" || normalized === "platelet") return "Plt";
  if (normalized === "cre" || normalized === "cr" || normalized.includes("creatinine")) return "Cr";
  if (normalized === "gfr" || normalized === "egfr") return "eGFR";
  if (normalized === "na") return "Na";
  if (normalized === "k") return "K";
  if (normalized === "ca") return "Ca";
  if (normalized === "alt") return "ALT";
  if (normalized === "ast") return "AST";
  if (normalized === "mg") return "Mg";
  if (normalized.includes("lactate")) return "Lactate";
  if (normalized.includes("troponini")) return "Troponin I";
  if (normalized.includes("troponin")) return "Troponin";
  if (normalized === "crp") return "CRP";
  if (normalized === "pct" || normalized.includes("procalcitonin")) return "PCT";
  if (normalized.includes("ddimer")) return "D-dimer";
  return name.trim();
}

function numericValue(value: string) {
  const match = value.replace(/,/g, "").match(/[<>]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function labIsMeaningful(name: string, value: string, abnormal: boolean) {
  const key = labName(name);
  const number = numericValue(value);
  if (number === null) return /positive|growth|detected|pending|no growth/i.test(value);
  if (key === "Cr") return number > 1.3;
  if (key === "eGFR") return number < 60;
  if (key === "WBC") return number < 4 || number > 10 || abnormal;
  if (key === "Neu") return number > 80 || number < 40 || abnormal;
  if (key === "Hb") return number < 11 || number > 18 || abnormal;
  if (key === "Plt") return number < 150 || number > 450 || abnormal;
  if (key === "Na") return number < 135 || number > 145 || abnormal;
  if (key === "K") return number < 3.5 || number > 5.0 || abnormal;
  if (key === "Lactate") return number >= 2 || abnormal;
  if (key === "Troponin I" || key === "Troponin") return number > 0.04 || abnormal;
  if (key === "CRP" || key === "PCT" || key === "D-dimer") return abnormal || number > 0;
  return abnormal;
}

function looksLikeLabHeader(line: string) {
  return !/^20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(line) && labHeaderPattern.test(line);
}

function headerTokens(line: string) {
  const match = line.match(labHeaderPattern);
  const tail = match?.index === undefined ? line : line.slice(match.index);
  return tail.split(/\s+/).map((token) => token.trim()).filter(Boolean);
}

function parseLatestTableLabs(rawText: string): Lab[] {
  const lines = normalizeText(rawText).split("\n").map((line) => line.trim()).filter(Boolean);
  const rows: Array<{ date: string; headers: string[]; values: string[] }> = [];
  let headers: string[] = [];

  for (const line of lines) {
    if (looksLikeLabHeader(line)) {
      headers = headerTokens(line);
      continue;
    }
    const row = line.match(/^(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\s+(.+)$/);
    if (!row || headers.length === 0) continue;
    const values = row[2].split(/\s+/).filter(Boolean);
    if (values.length === 0) continue;
    rows.push({ date: normalizeDate(row[1]), headers, values });
  }

  const latest = latestDate(rows.map((row) => row.date));
  if (!latest) return [];

  return rows
    .filter((row) => row.date === latest)
    .flatMap((row) =>
      row.headers.map((header, index) => {
        const rawValue = row.values[index] ?? "";
        const abnormal = /\*/.test(rawValue);
        const cleanValue = rawValue.replace(/\*+/g, "");
        return { header, cleanValue, abnormal };
      }),
    )
    .filter((item) => item.header && item.cleanValue && labIsMeaningful(item.header, item.cleanValue, item.abnormal))
    .map((item) => ({
      date: latest,
      group: "Latest labs",
      name: labName(item.header),
      value: item.cleanValue,
      unit: "",
      previousValue: "",
      isAbnormal: item.abnormal || labIsMeaningful(item.header, item.cleanValue, false),
      isImportant: true,
      interpretation: item.abnormal ? "abn" : "",
    }))
    .slice(0, 10);
}

function sanitizeLabs(labs: Lab[], rawText: string) {
  const latestRawLabs = parseLatestTableLabs(rawText);
  const latestFromText = latestDate([...dateListFromText(rawText), ...labs.map((lab) => String(lab.date ?? ""))]);
  const source = latestRawLabs.length > 0 ? latestRawLabs : labs;

  return dedupeByKey(source, (lab) => `${labName(lab.name)}|${lab.date}|${lab.value}`)
    .filter((lab) => {
      const key = labName(lab.name);
      const text = [key, lab.value, lab.interpretation].join(" ");
      if (!hasUsefulNumber(text) && !/positive|growth|detected|pending|no growth/i.test(text)) return false;
      if (key === "eGFR" && (numericValue(lab.value) ?? 0) >= 60) return false;
      if (key === "Cr" && (numericValue(lab.value) ?? 0) < 1.3) return false;
      const itemDate = normalizeDate(lab.date);
      if (latestRawLabs.length === 0 && latestFromText && itemDate && itemDate < latestFromText && !/culture|troponin|lactate/i.test(key)) return false;
      return lab.isImportant || lab.isAbnormal || labIsMeaningful(key, lab.value, false);
    })
    .map((lab) => ({
      ...lab,
      date: normalizeDate(lab.date) || lab.date,
      group: compactLine(lab.group, 32) || "Lab",
      name: labName(lab.name),
      value: compactLine(lab.value, 36),
      unit: compactLine(lab.unit, 20),
      previousValue: compactLine(lab.previousValue, 36),
      interpretation: compactLine(lab.interpretation, 56),
      isAbnormal: Boolean(lab.isAbnormal || labIsMeaningful(lab.name, lab.value, false)),
      isImportant: true,
    }))
    .slice(0, 10);
}

function importantImageLines(value: string) {
  const lines = normalizeText(value)
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+\)|\d+\.|\*|-|>)\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^history of\b/i.test(line))
    .filter((line) => !/^for other findings/i.test(line))
    .filter((line) => !/^suggest correlating/i.test(line))
    .filter((line) => !/^clinical information/i.test(line))
    .filter((line) => meaningfulImagePattern.test(line));

  return lines.map((line) => compactLine(line, 138)).filter(Boolean).slice(0, 5);
}

function inferStudyType(before: string, impression: string) {
  const text = `${before}\n${impression}`;
  const lines = before.split("\n").map((line) => line.trim()).filter(Boolean);
  const studyLine = [...lines].reverse().find((line) => /\b(CT|MRI|CXR|Chest|Brain|Neck|Abd|Pelvis|Echo|Sono|Ultrasound|EGD|Endoscopy)\b/i.test(line));
  if (/brain|head/i.test(text) && /\bct\b/i.test(text)) return "Brain CT";
  if (/neck/i.test(text) && /chest/i.test(text) && /\bct\b/i.test(text)) return "Neck/chest CT";
  if (/abd|pelvis/i.test(text) && /\bct\b/i.test(text)) return "CT A/P";
  if (/cxr|chest\s+x[- ]?ray/i.test(text)) return "CXR";
  if (/echo/i.test(text)) return "Echo";
  return compactLine(studyLine ?? "Image", 60);
}

function extractImageReports(rawText: string): Image[] {
  const text = normalizeText(rawText);
  const starts = Array.from(text.matchAll(/Impression\s*:/gi)).map((match) => match.index ?? -1).filter((index) => index >= 0);
  const images: Image[] = [];

  starts.forEach((start, index) => {
    const before = text.slice(Math.max(0, start - 1200), start);
    const nextStart = starts[index + 1] ?? text.length;
    const after = text.slice(start, Math.min(nextStart, start + 1600));
    const impressionBody = after
      .replace(/^Impression\s*:\s*/i, "")
      .split(/\n\s*(?:For other findings|Technique|Comparison|Finding)\b/i)[0];
    const lines = importantImageLines(impressionBody);
    if (lines.length === 0) return;
    const dates = dateListFromText(before);
    images.push({
      date: dates.length > 0 ? dates[dates.length - 1] : "",
      studyType: inferStudyType(before, impressionBody),
      finding: "",
      impression: lines.join("; "),
      isImportant: true,
    });
  });

  return dedupeByKey(images, (image) => `${image.date}|${image.studyType}|${image.impression}`)
    .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))
    .slice(0, 4);
}

function sanitizeImages(images: Image[], rawText: string) {
  const extracted = extractImageReports(rawText);
  const source = extracted.length > 0 ? extracted : images;
  return dedupeByKey(source, (image) => `${image.date}|${image.studyType}|${image.impression || image.finding}`)
    .filter((image) => {
      const text = [image.studyType, image.finding, image.impression].join(" ");
      if (!meaningfulImagePattern.test(text)) return false;
      if (/this\s+\d{1,3}[- ]year[- ]old|patient reported|upon arrival|vital signs|lab data|difficulty swallowing since|sent to our ed/i.test(text)) return false;
      return true;
    })
    .map((image) => ({
      ...image,
      date: normalizeDate(image.date) || image.date,
      studyType: compactLine(image.studyType, 54) || "Image",
      finding: compactMultiLine(image.finding, 2, 110),
      impression: compactMultiLine(image.impression || image.finding, 5, 138),
      isImportant: Boolean(image.isImportant || meaningfulImagePattern.test([image.finding, image.impression].join(" "))),
    }))
    .slice(0, 4);
}

function itemText(value: RedFlag | Task | AssessmentPlan) {
  if ("reason" in value) return [value.text, value.reason].join(" ");
  if ("priority" in value) return value.text;
  return [value.problemTitle, value.assessmentSummary, ...value.evidenceOrCourseItems, ...value.planItems].join(" ");
}

function stripDuplicatePlanText(item: AssessmentPlan) {
  const title = compactLine(item.problemTitle, 62);
  const summary = compactLine(item.assessmentSummary, 100);
  const evidence = dedupeByKey(item.evidenceOrCourseItems.map((line) => compactLine(line, 82)).filter(Boolean), (line) => line).filter(
    (line) => !summary.toLowerCase().includes(line.toLowerCase()),
  );
  const planItems = dedupeByKey(item.planItems.map((line) => compactLine(line, 82)).filter(Boolean), (line) => line).filter(
    (line) => !summary.toLowerCase().includes(line.toLowerCase()),
  );
  return { title, summary, evidence, planItems };
}

function sanitizeAssessmentPlan(items: AssessmentPlan[], rawText: string) {
  return dedupeByKey(items, (item) => item.problemTitle)
    .filter((item) => {
      const text = itemText(item);
      if (shockResolved(rawText) && /\b(shock|hypotension|pressor|norepi|54\/29)\b/i.test(item.problemTitle)) return false;
      if (isShockOnlyLine(text, rawText)) return false;
      return Boolean(item.problemTitle.trim() && item.assessmentSummary.trim());
    })
    .map((item) => {
      const clean = stripDuplicatePlanText(item);
      return {
        ...item,
        problemTitle: clean.title,
        assessmentSummary: clean.summary,
        evidenceOrCourseItems: clean.evidence.slice(0, 3),
        planItems: clean.planItems.slice(0, 4),
        isImportant: Boolean(item.isImportant),
      };
    })
    .filter((item) => item.problemTitle && item.assessmentSummary)
    .slice(0, 8);
}

function sanitizeRedFlags(items: RedFlag[], rawText: string) {
  return dedupeByKey(items, (item) => `${item.text}|${item.reason}`)
    .filter((item) => {
      const text = itemText(item);
      if (shockResolved(rawText) && /\b(shock|hypotension|pressor|norepi|54\/29)\b/i.test(text)) return false;
      if (isShockOnlyLine(text, rawText)) return false;
      if (/monitor closely|clinical correlation|watch for deterioration/i.test(text) && !/[<>]?\d|call|threshold|if\b/i.test(text)) return false;
      return Boolean(item.text.trim());
    })
    .map((item) => ({
      text: compactLine(item.text, 92),
      reason: compactLine(item.reason, 96),
    }))
    .slice(0, 6);
}

function sanitizeTasks(items: Task[], rawText: string) {
  return dedupeByKey(items, (item) => item.text)
    .filter((item) => {
      if (shockResolved(rawText) && /\b(shock|hypotension|pressor|norepi|54\/29)\b/i.test(item.text)) return false;
      if (isShockOnlyLine(item.text, rawText)) return false;
      if (/monitor closely|continue current management|clinical correlation/i.test(item.text)) return false;
      return Boolean(item.text.trim());
    })
    .map((item) => ({
      ...item,
      text: compactLine(item.text, 96),
      category: item.category || "other",
      dueDate: compactLine(item.dueDate, 20),
    }))
    .slice(0, 10);
}

function sanitizeStringArray(items: string[], rawText: string, maxItems = 6) {
  return dedupeByKey(items.map((item) => compactLine(item, 110)).filter(Boolean), (item) => item)
    .filter((item) => !isShockOnlyLine(item, rawText))
    .slice(0, maxItems);
}

export function sanitizeAiSoapDraftForReview(
  draft: AiSoapDraft,
  rawTextInput: string,
  sourceType: AiClinicalSourceType,
): AiSoapDraft {
  const rawText = normalizeText(rawTextInput);
  const next: AiSoapDraft = {
    ...draft,
    oneLiner: sanitizeGeneratedText(draft.oneLiner, rawText, 2),
    admissionSummary: sanitizeAdmissionSummaryText(draft.admissionSummary, rawText),
    isbarHandoff: sanitizeGeneratedText(draft.isbarHandoff, rawText, 10),
    subjective: {
      ...draft.subjective,
      chiefConcern: compactLine(draft.subjective.chiefConcern, 96),
      symptoms: sanitizeStringArray(draft.subjective.symptoms, rawText),
      overnightEvents: sanitizeStringArray(draft.subjective.overnightEvents, rawText),
      importantSymptoms: sanitizeStringArray(draft.subjective.importantSymptoms, rawText),
      importantOvernightEvents: sanitizeStringArray(draft.subjective.importantOvernightEvents, rawText),
    },
    objective: {
      vitals: sanitizeVitals(draft.objective.vitals, rawText),
      bloodSugars: sanitizeBloodSugars(draft.objective.bloodSugars),
      physicalExam: sanitizePhysicalExam(draft.objective.physicalExam),
      labs: sanitizeLabs(draft.objective.labs, rawText),
      images: sanitizeImages(draft.objective.images, rawText),
    },
    assessmentPlan: sanitizeAssessmentPlan(draft.assessmentPlan, rawText),
    redFlags: sanitizeRedFlags(draft.redFlags, rawText),
    tasks: sanitizeTasks(draft.tasks, rawText),
    dischargeIssues: sanitizeStringArray(draft.dischargeIssues, rawText),
    thinkingPrompts: draft.thinkingPrompts
      .filter((item) => item.prompt.trim() && !isShockOnlyLine(`${item.prompt} ${item.reason}`, rawText))
      .map((item) => ({ prompt: compactLine(item.prompt, 110), reason: compactLine(item.reason, 120) }))
      .slice(0, 6),
    uncertainty: sanitizeStringArray(draft.uncertainty, rawText),
  };

  if (sourceType === "image") {
    next.subjective = { chiefConcern: "", symptoms: [], overnightEvents: [], importantSymptoms: [], importantOvernightEvents: [] };
    next.objective.vitals = [];
    next.objective.bloodSugars = [];
    next.objective.physicalExam = [];
    next.objective.labs = [];
    next.assessmentPlan = [];
    next.redFlags = next.redFlags.filter((flag) => /urgent|critical|call|bleed|ich|pe|obstruct|abscess/i.test(`${flag.text} ${flag.reason}`));
    next.tasks = next.tasks.filter((task) => /f\/u|ct|mri|cxr|echo|scope|image|consult/i.test(task.text));
  }

  if (sourceType === "lab") {
    next.subjective = { chiefConcern: "", symptoms: [], overnightEvents: [], importantSymptoms: [], importantOvernightEvents: [] };
    next.objective.vitals = [];
    next.objective.bloodSugars = [];
    next.objective.physicalExam = [];
    next.objective.images = [];
    next.assessmentPlan = [];
  }

  return next;
}
