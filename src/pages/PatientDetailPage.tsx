import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient, UserPreferences } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import AiIntakePanel from "../components/AiIntakePanel";
import ClinicalDocumentQuickActions from "../components/ClinicalDocumentQuickActions";
import { ClinicalText } from "../components/ClinicalText";
import RoundSoapComposer from "../components/RoundSoapComposer";
import LabHistoryPanel from "../components/LabHistoryPanel";
import ActiveProblemEditor from "../components/ActiveProblemEditor";
import { buildConcisePatientClinicalUpdate } from "../clinicalPatientPolish";
import {
  IconAiIntake,
  IconAssessment,
  IconInfo,
  IconObjective,
  IconRounds,
  IconTasks,
} from "../components/icons";
import { useT } from "../i18n";
import {
  dailyNoteFromPatient,
  dailyNoteFromPatientPreservingSoap,
  dailyNoteMatchesSavedSnapshot,
  emptyDailyNote,
  getLatestNonEmptyDailyNote,
  getPatientDisplaySummary,
  nowIso,
  patientForDate,
  patientWithDailyNote,
  textToItems,
  todayKey,
} from "../utils";
import { getRoundingDigest } from "../roundingDigest";
import { fallbackSoapTextFromPatient, getCanonicalSoapText, soapPreviewTextFromPatient, soapTextToPatientPatch } from "../soapDraft";
import { normalizeRoundingLayoutPreferences } from "../userPreferences";
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

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  preferences: UserPreferences;
  dataLoading?: boolean;
  isDemoMode?: boolean;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
}

type DetailTab = "rounds" | "objective" | "assessmentPlan" | "tasksDischarge" | "aiIntake" | "more";

type DetailTabIcon = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const detailTabs: Array<{ id: DetailTab; labelKey: string; shortKey: string; Icon: DetailTabIcon }> = [
  { id: "rounds", labelKey: "detail.tabs.rounds", shortKey: "detail.tabs.short.rounds", Icon: IconRounds },
  { id: "objective", labelKey: "detail.tabs.objective", shortKey: "detail.tabs.short.objective", Icon: IconObjective },
  { id: "assessmentPlan", labelKey: "detail.tabs.assessmentPlan", shortKey: "detail.tabs.short.assessmentPlan", Icon: IconAssessment },
  { id: "tasksDischarge", labelKey: "detail.tabs.tasksDischarge", shortKey: "detail.tabs.short.tasksDischarge", Icon: IconTasks },
  { id: "aiIntake", labelKey: "detail.tabs.aiIntake", shortKey: "detail.tabs.short.aiIntake", Icon: IconAiIntake },
  { id: "more", labelKey: "detail.tabs.more", shortKey: "detail.tabs.short.more", Icon: IconInfo },
];

const EMPTY_PATIENT_NOTES: DailyNote[] = [];

type PendingSavedDailyNote = {
  patientId: string;
  date: string;
  note: DailyNote;
};

type DetailRecoveryPayload = {
  patient: Patient;
  soapEditorText: string;
};

