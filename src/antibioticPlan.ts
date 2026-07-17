import { parseMedicationOrders, type MedicationOrderAction } from "./medicationOrderParser";
import type { SoapDraft, SoapApProblem } from "./soapDraft";
import { safeClinicalLine } from "./utils";

const specificAntibioticPattern =
  /\b(teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|ceftazidime|ceftaroline|cefuroxime|cefmetazole|cefoxitin|cefoperazone(?:\/sulbactam)?|ampicillin(?:\/sulbactam)?|amoxicillin(?:\/clavulanate)?|augmentin|unasyn|oxacillin|nafcillin|pip\/?tazo|zosyn|piperacillin(?:\/tazobactam)?|meropenem|imipenem|ertapenem|azithromycin|azithro|clarithromycin|erythromycin|levofloxacin|ciprofloxacin|moxifloxacin|doxycycline|doxy|trimethoprim\/?sulfamethoxazole|tmp-?smx|bactrim|metronidazole|flagyl|clindamycin|linezolid|daptomycin|colistin|fluconazole|micafungin|voriconazole|acyclovir|ganciclovir)\b/i;

const activeTreatmentPattern =
  /\b(?:current(?:ly)?(?:\s+on)?|on|continue|cont|start(?:ed)?|resume(?:d)?|restart(?:ed)?|switch(?:ed)?\s+to|chang(?:e|ed)\s+to|escalat(?:e|ed)\s+to|de-?escalat(?:e|ed)\s+to)\b/i;
const strongActiveTreatmentPattern = /\b(?:current(?:ly)?(?:\s+on)?|continue|cont|start(?:ed)?|resume(?:d)?|restart(?:ed)?|switch(?:ed)?\s+to|chang(?:e|ed)\s+to|escalat(?:e|ed)\s+to|de-?escalat(?:e|ed)\s+to)\b/i;
const inactiveTreatmentPattern = /\b(?:stop(?:ped)?|discontinue(?:d)?|complete(?:d)?|finish(?:ed)?|hold|held|prior|previous|no longer)\b/i;
const transitionStatementPattern = /\b(?:switch(?:ed)?|chang(?:e|ed)|escalat(?:e|ed)|de-?escalat(?:e|ed))\b[^.;\n]{0,100}?\bto\b/i;
const antibioticTransitionPattern = /\b(?:switch(?:ed)?|chang(?:e|ed)|escalat(?:e|ed)|de-?escalat(?:e|ed))\b[^;\n]{0,100}?\bto\s+([^;\n]+)/gi;

