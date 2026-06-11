import { useRef, type RefObject } from "react";
import type { ClinicalLineKind, ClinicalLineTone } from "../clinicalLineClassifier";
import {
  applyClinicalColorMarkup,
  clearClinicalColorMarkupAtSelection,
  clinicalMarkColors,
  type ClinicalMarkColor,
} from "../clinicalColorMarkup";
import {
  emptySoapEditorLine,
  emptySoapEditorProblem,
  lintSoapEditorDraft,
  splitSoapEditorTaskLines,
  type SoapEditorDraft,
  type SoapEditorLine,
  type SoapEditorProblem,
} from "../soapEditorDraft";
import MedicationOrderReviewPanel, { type MedicationOrderSummaryLine } from "./MedicationOrderReviewPanel";
import { useSelectionRange } from "./useSelectionRange";
import { ClinicalInlineText } from "./ClinicalText";
import { hasColorMarkup } from "../utils";

interface StructuredSoapEditorProps {
  draft: SoapEditorDraft;
  onChange: (draft: SoapEditorDraft) => void;
  compact?: boolean;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

const toneOptions: Array<{ value: ClinicalLineTone; label: string }> = [
  { value: "plain", label: "Normal" },
  { value: "important", label: "Important" },
  { value: "critical", label: "Critical" },
];

const objectiveKindOptions: Array<{ value: ClinicalLineKind; label: string }> = [
  { value: "vs", label: "V/S" },
  { value: "pe", label: "PE" },
  { value: "lab", label: "Lab" },
  { value: "image", label: "Image" },
  { value: "other", label: "Other" },
];

function cleanLines(lines: SoapEditorLine[]) {
  return lines.filter((line) => line.text.trim());
}

function asOrderLines(lines: SoapEditorLine[]) {
  return lines.map((line) => ({ ...line, kind: "task" as const, subtype: "order" as const }));
}

function asTaskLines(lines: SoapEditorLine[]) {
  return lines.map((line) => {
    const { subtype, ...rest } = line;
    return { ...rest, kind: "task" as const };
  });
}

function updateLine(lines: SoapEditorLine[], id: string, patch: Partial<SoapEditorLine>) {
  return lines.map((line) => (line.id === id ? { ...line, ...patch } : line));
}

function removeLine(lines: SoapEditorLine[], id: string, fallbackKind: ClinicalLineKind) {
  const next = lines.filter((line) => line.id !== id);
  return next.length > 0 ? next : [emptySoapEditorLine(fallbackKind)];
}

function moveLine(lines: SoapEditorLine[], id: string, direction: -1 | 1) {
  const index = lines.findIndex((line) => line.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= lines.length) return lines;
  const next = [...lines];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function editableTone(tone: ClinicalLineTone): ClinicalLineTone {
  return tone === "critical" || tone === "important" ? tone : "plain";
}

function SelectionColorToolbar({
  value,
  onChange,
  controlRef,
  getSelectionRange,
}: {
  value: string;
  onChange: (value: string) => void;
  controlRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  getSelectionRange: (valueLength: number) => { start: number; end: number } | null;
}) {
  const applySelection = (nextValue: string, start: number, selectedLength: number) => {
    onChange(nextValue);
    window.setTimeout(() => {
      const control = controlRef.current;
      if (!control) return;
      control.focus();
      control.setSelectionRange(start, start + selectedLength);
    }, 0);
  };

  const markColor = (color: ClinicalMarkColor) => {
    const range = getSelectionRange(value.length);
    if (!range) return;
    const selectedText = value.slice(range.start, range.end);
    applySelection(applyClinicalColorMarkup(value, range.start, range.end, color), range.start + `[[${color}:`.length, selectedText.length);
  };

  const clearColor = () => {
    const range = getSelectionRange(value.length);
    if (!range) return;
    applySelection(clearClinicalColorMarkupAtSelection(value, range.start, range.end), range.start, value.slice(range.start, range.end).length);
  };

  return (
    <div className="inline-color-toolbar" aria-label="Color selected text">
      {clinicalMarkColors.map((color) => (
        <button
          type="button"
          className={`inline-color-tool color-tool-${color}`}
          key={color}
          onMouseDown={(event) => {
            event.preventDefault();
            markColor(color);
          }}
          title={`Mark selected text ${color}`}
          aria-label={`Mark selected text ${color}`}
        />
      ))}
      <button
        type="button"
        className="inline-color-clear"
        onMouseDown={(event) => {
          event.preventDefault();
          clearColor();
        }}
        title="Clear selected color"
        aria-label="Clear selected color"
      >
        clear
      </button>
    </div>
  );
}

function LineEditor({
  line,
  showKind,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  onCompositionStart,
  onCompositionEnd,
}: {
  line: SoapEditorLine;
  showKind?: boolean;
  onChange: (line: SoapEditorLine) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { rememberSelection, getSelectionRange } = useSelectionRange(textareaRef);
  return (
    <div className={`structured-soap-line structured-soap-line-${line.tone}`}>
      <textarea
        ref={textareaRef}
        className="structured-soap-line-text"
        value={line.text}
        onChange={(event) => onChange({ ...line, text: event.target.value })}
        onSelect={rememberSelection}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        rows={1}
      />
      {hasColorMarkup(line.text) && (
        <div className="color-markup-preview" aria-label="Color preview">
          <ClinicalInlineText value={line.text} />
        </div>
      )}
      <div className="structured-soap-line-meta">
        <div className="structured-soap-line-selects">
          {showKind && (
            <select value={line.kind} onChange={(event) => onChange({ ...line, kind: event.target.value as ClinicalLineKind })} title="Line type" aria-label="Line type">
              {objectiveKindOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          <select
            value={editableTone(line.tone)}
            onChange={(event) => onChange({ ...line, tone: event.target.value as ClinicalLineTone })}
            title="Highlight level"
            aria-label="Highlight level"
          >
            {toneOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <SelectionColorToolbar
          value={line.text}
          onChange={(text) => onChange({ ...line, text })}
          controlRef={textareaRef}
          getSelectionRange={getSelectionRange}
        />
        <div className="structured-soap-line-actions">
          <button type="button" className="secondary compact-button" onClick={() => onChange({ ...line, tone: "important" })} title="Keep in Print">Keep</button>
          <button type="button" className="secondary compact-button" onClick={onMoveUp} title="Move up">Up</button>
          <button type="button" className="secondary compact-button" onClick={onMoveDown} title="Move down">Down</button>
          <button type="button" className="secondary compact-button" onClick={onRemove} title="Remove">Remove</button>
        </div>
      </div>
    </div>
  );
}

function SectionEditor({
  title,
  lines,
  fallbackKind,
  showKind = false,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  title: string;
  lines: SoapEditorLine[];
  fallbackKind: ClinicalLineKind;
  showKind?: boolean;
  onChange: (lines: SoapEditorLine[]) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}) {
  const visibleLines = lines.length > 0 ? lines : [emptySoapEditorLine(fallbackKind)];
  return (
    <section className="structured-soap-section">
      <div className="structured-soap-section-heading">
        <strong>{title}</strong>
        <button type="button" className="secondary compact-button" onClick={() => onChange([...visibleLines, emptySoapEditorLine(fallbackKind)])}>
          + Line
        </button>
      </div>
      {visibleLines.map((line) => (
        <LineEditor
          key={line.id}
          line={line}
          showKind={showKind}
          onChange={(nextLine) => onChange(updateLine(visibleLines, line.id, nextLine))}
          onRemove={() => onChange(removeLine(visibleLines, line.id, fallbackKind))}
          onMoveUp={() => onChange(moveLine(visibleLines, line.id, -1))}
          onMoveDown={() => onChange(moveLine(visibleLines, line.id, 1))}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
      ))}
    </section>
  );
}

function updateProblemLine(problem: SoapEditorProblem, lineId: string, nextLine: SoapEditorLine) {
  return {
    ...problem,
    lines: problem.lines.map((line) => (line.id === lineId ? nextLine : line)),
  };
}

function ProblemEditor({
  problem,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  onCompositionStart,
  onCompositionEnd,
}: {
  problem: SoapEditorProblem;
  index: number;
  onChange: (problem: SoapEditorProblem) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}) {
  const lines = problem.lines.length > 0 ? problem.lines : [emptySoapEditorLine("ap")];
  const titleRef = useRef<HTMLInputElement | null>(null);
  const { rememberSelection, getSelectionRange } = useSelectionRange(titleRef);
  return (
    <article className={`structured-soap-problem structured-soap-line-${problem.tone}`}>
      <div className="structured-soap-problem-heading">
        <div className="structured-soap-problem-title-row">
          <span className="structured-soap-problem-index">#{index + 1}</span>
          <input
            ref={titleRef}
            value={problem.title}
            onChange={(event) => onChange({ ...problem, title: event.target.value })}
            onSelect={rememberSelection}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Problem title"
          />
          <SelectionColorToolbar
            value={problem.title}
            onChange={(title) => onChange({ ...problem, title })}
            controlRef={titleRef}
            getSelectionRange={getSelectionRange}
          />
        </div>
        {hasColorMarkup(problem.title) && (
          <div className="color-markup-preview" aria-label="Color preview">
            <ClinicalInlineText value={problem.title} />
          </div>
        )}
        <div className="structured-soap-line-meta">
          <div className="structured-soap-line-selects">
            <select
              value={editableTone(problem.tone)}
              onChange={(event) => onChange({ ...problem, tone: event.target.value as ClinicalLineTone })}
              title="Problem highlight level"
              aria-label="Problem highlight level"
            >
              {toneOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="structured-soap-line-actions">
            <button type="button" className="secondary compact-button" onClick={() => onChange({ ...problem, tone: "important" })} title="Keep in Print">Keep</button>
            <button type="button" className="secondary compact-button" onClick={onMoveUp} title="Move problem up">Up</button>
            <button type="button" className="secondary compact-button" onClick={onMoveDown} title="Move problem down">Down</button>
            <button type="button" className="secondary compact-button" onClick={onRemove} title="Remove problem">Remove</button>
          </div>
        </div>
      </div>
      {lines.map((line) => (
        <LineEditor
          key={line.id}
          line={line}
          onChange={(nextLine) => onChange(updateProblemLine(problem, line.id, nextLine))}
          onRemove={() => onChange({ ...problem, lines: removeLine(lines, line.id, "ap") })}
          onMoveUp={() => onChange({ ...problem, lines: moveLine(lines, line.id, -1) })}
          onMoveDown={() => onChange({ ...problem, lines: moveLine(lines, line.id, 1) })}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
      ))}
      <button type="button" className="secondary compact-button" onClick={() => onChange({ ...problem, lines: [...lines, emptySoapEditorLine("ap")] })}>
        + A/P line
      </button>
    </article>
  );
}

function moveProblem(problems: SoapEditorProblem[], id: string, direction: -1 | 1) {
  const index = problems.findIndex((problem) => problem.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= problems.length) return problems;
  const next = [...problems];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function StructuredSoapEditor({
  draft,
  onChange,
  compact = false,
  onCompositionStart,
  onCompositionEnd,
}: StructuredSoapEditorProps) {
  const issues = lintSoapEditorDraft(draft);
  const updateDraft = (patch: Partial<SoapEditorDraft>) => onChange({ ...draft, ...patch });
  const problems = draft.apProblems.length > 0 ? draft.apProblems : [emptySoapEditorProblem()];
  const { orderLines, taskOnlyLines } = splitSoapEditorTaskLines(draft.taskLines);
  const applyOrderSummaries = (lines: MedicationOrderSummaryLine[]) => {
    const nextOrderLines = lines.map((line) => ({
      ...emptySoapEditorLine("task"),
      text: line.text,
      tone: line.tone,
      subtype: "order" as const,
    }));
    updateDraft({ taskLines: [...nextOrderLines, ...taskOnlyLines] });
  };

  return (
    <div className={compact ? "structured-soap-editor structured-soap-editor-compact" : "structured-soap-editor"}>
      <SectionEditor
        title="Header"
        lines={draft.headerLines}
        fallbackKind="header"
        onChange={(headerLines) => updateDraft({ headerLines: cleanLines(headerLines) })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <SectionEditor
        title="S"
        lines={draft.sLines}
        fallbackKind="s"
        onChange={(sLines) => updateDraft({ sLines })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <SectionEditor
        title="O"
        lines={draft.oLines}
        fallbackKind="other"
        showKind
        onChange={(oLines) => updateDraft({ oLines })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />

      <section className="structured-soap-section structured-soap-ap-section">
        <div className="structured-soap-section-heading">
          <strong>A/P</strong>
          <button type="button" className="secondary compact-button" onClick={() => updateDraft({ apProblems: [...problems, emptySoapEditorProblem()] })}>
            + Problem
          </button>
        </div>
        {problems.map((problem, index) => (
          <ProblemEditor
            key={problem.id}
            problem={problem}
            index={index}
            onChange={(nextProblem) => updateDraft({ apProblems: problems.map((item) => (item.id === problem.id ? nextProblem : item)) })}
            onRemove={() => updateDraft({ apProblems: problems.length > 1 ? problems.filter((item) => item.id !== problem.id) : [emptySoapEditorProblem()] })}
            onMoveUp={() => updateDraft({ apProblems: moveProblem(problems, problem.id, -1) })}
            onMoveDown={() => updateDraft({ apProblems: moveProblem(problems, problem.id, 1) })}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
          />
        ))}
      </section>

      <SectionEditor
        title={"\u85e5\u56d1"}
        lines={orderLines}
        fallbackKind="task"
        onChange={(nextOrderLines) => updateDraft({ taskLines: [...asOrderLines(nextOrderLines), ...taskOnlyLines] })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <MedicationOrderReviewPanel
        compact={compact}
        sourceText={orderLines.map((line) => line.text).join("\n")}
        onApply={applyOrderSummaries}
      />
      <SectionEditor
        title="Tasks"
        lines={taskOnlyLines}
        fallbackKind="task"
        onChange={(nextTaskLines) => updateDraft({ taskLines: [...orderLines, ...asTaskLines(nextTaskLines)] })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <SectionEditor
        title="DC"
        lines={draft.dcLines}
        fallbackKind="dc"
        onChange={(dcLines) => updateDraft({ dcLines })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />

      {issues.length > 0 && (
        <div className="structured-soap-lint">
          <strong>Format check</strong>
          {issues.map((issue) => (
            <div className={`structured-soap-lint-item structured-soap-lint-${issue.severity}`} key={issue.id}>
              {issue.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default StructuredSoapEditor;
