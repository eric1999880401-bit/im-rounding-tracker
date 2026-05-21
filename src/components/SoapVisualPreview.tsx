import type { ReactNode } from "react";
import { parseSoapText, soapTextWithDerivedHighlights } from "../soapDraft";
import { ClinicalText } from "./ClinicalText";
import { classifyClinicalLine, normalizeClinicalDisplayText, type ClinicalLineKind, type ClinicalLineTone } from "../clinicalLineClassifier";
import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import type { RoundingLayoutPreferences } from "../types";
import {
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
  isOrderSoapLine,
  isSoapHeaderLineVisible,
  isTaskSoapLineVisible,
  stripOrderLinePrefix,
} from "../userPreferences";

interface SoapVisualPreviewProps {
  value: string;
  compact?: boolean;
  layoutPreferences?: RoundingLayoutPreferences;
}

function highlighted(value: string) {
  return soapTextWithDerivedHighlights(value);
}

function toneClass(tone: ClinicalLineTone) {
  return tone === "plain" ? "normal" : tone;
}

function VisualLine({ label, text, fallbackKind = "other" }: { label?: string; text: string; fallbackKind?: ClinicalLineKind }) {
  const classified = classifyClinicalLine(text, { fallbackKind, lockKind: fallbackKind !== "other" });
  const isOrder = fallbackKind === "task" && isOrderSoapLine(text);
  const displayLabel = label || (isOrder ? "藥囑" : classified.label);
  const displayText = isOrder ? stripOrderLinePrefix(text) : text;
  return (
    <div className={`soap-preview-line soap-preview-line-${classified.kind} soap-preview-line-${toneClass(classified.tone)}`}>
      {displayLabel && <span className="soap-preview-line-label">{displayLabel}</span>}
      <div className="soap-preview-line-text">
        <ClinicalText value={highlighted(displayText)} maxCharsPerLine={140} />
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

export function SoapVisualPreview({ value, compact = false, layoutPreferences }: SoapVisualPreviewProps) {
  const draft = parseSoapText(value);
  const headerLines = draft.header.filter((line) => isSoapHeaderLineVisible(line, layoutPreferences));
  const sLines = isLayoutSectionVisible(layoutPreferences, "subjective") ? draft.sLines : [];
  const oLines = draft.oLines.filter((line) => isObjectiveSoapLineVisible(line, layoutPreferences));
  const apProblems = isLayoutSectionVisible(layoutPreferences, "assessmentPlan") ? draft.apProblems : [];
  const visibleTaskSourceLines = draft.taskLines.filter((line) => isTaskSoapLineVisible(line, layoutPreferences));
  const orderLines = visibleTaskSourceLines.filter(isOrderSoapLine);
  const displayOrderLines = formatMedicationOrderLinesForDisplay(orderLines, layoutPreferences?.orderDisplayMode ?? "summary", compact ? 4 : 6);
  const taskLines = visibleTaskSourceLines.filter((line) => !isOrderSoapLine(line));
  const dcLines = draft.dcLines.filter((line) => isDcSoapLineVisible(line, layoutPreferences));
  const hasObjectiveSections =
    isLayoutSectionVisible(layoutPreferences, "objectiveVitals") ||
    isLayoutSectionVisible(layoutPreferences, "objectivePhysicalExam") ||
    isLayoutSectionVisible(layoutPreferences, "objectiveLabs") ||
    isLayoutSectionVisible(layoutPreferences, "objectiveImages");
  const redCount = [
    ...sLines,
    ...oLines,
    ...taskLines,
    ...dcLines,
    ...apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
  ].filter((line) => classifyClinicalLine(line).tone === "critical").length;
  const mergedApLine = apProblems
    .map((problem) => [problem.title, ...problem.lines].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("； ");

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

      {headerLines.length > 0 && (
        <div className="soap-preview-header">
          {headerLines.slice(0, 4).map((line, index) => (
            <span key={`${line}-${index}`}>{normalizeClinicalDisplayText(line)}</span>
          ))}
        </div>
      )}

      <div className="soap-preview-grid">
        {isLayoutSectionVisible(layoutPreferences, "subjective") && (
          <Section title="S" badge={`${sLines.length || 0}`}>
            {sLines.length > 0 ? sLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="s" />) : <EmptyLine />}
          </Section>
        )}

        {hasObjectiveSections && (
          <Section title="O" badge={`${oLines.length || 0}`}>
            {oLines.length > 0 ? (
              oLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} />)
            ) : (
              <EmptyLine />
            )}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && layoutPreferences?.apDisplayMode === "merged" && (
          <Section title="A/P" badge={apProblems.length ? "merged" : "0"} important={apProblems.length > 0}>
            {mergedApLine ? <VisualLine text={mergedApLine} fallbackKind="ap" /> : <EmptyLine />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && layoutPreferences?.apDisplayMode !== "merged" && (
          <Section title="A/P" badge={`${apProblems.length || 0}`} important={apProblems.length > 0}>
            {apProblems.length > 0 ? (
              <div className="soap-preview-ap-list">
                {apProblems.map((problem, index) => (
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
        )}

        {isLayoutSectionVisible(layoutPreferences, "orders") && (
          <Section title="藥囑" badge={`${displayOrderLines.length || 0}`}>
            {displayOrderLines.length > 0 ? displayOrderLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="task" />) : <EmptyLine text={layoutPreferences?.orderDisplayMode === "collapsed" ? "藥囑已收起" : "無藥囑"} />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "tasks") && (
          <Section title="Tasks" badge={`${taskLines.length || 0}`}>
            {taskLines.length > 0 ? taskLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="task" />) : <EmptyLine text="No pending task" />}
          </Section>
        )}

        {(isLayoutSectionVisible(layoutPreferences, "dcBarriers") || isLayoutSectionVisible(layoutPreferences, "dcPrep")) && (
          <Section title="DC" badge={`${dcLines.length || 0}`}>
            {dcLines.length > 0 ? dcLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="dc" />) : <EmptyLine text="No DC item" />}
          </Section>
        )}
      </div>
    </div>
  );
}
