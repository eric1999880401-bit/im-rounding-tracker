import type { KeywordHighlightRule } from "./types";

export const clinicalMarkColors = ["red", "orange", "yellow", "blue", "green", "purple"] as const;

export type ClinicalMarkColor = (typeof clinicalMarkColors)[number];

export const clinicalMarkPattern = /\[\[(red|orange|yellow|blue|green|purple)(?:-(highlight|text))?:([\s\S]*?)\]\]/gi;

export function stripClinicalColorMarkup(value: string) {
  return String(value ?? "").replace(clinicalMarkPattern, "$3");
}

export function applyClinicalColorMarkup(value: string, start: number, end: number, color: ClinicalMarkColor) {
  const source = String(value ?? "");
  if (start === end) return source;
  const selectedText = source.slice(start, end);
  const fullMark = selectedText.match(/^\[\[(red|orange|yellow|blue|green|purple)(?:-(highlight|text))?:([\s\S]*?)\]\]$/i);
  const innerText = stripClinicalColorMarkup(fullMark?.[3] ?? selectedText);
  return `${source.slice(0, start)}[[${color}:${innerText}]]${source.slice(end)}`;
}

export function clearClinicalColorMarkupAtSelection(value: string, start: number, end: number) {
  const source = String(value ?? "");
  if (start === end) return source;

  const pattern = new RegExp(clinicalMarkPattern.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const fullStart = match.index;
    const fullEnd = fullStart + match[0].length;
    const styleSuffix = match[2] ? `-${match[2]}` : "";
    const innerStart = fullStart + `[[${match[1]}${styleSuffix}:`.length;
    const innerEnd = fullEnd - 2;
    if (start >= innerStart && end <= innerEnd) {
      return `${source.slice(0, fullStart)}${match[3]}${source.slice(fullEnd)}`;
    }
  }

  return `${source.slice(0, start)}${stripClinicalColorMarkup(source.slice(start, end))}${source.slice(end)}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(rule: KeywordHighlightRule) {
  const escaped = escapeRegExp(rule.pattern.trim());
  if (!escaped) return null;
  if (rule.matchMode === "exact") {
    const needsBoundaries = /^[A-Za-z0-9]+$/.test(rule.pattern);
    return new RegExp(needsBoundaries ? `\\b${escaped}\\b` : escaped, "g");
  }
  return new RegExp(escaped, rule.matchMode === "contains" ? "g" : "gi");
}

function markSegment(value: string, rules: KeywordHighlightRule[]) {
  if (!value || rules.length === 0) return value;
  const ranges: Array<{ start: number; end: number; rule: KeywordHighlightRule }> = [];
  rules
    .filter((rule) => rule.enabled && rule.pattern.trim())
    .sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length)
    .forEach((rule) => {
      const pattern = keywordPattern(rule);
      if (!pattern) return;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value))) {
        const start = match.index;
        const end = start + match[0].length;
        if (start === end) {
          pattern.lastIndex += 1;
          continue;
        }
        if (ranges.some((range) => start < range.end && end > range.start)) continue;
        ranges.push({ start, end, rule });
      }
    });

  if (ranges.length === 0) return value;
  ranges.sort((a, b) => a.start - b.start);
  let output = "";
  let cursor = 0;
  ranges.forEach((range) => {
    output += value.slice(cursor, range.start);
    const styleSuffix = range.rule.style === "text" ? "-text" : "";
    output += `[[${range.rule.color}${styleSuffix}:${value.slice(range.start, range.end)}]]`;
    cursor = range.end;
  });
  return output + value.slice(cursor);
}

export function applyUserKeywordHighlights(value: string, rules: KeywordHighlightRule[] = []) {
  if (!rules.some((rule) => rule.enabled && rule.pattern.trim())) return String(value ?? "");
  const source = String(value ?? "");
  const output: string[] = [];
  const pattern = new RegExp(clinicalMarkPattern.source, "gi");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    output.push(markSegment(source.slice(cursor, match.index), rules));
    output.push(match[0]);
    cursor = match.index + match[0].length;
  }
  output.push(markSegment(source.slice(cursor), rules));
  return output.join("");
}
