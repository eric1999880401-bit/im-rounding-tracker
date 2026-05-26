import { safeClinicalLine } from "./utils";

export type MedicationOrderCategory =
  | "antiInfective"
  | "anticoagAntiplatelet"
  | "steroidImmunosuppression"
  | "cardioRenalVasoactive"
  | "respiratory"
  | "insulinGlucose"
  | "ivfElectrolyte"
  | "nutrition"
  | "monitoring"
  | "highRiskPrn"
  | "routine";

export type MedicationOrderImportance = "critical" | "important" | "normal" | "routine";

export type MedicationOrderAction = "start" | "continue" | "complete" | "hold" | "resume" | "stop" | "monitor" | "replace" | "prn" | "other";

export type OrderDisplayMode = "summary" | "category" | "collapsed";

export interface MedicationOrderDraft {
  id: string;
  rawText: string;
  displayText: string;
  category: MedicationOrderCategory;
  importance: MedicationOrderImportance;
  action: MedicationOrderAction;
  medicationName: string;
  route: string;
  frequency: string;
  duration: string;
  hiddenReason: string;
}

interface ParsedOrderParts {
  route: string;
  frequency: string;
  duration: string;
}

const categoryLabels: Record<MedicationOrderCategory, string> = {
  antiInfective: "Abx",
  anticoagAntiplatelet: "Anticoag/AP",
  steroidImmunosuppression: "Steroid/Immuno",
  cardioRenalVasoactive: "Cardio/Renal",
  respiratory: "Resp",
  insulinGlucose: "Insulin/Glucose",
  ivfElectrolyte: "IVF/Lyte",
  nutrition: "Nutrition",
  monitoring: "Monitoring",
  highRiskPrn: "PRN",
  routine: "Routine",
};

const categoryOrder: MedicationOrderCategory[] = [
  "antiInfective",
  "anticoagAntiplatelet",
  "steroidImmunosuppression",
  "cardioRenalVasoactive",
  "respiratory",
  "insulinGlucose",
  "ivfElectrolyte",
  "nutrition",
  "monitoring",
  "highRiskPrn",
  "routine",
];

const routePattern = /\b(IVD?|IVPB|IVF|PO|NG|N\/G|SC|SQ|IM|INH|NEB|SL|TOP|PR|PEG|J[- ]?tube|tube)\b/i;
const frequencyPattern = /\b(q\d+\s*h|q\d+h|qod|qd|qday|bid|tid|qid|qhs|hs|ac|pc|ac\/hs|stat|once|prn|sos|continuous|drip)\b/i;
const durationPattern = /\b(?:x\s*\d+\s*(?:d|day|days|wk|week|weeks)|\d{1,2}\/\d{1,2}\s*[-~]\s*|\d{1,2}\/\d{1,2}\s*-\s*|for\s+\d+\s*(?:d|days|wk|weeks))\b/i;

function normalizeWhitespace(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*[,;]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRawOrderLine(value: string) {
  return normalizeWhitespace(value)
    .replace(/^[\s\-*+•·‧]+/, "")
    .replace(/^!!?\s*/, "")
    .replace(/^藥囑\s*[:：\s]*/i, "")
    .replace(/^\d+[\.)、\s]*/, "")
    .replace(/^(?:order|orders?|meds?|藥囑)\s*[:：\s]*/i, "")
    .replace(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+/, "")
    .replace(/^\/?\d{1,2}[/-]\d{1,2}\s+/, "")
    .replace(/^\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2})?\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRawOrderText(rawText: string) {
  return String(rawText ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n|[\u2028\u2029]/)
    .map(cleanRawOrderLine)
    .filter(Boolean)
    .filter((line) => !/^(?:no\.?|item|drug|medication|order name|dose|route|freq|frequency|start date|end date|status)\b/i.test(line));
}

export function stripOrderLinePrefix(value: string) {
  return String(value ?? "")
    .replace(/^\s*!!?\s*/, "")
    .replace(/^\s*\*\s*/, "")
    .replace(/^\s*藥囑\s*[:：\s]*/i, "")
    .replace(/^\s*(?:order|orders?|meds?|藥囑)\s*[:：\s]*/i, "")
    .trim();
}

