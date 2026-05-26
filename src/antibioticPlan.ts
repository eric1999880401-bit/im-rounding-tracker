import { parseMedicationOrders } from "./medicationOrderParser";
import type { SoapDraft, SoapApProblem } from "./soapDraft";
import { safeClinicalLine } from "./utils";

const specificAntibioticPattern =
  /\b(teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|ceftazidime|ampicillin\/sulbactam|unasyn|pip\/tazo|zosyn|piperacillin\/tazobactam|meropenem|imipenem|ertapenem|azithromycin|azithro|levofloxacin|ciprofloxacin|moxifloxacin|metronidazole|flagyl|clindamycin|linezolid|daptomycin|colistin|fluconazole|micafungin|acyclovir|ganciclovir)\b/i;

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

function antibioticOrderTexts(sourceText: string, selectedDate = "") {
  const parsed = parseMedicationOrders(sourceText)
    .filter((order) => order.category === "antiInfective" && specificAntibioticPattern.test(order.displayText) && hasAntibioticOrderSpecifics(order.displayText))
    .map((order) => appendDayCount(antibioticOrderFragment(order.displayText), selectedDate));
  if (parsed.length > 0) return uniqueLines(parsed, 3);

  return uniqueLines(
    sourceLines(sourceText)
      .filter((line) => specificAntibioticPattern.test(line) && hasAntibioticOrderSpecifics(line) && !/\b(no|not|without|hold off)\s+(?:abx|antibiotic|antibiotics)\b/i.test(line))
      .map((line) => appendDayCount(antibioticOrderFragment(line), selectedDate)),
    3,
  );
}

function hasAntibioticOrderSpecifics(line: string) {
  return (
    /(?:order|orders?|meds?|藥囑|Abx)\s*[:：]/i.test(line) ||
    /\b\d{1,2}\/\d{1,2}\s*[-~]/.test(line) ||
    /\b(?:iv|po|sc|im|mg|mcg|g|q\d+h|qd|bid|tid|qid|x\s*\d+\s*d(?:ay)?s?)\b/i.test(line)
  );
}

function antibioticOrderFragment(line: string) {
  const text = String(line ?? "").trim();
  const explicit = text.match(/(?:order|orders?|meds?|藥囑)\s*[:：]\s*(.+)$/i)?.[1];
  if (explicit && specificAntibioticPattern.test(explicit)) return trimOrderFragment(explicit);
  const sentence = text
    .split(/(?<=[.?。])\s+/)
    .find((part) => specificAntibioticPattern.test(part));
  const source = sentence || text;
  const match = source.match(specificAntibioticPattern);
  if (!match?.index && match?.index !== 0) return source;
  return trimOrderFragment(source.slice(match.index).replace(/^[\s,;:：-]+/, ""));
}

function trimOrderFragment(value: string) {
  return String(value ?? "")
    .split(/\.\s*(?=f\/u|follow|pending|define|de-?escal)|;\s*(?=f\/u|follow|pending|define|de-?escal)/i)[0]
    .replace(/,\s*(?=(?:O2|oxygen|bronchodilator|neb|heparin|apixaban|warfarin|insulin|KCl|NS|IVF|VS|V\/S|I\/O)\b).*$/i, "")
    .replace(/[.?。\s]*$/, "")
    .trim();
}

function inferIndication(sourceText: string) {
  const text = sourceText.toLowerCase();
  if (/\bmrsa\b/.test(text) && /\benterococcus\b/.test(text) && /\b(bacteremia|blood culture|b\/c|bcx)\b/.test(text)) {
    return { title: "MRSA/Enterococcus bacteremia", phrase: "MRSA/Enterococcus bacteremia" };
  }
  if (/\b(bacteremia|blood culture|b\/c|bcx)\b/.test(text)) return { title: "Bacteremia / infection", phrase: "bacteremia/infx" };
  if (/\b(cholangitis|biliary|ercp|bile)\b/.test(text)) return { title: "Cholangitis / infection", phrase: "cholangitis/infx" };
  if (/\b(aspiration pna|aspiration pneumonia)\b/.test(text)) return { title: "Aspiration PNA", phrase: "aspiration PNA" };
  if (/\b(pna|pneumonia)\b/.test(text)) return { title: "PNA / infection", phrase: "PNA/infx" };
  if (/\b(febrile neutropenia|neutropenic fever|anc)\b/.test(text)) return { title: "Febrile neutropenia / infection", phrase: "febrile neutropenia/infx" };
  if (/\b(uti|urinary tract infection|u\/c|ucx)\b/.test(text)) return { title: "UTI / infection", phrase: "UTI/infx" };
  if (/\b(abscess|cellulitis|wound infection)\b/.test(text)) return { title: "Soft tissue infection", phrase: "soft tissue infx" };
  return { title: "Infection / Abx", phrase: "infection" };
}

