import type { ParsedLabItem } from "../types";
import { formatLabItem, interpretLabItem, keyLabItems } from "../utils";

interface LabChipsProps {
  items: ParsedLabItem[];
  maxItems?: number;
  showMoreCount?: boolean;
  onRemove?: (index: number) => void;
}

export function LabChips({ items, maxItems, showMoreCount = false, onRemove }: LabChipsProps) {
  const visibleItems = maxItems ? keyLabItems(items, maxItems) : keyLabItems(items, items.length);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  if (visibleItems.length === 0) return <span className="muted">-</span>;

  return (
    <div className="lab-chip-row">
      {visibleItems.map((item, index) => {
        const formatted = formatLabItem(item);
        const interpretation = interpretLabItem(item);
        const sourceIndex = items.indexOf(item);
        return (
          <span
            className={[
              "lab-chip",
              interpretation.important ? "important-lab-chip" : "",
              interpretation.severity !== "normal" ? `lab-chip-${interpretation.severity}` : "",
            ].filter(Boolean).join(" ")}
            key={`${formatted.label}-${formatted.value}-${index}`}
          >
            {interpretation.badge && <span className="lab-chip-flag">{interpretation.badge}</span>}
            <span className="lab-chip-name">{formatted.label}</span>
            <span className="lab-chip-value">{formatted.value}</span>
            {item.unit && <span className="lab-chip-unit">{item.unit}</span>}
            {formatted.previous && <span className="lab-chip-prev">({formatted.previous})</span>}
            {onRemove && (
              <button
                type="button"
                className="chip-remove-button"
                onClick={() => onRemove(sourceIndex)}
                title="Remove lab"
              >
                x
              </button>
            )}
          </span>
        );
      })}
      {showMoreCount && hiddenCount > 0 && <span className="lab-chip muted">+{hiddenCount} more</span>}
    </div>
  );
}
