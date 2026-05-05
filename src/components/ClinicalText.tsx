import type { HighlightLine } from "../types";
import { splitHighlightLines } from "../utils";

interface ClinicalTextProps {
  value: string;
  fallback?: string;
  maxLines?: number;
}

function groupLines(lines: HighlightLine[]) {
  const cards: Array<HighlightLine & { children: HighlightLine[] }> = [];

  lines.forEach((line) => {
    if (line.kind === "arrow" && cards.length > 0) {
      cards[cards.length - 1].children.push(line);
      return;
    }

    cards.push({ ...line, children: [] });
  });

  return cards;
}

function arrowSymbol(text: string) {
  return text.startsWith("=>") || text.startsWith("\u21d2") ? "\u21d2" : "\u2192";
}

function stripArrow(text: string) {
  return text.replace(/^(->|=>|\u2192|\u21d2)\s*/, "");
}

function renderLines(lines: HighlightLine[], fallback: string) {
  if (lines.length === 0) return <span className="muted">{fallback}</span>;

  return groupLines(lines).map((line, index) => {
    const numberMatch = line.text.match(/^(\d+)\.\s*(.*)$/);
    const displayText = numberMatch ? numberMatch[2] : line.kind === "arrow" ? stripArrow(line.text) : line.text;

    return (
      <div
        className={[
          "clinical-card",
          line.important ? "important-clinical-card" : "",
          line.kind === "dash" ? "clinical-dash-card" : "",
          line.kind === "arrow" ? "clinical-arrow-card" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={`${line.text}-${index}`}
      >
        <div className="clinical-card-main-row">
          {numberMatch && <span className="clinical-number-badge">{numberMatch[1]}</span>}
          {line.kind === "dash" && <span className="clinical-bullet">{"\u2022"}</span>}
          {line.kind === "arrow" && <span className="clinical-inline-arrow">{arrowSymbol(line.text)}</span>}
          <span className="clinical-card-main">{displayText}</span>
        </div>

        {line.children.map((child, childIndex) => (
          <div className="clinical-card-child" key={`${child.text}-${childIndex}`}>
            {arrowSymbol(child.text)} {stripArrow(child.text)}
          </div>
        ))}
      </div>
    );
  });
}

export function ClinicalText({ value, fallback = "-", maxLines }: ClinicalTextProps) {
  const lines = splitHighlightLines(value);
  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  const visibleLines = maxLines ? [...important, ...normal].slice(0, maxLines) : lines;

  return <>{renderLines(visibleLines, fallback)}</>;
}

export function ClinicalCardRenderer(props: ClinicalTextProps) {
  return <ClinicalText {...props} />;
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
