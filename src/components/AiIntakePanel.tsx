import { useMemo, useState } from "react";
import { analyzeClinicalText } from "../firebase/aiService";
import type {
  AiClinicalSourceType,
  AiSoapDraft,
  AssessmentPlanItem,
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

const MAX_INPUT_CHARS = 12000;

const sourceTypes: Array<{ value: AiClinicalSourceType; label: string }> = [
  { value: "mixed", label: "Mixed text" },
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
  | "chiefConcern"
  | "symptom"
  | "overnightEvent"
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
  onApplyPatient: (patient: Patient) => Promise<void>;
}

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
  const seen = new Set(lines.map((line) => line.toLowerCase()));

  additions
    .flatMap((item) => item.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const key = line.toLowerCase();
      if (!seen.has(key)) {
        lines.push(line);
        seen.add(key);
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
    [entry.date, entry.system, entry.finding, entry.note].map(normalizeCompareKey).join("|"),
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

function buildCards(draft: AiSoapDraft): ReviewCard[] {
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
    cards.push({
      id: createId("ai-card"),
      section,
      title,
      kind,
      valueType,
      valueText: stringifyValue(value, valueType),
      originalValue: value,
      status: "pending",
      isEditing: false,
    });
  };

  addCard("One-liner", "One-liner", "oneLiner", draft.oneLiner, "string");
  addCard("S", "Chief concern", "chiefConcern", draft.subjective.chiefConcern, "string");
  safeArray(draft.subjective.symptoms).forEach((symptom, index) => addCard("S", `Symptom ${index + 1}`, "symptom", symptom, "string"));
  safeArray(draft.subjective.overnightEvents).forEach((event, index) =>
    addCard("S", `Overnight event ${index + 1}`, "overnightEvent", event, "string"),
  );
  safeArray(draft.objective.vitals).forEach((vital, index) => addCard("O - Vitals", `Vital ${index + 1}`, "vital", vital));
  safeArray(draft.objective.bloodSugars).forEach((bloodSugar, index) =>
    addCard("O - Blood Sugar", `Blood sugar ${index + 1}`, "bloodSugar", bloodSugar),
  );
  safeArray(draft.objective.physicalExam).forEach((exam, index) => addCard("O - PE", `PE ${index + 1}`, "physicalExam", exam));
  safeArray(draft.objective.labs).forEach((lab, index) => addCard("O - Labs", `Lab ${index + 1}`, "lab", lab));
  safeArray(draft.objective.images).forEach((image, index) => addCard("O - Images", `Image ${index + 1}`, "image", image));
  safeArray(draft.assessmentPlan).forEach((item, index) => addCard("A/P", `Problem ${index + 1}`, "assessmentPlan", item));
  safeArray(draft.redFlags).forEach((item, index) => addCard("Red Flags", `Red flag ${index + 1}`, "redFlag", item));
  safeArray(draft.tasks).forEach((task, index) => addCard("Tasks", `Task ${index + 1}`, "task", task));
  safeArray(draft.dischargeIssues).forEach((issue, index) =>
    addCard("Discharge Issues", `Discharge issue ${index + 1}`, "dischargeIssue", issue, "string"),
  );
  safeArray(draft.thinkingPrompts).forEach((prompt, index) =>
    addCard("Thinking Prompts", `Thinking prompt ${index + 1}`, "thinkingPrompt", prompt),
  );
  safeArray(draft.uncertainty).forEach((uncertainty, index) =>
    addCard("Uncertainty", `Uncertainty ${index + 1}`, "uncertainty", uncertainty, "string"),
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

  const rawText = useMemo(() => buildRawTextFromBlocks(sourceBlocks), [sourceBlocks]);
  const effectiveSourceType = useMemo(() => getEffectiveSourceType(sourceBlocks), [sourceBlocks]);
  const nonEmptyBlockCount = useMemo(() => getNonEmptySourceBlocks(sourceBlocks).length, [sourceBlocks]);
  const estimatedTokens = Math.ceil(rawText.length / 4);
  const acceptedCount = reviewCards.filter((card) => card.status === "accepted").length;
  const reviewableCount = reviewCards.filter((card) => card.status !== "saved").length;
  const groupedCards = useMemo(() => {
    const groups = new Map<string, ReviewCard[]>();
    reviewCards.forEach((card) => {
      groups.set(card.section, [...(groups.get(card.section) ?? []), card]);
    });
    return Array.from(groups.entries());
  }, [reviewCards]);

  function updateSourceBlock(blockId: string, updater: (block: IntakeSourceBlock) => IntakeSourceBlock) {
    setSourceBlocks((blocks) => blocks.map((block) => (block.id === blockId ? updater(block) : block)));
  }

  function addSourceBlock(sourceType: AiClinicalSourceType = "mixed") {
    setSourceBlocks((blocks) => [...blocks, createSourceBlock(sourceType)]);
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
          currentAssessmentPlan: patient.assessmentPlanItems,
        },
      });

      setDraftId(result.draftId);
      setModel(result.model);
      setReviewCards(buildCards(result.draft));
      setStatusMessage(`AI draft created. Review before saving. Draft ID: ${result.draftId}`);
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
    const assessmentPlanItems: AssessmentPlanItem[] = [];
    const tasks: PatientTask[] = [];
    const aiThinkingPrompts = [...safeArray(patient.aiThinkingPrompts)];
    const oneLiners: string[] = [];
    let nextAssessmentOrder = safeArray(patient.assessmentPlanItems).length;

    parsedCards.forEach(({ card, value }) => {
      if (card.kind === "oneLiner" && typeof value === "string") {
        oneLiners.push(value);
      }

      if ((card.kind === "chiefConcern" || card.kind === "symptom") && typeof value === "string") {
        subjectiveLines.push(value);
      }

      if (card.kind === "overnightEvent" && typeof value === "string") {
        overnightLines.push(value);
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
        physicalExamLines.push(`${exam.isImportant ? "!" : ""}${[exam.system, exam.finding].filter(hasText).join(": ")}`);
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

      if (card.kind === "assessmentPlan") {
        const item = value as AiSoapDraft["assessmentPlan"][number];
        assessmentPlanItems.push({
          id: createId("ap"),
          problemTitle: String(item.problemTitle ?? ""),
          assessmentSummary: String(item.assessmentSummary ?? ""),
          evidenceOrCourseItems: safeArray(item.evidenceOrCourseItems).map(String).filter(hasText),
          planItems: safeArray(item.planItems).map(String).filter(hasText),
          category: "activeProblem",
          isImportant: Boolean(item.isImportant),
          color: "",
          order: nextAssessmentOrder,
        });
        nextAssessmentOrder += 1;
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

    const nextPatient: Patient = {
      ...patient,
      oneLiner: oneLiners.map(String).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? patient.oneLiner,
      subjectiveOrChiefConcern: appendUniqueLines(patient.subjectiveOrChiefConcern, subjectiveLines),
      overnightEvent: appendUniqueLines(patient.overnightEvent, overnightLines),
      vitalSigns: appendUniqueLines(patient.vitalSigns, vitalLines),
      bloodSugar: appendUniqueLines(patient.bloodSugar, bloodSugarLines),
      physicalExam: appendUniqueLines(patient.physicalExam, physicalExamLines),
      newLabs: appendUniqueLines(patient.newLabs, labSummaryLines),
      rawLabText: appendUniqueLines(patient.rawLabText, labSummaryLines),
      newImaging: appendUniqueLines(patient.newImaging, imageSummaryLines),
      importantRedFlags: appendUniqueLines(patient.importantRedFlags, redFlagLines),
      dischargeBarriers: appendUniqueLines(patient.dischargeBarriers, dischargeIssueLines),
      labReports: mergeLabReportsByDateTitle([...safeArray(patient.labReports), ...labReports]),
      parsedLabItems: uniqueParsedLabItems([...safeArray(patient.parsedLabItems), ...parsedLabItems]),
      physicalExamEntries: mergePhysicalExamEntries(safeArray(patient.physicalExamEntries), physicalExamEntries),
      imageStudyEntries: mergeImageStudyEntries(safeArray(patient.imageStudyEntries), imageStudyEntries),
      assessmentPlanItems: mergeAssessmentPlanItems(safeArray(patient.assessmentPlanItems), assessmentPlanItems),
      tasks: mergeTasks(safeArray(patient.tasks), tasks.filter((task) => task.text.trim())),
      aiThinkingPrompts: mergeThinkingPrompts(safeArray(patient.aiThinkingPrompts), aiThinkingPrompts),
      updatedAt: now,
    };

    try {
      await onApplyPatient(nextPatient);
      setReviewCards((cards) =>
        cards.map((card) => (card.status === "accepted" ? { ...card, status: "saved", isEditing: false } : card)),
      );
      setStatusMessage(`${acceptedCards.length} accepted draft item(s) saved to this patient and today's SOAP note.`);
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
                  placeholder="Paste de-identified admission note, V/S, labs, image report, progress note, consult note, or mixed text."
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

      {reviewCards.length > 0 && (
        <div className="ai-draft-review">
          <div className="section-heading">
            <h3>AI Draft Review</h3>
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
                      <textarea
                        className={hasJsonError ? "invalid-json-textarea" : ""}
                        value={card.valueText}
                        readOnly={!card.isEditing || card.status === "saved" || card.status === "ignored"}
                        onChange={(event) => updateCard(card.id, (item) => ({ ...item, valueText: event.target.value }))}
                      />
                      {card.valueType === "json" && (
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
        </div>
      )}
    </section>
  );
}

export default AiIntakePanel;
