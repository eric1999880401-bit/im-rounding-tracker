import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AiClinicalSourceType, ClinicalAuditEntrypoint, DailyNote, KeywordHighlightRule, Patient, RoundingLayoutPreferences, SaveDailyNoteOptions, SoapEditTrace, UserAiStyleProfile } from "../types";
import { generateRoundSoap } from "../firebase/aiService";
import { readComposerPref, writeComposerPref } from "../composerPreferences";
import DeidNotice from "./DeidNotice";
import { ClinicalText } from "./ClinicalText";
import {
  formatSoapTextForEditorStyle,
  getCanonicalSoapText,
  localRoundSoapFromPaste,
  reviewedSoapCompletenessIssues,
  soapTextToPatientPatch,
  splitGuidedSoapSource,
  type SoapEditorFormat,
} from "../soapDraft";
import type { SoapSourceFields } from "../soapEvidence";
import {
  editorDraftToSoapText,
  emptySoapEditorLine,
  mergeOrderSourceIntoEditorDraft,
  parseCanonicalSoapTextToEditorDraft,
  parseSoapTextToEditorDraft,
  splitSoapEditorTaskLines,
} from "../soapEditorDraft";
import { emptyDailyNote, hasChronicRenalContext, nowIso } from "../utils";
import { SoapVisualPreview } from "./SoapVisualPreview";
import SoapPrintPreview from "./SoapPrintPreview";
import StructuredSoapEditor from "./StructuredSoapEditor";
import MedicationOrderReviewPanel, { type MedicationOrderSummaryLine } from "./MedicationOrderReviewPanel";
import {
  acceptSoapDeltaSection,
  restoreSoapDeltaSection,
  soapPatchMatchesBaseline,
  type RoundSoapSourceFields,
  type SoapDeltaReview,
  type SoapDeltaSection,
} from "../soapDeltaGuardrails";
import {
  acceptStructuredRoundSoap,
  applyVitalsOnlyDailyUpdate,
  isVitalsOnlyDailySource,
  normalizeRoundSoapSourceFields,
} from "../roundSoapContract";
import { appendSoapEditTrace, buildSoapEditTrace, nextSoapVersion, type SoapEditOrigin } from "../soapEditTrace";
import {
  canRedo,
  canUndo,
  createUndoRedoHistory,
  pushUndoRedoEdit,
  redoEdit,
  replaceUndoRedoPresent,
  undoEdit,
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
import {
  deriveInitialRoundSoapWorkflow,
  roundSoapBaselineForWorkflow,
  suggestedRoundSoapWorkflow,
  type RoundSoapWorkflowMode,
} from "../roundSoapWorkflow";
import { buildCanonicalLabDataset, canonicalLabFactsForAi } from "../labDataset";
import { buildCanonicalImageDataset, canonicalImageFactsForAi } from "../imageDataset";
import { buildSoapAuditWrite } from "../clinicalAudit";
import {
  canApplyPatientContextRequest,
  isLatestRequest,
  isPatientContextDraftBoundToSelection,
  type PatientContextRequestIdentity,
} from "../asyncRequestGuard";
import {
  bindDeidentifiedConfirmation,
  createAiPrivacyContextFingerprint,
  isDeidentifiedConfirmationCurrent,
} from "../aiPrivacyConfirmation";
import {
  captureRoundSoapEditorRevision,
  reconcileRoundSoapEditorRevision,
  roundSoapEditorRevisionMatchesSelection,
} from "../roundSoapEditorRevision";

interface RoundSoapComposerProps {
  patient: Patient;
  dailyNotes: DailyNote[];
  selectedDate: string;
  onSaveDailyNote: (patientId: string, note: DailyNote, options?: SaveDailyNoteOptions) => Promise<void>;
  auditEntrypoint?: ClinicalAuditEntrypoint;
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

type WorkflowMode = RoundSoapWorkflowMode;
type RoundSoapQualityMode = "fast" | "balanced" | "highAccuracy";

const MAX_ROUND_SOAP_RAW_CHARS = 120_000;
const LONG_TRANSFER_SOURCE_CHARS = 18_000;

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
  {
    value: "repairSoap",
    label: "Repair current SOAP",
    helper: "Use GPT-5.6 Sol to consolidate a cluttered reviewed SOAP without adding unsupported facts. Preview only until Save.",
    sourceType: "mixed",
  },
];

const qualityModeOptions: Array<{ value: RoundSoapQualityMode; label: string; helper: string }> = [
  { value: "fast", label: "Efficient (GPT-5.6 Luna)", helper: "Lower cost for narrow, low-risk updates." },
  { value: "balanced", label: "Recommended (GPT-5.6 Terra)", helper: "Best value for routine New SOAP and Daily updates." },
  { value: "highAccuracy", label: "Best quality (GPT-5.6 Sol)", helper: "Use for ICU transfer or clinically complex source text." },
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
  other: "O/Other",
  ap: "A/P",
  orders: "藥囑",
  tasks: "Tasks",
  dc: "DC",
};

const emptyPendingOrderSources: Record<WorkflowMode, boolean> = {
  dailyUpdate: false,
  newSoap: false,
  transferHandoff: false,
  repairSoap: false,
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

function generationContextKey(
  patientUpdatedAt: string,
  workflowMode: WorkflowMode,
  rawText: string,
  baselineText: string,
) {
  return JSON.stringify([patientUpdatedAt, workflowMode, rawText, baselineText]);
}

function buildSavedNote(
  soapText: string,
  baseNote: DailyNote | undefined,
  selectedDate: string,
  patch: ReturnType<typeof soapTextToPatientPatch>,
  savedSoapVersion: number,
  editTrace: SoapEditTrace | null,
): DailyNote {
  const now = nowIso();
  const savedBaseNote = baseNote ?? emptyDailyNote(selectedDate);
  return {
    ...savedBaseNote,
    ...patch.dailyNotePatch,
    date: selectedDate,
    soapText: soapText.trim(),
    soapStatus: "reviewed",
    soapUpdatedAt: now,
    soapVersion: savedSoapVersion,
    soapEditHistory: appendSoapEditTrace(savedBaseNote.soapEditHistory, editTrace),
    createdAt: savedBaseNote.createdAt || now,
    updatedAt: now,
  };
}

function RoundSoapComposer({
  patient,
  dailyNotes,
  selectedDate,
  onSaveDailyNote,
  auditEntrypoint = "unknown",
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
  const subscribedNote = selectedNoteForDate(dailyNotes, selectedDate);
  const persistedPatientUpdatedAt = patient.persistedUpdatedAt ?? patient.updatedAt;
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>(() => deriveInitialRoundSoapWorkflow(dailyNotes, patient.isNewAdmission));
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
  const [editorDraft, setEditorDraft] = useState(() => parseCanonicalSoapTextToEditorDraft(canonical.text));
  const [editorHistory, setEditorHistory] = useState<UndoRedoHistory<ReturnType<typeof parseSoapTextToEditorDraft>>>(() =>
    createUndoRedoHistory(parseCanonicalSoapTextToEditorDraft(canonical.text)),
  );
  const [rawSoapText, setRawSoapText] = useState(canonical.text);
  const [dirty, setDirty] = useState(false);
  const [pendingOrderSources, setPendingOrderSources] = useState<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmedPrivacyFingerprint, setConfirmedPrivacyFingerprint] = useState("");
  const [storeSourceInAudit, setStoreSourceInAudit] = useState(false);
  const [deltaReview, setDeltaReview] = useState<SoapDeltaReview | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft<{ soapText: string }> | null>(null);
  const [recoverySavedAt, setRecoverySavedAt] = useState("");
  const editorDraftRef = useRef(editorDraft);
  const dirtyRef = useRef(false);
  const editorHistoryRef = useRef(editorHistory);
  const isComposingRef = useRef(false);
  const externalSoapRevisionRef = useRef(externalSoapRevision);
  const pendingSavedSoapRef = useRef<{ date: string; text: string; note: DailyNote } | null>(null);
  const pendingOrderSourcesRef = useRef<Record<WorkflowMode, boolean>>(emptyPendingOrderSources);
  const editOriginRef = useRef<SoapEditOrigin | null>(null);
  const manualBaselineRef = useRef(editorDraftToSoapText(parseCanonicalSoapTextToEditorDraft(canonical.text)));
  const generationRequestIdRef = useRef(0);
  const currentGenerationContextRef = useRef({ patientId: patient.id, selectedDate, contextKey: "" });
  const editorScopeRef = useRef({ patientId: patient.id, selectedDate });
  const editorRevisionRef = useRef(captureRoundSoapEditorRevision(
    patient.id,
    selectedDate,
    subscribedNote,
    persistedPatientUpdatedAt,
  ));
  const recoveryScope = { kind: "roundSoap" as const, patientId: patient.id, selectedDate };
  const recoveryBaseline = canonical.text;
  const recoveryBaselineUpdatedAt = subscribedNote?.soapUpdatedAt || subscribedNote?.updatedAt || "";
  // Never place real clinical text in browser storage. Recovery is restricted
  // to de-identified demo fixtures.
  const recoveryStorage = isDemoMode ? getSessionDraftStorage() : null;
  const soapText = editorDraftToSoapText(editorDraft);

  useEffect(() => {
    editorHistoryRef.current = editorHistory;
  }, [editorHistory]);

  useEffect(() => {
    editOriginRef.current = null;
    setConfirmedPrivacyFingerprint("");
    setStoreSourceInAudit(false);
  }, [patient.id, patient.updatedAt, selectedDate]);

  useEffect(() => {
    setWorkflowMode(deriveInitialRoundSoapWorkflow(dailyNotes, patient.isNewAdmission));
  }, [patient.id]);

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
    const preserveEditorRevision = dirtyRef.current || isComposingRef.current;
    const nextEditorRevision = reconcileRoundSoapEditorRevision(
      editorRevisionRef.current,
      patient.id,
      selectedDate,
      subscribedNote,
      persistedPatientUpdatedAt,
      preserveEditorRevision,
    );
    if (preserveEditorRevision) return;
    const pendingSavedSoap = pendingSavedSoapRef.current;
    if (pendingSavedSoap) {
      if (pendingSavedSoap.date === selectedDate && canonical.text !== pendingSavedSoap.text) return;
      pendingSavedSoapRef.current = null;
    }
    const nextDraft = parseCanonicalSoapTextToEditorDraft(canonical.text);
    editorScopeRef.current = { patientId: patient.id, selectedDate };
    editorRevisionRef.current = nextEditorRevision;
    setEditorDraftState(nextDraft);
    const normalizedBaseline = editorDraftToSoapText(nextDraft);
    manualBaselineRef.current = normalizedBaseline;
    setRawSoapText(normalizedBaseline);
    setDeltaReview(null);
  }, [canonical.text, dirty, patient.id, persistedPatientUpdatedAt, selectedDate, subscribedNote]);

  useEffect(() => {
    if (externalSoapRevisionRef.current === externalSoapRevision || isComposingRef.current) return;
    externalSoapRevisionRef.current = externalSoapRevision;
    const nextSoapText = externalSoapText.trim();
    if (!nextSoapText) return;
    pendingSavedSoapRef.current = null;
    editOriginRef.current = null;
    const nextDraft = parseCanonicalSoapTextToEditorDraft(nextSoapText);
    editorScopeRef.current = { patientId: patient.id, selectedDate };
    editorRevisionRef.current = captureRoundSoapEditorRevision(
      patient.id,
      selectedDate,
      subscribedNote,
      persistedPatientUpdatedAt,
    );
    updateEditorDraft(nextDraft);
    setError("");
    setWarnings([]);
    setDeltaReview(null);
    setStatus(externalSoapStatus || "External SOAP draft loaded. Review, then Save reviewed SOAP.");
  }, [externalSoapRevision, externalSoapStatus, externalSoapText]);

  useEffect(() => {
    setQualityMode(workflowMode === "transferHandoff" || workflowMode === "repairSoap" ? "highAccuracy" : "balanced");
  }, [workflowMode]);

  function updateEditorDraft(nextDraft: typeof editorDraft) {
    const nextHistory = pushUndoRedoEdit(editorHistoryRef.current, nextDraft, editorDraftEquals);
    editorHistoryRef.current = nextHistory;
    setEditorHistory(nextHistory);
    setEditorDraftState(nextDraft, { replaceHistory: false });
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setComposerDirty(true);
  }

  function setComposerDirty(nextDirty: boolean) {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
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
    setComposerDirty(editorDraftToSoapText(nextDraft) !== canonical.text);
    setDeltaReview(null);
  }

  function applyHistoryResult(result: { history: UndoRedoHistory<typeof editorDraft>; changed: boolean }) {
    if (!result.changed) return;
    editorHistoryRef.current = result.history;
    setEditorHistory(result.history);
    restoreEditorDraftFromHistory(result.history.present);
  }

  function undoEditorChange() {
    if (loading || isComposingRef.current) return;
    applyHistoryResult(undoEdit(editorHistoryRef.current));
  }

  function redoEditorChange() {
    if (loading || isComposingRef.current) return;
    applyHistoryResult(redoEdit(editorHistoryRef.current));
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || isComposingRef.current) return;
    const key = event.key.toLowerCase();
    const redoRequested = key === "y" || (key === "z" && event.shiftKey);
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    if (redoRequested) redoEditorChange();
    else undoEditorChange();
  }


  const workflow = workflowModes.find((item) => item.value === workflowMode) ?? workflowModes[0];

  function updateDailyField(field: keyof DailyUpdateFields, value: string) {
    setDailyFields((current) => ({ ...current, [field]: value }));
    setConfirmedPrivacyFingerprint("");
    if (field === "orders") updatePendingOrderSource("dailyUpdate", value);
  }

  function updateNewSoapField(field: keyof NewSoapFields, value: string) {
    setNewSoapFields((current) => ({ ...current, [field]: value }));
    setConfirmedPrivacyFingerprint("");
    if (field === "orders") updatePendingOrderSource("newSoap", value);
  }

  function updateTransferField(field: keyof TransferSoapFields, value: string) {
    setTransferFields((current) => ({ ...current, [field]: value }));
    setConfirmedPrivacyFingerprint("");
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
    if (workflowMode === "repairSoap") return "Baseline-only SOAP repair; no new clinical facts were supplied.";
    if (workflowMode === "newSoap") return composeNewSoapText();
    if (workflowMode === "transferHandoff") return composeTransferText();
    return composeDailyUpdateText();
  }

  const currentGenerationRawText = composeRawText();
  const currentGenerationBaseline = roundSoapBaselineForWorkflow(workflowMode, {
    text: editorDraftToSoapText(editorDraftRef.current) || canonical.text,
    source: canonical.source,
  });
  const privacyContextFingerprint = createAiPrivacyContextFingerprint(
    patient.id,
    patient.updatedAt,
    selectedDate,
    workflowMode,
    currentGenerationRawText,
    currentGenerationBaseline,
  );
  const deidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
    confirmedPrivacyFingerprint,
    privacyContextFingerprint,
  );
  currentGenerationContextRef.current = {
    patientId: patient.id,
    selectedDate,
    contextKey: generationContextKey(
      patient.updatedAt,
      workflowMode,
      currentGenerationRawText,
      currentGenerationBaseline,
    ),
  };

  function currentSourceFields(mode: WorkflowMode = workflowMode): RoundSoapSourceFields & SoapSourceFields {
    if (mode === "repairSoap") {
      return normalizeRoundSoapSourceFields({ other: mixedSourceText.trim(), rawSource: mixedSourceText.trim() });
    }
    if (mixedSourceText.trim()) {
      const routed = splitGuidedSoapSource(mixedSourceText);
      if (mode === "dailyUpdate") {
        return normalizeRoundSoapSourceFields({
          vitals: routed.vitals,
          labs: routed.labs,
          images: routed.images,
          orders: routed.orders,
          other: [routed.admission, routed.other].filter(Boolean).join("\n"),
          rawSource: mixedSourceText,
        });
      }
      if (mode === "newSoap") {
        return normalizeRoundSoapSourceFields({
          admission: routed.admission,
          vitals: routed.vitals,
          labs: routed.labs,
          images: routed.images,
          orders: routed.orders,
          other: routed.other,
          rawSource: mixedSourceText,
        });
      }
      if (mode === "transferHandoff") {
        return normalizeRoundSoapSourceFields({
          admission: routed.admission,
          lastSoap: routed.lastSoap,
          vitals: routed.vitals,
          labs: routed.labs,
          images: routed.images,
          orders: routed.orders,
          other: routed.other,
          rawSource: mixedSourceText,
        });
      }
    }
    if (mode === "newSoap") return normalizeRoundSoapSourceFields({ ...newSoapFields });
    if (mode === "transferHandoff") return normalizeRoundSoapSourceFields({ ...transferFields });
    return normalizeRoundSoapSourceFields({ ...dailyFields });
  }

  function updateMixedSourceText(value: string) {
    setMixedSourceText(value);
    setConfirmedPrivacyFingerprint("");
    setError("");
    setWarnings([]);
    setDeltaReview(null);
  }

  function currentOrderSourceText() {
    if (workflowMode === "repairSoap") return "";
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
    setConfirmedPrivacyFingerprint("");
    setStoreSourceInAudit(false);
    clearPendingOrderSources();
  }

  function restoreRecoveryDraft() {
    if (!recoveryDraft?.payload.soapText.trim()) return;
    const nextDraft = parseCanonicalSoapTextToEditorDraft(recoveryDraft.payload.soapText);
    editorScopeRef.current = { patientId: patient.id, selectedDate };
    editorRevisionRef.current = captureRoundSoapEditorRevision(
      patient.id,
      selectedDate,
      subscribedNote,
      persistedPatientUpdatedAt,
    );
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
    const requestWorkflowMode = workflowMode;
    const requestWorkflow = workflowModes.find((item) => item.value === requestWorkflowMode) ?? workflowModes[0];
    const requestQualityMode = requestedQualityMode;
    const requestBaseline = roundSoapBaselineForWorkflow(requestWorkflowMode, {
      text: currentSoapText || canonical.text,
      source: canonical.source,
    });
    const requestSourceFields = currentSourceFields(requestWorkflowMode);
    const canonicalLabFacts = canonicalLabFactsForAi(buildCanonicalLabDataset(String(requestSourceFields.labs ?? "")));
    const canonicalImageFacts = canonicalImageFactsForAi(buildCanonicalImageDataset(
      [requestSourceFields.images, requestSourceFields.rawSource].filter(Boolean).join("\n"),
    ));
    setError("");
    setStatus("");
    setWarnings([]);
    setDeltaReview(null);

    if (!isPatientContextDraftBoundToSelection(editorScopeRef.current, patient.id, selectedDate)) {
      setError("This SOAP draft belongs to a different patient or date. Reset to the current saved SOAP before generating.");
      return;
    }

    if (rawText.length < 10) {
      setError("Paste today's mixed clinical update first.");
      return;
    }

    if (rawText.length > MAX_ROUND_SOAP_RAW_CHARS) {
      setError(`The pasted record exceeds ${MAX_ROUND_SOAP_RAW_CHARS.toLocaleString()} characters. Split only the raw export; do not manually summarize or remove clinical details.`);
      return;
    }

    if (!isDemoMode && !deidentifiedConfirmed) {
      setError("Confirm that the pasted text is de-identified before sending it to the AI service.");
      return;
    }

    if (requestWorkflowMode === "dailyUpdate" && requestBaseline.trim() && isVitalsOnlyDailySource(requestSourceFields)) {
      const accepted = applyVitalsOnlyDailyUpdate(requestBaseline, requestSourceFields);
      if (accepted.fatalErrors.length > 0) {
        setError(accepted.fatalErrors.join(" "));
        return;
      }
      editOriginRef.current = {
        source: "manual",
        beforeText: requestBaseline,
        baselineText: requestBaseline,
        // Keep the generation source only in component memory. The current
        // retention choice is applied again at Save and is authoritative.
        sourceText: rawText,
        workflowMode: requestWorkflowMode,
      };
      editorScopeRef.current = { patientId: patient.id, selectedDate };
      updateEditorDraft(accepted.draft);
      setDeltaReview(accepted.review);
      setStatus("V/S updated directly from the pasted source. S, Lab, Image, A/P, 藥囑, Tasks, and DC were preserved. Review, then Save reviewed SOAP.");
      return;
    }

    const requestIdentity: PatientContextRequestIdentity = {
      requestId: ++generationRequestIdRef.current,
      patientId: patient.id,
      selectedDate,
      contextKey: generationContextKey(
        patient.updatedAt,
        requestWorkflowMode,
        rawText,
        requestBaseline,
      ),
    };
    setLoading(true);
    try {
      const result = isDemoMode
        ? {
            draftId: "local-demo-round-soap",
            soapText: localRoundSoapFromPaste(patient, dailyNotes, selectedDate, rawText, requestWorkflowMode),
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
            currentSoapBaseline: requestBaseline,
            deidentifiedConfirmed,
            qualityMode: requestQualityMode,
            patientContext: {
              ...patientContext(patient),
              ...(canonicalLabFacts.length > 0 ? { labFacts: canonicalLabFacts } : {}),
              ...(canonicalImageFacts.length > 0 ? { imageFacts: canonicalImageFacts } : {}),
            },
            userStyleProfile: aiStyleProfile,
          });

      const currentContext = currentGenerationContextRef.current;
      if (!canApplyPatientContextRequest(
        requestIdentity,
        generationRequestIdRef.current,
        currentContext.patientId,
        currentContext.selectedDate,
        currentContext.contextKey,
      )) {
        return;
      }

      const accepted = result.structuredDraft
        ? acceptStructuredRoundSoap({
            value: result.structuredDraft,
            baselineText: requestBaseline,
            sourceFields: requestSourceFields,
            workflowMode: requestWorkflowMode,
          })
        : {
            draft: parseSoapTextToEditorDraft(result.soapText.trim() || requestBaseline || canonical.text),
            fatalErrors: [] as string[],
            review: {
              workflowMode: requestWorkflowMode,
              baselineText: requestBaseline,
              candidateText: result.soapText,
              acceptedText: result.soapText,
              changedSections: [],
              warnings: [...(result.warnings ?? []), "Legacy text-only AI response received; structured validation was unavailable."],
              highRiskWarnings: [],
            } satisfies SoapDeltaReview,
          };
      if (accepted.fatalErrors.length > 0) {
        setWarnings([...new Set([...(result.warnings ?? []), ...accepted.review.warnings])].slice(0, 8));
        setDeltaReview(accepted.review);
        setError(accepted.fatalErrors.join(" "));
        return;
      }
      const nextDraft = accepted.draft;
      editOriginRef.current = {
        source: "ai",
        // Correction learning compares the candidate the clinician actually
        // reviewed with the final saved text, not the pre-generation baseline.
        beforeText: editorDraftToSoapText(nextDraft),
        baselineText: requestBaseline,
        sourceText: rawText,
        workflowMode: requestWorkflowMode,
        aiDraftId: result.draftId,
        model: result.model,
        qualityMode: result.qualityMode ?? requestQualityMode,
      };
      editorScopeRef.current = { patientId: requestIdentity.patientId, selectedDate: requestIdentity.selectedDate };
      updateEditorDraft(nextDraft);
      updatePendingOrderSource(requestWorkflowMode, false);
      const patchWarnings = result.mode === "patch" && !soapPatchMatchesBaseline(result.patch, requestBaseline)
        ? ["AI patch baseline no longer matches the current editor. Baseline-preserving guardrails were applied; review changed sections."]
        : [];
      setWarnings([...patchWarnings, ...accepted.review.warnings, ...accepted.review.highRiskWarnings]);
      setDeltaReview(accepted.review);
      setStatus(
        accepted.review.highRiskWarnings.length > 0
          ? `SOAP preview generated (${result.model}, ${result.qualityMode ?? requestQualityMode}); high-risk unrelated AI changes were held.`
          : `SOAP preview generated (${result.model}, ${result.qualityMode ?? requestQualityMode}). Edit, then Save reviewed SOAP.`,
      );
    } catch (nextError) {
      const currentContext = currentGenerationContextRef.current;
      if (canApplyPatientContextRequest(
        requestIdentity,
        generationRequestIdRef.current,
        currentContext.patientId,
        currentContext.selectedDate,
        currentContext.contextKey,
      )) {
        setError(nextError instanceof Error ? nextError.message : "SOAP generation failed. No data was saved.");
      }
    } finally {
      if (isLatestRequest(requestIdentity, generationRequestIdRef.current)) setLoading(false);
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

    if (!isPatientContextDraftBoundToSelection(editorScopeRef.current, patient.id, selectedDate)) {
      setError("Save blocked: this SOAP draft belongs to a different patient or date. Reset and review the current patient SOAP.");
      return;
    }

    const editorRevision = editorRevisionRef.current;
    if (!roundSoapEditorRevisionMatchesSelection(editorRevision, patient.id, selectedDate)) {
      setError("Save blocked: this SOAP draft was based on a different patient or date revision. Reset and review the current patient SOAP.");
      return;
    }

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
    const completenessIssues = reviewedSoapCompletenessIssues(reviewedText);
    if (completenessIssues.length > 0) {
      setError(`Reviewed SOAP is incomplete: ${completenessIssues.join(" ")} Add an explicit missing-data line instead of saving an ambiguous blank section.`);
      return;
    }

    setLoading(true);
    try {
      const patch = soapTextToPatientPatch(reviewedText, patient, selectedDate);
      const nextPatient = { ...patch.patient, updatedAt: nowIso() };
      // Never rebase a dirty draft from the latest subscription here. The
      // editor revision is the exact note snapshot this text was based on; if
      // another client advanced it, the Firestore transaction must conflict.
      const baseNote = editorRevision.note;
      const baseSoapVersion = editorRevision.soapVersion;
      const savedSoapVersion = nextSoapVersion(baseNote);
      const capturedEditOrigin = editOriginRef.current ?? {
        source: "manual" as const,
        beforeText: manualBaselineRef.current,
        workflowMode,
      };
      const editOrigin: SoapEditOrigin = {
        ...capturedEditOrigin,
        // The checkbox state at the actual commit controls persistence. This
        // supports opting out after preview and opting in before Save without
        // accidentally retaining a different/current source.
        sourceText: storeSourceInAudit ? capturedEditOrigin.sourceText ?? "" : "",
      };
      const editTrace = buildSoapEditTrace({
        ...editOrigin,
        afterText: reviewedText,
        baseSoapVersion,
        savedSoapVersion,
      });
      const nextNote = buildSavedNote(reviewedText, baseNote, selectedDate, patch, savedSoapVersion, editTrace);
      const audit = buildSoapAuditWrite({
        patientId: nextPatient.id,
        dailyNoteDate: selectedDate,
        entrypoint: auditEntrypoint,
        origin: editOrigin,
        finalText: reviewedText,
        editTrace,
        baseSoapVersion,
        savedSoapVersion,
      });
      // dailyNote.soapText is the canonical Board/Details/Print source. Commit it
      // before the compatibility patient-field mirror so an unrelated patient
      // document failure cannot make a reviewed A/P disappear from the list.
      await onSaveDailyNote(nextPatient.id, nextNote, {
        audit,
        expectedSoapVersion: baseSoapVersion,
        expectedPatientUpdatedAt: editorRevision.patientUpdatedAt,
        patientPatch: {
          importantRedFlags: nextPatient.importantRedFlags,
          overnightEvent: nextPatient.overnightEvent,
          subjectiveOrChiefConcern: nextPatient.subjectiveOrChiefConcern,
          vitalSigns: nextPatient.vitalSigns,
          bloodSugar: nextPatient.bloodSugar,
          physicalExam: nextPatient.physicalExam,
          newLabs: nextPatient.newLabs,
          rawLabText: nextPatient.rawLabText,
          newImaging: nextPatient.newImaging,
          assessment: nextPatient.assessment,
          plan: nextPatient.plan,
          activeProblems: nextPatient.activeProblems,
          activeProblemItems: nextPatient.activeProblemItems,
          assessmentPlanItems: nextPatient.assessmentPlanItems,
          dischargePlan: nextPatient.dischargePlan,
          vsOrder: nextPatient.vsOrder,
          tasks: nextPatient.tasks,
          updatedAt: nextPatient.updatedAt,
        },
      });
      const nextDraft = parseCanonicalSoapTextToEditorDraft(reviewedText);
      pendingSavedSoapRef.current = { date: selectedDate, text: reviewedText, note: nextNote };
      editorRevisionRef.current = captureRoundSoapEditorRevision(
        patient.id,
        selectedDate,
        nextNote,
        nextPatient.updatedAt,
      );
      setEditorDraftState(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      manualBaselineRef.current = reviewedText;
      clearSourceText();
      setComposerDirty(false);
      setDeltaReview(null);
      editOriginRef.current = null;
      removeRecoveryDraft(recoveryStorage, recoveryScope);
      setRecoveryDraft(null);
      setRecoverySavedAt("");
      setStatus(`Reviewed SOAP, compatibility fields, and change history saved atomically.${editTrace ? " Correction history recorded." : ""}`);
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
    const nextDraft = parseCanonicalSoapTextToEditorDraft(nextText);
    updateEditorDraft(nextDraft);
    setStatus(nextStatus);
  }

  function acceptAllDeltaChanges() {
    if (!deltaReview) return;
    loadDeltaSoapText(deltaReview.acceptedText, "Applied all source-supported AI changes while preserving clinician edits. Review, then Save reviewed SOAP.");
  }

  function rejectAllDeltaChanges() {
    if (!deltaReview) return;
    loadDeltaSoapText(deltaReview.baselineText, "Rejected AI draft and restored baseline SOAP locally.");
  }

  function acceptDeltaSection(section: SoapDeltaSection) {
    if (!deltaReview) return;
    const nextText = acceptSoapDeltaSection(editorDraftToSoapText(editorDraftRef.current), deltaReview.acceptedText, section);
    loadDeltaSoapText(nextText, `${deltaSectionLabels[section]} applied from the source-supported draft.`);
  }

  function restoreDeltaSection(section: SoapDeltaSection) {
    if (!deltaReview) return;
    const nextText = restoreSoapDeltaSection(editorDraftToSoapText(editorDraftRef.current), deltaReview.baselineText, section);
    loadDeltaSoapText(nextText, `${deltaSectionLabels[section]} restored from baseline locally.`);
  }

  function resetToCanonical() {
    pendingSavedSoapRef.current = null;
    const nextDraft = parseCanonicalSoapTextToEditorDraft(canonical.text);
    editorScopeRef.current = { patientId: patient.id, selectedDate };
    editorRevisionRef.current = captureRoundSoapEditorRevision(
      patient.id,
      selectedDate,
      subscribedNote,
      persistedPatientUpdatedAt,
    );
    setEditorDraftState(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setMixedSourceText("");
    setComposerDirty(false);
    setStatus("");
    setError("");
    setWarnings([]);
    setDeltaReview(null);
    editOriginRef.current = null;
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
            {!compactView && <p className="muted">Only source-supported changes are applied. Your current reviewed wording remains the baseline.</p>}
          </div>
          <div className="form-actions">
            <button type="button" className="secondary compact-button" onClick={rejectAllDeltaChanges}>Reject all</button>
            <button type="button" className="secondary compact-button" onClick={acceptAllDeltaChanges}>Apply safe changes</button>
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

  const composedSourceChars = workflowMode === "repairSoap" ? mixedSourceText.trim().length : composeRawText().length;
  const sourceTooLong = composedSourceChars > MAX_ROUND_SOAP_RAW_CHARS;
  const longTransferSource = workflowMode === "transferHandoff" && composedSourceChars > LONG_TRANSFER_SOURCE_CHARS;
  const estimatedTokens = Math.ceil((composedSourceChars + soapText.length) / 4);
  const currentRecoveryStaleState = recoveryDraft
    ? recoveryStaleState(recoveryDraft, recoveryFingerprint(recoveryBaseline), recoveryBaselineUpdatedAt)
    : null;
  const recoverySavedLabel = recoveryTimeLabel(recoverySavedAt);
  const aiGenerationBlocked = !isDemoMode && !deidentifiedConfirmed;

  function renderAiPrivacyControls() {
    if (isDemoMode) return <DeidNotice />;
    return (
      <div className="round-soap-privacy-controls">
        <DeidNotice />
        <label>
          <input
            type="checkbox"
            checked={deidentifiedConfirmed}
            disabled={loading}
            onChange={(event) =>
              setConfirmedPrivacyFingerprint(
                bindDeidentifiedConfirmation(event.target.checked, privacyContextFingerprint),
              )
            }
          />
          I confirm this source is de-identified (no name, chart ID, phone, address, or other direct identifier).
        </label>
        <label>
          <input
            type="checkbox"
            checked={storeSourceInAudit}
            disabled={loading}
            onChange={(event) => setStoreSourceInAudit(event.target.checked)}
          />
          Keep the exact pasted source in my private change log for 30 days. SOAP corrections are logged even when this is off.
        </label>
      </div>
    );
  }

  if (compact) {
    const transferSuggestion = suggestedRoundSoapWorkflow(mixedSourceText);
    return (
      <section className="round-soap-composer compact-round-soap-composer">
        <div className="round-soap-toolbar compact-soap-toolbar">
          <div>
            <h3>Quick SOAP update</h3>
            <p className="muted">Baseline: {canonical.sourceDate || "legacy fallback"}</p>
          </div>
          <button type="button" className="secondary compact-button" onClick={resetToCanonical}>Reset</button>
        </div>
        <div className="round-soap-mode-bar compact-soap-mode-bar" aria-label="SOAP generation controls">
          <label>
            Workflow
            <select
              aria-label="SOAP workflow"
              value={workflowMode}
              disabled={loading}
              onChange={(event) => {
                setWorkflowMode(event.target.value as WorkflowMode);
                setConfirmedPrivacyFingerprint("");
              }}
            >
              {workflowModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Model
            <select aria-label="AI model quality" value={qualityMode} onChange={(event) => setQualityMode(event.target.value as RoundSoapQualityMode)}>
              {qualityModeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
        {transferSuggestion && transferSuggestion !== workflowMode && (
          <p className="status-message compact-workflow-suggestion">Transfer/SBAR wording detected. Switch Workflow to Transfer only if this is the receiving team's first SOAP.</p>
        )}
        <label className="round-soap-paste">
          {workflowMode === "repairSoap" ? "Optional new facts for repair" : `Paste all source data for ${workflow.label}`}
          <textarea
            value={mixedSourceText}
            onChange={(event) => updateMixedSourceText(event.target.value)}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            placeholder={workflowMode === "repairSoap"
              ? "Leave empty to consolidate the current reviewed SOAP only, or paste corrected/new facts that must be included."
              : workflowMode === "dailyUpdate"
              ? "Paste today's V/S, labs, imaging, course, orders, consults, and pending tasks together."
              : workflowMode === "newSoap"
                ? "Paste admission note, current V/S, labs, imaging, orders, and a short description together."
                : "Paste admission, last SOAP/SBAR, current V/S, labs, imaging, orders, and transfer context together."}
            rows={6}
          />
          <span className={sourceTooLong ? "error-message" : "muted"}>
            {composedSourceChars.toLocaleString()} / {MAX_ROUND_SOAP_RAW_CHARS.toLocaleString()} characters
          </span>
        </label>
        {longTransferSource && (
          <p className="status-message">
            Keep the transfer record complete. Duplicate low-yield history will be condensed automatically while current status, V/S, labs, treatments, procedures, active problems, pending items, and disposition are preserved. Best quality may take up to five minutes.
          </p>
        )}
        {renderAiPrivacyControls()}
        <div className="round-soap-generate-row compact-generate-row">
          <span className="muted">Preview only. Save remains explicit.</span>
          <button type="button" disabled={loading || aiGenerationBlocked || (workflowMode !== "repairSoap" && mixedSourceText.trim().length < 10) || sourceTooLong} onClick={() => void handleGenerate()}>
            {loading ? "Working..." : `Generate ${workflow.label}`}
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
            sourceFields={currentSourceFields(workflowMode)}
            layoutPreferences={layoutPreferences}
            keywordRules={keywordRules}
            chronicRenal={hasChronicRenalContext(patient)}
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
      <div className="round-soap-mode-bar" aria-label="SOAP generation controls">
        <label>
          Workflow
          <select
            aria-label="SOAP workflow"
            value={workflowMode}
            disabled={loading}
            onChange={(event) => {
              setWorkflowMode(event.target.value as WorkflowMode);
              setConfirmedPrivacyFingerprint("");
            }}
          >
            {workflowModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Model
          <select aria-label="AI model quality" value={qualityMode} onChange={(event) => setQualityMode(event.target.value as RoundSoapQualityMode)}>
            {qualityModeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="round-soap-mode-copy">
          <strong>{workflow.label}</strong>
          <span>{workflow.helper}</span>
          <span>{qualityModeOptions.find((item) => item.value === qualityMode)?.helper}</span>
        </div>
      </div>
      <label className="round-soap-paste round-soap-primary-paste">
        {workflowMode === "repairSoap" ? "Optional new facts for repair" : `Paste all source data for ${workflow.label}`}
        <textarea
          value={mixedSourceText}
          onChange={(event) => updateMixedSourceText(event.target.value)}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          placeholder={workflowMode === "repairSoap"
            ? "Leave empty to consolidate the current reviewed SOAP only, or paste corrected/new facts that must be included."
            : workflowMode === "dailyUpdate"
            ? "Paste today's V/S, labs, imaging, course, orders, consults, and tasks together. AI will update the reviewed baseline."
            : workflowMode === "newSoap"
              ? "Paste admission note, current V/S, labs, imaging, orders, and description together. AI will create the first SOAP."
              : "Paste admission, last SOAP/SBAR, current V/S, labs, imaging, orders, and transfer context together."}
          rows={7}
        />
        <span className={sourceTooLong ? "error-message" : "muted"}>
          {composedSourceChars.toLocaleString()} / {MAX_ROUND_SOAP_RAW_CHARS.toLocaleString()} characters
        </span>
      </label>
      {longTransferSource && (
        <p className="status-message">
          Keep the transfer record complete. Duplicate low-yield history will be condensed automatically while current status, V/S, labs, treatments, procedures, active problems, pending items, and disposition are preserved. Best quality may take up to five minutes.
        </p>
      )}
      {renderAiPrivacyControls()}
      <div className="round-soap-generate-row primary-generate-row">
        <span className="muted">The selected workflow and model are used as shown. Nothing is saved until Save reviewed SOAP.</span>
        <button type="button" disabled={loading || aiGenerationBlocked || (workflowMode !== "repairSoap" && mixedSourceText.trim().length < 10) || sourceTooLong} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : `Generate ${workflow.label}`}
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
            <select value={soapFormat} onChange={(event) => setSoapFormat(event.target.value as SoapEditorFormat)} title="SOAP editor format">
              {soapFormatOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <p className="muted">Clear the primary mixed paste before using these guided fields.</p>
          <p className="muted">
            Approx. {estimatedTokens.toLocaleString()} input + baseline tokens. The backend falls back to the prior model generation only if the selected model is unavailable.
          </p>

      {workflowMode === "repairSoap" ? (
        <div className="status-message">
          The current reviewed SOAP is the source. GPT-5.6 Sol may merge duplicate A/P blocks, remove parser noise, and normalize section placement, but cannot add unsupported facts. The result remains a local preview until Save reviewed SOAP.
        </div>
      ) : workflowMode === "dailyUpdate" ? (
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

      {workflowMode !== "repairSoap" && (
        <MedicationOrderReviewPanel
          compact={compact}
          sourceText={currentOrderSourceText()}
          onApply={applyMedicationOrderSummaries}
        />
      )}

      {renderAiPrivacyControls()}
      <div className="round-soap-generate-row">
        <button type="button" disabled={loading || aiGenerationBlocked || !composeRawText() || sourceTooLong} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : "Generate SOAP"}
        </button>
        {qualityMode !== "highAccuracy" && (warnings.length > 0 || Boolean(deltaReview?.highRiskWarnings.length)) && (
          <button
            type="button"
            className="secondary"
            disabled={loading || aiGenerationBlocked || !composeRawText() || sourceTooLong}
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
        <section className="round-soap-structured-editor" onKeyDownCapture={handleEditorKeyDown}>
          <div className="structured-soap-main-heading">
            <div>
              <strong>Reviewed SOAP blocks</strong>
              <span className="soap-editor-hint">Use controls for section, importance, and A/P blocks. Save writes normalized SOAP text.</span>
            </div>
            <div className="form-actions" aria-label="SOAP edit history controls">
              <button type="button" className="secondary compact-button" disabled={loading || !canUndo(editorHistory)} onClick={undoEditorChange} title="Undo (Ctrl+Z)">Undo</button>
              <button type="button" className="secondary compact-button" disabled={loading || !canRedo(editorHistory)} onClick={redoEditorChange} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">Redo</button>
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
                setComposerDirty(true);
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
            <div className="form-actions raw-soap-actions">
              <button type="button" className="secondary" disabled={!rawSoapText.trim() || loading} onClick={handleFormatSoap}>
                Normalize into editable blocks
              </button>
            </div>
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
            <SoapPrintPreview value={soapText} layoutPreferences={layoutPreferences} keywordRules={keywordRules} chronicRenal={hasChronicRenalContext(patient)} />
          ) : (
            <SoapVisualPreview
              value={soapText}
              compact={compact}
              sourceFields={currentSourceFields()}
              layoutPreferences={layoutPreferences}
              keywordRules={keywordRules}
              chronicRenal={hasChronicRenalContext(patient)}
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
