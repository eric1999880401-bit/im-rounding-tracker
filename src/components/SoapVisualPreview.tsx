import { useMemo, type ReactNode } from "react";
import { parseSoapText, soapTextWithDerivedHighlights } from "../soapDraft";
import { deriveSoapEvidence, type SoapSourceFields } from "../soapEvidence";
import { ClinicalInlineText, ClinicalText, type LabReferenceDisplayMode } from "./ClinicalText";
import { classifyClinicalLine, normalizeClinicalDisplayTextPreservingMarks, type ClinicalLineKind, type ClinicalLineTone } from "../clinicalLineClassifier";
import { formatLabVisualSummaryLinesFromText } from "../labVisualSummary";
import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import type { KeywordHighlightRule, RoundingLayoutPreferences } from "../types";
import { hasColorMarkup } from "../utils";
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
  sourceFields?: SoapSourceFields;
  layoutPreferences?: RoundingLayoutPreferences;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
}

function highlighted(value: string) {
  return soapTextWithDerivedHighlights(value);
}

function toneClass(tone: ClinicalLineTone) {
  return tone === "plain" ? "normal" : tone;
}

function VisualLine({
  label,
  text,
  fallbackKind = "other",
  keywordRules = [],
  labReferenceDisplay = "none",
}: {
  label?: string;
  text: string;
  fallbackKind?: ClinicalLineKind;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
}) {
  const classified = classifyClinicalLine(text, { fallbackKind, lockKind: fallbackKind !== "other" });
  const isOrder = fallbackKind === "task" && isOrderSoapLine(text);
  const displayLabel = label || (isOrder ? "藥囑" : classified.label);
  const displayText = isOrder ? stripOrderLinePrefix(text) : text;
  return (
    <div className={`soap-preview-line soap-preview-line-${classified.kind} soap-preview-line-${toneClass(classified.tone)}`}>
      {displayLabel && <span className="soap-preview-line-label">{displayLabel}</span>}
      <div className="soap-preview-line-text">
        <ClinicalText value={highlighted(displayText)} maxCharsPerLine={140} keywordRules={keywordRules} labReferenceDisplay={labReferenceDisplay} />
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

export function SoapVisualPreview({ value, compact = false, sourceFields = {}, layoutPreferences, keywordRules = [], labReferenceDisplay = "none" }: SoapVisualPreviewProps) {
  const draft = parseSoapText(value);
  const evidence = useMemo(() => deriveSoapEvidence(value, sourceFields), [sourceFields, value]);
  const headerLines = draft.header.filter((line) => isSoapHeaderLineVisible(line, layoutPreferences));
  const sLines = isLayoutSectionVisible(layoutPreferences, "subjective") ? draft.sLines : [];
  const oLines = draft.oLines.filter((line) => isObjectiveSoapLineVisible(line, layoutPreferences));
  const objectiveLabLinePattern = /^!{0,2}\s*Labs?\s*[:：]/i;
  // Clinician-colored lab lines render verbatim (the lab visual summarizer cannot keep [[color:...]] marks).
  const objectiveLabLines = oLines.filter((line) => objectiveLabLinePattern.test(line) && !hasColorMarkup(line));
  const objectiveNonLabLines = oLines.filter((line) => !objectiveLabLinePattern.test(line) || hasColorMarkup(line));
  const labVisualLines = formatLabVisualSummaryLinesFromText(objectiveLabLines.join("\n"), {
    maxGroups: 7,
    maxItemsPerGroup: compact ? 6 : 10,
    maxCharsPerGroup: compact ? 140 : 180,
  });
  const displayObjectiveCount = objectiveNonLabLines.length + labVisualLines.length;
  const apProblems = isLayoutSectionVisible(layoutPreferences, "assessmentPlan") ? draft.apProblems : [];
  const orderLines = isLayoutSectionVisible(layoutPreferences, "orders")
    ? draft.taskLines.filter(isOrderSoapLine)
    : [];
  const displayOrderLines = formatMedicationOrderLinesForDisplay(orderLines, layoutPreferences?.orderDisplayMode ?? "summary", compact ? 4 : 6);
  const taskLines = isLayoutSectionVisible(layoutPreferences, "tasks")
    ? draft.taskLines.filter((line) => !isOrderSoapLine(line) && isTaskSoapLineVisible(line, layoutPreferences))
    : [];
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
    .join("; ");

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
            <span key={`${line}-${index}`}>
              <ClinicalInlineText value={normalizeClinicalDisplayTextPreservingMarks(line)} keywordRules={keywordRules} />
            </span>
          ))}
        </div>
      )}

      <div className="soap-preview-grid">
        {isLayoutSectionVisible(layoutPreferences, "subjective") && (
          <Section title="S" badge={`${sLines.length || 0}`}>
            {sLines.length > 0 ? (
              sLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="s" keywordRules={keywordRules} />)
            ) : (
              <EmptyLine />
            )}
          </Section>
        )}

        {hasObjectiveSections && (
          <Section title="O" badge={`${displayObjectiveCount || 0}`}>
            {displayObjectiveCount > 0 ? (
              <>
                {objectiveNonLabLines.map((line, index) => (
                  <VisualLine key={`${line}-${index}`} text={line} keywordRules={keywordRules} />
                ))}
                {labVisualLines.map((line, index) => (
                  <VisualLine key={`lab-visual-${line}-${index}`} label="LAB" text={line} fallbackKind="lab" keywordRules={keywordRules} labReferenceDisplay={labReferenceDisplay} />
                ))}
              </>
            ) : (
              <EmptyLine />
            )}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && layoutPreferences?.apDisplayMode === "merged" && (
          <Section title="A/P" badge={apProblems.length ? "merged" : "0"} important={apProblems.length > 0}>
            {mergedApLine ? <VisualLine text={mergedApLine} fallbackKind="ap" keywordRules={keywordRules} /> : <EmptyLine />}
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
                      <ClinicalText value={highlighted(problem.title)} maxCharsPerLine={100} keywordRules={keywordRules} />
                    </div>
                    {problem.lines.length > 0 && (
                      <div className="soap-preview-problem-lines">
                        {problem.lines.map((line, lineIndex) => (
                          <VisualLine key={`${line}-${lineIndex}`} text={line} fallbackKind="ap" keywordRules={keywordRules} />
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
            {displayOrderLines.length > 0 ? (
              displayOrderLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="task" keywordRules={keywordRules} />)
            ) : (
              <EmptyLine text={layoutPreferences?.orderDisplayMode === "collapsed" ? "藥囑已收起" : "無藥囑"} />
            )}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "tasks") && (
          <Section title="Tasks" badge={`${taskLines.length || 0}`}>
            {taskLines.length > 0 ? (
              taskLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="task" keywordRules={keywordRules} />)
            ) : (
              <EmptyLine text="No pending task" />
            )}
          </Section>
        )}

        {(isLayoutSectionVisible(layoutPreferences, "dcBarriers") || isLayoutSectionVisible(layoutPreferences, "dcPrep")) && (
          <Section title="DC" badge={`${dcLines.length || 0}`}>
            {dcLines.length > 0 ? (
              dcLines.map((line, index) => <VisualLine key={`${line}-${index}`} text={line} fallbackKind="dc" keywordRules={keywordRules} />)
            ) : (
              <EmptyLine text="No DC item" />
            )}
          </Section>
        )}
      </div>

      {!compact && (evidence.missingData.length > 0 || evidence.why.length > 0 || evidence.sourceRefs.length > 0) && (
        <details className="soap-evidence-details">
          <summary>Why / source / missing data</summary>
          {evidence.missingData.length > 0 && (
            <div className="soap-evidence-block">
              <strong>Missing data</strong>
              <ul>
                {evidence.missingData.map((item) => (
                  <li className={`soap-evidence-${item.severity}`} key={item.id}>
                    {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.why.length > 0 && (
            <div className="soap-evidence-block">
              <strong>Why highlighted</strong>
              <ul>
                {evidence.why.map((item) => (
                  <li key={item.id}>
                    {item.label}: {item.refs.map((ref) => ref.line).join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.sourceRefs.length > 0 && (
            <div className="soap-evidence-block">
              <strong>Source links</strong>
              <ul>
                {evidence.sourceRefs.map((ref, index) => (
                  <li key={`${ref.sourceField}-${ref.line}-${index}`}>
                    {ref.section.toUpperCase()} from {ref.sourceField}: {ref.excerpt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
