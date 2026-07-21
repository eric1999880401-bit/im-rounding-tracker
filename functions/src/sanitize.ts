// Input/output sanitization, filler filtering, and vague-plan concretization.
// Extracted from index.ts (Phase 3 refactor).
// Keep the filler phrase list and concretizer map in sync with src/aiPostprocess/ in the web app.
import type { CallableInput, ExistingPatientForBatch, PatientBatchImportMode } from "./types";
import { taskCategories } from "./types";

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

export function sanitizePatientContext(input: CallableInput["patientContext"]) {
  if (!input || typeof input !== "object") return undefined;

  return {
    age: String(input.age ?? "").trim(),
    sex: String(input.sex ?? "").trim(),
    pmh: asStringArray(input.pmh),
    activeProblems: asStringArray(input.activeProblems),
    labFacts: asStringArray(input.labFacts).slice(0, 100).map((value) => value.slice(0, 240)),
  };
}

export function sanitizeUserStyleProfile(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const allowedTerms = new Set([
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
  ]);
  const taskStyle = String(source.taskStyle ?? "concise");
  const apVoice = String(source.apVoice ?? "terse");
  const apOrganization = String(source.apOrganization ?? "problemStatusPlan");
  const abbreviationStyle = String(source.abbreviationStyle ?? "moderate");
  const allowedCorrectionRules = new Set([
    "mergeActionOnlyAp",
    "singleTreatmentOwner",
    "interpretObjectiveInAp",
    "separateTasksOrdersDc",
    "preserveReviewedApTitles",
    "addSourceBackedProblems",
    "preserveReviewedOrders",
    "preferSparseTasks",
    "preferConciseAp",
    "retainDecisiveEvidence",
  ]);
  const correctionConfidence = String(source.correctionConfidence ?? "none");
  return {
    styleSummary: asStringArray(source.styleSummary).slice(0, 10),
    apVoice: ["terse", "balanced", "descriptive"].includes(apVoice) ? apVoice : "terse",
    apOrganization: ["problemStatusPlan", "problemEvidencePlan", "problemPlan", "mixed"].includes(apOrganization) ? apOrganization : "problemStatusPlan",
    abbreviationStyle: ["minimal", "moderate", "heavy"].includes(abbreviationStyle) ? abbreviationStyle : "moderate",
    preferredTerms: asStringArray(source.preferredTerms).filter((term) => allowedTerms.has(term)).slice(0, 12),
    taskStyle: ["concise", "checklist", "detailed"].includes(taskStyle) ? taskStyle : "concise",
    sectionOrder: asStringArray(source.sectionOrder).filter((item) => ["Header", "S", "O", "A/P", "Orders", "Tasks", "DC"].includes(item)).slice(0, 7),
    typicalApProblemCount: Math.max(1, Math.min(8, Number(source.typicalApProblemCount ?? source.apProblemCount) || 4)),
    typicalApLineLimit: Math.max(1, Math.min(4, Number(source.typicalApLineLimit ?? source.apLineLimit) || 2)),
    correctionConfidence: ["none", "early", "established"].includes(correctionConfidence) ? correctionConfidence : "none",
    correctionRules: asStringArray(source.correctionRules).filter((rule) => allowedCorrectionRules.has(rule)).slice(0, 10),
    correctionTendencies: asStringArray(source.correctionTendencies).slice(0, 10),
    reviewedAiSaveCount: Math.max(0, Number(source.reviewedAiSaveCount) || 0),
  };
}

export function truncateString(value: unknown, maxChars = 1200) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxChars);
}

