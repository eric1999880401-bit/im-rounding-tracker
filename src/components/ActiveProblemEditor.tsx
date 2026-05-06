import type { ActiveProblemItem } from "../types";
import { emptyActiveProblemItem, textToItems } from "../utils";
import { useT } from "../i18n";

interface ActiveProblemEditorProps {
  legacyText: string;
  items: ActiveProblemItem[];
  onLegacyTextChange: (value: string) => void;
  onItemsChange: (items: ActiveProblemItem[]) => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function ordered(items: ActiveProblemItem[]) {
  return [...items].sort((a, b) => a.order - b.order);
}

function renumber(items: ActiveProblemItem[]) {
  return items.map((item, index) => ({ ...item, order: index }));
}

function ActiveProblemEditor({
  legacyText,
  items,
  onLegacyTextChange,
  onItemsChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: ActiveProblemEditorProps) {
  const t = useT();
  const sortedItems = ordered(items);

  function updateItem(index: number, item: ActiveProblemItem) {
    onItemsChange(renumber(sortedItems.map((current, itemIndex) => (itemIndex === index ? item : current))));
  }

  function addItem() {
    onItemsChange([...sortedItems, emptyActiveProblemItem(sortedItems.length)]);
  }

  function deleteItem(index: number) {
    onItemsChange(renumber(sortedItems.filter((_, itemIndex) => itemIndex !== index)));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sortedItems.length) return;
    const nextItems = [...sortedItems];
    [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
    onItemsChange(renumber(nextItems));
  }

  function importLegacy() {
    const nextItems = textToItems(legacyText).map((title, index) => ({
      ...emptyActiveProblemItem(index),
      title,
    }));
    if (nextItems.length > 0) onItemsChange(nextItems);
  }

  return (
    <div className="active-problem-editor">
      <div className="objective-entry-heading">
        <strong>{t("field.activeProblems")}</strong>
        <button type="button" className="secondary" onClick={addItem}>
          {t("problem.add")}
        </button>
      </div>
      {sortedItems.map((item, index) => (
        <div className={`active-problem-row ${item.isImportant ? "important-ap-card" : ""}`} key={item.id || index}>
          <span className="clinical-number-badge">{index + 1}</span>
          <input
            value={item.title}
            onChange={(event) => updateItem(index, { ...item, title: event.target.value })}
            onBlur={onFieldBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Problem title"
          />
          <input
            value={item.note}
            onChange={(event) => updateItem(index, { ...item, note: event.target.value })}
            onBlur={onFieldBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Optional note"
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={item.isImportant}
              onChange={(event) => updateItem(index, { ...item, isImportant: event.target.checked })}
            />
            {t("ap.markImportant")}
          </label>
          <button type="button" className="secondary" onClick={() => moveItem(index, -1)}>
            {t("ap.moveUp")}
          </button>
          <button type="button" className="secondary" onClick={() => moveItem(index, 1)}>
            {t("ap.moveDown")}
          </button>
          <button type="button" className="secondary" onClick={() => deleteItem(index)}>
            {t("action.delete")}
          </button>
        </div>
      ))}
      {sortedItems.length === 0 && <p className="muted">No structured active problems yet.</p>}
      <details className="legacy-ap">
        <summary>Legacy active problems text</summary>
        <textarea
          value={legacyText}
          onChange={(event) => onLegacyTextChange(event.target.value)}
          onBlur={onFieldBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <button type="button" className="secondary" onClick={importLegacy}>
          Convert text to active problem list
        </button>
      </details>
    </div>
  );
}

export default ActiveProblemEditor;
