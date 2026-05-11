import type { AssessmentPlanItem } from "../types";
import { ClinicalText } from "./ClinicalText";

interface AssessmentPlanDisplayProps {
  items: AssessmentPlanItem[];
  legacyAssessment?: string;
  legacyPlan?: string;
  compact?: boolean;
  micro?: boolean;
}

function orderedItems(items: AssessmentPlanItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

function visibleItems(items: AssessmentPlanItem[], compact: boolean, micro: boolean) {
  const sorted = orderedItems(items);
  if (!compact) return sorted;
  const important = sorted.filter((item) => item.isImportant);
  const rest = sorted.filter((item) => !item.isImportant && item.category !== "underlyingDisease");
  const underlying = sorted.filter((item) => !item.isImportant && item.category === "underlyingDisease");
  const compactItems = [...important, ...rest.slice(0, 2), ...underlying.slice(0, 1)];
  return micro ? compactItems.slice(0, 3) : compactItems;
}

function activeProblemNumber(items: AssessmentPlanItem[], item: AssessmentPlanItem) {
  return items.filter((entry) => entry.category === "activeProblem").indexOf(item) + 1;
}

function shortText(value: string, maxChars: number) {
  const firstClause = value.split(/[;。]/)[0]?.trim() || value.trim();
  if (firstClause.length <= maxChars) return firstClause;
  return `${firstClause.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function AssessmentPlanDisplay({
  items,
  legacyAssessment = "",
  legacyPlan = "",
  compact = false,
  micro = false,
}: AssessmentPlanDisplayProps) {
  const sortedItems = orderedItems(items);
  const renderedItems = visibleItems(items, compact, micro);

  if (sortedItems.length === 0) {
    return (
      <div className="ap-display">
        {legacyAssessment.trim() && (
          <div>
            <strong>A:</strong> <ClinicalText value={legacyAssessment} maxLines={compact ? 1 : undefined} />
          </div>
        )}
        {legacyPlan.trim() && (
          <div>
            <strong>P:</strong> <ClinicalText value={legacyPlan} maxLines={compact ? 1 : undefined} />
          </div>
        )}
        {!legacyAssessment.trim() && !legacyPlan.trim() && <span className="muted">-</span>}
      </div>
    );
  }

  const problemItems = renderedItems.filter((item) => item.category !== "underlyingDisease");
  const underlyingItems = renderedItems.filter((item) => item.category === "underlyingDisease");

  function renderItem(item: AssessmentPlanItem) {
    const number = item.category === "activeProblem" ? activeProblemNumber(sortedItems, item) : "";
    const evidence = compact ? item.evidenceOrCourseItems.slice(0, item.isImportant ? 2 : 1) : item.evidenceOrCourseItems;
    const plans = compact ? item.planItems.slice(0, item.isImportant ? 2 : 1) : item.planItems;
    const title = micro ? shortText(item.problemTitle || item.assessmentSummary || "-", 42) : item.problemTitle || item.assessmentSummary || "-";
    const summary = micro ? shortText(item.assessmentSummary, 72) : item.assessmentSummary;

    return (
      <article className={`ap-display-card ${item.isImportant ? "important-ap-card" : ""}`} key={item.id}>
        <div className="ap-display-title">
          {item.category === "activeProblem" ? (
            <span className="clinical-number-badge">{number}</span>
          ) : item.category === "other" ? (
            <span className="ap-section-label">Other</span>
          ) : (
            <span className="clinical-bullet">{"\u2022"}</span>
          )}
          <strong>{title}</strong>
        </div>
        {summary && item.problemTitle && (
          <ClinicalText value={summary} maxLines={compact ? 1 : undefined} maxCharsPerLine={micro ? 72 : undefined} />
        )}
        {evidence.map((line, index) => (
          <div className="ap-evidence-line" key={`${item.id}-e-${index}`}>
            {"\u2192"} <ClinicalText value={micro ? shortText(line, 58) : line} maxCharsPerLine={micro ? 58 : undefined} />
          </div>
        ))}
        {plans.length > 0 && (
          <div className="ap-plan-block">
            <strong>Plan:</strong>
            {plans.map((line, index) => (
              <div className="ap-plan-line" key={`${item.id}-p-${index}`}>
                {"\u2022"} <ClinicalText value={micro ? shortText(line, 58) : line} maxCharsPerLine={micro ? 58 : undefined} />
              </div>
            ))}
          </div>
        )}
        {compact && item.planItems.length > plans.length && (
          <span className="muted">+{item.planItems.length - plans.length} plan items</span>
        )}
      </article>
    );
  }

  return (
    <div className="ap-display">
      {problemItems.map(renderItem)}
      {underlyingItems.length > 0 && (
        <div className="ap-underlying-group">
          <div className="ap-section-label">Underlying disease</div>
          {underlyingItems.map(renderItem)}
        </div>
      )}
      {compact && sortedItems.length > renderedItems.length && (
        <span className="compact-item muted">+{sortedItems.length - renderedItems.length} A/P problems</span>
      )}
    </div>
  );
}

export default AssessmentPlanDisplay;