function cultureFollowUp(sourceText: string) {
  if (/\b(blood culture|b\/c|bcx)\b/i.test(sourceText)) return "f/u B/C clearance/susceptibility";
  if (/\b(sputum culture|sputum cx|s\/c|scx)\b/i.test(sourceText)) return "f/u sputum Cx/susceptibility";
  if (/\b(urine culture|u\/c|ucx)\b/i.test(sourceText)) return "f/u U/C result";
  if (/\b(culture|cx)\b/i.test(sourceText)) return "f/u Cx result/de-escalation";
  return "define duration/de-escalation";
}

function sourceControlPhrase(sourceText: string) {
  if (/\b(source control|ercp|stent|drain|abscess|debridement|tap|thoracentesis|paracentesis)\b/i.test(sourceText)) {
    return ", source control";
  }
  return "";
}

export function buildAntibioticApSummary(sourceText: string, selectedDate = "") {
  const antibiotics = antibioticOrderTexts(sourceText, selectedDate);
  if (antibiotics.length === 0) return null;
  const indication = inferIndication(sourceText);
  const abxText = antibiotics.slice(0, 2).join("; ");
  const followUp = cultureFollowUp(sourceText);
  return {
    title: indication.title,
    line: safeClinicalLine(`${abxText} for ${indication.phrase}, ${followUp}${sourceControlPhrase(sourceText)}.`, 180),
  };
}

function problemLooksInfectious(problem: SoapApProblem) {
  return /\b(infect|infx|sepsis|bacteremia|pna|pneumonia|cholangitis|abx|antibiotic|culture|cx)\b/i.test(
    `${problem.title} ${problem.lines.join(" ")}`,
  );
}

function problemContainsSummary(problem: SoapApProblem, summaryLine: string) {
  const key = normalizeLine(summaryLine);
  const summaryAntibiotics = antibioticNames(summaryLine);
  const problemText = normalizeLine(`${problem.title} ${problem.lines.join(" ")}`);
  if (summaryAntibiotics.length > 0 && summaryAntibiotics.some((name) => problemText.includes(name))) {
    return true;
  }
  const firstToken = normalizeLine(summaryLine).match(/^[a-z][a-z0-9/+.-]{3,}/)?.[0] ?? "";
  if (firstToken && problemText.includes(firstToken)) return true;
  return problem.lines.some((line) => {
    const lineKey = normalizeLine(line);
    return Boolean(lineKey && (lineKey.includes(key) || key.includes(lineKey)));
  });
}

function mergeAntibioticLine(problem: SoapApProblem, summaryLine: string) {
  if (problemContainsSummary(problem, summaryLine)) return problem;
  return {
    ...problem,
    lines: uniqueLines([summaryLine, ...problem.lines], 2),
  };
}

export function ensureAntibioticApInDraft(draft: SoapDraft, sourceText: string, selectedDate = ""): SoapDraft {
  const summary = buildAntibioticApSummary(sourceText, selectedDate);
  if (!summary?.line) return draft;

  const targetIndex = draft.apProblems.findIndex(problemLooksInfectious);
  if (targetIndex >= 0) {
    return {
      ...draft,
      apProblems: draft.apProblems.map((problem, index) => (index === targetIndex ? mergeAntibioticLine(problem, summary.line) : problem)),
    };
  }

  return {
    ...draft,
    apProblems: [{ title: summary.title, lines: [summary.line] }, ...draft.apProblems],
  };
}
