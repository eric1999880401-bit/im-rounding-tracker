import { classifyClinicalLine } from "./clinicalLineClassifier";
import { formatSoapDraft, parseSoapText, type SoapApProblem, type SoapDraft } from "./soapDraft";
import { safeClinicalLine } from "./utils";

export type RoundSoapWorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff";

export type SoapDeltaSection =
  | "header"
  | "s"
  | "vs"
  | "pe"
  | "lab"
  | "image"
  | "ap"
  | "orders"
  | "tasks"
  | "dc";

export interface RoundSoapSourceFields {
  vitals?: string;
  labs?: string;
  images?: string;
  orders?: string;
  other?: string;
  admission?: string;
  lastSoap?: string;
}

export interface SoapDeltaChangedSection {
  id: SoapDeltaSection;
  label: string;
  risk: "normal" | "high";
  reason: string;
  blocked: boolean;
}

export interface SoapDeltaReview {
  workflowMode: RoundSoapWorkflowMode;
  baselineText: string;
  candidateText: string;
  acceptedText: string;
  changedSections: SoapDeltaChangedSection[];
  warnings: string[];
  highRiskWarnings: string[];
}

interface ObjectiveGroups {
  vs: string[];
  pe: string[];
  lab: string[];
  image: string[];
}

const sectionLabels: Record<SoapDeltaSection, string> = {
  header: "Header",
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "Lab",
  image: "Image",
  ap: "A/P",
  orders: "藥囑",
  tasks: "Tasks",
  dc: "DC",
};

