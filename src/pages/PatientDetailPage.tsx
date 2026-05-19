import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient } from "../types";
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
import { routePatientClinicalFields, type ClinicalFieldCleanupChange } from "../clinicalFieldRouter";
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
import { fallbackSoapTextFromPatient, soapPreviewTextFromPatient, soapTextToPatientPatch } from "../soapDraft";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
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
  dataLoading = false,
  isDemoMode = false,
  onSavePatient,
  onSaveDailyNote,
}: PageProps) {
  const t = useT();
  const { patientId } = useParams();
  const sourcePatient = patients.find((item) => item.id === patientId);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const patientNotes = patientId ? dailyNotesByPatient[patientId] ?? [] : [];
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
  const [draftPatient, setDraftPatient] = useState<Patient | null>(initialDraft);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("rounds");
  const [selectedDittoDate, setSelectedDittoDate] = useState("");
  const [quickVsOrder, setQuickVsOrder] = useState("");
  const [cleanupPreview, setCleanupPreview] = useState<{ patient: Patient; changes: ClinicalFieldCleanupChange[] } | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState("");
  const [soapEditorText, setSoapEditorText] = useState("");
  const [soapEditorDirty, setSoapEditorDirty] = useState(false);
  const [externalSoapDraft, setExternalSoapDraft] = useState({ revision: 0, text: "", status: "" });
  const [admissionPromptOpen, setAdmissionPromptOpen] = useState(false);
  const [admissionPromptDismissedPatientId, setAdmissionPromptDismissedPatientId] = useState("");
  const draftRef = useRef<Patient | null>(initialDraft);
  const isDirtyRef = useRef(false);
  const soapEditorDirtyRef = useRef(false);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!sourcePatient) return;

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !soapEditorDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      const nextDisplayPatient = patientForDate(sourcePatient, dailyNotesByPatient, selectedDate);
      const nextNote = selectedNote
        ? mergeNoteWithFallback(selectedNote, nextDisplayPatient, selectedDate)
        : dailyNoteFromPatient(nextDisplayPatient, selectedDate);
      const nextPatient = patientWithDailyNote(nextDisplayPatient, nextNote);
      draftRef.current = nextPatient;
      setDraftPatient(nextPatient);
      setSoapEditorText(soapPreviewTextFromPatient(nextPatient, dailyNotesByPatient[sourcePatient.id] ?? [], selectedDate));
      setSoapEditorDirty(false);
      soapEditorDirtyRef.current = false;
      setIsDirty(false);
      isDirtyRef.current = false;
      setCleanupPreview(null);
      setCleanupStatus("");
      setExternalSoapDraft({ revision: 0, text: "", status: "" });
    }
  }, [sourcePatient, selectedDate, selectedNote, patientNotes.length, dailyNotesByPatient]);

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
        <p className="muted">Waiting for Firestore data. Nothing is being saved.</p>
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
  const cleanupSignal = routePatientClinicalFields(currentPatient);
  const visibleCleanupChanges = cleanupPreview?.changes ?? cleanupSignal.changes;

  function updateDraft(nextPatient: Patient) {
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    setIsDirty(true);
    isDirtyRef.current = true;
  }

  function updateSoapEditor(value: string) {
    setSoapEditorText(value);
    setSoapEditorDirty(true);
    soapEditorDirtyRef.current = true;
  }

  function noteFromDraft(patient: Patient): DailyNote {
    const now = nowIso();
    return {
      ...dailyNoteFromPatient(patient, selectedDate),
      date: selectedDate,
      createdAt: selectedNote?.createdAt || now,
      updatedAt: now,
    };
  }

  async function commitDraft(patientToSave = draftRef.current) {
    if (!patientToSave || isComposingRef.current) return;

    const nextPatient = { ...patientToSave, updatedAt: nowIso() };
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, noteFromDraft(nextPatient));
    setIsDirty(false);
    isDirtyRef.current = false;
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

    draftRef.current = safeNextPatient;
    setDraftPatient(safeNextPatient);
    await onSavePatient(safeNextPatient);
    await onSaveDailyNote(safeNextPatient.id, acceptedNote);
    setSoapEditorText(soapPreviewTextFromPatient(safeNextPatient, [acceptedNote, ...patientNotes], selectedDate));
    setSoapEditorDirty(false);
    soapEditorDirtyRef.current = false;
    setIsDirty(false);
    isDirtyRef.current = false;
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

    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, nextNote);
    setSoapEditorText(soapPreviewTextFromPatient(nextPatient, [nextNote, ...patientNotes], selectedDate));
    setSoapEditorDirty(false);
    soapEditorDirtyRef.current = false;
    setIsDirty(false);
    isDirtyRef.current = false;
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
    isComposingRef.current = false;
    setQuickVsOrder("");
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    await onSaveDailyNote(nextPatient.id, nextNote);
    setIsDirty(false);
    isDirtyRef.current = false;
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
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSaveDailyNote(sourcePatient.id, copiedNote);
    setIsDirty(false);
    isDirtyRef.current = false;
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

  function previewClinicalFieldCleanup() {
    const preview = routePatientClinicalFields(draftRef.current ?? currentPatient);
    setCleanupPreview(preview);
    setCleanupStatus(
      preview.changes.length > 0
        ? `${preview.changes.length} field(s) can be cleaned. Review below, then apply and refresh the SOAP editor.`
        : "No obvious AI field pollution found.",
    );
  }

  function applyClinicalFieldCleanup() {
    if (!cleanupPreview || cleanupPreview.changes.length === 0) return;
    const cleanedPatient = { ...cleanupPreview.patient, updatedAt: nowIso() };
    updateDraft(cleanedPatient);
    setExternalSoapDraft((current) => ({
      revision: current.revision + 1,
      text: fallbackSoapTextFromPatient(cleanedPatient, patientNotes, selectedDate),
      status: "Cleanup applied to SOAP editor. Review, then Save reviewed SOAP.",
    }));
    setCleanupPreview({ patient: cleanedPatient, changes: [] });
    setCleanupStatus("Cleaned fields applied and SOAP editor refreshed. Review the SOAP above, then Save reviewed SOAP.");
    setActiveTab("rounds");
    window.requestAnimationFrame(() => {
      document.querySelector(".round-soap-composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function shortCleanupText(value: string) {
    const text = value.trim();
    if (!text) return "(empty)";
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.slice(0, 4).join("\n") + (lines.length > 4 ? "\n..." : "");
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
        {patientNotes.length === 0 && <p className="muted">No saved daily SOAP history yet. Legacy patient SOAP fields are still preserved.</p>}
        {patientNotes.map((note) => (
          <details key={note.date} open={note.date === selectedDate}>
            <summary>{note.date}</summary>
            {note.soapText?.trim() ? (
              <div className="soap-history-reviewed">
                <ClinicalText value={note.soapText} />
              </div>
            ) : (
            <div className="soap-history-grid">
              <div><strong>Red Flags</strong><ClinicalText value={note.importantRedFlags} importantDefault /></div>
              <div><strong>Overnight Event</strong><ClinicalText value={note.overnightEvents} /></div>
              <div><strong>S</strong><ClinicalText value={note.subjectiveOrChiefConcern} /></div>
              <div><strong>V/S</strong><ClinicalText value={note.vitalSigns} /></div>
              <div><strong>Blood sugar</strong><ClinicalText value={note.bloodSugar} /></div>
              <div><strong>PE</strong><ClinicalText value={note.physicalExam} /></div>
              <div><strong>Lab</strong><ClinicalText value={note.rawLabText || note.labSummary} /></div>
              <div><strong>Image</strong><ClinicalText value={note.imageSummary} /></div>
              <div><strong>A</strong><ClinicalText value={note.assessment} /></div>
              <div><strong>P</strong><ClinicalText value={note.plan} /></div>
              <div><strong>DC / VS</strong><ClinicalText value={[note.dischargePlan, note.vsOrder].filter(Boolean).join("\n")} /></div>
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
            <p className="muted">Board, Details, and Print read this reviewed SOAP. Paste stays local until Generate; Save is explicit.</p>
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
          }}
          onSaveDailyNote={onSaveDailyNote}
          externalSoapText={externalSoapDraft.text}
          externalSoapRevision={externalSoapDraft.revision}
          externalSoapStatus={externalSoapDraft.status}
        />
      </section>
    );
  }

  const headerDigest = getRoundingDigest(currentPatient, patientNotes, {
    mode: "rounds",
    hideCompletedTasks: true,
  });
  const headerSoap = fallbackSoapTextFromPatient(currentPatient, patientNotes, selectedDate);
  const headerRedFlags = simpleDetailRedFlags(
    headerSoap
      .split(/\r?\n/)
      .find((line) => /^Red flags:/i.test(line.trim()))
      ?.replace(/^Red flags:\s*/i, "") ?? "",
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>
            {currentPatient.bed} - {currentPatient.patientCode}
          </h2>
          <p className="muted">{selectedDate} / {selectedNote ? "Editing saved daily note" : "No note for this date yet"}</p>
        </div>
        <div className="form-actions">
          <span className={`save-state-pill ${isDirty ? "save-state-dirty" : "save-state-clean"}`}>
            {isDirty ? "Unsaved local edits" : "No unsaved edits"}
          </span>
          <button type="button" disabled={!isDirty} onClick={() => void commitDraft()}>
            Save
          </button>
          <Link className="button-link secondary" to="/patients">
            Back
          </Link>
        </div>
      </header>

      <section className="panel patient-detail-header">
        <div className="detail-id-block">
          <strong>{currentPatient.bed || "No bed"}</strong>
          <span>{currentPatient.patientCode}</span>
          <span>{currentPatient.age}/{currentPatient.sex}</span>
          {currentPatient.attending && <span>Att: {currentPatient.attending}</span>}
        </div>
        <div className="detail-header-grid">
          {headerDigest.diagnosis && <div><strong>Dx:</strong> {headerDigest.diagnosis}</div>}
          {currentPatient.dischargeTargetDate && <div><strong>DC:</strong> {currentPatient.dischargeTargetDate}</div>}
          {headerDigest.risks && <div><strong>Risk:</strong> {headerDigest.risks}</div>}
          {headerDigest.issues && <div><strong>Issues:</strong> {headerDigest.issues}</div>}
        </div>
        {headerRedFlags && (
          <div className="detail-header-red-flags">
            <strong>Red Flags:</strong> <ClinicalText value={headerRedFlags} maxLines={3} maxCharsPerLine={72} importantDefault />
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
                <p className="muted">Paste the de-identified admission note here first. Review the generated summary, then save explicitly.</p>
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
          <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
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

      {(visibleCleanupChanges.length > 0 || cleanupStatus) && (
        <details className="panel ai-cleanup-panel">
          <summary>Clean AI Draft preview</summary>
          <div className="section-heading">
            <div>
              <h3>Clean AI Draft</h3>
              <p className="muted">Preview-only cleanup for V/S-in-S, report-in-PE, rule labels, generic A/P, and noisy AI tasks.</p>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={previewClinicalFieldCleanup}>
                Preview cleanup
              </button>
              <button type="button" disabled={!cleanupPreview || cleanupPreview.changes.length === 0} onClick={applyClinicalFieldCleanup}>
                Apply + refresh SOAP
              </button>
            </div>
          </div>
          {cleanupStatus && <p className="status-message">{cleanupStatus}</p>}
          {!cleanupPreview && visibleCleanupChanges.length > 0 && (
            <p className="muted">{visibleCleanupChanges.length} AI-draft field cleanup(s) detected. Preview to compare before applying to the SOAP editor.</p>
          )}
          {cleanupPreview && visibleCleanupChanges.length > 0 && (
            <div className="cleanup-change-grid">
              {visibleCleanupChanges.map((change) => (
                <article className="cleanup-change-card" key={`${change.field}-${change.reason}`}>
                  <div className="cleanup-change-header">
                    <strong>{change.label}</strong>
                    <span>{change.reason}</span>
                  </div>
                  <div className="cleanup-before-after">
                    <div>
                      <span>Current</span>
                      <pre>{shortCleanupText(change.before)}</pre>
                    </div>
                    <div>
                      <span>Cleaned</span>
                      <pre>{shortCleanupText(change.after)}</pre>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </details>
      )}

      <details className="panel detail-more-section">
        <summary>Advanced / legacy fields</summary>
        <div className="detail-more-stack">
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
