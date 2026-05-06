import type { AssessmentPlanCategory, AssessmentPlanItem } from "../types";
import { emptyAssessmentPlanItem } from "../utils";
import ColorMarkupTextarea from "./ColorMarkupTextarea";
import { useT } from "../i18n";

interface AssessmentPlanBuilderProps {
  items: AssessmentPlanItem[];
  legacyAssessment: string;
  legacyPlan: string;
  onChange: (items: AssessmentPlanItem[]) => void;
  onLegacyAssessmentChange: (value: string) => void;
  onLegacyPlanChange: (value: string) => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function orderedItems(items: AssessmentPlanItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

function renumber(items: AssessmentPlanItem[]) {
  return items.map((item, index) => ({ ...item, order: index }));
}

function textLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseLegacyAssessmentPlan(assessment: string, plan: string) {
  const parsed: AssessmentPlanItem[] = [];
  let current: AssessmentPlanItem | null = null;
  let category: AssessmentPlanCategory = "activeProblem";
  let planMode = false;

  function pushCurrent() {
    if (current && (current.problemTitle.trim() || current.assessmentSummary.trim())) {
      parsed.push(current);
    }
  }

  textLines(`${assessment}\n${plan ? `Plan:\n${plan}` : ""}`).forEach((line) => {
    const section = line.match(/^=+(.+?)=+$/);
    if (section) {
      pushCurrent();
      current = null;
      planMode = false;
      category = /underlying/i.test(section[1]) ? "underlyingDisease" : "other";
      return;
    }

    if (/^plan:?$/i.test(line)) {
      planMode = true;
      return;
    }

    const numbered = line.match(/^\d+\.\s*(.*)$/);
    if (numbered) {
      pushCurrent();
      current = { ...emptyAssessmentPlanItem(parsed.length), problemTitle: numbered[1], category };
      planMode = false;
      return;
    }

    const arrow = line.match(/^(->|=>|\u2192|\u21d2|-)\s*(.*)$/);
    if (arrow) {
      if (!current) current = { ...emptyAssessmentPlanItem(parsed.length), category };
      if (planMode || arrow[1] === "-") {
        current.planItems = [...current.planItems, arrow[2]];
      } else {
        current.evidenceOrCourseItems = [...current.evidenceOrCourseItems, arrow[2]];
      }
      return;
    }

    if (!current) current = { ...emptyAssessmentPlanItem(parsed.length), category };
    if (planMode) {
      current.planItems = [...current.planItems, line];
    } else if (!current.assessmentSummary) {
      current.assessmentSummary = line;
    } else {
      current.evidenceOrCourseItems = [...current.evidenceOrCourseItems, line];
    }
  });

  pushCurrent();
  return renumber(parsed);
}

function categoryLabel(category: AssessmentPlanCategory) {
  if (category === "activeProblem") return "Active problem";
  if (category === "underlyingDisease") return "Underlying disease";
  return "Other";
}

function AssessmentPlanBuilder({
  items,
  legacyAssessment,
  legacyPlan,
  onChange,
  onLegacyAssessmentChange,
  onLegacyPlanChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: AssessmentPlanBuilderProps) {
  const t = useT();
  const sortedItems = orderedItems(items);

  function updateItem(index: number, item: AssessmentPlanItem) {
    onChange(renumber(sortedItems.map((current, itemIndex) => (itemIndex === index ? item : current))));
  }

  function addProblem(category: AssessmentPlanCategory = "activeProblem") {
    onChange([...sortedItems, { ...emptyAssessmentPlanItem(sortedItems.length), category }]);
  }

  function deleteProblem(index: number) {
    onChange(renumber(sortedItems.filter((_, itemIndex) => itemIndex !== index)));
  }

  function moveProblem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sortedItems.length) return;
    const nextItems = [...sortedItems];
    [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
    onChange(renumber(nextItems));
  }

  function addTextItem(index: number, field: "evidenceOrCourseItems" | "planItems") {
    const item = sortedItems[index];
    updateItem(index, { ...item, [field]: [...item[field], ""] });
  }

  function updateTextItem(
    index: number,
    field: "evidenceOrCourseItems" | "planItems",
    itemIndex: number,
    value: string,
  ) {
    const item = sortedItems[index];
    updateItem(index, {
      ...item,
      [field]: item[field].map((current, currentIndex) => (currentIndex === itemIndex ? value : current)),
    });
  }

  function deleteTextItem(index: number, field: "evidenceOrCourseItems" | "planItems", itemIndex: number) {
    const item = sortedItems[index];
    updateItem(index, { ...item, [field]: item[field].filter((_, currentIndex) => currentIndex !== itemIndex) });
  }

  function importLegacy() {
    const parsed = parseLegacyAssessmentPlan(legacyAssessment, legacyPlan);
    if (parsed.length > 0) onChange(parsed);
  }

  return (
    <section className="ap-builder">
      <div className="objective-entry-heading">
        <strong>Problem-based A/P Builder</strong>
        <div className="ap-actions">
          <button type="button" onClick={() => addProblem("activeProblem")}>
            {t("ap.addProblem")}
          </button>
          <button type="button" className="secondary" onClick={() => addProblem("underlyingDisease")}>
            {t("ap.underlying")}
          </button>
        </div>
      </div>

      {sortedItems.length === 0 && <p className="muted">No structured A/P problems yet.</p>}

      {sortedItems.map((item, index) => (
        <article className={`ap-edit-card ${item.isImportant ? "important-ap-card" : ""}`} key={item.id || index}>
          <div className="ap-card-heading">
            <span className="clinical-number-badge">
              {item.category === "activeProblem" ? sortedItems.filter((entry) => entry.category === "activeProblem").indexOf(item) + 1 : categoryLabel(item.category)}
            </span>
            <select
              value={item.category}
              onChange={(event) => updateItem(index, { ...item, category: event.target.value as AssessmentPlanCategory })}
              onBlur={onFieldBlur}
            >
              <option value="activeProblem">Active problem</option>
              <option value="underlyingDisease">Underlying disease</option>
              <option value="other">Other</option>
            </select>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.isImportant}
                onChange={(event) => updateItem(index, { ...item, isImportant: event.target.checked })}
              />
              {t("ap.markImportant")}
            </label>
            <button type="button" className="secondary" onClick={() => moveProblem(index, -1)}>
              {t("ap.moveUp")}
            </button>
            <button type="button" className="secondary" onClick={() => moveProblem(index, 1)}>
              {t("ap.moveDown")}
            </button>
            <button type="button" className="secondary" onClick={() => deleteProblem(index)}>
              {t("action.delete")}
            </button>
          </div>

          <label>
            {t("ap.problemTitle")}
            <input
              value={item.problemTitle}
              onChange={(event) => updateItem(index, { ...item, problemTitle: event.target.value })}
              onBlur={onFieldBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </label>

          <label>
            {t("field.assessment")}
            <ColorMarkupTextarea
              value={item.assessmentSummary}
              onChange={(value) => updateItem(index, { ...item, assessmentSummary: value })}
              onBlur={onFieldBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </label>

          <div className="ap-subsection">
            <div className="objective-entry-heading">
              <strong>{t("ap.evidence")}</strong>
              <button type="button" className="secondary" onClick={() => addTextItem(index, "evidenceOrCourseItems")}>
                {t("ap.addEvidence")}
              </button>
            </div>
            {item.evidenceOrCourseItems.map((line, lineIndex) => (
              <div className="ap-line-editor" key={`${item.id}-evidence-${lineIndex}`}>
                <span className="clinical-inline-arrow">{"\u2192"}</span>
                <input
                  value={line}
                  onChange={(event) => updateTextItem(index, "evidenceOrCourseItems", lineIndex, event.target.value)}
                  onBlur={onFieldBlur}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => deleteTextItem(index, "evidenceOrCourseItems", lineIndex)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="ap-subsection">
            <div className="objective-entry-heading">
              <strong>{t("field.plan")}</strong>
              <button type="button" className="secondary" onClick={() => addTextItem(index, "planItems")}>
                {t("ap.addPlan")}
              </button>
            </div>
            {item.planItems.map((line, lineIndex) => (
              <div className="ap-line-editor" key={`${item.id}-plan-${lineIndex}`}>
                <span className="clinical-bullet">{"\u2022"}</span>
                <input
                  value={line}
                  onChange={(event) => updateTextItem(index, "planItems", lineIndex, event.target.value)}
                  onBlur={onFieldBlur}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={onCompositionEnd}
                />
                <button type="button" className="secondary" onClick={() => deleteTextItem(index, "planItems", lineIndex)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </article>
      ))}

      <details className="legacy-ap">
        <summary>Legacy free-text A/P</summary>
        <div className="form-grid">
          <label>
            A - Assessment
            <ColorMarkupTextarea
              value={legacyAssessment}
              onChange={onLegacyAssessmentChange}
              onBlur={onFieldBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </label>
          <label>
            P - Plan
            <ColorMarkupTextarea
              value={legacyPlan}
              onChange={onLegacyPlanChange}
              onBlur={onFieldBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </label>
        </div>
        <button type="button" className="secondary" onClick={importLegacy}>
          Import legacy text into problem cards
        </button>
      </details>
    </section>
  );
}

export default AssessmentPlanBuilder;