export function normalizeTextKey(value: string) {
  return value.toLowerCase().replace(/[\s#_\-.]/g, "").trim();
}

export function sanitizeExistingPatientsForBatch(value: unknown): ExistingPatientForBatch[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 200)
    .map((item) => asPlainObject(item))
    .map((item) => ({
      id: truncateString(item.id, 120),
      bed: truncateString(item.bed, 80),
      patientCode: truncateString(item.patientCode, 120),
      age: truncateString(item.age, 12),
      sex: truncateString(item.sex, 20),
      attending: truncateString(item.attending, 120),
      teamOrService: truncateString(item.teamOrService, 120),
      primaryDiagnosis: truncateString(item.primaryDiagnosis, 220),
      oneLiner: truncateString(item.oneLiner, 240),
      underlyingDiseases: truncateString(item.underlyingDiseases, 500),
      activeProblems: truncateString(item.activeProblems, 500),
    }))
    .filter((item) => item.id && (item.bed || item.patientCode));
}

export function sanitizePatientBatchImportMode(value: unknown): PatientBatchImportMode {
  return value === "newAdmission" ? "newAdmission" : "existingInpatient";
}

export function findTargetPatientForBatch(targetPatientId: unknown, existingPatients: ExistingPatientForBatch[]) {
  const targetId = truncateString(targetPatientId, 120);
  if (!targetId) return undefined;
  return existingPatients.find((patient) => patient.id === targetId);
}

export const vagueFollowUpVerbs = "(?:review|monitor|check|follow|trend|assess|watch|evaluate|track)";

export const vagueFollowUpRewrites: Array<[RegExp, string]> = [
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?(?:renal|kidney)\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u BUN/Cr, K"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?(?:liver|hepatic)\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u AST/ALT/T-bil, INR"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?electrolytes?\\b`, "gi"), "f/u Na/K/Ca/Mg/P"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?blood\\s+counts?\\b`, "gi"), "f/u CBC (Hb/WBC/Plt)"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?(?:blood\\s+sugars?|glycemic\\s+control)\\b`, "gi"), "f/u fingerstick glucose (AC/HS)"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?coagulation(?:\\s+profile)?\\b`, "gi"), "f/u PT/INR, aPTT"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?thyroid\\s+function(?:\\s+tests?)?\\b`, "gi"), "f/u TSH, fT4"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?(?:inflammatory|infection)\\s+markers?\\b`, "gi"), "f/u WBC/CRP"],
  [new RegExp(`\\b${vagueFollowUpVerbs}\\s+(?:the\\s+)?(?:oxygenation|respiratory)\\s+status\\b`, "gi"), "f/u SpO2/O2 demand, ABG if worsening"],
  // Interventions: convert bare treatment nouns into executable wording with a
  // decision parameter and response check. Never adds doses or new drugs.
  [/\b(?:iv|ivf|aggressive|adequate|maintain|give|encourage|keep)\s+hydration\b(?:\s+(?:therapy|status))?/gi, "IVF — clarify type/rate; recheck BP, UO"],
  [/\bhydration\s+therapy\b/gi, "IVF — clarify type/rate; recheck BP, UO"],
  [/^(\s*[-*!]?\s*)hydration\s*$/gim, "$1IVF — clarify type/rate; recheck BP, UO"],
  [/\bcorrect(?:ion\s+of)?\s+(?:the\s+)?electrolyte(?:\s+(?:imbalances?|abnormalit(?:y|ies)|derangements?))?s?\b/gi, "replete K/Mg/Ca as indicated; recheck lytes after repletion"],
  [/\b(?:optimize|improve|ensure|provide)\s+(?:adequate\s+)?pain\s+(?:control|management)\b/gi, "titrate analgesics; reassess pain score"],
  [/\b(?:optimize|manage|address)\s+(?:the\s+)?volume\s+status\b/gi, "adjust IVF/diuretic per exam; check I/O, daily weight"],
  [/\b(?:optimize|improve|ensure)\s+(?:the\s+)?glycemic\s+control\b/gi, "adjust insulin per fingerstick glucose (AC/HS)"],
];


