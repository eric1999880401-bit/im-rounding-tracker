import { useEffect, useRef, useState } from "react";
import type { AiClinicalSourceType, DailyNote, KeywordHighlightRule, Patient, RoundingLayoutPreferences, SoapEditTrace, UserAiStyleProfile } from "../types";
import { generateRoundSoap } from "../firebase/aiService";
import { readComposerPref, writeComposerPref } from "../composerPreferences";
import DeidNotice from "./DeidNotice";
import { ClinicalText } from "./ClinicalText";
import {
  formatSoapTextForEditorStyle,
  getCanonicalSoapText,
  localRoundSoapFromPaste,
  soapTextToPatientPatch,
  type SoapEditorFormat,
} from "../soapDraft";
import type { SoapSourceFields } from "../soapEvidence";
import { editorDraftToSoapText, emptySoapEditorLine, mergeOrderSourceIntoEditorDraft, parseSoapTextToEditorDraft, splitSoapEditorTaskLines } from "../soapEditorDraft";
import { emptyDailyNote, nowIso } from "../utils";
import { SoapVisualPreview } from "./SoapVisualPreview";
import SoapPrintPreview from "./SoapPrintPreview";
import StructuredSoapEditor from "./StructuredSoapEditor";
import MedicationOrderReviewPanel, { type MedicationOrderSummaryLine } from "./MedicationOrderReviewPanel";
import {
  acceptSoapDeltaSection,
  guardRoundSoapDelta,
  restoreSoapDeltaSection,
  soapPatchMatchesBaseline,
  type SoapDeltaReview,
  type SoapDeltaSection,
} from "../soapDeltaGuardrails";
import { normalizeAiSoapText } from "../aiSoapContract";
import { appendSoapEditTrace, buildSoapEditTrace, nextSoapVersion, type SoapEditOrigin } from "../soapEditTrace";
import {
  createUndoRedoHistory,
  pushUndoRedoEdit,
  replaceUndoRedoPresent,
  type UndoRedoHistory,
} from "../editHistory";
import {
  getSessionDraftStorage,
  makeRecoveryDraft,
  readRecoveryDraft,
  recoveryFingerprint,
  recoveryStaleState,
  removeRecoveryDraft,
  writeRecoveryDraft,
  type RecoveryDraft,
} from "../draftRecovery";
import SoapEditHistoryPanel from "./SoapEditHistoryPanel";

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
type RoundSoapQualityMode = "fast" | "balanced" | "highAccuracy";

// A usable fallback SOAP is still a baseline: an existing patient should be
// patched instead of regenerated just because the baseline predates soapText.
function deriveInitialWorkflowMode(dailyNotes: DailyNote[], baselineText = ""): WorkflowMode {
  const hasReviewedHistory = dailyNotes.some((note) => note.soapText?.trim() && note.soapStatus === "reviewed");
  return hasReviewedHistory || baselineText.trim() ? "dailyUpdate" : "newSoap";
}

function detectWorkflowMode(dailyNotes: DailyNote[], sourceText: string, fallback: WorkflowMode, baselineText = ""): WorkflowMode {
  if (/\b(?:transfer|handoff|sbar|icu\s*(?:transfer|stepdown)|轉科|交班|轉出)\b/i.test(sourceText)) return "transferHandoff";
  const hasReviewedHistory = dailyNotes.some((note) => note.soapText?.trim() && note.soapStatus === "reviewed");
  if (!hasReviewedHistory && !baselineText.trim()) return "newSoap";
  return fallback === "newSoap" ? "dailyUpdate" : fallback;
}

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

function editorDraftEquals(left: ReturnType<typeof parseSoapTextToEditorDraft>, right: ReturnType<typeof parseSoapTextToEditorDraft>) {
  return editorDraftToSoapText(left) === editorDraftToSoapText(right);
}

