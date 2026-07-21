import { formatSoapDraft, normalizeSoapTextForEditor, parseSoapText, type SoapDraft } from "./soapDraft";
import { normalizeApProblems } from "./apProblemNormalizer";
import { leanSoapCleanup } from "./aiPostprocess/soapLeanCleanup";
import { formatObjectiveLabVisualSummaryLines } from "./labVisualSummary";
import { prefixedObjectiveLine, sanitizeObjectiveLines } from "./objectiveLineSanitizer";
import { parseLabReports, safeClinicalLinePreservingMarks } from "./utils";

export const AI_SOAP_OUTPUT_CONTRACT_VERSION = "ai-soap-v2";

export interface NormalizedAiSoapOutput {
  contractVersion: typeof AI_SOAP_OUTPUT_CONTRACT_VERSION;
  soapText: string;
  warnings: string[];
}

function normalizeLines(lines: string[], maxItems: number, maxChars: number) {
  const seen = new Set<string>();
  return lines
    .map((line) => safeClinicalLinePreservingMarks(line, maxChars))
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase().replace(/^!+\s*/, "").replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function normalizedApProblems(draft: SoapDraft) {
  const problems = normalizeApProblems(normalizeObjectiveSupportedApProblems(removeRepeatedApTreatmentNoise(draft.apProblems), draft.oLines))
    .map((problem) => ({
      title: safeClinicalLinePreservingMarks(problem.title || "Active problem", 90),
      lines: normalizeLines(problem.lines, 2, 160),
    }))
    .filter((problem) => problem.title || problem.lines.length > 0)
    .slice(0, 6);

  if (problems.length > 0) return problems;
  return [
    {
      title: "Active problems",
      lines: ["No active A/P supplied; review source before saving."],
    },
  ];
}

function normalizedKey(value: string) {
  return String(value ?? "")
    .replace(/^!+\s*/, "")
    .replace(/^[-#*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function apBucket(value: string) {
  const text = normalizedKey(value);
  if (/\b(abx|antibiotic|culture|b\/c|bcx|cx|sepsis|bacteremia|pna|pneumonia|uti|cholangitis|infection|infx|cef|vanco|vancomycin|teicoplanin|meropenem|zosyn|pip\/tazo)\b/.test(text)) return "infection";
  if (/\b(o2|oxygen|spo2|nc\b|resp|rf|dyspnea|hypox|pneumonia|pna|effusion|thoracentesis|chylothorax|cxr)\b/.test(text)) return "resp";
  if (/\b(aki|renal|cr\b|creatinine|bun|egfr|k\b|na\b|sodium|hypernat|hyponat|hyperk|hypok|lyte|electrolyte)\b/.test(text)) return "renal";
  if (/\b(lft|ast|alt|bilirubin|t-?bil|inr|coag|transaminitis|liver|hepatitis)\b/.test(text)) return "liver";
  if (/\b(hb|hgb|anemia|plt|platelet|bleed|bleeding|melena|transfusion)\b/.test(text)) return "heme";
  if (/\b(cancer|tumou?r|scc|adenoca|carcinoma|chemo|rt|metasta|onc)\b/.test(text)) return "onc";
  return "";
}

function apSignals(value: string) {
  const text = normalizedKey(value);
  const signals: string[] = [];
  if (/\b(hypernatremia|hyponatremia|sodium disorder|na disorder)\b/.test(text)) signals.push("sodium");
  if (/\b(aki|acute kidney injury|cr elevation|renal dysfunction|hyperkalemia|hypokalemia|k disorder)\b/.test(text)) signals.push("renal");
  if (/\b(liver injury|transaminitis|elevated lft|coagulopathy|inr elevation)\b/.test(text)) signals.push("liver");
  if (/\b(anemia|hb drop|bleeding|cytopenia)\b/.test(text)) signals.push("heme");
  return signals;
}

function repeatedTreatmentBucket(value: string) {
  const text = normalizedKey(value);
  if (/\b(teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|zosyn|pip\/tazo|meropenem|ertapenem|levofloxacin|metronidazole|abx|antibiotic|culture|b\/c|bcx|source control|de-?escalation)\b/.test(text)) return "infection";
  if (/\b(o2|oxygen|spo2|nasal cannula|nc\s*\d*l?|hfno|bipap|ventilator|wean o2)\b/.test(text)) return "resp";
  return "";
}

function splitApClauses(value: string) {
  return String(value ?? "")
    .split(/\s*;\s*|\s*,\s*(?=(?:f\/u|follow|continue|cont|wean|o2|oxygen|abx|culture|b\/c|bcx|cef|vanco|teico|mero|zosyn|hold|resume|repeat)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function removeRepeatedApTreatmentNoise(problems: SoapDraft["apProblems"]) {
  const problemBuckets: string[] = problems.map((problem) => apBucket(`${problem.title} ${problem.lines.join(" ")}`));
  const hasBucket = (bucket: string) => Boolean(bucket && problemBuckets.includes(bucket));
  const seenTreatmentClauses = new Set<string>();

  return problems.map((problem, problemIndex) => {
    const ownBucket = problemBuckets[problemIndex];
    const nextLines = problem.lines
      .map((line) => {
        const keptClauses = splitApClauses(line).filter((clause) => {
          const bucket = repeatedTreatmentBucket(clause);
          if (!bucket) return true;
          const key = `${bucket}|${normalizedKey(clause)}`;
          const belongsElsewhere = hasBucket(bucket) && ownBucket !== bucket;
          if (belongsElsewhere) return false;
          if (seenTreatmentClauses.has(key)) return false;
          seenTreatmentClauses.add(key);
          return true;
        });
        return keptClauses.join("; ");
      })
      .filter(Boolean);
    return { ...problem, lines: nextLines };
  });
}

function numericValue(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function criticalLabProblem(label: string, value: number) {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key === "na" || key === "sodium") {
    if (value > 150) return { bucket: "renal", signal: "sodium", title: "Hypernatremia", line: `Na ${value}.` };
    if (value < 130) return { bucket: "renal", signal: "sodium", title: "Hyponatremia", line: `Na ${value}.` };
  }
  if (key === "k" || key === "potassium") {
    if (value > 5.5) return { bucket: "renal", signal: "renal", title: "Hyperkalemia / renal-lyte", line: `K ${value}.` };
    if (value < 3) return { bucket: "renal", signal: "renal", title: "Hypokalemia / renal-lyte", line: `K ${value}.` };
  }
  if ((key === "cr" || key === "creatinine") && value >= 2) return { bucket: "renal", signal: "renal", title: "Cr elevation / renal dysfunction", line: `Cr ${value}.` };
  if ((key === "ast" || key === "alt") && value >= 200) return { bucket: "liver", signal: "liver", title: "Liver injury / transaminitis", line: `${label.toUpperCase()} ${value}.` };
  if (key === "inr" && value >= 3) return { bucket: "liver", signal: "liver", title: "Coagulopathy / INR elevation", line: `INR ${value}.` };
  if ((key === "hb" || key === "hgb" || key === "hemoglobin") && value < 8) return { bucket: "heme", signal: "heme", title: "Anemia", line: `Hb ${value}.` };
  return null;
}

function objectiveCriticalLabProblems(oLines: string[]) {
  const labs = parseLabReports(oLines.filter((line) => /\blab\s*:/i.test(line) || /\b(?:na|k|cr|ast|alt|inr|hb|hgb)\b/i.test(line)).join("\n"));
  const suggestions: Array<{ bucket: string; signal: string; title: string; line: string }> = [];
  labs.forEach((report) => {
    report.items.forEach((item) => {
      const label = String(item.name || item.label || "").trim();
      const value = numericValue(item.value);
      if (!label || value === null) return;
      const suggestion = criticalLabProblem(label, value);
      if (suggestion) suggestions.push(suggestion);
    });
  });
  const seen = new Set<string>();
  return suggestions.filter((item) => {
    const key = `${item.bucket}|${item.title}|${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeObjectiveSupportedApProblems(problems: SoapDraft["apProblems"], oLines: string[]) {
  const next = problems.map((problem) => ({ ...problem, lines: [...problem.lines] }));
  objectiveCriticalLabProblems(oLines).forEach((suggestion) => {
    const matchingProblem = next.find((problem) => apSignals(problem.title).includes(suggestion.signal));
    if (matchingProblem) {
      if (!matchingProblem.lines.some((line) => normalizedKey(line).includes(normalizedKey(suggestion.line)))) {
        matchingProblem.lines = normalizeLines([suggestion.line, ...matchingProblem.lines], 2, 160);
      }
      return;
    }
    if (!next.some((problem) => apSignals(problem.title).includes(suggestion.signal) || normalizedKey(problem.title).includes(normalizedKey(suggestion.title)))) {
      next.push({ title: suggestion.title, lines: [suggestion.line] });
    }
  });
  return next;
}

function isGenericTaskLine(line: string) {
  const text = normalizedKey(line);
  if (!text) return true;
  if (/^(?:monitor closely|continue current management|clinical correlation|review as needed|follow clinically)$/.test(text)) return true;
  if (/^(?:continue|cont|monitor|observe)\b/.test(text) &&
    !/\b(?:until|through|x\s*\d|today|tonight|pending|result|culture|cx|call|if|when|q\d+h|hold|resume|stop|start|dose|day|d\d+|teicoplanin|vancomycin|vanco|cef\w*|meropenem|ertapenem|zosyn|pip\/tazo|levofloxacin|apixaban|heparin|warfarin|insulin|lasix|furosemide|steroid)\b/.test(text)) return true;
  return false;
}

function lineEquivalent(left: string, right: string) {
  const a = normalizedKey(left);
  const b = normalizedKey(right);
  return Boolean(a && b && (a === b || (a.length >= 24 && b.includes(a)) || (b.length >= 24 && a.includes(b))));
}

function normalizeTaskAndDcOwnership(taskLines: string[], dcLines: string[], apProblems: SoapDraft["apProblems"]) {
  const nextDc = [...dcLines];
  const apLines = apProblems.flatMap((problem) => [problem.title, ...problem.lines]);
  const nextTasks = taskLines.filter((line) => {
    if (/^(?:dc|discharge|dispo|barrier)\s*[:：]/i.test(line.replace(/^!+\s*/, ""))) {
      nextDc.push(line.replace(/^(?:dc|discharge|dispo|barrier)\s*[:：]\s*/i, ""));
      return false;
    }
    if (isGenericTaskLine(line)) return false;
    return !apLines.some((apLine) => lineEquivalent(line, apLine));
  });
  return {
    taskLines: normalizeLines(nextTasks, 8, 160),
    dcLines: normalizeLines(nextDc, 6, 160),
  };
}

export function normalizeAiSoapDraft(draft: SoapDraft): SoapDraft {
  const sanitizedObjective = sanitizeObjectiveLines(draft.oLines);
  const oLines = normalizeLines(
    formatObjectiveLabVisualSummaryLines(sanitizedObjective.accepted.map(prefixedObjectiveLine), {
      maxGroups: 7,
      maxCharsPerGroup: 240,
    }),
    12,
    240,
  );
  const apProblems = normalizedApProblems({ ...draft, oLines });
  const owned = normalizeTaskAndDcOwnership(draft.taskLines, draft.dcLines, apProblems);
  return {
    header: normalizeLines(draft.header, 8, 150),
    sLines: normalizeLines(draft.sLines, 8, 140),
    oLines,
    apProblems,
    taskLines: owned.taskLines,
    dcLines: owned.dcLines,
    warnings: normalizeLines([
      ...draft.warnings,
      ...(sanitizedObjective.rejected.length > 0 ? ["Ignored lab export header(s) without result values."] : []),
    ], 8, 160),
  };
}

export function normalizeAiSoapText(soapText: string, candidateWarnings: string[] = []): NormalizedAiSoapOutput {
  const parsed = parseSoapText(normalizeSoapTextForEditor(leanSoapCleanup(soapText)));
  const normalized = normalizeAiSoapDraft(parsed);
  const warnings = [...candidateWarnings, ...normalized.warnings];

  if (normalized.sLines.length === 0) {
    normalized.sLines.push("No documented interval event.");
    warnings.push("AI SOAP had no S section content; inserted explicit empty-state line.");
  }

  if (normalized.oLines.length === 0) {
    normalized.oLines.push("No new objective data provided.");
    warnings.push("AI SOAP had no O section content; inserted explicit empty-state line.");
  }

  if (!/^S:/m.test(formatSoapDraft(parsed)) || !/^O:/m.test(formatSoapDraft(parsed)) || !/^A\/P:/m.test(formatSoapDraft(parsed))) {
    warnings.push("AI SOAP headings were normalized to the stable SOAP contract.");
  }

  return {
    contractVersion: AI_SOAP_OUTPUT_CONTRACT_VERSION,
    soapText: formatSoapDraft(normalized),
    warnings: normalizeLines(warnings, 10, 220),
  };
}
