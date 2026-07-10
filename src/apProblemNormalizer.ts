import { safeClinicalLinePreservingMarks, stripColorMarkup } from "./utils";

export interface NormalizableApProblem {
  title: string;
  lines: string[];
}

function normalizedKey(value: string) {
  return stripColorMarkup(String(value ?? ""))
    .replace(/^!+\s*/, "")
    .replace(/^[-#*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanApText(value: string, maxChars = 160) {
  return safeClinicalLinePreservingMarks(
    String(value ?? "")
      .replace(/\?亙\?/g, "藥囑")
      .replace(/[\uFFFD\uE000-\uF8FF]/g, "")
      .replace(/^(?:00|OO|O0)\s*;\s*/i, "")
      .replace(/\b(?:00|OO|O0)\b\s*(?=;?\s*(?:extubat|stable|wean|NC\b|O2\b))/i, "")
      .replace(/\s+/g, " ")
      .trim(),
    maxChars,
  );
}

function respiratoryBucket(value: string) {
  return /\b(resp|rf|hypox|oxygen|o2\b|spo2|nc\b|hfnc|hfno|bipap|vent|ventilator|mv\b|intubat|extubat|prone|pna|pneumonia|aspirat|effusion|thoracentesis|chylothorax|cxr|wean)\b/i.test(value);
}

function clinicalBucket(value: string) {
  const text = normalizedKey(value);
  if (/\b(sepsis|bacteremia|infection|infect|pna|pneumonia|uti|cholangitis|abx|antibiotic|culture|b\/c|bcx|cef|vanco|vancomycin|teicoplanin|meropenem|zosyn|pip\/tazo)\b/.test(text)) return "infection";
  if (/\b(resp|rf|hypox|oxygen|o2\b|spo2|nc\b|hfnc|hfno|bipap|vent|intubat|extubat|prone|effusion|thoracentesis|chylothorax|cxr|wean)\b/.test(text)) return "resp";
  if (/\b(aki|ckd|renal|cr\b|creatinine|bun|egfr|k\b|na\b|sodium|hypernat|hyponat|hyperk|hypok|lyte|electrolyte|uo|urine)\b/.test(text)) return "renal";
  if (/\b(lft|ast|alt|bilirubin|t-?bil|inr|coag|transaminitis|liver|hepatitis|jaundice)\b/.test(text)) return "liver";
  if (/\b(hb|hgb|anemia|plt|platelet|bleed|bleeding|melena|transfusion|cytopenia)\b/.test(text)) return "heme";
  if (/\b(hfref|heart failure|adhf|af\b|cardio|diuretic|lasix|furosemide|gdmt|congestion|volume overload|echo)\b/.test(text)) return "cardio";
  if (/\b(cancer|tumou?r|scc|adenoca|carcinoma|chemo|rt|metasta|onc)\b/.test(text)) return "onc";
  return "";
}

function isActionOnlyTitle(value: string) {
  const text = normalizedKey(value);
  return /^(?:continue|cont|complete|start|stop|hold|resume|restart|wean|review|adjust|monitor|follow(?:\s+up)?|f\/u|repeat|recheck|check|trend|order|arrange|consult|schedule|titrate|transition|ambulat\w*|mobiliz\w*|rehab)\b/.test(text);
}

function isObjectiveOrCourseTitle(value: string) {
  const text = normalizedKey(value);
  if (/^(?:v\/s|vs|vitals?|lab|image|img|cxr|ct\b|mri|echo|sono|ultrasound)\s*[:\-]/.test(text)) return true;
  return /^(?:s\/p|post|after)\s+(?:mv|vent|intubat|extubat|prone|thoracentesis|ercp|egd|procedure|surgery)\b/.test(text);
}

function treatmentSignature(value: string) {
  const text = normalizedKey(value);
  const matches = text.match(/\b(?:teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|zosyn|pip\/tazo|meropenem|ertapenem|levofloxacin|metronidazole|acyclovir|abx|antibiotic|oxygen|o2|nc|hfnc|bipap|lasix|furosemide|apixaban|heparin|warfarin|insulin)\b/g) ?? [];
  return [...new Set(matches)].sort().join("|");
}

function otherMajorBucket(value: string) {
  return /\b(sepsis|bacteremia|abx|culture|aki|renal|cr\b|na\b|k\b|lft|inr|hb|anemia|bleed|cancer|carcinoma|scc|adenoca|chemo|rt)\b/i.test(value);
}

function isRespiratoryCourseOnly(problem: NormalizableApProblem) {
  const text = `${problem.title} ${problem.lines.join(" ")}`;
  if (!respiratoryBucket(text)) return false;
  if (/\b(resp|rf|hypox|pna|pneumonia|aspirat|effusion|chylothorax)\b/i.test(problem.title)) return false;
  return /\b(s\/p|after|post|mv\b|mechanical ventilation|ventilator|intubat|extubat|prone|wean|stable on nc|nc\b|o2\b)\b/i.test(text) && !otherMajorBucket(problem.title);
}

function isFragmentProblemTitle(title: string) {
  const clean = normalizedKey(title);
  if (!clean) return true;
  if (/^(?:00|oo|o0)(?:[-/;:\s]*\d{1,2})?(?:[-/]\d{1,2})?(?:\s+\d{1,2})?$/.test(clean)) return true;
  if (/^[\d\s/:-]{3,14}$/.test(clean) && /\d/.test(clean)) return true;
  return false;
}

function lineKey(value: string) {
  return normalizedKey(value).replace(/[.;]+$/g, "");
}

function pushUniqueLine(lines: string[], value: string) {
  const clean = cleanApText(value, 170);
  if (!clean) return;
  const key = lineKey(clean);
  if (!key || lines.some((line) => lineKey(line) === key)) return;
  lines.push(clean);
}

function mergeProblemLines(target: NormalizableApProblem, source: NormalizableApProblem, includeTitle: boolean) {
  const additions: string[] = [];
  if (includeTitle) additions.push(source.title);
  const cleanLines = source.lines.map((line) => cleanApText(line, 170)).filter(Boolean);
  if (cleanLines.length > 1 && isRespiratoryCourseOnly(source)) additions.push(cleanLines.join("; "));
  else additions.push(...cleanLines);
  additions.forEach((line) => pushUniqueLine(target.lines, line));
}

function compactProblemLines(lines: string[]) {
  const unique: string[] = [];
  lines.forEach((line) => pushUniqueLine(unique, line));
  if (unique.length <= 2) return unique;
  return [unique[0], unique.slice(1).join("; ")];
}

export function normalizeApProblems(problems: NormalizableApProblem[]) {
  const cleaned = problems
    .map((problem) => ({
      title: cleanApText(problem.title, 110),
      lines: problem.lines.map((line) => cleanApText(line, 170)).filter(Boolean),
    }))
    .filter((problem) => problem.title || problem.lines.length > 0);

  const primaryResp = cleaned.find((problem) => respiratoryBucket(`${problem.title} ${problem.lines.join(" ")}`) && !isRespiratoryCourseOnly(problem) && !isFragmentProblemTitle(problem.title));
  const result: NormalizableApProblem[] = [];
  const deferred: NormalizableApProblem[] = [];

  cleaned.forEach((problem) => {
    const shouldMergeIntoResp =
      primaryResp &&
      problem !== primaryResp &&
      respiratoryBucket(`${problem.title} ${problem.lines.join(" ")}`) &&
      (isRespiratoryCourseOnly(problem) || isFragmentProblemTitle(problem.title));

    if (shouldMergeIntoResp) {
      mergeProblemLines(primaryResp, problem, !isFragmentProblemTitle(problem.title));
      return;
    }

    if (isActionOnlyTitle(problem.title) || isObjectiveOrCourseTitle(problem.title)) {
      const bucket = clinicalBucket(`${problem.title} ${problem.lines.join(" ")}`);
      const target = [...result].reverse().find((candidate) => bucket && clinicalBucket(`${candidate.title} ${candidate.lines.join(" ")}`) === bucket)
        ?? result[result.length - 1];
      if (target) mergeProblemLines(target, problem, true);
      else deferred.push(problem);
      return;
    }

    if (isFragmentProblemTitle(problem.title) && problem.lines.length > 0) {
      const fallbackTitle = respiratoryBucket(problem.lines.join(" ")) ? "Respiratory failure / O2 weaning" : "Active problem";
      const existing = result.find((item) => normalizedKey(item.title) === normalizedKey(fallbackTitle));
      if (existing) mergeProblemLines(existing, problem, false);
      else result.push({ title: fallbackTitle, lines: [...problem.lines] });
      return;
    }

    result.push(problem);
  });

  deferred.forEach((problem) => {
    const bucket = clinicalBucket(`${problem.title} ${problem.lines.join(" ")}`);
    const target = [...result].reverse().find((candidate) => bucket && clinicalBucket(`${candidate.title} ${candidate.lines.join(" ")}`) === bucket)
      ?? result[result.length - 1];
    if (!target) {
      result.push({ title: "Active problem", lines: compactProblemLines([problem.title, ...problem.lines]) });
      return;
    }
    mergeProblemLines(target, problem, true);
  });

  result.forEach((problem) => {
    problem.lines = compactProblemLines(problem.lines);
  });

  const seenTreatment = new Set<string>();
  result.forEach((problem) => {
    problem.lines = problem.lines.filter((line) => {
      const signature = treatmentSignature(line);
      if (!signature) return true;
      const key = `${signature}|${normalizedKey(line)}`;
      if (seenTreatment.has(key)) return false;
      seenTreatment.add(key);
      return true;
    });
  });

  const seen = new Set<string>();
  return result.filter((problem) => {
    const key = normalizedKey(problem.title || problem.lines.join(" "));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
