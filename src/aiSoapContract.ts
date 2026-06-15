import { formatSoapDraft, normalizeSoapTextForEditor, parseSoapText, type SoapDraft } from "./soapDraft";
import { classifyClinicalLine } from "./clinicalLineClassifier";
import { safeClinicalLinePreservingMarks } from "./utils";

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
  const problems = draft.apProblems
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

function normalizeObjectiveLine(line: string) {
  const clean = safeClinicalLinePreservingMarks(line, 180);
  if (!clean) return "";
  if (/^(?:V\/S|VS|Vitals?|PE|Physical exam|Lab|Image|Img)\s*:/i.test(clean)) return clean;
  const classified = classifyClinicalLine(clean, { fallbackKind: "other" });
  if (classified.kind === "vs") return `V/S: ${clean}`;
  if (classified.kind === "pe") return `PE: ${clean}`;
  if (classified.kind === "lab") return `Lab: ${clean}`;
  if (classified.kind === "image") return `Image: ${clean}`;
  return clean;
}

export function normalizeAiSoapDraft(draft: SoapDraft): SoapDraft {
  return {
    header: normalizeLines(draft.header, 8, 150),
    sLines: normalizeLines(draft.sLines, 8, 140),
    oLines: normalizeLines(draft.oLines.map(normalizeObjectiveLine), 16, 180),
    apProblems: normalizedApProblems(draft),
    taskLines: normalizeLines(draft.taskLines, 8, 160),
    dcLines: normalizeLines(draft.dcLines, 6, 160),
    warnings: normalizeLines(draft.warnings, 8, 160),
  };
}

export function normalizeAiSoapText(soapText: string, candidateWarnings: string[] = []): NormalizedAiSoapOutput {
  const parsed = parseSoapText(normalizeSoapTextForEditor(soapText));
  const normalized = normalizeAiSoapDraft(parsed);
  const warnings = [...candidateWarnings];

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