function normalizeLine(value: string) {
  return String(value ?? "")
    .replace(/^!+\s*/, "")
    .replace(/^[-*#]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeLines(values: string[]) {
  return values.map(normalizeLine).filter(Boolean).join("\n");
}

function uniqueLines(values: string[], maxItems = 20) {
  const seen = new Set<string>();
  const next: string[] = [];
  values
    .map((line) => safeClinicalLine(line, 160))
    .filter(Boolean)
    .forEach((line) => {
      const key = normalizeLine(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      next.push(line);
    });
  return next.slice(0, maxItems);
}

function sameLines(a: string[], b: string[]) {
  return normalizeLines(a) === normalizeLines(b);
}

function sameProblems(a: SoapApProblem[], b: SoapApProblem[]) {
  return normalizeLines(a.flatMap((problem) => [problem.title, ...problem.lines])) === normalizeLines(b.flatMap((problem) => [problem.title, ...problem.lines]));
}

function lineKind(line: string): keyof ObjectiveGroups {
  const classified = classifyClinicalLine(line, { fallbackKind: "other" });
  if (classified.kind === "vs") return "vs";
  if (classified.kind === "lab") return "lab";
  if (classified.kind === "image") return "image";
  return "pe";
}

function splitObjective(lines: string[]): ObjectiveGroups {
  const groups: ObjectiveGroups = { vs: [], pe: [], lab: [], image: [] };
  lines.forEach((line) => groups[lineKind(line)].push(line));
  return groups;
}

function mergeObjective(groups: ObjectiveGroups) {
  return uniqueLines([...groups.vs, ...groups.pe, ...groups.lab, ...groups.image], 14);
}

function isOrderLine(line: string) {
  const text = String(line ?? "").replace(/^!+\s*/, "").trim();
  return (
    /^\s*(?:order|orders?|meds?|藥囑)\s*[:：]/i.test(text) ||
    /^\s*(?:Abx|Anticoag\/AP|Steroid\/Immuno|Cardio\/Renal|Resp|Insulin\/Glucose|IVF\/Lyte|Nutrition|Monitoring|PRN|Routine(?: hidden)?)\s*:/i.test(text) ||
    /\b(?:teicoplanin|vancomycin|ceftriaxone|cefepime|zosyn|pip\/tazo|meropenem|levofloxacin|heparin|apixaban|warfarin|insulin|lasix|furosemide|steroid|methylpred|oxygen|morphine|fentanyl)\b/i.test(text)
  );
}

function splitTasks(lines: string[]) {
  return {
    orders: lines.filter(isOrderLine),
    tasks: lines.filter((line) => !isOrderLine(line)),
  };
}

function sourceHas(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function sourceProfile(fields: RoundSoapSourceFields) {
  const other = String(fields.other ?? "");
  const hasVitals = sourceHas(fields.vitals);
  const hasLabs = sourceHas(fields.labs);
  const hasImages = sourceHas(fields.images);
  const hasOrders = sourceHas(fields.orders);
  const hasOther = sourceHas(fields.other);
  const allowed = new Set<SoapDeltaSection>();
  if (hasVitals) allowed.add("vs");
  if (hasLabs) {
    allowed.add("lab");
    allowed.add("ap");
  }
  if (hasImages) {
    allowed.add("image");
    allowed.add("ap");
  }
  if (hasOrders) allowed.add("orders");
  if (hasOther) {
    allowed.add("s");
    allowed.add("pe");
    allowed.add("ap");
    allowed.add("tasks");
    if (/\b(dc|discharge|opd|certificate|meds?|barrier|placement)\b/i.test(other)) allowed.add("dc");
    if (/\b(bp|hr|rr|spo2|v\/s|vs|vitals?|fever|afebrile)\b/i.test(other)) allowed.add("vs");
    if (/\b(wbc|hb|plt|cr|bun|na|k\b|lactate|crp|inr|culture|b\/c|bcx)\b/i.test(other)) allowed.add("lab");
    if (/\b(ct|mri|cxr|echo|sono|ultrasound|image|impression)\b/i.test(other)) allowed.add("image");
    if (/\b(order|meds?|abx|antibiotic|hold|resume|stop|start|continue|insulin|heparin|lasix)\b/i.test(other)) allowed.add("orders");
  }
  return {
    allowed,
    onlyVitals: hasVitals && !hasLabs && !hasImages && !hasOrders && !hasOther,
    onlyLabs: hasLabs && !hasVitals && !hasImages && !hasOrders && !hasOther,
    onlyImages: hasImages && !hasVitals && !hasLabs && !hasOrders && !hasOther,
    onlyOrders: hasOrders && !hasVitals && !hasLabs && !hasImages && !hasOther,
  };
}

function apKey(title: string) {
  return normalizeLine(title)
    .replace(/\b(improving|worsening|stable|persistent|resolved|acute|chronic|s\/p|with|w\/)\b/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function apTitles(problems: SoapApProblem[]) {
  return problems.map((problem) => apKey(problem.title)).filter(Boolean);
}

function findMatchingProblem(problem: SoapApProblem, problems: SoapApProblem[]) {
  const key = apKey(problem.title);
  return problems.find((candidate) => {
    const candidateKey = apKey(candidate.title);
    return Boolean(key && candidateKey && (key.includes(candidateKey) || candidateKey.includes(key)));
  });
}

function mergeApProblemsForDaily(baseline: SoapApProblem[], candidate: SoapApProblem[], allowNewProblem: boolean) {
  const warnings: string[] = [];
  const highRiskWarnings: string[] = [];
  const next = baseline.map((problem) => {
    const match = findMatchingProblem(problem, candidate);
    if (!match || match.lines.length === 0) return problem;
    const protectedBaselineLines = problem.lines.filter(isProtectedLine);
    return {
      title: problem.title,
      lines: uniqueLines([...protectedBaselineLines, ...match.lines], 2),
    };
  });
  const baselineTitles = apTitles(baseline);
  const candidateTitles = apTitles(candidate);
  const removedTitles = baselineTitles.filter((title) => !candidateTitles.some((candidateTitle) => title.includes(candidateTitle) || candidateTitle.includes(title)));
  if (removedTitles.length > 0 && baseline.length > 0) {
    highRiskWarnings.push("AI attempted to remove or rename existing A/P problem(s); baseline A/P titles were preserved.");
  }
  const unmatched = candidate.filter((problem) => !findMatchingProblem(problem, baseline));
  if (allowNewProblem) {
    next.push(...unmatched.slice(0, 1).map((problem) => ({ title: safeClinicalLine(problem.title, 90), lines: uniqueLines(problem.lines, 2) })));
    if (unmatched.length > 1) warnings.push("AI suggested multiple new A/P problems; only the first was applied for Daily update.");
  } else if (unmatched.length > 0) {
    warnings.push("AI suggested new A/P problem(s) from limited daily source; they were held for review.");
  }
  return { apProblems: next.slice(0, 6), warnings, highRiskWarnings };
}

function protectedLines(draft: SoapDraft) {
  return [
    ...draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...draft.taskLines,
    ...draft.dcLines,
  ].filter((line) => /\b(abx|antibiotic|teicoplanin|vancomycin|culture|b\/c|bcx|pending|source|dc|discharge|opd|certificate|meds?)\b/i.test(line));
}

function isProtectedLine(line: string) {
  return /\b(abx|antibiotic|teicoplanin|vancomycin|ceftriaxone|cefepime|meropenem|culture|b\/c|bcx|pending|source|de-escalation|duration|dc|discharge|opd|certificate|meds?)\b/i.test(line);
}

function totalLineCount(draft: SoapDraft) {
  return draft.header.length + draft.sLines.length + draft.oLines.length + draft.apProblems.flatMap((problem) => [problem.title, ...problem.lines]).length + draft.taskLines.length + draft.dcLines.length;
}

function changedSection(id: SoapDeltaSection, reason: string, risk: "normal" | "high" = "normal", blocked = false): SoapDeltaChangedSection {
  return { id, label: sectionLabels[id], reason, risk, blocked };
}

function pushChanged(changed: SoapDeltaChangedSection[], id: SoapDeltaSection, reason: string, risk: "normal" | "high" = "normal", blocked = false) {
  if (changed.some((item) => item.id === id && item.blocked === blocked)) return;
  changed.push(changedSection(id, reason, risk, blocked));
}

function analyzeChangedSections(baseline: SoapDraft, candidate: SoapDraft) {
  const changed: SoapDeltaChangedSection[] = [];
  if (!sameLines(baseline.header, candidate.header)) pushChanged(changed, "header", "Header changed");
  if (!sameLines(baseline.sLines, candidate.sLines)) pushChanged(changed, "s", "Subjective changed");
  const baseObjective = splitObjective(baseline.oLines);
  const candidateObjective = splitObjective(candidate.oLines);
  (["vs", "pe", "lab", "image"] as const).forEach((section) => {
    if (!sameLines(baseObjective[section], candidateObjective[section])) pushChanged(changed, section, `${sectionLabels[section]} changed`);
  });
  if (!sameProblems(baseline.apProblems, candidate.apProblems)) pushChanged(changed, "ap", "A/P changed");
  const baseTasks = splitTasks(baseline.taskLines);
  const candidateTasks = splitTasks(candidate.taskLines);
  if (!sameLines(baseTasks.orders, candidateTasks.orders)) pushChanged(changed, "orders", "Medication/orders changed");
  if (!sameLines(baseTasks.tasks, candidateTasks.tasks)) pushChanged(changed, "tasks", "Tasks changed");
  if (!sameLines(baseline.dcLines, candidate.dcLines)) pushChanged(changed, "dc", "DC changed");
  return changed;
}

function draftForDailyUpdate(baseline: SoapDraft, candidate: SoapDraft, fields: RoundSoapSourceFields) {
  const profile = sourceProfile(fields);
  const warnings: string[] = [];
  const highRiskWarnings: string[] = [];
  const changed: SoapDeltaChangedSection[] = [];
  const baseObjective = splitObjective(baseline.oLines);
  const candidateObjective = splitObjective(candidate.oLines);
  const nextObjective: ObjectiveGroups = {
    vs: baseObjective.vs,
    pe: baseObjective.pe,
    lab: baseObjective.lab,
    image: baseObjective.image,
  };

  (["vs", "pe", "lab", "image"] as const).forEach((section) => {
    const differs = !sameLines(baseObjective[section], candidateObjective[section]);
    if (!differs) return;
    if (profile.allowed.has(section)) {
      nextObjective[section] = candidateObjective[section].length > 0 ? candidateObjective[section] : baseObjective[section];
      pushChanged(changed, section, `${sectionLabels[section]} updated from pasted field`);
    } else {
      pushChanged(changed, section, `AI changed ${sectionLabels[section]} without matching source field`, "high", true);
      highRiskWarnings.push(`${sectionLabels[section]} change blocked: no matching pasted field.`);
    }
  });

  const baselineTasks = splitTasks(baseline.taskLines);
  const candidateTasks = splitTasks(candidate.taskLines);
  const nextOrders = profile.allowed.has("orders") && candidateTasks.orders.length > 0 ? candidateTasks.orders : baselineTasks.orders;
  const taskSourceAllowsUpdate = profile.allowed.has("tasks");
  const nextTasks = taskSourceAllowsUpdate ? candidateTasks.tasks : baselineTasks.tasks;
  if (!sameLines(baselineTasks.orders, candidateTasks.orders)) {
    pushChanged(changed, "orders", profile.allowed.has("orders") ? "Orders updated from pasted order field" : "AI changed orders without matching source field", profile.allowed.has("orders") ? "normal" : "high", !profile.allowed.has("orders"));
  }
  if (!sameLines(baselineTasks.tasks, candidateTasks.tasks)) {
    pushChanged(changed, "tasks", taskSourceAllowsUpdate ? "Tasks updated from pasted course/task field" : "AI changed tasks without matching source field", taskSourceAllowsUpdate ? "normal" : "high", !taskSourceAllowsUpdate);
  }

  let nextApProblems = baseline.apProblems;
  if (!sameProblems(baseline.apProblems, candidate.apProblems)) {
    if (profile.allowed.has("ap")) {
      const merged = mergeApProblemsForDaily(baseline.apProblems, candidate.apProblems, profile.allowed.has("s") || profile.allowed.has("pe"));
      nextApProblems = merged.apProblems;
      warnings.push(...merged.warnings);
      highRiskWarnings.push(...merged.highRiskWarnings);
      pushChanged(changed, "ap", "A/P updated only under preserved problem structure", merged.highRiskWarnings.length > 0 ? "high" : "normal", false);
    } else {
      pushChanged(changed, "ap", "AI changed A/P without matching source field", "high", true);
      highRiskWarnings.push("A/P change blocked: source was limited to V/S/orders or unrelated fields.");
    }
  }

  const nextDc = profile.allowed.has("dc") && candidate.dcLines.length > 0 ? candidate.dcLines : baseline.dcLines;
  if (!sameLines(baseline.dcLines, candidate.dcLines)) {
    pushChanged(changed, "dc", profile.allowed.has("dc") ? "DC updated from pasted source" : "AI changed DC without discharge source", profile.allowed.has("dc") ? "normal" : "high", !profile.allowed.has("dc"));
  }

  if (!sameLines(baseline.header, candidate.header)) {
    pushChanged(changed, "header", "AI changed header/Dx/PMH in Daily update", "high", true);
    highRiskWarnings.push("Header/Dx/PMH change blocked for Daily update.");
  }
  if (!sameLines(baseline.sLines, candidate.sLines)) {
    if (profile.allowed.has("s")) pushChanged(changed, "s", "S updated from pasted course/symptom field");
    else {
      pushChanged(changed, "s", "AI changed S without symptom/course source", "high", true);
      highRiskWarnings.push("S change blocked: no symptom/course field was pasted.");
    }
  }

  const candidateText = [
    ...candidate.header,
    ...candidate.sLines,
    ...candidate.oLines,
    ...candidate.apProblems.flatMap((problem) => [problem.title, ...problem.lines]),
    ...candidate.taskLines,
    ...candidate.dcLines,
  ];
  protectedLines(baseline).forEach((line) => {
    const key = normalizeLine(line);
    if (key && !candidateText.some((candidateLine) => normalizeLine(candidateLine).includes(key) || key.includes(normalizeLine(candidateLine)))) {
      highRiskWarnings.push(`Protected item possibly removed by AI: ${safeClinicalLine(line, 80)}`);
    }
  });
  if (totalLineCount(candidate) < Math.floor(totalLineCount(baseline) * 0.65)) {
    highRiskWarnings.push("AI output was much shorter than baseline; unrelated deletions were blocked where possible.");
  }

  return {
    draft: {
      header: baseline.header,
      sLines: profile.allowed.has("s") && candidate.sLines.length > 0 ? candidate.sLines : baseline.sLines,
      oLines: mergeObjective(nextObjective),
      apProblems: nextApProblems,
      taskLines: uniqueLines([...nextOrders, ...nextTasks], 8),
      dcLines: nextDc,
      warnings: uniqueLines([...baseline.warnings, ...candidate.warnings], 5),
    } satisfies SoapDraft,
    changed,
    warnings,
    highRiskWarnings,
  };
}

export function guardRoundSoapDelta({
  workflowMode,
  baselineText,
  candidateText,
  sourceFields,
  candidateWarnings = [],
}: {
  workflowMode: RoundSoapWorkflowMode;
  baselineText: string;
  candidateText: string;
  sourceFields: RoundSoapSourceFields;
  candidateWarnings?: string[];
}): SoapDeltaReview {
  const baseline = parseSoapText(baselineText);
  const candidate = parseSoapText(candidateText || baselineText);
  const normalizedBaselineText = formatSoapDraft(baseline);
  const normalizedCandidateText = formatSoapDraft(candidate);
  if (workflowMode !== "dailyUpdate") {
    return {
      workflowMode,
      baselineText: normalizedBaselineText,
      candidateText: normalizedCandidateText,
      acceptedText: normalizedCandidateText,
      changedSections: analyzeChangedSections(baseline, candidate),
      warnings: uniqueLines(candidateWarnings, 6),
      highRiskWarnings: [],
    };
  }

  const daily = draftForDailyUpdate(baseline, candidate, sourceFields);
  const acceptedText = formatSoapDraft(daily.draft);
  return {
    workflowMode,
    baselineText: normalizedBaselineText,
    candidateText: normalizedCandidateText,
    acceptedText,
    changedSections: daily.changed,
    warnings: uniqueLines([...candidateWarnings, ...daily.warnings], 8),
    highRiskWarnings: uniqueLines(daily.highRiskWarnings, 8),
  };
}

function replaceSection(current: SoapDraft, source: SoapDraft, section: SoapDeltaSection): SoapDraft {
  if (section === "header") return { ...current, header: source.header };
  if (section === "s") return { ...current, sLines: source.sLines };
  if (section === "ap") return { ...current, apProblems: source.apProblems };
  if (section === "dc") return { ...current, dcLines: source.dcLines };
  if (section === "orders" || section === "tasks") {
    const currentTasks = splitTasks(current.taskLines);
    const sourceTasks = splitTasks(source.taskLines);
    return {
      ...current,
      taskLines: uniqueLines(
        [
          ...(section === "orders" ? sourceTasks.orders : currentTasks.orders),
          ...(section === "tasks" ? sourceTasks.tasks : currentTasks.tasks),
        ],
        8,
      ),
    };
  }
  const currentObjective = splitObjective(current.oLines);
  const sourceObjective = splitObjective(source.oLines);
  currentObjective[section] = sourceObjective[section];
  return { ...current, oLines: mergeObjective(currentObjective) };
}

export function restoreSoapDeltaSection(currentText: string, baselineText: string, section: SoapDeltaSection) {
  return formatSoapDraft(replaceSection(parseSoapText(currentText), parseSoapText(baselineText), section));
}

export function acceptSoapDeltaSection(currentText: string, candidateText: string, section: SoapDeltaSection) {
  return formatSoapDraft(replaceSection(parseSoapText(currentText), parseSoapText(candidateText), section));
}
