import {
  classifyClinicalLine,
  normalizeClinicalDisplayTextPreservingMarks,
  type ClinicalLineKind,
  type ClinicalLineTone,
  stripClinicalMarkup,
} from "./clinicalLineClassifier";
import { formatSoapDraft, normalizeSoapTextForEditor, parseSoapText, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { createId, hasColorMarkup, safeClinicalLine, safeClinicalLinePreservingMarks } from "./utils";

export interface SoapEditorLine {
  id: string;
  text: string;
  tone: ClinicalLineTone;
  kind: ClinicalLineKind;
  subtype?: "order";
}

export interface SoapEditorProblem {
  id: string;
  title: string;
  tone: ClinicalLineTone;
  lines: SoapEditorLine[];
}

export interface SoapEditorDraft {
  headerLines: SoapEditorLine[];
  sLines: SoapEditorLine[];
  oLines: SoapEditorLine[];
  apProblems: SoapEditorProblem[];
  taskLines: SoapEditorLine[];
  dcLines: SoapEditorLine[];
  warnings: SoapEditorLine[];
  unsortedLines: SoapEditorLine[];
}

export interface SoapEditorLintIssue {
  id: string;
  severity: "warning" | "info";
  text: string;
}

function bangTone(value: string): ClinicalLineTone | undefined {
  const clean = String(value ?? "").trim();
  if (/^!!/.test(clean)) return "critical";
  if (/^!/.test(clean) || /^\*\s+/.test(clean)) return "important";
  return undefined;
}

function withoutTonePrefix(value: string) {
  return stripClinicalMarkup(String(value ?? ""))
    .replace(/^!!+\s*/, "")
    .replace(/^!+\s*/, "")
    .replace(/^\*\s+/, "")
    .trim();
}

function markPreservingEditorText(value: string) {
  const withoutTone = String(value ?? "")
    .replace(/^!!+\s*/, "")
    .replace(/^!+\s*/, "")
    .replace(/^\*\s+/, "")
    .trim()
    .replace(/^(S|V\/S|VS|Vitals?|PE|Physical exam|Lab|Image|Img|Task|Tasks|DC|Discharge|Prep)\s*:\s*/i, "");
  return normalizeClinicalDisplayTextPreservingMarks(withoutTone);
}

function editorLineText(value: string, classifiedText: string) {
  // classifyClinicalLine strips [[color:...]] marks; keep them so clinician color tags survive round-trips.
  return hasColorMarkup(value) ? markPreservingEditorText(value) : withoutTonePrefix(classifiedText);
}

function makeLine(value: string, fallbackKind: ClinicalLineKind): SoapEditorLine {
  const classified = classifyClinicalLine(value, { fallbackKind, explicitTone: bangTone(value) });
  const lockedKind = fallbackKind === "task" || fallbackKind === "dc" || fallbackKind === "ap" || fallbackKind === "s" || fallbackKind === "header";
  return {
    id: createId("soap-line"),
    text: editorLineText(value, classified.text),
    tone: classified.tone === "info" ? "plain" : classified.tone,
    kind: lockedKind ? fallbackKind : classified.kind === "other" ? fallbackKind : classified.kind,
  };
}

function looksLikeOrderLine(value: string) {
  const text = String(value ?? "").trim().replace(/^!!?\s*/, "").replace(/^\*\s*/, "");
  return (
    /^\s*(?:order|orders?|meds?|藥囑)\s*[:：]/i.test(text) ||
    /^\s*(?:Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*:/i.test(text) ||
    (/\b(?:start|stop|hold|resume|continue|complete|taper|titrate|wean)\b/i.test(text) &&
      /\b(?:abx|antibiotic|cef|vanco|teico|levofloxacin|ciprofloxacin|moxifloxacin|mero|tazo|zosyn|heparin|apixaban|warfarin|insulin|steroid|methylpred|prednisolone|lasix|furosemide)\b/i.test(text)) ||
    (/\b(?:vs|v\/s|vital|i\/o|input\/output|spo2|glucose|sugar)\b/i.test(text) &&
      /\b(?:q\d+\s*h|q\d+h|qd|bid|tid|qid|ac\/hs|stat|once)\b/i.test(text)) ||
    (/\b(?:iv|po|sc|im|mg|mcg|g|unit|units|q\d+h|qd|bid|tid|qid|prn|stat|x\s*\d+\s*d(?:ay)?s?)\b/i.test(text) &&
      /\b(?:abx|antibiotic|cef|vanco|teico|levo|cipro|mero|tazo|zosyn|morphine|fentanyl|lasix|furosemide|heparin|insulin|ppi|pantoprazole|steroid|methylpred|prednisolone)\b/i.test(text))
  );
}

function stripOrderPrefix(value: string) {
  return String(value ?? "").replace(/^\s*(?:order|orders?|meds?|藥囑)\s*[:：]\s*/i, "").trim();
}

function makeTaskLine(value: string): SoapEditorLine {
  const isOrder = looksLikeOrderLine(value);
  const line = makeLine(isOrder ? stripOrderPrefix(value) : value, "task");
  return isOrder ? { ...line, subtype: "order" } : line;
}

function makeProblem(problem: SoapApProblem): SoapEditorProblem {
  const explicitTitleTone = bangTone(problem.title);
  const rawTitle = problem.title || "Problem";
  return {
    id: createId("soap-ap"),
    title: hasColorMarkup(rawTitle) ? markPreservingEditorText(rawTitle) : withoutTonePrefix(rawTitle),
    tone: explicitTitleTone ?? "plain",
    lines: problem.lines.map((line) => makeLine(line, "ap")),
  };
}

export function emptySoapEditorLine(kind: ClinicalLineKind = "other"): SoapEditorLine {
  return {
    id: createId("soap-line"),
    text: "",
    tone: "plain",
    kind,
  };
}

export function emptySoapEditorProblem(): SoapEditorProblem {
  return {
    id: createId("soap-ap"),
    title: "",
    tone: "plain",
    lines: [emptySoapEditorLine("ap")],
  };
}

export function splitSoapEditorTaskLines(lines: SoapEditorLine[]) {
  return {
    orderLines: lines.filter((line) => line.subtype === "order"),
    taskOnlyLines: lines.filter((line) => line.subtype !== "order"),
  };
}

function orderLineKey(value: string) {
  return stripOrderPrefix(withoutTonePrefix(value))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function orderSourceLines(sourceText: string) {
  return String(sourceText ?? "")
    .split(/\r?\n|[\u2028\u2029]/)
    .map(stripOrderPrefix)
    .map((line) => safeClinicalLinePreservingMarks(line, 170))
    .filter(Boolean)
    .map((line) => ({ ...makeLine(line, "task"), subtype: "order" as const }));
}

export function mergeOrderSourceIntoEditorDraft(draft: SoapEditorDraft, sourceText: string): SoapEditorDraft {
  const additions = orderSourceLines(sourceText);
  if (additions.length === 0) return draft;

  const { orderLines, taskOnlyLines } = splitSoapEditorTaskLines(draft.taskLines);
  const seen = new Set(orderLines.map((line) => orderLineKey(line.text)).filter(Boolean));
  const nextOrderLines = additions.filter((line) => {
    const key = orderLineKey(line.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (nextOrderLines.length === 0) return draft;
  return { ...draft, taskLines: [...orderLines, ...nextOrderLines, ...taskOnlyLines] };
}

export function parseSoapTextToEditorDraft(text: string): SoapEditorDraft {
  const normalized = normalizeSoapTextForEditor(text);
  const draft = parseSoapText(normalized);
  const result: SoapEditorDraft = {
    headerLines: draft.header.map((line) => makeLine(line, "header")),
    sLines: draft.sLines.map((line) => makeLine(line, "s")),
    oLines: draft.oLines.map((line) => makeLine(line, "other")),
    apProblems: draft.apProblems.map(makeProblem),
    taskLines: draft.taskLines.map((line) => makeTaskLine(line)),
    dcLines: draft.dcLines.map((line) => makeLine(line, "dc")),
    warnings: draft.warnings.map((line) => makeLine(line, "other")),
    unsortedLines: [],
  };

  const hasSections = /^\s*(?:S|O|A\/P|AP|Tasks?|DC)\s*:/im.test(String(text ?? ""));
  if (!hasSections && String(text ?? "").trim()) {
    result.unsortedLines = String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((line) => makeLine(line, "other"));
  }

  return result;
}

function serializeLine(line: SoapEditorLine, fallbackKind: ClinicalLineKind) {
  const clean = safeClinicalLinePreservingMarks(line.text, 170);
  if (!clean) return "";
  const kind = line.kind || fallbackKind;
  const prefix =
    kind === "vs"
      ? "V/S: "
      : kind === "pe"
        ? "PE: "
        : kind === "lab"
          ? "Lab: "
          : kind === "image"
            ? "Image: "
            : "";
  const tonePrefix = line.tone === "critical" ? "!! " : line.tone === "important" ? "! " : "";
  return `${tonePrefix}${prefix}${clean}`.trim();
}

function serializeTaskLine(line: SoapEditorLine) {
  if (line.subtype !== "order") return serializeLine(line, "task");
  const clean = safeClinicalLinePreservingMarks(line.text, 170);
  if (!clean) return "";
  const tonePrefix = line.tone === "critical" ? "!! " : line.tone === "important" ? "! " : "";
  const hasExplicitOrderPrefix = /^(?:order|orders?|meds?|藥囑|Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*[:：]/i.test(clean);
  const orderText = hasExplicitOrderPrefix ? clean : `Order: ${clean}`;
  return `${tonePrefix}${orderText}`.trim();
}

function serializeProblem(problem: SoapEditorProblem) {
  const title = safeClinicalLinePreservingMarks(problem.title, 110) || "Problem";
  const titlePrefix = problem.tone === "critical" ? "!! " : problem.tone === "important" ? "! " : "";
  const lines = problem.lines.map((line) => serializeLine(line, "ap")).filter(Boolean).slice(0, 2);
  return {
    title: `${titlePrefix}${title}`.trim(),
    lines,
  };
}

export function editorDraftToSoapDraft(draft: SoapEditorDraft): SoapDraft {
  return {
    header: draft.headerLines.map((line) => serializeLine(line, "header")).filter(Boolean),
    sLines: draft.sLines.map((line) => serializeLine(line, "s")).filter(Boolean),
    oLines: draft.oLines.map((line) => serializeLine(line, "other")).filter(Boolean),
    apProblems: draft.apProblems
      .map(serializeProblem)
      .filter((problem) => problem.title !== "Problem" || problem.lines.length > 0),
    taskLines: draft.taskLines.map((line) => serializeTaskLine(line)).filter(Boolean),
    dcLines: draft.dcLines.map((line) => serializeLine(line, "dc")).filter(Boolean),
    warnings: draft.warnings.map((line) => serializeLine(line, "other")).filter(Boolean),
  };
}

export function editorDraftToSoapText(draft: SoapEditorDraft) {
  return formatSoapDraft(editorDraftToSoapDraft(draft));
}

export function lintSoapEditorDraft(draft: SoapEditorDraft): SoapEditorLintIssue[] {
  const issues: SoapEditorLintIssue[] = [];
  if (draft.sLines.filter((line) => line.text.trim()).length === 0) {
    issues.push({ id: "missing-s", severity: "info", text: "S is empty. Add today's symptoms/overnight update if relevant." });
  }
  if (draft.oLines.filter((line) => line.text.trim()).length === 0) {
    issues.push({ id: "missing-o", severity: "warning", text: "O is empty. Add V/S, PE, Lab, or Image before relying on this SOAP." });
  }
  if (draft.apProblems.filter((problem) => problem.title.trim() || problem.lines.some((line) => line.text.trim())).length === 0) {
    issues.push({ id: "missing-ap", severity: "warning", text: "A/P has no active problem block." });
  }
  draft.apProblems.forEach((problem, index) => {
    const hasTitle = problem.title.trim().length > 0;
    const filledLines = problem.lines.filter((line) => line.text.trim()).length;
    if (!hasTitle && filledLines > 0) {
      issues.push({ id: `ap-title-${problem.id}`, severity: "warning", text: `A/P problem ${index + 1} has plan text but no problem title.` });
    }
    if (filledLines > 2) {
      issues.push({ id: `ap-long-${problem.id}`, severity: "info", text: `A/P problem ${index + 1} has more than 2 lines; compact before print if possible.` });
    }
  });
  draft.oLines.forEach((line) => {
    if (line.kind === "pe" && /\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|impression)\b/i.test(line.text)) {
      issues.push({ id: `image-in-pe-${line.id}`, severity: "warning", text: "Image/report-like text is marked as PE. Change type to Image." });
    }
    if (line.kind !== "vs" && /\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(line.text)) {
      issues.push({ id: `vs-kind-${line.id}`, severity: "info", text: "This line looks like V/S. Set type to V/S for consistent display." });
    }
  });
  draft.unsortedLines.forEach((line) => {
    issues.push({ id: `unsorted-${line.id}`, severity: "warning", text: `Unsorted pasted line needs review: ${safeClinicalLine(line.text, 80)}` });
  });
  return issues.slice(0, 12);
}
