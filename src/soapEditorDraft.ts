import { classifyClinicalLine, type ClinicalLineKind, type ClinicalLineTone, stripClinicalMarkup } from "./clinicalLineClassifier";
import { formatSoapDraft, normalizeSoapTextForEditor, parseSoapText, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { createId, safeClinicalLine } from "./utils";

export interface SoapEditorLine {
  id: string;
  text: string;
  tone: ClinicalLineTone;
  kind: ClinicalLineKind;
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

function makeLine(value: string, fallbackKind: ClinicalLineKind): SoapEditorLine {
  const classified = classifyClinicalLine(value, { fallbackKind, explicitTone: bangTone(value) });
  const lockedKind = fallbackKind === "task" || fallbackKind === "dc" || fallbackKind === "ap" || fallbackKind === "s" || fallbackKind === "header";
  return {
    id: createId("soap-line"),
    text: withoutTonePrefix(classified.text),
    tone: classified.tone,
    kind: lockedKind ? fallbackKind : classified.kind === "other" ? fallbackKind : classified.kind,
  };
}

function makeProblem(problem: SoapApProblem): SoapEditorProblem {
  const classified = classifyClinicalLine(`${problem.title} ${problem.lines.join(" ")}`, { fallbackKind: "ap", explicitTone: bangTone(problem.title) });
  return {
    id: createId("soap-ap"),
    title: withoutTonePrefix(problem.title || "Problem"),
    tone: classified.tone === "plain" ? "info" : classified.tone,
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

export function parseSoapTextToEditorDraft(text: string): SoapEditorDraft {
  const normalized = normalizeSoapTextForEditor(text);
  const draft = parseSoapText(normalized);
  const result: SoapEditorDraft = {
    headerLines: draft.header.map((line) => makeLine(line, "header")),
    sLines: draft.sLines.map((line) => makeLine(line, "s")),
    oLines: draft.oLines.map((line) => makeLine(line, "other")),
    apProblems: draft.apProblems.map(makeProblem),
    taskLines: draft.taskLines.map((line) => makeLine(line, "task")),
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
  const clean = safeClinicalLine(line.text, 170);
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

function serializeProblem(problem: SoapEditorProblem) {
  const title = safeClinicalLine(problem.title, 110) || "Problem";
  const lines = problem.lines.map((line) => serializeLine(line, "ap")).filter(Boolean).slice(0, 2);
  return {
    title,
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
    taskLines: draft.taskLines.map((line) => serializeLine(line, "task")).filter(Boolean),
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
