import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { HighlightLine, KeywordHighlightRule } from "../types";
import { safeClinicalLine, splitHighlightLines } from "../utils";
import { classifyClinicalLine, normalizeClinicalDisplayTextPreservingMarks } from "../clinicalLineClassifier";
import { applyUserKeywordHighlights, clinicalMarkPattern } from "../clinicalColorMarkup";
import { labReferenceText } from "../labReference";

interface ClinicalTextProps {
  value: string;
  fallback?: string;
  maxLines?: number;
  maxCharsPerLine?: number;
  importantDefault?: boolean;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: "none" | "tooltip" | "inline";
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
  return normalizeClinicalDisplayTextPreservingMarks(text);
}

const colorClassNames: Record<string, string> = {
  red: "clinical-mark-red",
  orange: "clinical-mark-orange",
  yellow: "clinical-mark-yellow",
  blue: "clinical-mark-blue",
  green: "clinical-mark-green",
  purple: "clinical-mark-purple",
};

function renderLabReferenceText(text: string, display: "none" | "tooltip" | "inline" = "none") {
  if (display === "none") return <span>{text}</span>;
  const pattern = /\b(WBC|Hb|Hgb|Plt|Neu|Na|K|Cr|BUN|AST|ALT|INR|CRP|Lactate|Glucose)\s*[:=]?\s*([<>]?\d+(?:\.\d+)?)\b/gi;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor, match.index)}</span>);
    const label = match[1] === "Hgb" ? "Hb" : match[1];
    const ref = labReferenceText(label);
    const token = text.slice(match.index, match.index + match[0].length);
    parts.push(<LabValueSpan display={display} key={`${token}-${match.index}`} referenceText={ref} token={token} />);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return parts.length > 0 ? parts : <span>{text}</span>;
}

function LabValueSpan({
  display,
  referenceText,
  token,
}: {
  display: "tooltip" | "inline";
  referenceText: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = Boolean(referenceText);
  const toggleOpen = () => {
    if (canOpen) setOpen((value) => !value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!canOpen) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen();
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <span
      className={`clinical-lab-value ${canOpen ? "clinical-lab-value-clickable" : ""}`}
      onClick={toggleOpen}
      onKeyDown={onKeyDown}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      title={referenceText || undefined}
    >
      {token}
      {display === "inline" && referenceText && <span className="clinical-lab-ref-inline"> ({referenceText})</span>}
      {open && referenceText && <span className="clinical-lab-popover">{referenceText}</span>}
    </span>
  );
}

function renderMarkedText(text: string, keywordRules: KeywordHighlightRule[] = [], labReferenceDisplay: "none" | "tooltip" | "inline" = "none") {
  const markedText = applyUserKeywordHighlights(text, keywordRules);
  const parts: Array<{ color?: string; style?: string; text: string }> = [];
  const pattern = new RegExp(clinicalMarkPattern.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markedText))) {
    if (match.index > cursor) {
      parts.push({ text: markedText.slice(cursor, match.index) });
    }
    parts.push({ color: match[1].toLowerCase(), style: match[2] || "highlight", text: match[3] });
    cursor = match.index + match[0].length;
  }

  if (cursor < markedText.length) {
    parts.push({ text: markedText.slice(cursor) });
  }

  return parts.map((part, index) =>
    part.color ? (
      <span className={`clinical-mark clinical-mark-${part.style} ${colorClassNames[part.color]}`} key={`${part.color}-${part.style}-${part.text}-${index}`}>
        {part.text}
      </span>
    ) : (
      <span key={`${part.text}-${index}`}>{renderLabReferenceText(part.text, labReferenceDisplay)}</span>
    ),
  );
}

function renderLines(lines: HighlightLine[], fallback: string, importantDefault = false, maxCharsPerLine?: number, keywordRules: KeywordHighlightRule[] = [], labReferenceDisplay: "none" | "tooltip" | "inline" = "none") {
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
          <span className="clinical-card-main">{renderMarkedText(displayText, keywordRules, labReferenceDisplay)}</span>
        </div>

        {line.children.map((child, childIndex) => (
          <div className="clinical-card-child" key={`${child.text}-${childIndex}`}>
            {arrowSymbol(child.text)} {renderMarkedText(stripArrow(child.text), keywordRules, labReferenceDisplay)}
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
  keywordRules = [],
  labReferenceDisplay = "tooltip",
}: ClinicalTextProps) {
  const lines = splitHighlightLines(value);
  const important = lines.filter((line) => line.important);
  const normal = lines.filter((line) => !line.important);
  const visibleLines = maxLines ? [...important, ...normal].slice(0, maxLines) : lines;

  return <>{renderLines(visibleLines, fallback, importantDefault, maxCharsPerLine, keywordRules, labReferenceDisplay)}</>;
}

export function ClinicalCardRenderer(props: ClinicalTextProps) {
  return <ClinicalText {...props} />;
}

interface ClinicalInlineTextProps {
  value: string;
  maxChars?: number;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: "none" | "tooltip" | "inline";
}

export function ClinicalInlineText({ value, maxChars, keywordRules = [], labReferenceDisplay = "tooltip" }: ClinicalInlineTextProps) {
  const hasMarks = /\[\[(?:red|orange|yellow|blue|green|purple)(?:-(?:highlight|text))?:/i.test(value);
  const text = maxChars && !hasMarks ? safeClinicalLine(value, maxChars) : value;
  return <>{renderMarkedText(displayClinicalText(text), keywordRules, labReferenceDisplay)}</>;
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
