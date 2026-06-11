import { ClinicalInlineText } from "./ClinicalText";
import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import { formatLabVisualSummaryLinesFromText } from "../labVisualSummary";
import {
  classifyPrintVisualItem,
  selectPriorityPrintItems,
  type PrintVisualKind,
} from "../printPriority";
import { parseSoapText } from "../soapDraft";
import type { KeywordHighlightRule, RoundingLayoutPreferences } from "../types";
import {
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
  isOrderSoapLine,
  stripOrderLinePrefix,
} from "../userPreferences";

interface SoapPrintPreviewProps {
  value: string;
  layoutPreferences?: RoundingLayoutPreferences;
  keywordRules?: KeywordHighlightRule[];
}

function printItems(lines: string[], fallbackKind: PrintVisualKind, maxItems: number, maxChars: number) {
  return selectPriorityPrintItems(lines, { fallbackKind, maxItems, maxChars });
}

function PrintVisualRows({
  lines,
  fallbackKind,
  keywordRules = [],
}: {
  lines: string[];
  fallbackKind: PrintVisualKind;
  keywordRules?: KeywordHighlightRule[];
}) {
  if (lines.length === 0) return <span className="muted">-</span>;

  return (
    <div className="soap-print-preview-rows">
      {lines.map((line, index) => {
        const visual = classifyPrintVisualItem({ raw: line, text: line }, fallbackKind);
        const label = fallbackKind === "ap" && visual.label === "A/P" ? "" : visual.label;
        return (
          <div className={`print-visual-row print-visual-${visual.kind} print-visual-${visual.tone}`} key={`${line}-${index}`}>
            {label && <span className="print-visual-label">{label}</span>}
            <span className="print-visual-text">
              <ClinicalInlineText
                value={fallbackKind === "task" && isOrderSoapLine(line) ? stripOrderLinePrefix(visual.text) : visual.text}
                keywordRules={keywordRules}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PrintSection({
  title,
  lines,
  fallbackKind,
  keywordRules,
}: {
  title: string;
  lines: string[];
  fallbackKind: PrintVisualKind;
  keywordRules?: KeywordHighlightRule[];
}) {
  return (
    <section className="soap-print-preview-section">
      <div className="soap-print-preview-section-title">{title}</div>
      <PrintVisualRows lines={lines} fallbackKind={fallbackKind} keywordRules={keywordRules} />
    </section>
  );
}

export function SoapPrintPreview({ value, layoutPreferences, keywordRules = [] }: SoapPrintPreviewProps) {
  const draft = parseSoapText(value);
  const visibleObjective = draft.oLines.filter((line) => isObjectiveSoapLineVisible(line, layoutPreferences));
  const labLines = visibleObjective.filter((line) => /^!{0,2}\s*Labs?\s*[:：]/i.test(line));
  const nonLabObjective = visibleObjective.filter((line) => !/^!{0,2}\s*Labs?\s*[:：]/i.test(line));
  const labVisualLines = formatLabVisualSummaryLinesFromText(labLines.join("\n"), {
    maxGroups: 7,
    maxItemsPerGroup: 8,
    maxCharsPerGroup: 180,
  }).map((line) => `Lab: ${line}`);

  const visibleTasks = draft.taskLines.filter((line) => isLayoutSectionVisible(layoutPreferences, "tasks") || isOrderSoapLine(line));
  const orderLines = visibleTasks.filter(isOrderSoapLine);
  const displayedOrders = isLayoutSectionVisible(layoutPreferences, "orders")
    ? formatMedicationOrderLinesForDisplay(orderLines, layoutPreferences?.orderDisplayMode ?? "summary", 6)
    : [];
  const taskLines = isLayoutSectionVisible(layoutPreferences, "tasks") ? visibleTasks.filter((line) => !isOrderSoapLine(line)) : [];
  const dcLines = draft.dcLines.filter((line) => isDcSoapLineVisible(line, layoutPreferences)).map((line) => `DC: ${line}`);
  const apLines = draft.apProblems.map((problem) => [problem.title, ...problem.lines].filter(Boolean).join(": "));

  return (
    <div className="soap-print-preview">
      <div className="soap-print-preview-topbar">
        <span className="board-label">Print preview</span>
        <strong>Same priority selector as Print List</strong>
      </div>
      <div className="soap-print-preview-header">
        {draft.header.slice(0, 5).map((line, index) => (
          <span key={`${line}-${index}`}>
            <ClinicalInlineText value={line} keywordRules={keywordRules} />
          </span>
        ))}
      </div>
      <div className="soap-print-preview-grid">
        {isLayoutSectionVisible(layoutPreferences, "subjective") && (
          <PrintSection
            title="S"
            fallbackKind="s"
            lines={printItems(draft.sLines, "s", 3, 120).map((item) => item.text)}
            keywordRules={keywordRules}
          />
        )}
        <PrintSection
          title="O"
          fallbackKind="other"
          lines={[
            ...printItems(nonLabObjective, "other", 6, 130).map((item) => item.text),
            ...printItems(labVisualLines, "lab", 7, 180).map((item) => item.text),
          ]}
          keywordRules={keywordRules}
        />
        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && (
          <PrintSection
            title="A/P"
            fallbackKind="ap"
            lines={printItems(apLines, "ap", 6, 180).map((item) => item.text)}
            keywordRules={keywordRules}
          />
        )}
        <PrintSection
          title="藥囑 / Tasks / DC"
          fallbackKind="task"
          lines={printItems([...displayedOrders, ...taskLines, ...dcLines], "task", 10, 150).map((item) => item.text)}
          keywordRules={keywordRules}
        />
      </div>
    </div>
  );
}

export default SoapPrintPreview;
