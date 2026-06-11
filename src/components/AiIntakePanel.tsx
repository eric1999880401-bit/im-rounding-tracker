import { useMemo, useState } from "react";
import { analyzeClinicalText } from "../firebase/aiService";
import { applyClinicalKnowledgeToAiSoapDraft } from "../clinicalKnowledge";
import { sanitizeAiSoapDraftForReview } from "../aiDraftSanitizer";
import {
  cleanImageSummary,
  isBedsidePhysicalExamLine,
  isImageLine,
  isLabLine,
  isVitalLine,
  replaceSameStudyImageLines,
} from "../clinicalFieldRouter";
import type {
  AiClinicalSourceType,
  AiSoapDraft,
  AssessmentPlanItem,
  DailyNote,
  ImageStudyEntry,
  LabReport,
  ParsedLabItem,
  Patient,
  PatientTask,
  PhysicalExamEntry,
  TaskCategory,
  TaskPriority,
} from "../types";
import {
  createId,
  getActiveProblemItems,
  getUnderlyingDiseaseItems,
  normalizeDateKey,
  nowIso,
} from "../utils";
import { aiSoapDraftToSoapDraft, formatSoapDraft, soapTextToPatientPatch } from "../soapDraft";

const MAX_INPUT_CHARS = 18000;

const sourceTypes: Array<{ value: AiClinicalSourceType; label: string }> = [
  { value: "mixed", label: "Mixed text" },
  { value: "dailyUpdate", label: "Today's update" },
  { value: "admission", label: "Admission note" },
  { value: "vitals", label: "V/S" },
  { value: "lab", label: "Lab" },
  { value: "image", label: "Image report" },
  { value: "progress", label: "Progress note" },
  { value: "consult", label: "Consult note" },
  { value: "nursing", label: "Nursing note" },
];

interface IntakeSourceBlock {
  id: string;
  sourceType: AiClinicalSourceType;
  text: string;
}

type ReviewCardKind =
  | "oneLiner"
  | "admissionSummary"
  | "isbarHandoff"
  | "chiefConcern"
  | "symptom"
  | "importantSymptom"
  | "overnightEvent"
  | "importantOvernightEvent"
  | "vital"
  | "bloodSugar"
  | "physicalExam"
  | "lab"
  | "image"
  | "assessmentPlan"
  | "redFlag"
  | "task"
  | "dischargeIssue"
  | "thinkingPrompt"
  | "uncertainty";

type ReviewStatus = "pending" | "accepted" | "ignored" | "saved";

interface ReviewCard {
  id: string;
  section: string;
  title: string;
  kind: ReviewCardKind;
  valueType: "string" | "json";
  valueText: string;
  originalValue: unknown;
  status: ReviewStatus;
  isEditing: boolean;
}

interface AiIntakePanelProps {
  patient: Patient;
  selectedDate: string;
  onApplyPatient: (patient: Patient, acceptedNotePatch?: Partial<DailyNote>) => Promise<void>;
}

const reviewSectionOrder = [
  "Safety",
  "Tasks / Discharge",
  "Assessment / Plan",
  "Objective Data",
  "Subjective / Events",
  "Generated Briefs",
  "Clinician Review",
];

function hasText(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function stringifyValue(value: unknown, valueType: ReviewCard["valueType"]) {
  if (valueType === "string") return String(value ?? "");
  return JSON.stringify(toReviewValue(value), null, 2);
}

function toReviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toReviewValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "isImportant")
      .map(([key, nextValue]) => [key, toReviewValue(nextValue)]),
  );
}

function mergeWithOriginalValue(originalValue: unknown, editedValue: unknown): unknown {
  if (Array.isArray(originalValue) || Array.isArray(editedValue)) return editedValue;
  if (
    originalValue &&
    typeof originalValue === "object" &&
    editedValue &&
    typeof editedValue === "object"
  ) {
    return { ...originalValue, ...editedValue };
  }

  return editedValue;
}

function appendUniqueLines(existing: string, additions: string[]) {
  const lines = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lineIndexByKey = new Map<string, number>();

  lines.forEach((line, index) => {
    const key = normalizeCompareKey(line);
    if (key) lineIndexByKey.set(key, index);
  });

  additions
    .flatMap((item) => item.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const key = normalizeCompareKey(line);
      const existingIndex = lineIndexByKey.get(key);
      if (existingIndex === undefined) {
        lines.push(line);
        lineIndexByKey.set(key, lines.length - 1);
        return;
      }

      if (line.startsWith("!") && !lines[existingIndex].startsWith("!")) {
        lines[existingIndex] = line;
      }
    });

  return lines.join("\n");
}

function safeArray<T>(value: T[] | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizeCompareKey(value: unknown) {
  return String(value ?? "")
    .replace(/^!+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeClinicalMergeKey(value: unknown) {
  return String(value ?? "")
    .replace(/^!+/, "")
    .replace(/^(?:neuro|heent|cv|resp|chest|abd|gi|gu|ext|skin|msk|general|gen|ob|gyn|pe)\s*:\s*/i, "")
    .replace(/\bright\b|\brt\b/gi, "r")
    .replace(/\bleft\b|\blt\b/gi, "l")
    .replace(/\bbilateral\b|\bbilat\b|\bbil\b/gi, "bl")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function appendUniqueStrings(existing: string[], additions: string[]) {
  const lines = [...existing];
  const seen = new Set(lines.map(normalizeCompareKey).filter(Boolean));

  additions.map(String).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const key = normalizeCompareKey(line);
    if (!seen.has(key)) {
      lines.push(line);
      seen.add(key);
    }
  });

  return lines;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const nextItems: T[] = [];

  items.forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    nextItems.push(item);
  });

  return nextItems;
}

function parsedLabItemKey(item: ParsedLabItem) {
  return [
    item.name || item.label || item.displayName,
    item.value,
    item.unit,
    item.previousValue,
  ].map(normalizeCompareKey).join("|");
}

function uniqueParsedLabItems(items: ParsedLabItem[]) {
  return uniqueBy(items, parsedLabItemKey);
}

function mergeLabReportsByDateTitle(reports: LabReport[]) {
  const reportMap = new Map<string, LabReport>();

  reports.forEach((report) => {
    const date = normalizeDateKey(report.date);
    const title = String(report.title || "AI Intake").trim();
    const key = date;
    const existing = reportMap.get(key);

    if (!existing) {
      reportMap.set(key, {
        ...report,
        date,
        title,
        rawText: appendUniqueLines("", [report.rawText]).trim(),
        items: uniqueParsedLabItems(safeArray(report.items)),
      });
      return;
    }

    reportMap.set(key, {
      ...existing,
      title: appendUniqueStrings(existing.title.split("/"), [title]).join(" / "),
      rawText: appendUniqueLines(existing.rawText, [report.rawText]),
      items: uniqueParsedLabItems([...existing.items, ...safeArray(report.items)]),
    });
  });

  return Array.from(reportMap.values());
}

