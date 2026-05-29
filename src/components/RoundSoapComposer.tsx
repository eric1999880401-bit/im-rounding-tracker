import { useEffect, useRef, useState } from "react";
import type { AiClinicalSourceType, DailyNote, KeywordHighlightRule, Patient, RoundingLayoutPreferences, UserAiStyleProfile } from "../types";
import { generateRoundSoap } from "../firebase/aiService";
import { ClinicalText } from "./ClinicalText";
import {
  formatSoapTextForEditorStyle,
  getCanonicalSoapText,
  localRoundSoapFromPaste,
  soapTextToPatientPatch,
  type SoapEditorFormat,
} from "../soapDraft";
import { editorDraftToSoapText, emptySoapEditorLine, mergeOrderSourceIntoEditorDraft, parseSoapTextToEditorDraft, splitSoapEditorTaskLines } from "../soapEditorDraft";
import { emptyDailyNote, nowIso } from "../utils";
import { SoapVisualPreview } from "./SoapVisualPreview";
import StructuredSoapEditor from "./StructuredSoapEditor";
import MedicationOrderReviewPanel, { type MedicationOrderSummaryLine } from "./MedicationOrderReviewPanel";
import {
  acceptSoapDeltaSection,
  guardRoundSoapDelta,
  restoreSoapDeltaSection,
  type SoapDeltaReview,
  type SoapDeltaSection,
} from "../soapDeltaGuardrails";

interface RoundSoapComposerProps {
  patient: Patient;
  dailyNotes: DailyNote[];
  selectedDate: string;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
  isDemoMode?: boolean;
  compact?: boolean;
  externalSoapText?: string;
  externalSoapRevision?: number;
  externalSoapStatus?: string;
  layoutPreferences?: RoundingLayoutPreferences;
  aiStyleProfile?: UserAiStyleProfile;
  keywordRules?: KeywordHighlightRule[];
  onDirtyChange?: (dirty: boolean) => void;
}

type WorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff";

const workflowModes: Array<{ value: WorkflowMode; label: string; helper: string; sourceType: AiClinicalSourceType }> = [
  {
    value: "dailyUpdate",
    label: "Daily update",
    helper: "Old inpatient: update the reviewed SOAP only with new findings/tasks and remove completed items.",
    sourceType: "dailyUpdate",
  },
  {
    value: "newSoap",
    label: "New SOAP",
    helper: "First SOAP after admission: paste admission, V/S, lab, image, and free-text description/other.",
    sourceType: "admission",
  },
  {
    value: "transferHandoff",
    label: "Transfer / handoff SOAP",
    helper: "First SOAP after transfer: paste admission, last SOAP/SBAR, V/S, lab, image, and description/other.",
    sourceType: "mixed",
  },
];

interface DailyUpdateFields {
  vitals: string;
  labs: string;
  images: string;
  orders: string;
  other: string;
}

interface NewSoapFields {
  admission: string;
  vitals: string;
  labs: string;
  images: string;
  orders: string;
  other: string;
}

interface TransferSoapFields {
  admission: string;
  lastSoap: string;
  vitals: string;
  labs: string;
  images: string;
  orders: string;
  other: string;
}

const emptyDailyFields: DailyUpdateFields = { vitals: "", labs: "", images: "", orders: "", other: "" };
const emptyNewSoapFields: NewSoapFields = {
  admission: "",
  vitals: "",
  labs: "",
  images: "",
  orders: "",
  other: "",
};
const emptyTransferFields: TransferSoapFields = {
  admission: "",
  lastSoap: "",
  vitals: "",
  labs: "",
  images: "",
  orders: "",
  other: "",
};

const soapFormatOptions: Array<{ value: SoapEditorFormat; label: string; helper: string }> = [
  { value: "standard", label: "Dash SOAP", helper: "Canonical parser-safe format: section headers, # A/P problems, - lines." },
  { value: "plain", label: "Plain SOAP", helper: "No bullet typing needed; A/P is numbered and still parses safely." },
  { value: "compact", label: "Compact round", helper: "Short check-only version for print/board scanning." },
];

