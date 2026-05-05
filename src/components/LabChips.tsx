import type { ParsedLabItem } from "../types";
import { formatLabItem, keyLabItems } from "../utils";

interface LabChipsProps {
  items: ParsedLabItem[];
  maxItems?: number;
}

export function LabChips({ items, maxItems = 8 }: LabChipsProps) {
  const visibleItems = keyLabItems(items, maxItems);

  if (visibleItems.length === 0) return <span className="muted">-</span>;

  return (
    <div className="lab-chip-row">
      {visibleItems.map((item, index) => {
        const formatted = formatLabItem(item);
        return (
          <span
            className={`lab-chip ${item.important || item.isImportant ? "important-lab-chip" : ""}`}
            key={`${formatted.label}-${formatted.value}-${index}`}
          >
            <span className="lab-chip-name">{formatted.label}</span>
            <span className="lab-chip-value">{formatted.value}</span>
            {item.unit && <span className="lab-chip-unit">{item.unit}</span>}
            {formatted.previous && <span className="lab-chip-prev">({formatted.previous})</span>}
          </span>
        );
      })}
    </div>
  );
}