function normalizeLine(value: string) {
  return String(value ?? "")
    .replace(/^!+\s*/, "")
    .replace(/^[-*#]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function antibioticNames(value: string) {
  const names = String(value ?? "").match(new RegExp(specificAntibioticPattern.source, "gi")) ?? [];
  return [...new Set(names.map((name) => name.toLowerCase()))];
}

function uniqueLines(values: string[], maxItems = 20) {
  const seen = new Set<string>();
  const next: string[] = [];
  values
    .map((line) => safeClinicalLine(line, 180))
    .filter(Boolean)
    .forEach((line) => {
      const key = normalizeLine(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      next.push(line);
    });
  return next.slice(0, maxItems);
}

function selectedYear(selectedDate = "") {
  return Number(selectedDate.match(/^(\d{4})-/)?.[1] ?? new Date().getFullYear());
}

function dayCountFromStart(startMonth: number, startDay: number, selectedDate = "") {
  const selected = selectedDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!selected) return "";
  const start = Date.UTC(selectedYear(selectedDate), startMonth - 1, startDay);
  const end = Date.UTC(Number(selected[1]), Number(selected[2]) - 1, Number(selected[3]));
  const diffDays = Math.floor((end - start) / 86400000) + 1;
  return diffDays >= 1 && diffDays <= 180 ? `D${diffDays}` : "";
}

function appendDayCount(text: string, selectedDate = "") {
  if (!selectedDate || /\bD\d+\b/i.test(text)) return text;
  const match = text.match(/\b(?:from|since|start(?:ed)?(?:\s+on)?\s*)?(\d{1,2})\/(\d{1,2})\s*[-~]?/i);
  if (!match) return text;
  const dayCount = dayCountFromStart(Number(match[1]), Number(match[2]), selectedDate);
  return dayCount ? `${text} (${dayCount})` : text;
}

function sourceLines(sourceText: string) {
  return String(sourceText ?? "")
    .split(/\r?\n|;\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function orderBlockLines(sourceText: string) {
  const result: string[] = [];
  let inOrders = false;
  String(sourceText ?? "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (/^(?:orders?|meds?|abx|\u85e5\u56d1)\s*[:\uff1a]\s*/i.test(line)) {
      inOrders = true;
      const sameLine = line.replace(/^(?:orders?|meds?|abx|\u85e5\u56d1)\s*[:\uff1a]\s*/i, "").trim();
      if (sameLine) result.push(sameLine);
      return;
    }
    if (/^(?:admission|v\/?s|vitals?|lab|image|description|other|last soap|sbar|tasks?|dc)\s*[:\uff1a]/i.test(line)) {
      inOrders = false;
      return;
    }
    if (inOrders && line) result.push(line);
  });
  return result;
}

function transitionTargetLines(sourceText: string) {
  const targets: string[] = [];
  for (const match of String(sourceText ?? "").matchAll(antibioticTransitionPattern)) {
    const target = match[1]?.trim() ?? "";
    if (specificAntibioticPattern.test(target)) targets.push(target);
  }
  return targets;
}

function hasAntibioticOrderSpecifics(line: string) {
  return (
    /(?:order|orders?|meds?|abx|\u85e5\u56d1)\s*[:\uff1a]/i.test(line) ||
    /\b\d{1,2}\/\d{1,2}\s*[-~]/.test(line) ||
    /\b(?:iv|po|sc|im|mg|mcg|g|q\d+h|qd|bid|tid|qid|x\s*\d+\s*d(?:ay)?s?)\b/i.test(line) ||
    activeTreatmentPattern.test(line)
  );
}

function orderActionIsActive(action: MedicationOrderAction) {
  return !["stop", "complete", "hold"].includes(action);
}

function lineLooksActive(line: string, fromOrderBlock = false) {
  if (!specificAntibioticPattern.test(line)) return false;
  if (/\b(?:no|not|without|hold off)\s+(?:abx|antibiotic|antibiotics)\b/i.test(line)) return false;
  if (inactiveTreatmentPattern.test(line) && !strongActiveTreatmentPattern.test(line)) return false;
  return fromOrderBlock || hasAntibioticOrderSpecifics(line);
}

function antibioticOrderFragment(line: string) {
  const text = String(line ?? "").trim();
  const explicit = text.match(/(?:order|orders?|meds?|abx|\u85e5\u56d1)\s*[:\uff1a]\s*(.+)$/i)?.[1];
  if (explicit && specificAntibioticPattern.test(explicit)) return trimOrderFragment(explicit);
  const sentence = text
    .split(/(?<=[.?\u3002])\s+/)
    .find((part) => specificAntibioticPattern.test(part));
  const source = sentence || text;
  const match = source.match(specificAntibioticPattern);
  if (!match || match.index === undefined) return source;
  return trimOrderFragment(source.slice(match.index).replace(/^[\s,;:\uff1a-]+/, ""));
}

function trimOrderFragment(value: string) {
  return String(value ?? "")
    .split(/\.\s*(?=f\/u|follow|pending|define|de-?escal)|;\s*(?=f\/u|follow|pending|define|de-?escal)/i)[0]
    .replace(/,\s*(?=(?:O2|oxygen|bronchodilator|neb|heparin|apixaban|warfarin|insulin|KCl|NS|IVF|VS|V\/S|I\/O)\b).*$/i, "")
    .replace(/[.?\u3002\s]*$/, "")
    .trim();
}

function antibioticOrderTexts(sourceText: string, selectedDate = "") {
  const transitionTargets = transitionTargetLines(sourceText)
    .filter((line) => lineLooksActive(line, true))
    .map((line) => appendDayCount(antibioticOrderFragment(line), selectedDate));

  const explicitOrderLines = orderBlockLines(sourceText)
    .filter((line) => lineLooksActive(line, true))
    .map((line) => appendDayCount(antibioticOrderFragment(line), selectedDate));

  const parsed = parseMedicationOrders(sourceText)
    .filter((order) => order.category === "antiInfective" && orderActionIsActive(order.action))
    .filter((order) => !transitionStatementPattern.test(order.displayText))
    .filter((order) => specificAntibioticPattern.test(order.displayText) && lineLooksActive(order.displayText))
    .map((order) => appendDayCount(antibioticOrderFragment(order.displayText), selectedDate));

  const narrative = sourceLines(sourceText)
    .filter((line) => !transitionStatementPattern.test(line))
    .filter((line) => lineLooksActive(line))
    .map((line) => appendDayCount(antibioticOrderFragment(line), selectedDate));

  return uniqueLines([...transitionTargets, ...explicitOrderLines, ...parsed, ...narrative], 3);
}

export function extractActiveAntibioticNames(sourceText: string) {
  return [...new Set(antibioticOrderTexts(sourceText).flatMap(antibioticNames))];
}

function inferIndication(sourceText: string) {
  const text = sourceText.toLowerCase();
  if (/\bmrsa\b/.test(text) && /\benterococcus\b/.test(text) && /\b(bacteremia|blood culture|b\/c|bcx)\b/.test(text)) {
    return { title: "MRSA/Enterococcus bacteremia", phrase: "MRSA/Enterococcus bacteremia", supported: true };
  }
  if (/\b(bacteremia|bloodstream infection)\b/.test(text)) return { title: "Bacteremia / infection", phrase: "bacteremia/infx", supported: true };
  if (/\b(cholangitis|biliary infection)\b/.test(text)) return { title: "Cholangitis / infection", phrase: "cholangitis/infx", supported: true };
  if (/\b(aspiration pna|aspiration pneumonia)\b/.test(text)) return { title: "Aspiration PNA", phrase: "aspiration PNA", supported: true };
  if (/\b(pna|pneumonia|cap|hap|vap)\b/.test(text)) return { title: "PNA / infection", phrase: "PNA/infx", supported: true };
  if (/\b(febrile neutropenia|neutropenic fever)\b/.test(text)) return { title: "Febrile neutropenia / infection", phrase: "febrile neutropenia/infx", supported: true };
  if (/\b(uti|urinary tract infection)\b/.test(text)) return { title: "UTI / infection", phrase: "UTI/infx", supported: true };
  if (/\b(abscess|cellulitis|wound infection|osteomyelitis)\b/.test(text)) return { title: "Infection", phrase: "infection", supported: true };
  return { title: "Infection / Abx", phrase: "", supported: false };
}

function microbiologyContext(sourceText: string) {
  const text = String(sourceText ?? "");
  if (/\b(?:b\/c|blood culture|bcx)\b/i.test(text) && /\bmrsa\b/i.test(text) && /\benterococcus\b/i.test(text)) return "B/C MRSA/Enterococcus";
  if (/\b(?:b\/c|blood culture|bcx)\b[^.\n;]{0,80}\b(?:pending|ngtd|no growth|positive|grew|growth|susceptib|clearance)\b/i.test(text)) {
    return safeClinicalLine(text.match(/\b(?:b\/c|blood culture|bcx)\b[^.\n;]{0,100}/i)?.[0] ?? "", 100);
  }
  if (/\b(?:sputum|urine|wound|bile)\s+(?:culture|cx)\b[^.\n;]{0,80}\b(?:pending|ngtd|no growth|positive|grew|growth|susceptib)\b/i.test(text)) {
    return safeClinicalLine(text.match(/\b(?:sputum|urine|wound|bile)\s+(?:culture|cx)\b[^.\n;]{0,100}/i)?.[0] ?? "", 100);
  }
  return "";
}

function sourceControlContext(sourceText: string) {
  const match = String(sourceText ?? "").match(/\b(?:s\/p\s*)?(?:ERCP(?:\s+(?:w\/?|with)\s+stent)?|drain(?:age)?|debridement|source control)[^.\n;]{0,60}/i);
  return safeClinicalLine(match?.[0] ?? "", 80);
}

function sourceHasAuthoritativeOrderDetails(sourceText: string) {
  if (orderBlockLines(sourceText).some((line) => specificAntibioticPattern.test(line))) return true;
  return sourceLines(sourceText).some((line) =>
    specificAntibioticPattern.test(line) &&
    (/(?:order|orders?|meds?|abx|\u85e5\u56d1)\s*[:\uff1a]/i.test(line) ||
      /\b(?:iv|po|sc|im|mg|mcg|g|q\d+h|qd|bid|tid|qid)\b/i.test(line)),
  );
}

export function buildAntibioticApSummary(sourceText: string, selectedDate = "") {
  const antibiotics = antibioticOrderTexts(sourceText, selectedDate);
  if (antibiotics.length === 0) return null;
  const indication = inferIndication(sourceText);
  const abxText = antibiotics.slice(0, 2).join("; ");
  const context = [
    indication.phrase ? `for ${indication.phrase}` : "",
    microbiologyContext(sourceText),
    sourceControlContext(sourceText),
  ].filter(Boolean);
  return {
    title: indication.title,
    line: safeClinicalLine(`${abxText}${context.length > 0 ? `; ${context.join("; ")}` : ""}.`, 180),
    orderLines: sourceHasAuthoritativeOrderDetails(sourceText)
      ? antibiotics.slice(0, 2).map((line) => `Order: ${line}`)
      : [],
    hasSupportedIndication: indication.supported,
  };
}

function problemLooksInfectious(problem: SoapApProblem) {
  return /\b(infect|infx|sepsis|bacteremia|cap|hap|vap|pna|pneumonia|aspiration|cholangitis|uti|abx|antibiotic|culture|cx)\b/i.test(
    `${problem.title} ${problem.lines.join(" ")}`,
  );
}

function problemContainsSummary(problem: SoapApProblem, summaryLine: string) {
  const key = normalizeLine(summaryLine);
  const summaryAntibiotics = antibioticNames(summaryLine);
  const problemText = normalizeLine(`${problem.title} ${problem.lines.join(" ")}`);
  if (summaryAntibiotics.length > 0 && summaryAntibiotics.every((name) => problemText.includes(name))) return true;
  return problem.lines.some((line) => {
    const lineKey = normalizeLine(line);
    return Boolean(lineKey && (lineKey.includes(key) || key.includes(lineKey)));
  });
}

function mergeAntibioticLine(problem: SoapApProblem, summaryLine: string, activeNames: string[], replaceCurrent: boolean) {
  if (problemContainsSummary(problem, summaryLine)) return problem;
  const existingLines = replaceCurrent
    ? problem.lines.filter((line) => {
        const names = antibioticNames(line);
        return names.length === 0 || names.every((name) => activeNames.includes(name));
      })
    : problem.lines;
  return {
    ...problem,
    lines: uniqueLines([summaryLine, ...existingLines], 2),
  };
}

function mergeAntibioticOrders(taskLines: string[], orderLines: string[], replaceCurrent: boolean, activeNames: string[]) {
  const remaining = replaceCurrent
    ? taskLines.filter((line) => {
        const names = antibioticNames(line);
        return names.length === 0 || names.every((name) => activeNames.includes(name));
      })
    : taskLines;
  const missing = orderLines.filter((orderLine) => {
    const names = antibioticNames(orderLine);
    return !remaining.some((line) => names.length > 0 && names.every((name) => normalizeLine(line).includes(name)));
  });
  return uniqueLines([...missing, ...remaining], Math.max(8, missing.length + remaining.length));
}

export function ensureAntibioticApInDraft(draft: SoapDraft, sourceText: string, selectedDate = ""): SoapDraft {
  const summary = buildAntibioticApSummary(sourceText, selectedDate);
  if (!summary?.line) return draft;

  const activeNames = extractActiveAntibioticNames(sourceText);
  const replaceCurrent = /\b(?:switch(?:ed)?|chang(?:e|ed)|escalat(?:e|ed)|de-?escalat(?:e|ed)|stop(?:ped)?|discontinue(?:d)?)\b/i.test(sourceText);
  const targetIndex = draft.apProblems.findIndex(problemLooksInfectious);
  let apProblems = draft.apProblems;
  if (targetIndex >= 0) {
    apProblems = draft.apProblems.map((problem, index) =>
      index === targetIndex ? mergeAntibioticLine(problem, summary.line, activeNames, replaceCurrent) : problem,
    );
  } else if (summary.hasSupportedIndication) {
    apProblems = [{ title: summary.title, lines: [summary.line] }, ...draft.apProblems];
  }

  return {
    ...draft,
    apProblems,
    taskLines: mergeAntibioticOrders(draft.taskLines, summary.orderLines, replaceCurrent, activeNames),
  };
}
