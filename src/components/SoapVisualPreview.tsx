import { useMemo, type ReactNode } from "react";
import { normalizeClinicalDisplayTextPreservingMarks, type ClinicalLineTone } from "../clinicalLineClassifier";
import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import {
  buildRoundNoteViewModel,
  makeRoundNoteLineView,
  type RoundNoteLineView,
} from "../roundNoteViewModel";
import { soapHeaderLinesForDisplay } from "../soapDisplay";
import { deriveSoapEvidence, type SoapSourceFields } from "../soapEvidence";
import type { KeywordHighlightRule, RoundingLayoutPreferences } from "../types";
import {
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
  isSoapHeaderLineVisible,
  isTaskSoapLineVisible,
} from "../userPreferences";
import { ClinicalInlineText, ClinicalText, type LabReferenceDisplayMode } from "./ClinicalText";
import { ClinicalLabTable } from "./ClinicalLabTable";

interface SoapVisualPreviewProps {
  value: string;
  compact?: boolean;
  sourceFields?: SoapSourceFields;
  layoutPreferences?: RoundingLayoutPreferences;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
  chronicRenal?: boolean;
}

function toneClass(tone: ClinicalLineTone) {
  return tone === "plain" ? "normal" : tone;
}

function VisualLine({
  line,
  label,
  keywordRules = [],
  labReferenceDisplay = "none",
}: {
  line: RoundNoteLineView;
  label?: string;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
}) {
  const displayLabel = label ?? line.label;
  return (
    <div className={`soap-preview-line soap-preview-line-${line.kind} soap-preview-line-${toneClass(line.tone)}`}>
      {displayLabel && <span className="soap-preview-line-label">{displayLabel}</span>}
      <div className="soap-preview-line-text">
        <ClinicalText value={line.text} keywordRules={keywordRules} labReferenceDisplay={labReferenceDisplay} />
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

export function SoapVisualPreview({
  value,
  compact = false,
  sourceFields = {},
  layoutPreferences,
  keywordRules = [],
  labReferenceDisplay = "none",
  chronicRenal = false,
}: SoapVisualPreviewProps) {
  const view = useMemo(() => buildRoundNoteViewModel(value, { chronicRenal }), [chronicRenal, value]);
  const evidence = useMemo(() => deriveSoapEvidence(value, sourceFields), [sourceFields, value]);
  const headerLines = soapHeaderLinesForDisplay(
    view.header.map((line) => line.raw).filter((line) => isSoapHeaderLineVisible(line, layoutPreferences)),
    { dx: view.assessmentPlan.slice(0, 2).map((problem) => problem.title.text).filter(Boolean).join(" / ") },
    { maxLines: 4, maxChars: compact ? 110 : 140 },
  );
  const sLines = isLayoutSectionVisible(layoutPreferences, "subjective") ? view.subjective : [];
  const oLines = view.objective.all.filter((line) => isObjectiveSoapLineVisible(line.raw, layoutPreferences));
  const objectiveLabLines = oLines.filter((line) => line.kind === "lab");
  const objectiveNonLabLines = oLines.filter((line) => line.kind !== "lab");
  const apProblems = isLayoutSectionVisible(layoutPreferences, "assessmentPlan") ? view.assessmentPlan : [];
  const displayOrderLines = isLayoutSectionVisible(layoutPreferences, "orders")
    ? formatMedicationOrderLinesForDisplay(
        view.orders.map((line) => line.raw),
        layoutPreferences?.orderDisplayMode ?? "summary",
        compact ? 4 : 6,
      ).map((line, index) => makeRoundNoteLineView(line, "orders", "task", `display-order-${index}`, { chronicRenal }))
    : [];
  const taskLines = isLayoutSectionVisible(layoutPreferences, "tasks")
    ? view.tasks.filter((line) => isTaskSoapLineVisible(line.raw, layoutPreferences))
    : [];
  const dcLines = view.dc.filter((line) => isDcSoapLineVisible(line.raw, layoutPreferences));
  const hasObjectiveSections =
    isLayoutSectionVisible(layoutPreferences, "objectiveVitals") ||
    isLayoutSectionVisible(layoutPreferences, "objectivePhysicalExam") ||
    isLayoutSectionVisible(layoutPreferences, "objectiveLabs") ||
    isLayoutSectionVisible(layoutPreferences, "objectiveImages");
  const highYieldLines = [
    ...sLines,
    ...oLines,
    ...taskLines,
    ...dcLines,
    ...apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
  ];
  const redCount = highYieldLines.filter((line) => line.tone === "critical").length;
  const mergedApText = apProblems
    .map((problem) => [problem.title.text, ...problem.lines.map((line) => line.text)].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  const mergedApLine = makeRoundNoteLineView(mergedApText, "assessmentPlan", "ap", "merged-ap", { chronicRenal });

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
          <Section title="S" badge={`${sLines.length}`}>
            {sLines.length > 0
              ? sLines.map((line) => <VisualLine key={line.id} line={line} keywordRules={keywordRules} />)
              : <EmptyLine />}
          </Section>
        )}

        {hasObjectiveSections && (
          <Section title="O" badge={`${oLines.length}`}>
            {oLines.length > 0 ? (
              <>
                {objectiveNonLabLines.map((line) => (
                  <VisualLine key={line.id} line={line} keywordRules={keywordRules} />
                ))}
                {objectiveLabLines.length > 0 && (
                  <ClinicalLabTable
                    density={compact ? "board" : "detail"}
                    lines={objectiveLabLines}
                    keywordRules={keywordRules}
                    labReferenceDisplay={labReferenceDisplay}
                  />
                )}
              </>
            ) : <EmptyLine />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && layoutPreferences?.apDisplayMode === "merged" && (
          <Section title="A/P" badge={apProblems.length ? "merged" : "0"} important={apProblems.length > 0}>
            {mergedApText ? <VisualLine line={mergedApLine} keywordRules={keywordRules} /> : <EmptyLine />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && layoutPreferences?.apDisplayMode !== "merged" && (
          <Section title="A/P" badge={`${apProblems.length}`} important={apProblems.length > 0}>
            {apProblems.length > 0 ? (
              <div className="soap-preview-ap-list">
                {apProblems.map((problem) => (
                  <article className={`soap-preview-problem soap-preview-line-${toneClass(problem.title.tone)}`} key={problem.id}>
                    <div className="soap-preview-problem-title">
                      <span>#</span>
                      <ClinicalText value={problem.title.text} keywordRules={keywordRules} />
                    </div>
                    {problem.lines.length > 0 && (
                      <div className="soap-preview-problem-lines">
                        {problem.lines.map((line) => (
                          <VisualLine key={line.id} line={line} keywordRules={keywordRules} />
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : <EmptyLine />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "orders") && (
          <Section title="藥囑" badge={`${displayOrderLines.length}`}>
            {displayOrderLines.length > 0
              ? displayOrderLines.map((line) => <VisualLine key={line.id} line={line} keywordRules={keywordRules} />)
              : <EmptyLine text={layoutPreferences?.orderDisplayMode === "collapsed" ? "Medication orders collapsed" : "No medication orders"} />}
          </Section>
        )}

        {isLayoutSectionVisible(layoutPreferences, "tasks") && (
          <Section title="Tasks" badge={`${taskLines.length}`}>
            {taskLines.length > 0
              ? taskLines.map((line) => <VisualLine key={line.id} line={line} keywordRules={keywordRules} />)
              : <EmptyLine text="No pending task" />}
          </Section>
        )}

        {(isLayoutSectionVisible(layoutPreferences, "dcBarriers") || isLayoutSectionVisible(layoutPreferences, "dcPrep")) && (
          <Section title="DC" badge={`${dcLines.length}`}>
            {dcLines.length > 0
              ? dcLines.map((line) => <VisualLine key={line.id} line={line} keywordRules={keywordRules} />)
              : <EmptyLine text="No DC item" />}
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
                  <li className={`soap-evidence-${item.severity}`} key={item.id}>{item.message}</li>
                ))}
              </ul>
            </div>
          )}
          {evidence.why.length > 0 && (
            <div className="soap-evidence-block">
              <strong>Why highlighted</strong>
              <ul>
                {evidence.why.map((item) => (
                  <li key={item.id}>{item.label}: {item.refs.map((ref) => ref.line).join("; ")}</li>
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