// Collapses duplicated discharge-pending lines in the DC: section of a SOAP
// draft. The model tends to restate "meds/OPD/cert pending" in several
// phrasings; keep one line, preferring the checklist form with □ boxes.
export function collapseDischargePendingLines(soapText: string) {
  const lines = soapText.split("\n");
  let inDc = false;
  let keptPendingIndex = -1;
  const dropIndexes = new Set<number>();
  lines.forEach((line, index) => {
    if (/^DC\s*:/i.test(line.trim())) {
      inDc = true;
      return;
    }
    if (inDc && /^[A-Za-z/\u85e5\u56d1]+\s*:/.test(line.trim()) && !line.trim().startsWith("-") && !line.trim().startsWith("!")) {
      inDc = false;
    }
    if (!inDc) return;
    const clean = line.toLowerCase();
    const tokens = ["med", "opd", "cert"].filter((token) => clean.includes(token));
    if (tokens.length < 2) return;
    if (keptPendingIndex === -1) {
      keptPendingIndex = index;
      return;
    }
    const keptHasBoxes = lines[keptPendingIndex].includes("\u25a1");
    const currentHasBoxes = line.includes("\u25a1");
    if (currentHasBoxes && !keptHasBoxes) {
      dropIndexes.add(keptPendingIndex);
      keptPendingIndex = index;
    } else {
      dropIndexes.add(index);
    }
  });
  if (dropIndexes.size === 0) return soapText;
  return lines.filter((_, index) => !dropIndexes.has(index)).join("\n");
}

export function concretizeVagueFollowUps(value: string) {
  return vagueFollowUpRewrites.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}