const problemStopWords = new Set([
  "acute",
  "chronic",
  "with",
  "without",
  "and",
  "or",
  "the",
  "for",
  "on",
  "in",
  "of",
  "risk",
  "concern",
  "possible",
  "suspected",
  "suspect",
  "rule",
  "out",
  "cf",
  "ro",
]);

const problemTokenAliases: Record<string, string> = {
  cap: "pneumonia",
  pna: "pneumonia",
  pneumonia: "pneumonia",
  septic: "sepsis",
  sepsis: "sepsis",
  aki: "aki",
  ckd: "ckd",
  dm: "diabetes",
  t2dm: "diabetes",
  diabetes: "diabetes",
  hyperglycemia: "hyperglycemia",
  htn: "hypertension",
  hypertension: "hypertension",
};

function assessmentProblemTokens(item: AssessmentPlanItem) {
  const source = `${item.problemTitle} ${item.assessmentSummary}`;
  return new Set(
    source
      .toLowerCase()
      .replace(/c\/f/g, " cf ")
      .replace(/r\/o/g, " ro ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => problemTokenAliases[token] ?? token)
      .filter((token) => token.length > 2 && !problemStopWords.has(token)),
  );
}

function hasTokenSet(tokens: Set<string>, requiredTokens: string[]) {
  return requiredTokens.every((token) => tokens.has(token));
}

function areSimilarAssessmentProblems(a: AssessmentPlanItem, b: AssessmentPlanItem) {
  const aKey = normalizeCompareKey(a.problemTitle || a.assessmentSummary);
  const bKey = normalizeCompareKey(b.problemTitle || b.assessmentSummary);
  if (aKey && aKey === bKey) return true;

  const aTokens = assessmentProblemTokens(a);
  const bTokens = assessmentProblemTokens(b);
  const sharedTokens = [...aTokens].filter((token) => bTokens.has(token));
  const smallestSetSize = Math.min(aTokens.size, bTokens.size);

  if (hasTokenSet(aTokens, ["pneumonia", "sepsis"]) && hasTokenSet(bTokens, ["pneumonia", "sepsis"])) return true;
  if (hasTokenSet(aTokens, ["aki", "ckd"]) && hasTokenSet(bTokens, ["aki", "ckd"])) return true;
  if (aTokens.has("diabetes") && bTokens.has("diabetes")) return true;
  if (aTokens.has("hypertension") && bTokens.has("hypertension")) return true;

  return sharedTokens.length >= 2 || (smallestSetSize > 0 && sharedTokens.length / smallestSetSize >= 0.65);
}

function mergeAssessmentPlanItems(existingItems: AssessmentPlanItem[], additions: AssessmentPlanItem[]) {
  const mergedItems: AssessmentPlanItem[] = [];
  let nextOrder = 0;

  [...existingItems, ...additions].forEach((addition) => {
    const nextAddition = {
      ...addition,
      evidenceOrCourseItems: [...addition.evidenceOrCourseItems],
      planItems: [...addition.planItems],
    };
    const match = mergedItems.find((item) => areSimilarAssessmentProblems(item, nextAddition));

    if (!match) {
      mergedItems.push({ ...nextAddition, order: nextOrder });
      nextOrder += 1;
      return;
    }

    match.assessmentSummary = match.assessmentSummary || nextAddition.assessmentSummary;
    match.evidenceOrCourseItems = appendUniqueStrings(match.evidenceOrCourseItems, nextAddition.evidenceOrCourseItems);
    match.planItems = appendUniqueStrings(match.planItems, nextAddition.planItems);
    match.isImportant = match.isImportant || nextAddition.isImportant;
    match.color = match.color || nextAddition.color;
  });

  return mergedItems;
}

function mergePhysicalExamEntries(existing: PhysicalExamEntry[], additions: PhysicalExamEntry[]) {
  return uniqueBy([...existing, ...additions], (entry) =>
    [normalizeDateKey(entry.date), normalizeClinicalMergeKey(`${entry.system} ${entry.finding || entry.note}`)].join("|"),
  );
}

function mergeImageStudyEntries(existing: ImageStudyEntry[], additions: ImageStudyEntry[]) {
  return uniqueBy([...existing, ...additions], (entry) =>
    [entry.date, entry.studyType].map(normalizeCompareKey).join("|"),
  );
}

const taskTokenAliases: Record<string, string> = {
  f: "follow",
  fu: "follow",
  fup: "follow",
  followup: "follow",
  cx: "culture",
  culture: "culture",
  cultures: "culture",
  spo2: "oxygen",
  o2: "oxygen",
  oxygen: "oxygen",
  lactate: "lactate",
  renal: "kidney",
  cr: "kidney",
  creatinine: "kidney",
  glucose: "sugar",
  sugar: "sugar",
  bg: "sugar",
};

const taskStopWords = new Set(["the", "and", "or", "to", "as", "able", "result", "results", "need", "needs"]);

function taskTokens(task: PatientTask) {
  return new Set(
    task.text
      .toLowerCase()
      .replace(/f\/u|f-u/g, "fu")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => taskTokenAliases[token] ?? token)
      .filter((token) => token.length > 1 && !taskStopWords.has(token)),
  );
}

function areSimilarTasks(a: PatientTask, b: PatientTask) {
  const aKey = normalizeCompareKey(a.text);
  const bKey = normalizeCompareKey(b.text);
  if (aKey && aKey === bKey) return true;

  const aTokens = taskTokens(a);
  const bTokens = taskTokens(b);
  const shared = [...aTokens].filter((token) => bTokens.has(token));

  if (aTokens.has("culture") && bTokens.has("culture")) return true;
  if (aTokens.has("lactate") && bTokens.has("lactate")) return true;
  if (aTokens.has("oxygen") && bTokens.has("oxygen")) return true;
  if (aTokens.has("kidney") && bTokens.has("kidney")) return true;
  if (aTokens.has("sugar") && bTokens.has("sugar")) return true;

  return shared.length >= 2;
}

function mergeTasks(existing: PatientTask[], additions: PatientTask[]) {
  const mergedTasks: PatientTask[] = [];

  [...existing, ...additions].forEach((task) => {
    const match = mergedTasks.find((item) => areSimilarTasks(item, task));
    if (!match) {
      mergedTasks.push(task);
      return;
    }

    if (match.priority !== "urgent" && task.priority === "urgent") match.priority = "urgent";
    if (!match.dueDate && task.dueDate) match.dueDate = task.dueDate;
    if (match.category === "other" && task.category !== "other") match.category = task.category;
  });

  return mergedTasks;
}

function mergeThinkingPrompts(
  existing: NonNullable<Patient["aiThinkingPrompts"]>,
  additions: NonNullable<Patient["aiThinkingPrompts"]>,
) {
  return uniqueBy([...existing, ...additions], (prompt) =>
    [prompt.kind, prompt.prompt, prompt.reason].map(normalizeCompareKey).join("|"),
  ).filter((prompt) => prompt.prompt.trim());
}

