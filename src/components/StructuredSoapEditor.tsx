import type { ClinicalLineKind, ClinicalLineTone } from "../clinicalLineClassifier";
import {
  emptySoapEditorLine,
  emptySoapEditorProblem,
  lintSoapEditorDraft,
  type SoapEditorDraft,
  type SoapEditorLine,
  type SoapEditorProblem,
} from "../soapEditorDraft";

interface StructuredSoapEditorProps {
  draft: SoapEditorDraft;
  onChange: (draft: SoapEditorDraft) => void;
  compact?: boolean;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

const toneOptions: Array<{ value: ClinicalLineTone; label: string }> = [
  { value: "plain", label: "Normal" },
  { value: "info", label: "Info" },
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
  return (
    <div className={`structured-soap-line structured-soap-line-${line.tone}`}>
      {showKind && (
        <select value={line.kind} onChange={(event) => onChange({ ...line, kind: event.target.value as ClinicalLineKind })} title="Line type">
          {objectiveKindOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <select value={line.tone} onChange={(event) => onChange({ ...line, tone: event.target.value as ClinicalLineTone })} title="Importance">
        {toneOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <textarea
        value={line.text}
        onChange={(event) => onChange({ ...line, text: event.target.value })}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        rows={1}
      />
      <div className="structured-soap-line-actions">
        <button type="button" className="secondary compact-button" onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="secondary compact-button" onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="secondary compact-button" onClick={onRemove} title="Remove">×</button>
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
  return (
    <article className={`structured-soap-problem structured-soap-line-${problem.tone}`}>
      <div className="structured-soap-problem-heading">
        <span className="structured-soap-problem-index">#{index + 1}</span>
        <select value={problem.tone} onChange={(event) => onChange({ ...problem, tone: event.target.value as ClinicalLineTone })} title="Problem importance">
          {toneOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={problem.title}
          onChange={(event) => onChange({ ...problem, title: event.target.value })}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder="Problem title"
        />
        <div className="structured-soap-line-actions">
          <button type="button" className="secondary compact-button" onClick={onMoveUp} title="Move problem up">↑</button>
          <button type="button" className="secondary compact-button" onClick={onMoveDown} title="Move problem down">↓</button>
          <button type="button" className="secondary compact-button" onClick={onRemove} title="Remove problem">×</button>
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
        title="Tasks"
        lines={draft.taskLines}
        fallbackKind="task"
        onChange={(taskLines) => updateDraft({ taskLines })}
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
