import { parseSoapText } from "./soapDraft";
import type {
  SoapEditLineChange,
  SoapEditSection,
  SoapEditTrace,
  SoapEditWorkflowMode,
} from "./types";
import { createId, nowIso } from "./utils";

export const SOAP_EDIT_HISTORY_LIMIT = 12;
const SOAP_EDIT_CHANGE_LIMIT = 40;
const SOAP_EDIT_LINE_LIMIT = 320;

export interface SoapEditOrigin {
  source: "ai" | "manual";
  beforeText: string;
  workflowMode: SoapEditWorkflowMode;
  aiDraftId?: string;
  model?: string;
  qualityMode?: "fast" | "balanced" | "highAccuracy";
}

interface BuildSoapEditTraceInput extends SoapEditOrigin {
  afterText: string;
  baseSoapVersion: number;
  savedSoapVersion: number;
  savedAt?: string;
}

function compactLine(value: string) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SOAP_EDIT_LINE_LIMIT);
}

function objectiveSection(line: string): SoapEditSection {
  const plain = line.replace(/^!+\s*/, "").trim();
  if (/^(?:v\/s|vs|vitals?)\s*:/i.test(plain)) return "vs";
  if (/^(?:pe|physical exam)\s*:/i.test(plain)) return "pe";
  if (/^lab\s*:/i.test(plain)) return "lab";
  if (/^(?:image|img)\s*:/i.test(plain) || /^(?:ct|mri|cxr|x-?ray|echo|sono|ultrasound)\b/i.test(plain)) return "image";
  return "objective";
}

function isOrderLine(line: string) {
  const plain = line.replace(/^!+\s*/, "").trim();
  return /^(?:order|orders?|meds?|\u85e5\u56d1|abx|anticoag\/ap|steroid\/immuno|cardio\/renal|resp|insulin\/glucose|ivf\/lyte|nutrition|monitoring|prn)\s*[:\uff1a]/i.test(
    plain,
  );
}

function soapLinesBySection(text: string) {
  const draft = parseSoapText(text);
  const sections = new Map<SoapEditSection, string[]>();
  const add = (section: SoapEditSection, line: string) => {
    const clean = compactLine(line);
    if (!clean) return;
    sections.set(section, [...(sections.get(section) ?? []), clean]);
  };

  draft.header.forEach((line) => add("header", line));
  draft.sLines.forEach((line) => add("s", line));
  draft.oLines.forEach((line) => add(objectiveSection(line), line));
  draft.apProblems.forEach((problem) => {
    add("ap", `# ${problem.title}`);
    problem.lines.forEach((line) => add("ap", `- ${line}`));
  });
  draft.taskLines.forEach((line) => add(isOrderLine(line) ? "orders" : "tasks", line));
  draft.dcLines.forEach((line) => add("dc", line));
  return sections;
}

function lcsTable(before: string[], after: string[]) {
  const table = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] = before[left] === after[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  return table;
}

function sectionChanges(section: SoapEditSection, before: string[], after: string[]) {
  const table = lcsTable(before, after);
  const changes: SoapEditLineChange[] = [];
  let left = 0;
  let right = 0;
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) {
      changes.push({ section, kind: "rewritten", before: removed[index], after: added[index] });
    }
    removed.slice(paired).forEach((line) => changes.push({ section, kind: "removed", before: line, after: "" }));
    added.slice(paired).forEach((line) => changes.push({ section, kind: "added", before: "", after: line }));
    removed = [];
    added = [];
  };

  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      flush();
      left += 1;
      right += 1;
      continue;
    }
    if (right < after.length && (left >= before.length || table[left][right + 1] >= table[left + 1][right])) {
      added.push(after[right]);
      right += 1;
      continue;
    }
    if (left < before.length) {
      removed.push(before[left]);
      left += 1;
    }
  }
  flush();
  return changes;
}

export function nextSoapVersion(existing: { soapVersion?: number } | undefined) {
  if (!existing) return 1;
  return Math.max(1, Number(existing.soapVersion) || 1) + 1;
}

export function buildSoapEditTrace(input: BuildSoapEditTraceInput): SoapEditTrace | null {
  const beforeSections = soapLinesBySection(input.beforeText);
  const afterSections = soapLinesBySection(input.afterText);
  const sectionOrder: SoapEditSection[] = ["header", "s", "vs", "pe", "lab", "image", "objective", "ap", "orders", "tasks", "dc"];
  const allChanges = sectionOrder.flatMap((section) =>
    sectionChanges(section, beforeSections.get(section) ?? [], afterSections.get(section) ?? []),
  );
  const acceptedAiDraftWithoutEdits = input.source === "ai" && allChanges.length === 0;
  if (allChanges.length === 0 && !acceptedAiDraftWithoutEdits) return null;

  const changes = allChanges.slice(0, SOAP_EDIT_CHANGE_LIMIT);
  const changedSections = sectionOrder.filter((section) => allChanges.some((change) => change.section === section));
  return {
    id: createId("soap-edit"),
    savedAt: input.savedAt ?? nowIso(),
    source: input.source,
    workflowMode: input.workflowMode,
    aiDraftId: input.aiDraftId ?? "",
    model: input.model ?? "",
    qualityMode: input.qualityMode ?? "",
    baseSoapVersion: input.baseSoapVersion,
    savedSoapVersion: input.savedSoapVersion,
    changedSections,
    changes,
    stats: {
      added: allChanges.filter((change) => change.kind === "added").length,
      removed: allChanges.filter((change) => change.kind === "removed").length,
      rewritten: allChanges.filter((change) => change.kind === "rewritten").length,
    },
    acceptedAiDraftWithoutEdits,
    truncated: allChanges.length > changes.length,
  };
}

export function appendSoapEditTrace(history: SoapEditTrace[] | undefined, trace: SoapEditTrace | null) {
  const current = Array.isArray(history) ? history : [];
  if (!trace) return current.slice(-SOAP_EDIT_HISTORY_LIMIT);
  return [...current.filter((item) => item.id !== trace.id), trace].slice(-SOAP_EDIT_HISTORY_LIMIT);
}
