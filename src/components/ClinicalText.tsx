import type { HighlightLine } from "../types";
import { splitHighlightLines } from "../utils";

interface ClinicalTextProps {
  value: string;
  fallback?: string;
  maxLines?: number;
}

function renderLines(lines: HighlightLine[], fallback: string) {
  if (lines.length === 0) return <span className="muted">{fallback}</span>;

  return lines.map((line, index) => (
    <div className={line.important ? "important-line" : ""} key={`${line.text}-${index}`}>
      {line.text}
    </div>
  ));
}

export function ClinicalText({ value, fallback = "-", maxLines }: ClinicalTextProps) {
  const lines = splitHighlightLines(value);
  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  const visibleLines = maxLines ? [...important, ...normal].slice(0, maxLines) : lines;

  return <>{renderLines(visibleLines, fallback)}</>;
}

interface ItemListProps {
  items: string[];
  fallback?: string;
  maxItems?: number;
}

export function CompactItemList({ items, fallback = "-", maxItems = 4 }: ItemListProps) {
  const visibleItems = items.slice(0, maxItems);

  if (visibleItems.length === 0) return <span className="muted">{fallback}</span>;

  return (
    <div className="compact-items">
      {visibleItems.map((item) => (
        <span className={item.trim().startsWith("!") ? "compact-item important-line" : "compact-item"} key={item}>
          {item.trim().startsWith("!") ? item.trim().slice(1).trim() : item}
        </span>
      ))}
      {items.length > maxItems && <span className="compact-item muted">+{items.length - maxItems}</span>}
    </div>
  );
}