function detailPayloadEquals(left: DetailRecoveryPayload | null, right: DetailRecoveryPayload | null) {
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function recoveryTimeLabel(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendUniqueClinicalText(existing: string, additions: string[]) {
  const seen = new Set<string>();
  const lines = [...(existing || "").split(/\r?\n/), ...additions]
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join("\n");
}

function simpleDetailRedFlags(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((line) =>
      line
        .replace(/^!+/, "")
        .replace(/\s+-\s*Reason:\s*.*$/i, "")
        .replace(/:\s*(?:f\/u|follow|trend|verify|confirm|clarify|review|call|repeat|check|order|consult|start|stop|hold|resume|Cx|Abx|CBC|ANC).*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function hasReviewedAdmissionBrief(patient: Patient) {
  return [
    patient.admissionBriefFreeText,
    patient.generatedAdmissionSummary,
    patient.generatedAdmissionNote,
    patient.chiefComplaint,
    patient.admissionChiefConcern,
    patient.presentIllnessOrHPI,
    patient.hpiOrAdmissionStory,
    patient.admissionPMH,
    patient.initialAssessment,
    patient.initialPlan,
    patient.earlyHospitalCourse,
  ].some((value) => value.trim().length > 0);
}

function shouldPromptForAdmissionBrief(patient: Patient) {
  return (patient.isNewAdmission || patient.showAdmissionBriefOnPrint) && !hasReviewedAdmissionBrief(patient);
}

function mergeNoteWithFallback(note: DailyNote, fallbackPatient: Patient, date: string): DailyNote {
  const fallbackNote = dailyNoteFromPatient(fallbackPatient, date);
  const textOrFallback = (value: string, fallback: string) => (value.trim() ? value : fallback);
  const arrayOrFallback = <T,>(value: T[], fallback: T[]) => (value.length > 0 ? value : fallback);

  return {
    ...fallbackNote,
    ...note,
    importantRedFlags: textOrFallback(note.importantRedFlags, fallbackNote.importantRedFlags),
    overnightEvents: textOrFallback(note.overnightEvents, fallbackNote.overnightEvents),
    subjectiveOrChiefConcern: textOrFallback(note.subjectiveOrChiefConcern, fallbackNote.subjectiveOrChiefConcern),
    vitalSigns: textOrFallback(note.vitalSigns, fallbackNote.vitalSigns),
    bloodSugar: textOrFallback(note.bloodSugar, fallbackNote.bloodSugar),
    physicalExam: textOrFallback(note.physicalExam, fallbackNote.physicalExam),
    labSummary: textOrFallback(note.labSummary, fallbackNote.labSummary),
    imageSummary: textOrFallback(note.imageSummary, fallbackNote.imageSummary),
    assessment: textOrFallback(note.assessment, fallbackNote.assessment),
    plan: textOrFallback(note.plan, fallbackNote.plan),
    dischargePlan: textOrFallback(note.dischargePlan, fallbackNote.dischargePlan),
    vsOrder: textOrFallback(note.vsOrder, fallbackNote.vsOrder),
    rawLabText: textOrFallback(note.rawLabText, fallbackNote.rawLabText),
    labDate: note.labDate || fallbackNote.labDate,
    labReportTitle: note.labReportTitle || fallbackNote.labReportTitle,
    labReports: arrayOrFallback(note.labReports, fallbackNote.labReports),
    parsedLabItems: arrayOrFallback(note.parsedLabItems, fallbackNote.parsedLabItems),
    physicalExamEntries: arrayOrFallback(note.physicalExamEntries, fallbackNote.physicalExamEntries),
    imageStudyEntries: arrayOrFallback(note.imageStudyEntries, fallbackNote.imageStudyEntries),
    assessmentPlanItems: arrayOrFallback(note.assessmentPlanItems, fallbackNote.assessmentPlanItems),
    createdAt: note.createdAt || fallbackNote.createdAt,
    updatedAt: note.updatedAt || fallbackNote.updatedAt,
  };
}

function crisisCarryForwardScore(value: string) {
  const text = value.toLowerCase();
  let score = 0;
  if (/!|urgent|critical|red flag|unstable|shock|hypot|desat|hypox|fever|sepsis/.test(text)) score += 4;
  if (/stroke|ais|tia|ich|hemorrhage|bleed|hb|anemia|melena|hematoma/.test(text)) score += 4;
  if (/aki|renal|hf|heart failure|acs|mi|arrhythm|af\b|pneumonia|pna|uti|infection/.test(text)) score += 3;
  if (/dysphag|aspirat|weak|palsy|aphasia|dysarth|seizure|fall|syncope/.test(text)) score += 3;
  if (/pending|follow|f\/u|repeat|monitor|consult|hold|resume/.test(text)) score += 1;
  if (/\d/.test(text)) score += 1;
  return score;
}

function dailyNoteArrayKey(value: unknown) {
  const item = value as Record<string, unknown>;
  return [
    item.date,
    item.problemTitle,
    item.assessmentSummary,
    item.studyType,
    item.impression,
    item.finding,
    item.system,
    item.label,
    item.name,
    item.value,
    item.unit,
    item.previousValue,
    item.title,
    item.rawText,
  ]
    .map((part) => String(part ?? "").toLowerCase().replace(/^!+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("|");
}

function mergeDailyNoteArrays<T>(existing: T[] = [], additions: T[] = []) {
  const merged = [...existing];
  const seen = new Set(merged.map(dailyNoteArrayKey).filter(Boolean));

  additions.forEach((item) => {
    const key = dailyNoteArrayKey(item);
    if (!key || seen.has(key)) return;
    merged.push(item);
    seen.add(key);
  });

  return merged;
}

function PatientDetailPage({
  patients,
  dailyNotesByPatient = {},
  preferences,
  dataLoading = false,
  isDemoMode = false,
  onSavePatient,
  onSaveDailyNote,
}: PageProps) {
  const t = useT();
  const { patientId } = useParams();
  const roundingLayout = normalizeRoundingLayoutPreferences(preferences.roundingLayout);
  const sourcePatient = patients.find((item) => item.id === patientId);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const patientNotes = patientId ? dailyNotesByPatient[patientId] ?? EMPTY_PATIENT_NOTES : EMPTY_PATIENT_NOTES;
  const selectedNote = patientNotes.find((note) => note.date === selectedDate);
  const displayFallbackPatient = sourcePatient ? patientForDate(sourcePatient, dailyNotesByPatient, selectedDate) : null;
  const displaySummary = sourcePatient ? getPatientDisplaySummary(sourcePatient, dailyNotesByPatient, selectedDate) : null;
  const selectedDraftNote =
    selectedNote && displayFallbackPatient
      ? mergeNoteWithFallback(selectedNote, displayFallbackPatient, selectedDate)
      : displayFallbackPatient
        ? dailyNoteFromPatient(displayFallbackPatient, selectedDate)
        : emptyDailyNote(selectedDate);
  const initialDraft = displayFallbackPatient ? patientWithDailyNote(displayFallbackPatient, selectedDraftNote) : null;
  const initialSoapEditorText = initialDraft ? soapPreviewTextFromPatient(initialDraft, patientNotes, selectedDate) : "";
  const [draftPatient, setDraftPatient] = useState<Patient | null>(initialDraft);
  const [detailHistory, setDetailHistory] = useState<UndoRedoHistory<DetailRecoveryPayload | null>>(() =>
    createUndoRedoHistory(initialDraft ? { patient: initialDraft, soapEditorText: initialSoapEditorText } : null),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("rounds");
  const [selectedDittoDate, setSelectedDittoDate] = useState("");
  const [quickVsOrder, setQuickVsOrder] = useState("");
  const [soapEditorText, setSoapEditorText] = useState(initialSoapEditorText);
  const [soapEditorDirty, setSoapEditorDirty] = useState(false);
  const [externalSoapDraft, setExternalSoapDraft] = useState({ revision: 0, text: "", status: "" });
  const [roundSoapDirty, setRoundSoapDirty] = useState(false);
  const [detailRecoveryDraft, setDetailRecoveryDraft] = useState<RecoveryDraft<DetailRecoveryPayload> | null>(null);
  const [detailRecoverySavedAt, setDetailRecoverySavedAt] = useState("");
  const [detailRecoveryStatus, setDetailRecoveryStatus] = useState("");
  const [admissionPromptOpen, setAdmissionPromptOpen] = useState(false);
  const [admissionPromptDismissedPatientId, setAdmissionPromptDismissedPatientId] = useState("");
  const draftRef = useRef<Patient | null>(initialDraft);
  const detailHistoryRef = useRef(detailHistory);
  const soapEditorTextRef = useRef(initialSoapEditorText);
  const isDirtyRef = useRef(false);
  const soapEditorDirtyRef = useRef(false);
  const roundSoapDirtyRef = useRef(false);
  const isComposingRef = useRef(false);
  const pendingSavedDailyNoteRef = useRef<PendingSavedDailyNote | null>(null);
  const detailRecoveryScope = sourcePatient ? { kind: "patientDetail" as const, patientId: sourcePatient.id, selectedDate } : null;
  const detailRecoveryBaseline = initialDraft ? { patient: initialDraft, soapEditorText: initialSoapEditorText } : null;
  const detailRecoveryBaselineUpdatedAt = selectedNote?.updatedAt || initialDraft?.updatedAt || "";
  const detailRecoveryStorage = getSessionDraftStorage();

  useEffect(() => {
    detailHistoryRef.current = detailHistory;
  }, [detailHistory]);

  useEffect(() => {
    if (!detailRecoveryScope || !detailRecoveryBaseline) {
      setDetailRecoveryDraft(null);
      return;
    }
    const savedDraft = readRecoveryDraft<DetailRecoveryPayload>(detailRecoveryStorage, detailRecoveryScope);
    if (!savedDraft) {
      setDetailRecoveryDraft(null);
      return;
    }
    const currentFingerprint = recoveryFingerprint(detailRecoveryBaseline);
    const savedFingerprint = recoveryFingerprint(savedDraft.payload);
    if (savedFingerprint === currentFingerprint) {
      setDetailRecoveryDraft(null);
      return;
    }
    setDetailRecoveryDraft(savedDraft);
  }, [detailRecoveryBaselineUpdatedAt, detailRecoveryStorage, patientId, selectedDate]);

  useEffect(() => {
    if ((!isDirty && !soapEditorDirty) || isComposingRef.current || !detailRecoveryScope || !detailRecoveryBaseline || !draftRef.current) return;
    const payload: DetailRecoveryPayload = {
      patient: draftRef.current,
      soapEditorText: soapEditorTextRef.current,
    };
    const timeout = window.setTimeout(() => {
      const draft = makeRecoveryDraft(detailRecoveryScope, payload, detailRecoveryBaseline, detailRecoveryBaselineUpdatedAt);
      if (writeRecoveryDraft(detailRecoveryStorage, draft)) {
        setDetailRecoverySavedAt(draft.draftUpdatedAt);
      }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [detailRecoveryBaseline, detailRecoveryBaselineUpdatedAt, detailRecoveryStorage, isDirty, patientId, selectedDate, soapEditorDirty]);

  useEffect(() => {
    if (!sourcePatient) return;

    const pendingSavedNote = pendingSavedDailyNoteRef.current;
    if (pendingSavedNote && pendingSavedNote.patientId !== sourcePatient.id) {
      pendingSavedDailyNoteRef.current = null;
    } else if (
      pendingSavedNote &&
      pendingSavedNote.date === selectedDate &&
      !dailyNoteMatchesSavedSnapshot(selectedNote, pendingSavedNote.note)
    ) {
      return;
    } else if (pendingSavedNote && pendingSavedNote.date === selectedDate) {
      pendingSavedDailyNoteRef.current = null;
    }

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !soapEditorDirtyRef.current && !roundSoapDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      const scopedDailyNotesByPatient = { [sourcePatient.id]: patientNotes };
      const nextDisplayPatient = patientForDate(sourcePatient, scopedDailyNotesByPatient, selectedDate);
      const nextNote = selectedNote
        ? mergeNoteWithFallback(selectedNote, nextDisplayPatient, selectedDate)
        : dailyNoteFromPatient(nextDisplayPatient, selectedDate);
      const nextPatient = patientWithDailyNote(nextDisplayPatient, nextNote);
      const nextSoapEditorText = soapPreviewTextFromPatient(nextPatient, patientNotes, selectedDate);
      draftRef.current = nextPatient;
      setDraftPatient(nextPatient);
      soapEditorTextRef.current = nextSoapEditorText;
      setSoapEditorText(nextSoapEditorText);
      const nextPayload = { patient: nextPatient, soapEditorText: nextSoapEditorText };
      const nextHistory = replaceUndoRedoPresent(detailHistoryRef.current, nextPayload);
      detailHistoryRef.current = nextHistory;
      setDetailHistory(nextHistory);
      setSoapEditorDirty(false);
      soapEditorDirtyRef.current = false;
      setIsDirty(false);
      isDirtyRef.current = false;
      setExternalSoapDraft({ revision: 0, text: "", status: "" });
    }
  }, [sourcePatient, selectedDate, selectedNote, patientNotes]);

  useEffect(() => {
    if (!draftPatient) return;
    if (shouldPromptForAdmissionBrief(draftPatient) && admissionPromptDismissedPatientId !== draftPatient.id) {
      setAdmissionPromptOpen(true);
    }
  }, [draftPatient, admissionPromptDismissedPatientId]);

  useEffect(() => {
    const availableNotes = patientNotes.filter((note) => note.date !== selectedDate);
    const previousNote = getLatestNonEmptyDailyNote(availableNotes.filter((note) => note.date < selectedDate));
    const fallbackDate = previousNote?.date || availableNotes[0]?.date || "";

    setSelectedDittoDate((currentDate) =>
      availableNotes.some((note) => note.date === currentDate) ? currentDate : fallbackDate,
    );
  }, [patientNotes, selectedDate]);

  if ((!sourcePatient || !draftPatient) && dataLoading) {
    return (
      <div className="page">
        <h2>Loading patient...</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!sourcePatient || !draftPatient) {
    return (
      <div className="page">
        <h2>Patient not found</h2>
        <Link to="/patients">Back to patient board</Link>
      </div>
    );
  }

  const currentPatient = draftPatient;

  function updateDraft(nextPatient: Patient) {
    const nextPayload = { patient: nextPatient, soapEditorText: soapEditorTextRef.current };
    const nextHistory = pushUndoRedoEdit(detailHistoryRef.current, nextPayload, detailPayloadEquals);
    detailHistoryRef.current = nextHistory;
    setDetailHistory(nextHistory);
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    setIsDirty(true);
    isDirtyRef.current = true;
  }

  function updateSoapEditor(value: string) {
    const nextPayload = draftRef.current ? { patient: draftRef.current, soapEditorText: value } : null;
    const nextHistory = pushUndoRedoEdit(detailHistoryRef.current, nextPayload, detailPayloadEquals);
    detailHistoryRef.current = nextHistory;
    setDetailHistory(nextHistory);
    soapEditorTextRef.current = value;
    setSoapEditorText(value);
    setSoapEditorDirty(true);
    soapEditorDirtyRef.current = true;
  }

  function restoreDetailPayload(payload: DetailRecoveryPayload | null, message: string) {
    if (!payload) return;
    draftRef.current = payload.patient;
    setDraftPatient(payload.patient);
    soapEditorTextRef.current = payload.soapEditorText;
    setSoapEditorText(payload.soapEditorText);
    setIsDirty(true);
    isDirtyRef.current = true;
    setSoapEditorDirty(true);
    soapEditorDirtyRef.current = true;
    setDetailRecoveryStatus(message);
  }

  function undoDetailDraft() {
    const result = undoEdit(detailHistoryRef.current);
    if (!result.changed) return;
    detailHistoryRef.current = result.history;
    setDetailHistory(result.history);
    restoreDetailPayload(result.history.present, "Undo applied to local Details draft. Save to write Firestore.");
  }

  function redoDetailDraft() {
    const result = redoEdit(detailHistoryRef.current);
    if (!result.changed) return;
    detailHistoryRef.current = result.history;
    setDetailHistory(result.history);
    restoreDetailPayload(result.history.present, "Redo applied to local Details draft. Save to write Firestore.");
  }

  function handleDetailKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".round-soap-composer")) return;
    const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
    const isRedo =
      (event.ctrlKey || event.metaKey) &&
      (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"));
    if ((!isUndo && !isRedo) || isComposingRef.current) return;
    event.preventDefault();
    if (isUndo) undoDetailDraft();
    else redoDetailDraft();
  }

  function restoreDetailRecoveryDraft() {
    if (!detailRecoveryDraft) return;
    const nextHistory = replaceUndoRedoPresent(detailHistoryRef.current, detailRecoveryDraft.payload);
    detailHistoryRef.current = nextHistory;
    setDetailHistory(nextHistory);
    restoreDetailPayload(detailRecoveryDraft.payload, "Recovery draft restored locally. Review, then Save to write Firestore.");
    setDetailRecoveryDraft(null);
  }

  function discardDetailRecoveryDraft() {
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
    setDetailRecoveryStatus("Recovery draft discarded. Saved patient data was not changed.");
  }

  function markPendingSavedDailyNote(patientId: string, note: DailyNote) {
    pendingSavedDailyNoteRef.current = { patientId, date: note.date, note };
  }

  function updateRoundSoapDirty(nextDirty: boolean) {
    roundSoapDirtyRef.current = nextDirty;
    setRoundSoapDirty(nextDirty);
  }

  function handleSelectedDateChange(nextDate: string) {
    if (nextDate === selectedDate) return;
    if (isComposingRef.current) return;
    if (isDirtyRef.current || soapEditorDirtyRef.current || roundSoapDirtyRef.current) {
      window.alert("Save or discard the current local edits before changing the SOAP date.");
      return;
    }
    setSelectedDate(nextDate);
  }

  function noteFromDraft(patient: Patient): DailyNote {
    const now = nowIso();
    return {
      ...dailyNoteFromPatientPreservingSoap(patient, selectedNote, selectedDate),
      date: selectedDate,
      createdAt: selectedNote?.createdAt || now,
      updatedAt: now,
    };
  }

  async function commitDraft(patientToSave = draftRef.current) {
    if (!patientToSave || isComposingRef.current) return;

    const nextPatient = { ...patientToSave, updatedAt: nowIso() };
    const nextNote = noteFromDraft(nextPatient);
    markPendingSavedDailyNote(nextPatient.id, nextNote);
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, nextNote);
    setIsDirty(false);
    isDirtyRef.current = false;
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
  }

  async function createSelectedDateNote() {
    if (!draftRef.current) return;
    await commitDraft(draftRef.current);
  }

  async function saveAdmissionPrompt() {
    if (!draftRef.current) return;
    await commitDraft(draftRef.current);
    setAdmissionPromptDismissedPatientId(draftRef.current.id);
    setAdmissionPromptOpen(false);
  }

  function dismissAdmissionPrompt() {
    if (draftRef.current) {
      setAdmissionPromptDismissedPatientId(draftRef.current.id);
    }
    setAdmissionPromptOpen(false);
  }

  function buildAiAcceptedDailyNote(
    acceptedNotePatch: Partial<DailyNote> = {},
    previousNote: DailyNote | null,
  ): DailyNote {
    const now = nowIso();
    const baseNote = selectedNote ?? emptyDailyNote(selectedDate);
    const nextNote: DailyNote = {
      ...baseNote,
      date: selectedDate,
      createdAt: selectedNote?.createdAt || now,
      updatedAt: now,
    };
    const textFields: Array<keyof Pick<
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
    >> = [
      "importantRedFlags",
      "overnightEvents",
      "subjectiveOrChiefConcern",
      "vitalSigns",
      "bloodSugar",
      "physicalExam",
      "labSummary",
      "rawLabText",
      "imageSummary",
      "dischargePlan",
      "vsOrder",
    ];

    textFields.forEach((field) => {
      const patchText = String(acceptedNotePatch[field] ?? "").trim();
      if (patchText) {
        nextNote[field] = appendUniqueClinicalText(String(baseNote[field] ?? ""), [patchText]) as never;
      }
    });

    const carriedRedFlags = previousNote?.importantRedFlags
      .split(/\r?\n/)
      .filter((line) => crisisCarryForwardScore(line) > 0) ?? [];
    if (carriedRedFlags.length > 0) {
      nextNote.importantRedFlags = appendUniqueClinicalText(nextNote.importantRedFlags, carriedRedFlags);
    }

    nextNote.labReports = mergeDailyNoteArrays(baseNote.labReports, acceptedNotePatch.labReports);
    nextNote.parsedLabItems = mergeDailyNoteArrays(baseNote.parsedLabItems, acceptedNotePatch.parsedLabItems);
    nextNote.physicalExamEntries = mergeDailyNoteArrays(baseNote.physicalExamEntries, acceptedNotePatch.physicalExamEntries);
    nextNote.imageStudyEntries = mergeDailyNoteArrays(baseNote.imageStudyEntries, acceptedNotePatch.imageStudyEntries);
    if (acceptedNotePatch.labDate) nextNote.labDate = acceptedNotePatch.labDate;
    if (acceptedNotePatch.labReportTitle) nextNote.labReportTitle = acceptedNotePatch.labReportTitle;
    if ((acceptedNotePatch.labReports?.length ?? 0) > 0 || (acceptedNotePatch.parsedLabItems?.length ?? 0) > 0) {
      nextNote.labDate = nextNote.labDate || selectedDate;
      nextNote.labReportTitle = nextNote.labReportTitle || "AI Intake";
    }

    return nextNote;
  }

  async function applyAiIntakePatient(nextPatient: Patient, acceptedNotePatch: Partial<DailyNote> = {}) {
    const previousNote = selectedNote ? null : getLatestNonEmptyDailyNote(patientNotes.filter((note) => note.date < selectedDate));
    const carriedRedFlags = previousNote?.importantRedFlags
      .split(/\r?\n/)
      .filter((line) => crisisCarryForwardScore(line) > 0) ?? [];
    const safeNextPatient = {
      ...nextPatient,
      importantRedFlags: appendUniqueClinicalText(nextPatient.importantRedFlags, carriedRedFlags),
    };
    const acceptedNote = buildAiAcceptedDailyNote(acceptedNotePatch, previousNote ?? null);
    markPendingSavedDailyNote(safeNextPatient.id, acceptedNote);

    draftRef.current = safeNextPatient;
    setDraftPatient(safeNextPatient);
    await onSavePatient(safeNextPatient);
    await onSaveDailyNote(safeNextPatient.id, acceptedNote);
    const nextSoapText = soapPreviewTextFromPatient(safeNextPatient, [acceptedNote, ...patientNotes], selectedDate);
    setSoapEditorText(nextSoapText);
    soapEditorTextRef.current = nextSoapText;
    setSoapEditorDirty(false);
    soapEditorDirtyRef.current = false;
    setIsDirty(false);
    isDirtyRef.current = false;
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
  }

  async function saveSoapEditor() {
    if (!draftRef.current || isComposingRef.current) return;
    const currentSoapText = soapEditorText || soapPreviewTextFromPatient(draftRef.current, patientNotes, selectedDate);
    const patch = soapTextToPatientPatch(currentSoapText, draftRef.current, selectedDate);
    const now = nowIso();
    const nextPatient = { ...patch.patient, updatedAt: now };
    const nextNote: DailyNote = {
      ...noteFromDraft(nextPatient),
      ...patch.dailyNotePatch,
      date: selectedDate,
      createdAt: selectedNote?.createdAt || now,
      updatedAt: now,
    };

    markPendingSavedDailyNote(nextPatient.id, nextNote);
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, nextNote);
    const nextSoapText = soapPreviewTextFromPatient(nextPatient, [nextNote, ...patientNotes], selectedDate);
    setSoapEditorText(nextSoapText);
    soapEditorTextRef.current = nextSoapText;
    setSoapEditorDirty(false);
    soapEditorDirtyRef.current = false;
    setIsDirty(false);
    isDirtyRef.current = false;
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
  }

  async function appendQuickVsOrder() {
    const orderText = quickVsOrder.trim();
    if (!orderText || !draftRef.current) return;

    const nextPatient = {
      ...draftRef.current,
      vsOrder: appendUniqueClinicalText(draftRef.current.vsOrder, [orderText]),
      updatedAt: nowIso(),
    };
    const previousNote = selectedNote ? null : getLatestNonEmptyDailyNote(patientNotes.filter((note) => note.date < selectedDate));
    const nextNote = buildAiAcceptedDailyNote({ vsOrder: orderText }, previousNote ?? null);
    markPendingSavedDailyNote(nextPatient.id, nextNote);
    isComposingRef.current = false;
    setQuickVsOrder("");
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, nextNote);
    setIsDirty(false);
    isDirtyRef.current = false;
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
  }

  async function dittoSelectedNote() {
    if (!sourcePatient) return;
    const sourceNote = patientNotes.find((note) => note.date === selectedDittoDate);
    if (!sourceNote) return;
    const todayExists = Boolean(selectedNote);
    const message = todayExists
      ? `Overwrite this date's SOAP draft from ${sourceNote.date}? This will not delete old notes or patient-level data.`
      : `DITTO copies ${sourceNote.date} into this date. It will not delete old notes or patient-level data.`;
    if (!window.confirm(message)) return;
    const copiedNote: DailyNote = {
      ...sourceNote,
      date: selectedDate,
      createdAt: selectedNote?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    const nextPatient = patientWithDailyNote(patientForDate(sourcePatient, dailyNotesByPatient, selectedDate), copiedNote);
    markPendingSavedDailyNote(sourcePatient.id, copiedNote);
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSaveDailyNote(sourcePatient.id, copiedNote);
    setIsDirty(false);
    isDirtyRef.current = false;
    if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
    setDetailRecoveryDraft(null);
    setDetailRecoverySavedAt("");
  }

  function renderDittoControls() {
    const availableNotes = patientNotes.filter((note) => note.date !== selectedDate);

    return (
      <>
        <label className="ditto-source-label">
          DITTO from
          <select
            value={selectedDittoDate}
            onChange={(event) => setSelectedDittoDate(event.target.value)}
            disabled={availableNotes.length === 0}
          >
            {availableNotes.length === 0 && <option value="">No saved notes</option>}
            {availableNotes.map((note) => (
              <option key={note.date} value={note.date}>
                {note.date}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" disabled={!selectedDittoDate} onClick={dittoSelectedNote}>
          DITTO
        </button>
      </>
    );
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
  }

  function handleCompositionEnd() {
    isComposingRef.current = false;
  }

  function handleFieldBlur() {
    // Blur can happen during tab switches or component unmounts. It must not write Firestore.
  }

  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    updateDraft({ ...currentPatient, [field]: value, updatedAt: nowIso() });
  }

  function updateUnderlyingDiseases(value: string) {
    updateDraft({
      ...currentPatient,
      underlyingDiseases: value,
      underlyingDiseaseItems: textToItems(value),
      updatedAt: nowIso(),
    });
  }

  function updateActiveProblems(value: string) {
    updateDraft({
      ...currentPatient,
      activeProblems: value,
      activeProblemItems: textToItems(value),
      updatedAt: nowIso(),
    });
  }

  function refineAssessmentPlanFromClinicalFacts() {
    updateDraft(buildConcisePatientClinicalUpdate(currentPatient, patientNotes, selectedDate));
  }

  function renderSoapHistory() {
    return (
      <section className="panel soap-history">
        <h2>SOAP History</h2>
        <div className="detail-date-controls">
          <label>
            Date
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          {!selectedNote && (
            <button type="button" onClick={createSelectedDateNote}>
              Create today note
            </button>
          )}
          {renderDittoControls()}
        </div>
        {patientNotes.length === 0 && <p className="muted">No daily SOAP history yet.</p>}
        {patientNotes.map((note) => (
          <details key={note.date} open={note.date === selectedDate}>
            <summary>{note.date}</summary>
            {note.soapText?.trim() ? (
              <div className="soap-history-reviewed">
                <ClinicalText value={note.soapText} keywordRules={preferences.keywordHighlightRules} />
              </div>
            ) : (
            <div className="soap-history-grid">
              <div><strong>Red Flags</strong><ClinicalText value={note.importantRedFlags} importantDefault keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>Overnight Event</strong><ClinicalText value={note.overnightEvents} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>S</strong><ClinicalText value={note.subjectiveOrChiefConcern} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>V/S</strong><ClinicalText value={note.vitalSigns} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>Blood sugar</strong><ClinicalText value={note.bloodSugar} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>PE</strong><ClinicalText value={note.physicalExam} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>Lab</strong><ClinicalText value={note.rawLabText || note.labSummary} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>Image</strong><ClinicalText value={note.imageSummary} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>A</strong><ClinicalText value={note.assessment} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>P</strong><ClinicalText value={note.plan} keywordRules={preferences.keywordHighlightRules} /></div>
              <div><strong>DC / VS</strong><ClinicalText value={[note.dischargePlan, note.vsOrder].filter(Boolean).join("\n")} keywordRules={preferences.keywordHighlightRules} /></div>
            </div>
            )}
          </details>
        ))}
      </section>
    );
  }

  function renderRoundsMode() {
    return (
      <section className="panel rounds-mode-panel">
        <div className="section-heading">
          <div>
            <h2>SOAP</h2>
          </div>
          <span className="muted">{selectedDate}</span>
        </div>

        <RoundSoapComposer
          patient={currentPatient}
          dailyNotes={patientNotes}
          selectedDate={selectedDate}
          isDemoMode={isDemoMode}
          onSavePatient={async (nextPatient) => {
            draftRef.current = nextPatient;
            setDraftPatient(nextPatient);
            await onSavePatient(nextPatient);
            setIsDirty(false);
            isDirtyRef.current = false;
            if (detailRecoveryScope) removeRecoveryDraft(detailRecoveryStorage, detailRecoveryScope);
            setDetailRecoveryDraft(null);
            setDetailRecoverySavedAt("");
          }}
          onSaveDailyNote={async (patientId, note) => {
            markPendingSavedDailyNote(patientId, note);
            await onSaveDailyNote(patientId, note);
          }}
          externalSoapText={externalSoapDraft.text}
          externalSoapRevision={externalSoapDraft.revision}
          externalSoapStatus={externalSoapDraft.status}
          layoutPreferences={roundingLayout}
          aiStyleProfile={preferences.aiStyleProfile}
          keywordRules={preferences.keywordHighlightRules}
          onDirtyChange={updateRoundSoapDirty}
        />
      </section>
    );
  }

  const headerDigest = getRoundingDigest(currentPatient, patientNotes, {
    mode: "rounds",
    hideCompletedTasks: true,
  });
  const headerSoap = getCanonicalSoapText(currentPatient, patientNotes, selectedDate).text;
  const headerRedFlags = simpleDetailRedFlags(
    headerSoap
      .split(/\r?\n/)
      .find((line) => /^Red flags:/i.test(line.trim()))
      ?.replace(/^Red flags:\s*/i, "") ?? "",
  );
  const currentDetailRecoveryStaleState =
    detailRecoveryDraft && detailRecoveryBaseline
      ? recoveryStaleState(detailRecoveryDraft, recoveryFingerprint(detailRecoveryBaseline), detailRecoveryBaselineUpdatedAt)
      : null;
  const detailRecoverySavedLabel = recoveryTimeLabel(detailRecoverySavedAt);

  return (
    <div className="page" onKeyDownCapture={handleDetailKeyDown}>
      <header className="page-header">
        <div>
          <h2>
            {currentPatient.bed} - {currentPatient.patientCode}
          </h2>
          <p className="muted">{selectedDate} / {selectedNote ? "Editing saved daily note" : "No note for this date yet"}</p>
        </div>
        <div className="form-actions">
          <span className={`save-state-pill ${isDirty ? "save-state-dirty" : "save-state-clean"}`}>
            {isDirty || soapEditorDirty || roundSoapDirty ? "Unsaved local edits" : "No unsaved edits"}
          </span>
          <button type="button" disabled={!isDirty} onClick={() => void commitDraft()}>
            Save
          </button>
          <Link className="button-link secondary" to="/patients">
            Back
          </Link>
        </div>
      </header>

      {detailRecoveryDraft && (
        <div className={currentDetailRecoveryStaleState?.stale ? "status-message recovery-draft-banner stale-recovery" : "status-message recovery-draft-banner"}>
          <div>
            <strong>Unsaved Details draft available</strong>
            <span>
              {recoveryTimeLabel(detailRecoveryDraft.draftUpdatedAt) || "recent draft"}
              {currentDetailRecoveryStaleState?.stale ? ` · ${currentDetailRecoveryStaleState.reason}` : ""}
            </span>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary compact-button" onClick={discardDetailRecoveryDraft}>
              Discard
            </button>
            <button type="button" className="compact-button" onClick={restoreDetailRecoveryDraft}>
              Restore locally
            </button>
          </div>
        </div>
      )}
      {!detailRecoveryDraft && detailRecoverySavedLabel && (isDirty || soapEditorDirty) && (
        <p className="muted">Details recovery draft autosaved at {detailRecoverySavedLabel}. Firestore still changes only after Save.</p>
      )}
      {detailRecoveryStatus && <p className="status-message">{detailRecoveryStatus}</p>}
      {(isDirty || soapEditorDirty) && (
        <div className="form-actions detail-undo-actions">
          <button type="button" className="secondary compact-button" disabled={!canUndo(detailHistory)} onClick={undoDetailDraft} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" className="secondary compact-button" disabled={!canRedo(detailHistory)} onClick={redoDetailDraft} title="Ctrl+Y / Ctrl+Shift+Z">
            Redo
          </button>
        </div>
      )}

      <section className="panel patient-detail-header">
        <div className="detail-id-block">
          <strong>{currentPatient.bed || "No bed"}</strong>
          <span>{currentPatient.patientCode}</span>
          <span>{currentPatient.age}/{currentPatient.sex}</span>
          {currentPatient.attending && <span>Att: {currentPatient.attending}</span>}
        </div>
        <div className="detail-header-grid">
          {headerDigest.diagnosis && <div><strong>Dx:</strong> {headerDigest.diagnosis}</div>}
          <div className="detail-dc-target">
            <strong>{currentPatient.dischargeTargetDate ? `DC ${currentPatient.dischargeTargetDate}` : "DC TBD"}</strong>
            <input
              type="date"
              value={currentPatient.dischargeTargetDate}
              onChange={(event) => updateField("dischargeTargetDate", event.target.value)}
              aria-label="Discharge target date"
            />
          </div>
          {headerDigest.risks && <div><strong>Risk:</strong> {headerDigest.risks}</div>}
          {headerDigest.issues && <div><strong>Issues:</strong> {headerDigest.issues}</div>}
        </div>
        {headerRedFlags && (
          <div className="detail-header-red-flags">
            <strong>Red Flags:</strong> <ClinicalText value={headerRedFlags} maxLines={3} maxCharsPerLine={72} importantDefault keywordRules={preferences.keywordHighlightRules} />
          </div>
        )}
      </section>

      {admissionPromptOpen && (
        <div className="admission-prompt-backdrop" role="presentation">
          <section
            className="admission-prompt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admission-prompt-title"
          >
            <div className="section-heading">
              <div>
                <h2 id="admission-prompt-title">New admission needs Admission Brief</h2>
              </div>
              <button type="button" className="secondary" onClick={dismissAdmissionPrompt}>
                Skip for now
              </button>
            </div>
            <AdmissionBriefForm
              patient={currentPatient}
              onChange={updateDraft}
              isDemoMode={isDemoMode}
              onFieldBlur={handleFieldBlur}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
            <div className="admission-prompt-actions form-actions">
              <button type="button" className="secondary" onClick={dismissAdmissionPrompt}>
                Not now
              </button>
              <button type="button" disabled={!isDirty} onClick={() => void saveAdmissionPrompt()}>
                Save Admission Brief
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="panel detail-date-bar">
        <label>
          Daily SOAP Date
          <input type="date" value={selectedDate} onChange={(event) => handleSelectedDateChange(event.target.value)} />
        </label>
        {!selectedNote && (
          <button type="button" onClick={createSelectedDateNote}>
            Create today note
          </button>
        )}
        {renderDittoControls()}
        <button type="button" disabled={!isDirty} onClick={() => void commitDraft()}>
          Save current edits
        </button>
        {!selectedNote && getLatestNonEmptyDailyNote(patientNotes) && (
          <p className="muted">Today note is empty. Showing latest saved data.</p>
        )}
      </section>

      {activeTab === "rounds" && renderRoundsMode()}


      <details className="panel detail-more-section">
        <summary>Advanced / legacy fields</summary>
        <div className="detail-more-stack">
          <p className="muted">
            Board and Print read the reviewed SOAP above. Changes in these legacy fields are preserved for compatibility, but they will not change the main rounding output until imported into SOAP and saved as reviewed SOAP.
          </p>
          <details className="detail-more-section" open={currentPatient.isNewAdmission || currentPatient.showAdmissionBriefOnPrint}>
            <summary>Admission Brief</summary>
            <AdmissionBriefForm
              patient={currentPatient}
              onChange={updateDraft}
              isDemoMode={isDemoMode}
              onFieldBlur={handleFieldBlur}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </details>
          <details className="detail-more-section">
            <summary>SOAP History</summary>
            {renderSoapHistory()}
          </details>
          <details className="detail-more-section">
            <summary>Patient Info</summary>
            <PatientForm
              patient={currentPatient}
              onChange={updateDraft}
              onSubmit={() => commitDraft()}
              submitLabel="Save Basic Info"
              showClinicalSections={false}
              showHistoryFields={true}
              showTeamService={false}
              showStatus={false}
              onFieldBlur={handleFieldBlur}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </details>
        </div>
      </details>
    </div>
  );
}

export default PatientDetailPage;
