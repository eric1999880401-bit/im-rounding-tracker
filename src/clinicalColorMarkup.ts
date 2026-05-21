export const clinicalMarkColors = ["red", "orange", "yellow", "blue", "green", "purple"] as const;

export type ClinicalMarkColor = (typeof clinicalMarkColors)[number];

export const clinicalMarkPattern = /\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]/gi;

export function stripClinicalColorMarkup(value: string) {
  return String(value ?? "").replace(clinicalMarkPattern, "$2");
}

export function applyClinicalColorMarkup(value: string, start: number, end: number, color: ClinicalMarkColor) {
  const source = String(value ?? "");
  if (start === end) return source;
  const selectedText = source.slice(start, end);
  const fullMark = selectedText.match(/^\[\[(red|orange|yellow|blue|green|purple):([\s\S]*?)\]\]$/i);
  const innerText = stripClinicalColorMarkup(fullMark?.[2] ?? selectedText);
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
    const innerStart = fullStart + `[[${match[1]}:`.length;
    const innerEnd = fullEnd - 2;
    if (start >= innerStart && end <= innerEnd) {
      return `${source.slice(0, fullStart)}${match[2]}${source.slice(fullEnd)}`;
    }
  }

  return `${source.slice(0, start)}${stripClinicalColorMarkup(source.slice(start, end))}${source.slice(end)}`;
}
