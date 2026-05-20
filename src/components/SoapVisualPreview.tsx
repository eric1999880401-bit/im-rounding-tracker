import type { ReactNode } from "react";
import { parseSoapText, soapTextWithDerivedHighlights } from "../soapDraft";
import { ClinicalText } from "./ClinicalText";
import { classifyClinicalLine, type ClinicalLineKind, type ClinicalLineTone } from "../clinicalLineClassifier";

interface SoapVisualPreviewProps {
  value: string;
  compact?: boolean;
}

function highlighted(value: string) {
  return soapTextWithDerivedHighlights(value);
}

function toneClass(tone: ClinicalLineTone) {
  return tone === "plain" ? "normal" : tone;
}

function VisualLine({ label, text, fallbackKind = "other" }: { label?: string; text: string; fallbackKind?: ClinicalLineKind }) {
  const classified = classifyClinicalLine(text, { fallbackKind });
  return (
    <div className={`soap-preview-line soap-preview-line-${classified.kind} soap-preview-line-${toneClass(classified.tone)}`}>
      {(label || classified.label) && <span className="soap-preview-line-label">{label || classified.label}</span>}
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
  ].filter((line) => classifyClinicalLine(line).tone === "critical").length;

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
          {draft.sLines.length > 0 ? draft.sLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="s" />) : <EmptyLine />}
        </Section>

        <Section title="O" badge={`${draft.oLines.length || 0}`}>
          {draft.oLines.length > 0 ? (
            draft.oLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} />)
          ) : (
            <EmptyLine />
          )}
        </Section>

        <Section title="A/P" badge={`${draft.apProblems.length || 0}`} important={draft.apProblems.length > 0}>
          {draft.apProblems.length > 0 ? (
            <div className="soap-preview-ap-list">
              {draft.apProblems.map((problem, index) => (
                <article
                  className={`soap-preview-problem soap-preview-line-${toneClass(classifyClinicalLine(`${problem.title} ${problem.lines.join(" ")}`, { fallbackKind: "ap" }).tone)}`}
                  key={`${problem.title}-${index}`}
                >
                  <div className="soap-preview-problem-title">
                    <span>#</span>
                    <ClinicalText value={highlighted(problem.title)} maxCharsPerLine={100} />
                  </div>
                  {problem.lines.length > 0 && (
                    <div className="soap-preview-problem-lines">
                      {problem.lines.map((line, lineIndex) => (
                        <VisualLine key={`${line}-${lineIndex}`} text={line} fallbackKind="ap" />
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
          {draft.taskLines.length > 0 ? draft.taskLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="task" />) : <EmptyLine text="No pending task" />}
        </Section>

        <Section title="DC" badge={`${draft.dcLines.length || 0}`}>
          {draft.dcLines.length > 0 ? draft.dcLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="dc" />) : <EmptyLine text="No DC item" />}
        </Section>
      </div>
    </div>
  );
}