// Lean-SOAP cleanups learned from the user's manual corrections: strip
// decision-deferral filler tails and drop A/P bullets that only restate a lab
// value already covered by a concrete bullet in the same problem.
// Keep in sync with src/aiPostprocess/soapLeanCleanup.ts in the web app.
const deferralTails = /(?:[,;]\s*)?\b(?:as ordered|per (?:the )?team(?:'s)? decision|per team|as clinically indicated|accordingly)\s*(?=[.;,)]|$)/gi;

export function stripDeferralTails(line: string) {
  const cleaned = line.replace(deferralTails, "");
  if (cleaned === line) return line;
  return cleaned
    .replace(/\s+([.;,)])/g, "$1")
    .replace(/[;,]\s*([.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[;,\s]+$/g, (tail) => (tail.includes(".") ? "." : ""))
    .trimEnd();
}

const labValuePattern = /\b(hb|hgb|wbc|plt|cr|bun|na|k|mg|ca|p|hs?crp|crp|lactate|inr|pt|aptt|t-?bil|bili|ast|alt|alb|glu(?:cose)?|hba1c|uo|tnt|trop(?:onin)?)\b[^0-9<>a-z]{0,10}([<>]?\d+(?:\.\d+)?)((?:\s*(?:->|→|to)\s*[<>]?\d+(?:\.\d+)?)*)/gi;

const vagueRemainderWords = new Set([
  "f/u", "fu", "follow", "followup", "follow-up", "trend", "trends", "trending", "monitor", "monitoring",
  "check", "recheck", "assess", "reassess", "watch", "track", "evaluate", "adjust", "avoid",
  "and", "or", "w", "w/", "with", "for", "of", "the", "a", "an", "on", "per", "if", "as", "to",
  "signs", "sign", "bleeding", "bleed", "transfusion", "threshold", "thresholds",
  "renal", "kidney", "uo", "urine", "output", "nephrotoxins", "nephrotoxic", "meds", "drugs",
  "team", "decision", "closely", "daily", "next", "draw", "labs", "lab", "values", "level", "levels",
  "clinical", "clinically", "status", "worsens", "worsening", "worsen", "improvement", "response",
  "symptomatic", "symptoms", "curve", "fever",
]);

function labPairs(line: string) {
  const pairs = new Set<string>();
  for (const match of line.matchAll(labValuePattern)) {
    const lab = match[1].toLowerCase().replace("hgb", "hb");
    pairs.add(`${lab}:${match[2].replace(/^[<>]/, "")}`);
    // Trend values ("Hb 7.6 -> 7.3") belong to the same lab.
    for (const trendValue of (match[3] ?? "").matchAll(/[<>]?(\d+(?:\.\d+)?)/g)) {
      pairs.add(`${lab}:${trendValue[1]}`);
    }
  }
  return pairs;
}

function isVagueRestatement(line: string) {
  const remainder = line
    .replace(labValuePattern, " ")
    .replace(/^[\s!*-]+/, "")
    .replace(/\bg\/dl|mg\/dl|meq\/l|mmol\/l|ml\/day|\/min|%\b/gi, " ")
    .replace(/->|→/g, " ");
  const words = remainder
    .toLowerCase()
    .replace(/\b([fwu])\/([usp])\b/g, "$1$2") // keep f/u, w/, u/o style shorthand as one word
    .split(/[\s,;./()]+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  if (words.some((word) => /\d/.test(word))) return false;
  return words.every((word) => vagueRemainderWords.has(word));
}

export function dropRestatedLabBullets(soapText: string) {
  const lines = soapText.split("\n");
  const drop = new Set<number>();
  let inAp = false;
  let blockStart = -1;

  const processBlock = (start: number, end: number) => {
    const bulletIndexes: number[] = [];
    for (let i = start; i < end; i += 1) {
      if (/^\s*[-!]/.test(lines[i])) bulletIndexes.push(i);
    }
    if (bulletIndexes.length < 2) return;
    for (const index of bulletIndexes) {
      const pairs = labPairs(lines[index]);
      if (pairs.size === 0 || !isVagueRestatement(lines[index])) continue;
      const covered = bulletIndexes.some(
        (other) =>
          other !== index &&
          !drop.has(other) &&
          [...pairs].every((pair) => labPairs(lines[other]).has(pair)),
      );
      if (covered) drop.add(index);
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^A\/?P\s*:/i.test(trimmed)) {
      inAp = true;
      blockStart = -1;
      return;
    }
    if (inAp && /^(?:S|O|Tasks?|DC|Orders?|藥囑)\s*:/i.test(trimmed)) {
      if (blockStart >= 0) processBlock(blockStart, index);
      inAp = false;
      blockStart = -1;
      return;
    }
    if (!inAp) return;
    if (trimmed.startsWith("#")) {
      if (blockStart >= 0) processBlock(blockStart, index);
      blockStart = index + 1;
    }
  });
  if (inAp && blockStart >= 0) processBlock(blockStart, lines.length);

  if (drop.size === 0) return soapText;
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}

export function leanSoapCleanup(soapText: string) {
  const deduped = collapseDischargePendingLines(dropRestatedLabBullets(soapText));
  return deduped
    .split("\n")
    .map((line) => stripDeferralTails(line))
    .join("\n");
}

export function isGenericClinicalFiller(value: string) {
  const clean = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!clean) return true;

  const hasConcreteTrigger =
    /\d|if\b|when\b|call\b|threshold|pending|f\/u|follow|repeat|hold|start|stop|resume|taper|consult|culture|lactate|troponin|\bk\b|\bcr\b|\bhb\b|o2|fio2|shock|bleed|fever|hypo|hyper|transfus/i.test(clean);
  if (hasConcreteTrigger) return false;

  return [
    "monitor closely",
    "continue to monitor",
    "close monitoring",
    "clinical correlation recommended",
    "follow clinically",
    "supportive care",
    "continue current management",
    "watch for deterioration",
    "no acute issue",
    "stable condition",
  ].some((phrase) => clean === phrase || clean.includes(phrase));
}


// Collapses duplicate PMH entries where the same disease appears as both the
// full name and its abbreviation (e.g. "diabetes mellitus" + "DM").
// Keep in sync with src/aiPostprocess/diseaseDedupe.ts in the web app.
const diseaseSynonyms: Array<[RegExp, string]> = [
  [/^(?:type\s*(?:2|ii)\s*)?diabetes(?:\s+mellitus)?(?:\s*type\s*(?:2|ii))?$|^t2dm$|^dm$|^type\s*(?:2|ii)\s*dm$|^dm\s*type\s*(?:2|ii)$/i, "dm"],
  [/^hypertension$|^htn$/i, "htn"],
  [/^hyperlipidemia$|^dyslipidemia$|^hld$/i, "hld"],
  [/^coronary artery disease$|^cad$/i, "cad"],
  [/^atrial fibrillation$|^af$|^a-?fib$/i, "af"],
  [/^chronic obstructive pulmonary disease$|^copd$/i, "copd"],
  [/^(?:congestive\s+)?heart failure$|^chf$|^hf$/i, "hf"],
  [/^chronic kidney disease(?:\s*,?\s*stage\s*[\w]+)?$|^ckd\s*[\w]*$/i, "ckd"],
  [/^end[-\s]stage renal disease$|^esrd$/i, "esrd"],
  [/^gastroesophageal reflux disease$|^gerd$/i, "gerd"],
  [/^benign prostatic hyperplasia$|^bph$/i, "bph"],
  [/^(?:old\s+)?(?:cerebrovascular accident|cva|stroke)$/i, "cva"],
  [/^transient ischemic attack$|^tia$/i, "tia"],
  [/^hypertensive cardiovascular disease$|^hcvd$/i, "hcvd"],
  [/^hepatitis b(?:\s+carrier)?$|^hbv(?:\s+carrier)?$/i, "hbv"],
  [/^hepatitis c$|^hcv$/i, "hcv"],
];

function diseaseKey(item: string) {
  const clean = item.trim().replace(/^and\s+/i, "").replace(/[.\u3002;\uff1b]+$/, "");
  for (const [pattern, key] of diseaseSynonyms) {
    if (pattern.test(clean)) return key;
  }
  return "";
}

function preferredDiseaseDuplicate(a: string, b: string) {
  const aInfo = /[\d()]/.test(a);
  const bInfo = /[\d()]/.test(b);
  if (aInfo !== bInfo) return aInfo ? a : b;
  return a.length <= b.length ? a : b;
}

export function dedupeDiseaseText(value: string) {
  if (!value.trim()) return value;
  const tokens = value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,\uff0c\u3001;\uff1b]/))
    .map((token) => token.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
  const kept: string[] = [];
  const byKey = new Map<string, number>();
  tokens.forEach((item) => {
    const key = diseaseKey(item);
    if (!key) {
      kept.push(item);
      return;
    }
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, kept.length);
      kept.push(item);
      return;
    }
    kept[existingIndex] = preferredDiseaseDuplicate(kept[existingIndex], item);
  });
  return kept.join(", ");
}

