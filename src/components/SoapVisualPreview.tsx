import type { ReactNode } from "react";
import { parseSoapText, soapTextWithDerivedHighlights } from "../soapDraft";
import { ClinicalText } from "./ClinicalText";

interface SoapVisualPreviewProps {
  value: string;
  compact?: boolean;
}

type Tone = "critical" | "important" | "normal";

function toneForLine(line: string): Tone {
  if (
    /\b(shock|sepsis|hypotension|desat|hypox|active bleed|melena|hematemesis|stroke|ich|neutropenic fever|lactate|troponin|mrsa|enterococcus|positive culture|b\/c|bcx)\b/i.test(
      line,
    ) ||
    /\b(k\s*(?:<\s*3|>\s*5\.5)|hb\s*(?:<\s*8|drop)|wbc\s*(?:>\s*12|<\s*3)|cr\s*(?:>\s*2))\b/i.test(line)
  ) {
    return "critical";
  }
  if (/\b(teicoplanin|vancomycin|cef|zosyn|pip\/tazo|meropenem|abx|antibiotic|culture|pending|f\/u|repeat|consult|source control|j-tube|dc|discharge)\b/i.test(line)) {
    return "important";
  }
  return "normal";
}

function classifyObjective(line: string) {
  if (/^(?:v\/s|vs|vitals?)\s*:/i.test(line) || /\bBP\b|\bSpO2\b|\bHR\b|\bRR\b|\bT\s*\d/i.test(line)) return "V/S";
  if (/^(?:pe|physical exam)\s*:/i.test(line)) return "PE";
  if (/^lab\s*:/i.test(line) || /\b(wbc|hb|hgb|plt|cr|bun|na|k\b|ca|mg|phos|lactate|crp|culture|b\/c|bcx)\b/i.test(line)) return "LAB";
  if (/^(?:image|img)\s*:/i.test(line) || /\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|egd|scope)\b/i.test(line)) return "IMG";
  return "O";
}

function highlighted(value: string) {
  return soapTextWithDerivedHighlights(value);
}

function VisualLine({ label, text }: { label?: string; text: string }) {
  const tone = toneForLine(text);
  return (
    <div className={`soap-preview-line soap-preview-line-${tone}`}>
      {label && <span className="soap-preview-line-label">{label}</span>}
      <div className="soap-preview-line-text">
        <ClinicalText value={highlighted(text)} maxCharsPerLine={140} />
      </div>
    </div>
  );
}

function Section({
  title,
  badge,
  children,
  important = false,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  important?: boolean;
}) {
  return (
    <section className={important ? "soap-preview-section soap-preview-section-important" : "soap-preview-section"}>
      <div className="soap-preview-section-heading">
        <span>{title}</span>
        {badge && <strong>{badge}</strong>}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ text = "No entry" }: { text?: string }) {
  return <span className="muted soap-preview-empty">{text}</span>;
}

export function SoapVisualPreview({ value, compact = false }: SoapVisualPreviewProps) {
  const draft = parseSoapText(value);
  const redCount = [
    ...draft.sLines,
    ...draft.oLines,
    ...draft.taskLines,
    ...draft.dcLines,
    ...draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
  ].filter((line) => toneForLine(line) === "critical").length;

  return (
    <div className={compact ? "soap-visual-preview compact-soap-visual-preview" : "soap-visual-preview"}>
      <div className="soap-preview-topbar">
        <div>
          <div className="board-label">Highlighted preview</div>
          <strong>Round SOAP</strong>
        </div>
        <span className={redCount > 0 ? "soap-preview-risk-pill active-risk-pill" : "soap-preview-risk-pill"}>
          {redCount > 0 ? `${redCount} high-yield` : "stable scan"}
        </span>
      </div>

      {draft.header.length > 0 && (
        <div className="soap-preview-header">
          {draft.header.slice(0, 4).map((line, index) => (
            <span key={`${line}-${index}`}>{line}</span>
          ))}
        </div>
      )}

      <div className="soap-preview-grid">
        <Section title="S" badge={`${draft.sLines.length || 0}`}>
          {draft.sLines.length > 0 ? draft.sLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} />) : <EmptyLine />}
        </Section>

        <Section title="O" badge={`${draft.oLines.length || 0}`}>
          {draft.oLines.length > 0 ? (
            draft.oLines.map((line, index) => <VisualLine key={`${line}-${index}`} label={classifyObjective(line)} text={line} />)
          ) : (
            <EmptyLine />
          )}
        </Section>

        <Section title="A/P" badge={`${draft.apProblems.length || 0}`} important={draft.apProblems.length > 0}>
          {draft.apProblems.length > 0 ? (
            <div className="soap-preview-ap-list">
              {draft.apProblems.map((problem, index) => (
                <article className={`soap-preview-problem soap-preview-line-${toneForLine(`${problem.title} ${problem.lines.join(" ")}`)}`} key={`${problem.title}-${index}`}>
                  <div className="soap-preview-problem-title">
                    <span>#</span>
                    <ClinicalText value={highlighted(problem.title)} maxCharsPerLine={100} />
                  </div>
                  {problem.lines.length > 0 && (
                    <div className="soap-preview-problem-lines">
                      {problem.lines.map((line, lineIndex) => (
                        <VisualLine key={`${line}-${lineIndex}`} text={line} />
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyLine />
          )}
        </Section>

        <Section title="Tasks" badge={`${draft.taskLines.length || 0}`}>
          {draft.taskLines.length > 0 ? draft.taskLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} />) : <EmptyLine text="No pending task" />}
        </Section>

        <Section title="DC" badge={`${draft.dcLines.length || 0}`}>
          {draft.dcLines.length > 0 ? draft.dcLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} />) : <EmptyLine text="No DC item" />}
        </Section>
      </div>
    </div>
  );
}
