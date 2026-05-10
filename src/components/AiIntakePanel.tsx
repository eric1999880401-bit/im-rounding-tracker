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
  return JSON.stringify(value, null, 2);
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
      status: "pending",
      isEditing: false,
    });
  };

  addCard("One-liner", "One-liner", "oneLiner", draft.oneLiner, "string");
  addCard("S", "Chief concern", "chiefConcern", draft.subjective.chiefConcern, "string");
  draft.subjective.symptoms.forEach((symptom, index) => addCard("S", `Symptom ${index + 1}`, "symptom", symptom, "string"));
  draft.subjective.overnightEvents.forEach((event, index) =>
    addCard("S", `Overnight event ${index + 1}`, "overnightEvent", event, "string"),
  );
  draft.objective.vitals.forEach((vital, index) => addCard("O - Vitals", `Vital ${index + 1}`, "vital", vital));
  draft.objective.physicalExam.forEach((exam, index) => addCard("O - PE", `PE ${index + 1}`, "physicalExam", exam));
  draft.objective.labs.forEach((lab, index) => addCard("O - Labs", `Lab ${index + 1}`, "lab", lab));
  draft.objective.images.forEach((image, index) => addCard("O - Images", `Image ${index + 1}`, "image", image));
  draft.assessmentPlan.forEach((item, index) => addCard("A/P", `Problem ${index + 1}`, "assessmentPlan", item));
  draft.redFlags.forEach((item, index) => addCard("Red Flags", `Red flag ${index + 1}`, "redFlag", item));
  draft.tasks.forEach((task, index) => addCard("Tasks", `Task ${index + 1}`, "task", task));
  draft.dischargeIssues.forEach((issue, index) =>
    addCard("Discharge Issues", `Discharge issue ${index + 1}`, "dischargeIssue", issue, "string"),
  );
  draft.thinkingPrompts.forEach((prompt, index) =>
    addCard("Thinking Prompts", `Thinking prompt ${index + 1}`, "thinkingPrompt", prompt),
  );
  draft.uncertainty.forEach((uncertainty, index) =>
    addCard("Uncertainty", `Uncertainty ${index + 1}`, "uncertainty", uncertainty, "string"),
  );

  return cards;
}

function parseCardValue(card: ReviewCard) {
  if (card.valueType === "string") return card.valueText.trim();
  return JSON.parse(card.valueText) as unknown;
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
        return { ...card, status, isEditing: false };
      }),
    );
  }

  async function applyAcceptedItems() {
    setError("");
    setStatusMessage("");
    const acceptedCards = reviewCards.filter((card) => card.status === "accepted");
    if (acceptedCards.length === 0) {
      setError("Accept at least one draft item before applying.");
      return;
    }

    let parsedCards: Array<{ card: ReviewCard; value: unknown }>;
    try {
      parsedCards = acceptedCards.map((card) => ({ card, value: parseCardValue(card) }));
    } catch (nextError) {
      setError(`One edited JSON card is invalid: ${getErrorMessage(nextError)}`);
      return;
    }

    const now = nowIso();
    const subjectiveLines: string[] = [];
    const overnightLines: string[] = [];
    const vitalLines: string[] = [];
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
      oneLiner: appendUniqueLines(patient.oneLiner, oneLiners),
      subjectiveOrChiefConcern: appendUniqueLines(patient.subjectiveOrChiefConcern, subjectiveLines),
      overnightEvent: appendUniqueLines(patient.overnightEvent, overnightLines),
      vsOrder: appendUniqueLines(patient.vsOrder, vitalLines),
      physicalExam: appendUniqueLines(patient.physicalExam, physicalExamLines),
      newLabs: appendUniqueLines(patient.newLabs, labSummaryLines),
      rawLabText: appendUniqueLines(patient.rawLabText, labSummaryLines),
      newImaging: appendUniqueLines(patient.newImaging, imageSummaryLines),
      importantRedFlags: appendUniqueLines(patient.importantRedFlags, redFlagLines),
      dischargeBarriers: appendUniqueLines(patient.dischargeBarriers, dischargeIssueLines),
      labReports: [...safeArray(patient.labReports), ...labReports],
      parsedLabItems: [...safeArray(patient.parsedLabItems), ...parsedLabItems],
      physicalExamEntries: [...safeArray(patient.physicalExamEntries), ...physicalExamEntries],
      imageStudyEntries: [...safeArray(patient.imageStudyEntries), ...imageStudyEntries],
      assessmentPlanItems: [...safeArray(patient.assessmentPlanItems), ...assessmentPlanItems],
      tasks: [...safeArray(patient.tasks), ...tasks.filter((task) => task.text.trim())],
      aiThinkingPrompts: aiThinkingPrompts.filter((prompt) => prompt.prompt.trim()),
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
                {cards.map((card) => (
                  <article className={`ai-review-card ai-review-card-${card.status}`} key={card.id}>
                    <div className="ai-review-card-header">
                      <strong>{card.title}</strong>
                      <span className="badge normal">{card.status}</span>
                    </div>
                    <textarea
                      value={card.valueText}
                      readOnly={!card.isEditing || card.status === "saved" || card.status === "ignored"}
                      onChange={(event) => updateCard(card.id, (item) => ({ ...item, valueText: event.target.value }))}
                    />
                    <div className="form-actions">
                      <button
                        type="button"
                        disabled={card.status === "saved"}
                        onClick={() => updateCard(card.id, (item) => ({ ...item, status: "accepted", isEditing: false }))}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={card.status === "saved" || card.status === "ignored"}
                        onClick={() => updateCard(card.id, (item) => ({ ...item, isEditing: !item.isEditing }))}
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
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export default AiIntakePanel;
