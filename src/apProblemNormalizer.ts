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

export function normalizeApProblems(problems: NormalizableApProblem[]) {
  const cleaned = problems
    .map((problem) => ({
      title: cleanApText(problem.title, 110),
      lines: problem.lines.map((line) => cleanApText(line, 170)).filter(Boolean),
    }))
    .filter((problem) => problem.title || problem.lines.length > 0);

  const primaryResp = cleaned.find((problem) => respiratoryBucket(`${problem.title} ${problem.lines.join(" ")}`) && !isRespiratoryCourseOnly(problem) && !isFragmentProblemTitle(problem.title));
  const result: NormalizableApProblem[] = [];

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

    if (isFragmentProblemTitle(problem.title) && problem.lines.length > 0) {
      const fallbackTitle = respiratoryBucket(problem.lines.join(" ")) ? "Respiratory failure / O2 weaning" : "Active problem";
      const existing = result.find((item) => normalizedKey(item.title) === normalizedKey(fallbackTitle));
      if (existing) mergeProblemLines(existing, problem, false);
      else result.push({ title: fallbackTitle, lines: [...problem.lines] });
      return;
    }

    result.push(problem);
  });

  const seen = new Set<string>();
  return result.filter((problem) => {
    const key = normalizedKey(problem.title || problem.lines.join(" "));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