export function cleanClinicalLines(value: unknown, maxLines = 10, maxChars = 1400) {
  return truncateString(value, maxChars * 2)
    .split(/\r?\n|;(?=\s*[A-Z#]|\s*[\u4e00-\u9fff])/)
    .map((line) => concretizeVagueFollowUps(line.replace(/\s+/g, " ").trim()))
    .filter((line) => !isGenericClinicalFiller(line))
    .slice(0, maxLines)
    .join("\n")
    .slice(0, maxChars);
}

export function cleanClinicalArray(value: unknown, maxItems = 8, maxCharsPerItem = 180) {
  return asStringArray(value)
    .map((item) => concretizeVagueFollowUps(item.replace(/\s+/g, " ").trim()).slice(0, maxCharsPerItem))
    .filter((item) => !isGenericClinicalFiller(item))
    .slice(0, maxItems);
}

export function maxBloodPressureInText(value: string) {
  const matches = value.matchAll(/\b(?:bp|b\/p|sbp|blood pressure)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/gi);
  let maxSbp = 0;
  let maxDbp = 0;
  for (const match of matches) {
    maxSbp = Math.max(maxSbp, Number(match[1] ?? 0));
    maxDbp = Math.max(maxDbp, Number(match[2] ?? 0));
  }

  return { maxSbp, maxDbp };
}

export function shouldSuppressStrokeBpRedFlag(value: string) {
  const lower = value.toLowerCase();
  const hasStrokeContext = /\b(ais|ischemic stroke|acute stroke|cva|tia|nihss|thrombectomy|evt)\b/.test(lower);
  if (!hasStrokeContext) return false;

  const hasStrictBpException =
    /\b(tpa|alteplase|thrombolysis|post[-\s]?tpa|ich|intracranial hemorrhage|hemorrhagic stroke|aortic dissection|stemi|nstemi|acs|mi)\b/.test(
      lower,
    );
  if (hasStrictBpException) return false;

  const { maxSbp, maxDbp } = maxBloodPressureInText(value);
  return maxSbp > 0 && maxSbp < 220 && maxDbp < 120;
}

export function lineLooksLikeBpRedFlag(value: string) {
  return /bp|b\/p|sbp|dbp|hypertension|htn|blood pressure/i.test(value) &&
    /urgent|red flag|uncontrolled|severe|critical|call/i.test(value);
}

export function filterStrokePermissiveBpRedFlags(redFlags: string, allText: string) {
  if (!shouldSuppressStrokeBpRedFlag(allText)) return redFlags;

  return redFlags
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !lineLooksLikeBpRedFlag(line))
    .join("\n");
}

export function matchExistingPatient(
  draft: { bed: string; patientCode: string; matchPatientId: string },
  existingPatients: ExistingPatientForBatch[],
) {
  const modelMatch = existingPatients.find((patient) => patient.id && patient.id === draft.matchPatientId);
  if (modelMatch) return modelMatch;

  const bedKey = normalizeTextKey(draft.bed);
  const codeKey = normalizeTextKey(draft.patientCode);
  if (codeKey) {
    const codeMatch = existingPatients.find((patient) => normalizeTextKey(patient.patientCode) === codeKey);
    if (codeMatch) return codeMatch;
  }

  if (bedKey) {
    return existingPatients.find((patient) => normalizeTextKey(patient.bed) === bedKey);
  }

  return undefined;
}

export function sanitizeImportTask(value: unknown) {
  const item = asPlainObject(value);
  const text = truncateString(item.text, 180).replace(/\s+/g, " ").trim();
  if (isGenericClinicalFiller(text)) return null;

  const priority = item.priority === "urgent" || item.priority === "low" ? item.priority : "normal";
  const category = taskCategories.has(String(item.category ?? "")) ? String(item.category) : "other";
  return {
    text,
    priority,
    dueDate: truncateString(item.dueDate, 20),
    category,
  };
}

export function sanitizeImportDraft(
  value: unknown,
  index: number,
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  targetPatient?: ExistingPatientForBatch,
) {
  const item = asPlainObject(value);
  const tasks = Array.isArray(item.tasks)
    ? item.tasks.map((task) => sanitizeImportTask(task)).filter((task): task is NonNullable<typeof task> => Boolean(task))
    : [];
  const baseDraft = {
    id: truncateString(item.id, 120) || `import-${index + 1}`,
    status: item.status === "updateCandidate" ? "updateCandidate" : "new",
    matchPatientId: truncateString(item.matchPatientId, 120),
    sourceIndex: typeof item.sourceIndex === "number" ? item.sourceIndex : index,
    bed: truncateString(item.bed, 80),
    patientCode: truncateString(item.patientCode, 120),
    age: truncateString(item.age, 12),
    sex: item.sex === "M" || item.sex === "F" || item.sex === "Other" ? item.sex : "",
    attending: truncateString(item.attending, 120),
    teamOrService: truncateString(item.teamOrService, 120),
    primaryDiagnosis: truncateString(item.primaryDiagnosis, 240),
    oneLiner: truncateString(item.oneLiner, 300),
    chiefComplaint: truncateString(item.chiefComplaint, 240),
    todayUpdates: cleanClinicalLines(item.todayUpdates, 5, 700),
    vitalSigns: cleanClinicalLines(item.vitalSigns, 4, 500),
    physicalExam: cleanClinicalLines(item.physicalExam, 5, 700),
    labText: cleanClinicalLines(item.labText, 10, 1200),
    imageText: cleanClinicalLines(item.imageText, 8, 1000),
    admissionSummary: cleanClinicalLines(item.admissionSummary, 3, 420),
    underlyingDiseases: dedupeDiseaseText(cleanClinicalLines(item.underlyingDiseases, 8, 700)),
    activeProblems: cleanClinicalLines(item.activeProblems, 8, 900),
    hospitalCourseHighlights: cleanClinicalLines(item.hospitalCourseHighlights, 8, 900),
    importantRedFlags: cleanClinicalLines(item.importantRedFlags, 6, 700),
    tasks,
    antibioticsProceduresConsults: cleanClinicalArray(item.antibioticsProceduresConsults, 8, 160),
    dischargePlan: truncateString(item.dischargePlan, 350),
    disposition: truncateString(item.disposition, 220),
    uncertainty: cleanClinicalArray(item.uncertainty, 5, 180),
    sourceExcerpt: truncateString(item.sourceExcerpt, 700),
  };
  const allText = [
    rawText,
    baseDraft.primaryDiagnosis,
    baseDraft.oneLiner,
    baseDraft.todayUpdates,
    baseDraft.vitalSigns,
    baseDraft.physicalExam,
    baseDraft.labText,
    baseDraft.imageText,
    baseDraft.activeProblems,
    baseDraft.hospitalCourseHighlights,
    baseDraft.importantRedFlags,
  ].join("\n");
  const matchedPatient = targetPatient ?? matchExistingPatient(baseDraft, existingPatients);
  const uncertainty = targetPatient
    ? [
        ...baseDraft.uncertainty,
        "Target patient was selected by clinician; verify imported fields before saving.",
      ].slice(0, 6)
    : baseDraft.uncertainty;

  return {
    ...baseDraft,
    status: matchedPatient ? "updateCandidate" : baseDraft.status,
    matchPatientId: matchedPatient?.id ?? "",
    bed: baseDraft.bed || matchedPatient?.bed || "",
    patientCode: baseDraft.patientCode || matchedPatient?.patientCode || "",
    age: baseDraft.age || matchedPatient?.age || "",
    sex: baseDraft.sex || matchedPatient?.sex || "",
    attending: baseDraft.attending || matchedPatient?.attending || "",
    teamOrService: baseDraft.teamOrService || matchedPatient?.teamOrService || "",
    primaryDiagnosis: baseDraft.primaryDiagnosis || matchedPatient?.primaryDiagnosis || "",
    oneLiner: baseDraft.oneLiner || matchedPatient?.oneLiner || matchedPatient?.primaryDiagnosis || "",
    underlyingDiseases: baseDraft.underlyingDiseases || matchedPatient?.underlyingDiseases || "",
    activeProblems: baseDraft.activeProblems || matchedPatient?.activeProblems || "",
    importantRedFlags: filterStrokePermissiveBpRedFlags(baseDraft.importantRedFlags, allText),
    tasks: baseDraft.tasks.filter((task) => {
      if (!shouldSuppressStrokeBpRedFlag(allText)) return true;
      return !lineLooksLikeBpRedFlag(task.text);
    }),
    uncertainty,
  };
}

export function targetUpdateText(rawText: string) {
  const marker = "Pasted update/report for this target patient:";
  const markerIndex = rawText.indexOf(marker);
  return markerIndex >= 0 ? rawText.slice(markerIndex + marker.length).trim() : rawText;
}

export function fallbackTargetImportDraft(rawText: string, targetPatient: ExistingPatientForBatch) {
  const updateText = targetUpdateText(rawText);
  const reportLike = /\b(impression|report|ct|mri|cxr|echo|sono|ultrasound|x-ray|xray|image|imaging)\b/i.test(updateText);
  const labLike = /\b(lab|wbc|hb|hgb|plt|cr|bun|na|k|inr|pt|aptt|lactate|crp|pct|troponin|bnp|culture|vanco)\b/i.test(updateText);

  return {
    id: "target-update-1",
    status: "updateCandidate",
    matchPatientId: targetPatient.id,
    sourceIndex: 0,
    bed: targetPatient.bed,
    patientCode: targetPatient.patientCode,
    age: targetPatient.age,
    sex: targetPatient.sex,
    attending: targetPatient.attending,
    teamOrService: targetPatient.teamOrService,
    primaryDiagnosis: targetPatient.primaryDiagnosis,
    oneLiner: targetPatient.oneLiner || targetPatient.primaryDiagnosis,
    chiefComplaint: "",
    todayUpdates: reportLike || labLike ? "" : updateText.slice(0, 700),
    vitalSigns: "",
    physicalExam: "",
    labText: labLike ? updateText : "",
    imageText: reportLike ? updateText : "",
    admissionSummary: "",
    underlyingDiseases: targetPatient.underlyingDiseases,
    activeProblems: targetPatient.activeProblems,
    hospitalCourseHighlights: reportLike || labLike ? "" : updateText.slice(0, 700),
    importantRedFlags: "",
    tasks: [],
    antibioticsProceduresConsults: [],
    dischargePlan: "",
    disposition: "",
    uncertainty: ["AI returned no draft; this is a target-patient fallback for clinician review."],
    sourceExcerpt: updateText.slice(0, 700),
  };
}

export function sanitizePatientBatchOutput(
  value: unknown,
  rawText: string,
  existingPatients: ExistingPatientForBatch[],
  targetPatient?: ExistingPatientForBatch,
) {
  const output = asPlainObject(value);
  const rawDrafts = Array.isArray(output.drafts) ? output.drafts : [];
  const draftSource = rawDrafts.length > 0 ? rawDrafts : targetPatient ? [fallbackTargetImportDraft(rawText, targetPatient)] : [];
  return draftSource
    .slice(0, 40)
    .map((item, index) => sanitizeImportDraft(item, index, rawText, existingPatients, targetPatient))
    .filter((draft) => draft.bed || draft.patientCode || draft.primaryDiagnosis || draft.oneLiner || draft.admissionSummary);
}

export function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function compactPatientContext(data: FirebaseFirestore.DocumentData | undefined) {
  const patient = asPlainObject(data);
  return {
    age: patient.age ?? "",
    sex: patient.sex ?? "",
    admissionDate: patient.admissionDate ?? "",
    primaryDiagnosis: patient.primaryDiagnosis ?? "",
    oneLiner: patient.oneLiner ?? "",
    pmh: patient.underlyingDiseases ?? "",
    activeProblems: patient.activeProblems ?? "",
    chiefComplaint: patient.chiefComplaint ?? patient.admissionChiefConcern ?? "",
    hpi: patient.presentIllnessOrHPI ?? patient.hpiOrAdmissionStory ?? "",
    admissionSummary: patient.admissionBriefFreeText ?? patient.generatedAdmissionSummary ?? "",
    isbarHandoff: patient.generatedSbarNote ?? "",
    admissionNote: patient.generatedAdmissionNote ?? patient.admissionBriefNotes ?? "",
    initialPhysicalExam: patient.initialPhysicalExam ?? "",
    initialLabs: patient.initialLabs ?? "",
    initialImaging: patient.initialImaging ?? "",
    initialAssessment: patient.initialAssessment ?? "",
    initialPlan: patient.initialPlan ?? "",
    earlyHospitalCourse: patient.earlyHospitalCourse ?? "",
    hospitalCourseHighlights: patient.hospitalCourseHighlights ?? "",
    redFlags: patient.importantRedFlags ?? "",
    dischargePlan: patient.dischargePlan ?? "",
    dischargeBarriers: patient.dischargeBarriers ?? "",
    latestVitals: patient.vitalSigns ?? "",
    latestBloodSugar: patient.bloodSugar ?? "",
    latestPE: patient.physicalExam ?? "",
    latestLabs: patient.newLabs ?? patient.rawLabText ?? "",
    latestImages: patient.newImaging ?? "",
    latestAssessment: patient.assessment ?? "",
    latestPlan: patient.plan ?? "",
    currentTasks: Array.isArray(patient.tasks)
      ? patient.tasks
          .filter((task) => asPlainObject(task).done !== true)
          .slice(0, 20)
          .map((task) => ({
            text: asPlainObject(task).text ?? "",
            priority: asPlainObject(task).priority ?? "",
            dueDate: asPlainObject(task).dueDate ?? "",
            category: asPlainObject(task).category ?? "",
          }))
      : [],
  };
}

export function compactDailyNote(noteId: string, data: FirebaseFirestore.DocumentData) {
  const note = asPlainObject(data);
  return {
    date: String(note.date ?? noteId),
    soapText: note.soapText ?? "",
    soapStatus: note.soapStatus ?? "",
    redFlags: note.importantRedFlags ?? "",
    overnight: note.overnightEvents ?? "",
    subjective: note.subjectiveOrChiefConcern ?? "",
    vitalSigns: note.vitalSigns ?? "",
    bloodSugar: note.bloodSugar ?? "",
    physicalExam: note.physicalExam ?? "",
    labs: note.rawLabText ?? note.labSummary ?? "",
    images: note.imageSummary ?? "",
    assessment: note.assessment ?? "",
    plan: note.plan ?? "",
    dischargePlan: note.dischargePlan ?? "",
  };
}

