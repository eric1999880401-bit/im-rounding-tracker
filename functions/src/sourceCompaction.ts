export type RoundSoapWorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff";

export const MAX_ROUND_SOAP_RAW_CHARS = 120_000;

const sourceBudgets: Record<RoundSoapWorkflowMode, number> = {
  dailyUpdate: 18_000,
  newSoap: 26_000,
  transferHandoff: 34_000,
};

export interface PreparedRoundSoapSource {
  text: string;
  originalChars: number;
  promptChars: number;
  compacted: boolean;
  omittedBlocks: number;
}

interface SourceBlock {
  index: number;
  text: string;
  score: number;
}

const clinicalAnchorPatterns = [
  /\b(?:shock|pressor|norepinephrine|vasopressin|intubat|extubat|ventilat|HFNC|BiPAP|respiratory failure|hypoxemi|hypercapni|SpO2|O2|NC|RA)\b/i,
  /\b(?:sepsis|bacteremia|pneumonia|PNA|UTI|cholangitis|culture|B\/C|BCx|U\/C|UCx|sputum|antibiotic|Abx|cef|vanco|mero|teicoplanin|pip\/?tazo)\b/i,
  /\b(?:AKI|CKD|ESRD|CRRT|HD|creatinine|\bCr\b|\bBUN\b|urine output|\bUO\b|hyperK|hypoK|hypernatrem|hyponatrem|\bNa\b|\bK\b)\b/i,
  /\b(?:AST|ALT|bilirubin|T-?bil|INR|coagul|bleed|hemorrhag|anemia|\bHb\b|platelet|\bPlt\b|transfus)\b/i,
  /\b(?:AF|HFrEF|HFpEF|heart failure|ACS|troponin|BNP|anticoag|apixaban|heparin|DVT|PE\b|thrombo)\b/i,
  /\b(?:stroke|ICH|seizure|delirium|encephal|mental status|focal|weakness)\b/i,
  /\b(?:cancer|carcinoma|SCC|adenocarcinoma|metasta|chemotherapy|radiotherapy|immunotherapy|neutropen)\b/i,
  /\b(?:ERCP|EGD|colonoscopy|bronchoscopy|thoracentesis|paracentesis|drain|stent|operation|surgery|procedure|CVC|PICC|port-?A|Foley|NG|J-?tube|chest tube)\b/i,
  /\b(?:CXR|CT|MRI|ultrasound|U\/S|echo|TTE|image|imaging)\b/i,
  /\b(?:rehab|swallow|nutrition|tube feed|discharge|\bDC\b|barrier|pending|follow-up|\bOPD\b|placement|family meeting|code status|DNR)\b/i,
];

const sectionHeadingPattern = /^(?:admission|hospital course|icu course|transfer|handoff|sbar|last soap|current status|today|subjective|objective|assessment|plan|problem|v\/?s|vital|physical exam|pe|lab|micro|culture|image|imaging|procedure|medication|orders?|tasks?|discharge|dc|pending)\s*[:：]?$/i;
const currentPattern = /\b(?:today|current(?:ly)?|now|latest|most recent|on transfer|transfer to|ward|this morning|overnight|pending|active|ongoing|new|worsen|improv|resolved|stopped|discontinued|switched|changed)\b/i;
const routineNoisePattern = /\b(?:routine nursing care|slept well|resting comfortably|no complaint|no acute event|stable condition|continue current care|as ordered|per team)\b/i;

function normalizeBlockKey(value: string) {
  return value.toLowerCase().replace(/[\s\t]+/g, " ").replace(/^[\s*#\-•]+/, "").trim();
}

function splitLongLine(value: string, maxChars = 1_200) {
  const line = value.trim();
  if (!line) return [];
  if (line.length <= maxChars) return [line];
  const sentences = line.split(/(?<=[.;。；])\s+/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences.length > 1 ? sentences : line.match(/.{1,1000}(?:\s|$)/g) ?? [line]) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = sentence.trim().slice(0, maxChars);
  }
  if (current) chunks.push(current);
  return chunks;
}

function sourceBlocks(value: string) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
  const candidates = normalized
    .split(/\n+/)
    .flatMap((line) => splitLongLine(line))
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter((line) => {
    const key = normalizeBlockKey(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockScore(text: string, index: number, total: number) {
  let score = 0;
  if (sectionHeadingPattern.test(text)) score += 12;
  if (currentPattern.test(text)) score += 7;
  score += clinicalAnchorPatterns.filter((pattern) => pattern.test(text)).length * 5;
  if (/\b(?:\d{1,2}[/-]\d{1,2}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/.test(text)) score += 2;
  if (/\b(?:BP|HR|RR|SpO2|FiO2|WBC|Hb|Plt|Cr|Na|K|INR|lactate|CRP|pCO2)\b[^\n]*\d/i.test(text)) score += 5;
  if (/\b(?:start|stop|hold|resume|switch|complete|day\s*\d+|\d+\s*(?:mg|mcg|g|mL)|q\d+h|bid|tid|qid|daily|PRN)\b/i.test(text)) score += 4;
  if (index < 5) score += 4;
  if (index >= Math.max(0, total - 14)) score += 9;
  else if (index / Math.max(1, total) >= 0.7) score += 4;
  if (routineNoisePattern.test(text) && !clinicalAnchorPatterns.some((pattern) => pattern.test(text))) score -= 8;
  return score;
}

function essentialIndexes(blocks: SourceBlock[]) {
  const required = new Set<number>();
  blocks.slice(0, 4).forEach((block) => required.add(block.index));
  blocks.slice(-12).forEach((block) => required.add(block.index));
  clinicalAnchorPatterns.forEach((pattern) => {
    const best = blocks
      .filter((block) => pattern.test(block.text))
      .sort((left, right) => right.score - left.score || right.index - left.index)[0];
    if (best) required.add(best.index);
  });
  return required;
}

export function prepareRoundSoapSource(rawText: string, workflowMode: RoundSoapWorkflowMode): PreparedRoundSoapSource {
  const source = String(rawText ?? "").trim();
  const budget = sourceBudgets[workflowMode];
  if (source.length <= budget) {
    return { text: source, originalChars: source.length, promptChars: source.length, compacted: false, omittedBlocks: 0 };
  }

  const lines = sourceBlocks(source);
  const scored = lines.map((text, index) => ({ index, text, score: blockScore(text, index, lines.length) }));
  const required = essentialIndexes(scored);
  const ranked = [...scored].sort((left, right) => {
    const requiredDiff = Number(required.has(right.index)) - Number(required.has(left.index));
    return requiredDiff || right.score - left.score || right.index - left.index;
  });
  const selected = new Set<number>();
  let usedChars = 0;
  for (const block of ranked) {
    const addition = block.text.length + (selected.size > 0 ? 1 : 0);
    if (usedChars + addition > budget) continue;
    if (!required.has(block.index) && block.score < 4 && usedChars >= budget * 0.72) continue;
    selected.add(block.index);
    usedChars += addition;
  }

  const text = scored
    .filter((block) => selected.has(block.index))
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("\n");
  return {
    text,
    originalChars: source.length,
    promptChars: text.length,
    compacted: true,
    omittedBlocks: Math.max(0, lines.length - selected.size),
  };
}