function normalizeTaskPriority(value: unknown): TaskPriority {
  return value === "urgent" || value === "low" ? value : "normal";
}

function normalizeTaskCategory(value: unknown): TaskCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  const categories: TaskCategory[] = ["lab", "imaging", "consult", "discharge", "family", "order", "other"];
  return categories.includes(normalized as TaskCategory) ? (normalized as TaskCategory) : "other";
}

function vitalLine(vital: AiSoapDraft["objective"]["vitals"][number]) {
  return [
    vital.date,
    vital.name,
    vital.value,
    vital.interpretation,
  ].filter(hasText).join(" - ");
}

function bloodSugarLine(bloodSugar: AiSoapDraft["objective"]["bloodSugars"][number]) {
  return [
    bloodSugar.date,
    bloodSugar.name,
    bloodSugar.value,
    bloodSugar.interpretation,
  ].filter(hasText).join(" - ");
}

function labLine(lab: AiSoapDraft["objective"]["labs"][number]) {
  const prev = lab.previousValue ? `(prev ${lab.previousValue})` : "";
  return [
    lab.date,
    lab.group,
    `${lab.name} ${lab.value}${lab.unit ? ` ${lab.unit}` : ""} ${prev}`.trim(),
    lab.interpretation,
  ].filter(hasText).join(" - ");
}

function imageLine(image: AiSoapDraft["objective"]["images"][number]) {
  return [
    image.date,
    image.studyType,
    image.impression || image.finding,
  ].filter(hasText).join(" - ");
}

function createSourceBlock(sourceType: AiClinicalSourceType = "mixed"): IntakeSourceBlock {
  return {
    id: createId("ai-source"),
    sourceType,
    text: "",
  };
}

function sourceTypeLabel(sourceType: AiClinicalSourceType) {
  return sourceTypes.find((item) => item.value === sourceType)?.label ?? "Mixed text";
}

function sourcePlaceholder(sourceType: AiClinicalSourceType) {
  if (sourceType === "dailyUpdate") {
    return "Paste today's de-identified V/S, labs, image reports, progress notes, consults, and nursing notes. AI should return only meaningful changes.";
  }
  if (sourceType === "vitals") return "Paste today's V/S or bedside sugar. Stable values should not rewrite S/O/A/P.";
  if (sourceType === "lab") return "Paste today's lab data. Important changes will be extracted into Smart Lab Reports.";
  if (sourceType === "image") return "Paste image report impression/findings. AI should keep only actionable findings.";
  return "Paste de-identified admission note, V/S, labs, image report, progress note, consult note, or mixed text.";
}

function getNonEmptySourceBlocks(blocks: IntakeSourceBlock[]) {
  return blocks
    .map((block) => ({ ...block, text: block.text.trim() }))
    .filter((block) => block.text.length > 0);
}

function buildRawTextFromBlocks(blocks: IntakeSourceBlock[]) {
  const nonEmptyBlocks = getNonEmptySourceBlocks(blocks);
  if (nonEmptyBlocks.length === 0) return "";
  if (nonEmptyBlocks.length === 1) return nonEmptyBlocks[0].text;

  return nonEmptyBlocks
    .map((block) => `[${sourceTypeLabel(block.sourceType)}]\n${block.text}`)
    .join("\n\n");
}

function getEffectiveSourceType(blocks: IntakeSourceBlock[]): AiClinicalSourceType {
  const nonEmptyBlocks = getNonEmptySourceBlocks(blocks);
  return nonEmptyBlocks.length === 1 ? nonEmptyBlocks[0].sourceType : "mixed";
}

function cardSearchText(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function objectFlag(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>)[key]);
}

function hasActionableSignal(value: unknown) {
  const text = cardSearchText(value);
  return /!|urgent|critical|new|worse|drop|increase|decrease|pending|f\/u|follow|consult|repeat|monitor|hold|resume|adjust|titrate|abnormal|important|fever|tachy|brady|hypot|hypert|desat|hypox|shock|bleed|hb|aki|stroke|ais|tia|ich|sepsis|acs|arrhythm|cancer|tumou?r|mass|stenos|occlusion|dvt|pe\b|fracture|hematoma/i.test(text);
}

function sourceAllowsReviewCard(sourceType: AiClinicalSourceType, kind: ReviewCardKind, value: unknown) {
  if (
    (kind === "admissionSummary" || kind === "isbarHandoff") &&
    (sourceType === "vitals" || sourceType === "lab" || sourceType === "image")
  ) {
    return false;
  }

  if (sourceType !== "vitals") return true;
  if (kind === "vital" || kind === "bloodSugar") return true;
  if ((kind === "redFlag" || kind === "task") && hasActionableSignal(value)) return true;
  if (kind === "uncertainty" && /identifier|de-?ident|privacy|phi/i.test(cardSearchText(value))) return true;
  return false;
}

function initialReviewStatus(
  sourceType: AiClinicalSourceType,
  kind: ReviewCardKind,
  value: unknown,
): Extract<ReviewStatus, "pending" | "accepted"> {
  if (sourceType === "vitals") {
    return kind === "vital" || kind === "bloodSugar" || kind === "redFlag" || kind === "task" ? "accepted" : "pending";
  }

  if (sourceType === "lab" && kind === "lab") return "accepted";
  if (sourceType === "image" && kind === "image") return "accepted";
  if ((kind === "admissionSummary" || kind === "isbarHandoff") && sourceType !== "lab" && sourceType !== "image") {
    return "accepted";
  }

  if (sourceType === "dailyUpdate" || sourceType === "mixed" || sourceType === "progress" || sourceType === "consult" || sourceType === "nursing") {
    if (kind === "vital" || kind === "bloodSugar" || kind === "redFlag" || kind === "task") return "accepted";
    if ((kind === "lab" || kind === "image" || kind === "physicalExam") && (objectFlag(value, "isImportant") || objectFlag(value, "isAbnormal") || hasActionableSignal(value))) {
      return "accepted";
    }
    if ((kind === "importantSymptom" || kind === "importantOvernightEvent") && hasActionableSignal(value)) return "accepted";
  }

  return "pending";
}