const deltaSectionLabels: Record<SoapDeltaSection, string> = {
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

const emptyPendingOrderSources: Record<WorkflowMode, boolean> = {
  dailyUpdate: false,
  newSoap: false,
  transferHandoff: false,
};

function patientContext(patient: Patient) {
  return {
    age: patient.age,
    sex: patient.sex,
    pmh: patient.underlyingDiseases,
    activeProblems: patient.activeProblems,
  };
}

function selectedNoteForDate(notes: DailyNote[], selectedDate: string) {
  return notes.find((note) => note.date === selectedDate);
}

function buildSavedNote(
  soapText: string,
  patient: Patient,
  notes: DailyNote[],
  selectedDate: string,
  patch: ReturnType<typeof soapTextToPatientPatch>,
): DailyNote {
  const now = nowIso();
  const baseNote = selectedNoteForDate(notes, selectedDate) ?? emptyDailyNote(selectedDate);
  return {
    ...baseNote,
    ...patch.dailyNotePatch,
    date: selectedDate,
    soapText: soapText.trim(),
    soapStatus: "reviewed",
    soapUpdatedAt: now,
    soapVersion: 1,
    createdAt: baseNote.createdAt || now,
    updatedAt: now,
  };
}

function RoundSoapComposer({
  patient,
  dailyNotes,
  selectedDate,
  onSavePatient,
  onSaveDailyNote,
  isDemoMode = false,
  compact = false,
  externalSoapText = "",
  externalSoapRevision = 0,
  externalSoapStatus = "",
  layoutPreferences,
  aiStyleProfile,
  keywordRules = [],
  onDirtyChange,
}: RoundSoapComposerProps) {
  const canonical = getCanonicalSoapText(patient, dailyNotes, selectedDate);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("dailyUpdate");
  const [dailyFields, setDailyFields] = useState<DailyUpdateFields>(emptyDailyFields);
  const [newSoapFields, setNewSoapFields] = useState<NewSoapFields>(emptyNewSoapFields);
  const [transferFields, setTransferFields] = useState<TransferSoapFields>(emptyTransferFields);
  const [confirmed, setConfirmed] = useState(false);
  const [soapFormat, setSoapFormat] = useState<SoapEditorFormat>("standard");
  const [editorDraft, setEditorDraft] = useState(() => parseSoapTextToEditorDraft(canonical.text));
  const [rawSoapText, setRawSoapText] = useState(canonical.text);
  const [dirty, setDirty] = useState(false);
  const [pendingOrderSources, setPendingOrderSources] = useState<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [deltaReview, setDeltaReview] = useState<SoapDeltaReview | null>(null);
  const editorDraftRef = useRef(editorDraft);
  const isComposingRef = useRef(false);
  const externalSoapRevisionRef = useRef(externalSoapRevision);
  const pendingSavedSoapRef = useRef<{ date: string; text: string } | null>(null);
  const pendingOrderSourcesRef = useRef<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const soapText = editorDraftToSoapText(editorDraft);

  useEffect(() => {
    onDirtyChange?.(dirty || Object.values(pendingOrderSources).some(Boolean));
  }, [dirty, onDirtyChange, pendingOrderSources]);

  useEffect(() => {
    if (dirty || isComposingRef.current) return;
    const pendingSavedSoap = pendingSavedSoapRef.current;
    if (pendingSavedSoap) {
      if (pendingSavedSoap.date === selectedDate && canonical.text !== pendingSavedSoap.text) return;
      pendingSavedSoapRef.current = null;
    }
    const nextDraft = parseSoapTextToEditorDraft(canonical.text);
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDeltaReview(null);
  }, [canonical.text, dirty, selectedDate]);

  useEffect(() => {
    if (externalSoapRevisionRef.current === externalSoapRevision || isComposingRef.current) return;
    externalSoapRevisionRef.current = externalSoapRevision;
    const nextSoapText = externalSoapText.trim();
    if (!nextSoapText) return;
    pendingSavedSoapRef.current = null;
    const nextDraft = parseSoapTextToEditorDraft(nextSoapText);
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    setError("");
    setWarnings([]);
    setDeltaReview(null);
    setStatus(externalSoapStatus || "External SOAP draft loaded. Review, then Save reviewed SOAP.");
  }, [externalSoapRevision, externalSoapStatus, externalSoapText]);

  function updateEditorDraft(nextDraft: typeof editorDraft) {
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
  }

  function setEditorDraftState(nextDraft: typeof editorDraft) {
    editorDraftRef.current = nextDraft;
    setEditorDraft(nextDraft);
  }

  const workflow = workflowModes.find((item) => item.value === workflowMode) ?? workflowModes[0];

  function updateDailyField(field: keyof DailyUpdateFields, value: string) {
    setDailyFields((current) => ({ ...current, [field]: value }));
    if (field === "orders") updatePendingOrderSource("dailyUpdate", value);
  }

  function updateNewSoapField(field: keyof NewSoapFields, value: string) {
    setNewSoapFields((current) => ({ ...current, [field]: value }));
    if (field === "orders") updatePendingOrderSource("newSoap", value);
  }

  function updateTransferField(field: keyof TransferSoapFields, value: string) {
    setTransferFields((current) => ({ ...current, [field]: value }));
    if (field === "orders") updatePendingOrderSource("transferHandoff", value);
  }

  function updatePendingOrderSource(mode: WorkflowMode, value: string | boolean) {
    const isPending = typeof value === "boolean" ? value : value.trim().length > 0;
    const next = { ...pendingOrderSourcesRef.current, [mode]: isPending };
    pendingOrderSourcesRef.current = next;
    setPendingOrderSources(next);
  }

  function clearPendingOrderSources() {
    pendingOrderSourcesRef.current = emptyPendingOrderSources;
    setPendingOrderSources(emptyPendingOrderSources);
  }

  function sourceSection(label: string, value: string) {
    const trimmed = value.trim();
    return trimmed ? `${label}:\n${trimmed}` : "";
  }

  function composeDailyUpdateText() {
    return [
      sourceSection("V/S", dailyFields.vitals),
      sourceSection("Lab", dailyFields.labs),
      sourceSection("Image", dailyFields.images),
      sourceSection("藥囑", dailyFields.orders),
      sourceSection("Other update / task / course", dailyFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeNewSoapText() {
    return [
      sourceSection("Admission", newSoapFields.admission),
      sourceSection("V/S", newSoapFields.vitals),
      sourceSection("Lab", newSoapFields.labs),
      sourceSection("Image", newSoapFields.images),
      sourceSection("藥囑", newSoapFields.orders),
      sourceSection("Description / other", newSoapFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeTransferText() {
    return [
      sourceSection("Admission", transferFields.admission),
      sourceSection("Last SOAP / SBAR", transferFields.lastSoap),
      sourceSection("V/S", transferFields.vitals),
      sourceSection("Lab", transferFields.labs),
      sourceSection("Image", transferFields.images),
      sourceSection("藥囑", transferFields.orders),
      sourceSection("Description / other", transferFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeRawText() {
    if (workflowMode === "newSoap") return composeNewSoapText();
    if (workflowMode === "transferHandoff") return composeTransferText();
    return composeDailyUpdateText();
  }

  function currentSourceFields() {
    if (workflowMode === "newSoap") return newSoapFields;
    if (workflowMode === "transferHandoff") return transferFields;
    return dailyFields;
  }

  function currentOrderSourceText() {
    if (workflowMode === "newSoap") return newSoapFields.orders;
    if (workflowMode === "transferHandoff") return transferFields.orders;
    return dailyFields.orders;
  }

  function applyMedicationOrderSummaries(lines: MedicationOrderSummaryLine[]) {
    const { taskOnlyLines } = splitSoapEditorTaskLines(editorDraftRef.current.taskLines);
    const nextOrderLines = lines.map((line) => ({
      ...emptySoapEditorLine("task"),
      text: line.text,
      tone: line.tone,
      subtype: "order" as const,
    }));
    const nextDraft = { ...editorDraftRef.current, taskLines: [...nextOrderLines, ...taskOnlyLines] };
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    updatePendingOrderSource(workflowMode, false);
    setError("");
    setStatus("藥囑摘要 applied to local SOAP draft. Save reviewed SOAP to write Firestore.");
    setDeltaReview(null);
  }

  function clearSourceText() {
    setDailyFields(emptyDailyFields);
    setNewSoapFields(emptyNewSoapFields);
    setTransferFields(emptyTransferFields);
    clearPendingOrderSources();
  }

  async function handleGenerate() {
    const rawText = composeRawText();
    const currentSoapText = editorDraftToSoapText(editorDraftRef.current);
    setError("");
    setStatus("");
    setWarnings([]);
    setDeltaReview(null);

    if (!confirmed) {
      setError("Confirm the pasted text is de-identified before generating SOAP.");
      return;
    }

    if (rawText.length < 10) {
      setError("Add source text into at least one guided field first.");
      return;
    }

    setLoading(true);
    try {
      const result = isDemoMode
        ? {
            draftId: "local-demo-round-soap",
            soapText: localRoundSoapFromPaste(patient, dailyNotes, selectedDate, rawText),
            warnings: ["Demo mode used a local SOAP merge instead of Firebase Functions."],
            highlightHints: [],
            model: "local-demo",
          }
        : await generateRoundSoap({
            patientId: patient.id,
            selectedDate,
            sourceType: workflow.sourceType,
            workflowMode,
            rawText,
            currentSoapBaseline: currentSoapText || canonical.text,
            deidentifiedConfirmed: true,
            patientContext: patientContext(patient),
            userStyleProfile: aiStyleProfile,
          });

      const guarded = guardRoundSoapDelta({
        workflowMode,
        baselineText: currentSoapText || canonical.text,
        candidateText: result.soapText.trim() || canonical.text,
        sourceFields: currentSourceFields(),
        candidateWarnings: result.warnings ?? [],
        selectedDate,
      });
      const nextDraft = parseSoapTextToEditorDraft(guarded.acceptedText);
      setEditorDraftState(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      setDirty(true);
      updatePendingOrderSource(workflowMode, false);
      setWarnings([...guarded.warnings, ...guarded.highRiskWarnings]);
      setDeltaReview(guarded);
      setStatus(
        guarded.highRiskWarnings.length > 0
          ? `SOAP preview generated (${result.model}); high-risk unrelated AI changes were held.`
          : `SOAP preview generated (${result.model}). Edit, then Save reviewed SOAP.`,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "SOAP generation failed. No data was saved.");
    } finally {
      setLoading(false);
    }
  }

  function waitForNextFrame() {
    return new Promise<void>((resolve) => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
        return;
      }
      globalThis.setTimeout(resolve, 0);
    });
  }

  async function waitForCompositionToSettle() {
    if (!isComposingRef.current) return true;
    await waitForNextFrame();
    if (!isComposingRef.current) return true;
    await waitForNextFrame();
    return !isComposingRef.current;
  }

  async function handleSave() {
    setError("");
    setStatus("");

    if (!(await waitForCompositionToSettle())) {
      setError("Finish the current Chinese input composition, then click Save reviewed SOAP again.");
      return;
    }

    const hasPendingOrderSource = Boolean(pendingOrderSourcesRef.current[workflowMode] && currentOrderSourceText().trim());
    const draftForSave = hasPendingOrderSource
      ? mergeOrderSourceIntoEditorDraft(editorDraftRef.current, currentOrderSourceText())
      : editorDraftRef.current;
    const reviewedText = editorDraftToSoapText(draftForSave).trim();
    if (!reviewedText) return;

    setLoading(true);
    try {
      const patch = soapTextToPatientPatch(reviewedText, patient, selectedDate);
      const nextPatient = { ...patch.patient, updatedAt: nowIso() };
      const nextNote = buildSavedNote(reviewedText, nextPatient, dailyNotes, selectedDate, patch);
      await onSavePatient(nextPatient);
      await onSaveDailyNote(nextPatient.id, nextNote);
      const nextDraft = parseSoapTextToEditorDraft(reviewedText);
      pendingSavedSoapRef.current = { date: selectedDate, text: reviewedText };
      setEditorDraftState(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      clearSourceText();
      setDirty(false);
      setDeltaReview(null);
      setStatus("Reviewed SOAP saved. Board, Details, and Print now read this note.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Saving SOAP failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleFormatSoap() {
    if (!rawSoapText.trim() || isComposingRef.current) return;
    const normalized = formatSoapTextForEditorStyle(rawSoapText, soapFormat);
    const nextDraft = parseSoapTextToEditorDraft(normalized);
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    setError("");
    setDeltaReview(null);
    setStatus(`${soapFormatOptions.find((item) => item.value === soapFormat)?.label ?? "SOAP"} applied. Review, then Save reviewed SOAP.`);
  }

  function loadDeltaSoapText(nextText: string, nextStatus: string) {
    const nextDraft = parseSoapTextToEditorDraft(nextText);
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    setStatus(nextStatus);
  }

  function acceptAllDeltaChanges() {
    if (!deltaReview) return;
    loadDeltaSoapText(deltaReview.candidateText, "Accepted full AI draft into local SOAP. Review, then Save reviewed SOAP.");
  }

  function rejectAllDeltaChanges() {
    if (!deltaReview) return;
    loadDeltaSoapText(deltaReview.baselineText, "Rejected AI draft and restored baseline SOAP locally.");
  }

  function acceptDeltaSection(section: SoapDeltaSection) {
    if (!deltaReview) return;
    const nextText = acceptSoapDeltaSection(editorDraftToSoapText(editorDraftRef.current), deltaReview.candidateText, section);
    loadDeltaSoapText(nextText, `${deltaSectionLabels[section]} accepted from AI draft locally.`);
  }

  function restoreDeltaSection(section: SoapDeltaSection) {
    if (!deltaReview) return;
    const nextText = restoreSoapDeltaSection(editorDraftToSoapText(editorDraftRef.current), deltaReview.baselineText, section);
    loadDeltaSoapText(nextText, `${deltaSectionLabels[section]} restored from baseline locally.`);
  }

  return (
    <section className={compact ? "round-soap-composer compact-round-soap-composer" : "round-soap-composer"}>
      <div className="round-soap-toolbar">
        <div>
          <h3>Update SOAP</h3>
          <p className="muted">
            Source: {canonical.source === "fallback" ? "legacy fields fallback" : `${canonical.sourceDate} reviewed SOAP`}
          </p>
          <span className={isDemoMode ? "ai-callable-pill ai-callable-demo" : "ai-callable-pill"}>
            {isDemoMode ? "AI: demo local merge" : "AI: Firebase callable"}
          </span>
        </div>
        <div className="form-actions">
          <select value={workflowMode} onChange={(event) => setWorkflowMode(event.target.value as WorkflowMode)}>
            {workflowModes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={soapFormat} onChange={(event) => setSoapFormat(event.target.value as SoapEditorFormat)} title="SOAP editor format">
            {soapFormatOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={() => {
            pendingSavedSoapRef.current = null;
            const nextDraft = parseSoapTextToEditorDraft(canonical.text);
            setEditorDraftState(nextDraft);
            setRawSoapText(editorDraftToSoapText(nextDraft));
            setDirty(false);
            setStatus("");
            setError("");
            setDeltaReview(null);
          }}>
            Reset
          </button>
          <button type="button" className="secondary" disabled={!rawSoapText.trim() || loading} onClick={handleFormatSoap}>
            Normalize text
          </button>
          <button type="button" disabled={!soapText.trim() || loading} onClick={() => void handleSave()}>
            Save reviewed SOAP
          </button>
        </div>
      </div>
      <p className="muted round-soap-mode-helper">{workflow.helper}</p>

      {workflowMode === "dailyUpdate" ? (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            V/S
            <textarea
              value={dailyFields.vitals}
              onChange={(event) => updateDailyField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="BP 112/70 HR 88 SpO2 99%, afebrile"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={dailyFields.labs}
              onChange={(event) => updateDailyField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="WBC/Hb/Cr/K/culture trends, only what matters"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={dailyFields.images}
              onChange={(event) => updateDailyField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            藥囑
            <textarea
              value={dailyFields.orders}
              onChange={(event) => updateDailyField("orders", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Abx/IVF/O2/PRN meds, hold/resume meds, VS or lab orders"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Other update / tasks
            <textarea
              value={dailyFields.other}
              onChange={(event) => updateDailyField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Course, Abx, consult recs, pending/done tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      ) : workflowMode === "newSoap" ? (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            Admission
            <textarea
              value={newSoapFields.admission}
              onChange={(event) => updateNewSoapField("admission", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Admission note, one-liner, PMH, reason for admission, code status"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            V/S
            <textarea
              value={newSoapFields.vitals}
              onChange={(event) => updateNewSoapField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="T, BP, HR, RR, SpO2, O2 support"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={newSoapFields.labs}
              onChange={(event) => updateNewSoapField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CBC, renal/lytes, LFT, CRP/lactate, cultures with date/trend"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={newSoapFields.images}
              onChange={(event) => updateNewSoapField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI/echo/scope: study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            藥囑
            <textarea
              value={newSoapFields.orders}
              onChange={(event) => updateNewSoapField("orders", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Initial Abx/IVF/O2/PRN meds, hold/resume meds, monitoring orders"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Description / other
            <textarea
              value={newSoapFields.other}
              onChange={(event) => updateNewSoapField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Symptoms, course, PE, abx, procedures, consults, tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      ) : (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            Admission
            <textarea
              value={transferFields.admission}
              onChange={(event) => updateTransferField("admission", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Admission/transfer-in note, diagnosis, PMH, reason for transfer"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Last SOAP / SBAR
            <textarea
              value={transferFields.lastSoap}
              onChange={(event) => updateTransferField("lastSoap", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Last SOAP, SBAR, handoff, hospital course, major events"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            V/S
            <textarea
              value={transferFields.vitals}
              onChange={(event) => updateTransferField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="T, BP, HR, RR, SpO2, O2 support"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={transferFields.labs}
              onChange={(event) => updateTransferField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CBC, renal/lytes, LFT, CRP/lactate, cultures with date/trend"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={transferFields.images}
              onChange={(event) => updateTransferField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI/echo/scope: study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            藥囑
            <textarea
              value={transferFields.orders}
              onChange={(event) => updateTransferField("orders", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Current Abx/O2/IVF/PRN meds, hold/resume meds, monitoring orders"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Description / other
            <textarea
              value={transferFields.other}
              onChange={(event) => updateTransferField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Symptoms, course, PE, abx, procedures, consults, tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      )}

      <MedicationOrderReviewPanel
        compact={compact}
        sourceText={currentOrderSourceText()}
        onApply={applyMedicationOrderSummaries}
      />

      <div className="round-soap-generate-row">
        <label className="checkbox-label">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Text is de-identified.
        </label>
        <button type="button" disabled={loading || !composeRawText()} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : "Generate SOAP"}
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {status && <p className="status-message">{status}</p>}
      {warnings.length > 0 && (
        <div className="round-soap-warnings">
          <strong>Warnings</strong>
          <ClinicalText value={warnings.join("\n")} maxLines={4} keywordRules={keywordRules} />
        </div>
      )}

      {deltaReview && deltaReview.changedSections.length > 0 && (
        <section className="soap-delta-panel">
          <div className="soap-delta-heading">
            <div>
              <strong>Changed sections</strong>
              <p className="muted">
                Daily update applies safe section changes first. Use Accept all only after review.
              </p>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary compact-button" onClick={rejectAllDeltaChanges}>
                Reject all
              </button>
              <button type="button" className="secondary compact-button" onClick={acceptAllDeltaChanges}>
                Accept all
              </button>
            </div>
          </div>
          <div className="soap-delta-section-list">
            {deltaReview.changedSections.map((section) => (
              <article className={`soap-delta-section soap-delta-${section.risk}`} key={`${section.id}-${section.reason}-${section.blocked}`}>
                <div>
                  <strong>{section.label}</strong>
                  <span>{section.blocked ? "Held" : "Applied"}</span>
                  <p>{section.reason}</p>
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary compact-button" onClick={() => restoreDeltaSection(section.id)}>
                    Restore baseline
                  </button>
                  <button type="button" className="secondary compact-button" onClick={() => acceptDeltaSection(section.id)}>
                    Accept AI section
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="round-soap-editor-grid">
        <section className="round-soap-structured-editor">
          <div className="structured-soap-main-heading">
            <div>
              <strong>Reviewed SOAP blocks</strong>
              <span className="soap-editor-hint">Use controls for section, importance, and A/P blocks. Save writes normalized SOAP text.</span>
            </div>
          </div>
          <StructuredSoapEditor
            draft={editorDraft}
            onChange={updateEditorDraft}
            compact={compact}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
          />
          <details className="raw-soap-details">
            <summary>Raw SOAP text / paste fixer</summary>
            <p className="muted">
              Paste old SOAP or free text here, then Normalize text. Wrong bullets, full-width symbols, 1), 1., *, !, and dots are accepted.
            </p>
            <textarea
              className="soap-editor-textarea"
              value={rawSoapText}
              onChange={(event) => {
                setRawSoapText(event.target.value);
                setDirty(true);
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              spellCheck={false}
              rows={compact ? 8 : 12}
            />
          </details>
        </section>
        <section className="round-soap-preview" aria-label="Highlighted SOAP preview">
          <SoapVisualPreview value={soapText} compact={compact} layoutPreferences={layoutPreferences} keywordRules={keywordRules} labReferenceDisplay={compact ? "none" : "detail"} />
        </section>
      </div>

      {(dirty || Object.values(pendingOrderSources).some(Boolean)) && <p className="muted">Edited preview or pending order source is not saved yet. Firestore changes only after Save reviewed SOAP.</p>}
    </section>
  );
}

export default RoundSoapComposer;