function recoveryTimeLabel(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildSavedNote(
  soapText: string,
  patient: Patient,
  notes: DailyNote[],
  selectedDate: string,
  patch: ReturnType<typeof soapTextToPatientPatch>,
  savedSoapVersion: number,
  editTrace: SoapEditTrace | null,
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
    soapVersion: savedSoapVersion,
    soapEditHistory: appendSoapEditTrace(baseNote.soapEditHistory, editTrace),
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
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>(() => deriveInitialWorkflowMode(dailyNotes, canonical.text));
  const [dailyFields, setDailyFields] = useState<DailyUpdateFields>(emptyDailyFields);
  const [newSoapFields, setNewSoapFields] = useState<NewSoapFields>(emptyNewSoapFields);
  const [transferFields, setTransferFields] = useState<TransferSoapFields>(emptyTransferFields);
  const [mixedSourceText, setMixedSourceText] = useState("");
  const [soapFormat, setSoapFormatState] = useState<SoapEditorFormat>(() =>
    readComposerPref("soapFormat", ["standard", "plain", "compact"] as const, "standard"),
  );
  const [previewMode, setPreviewMode] = useState<"soap" | "print">("soap");
  const [qualityMode, setQualityModeState] = useState<RoundSoapQualityMode>("balanced");
  const setSoapFormat = (value: SoapEditorFormat) => {
    setSoapFormatState(value);
    writeComposerPref("soapFormat", value);
  };
  const setQualityMode = (value: RoundSoapQualityMode) => {
    setQualityModeState(value);
  };
  const [editorDraft, setEditorDraft] = useState(() => parseSoapTextToEditorDraft(canonical.text));
  const [editorHistory, setEditorHistory] = useState<UndoRedoHistory<ReturnType<typeof parseSoapTextToEditorDraft>>>(() =>
    createUndoRedoHistory(parseSoapTextToEditorDraft(canonical.text)),
  );
  const [rawSoapText, setRawSoapText] = useState(canonical.text);
  const [dirty, setDirty] = useState(false);
  const [pendingOrderSources, setPendingOrderSources] = useState<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [deltaReview, setDeltaReview] = useState<SoapDeltaReview | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft<{ soapText: string }> | null>(null);
  const [recoverySavedAt, setRecoverySavedAt] = useState("");
  const editorDraftRef = useRef(editorDraft);
  const editorHistoryRef = useRef(editorHistory);
  const isComposingRef = useRef(false);
  const externalSoapRevisionRef = useRef(externalSoapRevision);
  const pendingSavedSoapRef = useRef<{ date: string; text: string; note: DailyNote } | null>(null);
  const pendingOrderSourcesRef = useRef<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const editOriginRef = useRef<SoapEditOrigin | null>(null);
  const manualBaselineRef = useRef(editorDraftToSoapText(parseSoapTextToEditorDraft(canonical.text)));
  const recoveryScope = { kind: "roundSoap" as const, patientId: patient.id, selectedDate };
  const recoveryBaseline = canonical.text;
  const recoveryBaselineUpdatedAt = selectedNoteForDate(dailyNotes, selectedDate)?.soapUpdatedAt || selectedNoteForDate(dailyNotes, selectedDate)?.updatedAt || "";
  const recoveryStorage = getSessionDraftStorage();
  const soapText = editorDraftToSoapText(editorDraft);

  useEffect(() => {
    editorHistoryRef.current = editorHistory;
  }, [editorHistory]);

  useEffect(() => {
    editOriginRef.current = null;
  }, [patient.id, selectedDate]);

  const hasUnsavedEdits = dirty || Object.values(pendingOrderSources).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedEdits);
  }, [hasUnsavedEdits, onDirtyChange]);

  // Warn before a tab close / reload / navigating away while SOAP edits are
  // unsaved. In-app navigation already has the session recovery draft as a net;
  // this covers tab close, where sessionStorage is lost.
  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedEdits]);

  useEffect(() => {
    const savedDraft = readRecoveryDraft<{ soapText: string }>(recoveryStorage, recoveryScope);
    if (!savedDraft?.payload.soapText.trim() || savedDraft.payload.soapText.trim() === canonical.text.trim()) {
      setRecoveryDraft(null);
      return;
    }
    setRecoveryDraft(savedDraft);
  }, [canonical.text, patient.id, recoveryStorage, selectedDate]);

  useEffect(() => {
    if (!dirty || isComposingRef.current) return;
    const text = editorDraftToSoapText(editorDraftRef.current).trim();
    if (!text || text === canonical.text.trim()) return;
    const timeout = window.setTimeout(() => {
      const draft = makeRecoveryDraft(
        recoveryScope,
        { soapText: text },
        recoveryBaseline,
        recoveryBaselineUpdatedAt,
      );
      if (writeRecoveryDraft(recoveryStorage, draft)) {
        setRecoverySavedAt(draft.draftUpdatedAt);
      }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [canonical.text, dirty, editorDraft, patient.id, recoveryBaseline, recoveryBaselineUpdatedAt, recoveryStorage, selectedDate]);

  useEffect(() => {
    if (dirty || isComposingRef.current) return;
    const pendingSavedSoap = pendingSavedSoapRef.current;
    if (pendingSavedSoap) {
      if (pendingSavedSoap.date === selectedDate && canonical.text !== pendingSavedSoap.text) return;
      pendingSavedSoapRef.current = null;
    }
    const nextDraft = parseSoapTextToEditorDraft(canonical.text);
    setEditorDraftState(nextDraft);
    const normalizedBaseline = editorDraftToSoapText(nextDraft);
    manualBaselineRef.current = normalizedBaseline;
    setRawSoapText(normalizedBaseline);
    setDeltaReview(null);
  }, [canonical.text, dirty, selectedDate]);

  useEffect(() => {
    if (externalSoapRevisionRef.current === externalSoapRevision || isComposingRef.current) return;
    externalSoapRevisionRef.current = externalSoapRevision;
    const nextSoapText = externalSoapText.trim();
    if (!nextSoapText) return;
    pendingSavedSoapRef.current = null;
    editOriginRef.current = null;
    const nextDraft = parseSoapTextToEditorDraft(nextSoapText);
    updateEditorDraft(nextDraft);
    setError("");
    setWarnings([]);
    setDeltaReview(null);
    setStatus(externalSoapStatus || "External SOAP draft loaded. Review, then Save reviewed SOAP.");
  }, [externalSoapRevision, externalSoapStatus, externalSoapText]);

  useEffect(() => {
    setQualityMode(workflowMode === "transferHandoff" ? "highAccuracy" : "balanced");
  }, [workflowMode]);

  function updateEditorDraft(nextDraft: typeof editorDraft) {
    const nextHistory = pushUndoRedoEdit(editorHistoryRef.current, nextDraft, editorDraftEquals);
    editorHistoryRef.current = nextHistory;
    setEditorHistory(nextHistory);
    setEditorDraftState(nextDraft, { replaceHistory: false });
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
  }

  function setEditorDraftState(nextDraft: typeof editorDraft, options: { replaceHistory?: boolean } = {}) {
    editorDraftRef.current = nextDraft;
    setEditorDraft(nextDraft);
    if (options.replaceHistory !== false) {
      const nextHistory = replaceUndoRedoPresent(editorHistoryRef.current, nextDraft);
      editorHistoryRef.current = nextHistory;
      setEditorHistory(nextHistory);
    }
  }

  function restoreEditorDraftFromHistory(nextDraft: typeof editorDraft) {
    editorDraftRef.current = nextDraft;
    setEditorDraft(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(editorDraftToSoapText(nextDraft) !== canonical.text);
    setDeltaReview(null);
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
    if (mixedSourceText.trim()) return mixedSourceText.trim();
    if (workflowMode === "newSoap") return composeNewSoapText();
    if (workflowMode === "transferHandoff") return composeTransferText();
    return composeDailyUpdateText();
  }

  function currentSourceFields(mode: WorkflowMode = workflowMode): SoapSourceFields {
    if (mixedSourceText.trim()) {
      if (mode === "newSoap") return { admission: mixedSourceText, other: mixedSourceText };
      if (mode === "transferHandoff") return { admission: mixedSourceText, lastSoap: mixedSourceText, other: mixedSourceText };
      return { other: mixedSourceText };
    }
    if (mode === "newSoap") return { ...newSoapFields };
    if (mode === "transferHandoff") return { ...transferFields };
    return { ...dailyFields };
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
    updateEditorDraft(nextDraft);
    updatePendingOrderSource(workflowMode, false);
    setError("");
    setStatus("藥囑 summary applied to local SOAP draft. Save reviewed SOAP to write Firestore.");
    setDeltaReview(null);
  }

  function clearSourceText() {
    setMixedSourceText("");
    setDailyFields(emptyDailyFields);
    setNewSoapFields(emptyNewSoapFields);
    setTransferFields(emptyTransferFields);
    clearPendingOrderSources();
  }

  function restoreRecoveryDraft() {
    if (!recoveryDraft?.payload.soapText.trim()) return;
    const nextDraft = parseSoapTextToEditorDraft(recoveryDraft.payload.soapText);
    updateEditorDraft(nextDraft);
    setDeltaReview(null);
    setError("");
    setStatus("Recovery draft restored locally. Review, then Save reviewed SOAP to write Firestore.");
    setRecoveryDraft(null);
  }

  function discardRecoveryDraft() {
    removeRecoveryDraft(recoveryStorage, recoveryScope);
    setRecoveryDraft(null);
    setRecoverySavedAt("");
    setStatus("Recovery draft discarded. Saved SOAP was not changed.");
  }

  async function handleGenerate(requestedQualityMode: RoundSoapQualityMode = qualityMode) {
    const rawText = composeRawText();
    const currentSoapText = editorDraftToSoapText(editorDraftRef.current);
    const requestWorkflowMode = detectWorkflowMode(dailyNotes, rawText, workflowMode, currentSoapText || canonical.text);
    const requestWorkflow = workflowModes.find((item) => item.value === requestWorkflowMode) ?? workflowModes[0];
    const automaticQualityMode: RoundSoapQualityMode = requestWorkflowMode === "transferHandoff"
      ? "highAccuracy"
      : requestedQualityMode;
    setError("");
    setStatus("");
    setWarnings([]);
    setDeltaReview(null);

    if (rawText.length < 10) {
      setError("Paste today's mixed clinical update first.");
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
            mode: "full" as const,
          }
        : await generateRoundSoap({
            patientId: patient.id,
            selectedDate,
            sourceType: requestWorkflow.sourceType,
            workflowMode: requestWorkflowMode,
            rawText,
            currentSoapBaseline: currentSoapText || canonical.text,
            deidentifiedConfirmed: true,
            qualityMode: automaticQualityMode,
            patientContext: patientContext(patient),
            userStyleProfile: aiStyleProfile,
          });

      const normalizedResult = normalizeAiSoapText(result.soapText.trim() || canonical.text, result.warnings ?? []);
      const guarded = guardRoundSoapDelta({
        workflowMode: requestWorkflowMode,
        baselineText: currentSoapText || canonical.text,
        candidateText: normalizedResult.soapText,
        sourceFields: currentSourceFields(requestWorkflowMode),
        candidateWarnings: normalizedResult.warnings,
        selectedDate,
      });
      const nextDraft = parseSoapTextToEditorDraft(guarded.acceptedText);
      editOriginRef.current = {
        source: "ai",
        beforeText: editorDraftToSoapText(nextDraft),
        workflowMode: requestWorkflowMode,
        aiDraftId: result.draftId,
        model: result.model,
        qualityMode: result.qualityMode ?? automaticQualityMode,
      };
      updateEditorDraft(nextDraft);
      updatePendingOrderSource(requestWorkflowMode, false);
      const patchWarnings = result.mode === "patch" && !soapPatchMatchesBaseline(result.patch, currentSoapText || canonical.text)
        ? ["AI patch baseline no longer matches the current editor. Baseline-preserving guardrails were applied; review changed sections."]
        : [];
      setWarnings([...patchWarnings, ...guarded.warnings, ...guarded.highRiskWarnings]);
      setDeltaReview(guarded);
      setStatus(
        guarded.highRiskWarnings.length > 0
          ? `SOAP preview generated (${result.model}, ${result.qualityMode ?? automaticQualityMode}); high-risk unrelated AI changes were held.`
          : `SOAP preview generated (${result.model}, ${result.qualityMode ?? automaticQualityMode}). Edit, then Save reviewed SOAP.`,
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
      const subscribedBaseNote = selectedNoteForDate(dailyNotes, selectedDate);
      const pendingBaseNote = pendingSavedSoapRef.current?.date === selectedDate ? pendingSavedSoapRef.current.note : undefined;
      const baseNote = pendingBaseNote && (pendingBaseNote.soapVersion ?? 0) >= (subscribedBaseNote?.soapVersion ?? 0)
        ? pendingBaseNote
        : subscribedBaseNote;
      const savedSoapVersion = nextSoapVersion(baseNote);
      const editOrigin = editOriginRef.current ?? {
        source: "manual" as const,
        beforeText: manualBaselineRef.current,
        workflowMode,
      };
      const editTrace = buildSoapEditTrace({
        ...editOrigin,
        afterText: reviewedText,
        baseSoapVersion: baseNote?.soapVersion ?? 0,
        savedSoapVersion,
      });
      const nextNote = buildSavedNote(reviewedText, nextPatient, dailyNotes, selectedDate, patch, savedSoapVersion, editTrace);
      await onSavePatient(nextPatient);
      await onSaveDailyNote(nextPatient.id, nextNote);
      const nextDraft = parseSoapTextToEditorDraft(reviewedText);
      pendingSavedSoapRef.current = { date: selectedDate, text: reviewedText, note: nextNote };
      setEditorDraftState(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      manualBaselineRef.current = reviewedText;
      clearSourceText();
      setDirty(false);
      setDeltaReview(null);
      editOriginRef.current = null;
      removeRecoveryDraft(recoveryStorage, recoveryScope);
      setRecoveryDraft(null);
      setRecoverySavedAt("");
      setStatus(`Reviewed SOAP saved. Board, Details, and Print now read this note.${editTrace ? " Correction history recorded." : ""}`);
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
    updateEditorDraft(nextDraft);
    setError("");
    setDeltaReview(null);
    setStatus(`${soapFormatOptions.find((item) => item.value === soapFormat)?.label ?? "SOAP"} applied. Review, then Save reviewed SOAP.`);
  }

  function loadDeltaSoapText(nextText: string, nextStatus: string) {
    const nextDraft = parseSoapTextToEditorDraft(nextText);
    updateEditorDraft(nextDraft);
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

  function resetToCanonical() {
    pendingSavedSoapRef.current = null;
    const nextDraft = parseSoapTextToEditorDraft(canonical.text);
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setMixedSourceText("");
    setDirty(false);
    setStatus("");
    setError("");
    setDeltaReview(null);
    removeRecoveryDraft(recoveryStorage, recoveryScope);
    setRecoveryDraft(null);
    setRecoverySavedAt("");
  }

  function renderDeltaReviewPanel(compactView = false) {
    if (!deltaReview || deltaReview.changedSections.length === 0) return null;
    return (
      <section className={compactView ? "soap-delta-panel soap-delta-panel-compact" : "soap-delta-panel"}>
        <div className="soap-delta-heading">
          <div>
            <strong>Changed sections</strong>
            {!compactView && <p className="muted">Only source-supported changes are applied; held sections keep the reviewed baseline.</p>}
          </div>
          <div className="form-actions">
            <button type="button" className="secondary compact-button" onClick={rejectAllDeltaChanges}>Reject all</button>
            <button type="button" className="secondary compact-button" onClick={acceptAllDeltaChanges}>Accept all</button>
          </div>
        </div>
        <div className="soap-delta-section-list">
          {deltaReview.changedSections.map((section) => (
            <article className={`soap-delta-section soap-delta-${section.risk}`} key={`${section.id}-${section.reason}-${section.blocked}`}>
              <div>
                <strong>{section.label}</strong>
                <span>{section.blocked ? "Held" : "Applied"}</span>
                {!compactView && <p>{section.reason}</p>}
              </div>
              <div className="form-actions">
                <button type="button" className="secondary compact-button" onClick={() => restoreDeltaSection(section.id)}>Restore</button>
                <button type="button" className="secondary compact-button" onClick={() => acceptDeltaSection(section.id)}>Accept</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  const estimatedTokens = Math.ceil((composeRawText().length + soapText.length) / 4);
  const currentRecoveryStaleState = recoveryDraft
    ? recoveryStaleState(recoveryDraft, recoveryFingerprint(recoveryBaseline), recoveryBaselineUpdatedAt)
    : null;
  const recoverySavedLabel = recoveryTimeLabel(recoverySavedAt);

  if (compact) {
    const automaticMode = detectWorkflowMode(dailyNotes, mixedSourceText, workflowMode, soapText || canonical.text);
    const automaticModeLabel = workflowModes.find((item) => item.value === automaticMode)?.label ?? "Daily update";
    return (
      <section className="round-soap-composer compact-round-soap-composer">
        <div className="round-soap-toolbar compact-soap-toolbar">
          <div>
            <h3>Quick SOAP update</h3>
            <p className="muted">Auto: {automaticModeLabel} · baseline {canonical.sourceDate || "legacy fallback"}</p>
          </div>
          <button type="button" className="secondary compact-button" onClick={resetToCanonical}>Reset</button>
        </div>
        <label className="round-soap-paste">
          Paste mixed update
          <textarea
            value={mixedSourceText}
            onChange={(event) => setMixedSourceText(event.target.value)}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            placeholder="Paste today's V/S, labs, imaging, course, orders, consults, and pending tasks together."
            rows={6}
          />
        </label>
        <div className="round-soap-generate-row compact-generate-row">
          <span className="muted">Preview only. Save remains explicit.</span>
          <button type="button" disabled={loading || mixedSourceText.trim().length < 10} onClick={() => void handleGenerate()}>
            {loading ? "Working..." : "Generate update"}
          </button>
        </div>
        {error && <p className="error-message">{error}</p>}
        {status && <p className="status-message">{status}</p>}
        {warnings.length > 0 && (
          <div className="round-soap-warnings">
            <strong>Review</strong>
            <ClinicalText value={warnings.join("\n")} maxLines={3} keywordRules={keywordRules} />
          </div>
        )}
        {renderDeltaReviewPanel(true)}
        <section className="round-soap-preview compact-soap-preview" aria-label="Quick SOAP preview">
          <SoapVisualPreview
            value={soapText}
            compact
            sourceFields={currentSourceFields(automaticMode)}
            layoutPreferences={layoutPreferences}
            keywordRules={keywordRules}
            labReferenceDisplay="none"
          />
        </section>
        <div className="compact-soap-save-row">
          {(dirty || Object.values(pendingOrderSources).some(Boolean)) && <span className="muted">Not saved yet.</span>}
          <button type="button" disabled={!soapText.trim() || loading || !dirty} onClick={() => void handleSave()}>
            Save reviewed SOAP
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="round-soap-composer">
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
          <button type="button" className="secondary" onClick={resetToCanonical}>
            Reset
          </button>
          <button type="button" disabled={!soapText.trim() || loading} onClick={() => void handleSave()}>
            Save reviewed SOAP
          </button>
        </div>
      </div>
      <label className="round-soap-paste round-soap-primary-paste">
        Paste clinical update
        <textarea
          value={mixedSourceText}
          onChange={(event) => setMixedSourceText(event.target.value)}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          placeholder="Paste V/S, labs, imaging, course, orders, consults, and tasks together. AI will route sections and preserve the reviewed baseline."
          rows={7}
        />
      </label>
      <div className="round-soap-generate-row primary-generate-row">
        <span className="muted">Workflow and cost tier are selected automatically. Nothing is saved until Save reviewed SOAP.</span>
        <button type="button" disabled={loading || mixedSourceText.trim().length < 10} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : "Generate SOAP update"}
        </button>
      </div>
      {recoveryDraft && (
        <div className={currentRecoveryStaleState?.stale ? "status-message recovery-draft-banner stale-recovery" : "status-message recovery-draft-banner"}>
          <div>
            <strong>Unsaved recovery draft available</strong>
            <span>
              {recoveryTimeLabel(recoveryDraft.draftUpdatedAt) || "recent draft"}
              {currentRecoveryStaleState?.stale ? ` · ${currentRecoveryStaleState.reason}` : ""}
            </span>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary compact-button" onClick={discardRecoveryDraft}>
              Discard
            </button>
            <button type="button" className="compact-button" onClick={restoreRecoveryDraft}>
              Restore locally
            </button>
          </div>
        </div>
      )}
      {!recoveryDraft && recoverySavedLabel && dirty && (
        <p className="muted round-soap-mode-helper">Session recovery draft autosaved at {recoverySavedLabel}. Firestore still changes only after Save reviewed SOAP.</p>
      )}

      <details className="round-soap-advanced-panel">
        <summary>Advanced source controls</summary>
        <div className="round-soap-advanced-body">
          <div className="form-actions round-soap-advanced-selectors">
            <select value={workflowMode} onChange={(event) => setWorkflowMode(event.target.value as WorkflowMode)} title="Workflow override">
              {workflowModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={soapFormat} onChange={(event) => setSoapFormat(event.target.value as SoapEditorFormat)} title="SOAP editor format">
              {soapFormatOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={qualityMode} onChange={(event) => setQualityMode(event.target.value as RoundSoapQualityMode)} title="AI quality / cost">
              <option value="fast">Efficient (GPT-5.4 mini)</option>
              <option value="balanced">Recommended (GPT-5.4)</option>
              <option value="highAccuracy">Best quality (GPT-5.5)</option>
            </select>
          </div>
          <p className="muted">{workflow.helper} Clear the primary mixed paste before using these guided fields.</p>
          <p className="muted">
            Approx. {estimatedTokens.toLocaleString()} input + baseline tokens. Transfer uses GPT-5.5; complex first SOAP may be upgraded by the backend.
          </p>

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

      <DeidNotice />
      <div className="round-soap-generate-row">
        <button type="button" disabled={loading || !composeRawText()} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : "Generate SOAP"}
        </button>
        {qualityMode !== "highAccuracy" && (warnings.length > 0 || Boolean(deltaReview?.highRiskWarnings.length)) && (
          <button
            type="button"
            className="secondary"
            disabled={loading || !composeRawText()}
            onClick={() => {
              setQualityMode("highAccuracy");
              void handleGenerate("highAccuracy");
            }}
          >
            Upgrade this draft
          </button>
        )}
      </div>
        </div>
      </details>

      {error && <p className="error-message">{error}</p>}
      {status && <p className="status-message">{status}</p>}
      {warnings.length > 0 && (
        <div className="round-soap-warnings">
          <strong>Warnings</strong>
          <ClinicalText value={warnings.join("\n")} maxLines={4} keywordRules={keywordRules} />
        </div>
      )}

      {renderDeltaReviewPanel()}

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
            showHeader={false}
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
          <div className="soap-preview-mode-toggle" aria-label="Preview mode">
            <button
              type="button"
              className={previewMode === "soap" ? "compact-button" : "secondary compact-button"}
              onClick={() => setPreviewMode("soap")}
            >
              SOAP preview
            </button>
            <button
              type="button"
              className={previewMode === "print" ? "compact-button" : "secondary compact-button"}
              onClick={() => setPreviewMode("print")}
            >
              Print preview
            </button>
          </div>
          {previewMode === "print" ? (
            <SoapPrintPreview value={soapText} layoutPreferences={layoutPreferences} keywordRules={keywordRules} />
          ) : (
            <SoapVisualPreview
              value={soapText}
              compact={compact}
              sourceFields={currentSourceFields()}
              layoutPreferences={layoutPreferences}
              keywordRules={keywordRules}
              labReferenceDisplay={compact ? "none" : "detail"}
            />
          )}
        </section>
      </div>

      {!compact && <SoapEditHistoryPanel history={selectedNoteForDate(dailyNotes, selectedDate)?.soapEditHistory} />}

      {(dirty || Object.values(pendingOrderSources).some(Boolean)) && <p className="muted">Not saved yet.</p>}
    </section>
  );
}

export default RoundSoapComposer;