function buildCards(draft: AiSoapDraft, sourceType: AiClinicalSourceType): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const addCard = (
    section: string,
    title: string,
    kind: ReviewCardKind,
    value: unknown,
    valueType: ReviewCard["valueType"] = "json",
  ) => {
    if (valueType === "string" && !hasText(value)) return;
    if (valueType === "json" && !hasText(JSON.stringify(value))) return;
    if (!sourceAllowsReviewCard(sourceType, kind, value)) return;
    cards.push({
      id: createId("ai-card"),
      section,
      title,
      kind,
      valueType,
      valueText: stringifyValue(value, valueType),
      originalValue: value,
      status: initialReviewStatus(sourceType, kind, value),
      isEditing: false,
    });
  };

  safeArray(draft.redFlags).forEach((item, index) => addCard("Safety", `Red flag ${index + 1}`, "redFlag", item));
  safeArray(draft.tasks).forEach((task, index) => addCard("Tasks / Discharge", `Task ${index + 1}`, "task", task));
  safeArray(draft.dischargeIssues).forEach((issue, index) =>
    addCard("Tasks / Discharge", `Discharge issue ${index + 1}`, "dischargeIssue", issue, "string"),
  );
  // A/P is now SOAP-only. Structured assessmentPlan JSON stays available only through the SOAP preview.
  safeArray(draft.objective.vitals).forEach((vital, index) => addCard("Objective Data", `Vital ${index + 1}`, "vital", vital));
  safeArray(draft.objective.bloodSugars).forEach((bloodSugar, index) =>
    addCard("Objective Data", `Blood sugar ${index + 1}`, "bloodSugar", bloodSugar),
  );
  safeArray(draft.objective.labs).forEach((lab, index) => addCard("Objective Data", `Lab ${index + 1}`, "lab", lab));
  safeArray(draft.objective.images).forEach((image, index) => addCard("Objective Data", `Image ${index + 1}`, "image", image));
  safeArray(draft.objective.physicalExam).forEach((exam, index) => addCard("Objective Data", `PE ${index + 1}`, "physicalExam", exam));
  safeArray(draft.subjective.importantSymptoms).forEach((symptom, index) =>
    addCard("Subjective / Events", `Important symptom ${index + 1}`, "importantSymptom", symptom, "string"),
  );
  safeArray(draft.subjective.importantOvernightEvents).forEach((event, index) =>
    addCard("Subjective / Events", `Important overnight ${index + 1}`, "importantOvernightEvent", event, "string"),
  );
  addCard("Subjective / Events", "Chief concern", "chiefConcern", draft.subjective.chiefConcern, "string");
  safeArray(draft.subjective.symptoms).forEach((symptom, index) =>
    addCard("Subjective / Events", `Symptom ${index + 1}`, "symptom", symptom, "string"),
  );
  safeArray(draft.subjective.overnightEvents).forEach((event, index) =>
    addCard("Subjective / Events", `Overnight event ${index + 1}`, "overnightEvent", event, "string"),
  );
  addCard("Generated Briefs", "One-liner", "oneLiner", draft.oneLiner, "string");
  addCard("Generated Briefs", "Admission brief summary", "admissionSummary", draft.admissionSummary, "string");
  addCard("Generated Briefs", "iSBAR handoff", "isbarHandoff", draft.isbarHandoff, "string");
  safeArray(draft.thinkingPrompts).forEach((prompt, index) =>
    addCard("Clinician Review", `Thinking prompt ${index + 1}`, "thinkingPrompt", prompt),
  );
  safeArray(draft.uncertainty).forEach((uncertainty, index) =>
    addCard("Clinician Review", `Uncertainty ${index + 1}`, "uncertainty", uncertainty, "string"),
  );

  return cards;
}

function parseCardValue(card: ReviewCard) {
  if (card.valueType === "string") return card.valueText.trim();
  return mergeWithOriginalValue(card.originalValue, JSON.parse(card.valueText) as unknown);
}

function jsonPosition(errorMessage: string) {
  const positionMatch = errorMessage.match(/position\s+(\d+)/i);
  if (!positionMatch) return null;
  const position = Number(positionMatch[1]);
  return Number.isFinite(position) ? position : null;
}