function stripOrderInputPrefix(value: string) {
  return stripOrderLinePrefix(value)
    .replace(/^\s*(?:Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*:\s*/i, "")
    .trim();
}

function inferAction(text: string): MedicationOrderAction {
  if (/\b(hold|withhold|suspend)\b/i.test(text)) return "hold";
  if (/\b(resume|restart|re-start)\b/i.test(text)) return "resume";
  if (/\b(stop|dc|discontinue|d\/c)\b/i.test(text)) return "stop";
  if (/\b(complete|finish|x\s*\d+\s*d)\b/i.test(text)) return "complete";
  if (/\b(start|add|new)\b/i.test(text)) return "start";
  if (/\b(replace|supplement|correct|鋆kcl|mgso4|phosphate|bicarbonate)\b/i.test(text)) return "replace";
  if (/\b(vs|v\/s|vital|monitor|check|i\/o|io|input\/output|spo2|sugar check|glucose check)\b/i.test(text)) return "monitor";
  if (/\bprn|sos\b/i.test(text)) return "prn";
  if (/\bcontinue|cont\b/i.test(text)) return "continue";
  return "other";
}

function inferCategory(text: string): MedicationOrderCategory {
  if (/\b(teicoplanin|vancomycin|vanco|ceftriaxone|cefepime|cefazolin|ceftazidime|ampicillin|sulbactam|unasyn|piperacillin|tazobactam|pip\/tazo|zosyn|meropenem|imipenem|ertapenem|azithromycin|azithro|clarithromycin|erythromycin|levofloxacin|ciprofloxacin|moxifloxacin|metronidazole|flagyl|clindamycin|linezolid|daptomycin|colistin|fluconazole|micafungin|acyclovir|ganciclovir|abx|antibiotic)\b/i.test(text)) return "antiInfective";
  if (/\b(heparin|enoxaparin|clexane|apixaban|rivaroxaban|dabigatran|warfarin|aspirin|clopidogrel|ticagrelor|cilostazol|anticoag|antiplatelet)\b/i.test(text)) return "anticoagAntiplatelet";
  if (/\b(prednisolone|prednisone|methylpred\w*|solu-medrol|hydrocortisone|dexamethasone|steroid|tacrolimus|cyclosporine|mycophenolate|azathioprine|sirolimus)\b/i.test(text)) return "steroidImmunosuppression";
  if (/\b(norepi|norepinephrine|dopamine|dobutamine|vasopressin|epinephrine|nitroglycerin|amiodarone|digoxin|furosemide|lasix|bumetanide|spironolactone|diuretic|pressor|vasoactive)\b/i.test(text)) return "cardioRenalVasoactive";
  if (/\b(o2|oxygen|nasal cannula|nc\s*\d|mask|venturi|hfnc|bipap|bronchodilator|salbutamol|ventolin|ipratropium|atrovent|berodual|nebul|neb|inhal)\b/i.test(text)) return "respiratory";
  if (/\b(insulin|novorapid|regular insulin|lantus|glargine|lispro|aspart|dextrose|d50w|glucose|sugar)\b/i.test(text)) return "insulinGlucose";
  if (/\b(normal saline|n\/s|ns\s|d5w|d10w|d5s|lactated ringer|lr\s|ivf|hydration|kcl|potassium|mgso4|magnesium|phosphate|calcium gluconate|sodium bicarbonate|nahco3|electrolyte)\b/i.test(text)) return "ivfElectrolyte";
  if (/\b(tube feeding|tube feed|feeding|enteral|ng|n\/g|j[- ]?tube|jejunostomy|peg|tpn|ppn|diet|nutrition)\b/i.test(text)) return "nutrition";
  if (/\b(vs|v\/s|vital|monitor|spo2|i\/o|input\/output|body weight|bw|urine output|uo|sugar check|glucose check|ac\/hs)\b/i.test(text)) return "monitoring";
  if (/\b(morphine|fentanyl|pethidine|tramadol|midazolam|lorazepam|diazepam|haloperidol|metoclopramide|ondansetron|prochlorperazine|acetaminophen|tylenol|scanol)\b/i.test(text) && /\b(prn|sos)\b/i.test(text)) return "highRiskPrn";
  return "routine";
}

function inferHiddenReason(text: string, category: MedicationOrderCategory, action: MedicationOrderAction) {
  if (/\b(flush|line care|keep vein open|kvo)\b/i.test(text)) return "Routine line care";
  if (category !== "routine") return "";
  if (action === "hold" || action === "resume" || action === "stop") return "";
  if (/\b(pantoprazole|esomeprazole|omeprazole|ppi|famotidine|mosapride|metoclopramide|senna|sennoside|lactulose|bisacodyl|mg oxide|magnesium oxide|stool softener|vitamin|folic acid|b complex|thiamine|calcium carbonate|acetaminophen|scanol)\b/i.test(text)) {
    return "Routine GI protection/vitamin/bowel/low-value PRN";
  }
  return "Routine chronic med";
}

function inferImportance(text: string, category: MedicationOrderCategory, action: MedicationOrderAction, hiddenReason: string): MedicationOrderImportance {
  if (hiddenReason) return "routine";
  if (/\b(norepi|norepinephrine|dopamine|dobutamine|vasopressin|epinephrine|insulin drip|heparin drip|morphine|fentanyl|midazolam)\b/i.test(text)) return "critical";
  if (action === "hold" || action === "resume" || action === "stop") return "important";
  if (category === "antiInfective" || category === "anticoagAntiplatelet" || category === "steroidImmunosuppression") return "important";
  if (category === "cardioRenalVasoactive" || category === "respiratory" || category === "insulinGlucose" || category === "ivfElectrolyte" || category === "nutrition" || category === "highRiskPrn") return "important";
  return "normal";
}

function partsFromText(text: string): ParsedOrderParts {
  return {
    route: text.match(routePattern)?.[1] ?? "",
    frequency: text.match(frequencyPattern)?.[1] ?? "",
    duration: text.match(durationPattern)?.[0] ?? "",
  };
}

function medicationNameFromText(text: string, category: MedicationOrderCategory) {
  const known = text.match(
    /\b(teicoplanin|vancomycin|ceftriaxone|cefepime|cefazolin|ceftazidime|ampicillin\/sulbactam|pip\/tazo|zosyn|meropenem|ertapenem|azithromycin|azithro|clarithromycin|erythromycin|levofloxacin|ciprofloxacin|metronidazole|heparin|enoxaparin|apixaban|rivaroxaban|warfarin|aspirin|clopidogrel|prednisolone|methylprednisolone|hydrocortisone|dexamethasone|norepinephrine|dopamine|dobutamine|furosemide|lasix|amiodarone|oxygen|salbutamol|ipratropium|insulin|dextrose|d50w|kcl|mgso4|tube feeding|tpn|morphine|fentanyl|midazolam|ondansetron|acetaminophen)\b/i,
  )?.[1];
  if (known) return known;
  if (category === "monitoring") return text.match(/\b(V\/S|VS|vitals?|I\/O|SpO2|glucose|sugar)\b/i)?.[1] ?? "Monitoring";
  return text
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|unit|u|tab|cap|amp|vial|%)\b/gi, "")
    .replace(routePattern, "")
    .replace(frequencyPattern, "")
    .replace(durationPattern, "")
    .replace(/\b(start|continue|complete|hold|resume|stop|monitor|check|replace|prn|sos)\b/gi, "")
    .split(/[,(]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

function displayOrderText(text: string) {
  return safeClinicalLine(
    normalizeWhitespace(text)
      .replace(/\bper os\b/gi, "PO")
      .replace(/\bintravenous\b/gi, "IV")
      .replace(/\bsubcutaneous\b/gi, "SC")
      .replace(/\bnormal saline\b/gi, "NS")
      .replace(/\bfurosemide\b/gi, "Lasix"),
    140,
  );
}

function dedupeKey(order: MedicationOrderDraft) {
  return [
    order.category,
    order.medicationName.toLowerCase(),
    order.route.toLowerCase(),
    order.frequency.toLowerCase(),
    order.duration.toLowerCase(),
    order.action,
  ].join("|");
}

export function parseMedicationOrders(rawText: string): MedicationOrderDraft[] {
  const seen = new Set<string>();
  return splitRawOrderText(rawText)
    .map((line, index): MedicationOrderDraft => {
      const clean = stripOrderInputPrefix(line);
      const action = inferAction(clean);
      const category = inferCategory(clean);
      const hiddenReason = inferHiddenReason(clean, category, action);
      const importance = inferImportance(clean, category, action, hiddenReason);
      const parts = partsFromText(clean);
      const medicationName = medicationNameFromText(clean, category);
      return {
        id: `med-order-${index}-${Math.abs(Array.from(clean).reduce((sum, char) => sum + char.charCodeAt(0), 0))}`,
        rawText: line,
        displayText: displayOrderText(clean),
        category,
        importance,
        action,
        medicationName,
        route: parts.route,
        frequency: parts.frequency,
        duration: parts.duration,
        hiddenReason,
      };
    })
    .filter((order) => order.displayText)
    .filter((order) => {
      const key = dedupeKey(order);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function severityRank(order: MedicationOrderDraft) {
  const importanceRank: Record<MedicationOrderImportance, number> = { critical: 0, important: 1, normal: 2, routine: 3 };
  return categoryOrder.indexOf(order.category) * 10 + importanceRank[order.importance];
}

function groupOrders(orders: MedicationOrderDraft[]) {
  return categoryOrder
    .map((category) => ({
      category,
      items: orders
        .filter((order) => order.category === category)
        .sort((a, b) => severityRank(a) - severityRank(b)),
    }))
    .filter((group) => group.items.length > 0);
}

function compactDisplayText(order: MedicationOrderDraft) {
  let text = order.displayText;
  if (order.category === "highRiskPrn") {
    text = order.medicationName || order.displayText;
  }
  if (order.action === "hold" && !/\bhold/i.test(text)) text = `${text} hold`;
  if (order.action === "resume" && !/\bresume|restart/i.test(text)) text = `${text} resume`;
  if (order.action === "stop" && !/\bstop|dc|d\/c/i.test(text)) text = `${text} stop`;
  return safeClinicalLine(text, 90);
}

export function summarizeMedicationOrders(
  orders: MedicationOrderDraft[],
  options: { includeHidden?: boolean; maxLines?: number; mode?: OrderDisplayMode } = {},
) {
  const mode = options.mode ?? "summary";
  const maxLines = options.maxLines ?? 6;
  const source = options.includeHidden ? orders : orders.filter((order) => !order.hiddenReason);
  if (source.length === 0) {
    const hiddenCount = orders.filter((order) => order.hiddenReason).length;
    return hiddenCount > 0 && mode !== "collapsed" ? [`Routine hidden: ${hiddenCount}`] : [];
  }
  if (mode === "collapsed") return [`藥囑 hidden (${source.length})`];

  const lines = groupOrders(source).map((group) => {
    const items =
      group.category === "highRiskPrn"
        ? Array.from(new Set(group.items.map((order) => compactDisplayText(order)))).slice(0, 5)
        : group.items.map((order) => compactDisplayText(order)).slice(0, mode === "category" ? 6 : 3);
    const suffix = group.items.length > items.length ? ` +${group.items.length - items.length}` : "";
    return `${categoryLabels[group.category]}: ${items.join(", ")}${suffix}`;
  });

  const visible = lines.slice(0, maxLines);
  const hiddenCount = orders.filter((order) => order.hiddenReason).length;
  if (mode === "category" && hiddenCount > 0 && visible.length < maxLines) {
    visible.push(`Routine hidden: ${hiddenCount}`);
  }
  if (lines.length > visible.length) {
    visible[visible.length - 1] = `${visible[visible.length - 1]} +${lines.length - visible.length} categories`;
  }
  return visible;
}

export function formatMedicationOrderLinesForDisplay(lines: string[], mode: OrderDisplayMode = "summary", maxLines = 6) {
  const cleanLines = lines.map(stripOrderLinePrefix).map(normalizeWhitespace).filter(Boolean);
  if (cleanLines.length === 0) return [];
  const parsed = parseMedicationOrders(cleanLines.join("\n"));
  if (parsed.length === 0) {
    if (mode === "collapsed") return [`藥囑 hidden (${cleanLines.length})`];
    return cleanLines.slice(0, maxLines).map((line) => safeClinicalLine(line, 110)).filter(Boolean);
  }
  return summarizeMedicationOrders(parsed, { mode, maxLines });
}

export function medicationOrderTone(order: Pick<MedicationOrderDraft, "importance">) {
  if (order.importance === "critical") return "critical";
  if (order.importance === "important") return "important";
  return "plain";
}

export function medicationOrderCategoryLabel(category: MedicationOrderCategory) {
  return categoryLabels[category];
}

export const medicationOrderCategoryOptions = categoryOrder.map((category) => ({
  value: category,
  label: categoryLabels[category],
}));
