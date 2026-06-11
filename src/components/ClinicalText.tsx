import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { HighlightLine, KeywordHighlightRule } from "../types";
import { hasColorMarkup, safeClinicalLine, safeClinicalLinePreservingMarks, splitHighlightLines } from "../utils";
import { classifyClinicalLine, normalizeClinicalDisplayTextPreservingMarks } from "../clinicalLineClassifier";
import { applyUserKeywordHighlights, clinicalMarkPattern } from "../clinicalColorMarkup";
import { parseClinicalLabTokens } from "../labReference";

export type LabReferenceDisplayMode = "none" | "inline" | "detail" | "tooltip";

interface ClinicalTextProps {
  value: string;
  fallback?: string;
  maxLines?: number;
  maxCharsPerLine?: number;
  importantDefault?: boolean;
  keywordRules?: KeywordHighlightRule[];
  labReferenceDisplay?: LabReferenceDisplayMode;
}

function shortenText(text: string, maxChars?: number) {
  if (!maxChars) return text;
  return hasColorMarkup(text) ? safeClinicalLinePreservingMarks(text, maxChars) : safeClinicalLine(text, maxChars);
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

function renderLabReferenceText(text: string, display: LabReferenceDisplayMode = "none") {
  if (display === "none") return <span>{text}</span>;
  const tokens = parseClinicalLabTokens(text).filter((token) => token.confidence === "high");
  if (tokens.length === 0) return <span>{text}</span>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token) => {
    if (token.start > cursor) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor, token.start)}</span>);
    parts.push(<LabValueSpan display={display} key={`${token.raw}-${token.start}`} referenceLabel={token.canonicalLabel} referenceText={token.reference} token={token.raw} />);
    cursor = token.end;
  });
  if (cursor < text.length) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return parts.length > 0 ? parts : <span>{text}</span>;
}

function LabValueSpan({
  display,
  referenceLabel,
  referenceText,
  token,
}: {
  display: Exclude<LabReferenceDisplayMode, "none">;
  referenceLabel: string;
  referenceText: string;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = Boolean(referenceText) && display === "detail";
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
    <>
      <span
        className={`clinical-lab-value ${canOpen ? "clinical-lab-value-clickable" : ""}`}
        onClick={toggleOpen}
        onKeyDown={onKeyDown}
        role={canOpen ? "button" : undefined}
        tabIndex={canOpen ? 0 : undefined}
        aria-label={canOpen ? `${token} ${referenceText}` : undefined}
      >
        {token}
        {display === "inline" && referenceText && <span className="clinical-lab-ref-inline"> ({referenceText})</span>}
      </span>
      {open && referenceText && <span className="clinical-lab-ref-detail">Ref: {referenceLabel} {referenceText.replace(/^ref\s*/i, "")}</span>}
    </>
  );
}

function renderMarkedText(text: string, keywordRules: KeywordHighlightRule[] = [], labReferenceDisplay: LabReferenceDisplayMode = "none") {
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

function renderLines(lines: HighlightLine[], fallback: string, importantDefault = false, maxCharsPerLine?: number, keywordRules: KeywordHighlightRule[] = [], labReferenceDisplay: LabReferenceDisplayMode = "none") {
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
  labReferenceDisplay = "none",
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
  labReferenceDisplay?: LabReferenceDisplayMode;
}

export function ClinicalInlineText({ value, maxChars, keywordRules = [], labReferenceDisplay = "none" }: ClinicalInlineTextProps) {
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
          {item.trim().replace(/^!+\s*/, "")}
        </span>
      ))}
      {typeof maxItems === "number" && items.length > maxItems && (
        <span className="compact-item muted">+{items.length - maxItems}</span>
      )}
    </div>
  );
}