function lineColumnAt(text: string, position: number) {
  const before = text.slice(0, Math.max(0, position));
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function getCardJsonError(card: ReviewCard) {
  if (card.valueType !== "json") return "";
  try {
    JSON.parse(card.valueText);
    return "";
  } catch (error) {
    const message = getErrorMessage(error);
    const position = jsonPosition(message);
    if (position === null) return message;
    const location = lineColumnAt(card.valueText, position);
    return `${message} (line ${location.line}, column ${location.column})`;
  }
}

function currentCardValue(card: ReviewCard) {
  if (card.valueType === "string") return card.valueText.trim();
  try {
    return mergeWithOriginalValue(card.originalValue, JSON.parse(card.valueText) as unknown);
  } catch {
    return card.valueText;
  }
}

function joinPreviewParts(parts: unknown[], separator = " - ") {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(separator);
}

function reviewCardPreview(card: ReviewCard) {
  const value = currentCardValue(card);
  if (typeof value === "string") return value.trim();

  if (!value || typeof value !== "object") return String(value ?? "").trim();

  if (card.kind === "vital") return vitalLine(value as AiSoapDraft["objective"]["vitals"][number]);
  if (card.kind === "bloodSugar") return bloodSugarLine(value as AiSoapDraft["objective"]["bloodSugars"][number]);
  if (card.kind === "lab") return labLine(value as AiSoapDraft["objective"]["labs"][number]);
  if (card.kind === "image") return imageLine(value as AiSoapDraft["objective"]["images"][number]);

  if (card.kind === "physicalExam") {
    const exam = value as AiSoapDraft["objective"]["physicalExam"][number];
    return joinPreviewParts([exam.system, exam.finding], ": ");
  }

  if (card.kind === "assessmentPlan") {
    const item = value as AiSoapDraft["assessmentPlan"][number];
    return [
      joinPreviewParts([item.problemTitle, item.assessmentSummary], ": "),
      safeArray(item.evidenceOrCourseItems).length > 0 ? `Evidence: ${safeArray(item.evidenceOrCourseItems).join("; ")}` : "",
      safeArray(item.planItems).length > 0 ? `Plan: ${safeArray(item.planItems).join("; ")}` : "",
    ].filter(Boolean).join("\n");
  }

  if (card.kind === "redFlag") {
    const item = value as AiSoapDraft["redFlags"][number];
    return joinPreviewParts([item.text, item.reason ? `Reason: ${item.reason}` : ""]);
  }

  if (card.kind === "task") {
    const task = value as AiSoapDraft["tasks"][number];
    return joinPreviewParts([
      String(task.priority || "normal").toUpperCase(),
      task.text,
      task.category && task.category !== "other" ? task.category : "",
      task.dueDate ? `Due ${task.dueDate}` : "",
    ]);
  }

  if (card.kind === "thinkingPrompt") {
    const item = value as AiSoapDraft["thinkingPrompts"][number];
    return joinPreviewParts([item.prompt, item.reason ? `Why: ${item.reason}` : ""]);
  }

  return stringifyValue(value, "json");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function AiIntakePanel({ patient, selectedDate, onApplyPatient }: AiIntakePanelProps) {
  const [sourceBlocks, setSourceBlocks] = useState<IntakeSourceBlock[]>(() => [createSourceBlock()]);
  const [deidentifiedConfirmed, setDeidentifiedConfirmed] = useState(false);
  const [storeRawText, setStoreRawText] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [draftId, setDraftId] = useState("");
  const [model, setModel] = useState("");
  const [reviewCards, setReviewCards] = useState<ReviewCard[]>([]);
  const [soapPreviewText, setSoapPreviewText] = useState("");

  const rawText = useMemo(() => buildRawTextFromBlocks(sourceBlocks), [sourceBlocks]);
  const effectiveSourceType = useMemo(() => getEffectiveSourceType(sourceBlocks), [sourceBlocks]);
  const nonEmptyBlockCount = useMemo(() => getNonEmptySourceBlocks(sourceBlocks).length, [sourceBlocks]);
  const estimatedTokens = Math.ceil(rawText.length / 4);
  const acceptedCount = reviewCards.filter((card) => card.status === "accepted").length;
  const reviewableCount = reviewCards.filter((card) => card.status !== "saved").length;
  const pendingCount = reviewCards.filter((card) => card.status === "pending").length;
  const ignoredCount = reviewCards.filter((card) => card.status === "ignored").length;
  const savedCount = reviewCards.filter((card) => card.status === "saved").length;
  const groupedCards = useMemo(() => {
    const groups = new Map<string, ReviewCard[]>();
    reviewCards.forEach((card) => {
      groups.set(card.section, [...(groups.get(card.section) ?? []), card]);
    });
    return Array.from(groups.entries()).sort(([left], [right]) => {
      const leftIndex = reviewSectionOrder.indexOf(left);
      const rightIndex = reviewSectionOrder.indexOf(right);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    });
  }, [reviewCards]);

  function updateSourceBlock(blockId: string, updater: (block: IntakeSourceBlock) => IntakeSourceBlock) {
    setSourceBlocks((blocks) => blocks.map((block) => (block.id === blockId ? updater(block) : block)));
  }

  function addSourceBlock(sourceType: AiClinicalSourceType = "mixed") {
    setSourceBlocks((blocks) => [...blocks, createSourceBlock(sourceType)]);
  }

  function startDailyUpdateMode() {
    setSourceBlocks([createSourceBlock("dailyUpdate")]);
    setReviewCards([]);
    setSoapPreviewText("");
    setError("");
    setStatusMessage("Today's update mode: paste all new de-identified data, then review only meaningful changes before saving.");
  }

  function removeSourceBlock(blockId: string) {
    setSourceBlocks((blocks) => {
      if (blocks.length <= 1) return blocks;
      return blocks.filter((block) => block.id !== blockId);
    });
  }

  async function analyze() {
    setError("");
    setStatusMessage("");
    setLoading(true);
    try {
      const result = await analyzeClinicalText({
        patientId: patient.id,
        sourceType: effectiveSourceType,
        rawText,
        deidentifiedConfirmed,
        storeRawText,
        patientContext: {
          age: patient.age ? String(patient.age) : "",
          sex: patient.sex,
          pmh: getUnderlyingDiseaseItems(patient),
          activeProblems: getActiveProblemItems(patient),
        },
      });

      setDraftId(result.draftId);
      setModel(result.model);
      const knowledgeDraft = applyClinicalKnowledgeToAiSoapDraft(result.draft, rawText, {
        pmh: getUnderlyingDiseaseItems(patient),
        activeProblems: getActiveProblemItems(patient),
        today: selectedDate,
      });
      const reviewDraft = sanitizeAiSoapDraftForReview(knowledgeDraft, rawText, effectiveSourceType);
      const nextCards = buildCards(reviewDraft, effectiveSourceType);
      setSoapPreviewText(formatSoapDraft(aiSoapDraftToSoapDraft(reviewDraft, patient, selectedDate)));
      const preselectedCount = nextCards.filter((card) => card.status === "accepted").length;
      setReviewCards(nextCards);
      setStatusMessage(
        preselectedCount > 0
          ? `SOAP preview created. ${preselectedCount} source item(s) are available in Advanced review. Edit the SOAP, then Save preview. Draft ID: ${result.draftId}`
          : `SOAP preview created. Edit before saving. Draft ID: ${result.draftId}`,
      );
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  function updateCard(cardId: string, updater: (card: ReviewCard) => ReviewCard) {
    setReviewCards((cards) => cards.map((card) => (card.id === cardId ? updater(card) : card)));
  }

  function setCardsStatus(status: Extract<ReviewStatus, "accepted" | "ignored">, section?: string) {
    setReviewCards((cards) =>
      cards.map((card) => {
        if (card.status === "saved") return card;
        if (section && card.section !== section) return card;
        if (status === "accepted" && getCardJsonError(card)) return { ...card, isEditing: true };
        return { ...card, status, isEditing: false };
      }),
    );
  }

  function toggleCardEditing(card: ReviewCard) {
    const jsonError = card.isEditing ? getCardJsonError(card) : "";
    if (jsonError) {
      setError(`Fix ${card.section} / ${card.title}: ${jsonError}`);
      updateCard(card.id, (item) => ({ ...item, isEditing: true }));
      return;
    }

    setError("");
    updateCard(card.id, (item) => ({ ...item, isEditing: !item.isEditing }));
  }

  function acceptCard(card: ReviewCard) {
    const jsonError = getCardJsonError(card);
    if (jsonError) {
      setError(`Fix ${card.section} / ${card.title}: ${jsonError}`);
      updateCard(card.id, (item) => ({ ...item, isEditing: true }));
      return;
    }

    setError("");
    updateCard(card.id, (item) => ({ ...item, status: "accepted", isEditing: false }));
  }

  async function applyAcceptedItems() {
    setError("");
    setStatusMessage("");
    const acceptedCards = reviewCards.filter((card) => card.status === "accepted");
    if (acceptedCards.length === 0) {
      setError("Accept at least one draft item before applying.");
      return;
    }

    const parsedCards: Array<{ card: ReviewCard; value: unknown }> = [];
    for (const card of acceptedCards) {
      const jsonError = getCardJsonError(card);
      if (jsonError) {
        setError(`Fix ${card.section} / ${card.title}: ${jsonError}`);
        updateCard(card.id, (item) => ({ ...item, isEditing: true }));
        return;
      }

      parsedCards.push({ card, value: parseCardValue(card) });
    }

    if (parsedCards.length === 0) {
      setError("Accept at least one draft item before applying.");
      return;
    }

    const now = nowIso();
    const subjectiveLines: string[] = [];
    const overnightLines: string[] = [];
    const vitalLines: string[] = [];
    const bloodSugarLines: string[] = [];
    const physicalExamLines: string[] = [];
    const labSummaryLines: string[] = [];
    const imageSummaryLines: string[] = [];
    const redFlagLines: string[] = [];
    const dischargeIssueLines: string[] = [];
    const labReports: LabReport[] = [];
    const parsedLabItems: ParsedLabItem[] = [];
    const physicalExamEntries: PhysicalExamEntry[] = [];
    const imageStudyEntries: ImageStudyEntry[] = [];
    const tasks: PatientTask[] = [];
    const aiThinkingPrompts = [...safeArray(patient.aiThinkingPrompts)];
    const oneLiners: string[] = [];
    const admissionSummaries: string[] = [];
    const isbarHandoffs: string[] = [];

    parsedCards.forEach(({ card, value }) => {
      if (card.kind === "oneLiner" && typeof value === "string") {
        oneLiners.push(value);
      }

      if (card.kind === "admissionSummary" && typeof value === "string") {
        admissionSummaries.push(value);
      }

      if (card.kind === "isbarHandoff" && typeof value === "string") {
        isbarHandoffs.push(value);
      }

      if ((card.kind === "chiefConcern" || card.kind === "symptom") && typeof value === "string") {
        subjectiveLines.push(value);
      }

      if (card.kind === "importantSymptom" && typeof value === "string") {
        subjectiveLines.push(`!${value.replace(/^!+/, "").trim()}`);
      }

      if (card.kind === "overnightEvent" && typeof value === "string") {
        overnightLines.push(value);
      }

      if (card.kind === "importantOvernightEvent" && typeof value === "string") {
        overnightLines.push(`!${value.replace(/^!+/, "").trim()}`);
      }

      if (card.kind === "vital") {
        const vital = value as AiSoapDraft["objective"]["vitals"][number];
        vitalLines.push(`${vital.isImportant || vital.isAbnormal ? "!" : ""}${vitalLine(vital)}`);
      }

      if (card.kind === "bloodSugar") {
        const bloodSugar = value as AiSoapDraft["objective"]["bloodSugars"][number];
        bloodSugarLines.push(`${bloodSugar.isImportant || bloodSugar.isAbnormal ? "!" : ""}${bloodSugarLine(bloodSugar)}`);
      }

      if (card.kind === "physicalExam") {
        const exam = value as AiSoapDraft["objective"]["physicalExam"][number];
        const examLine = `${exam.isImportant ? "!" : ""}${[exam.system, exam.finding].filter(hasText).join(": ")}`;
        if (isImageLine(examLine)) {
          imageSummaryLines.push(examLine);
        } else if (isVitalLine(examLine)) {
          vitalLines.push(examLine);
        } else if (isLabLine(examLine)) {
          labSummaryLines.push(examLine);
        } else {
          physicalExamLines.push(examLine);
          physicalExamEntries.push({
            id: createId("pe"),
            date: selectedDate,
            system: String(exam.system ?? ""),
            finding: String(exam.finding ?? ""),
            isImportant: Boolean(exam.isImportant),
            color: "",
            note: "AI Intake draft",
          });
        }
      }

      if (card.kind === "lab") {
        const lab = value as AiSoapDraft["objective"]["labs"][number];
        const date = normalizeDateKey(lab.date, selectedDate);
        const item: ParsedLabItem = {
          id: createId("lab"),
          label: String(lab.name ?? "Lab"),
          name: String(lab.name ?? "Lab"),
          displayName: String(lab.name ?? "Lab"),
          value: String(lab.value ?? ""),
          unit: String(lab.unit ?? ""),
          previousValue: String(lab.previousValue ?? ""),
          group: String(lab.group ?? ""),
          color: "",
          important: Boolean(lab.isImportant || lab.isAbnormal),
          isImportant: Boolean(lab.isImportant || lab.isAbnormal),
          note: String(lab.interpretation ?? ""),
        };
        const rawLine = labLine(lab);
        parsedLabItems.push(item);
        labSummaryLines.push(`${lab.isImportant || lab.isAbnormal ? "!" : ""}${rawLine}`);
        labReports.push({
          id: createId("lab-report"),
          date,
          title: String(lab.group ?? "AI Intake"),
          rawText: rawLine,
          items: [item],
        });
      }

      if (card.kind === "image") {
        const image = value as AiSoapDraft["objective"]["images"][number];
        imageSummaryLines.push(`${image.isImportant ? "!" : ""}${imageLine(image)}`);
        imageStudyEntries.push({
          id: createId("img"),
          date: normalizeDateKey(image.date, selectedDate),
          studyType: String(image.studyType ?? ""),
          finding: String(image.finding ?? ""),
          impression: String(image.impression ?? ""),
          isImportant: Boolean(image.isImportant),
          color: "",
          note: "AI Intake draft",
        });
      }

      if (card.kind === "redFlag") {
        const item = value as AiSoapDraft["redFlags"][number];
        redFlagLines.push(`!${[item.text, item.reason ? `Reason: ${item.reason}` : ""].filter(hasText).join(" - ")}`);
      }

      if (card.kind === "task") {
        const task = value as AiSoapDraft["tasks"][number];
        tasks.push({
          id: createId("t"),
          text: String(task.text ?? ""),
          done: false,
          priority: normalizeTaskPriority(task.priority),
          category: normalizeTaskCategory(task.category),
          dueDate: String(task.dueDate ?? ""),
          createdAt: now,
          completedAt: "",
        });
      }

      if (card.kind === "dischargeIssue" && typeof value === "string") {
        dischargeIssueLines.push(value);
      }

      if (card.kind === "thinkingPrompt") {
        const item = value as AiSoapDraft["thinkingPrompts"][number];
        aiThinkingPrompts.push({
          id: createId("ai-prompt"),
          prompt: String(item.prompt ?? ""),
          reason: String(item.reason ?? ""),
          kind: "thinkingPrompt",
          createdAt: now,
        });
      }

      if (card.kind === "uncertainty" && typeof value === "string") {
        aiThinkingPrompts.push({
          id: createId("ai-uncertainty"),
          prompt: value,
          reason: "AI uncertainty from reviewed intake draft",
          kind: "uncertainty",
          createdAt: now,
        });
      }
    });

    const acceptedAdmissionSummary = admissionSummaries.map(String).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? "";
    const acceptedIsbarHandoff = isbarHandoffs.map(String).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? "";
    const routedSubjectiveLines: string[] = [];
    const routedOvernightLines: string[] = [];
    const routedVitalLines = [...vitalLines];
    const routedPhysicalExamLines: string[] = [];
    const routedLabSummaryLines: string[] = [];
    const routedImageSummaryLines: string[] = [];

    const routeAcceptedText = (line: string, fallback: "subjective" | "overnight" | "physicalExam" | "lab" | "image") => {
      const bareLine = line.replace(/^!+/, "").trim();
      if (!bareLine) return;
      if (isVitalLine(bareLine)) {
        routedVitalLines.push(line);
        return;
      }
      if (isImageLine(bareLine)) {
        routedImageSummaryLines.push(line);
        return;
      }
      if (isLabLine(bareLine)) {
        routedLabSummaryLines.push(line);
        return;
      }
      if (fallback === "physicalExam" || isBedsidePhysicalExamLine(bareLine)) {
        routedPhysicalExamLines.push(line);
        return;
      }
      if (fallback === "overnight") {
        routedOvernightLines.push(line);
        return;
      }
      if (fallback === "lab") {
        routedLabSummaryLines.push(line);
        return;
      }
      if (fallback === "image") {
        routedImageSummaryLines.push(line);
        return;
      }
      routedSubjectiveLines.push(line);
    };

    subjectiveLines.forEach((line) => routeAcceptedText(line, "subjective"));
    overnightLines.forEach((line) => routeAcceptedText(line, "overnight"));
    physicalExamLines.forEach((line) => routeAcceptedText(line, "physicalExam"));
    labSummaryLines.forEach((line) => routeAcceptedText(line, "lab"));
    imageSummaryLines.forEach((line) => routeAcceptedText(line, "image"));

    const cleanedImageSummaryLines = cleanImageSummary(
      appendUniqueLines("", routedImageSummaryLines),
      [
        patient.primaryDiagnosis,
        patient.activeProblems,
        patient.hospitalCourseHighlights,
        patient.importantRedFlags,
        appendUniqueLines("", routedSubjectiveLines),
      ].join("\n"),
    ).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const nextPatient: Patient = {
      ...patient,
      oneLiner: oneLiners.map(String).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? patient.oneLiner,
      admissionBriefFreeText: acceptedAdmissionSummary || patient.admissionBriefFreeText,
      generatedAdmissionSummary: acceptedAdmissionSummary || patient.generatedAdmissionSummary,
      generatedSbarNote: acceptedIsbarHandoff || patient.generatedSbarNote,
      subjectiveOrChiefConcern: appendUniqueLines(patient.subjectiveOrChiefConcern, routedSubjectiveLines),
      overnightEvent: appendUniqueLines(patient.overnightEvent, routedOvernightLines),
      vitalSigns: appendUniqueLines(patient.vitalSigns, routedVitalLines),
      bloodSugar: appendUniqueLines(patient.bloodSugar, bloodSugarLines),
      physicalExam: appendUniqueLines(patient.physicalExam, routedPhysicalExamLines),
      newLabs: appendUniqueLines(patient.newLabs, routedLabSummaryLines),
      rawLabText: appendUniqueLines(patient.rawLabText, routedLabSummaryLines),
      newImaging: appendUniqueLines(replaceSameStudyImageLines(patient.newImaging, cleanedImageSummaryLines), cleanedImageSummaryLines),
      importantRedFlags: appendUniqueLines(patient.importantRedFlags, redFlagLines),
      dischargeBarriers: appendUniqueLines(patient.dischargeBarriers, dischargeIssueLines),
      labReports: mergeLabReportsByDateTitle([...safeArray(patient.labReports), ...labReports]),
      parsedLabItems: uniqueParsedLabItems([...safeArray(patient.parsedLabItems), ...parsedLabItems]),
      physicalExamEntries: mergePhysicalExamEntries(safeArray(patient.physicalExamEntries), physicalExamEntries),
      imageStudyEntries: mergeImageStudyEntries(safeArray(patient.imageStudyEntries), imageStudyEntries),
      tasks: mergeTasks(safeArray(patient.tasks), tasks.filter((task) => task.text.trim())),
      aiThinkingPrompts: mergeThinkingPrompts(safeArray(patient.aiThinkingPrompts), aiThinkingPrompts),
      updatedAt: now,
    };

    const acceptedNotePatch: Partial<DailyNote> = {};
    const setTextPatch = (field: keyof Pick<
      DailyNote,
      | "importantRedFlags"
      | "overnightEvents"
      | "subjectiveOrChiefConcern"
      | "vitalSigns"
      | "bloodSugar"
      | "physicalExam"
      | "labSummary"
      | "rawLabText"
      | "imageSummary"
      | "dischargePlan"
      | "vsOrder"
    >, additions: string[]) => {
      const text = appendUniqueLines("", additions);
      if (text) {
        acceptedNotePatch[field] = text as never;
      }
    };

    setTextPatch("importantRedFlags", redFlagLines);
    setTextPatch("overnightEvents", routedOvernightLines);
    setTextPatch("subjectiveOrChiefConcern", routedSubjectiveLines);
    setTextPatch("vitalSigns", routedVitalLines);
    setTextPatch("bloodSugar", bloodSugarLines);
    setTextPatch("physicalExam", routedPhysicalExamLines);
    setTextPatch("labSummary", routedLabSummaryLines);
    setTextPatch("rawLabText", routedLabSummaryLines);
    setTextPatch("imageSummary", cleanedImageSummaryLines);
    if (labReports.length > 0) {
      acceptedNotePatch.labDate = selectedDate;
      acceptedNotePatch.labReportTitle = "AI Intake";
      acceptedNotePatch.labReports = mergeLabReportsByDateTitle(labReports);
      acceptedNotePatch.parsedLabItems = uniqueParsedLabItems(parsedLabItems);
    }
    if (physicalExamEntries.length > 0) {
      acceptedNotePatch.physicalExamEntries = physicalExamEntries;
    }
    if (imageStudyEntries.length > 0) {
      acceptedNotePatch.imageStudyEntries = imageStudyEntries;
    }
    try {
      await onApplyPatient(nextPatient, acceptedNotePatch);
      setReviewCards((cards) =>
        cards.map((card) => (card.status === "accepted" ? { ...card, status: "saved", isEditing: false } : card)),
      );
      setStatusMessage(`${acceptedCards.length} accepted draft item(s) saved to this patient and today's SOAP note.`);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    }
  }

  async function applySoapPreview() {
    setError("");
    setStatusMessage("");
    if (!soapPreviewText.trim()) {
      setError("Generate or paste a SOAP preview before saving.");
      return;
    }

    try {
      const patch = soapTextToPatientPatch(soapPreviewText, patient, selectedDate);
      await onApplyPatient(patch.patient, patch.dailyNotePatch);
      setReviewCards((cards) =>
        cards.map((card) => (card.status === "accepted" ? { ...card, status: "saved", isEditing: false } : card)),
      );
      setStatusMessage("SOAP preview saved to this patient and today's note.");
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    }
  }

  return (
    <section className="panel ai-intake-panel">
      <div className="section-heading">
        <div>
          <h2>AI Intake</h2>
          <p className="muted">AI assists organization only; clinician must verify.</p>
        </div>
      </div>

      <div className="ai-warning">
        Use de-identified text only. Do not send patient name, full MRN, ID number, birthday, phone, address, or identifiable image.
      </div>

      <div className="ai-intake-grid">
        <div className="ai-source-toolbar span-2">
          <strong>Input blocks</strong>
          <div className="form-actions">
            <button type="button" onClick={startDailyUpdateMode}>
              Today's update
            </button>
            <button type="button" className="secondary" onClick={() => addSourceBlock("admission")}>
              Add admission
            </button>
            <button type="button" className="secondary" onClick={() => addSourceBlock("vitals")}>
              Add V/S
            </button>
            <button type="button" className="secondary" onClick={() => addSourceBlock("lab")}>
              Add lab
            </button>
            <button type="button" className="secondary" onClick={() => addSourceBlock("image")}>
              Add image
            </button>
            <button type="button" className="secondary" onClick={() => addSourceBlock()}>
              Add block
            </button>
          </div>
        </div>

        <div className="ai-source-blocks span-2">
          {sourceBlocks.map((block, index) => (
            <article className="ai-source-block" key={block.id}>
              <div className="ai-source-block-header">
                <label>
                  Source type
                  <select
                    value={block.sourceType}
                    onChange={(event) =>
                      updateSourceBlock(block.id, (item) => ({
                        ...item,
                        sourceType: event.target.value as AiClinicalSourceType,
                      }))
                    }
                  >
                    {sourceTypes.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={sourceBlocks.length <= 1}
                  onClick={() => removeSourceBlock(block.id)}
                >
                  Remove
                </button>
              </div>
              <label>
                De-identified clinical text {index + 1}
                <textarea
                  className="ai-raw-textarea"
                  value={block.text}
                  onChange={(event) => updateSourceBlock(block.id, (item) => ({ ...item, text: event.target.value }))}
                  placeholder={sourcePlaceholder(block.sourceType)}
                />
              </label>
            </article>
          ))}
        </div>

        <label className="checkbox-label ai-checkbox">
          <input
            type="checkbox"
            checked={deidentifiedConfirmed}
            onChange={(event) => setDeidentifiedConfirmed(event.target.checked)}
          />
          I confirm this text is de-identified.
        </label>

        <label className="checkbox-label ai-checkbox">
          <input
            type="checkbox"
            checked={storeRawText}
            onChange={(event) => setStoreRawText(event.target.checked)}
          />
          Store full raw text in aiDrafts. Use de-identified data only.
        </label>

        <div className="ai-cost-note span-2">
          {rawText.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters across {nonEmptyBlockCount} block(s).
          Approx. {estimatedTokens.toLocaleString()} input tokens. Model and cost are controlled by the backend. The default model is gpt-5.4-mini.
        </div>

        {rawText.length > MAX_INPUT_CHARS && (
          <p className="error-message span-2">Input is too long. Shorten it before analysis.</p>
        )}

        <div className="form-actions span-2">
          <button
            type="button"
            disabled={loading || !deidentifiedConfirmed || rawText.trim().length < 20 || rawText.length > MAX_INPUT_CHARS}
            onClick={() => void analyze()}
          >
            {loading ? "Analyzing..." : "Analyze and organize"}
          </button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {statusMessage && <p className="status-message">{statusMessage}</p>}
      {model && <p className="muted">Model: {model}{draftId ? ` / Draft: ${draftId}` : ""}</p>}

      {soapPreviewText && (
        <section className="soap-preview-panel">
          <div className="section-heading">
            <div>
              <h3>SOAP Preview</h3>
              <p className="muted">Edit this one note. Save writes only after explicit Apply.</p>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => void applySoapPreview()}>
                Save SOAP preview
              </button>
            </div>
          </div>
          <textarea
            className="soap-editor-textarea soap-preview-textarea"
            value={soapPreviewText}
            onChange={(event) => setSoapPreviewText(event.target.value)}
            spellCheck={false}
            rows={16}
          />
        </section>
      )}

      {reviewCards.length > 0 && (
        <details className="ai-draft-review ai-draft-review-advanced">
          <summary>Advanced source cards ({acceptedCount} selected / {pendingCount} review)</summary>
          <div className="section-heading">
            <div>
              <h3>Clinical Review Queue</h3>
              <p className="muted ai-review-summary">
                {acceptedCount} selected / {pendingCount} needs review / {ignoredCount} ignored / {savedCount} saved.
              </p>
            </div>
            <div className="form-actions ai-review-toolbar">
              <button type="button" className="secondary" disabled={reviewableCount === 0} onClick={() => setCardsStatus("accepted")}>
                Accept all
              </button>
              <button type="button" className="secondary" disabled={reviewableCount === 0} onClick={() => setCardsStatus("ignored")}>
                Ignore all
              </button>
              <button type="button" disabled={acceptedCount === 0} onClick={() => void applyAcceptedItems()}>
                Apply accepted items ({acceptedCount})
              </button>
            </div>
          </div>

          {groupedCards.map(([section, cards]) => (
            <section className="ai-review-section" key={section}>
              <div className="ai-review-section-heading">
                <h4>{section}</h4>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!cards.some((card) => card.status !== "saved")}
                    onClick={() => setCardsStatus("accepted", section)}
                  >
                    Accept section
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!cards.some((card) => card.status !== "saved")}
                    onClick={() => setCardsStatus("ignored", section)}
                  >
                    Ignore section
                  </button>
                </div>
              </div>
              <div className="ai-review-card-grid">
                {cards.map((card) => {
                  const jsonError = getCardJsonError(card);
                  const hasJsonError = Boolean(jsonError);

                  return (
                    <article
                      className={`ai-review-card ai-review-card-${card.status}${hasJsonError ? " ai-review-card-invalid" : ""}`}
                      key={card.id}
                    >
                      <div className="ai-review-card-header">
                        <strong>{card.title}</strong>
                        <span className="badge normal">{hasJsonError ? "needs fix" : card.status}</span>
                      </div>
                      {card.isEditing && card.status !== "saved" && card.status !== "ignored" ? (
                        <textarea
                          className={hasJsonError ? "invalid-json-textarea" : ""}
                          value={card.valueText}
                          onChange={(event) => updateCard(card.id, (item) => ({ ...item, valueText: event.target.value }))}
                        />
                      ) : (
                        <div className={hasJsonError ? "ai-review-preview ai-review-preview-invalid" : "ai-review-preview"}>
                          {reviewCardPreview(card) || "-"}
                        </div>
                      )}
                      {card.valueType === "json" && (card.isEditing || hasJsonError) && (
                        <p className={`json-edit-hint${hasJsonError ? " json-edit-error" : ""}`}>
                          {hasJsonError
                            ? `JSON problem in this card: ${jsonError}`
                            : "Edit carefully: quotes, commas, braces, and brackets must stay balanced."}
                        </p>
                      )}
                      <div className="form-actions">
                        <button
                          type="button"
                          disabled={card.status === "saved" || hasJsonError}
                          onClick={() => acceptCard(card)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={card.status === "saved" || card.status === "ignored"}
                          onClick={() => toggleCardEditing(card)}
                        >
                          {card.isEditing ? "Done editing" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={card.status === "saved"}
                          onClick={() => updateCard(card.id, (item) => ({ ...item, status: "ignored", isEditing: false }))}
                        >
                          Ignore
                        </button>
                        {card.valueType === "json" && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={card.status === "saved"}
                            onClick={() =>
                              updateCard(card.id, (item) => ({
                                ...item,
                                valueText: stringifyValue(item.originalValue, item.valueType),
                                isEditing: false,
                              }))
                            }
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </details>
      )}
    </section>
  );
}

export default AiIntakePanel;
