import type { HighlightLine } from "../types";
import { safeClinicalLine, splitHighlightLines } from "../utils";
import { classifyClinicalLine, normalizeClinicalDisplayText } from "../clinicalLineClassifier";

interface ClinicalTextProps {
  value: string;
  fallback?: string;
  maxLines?: number;
  maxCharsPerLine?: number;
  importantDefault?: boolean;
}

function shortenText(text: string, maxChars?: number) {
  return maxChars ? safeClinicalLine(text, maxChars) : text;
}

function groupLines(lines: HighlightLine[], maxCharsPerLine?: number) {
  const cards: Array<HighlightLine & { children: HighlightLine[] }> = [];

  lines.forEach((line) => {
    if (line.kind === "arrow" && cards.length > 0) {
      cards[cards.length - 1].children.push({ ...line, text: shortenText(line.text, maxCharsPerLine) });
      return;
    }

    cards.push({ ...line, text: shortenText(line.text, maxCharsPerLine), children: [] });
  });

  return cards;
}

function arrowSymbol(text: string) {
  return text.startsWith("=>") || text.startsWith("\u21d2") ? "\u21d2" : "\u2192";
}

function stripArrow(text: string) {
  return text.replace(/^(->|=>|\u2192|\u21d2)\s*/, "");
}

function displayClinicalText(text: string) {
  return normalizeClinicalDisplayText(text);
}

const colorClassNames: Record<string, string> = {
  red: "clinical-mark-red",
  orange: "clinical-mark-orange",
  yellow: "clinical-mark-yellow",
  blue: "clinical-mark-blue",
  green: "clinical-mark-green",
  purple: "clinical-mark-purple",
};

function renderMarkedText(text: string) {
  const parts: Array<{ color?: string; text: string }> = [];
  const pattern = /\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index) });
    }
    parts.push({ color: match[1].toLowerCase(), text: match[2] });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) });
  }

  return parts.map((part, index) =>
    part.color ? (
      <span className={`clinical-mark ${colorClassNames[part.color]}`} key={`${part.color}-${part.text}-${index}`}>
        {part.text}
      </span>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

function renderLines(lines: HighlightLine[], fallback: string, importantDefault = false, maxCharsPerLine?: number) {
  if (lines.length === 0) return <span className="muted">{fallback}</span>;

  return groupLines(lines, maxCharsPerLine).map((line, index) => {
    const numberMatch = line.text.match(/^(\d+)\.\s*(.*)$/);
    const rawDisplayText = numberMatch ? numberMatch[2] : line.kind === "arrow" ? stripArrow(line.text) : line.text;
    const displayText = displayClinicalText(rawDisplayText);
    const classified = classifyClinicalLine(rawDisplayText, {
      explicitTone: line.tone ?? (importantDefault ? "critical" : line.important ? "important" : undefined),
    });
    const tone = classified.tone;
    const isImportant = tone === "critical" || tone === "important";

    return (
      <div
        className={[
          "clinical-card",
          isImportant ? "important-clinical-card" : "",
          `clinical-tone-${tone}`,
          line.kind === "section" ? "clinical-section-card" : "",
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
          <span className="clinical-card-main">{renderMarkedText(displayText)}</span>
        </div>

        {line.children.map((child, childIndex) => (
          <div className="clinical-card-child" key={`${child.text}-${childIndex}`}>
            {arrowSymbol(child.text)} {renderMarkedText(stripArrow(child.text))}
          </div>
        ))}
      </div>
    );
  });
}

export function ClinicalText({
  value,
  fallback = "-",
  maxLines,
  maxCharsPerLine,
  importantDefault = false,
}: ClinicalTextProps) {
  const lines = splitHighlightLines(value);
  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  const visibleLines = maxLines ? [...important, ...normal].slice(0, maxLines) : lines;

  return <>{renderLines(visibleLines, fallback, importantDefault, maxCharsPerLine)}</>;
}

export function ClinicalCardRenderer(props: ClinicalTextProps) {
  return <ClinicalText {...props} />;
}

interface ItemListProps {
  items: string[];
  fallback?: string;
  maxItems?: number;
}

export function CompactItemList({ items, fallback = "-", maxItems }: ItemListProps) {
  const visibleItems = typeof maxItems === "number" ? items.slice(0, maxItems) : items;

  if (visibleItems.length === 0) return <span className="muted">{fallback}</span>;

  return (
    <div className="compact-items">
      {visibleItems.map((item) => (
        <span className={item.trim().startsWith("!") ? "compact-item important-line" : "compact-item"} key={item}>
          {item.trim().startsWith("!") ? item.trim().slice(1).trim() : item}
        </span>
      ))}
      {typeof maxItems === "number" && items.length > maxItems && (
        <span className="compact-item muted">+{items.length - maxItems}</span>
      )}
    </div>
  );
}
