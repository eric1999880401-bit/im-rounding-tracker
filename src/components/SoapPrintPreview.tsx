import { formatMedicationOrderLinesForDisplay } from "../medicationOrderParser";
import {
  buildRoundNoteViewModel,
  makeRoundNoteLineView,
  selectRoundNoteLines,
  type RoundNoteLineView,
} from "../roundNoteViewModel";
import { soapHeaderLinesForDisplay } from "../soapDisplay";
import type { KeywordHighlightRule, RoundingLayoutPreferences } from "../types";
import {
  isDcSoapLineVisible,
  isLayoutSectionVisible,
  isObjectiveSoapLineVisible,
} from "../userPreferences";
import { ClinicalInlineText } from "./ClinicalText";
import { ClinicalLabTable } from "./ClinicalLabTable";

interface SoapPrintPreviewProps {
  value: string;
  layoutPreferences?: RoundingLayoutPreferences;
  keywordRules?: KeywordHighlightRule[];
  chronicRenal?: boolean;
}

function PrintVisualRows({
  lines,
  keywordRules = [],
}: {
  lines: RoundNoteLineView[];
  keywordRules?: KeywordHighlightRule[];
}) {
  if (lines.length === 0) return <span className="muted">-</span>;
  return (
    <div className="soap-print-preview-rows">
      {lines.map((line) => (
        <div className={`print-visual-row print-visual-${line.kind} print-visual-${line.tone}`} key={line.id}>
          {line.label && <span className="print-visual-label">{line.label}</span>}
          <span className="print-visual-text">
            <ClinicalInlineText value={line.text} keywordRules={keywordRules} />
          </span>
        </div>
      ))}
    </div>
  );
}

function PrintSection({
  title,
  lines,
  labLines = [],
  keywordRules,
}: {
  title: string;
  lines: RoundNoteLineView[];
  labLines?: RoundNoteLineView[];
  keywordRules?: KeywordHighlightRule[];
}) {
  return (
    <section className="soap-print-preview-section">
      <div className="soap-print-preview-section-title">{title}</div>
      <PrintVisualRows lines={lines} keywordRules={keywordRules} />
      {labLines.length > 0 && <ClinicalLabTable density="print" lines={labLines} keywordRules={keywordRules} />}
    </section>
  );
}

export function SoapPrintPreview({ value, layoutPreferences, keywordRules = [], chronicRenal = false }: SoapPrintPreviewProps) {
  const view = buildRoundNoteViewModel(value, { chronicRenal });
  const headerLines = soapHeaderLinesForDisplay(
    view.header.map((line) => line.raw),
    { dx: view.assessmentPlan.slice(0, 2).map((problem) => problem.title.text).filter(Boolean).join(" / ") },
    { maxLines: 5, maxChars: 150 },
  );
  const visibleObjective = view.objective.all.filter((line) => isObjectiveSoapLineVisible(line.raw, layoutPreferences));
  const visibleObjectiveLabs = visibleObjective.filter((line) => line.kind === "lab");
  const visibleObjectiveNonLabs = visibleObjective.filter((line) => line.kind !== "lab");
  const displayedOrders = isLayoutSectionVisible(layoutPreferences, "orders")
    ? formatMedicationOrderLinesForDisplay(
        view.orders.map((line) => line.raw),
        layoutPreferences?.orderDisplayMode ?? "summary",
        6,
      ).map((line, index) => makeRoundNoteLineView(line, "orders", "task", `print-order-${index}`, { chronicRenal }))
    : [];
  const taskLines = isLayoutSectionVisible(layoutPreferences, "tasks") ? view.tasks : [];
  const dcLines = view.dc.filter((line) => isDcSoapLineVisible(line.raw, layoutPreferences));
  const apLines = view.assessmentPlan.map((problem, index) =>
    makeRoundNoteLineView(
      [problem.title.text, ...problem.lines.map((line) => line.text)].filter(Boolean).join(": "),
      "assessmentPlan",
      "ap",
      `print-ap-${index}`,
      { chronicRenal },
    ),
  );

  return (
    <div className="soap-print-preview">
      <div className="soap-print-preview-topbar">
        <span className="board-label">Print preview</span>
        <strong>Canonical SOAP preview</strong>
      </div>
      <div className="soap-print-preview-header">
        {headerLines.map((line, index) => (
          <span key={`${line}-${index}`}><ClinicalInlineText value={line} keywordRules={keywordRules} /></span>
        ))}
      </div>
      <div className="soap-print-preview-grid">
        {isLayoutSectionVisible(layoutPreferences, "subjective") && (
          <PrintSection title="S" lines={selectRoundNoteLines(view.subjective, 3)} keywordRules={keywordRules} />
        )}
        <PrintSection
          title="O"
          lines={selectRoundNoteLines(visibleObjectiveNonLabs, 6)}
          labLines={visibleObjectiveLabs}
          keywordRules={keywordRules}
        />
        {isLayoutSectionVisible(layoutPreferences, "assessmentPlan") && (
          <PrintSection title="A/P" lines={selectRoundNoteLines(apLines, 6)} keywordRules={keywordRules} />
        )}
        <PrintSection
          title="藥囑 / Tasks / DC"
          lines={selectRoundNoteLines([...displayedOrders, ...taskLines, ...dcLines], 12)}
          keywordRules={keywordRules}
        />
      </div>
    </div>
  );
}

export default SoapPrintPreview;
