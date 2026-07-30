import {
  classifyClinicalLine,
  normalizeClinicalDisplayTextPreservingMarks,
  type ClinicalLineKind,
  type ClinicalLineTone,
} from "./clinicalLineClassifier";
import {
  normalizeObjectiveLabExportLines,
  objectiveKindFromLine,
  stripRepeatedObjectivePrefixes,
} from "./objectiveLineSanitizer";
import { parseSoapText, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { isOrderSoapLine, stripOrderLinePrefix } from "./userPreferences";

export type RoundNoteSection = "header" | "subjective" | "objective" | "assessmentPlan" | "orders" | "tasks" | "dc" | "warnings";

export interface RoundNoteLineView {
  id: string;
  section: RoundNoteSection;
  raw: string;
  text: string;
  kind: ClinicalLineKind;
  label: string;
  tone: ClinicalLineTone;
}

export interface RoundNoteProblemView {
  id: string;
  title: RoundNoteLineView;
  lines: RoundNoteLineView[];
}

export interface RoundNoteViewModel {
  header: RoundNoteLineView[];
  subjective: RoundNoteLineView[];
  objective: {
    all: RoundNoteLineView[];
    vitals: RoundNoteLineView[];
    physicalExam: RoundNoteLineView[];
    labs: RoundNoteLineView[];
    images: RoundNoteLineView[];
    other: RoundNoteLineView[];
  };
  assessmentPlan: RoundNoteProblemView[];
  orders: RoundNoteLineView[];
  tasks: RoundNoteLineView[];
  dc: RoundNoteLineView[];
  warnings: RoundNoteLineView[];
}

export interface RoundNoteViewModelOptions {
  chronicRenal?: boolean;
}

export function prioritizeRoundNoteProblems(problems: RoundNoteProblemView[]) {
  const toneRank: Record<ClinicalLineTone, number> = {
    critical: 0,
    important: 1,
    info: 2,
    plain: 3,
  };
  const clinicalRank = (problem: RoundNoteProblemView) => {
    const text = [problem.title, ...problem.lines].map((line) => line.text).join(" ");
    if (/\b(?:worsening|unstable|shock|active bleed|respiratory failure|hyperkalemia|STEMI|stroke|neutropenic fever|DKA|HHS)\b/i.test(text)) return 0;
    if (/\b(?:sepsis|bacteremia|hypox|new oxygen|AKI|renal dysfunction|GI bleed|ACS|NSTEMI|arrhythmia|delirium|AMS|coagulopathy|DIC)\b/i.test(text)) return 1;
    if (/\b(?:active|uncertain|unresolved|pending)\b/i.test(text)) return 2;
    if (/\b(?:improving|resolved|stable|chronic)\b/i.test(text)) return 4;
    return 3;
  };
  return problems
    .map((problem) => ({
      problem,
      priority: Math.min(...[problem.title, ...problem.lines].map((line) => toneRank[line.tone] ?? 3)),
      clinicalPriority: clinicalRank(problem),
    }))
    .sort((left, right) =>
      left.priority - right.priority ||
      left.clinicalPriority - right.clinicalPriority ||
      left.problem.title.text.localeCompare(right.problem.title.text, "en", { sensitivity: "base" }),
    )
    .map(({ problem }) => problem);
}

export function selectRoundNoteLines(lines: RoundNoteLineView[], maxItems: number) {
  if (lines.length <= maxItems) return lines;
  const required = new Set(
    lines
      .filter((line) =>
        line.tone === "critical" ||
        line.tone === "important" ||
        line.kind === "lab" ||
        line.kind === "image" ||
        line.kind === "ap" ||
        line.kind === "dc" ||
        line.section === "orders",
      )
      .map((line) => line.id),
  );
  const selected = lines.filter((line) => required.has(line.id));
  for (const line of lines) {
    if (selected.length >= maxItems || required.has(line.id)) continue;
    selected.push(line);
  }
  const order = new Map(lines.map((line, index) => [line.id, index]));
  return selected.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

const fixedLabels: Record<ClinicalLineKind, string> = {
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "LAB",
  image: "IMG",
  ap: "A/P",
  task: "TASK",
  dc: "DC",
  red: "RED",
  header: "INFO",
  other: "NOTE",
};

function displayText(raw: string, kind: ClinicalLineKind, section: RoundNoteSection) {
  const normalized = normalizeClinicalDisplayTextPreservingMarks(raw);
  if (section === "orders") return normalizeClinicalDisplayTextPreservingMarks(stripOrderLinePrefix(raw));
  if (section !== "objective") return normalized;
  if (kind === "vs" || kind === "pe" || kind === "lab" || kind === "image") {
    return normalizeClinicalDisplayTextPreservingMarks(stripRepeatedObjectivePrefixes(raw));
  }
  return normalized.replace(/^(?:O|Objective|Other)\s*:\s*/i, "").trim();
}

export function makeRoundNoteLineView(
  raw: string,
  section: RoundNoteSection,
  kind: ClinicalLineKind,
  id: string,
  options: RoundNoteViewModelOptions = {},
): RoundNoteLineView {
  const classified = classifyClinicalLine(raw, { fallbackKind: kind, lockKind: true, chronicRenal: options.chronicRenal });
  return {
    id,
    section,
    raw,
    text: displayText(raw, kind, section),
    kind,
    label: section === "orders" ? "藥囑" : fixedLabels[kind],
    tone: classified.tone,
  };
}

function objectiveLine(raw: string, index: number, options: RoundNoteViewModelOptions) {
  const kind = objectiveKindFromLine(raw, "other");
  return makeRoundNoteLineView(raw, "objective", kind, `o-${index}`, options);
}

function problemView(problem: SoapApProblem, index: number, options: RoundNoteViewModelOptions): RoundNoteProblemView {
  return {
    id: `ap-${index}`,
    title: makeRoundNoteLineView(problem.title, "assessmentPlan", "ap", `ap-${index}-title`, options),
    lines: problem.lines.map((line, lineIndex) => makeRoundNoteLineView(line, "assessmentPlan", "ap", `ap-${index}-${lineIndex}`, options)),
  };
}

export function buildRoundNoteViewModelFromDraft(draft: SoapDraft, options: RoundNoteViewModelOptions = {}): RoundNoteViewModel {
  const objective = normalizeObjectiveLabExportLines(draft.oLines)
    .map((line, index) => objectiveLine(line, index, options));
  const taskOrOrderLines = draft.taskLines.map((line, index) => ({ line, index, order: isOrderSoapLine(line) }));
  const warningText = draft.warnings.map((line) => line.trim()).filter(Boolean).slice(0, 3).join("; ");
  const headerSource = warningText && !draft.header.some((line) => /^Red flags:/i.test(line))
    ? [...draft.header, `Red flags: ${warningText}`]
    : draft.header.map((line) =>
        /^Red flags:/i.test(line) && warningText
          ? `${line.replace(/\s+$/, "")}; ${warningText}`
          : line,
      );
  const assessmentPlan = prioritizeRoundNoteProblems(
    draft.apProblems.map((problem, index) => problemView(problem, index, options)),
  );
  return {
    header: headerSource.map((line, index) =>
      makeRoundNoteLineView(line, "header", /^Red flags:/i.test(line) ? "red" : "header", `header-${index}`, options),
    ),
    subjective: draft.sLines.map((line, index) => makeRoundNoteLineView(line, "subjective", "s", `s-${index}`, options)),
    objective: {
      all: objective,
      vitals: objective.filter((line) => line.kind === "vs"),
      physicalExam: objective.filter((line) => line.kind === "pe"),
      labs: objective.filter((line) => line.kind === "lab"),
      images: objective.filter((line) => line.kind === "image"),
      other: objective.filter((line) => line.kind === "other"),
    },
    assessmentPlan,
    orders: taskOrOrderLines
      .filter((item) => item.order)
      .map((item) => makeRoundNoteLineView(item.line, "orders", "task", `order-${item.index}`, options)),
    tasks: taskOrOrderLines
      .filter((item) => !item.order)
      .map((item) => makeRoundNoteLineView(item.line, "tasks", "task", `task-${item.index}`, options)),
    dc: draft.dcLines.map((line, index) => makeRoundNoteLineView(line, "dc", "dc", `dc-${index}`, options)),
    warnings: draft.warnings.map((line, index) => makeRoundNoteLineView(line, "warnings", "other", `warning-${index}`, options)),
  };
}

export function buildRoundNoteViewModel(text: string, options: RoundNoteViewModelOptions = {}) {
  return buildRoundNoteViewModelFromDraft(parseSoapText(text), options);
}
