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
import LabHistoryPanel from "../components/LabHistoryPanel";
import ActiveProblemEditor from "../components/ActiveProblemEditor";
import { buildConcisePatientClinicalUpdate } from "../clinicalPatientPolish";
import { routePatientClinicalFields, type ClinicalFieldCleanupChange } from "../clinicalFieldRouter";
import {
  IconAiIntake,
  IconAssessment,
  IconInfo,
  IconObjective,
  IconQuickUpdate,
  IconRounds,
  IconTasks,
} from "../components/icons";
import { useT } from "../i18n";
import {
  dailyNoteFromPatient,
  dischargePrepText,
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

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  dataLoading?: boolean;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
}

type DetailTab = "rounds" | "quick" | "objective" | "assessmentPlan" | "tasksDischarge" | "aiIntake" | "more";

type DetailTabIcon = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const detailTabs: Array<{ id: DetailTab; labelKey: string; shortKey: string; Icon: DetailTabIcon }> = [
  { id: "rounds", labelKey: "detail.tabs.rounds", shortKey: "detail.tabs.short.rounds", Icon: IconRounds },
  { id: "quick", labelKey: "detail.tabs.quick", shortKey: "detail.tabs.short.quick", Icon: IconQuickUpdate },
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
  const draftRef = useRef<Patient | null>(initialDraft);
  const isDirtyRef = useRef(false);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!sourcePatient) return;

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      const nextDisplayPatient = patientForDate(sourcePatient, dailyNotesByPatient, selectedDate);
      const nextNote = selectedNote
        ? mergeNoteWithFallback(selectedNote, nextDisplayPatient, selectedDate)
        : dailyNoteFromPatient(nextDisplayPatient, selectedDate);
      const nextPatient = patientWithDailyNote(nextDisplayPatient, nextNote);
      draftRef.current = nextPatient;
      setDraftPatient(nextPatient);
      setIsDirty(false);
      isDirtyRef.current = false;
      setCleanupPreview(null);
      setCleanupStatus("");
    }
  }, [sourcePatient, selectedDate, selectedNote, patientNotes.length, dailyNotesByPatient]);

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
    nextNote.assessmentPlanItems = mergeDailyNoteArrays(baseNote.assessmentPlanItems, acceptedNotePatch.assessmentPlanItems);

    const carriedAssessmentPlanItems =
      (previousNote?.assessmentPlanItems ?? []).filter((item) =>
        item.isImportant || crisisCarryForwardScore(`${item.problemTitle} ${item.assessmentSummary} ${item.planItems.join(" ")}`) >= 4,
      );
    nextNote.assessmentPlanItems = mergeDailyNoteArrays(nextNote.assessmentPlanItems, carriedAssessmentPlanItems).map((item, index) => ({
      ...item,
      order: index,
    }));

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
    const carriedAssessmentPlanItems =
      (previousNote?.assessmentPlanItems ?? []).filter((item) =>
        item.isImportant || crisisCarryForwardScore(`${item.problemTitle} ${item.assessmentSummary} ${item.planItems.join(" ")}`) >= 4,
      );
    const existingPlanKeys = new Set(
      nextPatient.assessmentPlanItems.map((item) => (item.problemTitle || item.assessmentSummary).toLowerCase().trim()),
    );
    const safeNextPatient = {
      ...nextPatient,
      importantRedFlags: appendUniqueClinicalText(nextPatient.importantRedFlags, carriedRedFlags),
      assessmentPlanItems: [
        ...nextPatient.assessmentPlanItems,
        ...carriedAssessmentPlanItems.filter((item) => {
          const key = (item.problemTitle || item.assessmentSummary).toLowerCase().trim();
          if (!key || existingPlanKeys.has(key)) return false;
          existingPlanKeys.add(key);
          return true;
        }),
      ].map((item, index) => ({ ...item, order: index })),
    };
    const acceptedNote = buildAiAcceptedDailyNote(acceptedNotePatch, previousNote ?? null);

    draftRef.current = safeNextPatient;
    setDraftPatient(safeNextPatient);
    await onSavePatient(safeNextPatient);
    await onSaveDailyNote(safeNextPatient.id, acceptedNote);
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
        ? `${preview.changes.length} field(s) can be cleaned. Review below, then apply to local draft.`
        : "No obvious AI field pollution found.",
    );
  }

  function applyClinicalFieldCleanup() {
    if (!cleanupPreview || cleanupPreview.changes.length === 0) return;
    updateDraft({ ...cleanupPreview.patient, updatedAt: nowIso() });
    setCleanupStatus("Cleaned version applied to local draft. Use Save to write it to Firestore.");
    setActiveTab("assessmentPlan");
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
          </details>
        ))}
      </section>
    );
  }

  function renderRoundsMode() {
    const roundsSummary = displaySummary?.patient ?? currentPatient;
    const digest = getRoundingDigest(roundsSummary, patientNotes, {
      mode: "rounds",
      hideCompletedTasks: true,
    });
    const redFlags = simpleDetailRedFlags(digest.redFlags);
    const prepText = dischargePrepText(roundsSummary);
    const taskDcText = [
      digest.tasks,
      digest.discharge ? `DC: ${digest.discharge}` : "",
      prepText ? `Prep: ${prepText}` : "",
    ].filter(Boolean).join("\n");

    return (
      <section className="panel rounds-mode-panel">
        <div className="section-heading">
          <h2>SOAP</h2>
          <span className="muted">{selectedDate}</span>
        </div>

        {redFlags && (
          <section className="detail-soap-redflag">
            <span className="board-label">Red flags</span>
            <ClinicalText value={redFlags} maxLines={3} maxCharsPerLine={90} importantDefault />
          </section>
        )}

        <div className="detail-rounding-sheet">
          <section className="detail-soap-block detail-rounding-context">
            <span className="board-label">Dx / Issues</span>
            <ClinicalText
              value={[
                digest.diagnosis ? `Dx: ${digest.diagnosis}` : "",
                digest.risks ? `PMH: ${digest.risks}` : "",
                digest.issues ? `Issues: ${digest.issues}` : "",
              ].filter(Boolean).join("\n")}
              fallback="-"
              maxLines={4}
              maxCharsPerLine={92}
            />
          </section>

          <section className="detail-soap-block">
            <span className="board-label">S</span>
            <ClinicalText value={digest.subjective} fallback="-" maxLines={4} maxCharsPerLine={90} />
          </section>

          <section className="detail-soap-block detail-soap-objective">
            <span className="board-label">O</span>
            <div className="detail-objective-stack">
              <div>
                <span className="objective-chip-label">V/S / PE</span>
                <ClinicalText value={digest.objective} fallback="-" maxLines={3} maxCharsPerLine={88} />
              </div>
              <div>
                <span className="objective-chip-label">Lab focus</span>
                <ClinicalText value={digest.lab} fallback="No lab signal" maxLines={3} maxCharsPerLine={88} />
              </div>
              <div>
                <span className="objective-chip-label">Image focus</span>
                <ClinicalText value={digest.image} fallback="-" maxLines={2} maxCharsPerLine={88} />
              </div>
            </div>
          </section>

          <section className="detail-soap-block detail-soap-ap">
            <span className="board-label">A/P</span>
            <ClinicalText value={digest.assessmentPlan} fallback="-" maxLines={6} maxCharsPerLine={92} />
          </section>

          <section className="detail-soap-block detail-soap-task">
            <span className="board-label">Tasks / DC</span>
            <ClinicalText value={taskDcText} fallback="No pending tasks" maxLines={6} maxCharsPerLine={88} />
          </section>
        </div>

        <details className="rounds-quick-order-collapse">
          <summary>Add post-round order / task</summary>
          <section className="rounds-quick-order">
            <label>
              Post-round orders / VS note
              <textarea
                value={quickVsOrder}
                onChange={(event) => setQuickVsOrder(event.target.value)}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder="BP q4h; repeat CBC tomorrow; hold antiplatelet if Hb drops"
                rows={2}
              />
            </label>
            <button type="button" disabled={!quickVsOrder.trim()} onClick={() => void appendQuickVsOrder()}>
              Add to today's SOAP
            </button>
          </section>
        </details>
      </section>
    );
  }

  const headerDigest = getRoundingDigest(currentPatient, patientNotes, {
    mode: "rounds",
    hideCompletedTasks: true,
  });
  const headerRedFlags = simpleDetailRedFlags(headerDigest.redFlags);

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

      {(visibleCleanupChanges.length > 0 || cleanupStatus) && (
        <section className="panel ai-cleanup-panel">
          <div className="section-heading">
            <div>
              <h3>Clean AI Draft</h3>
              <p className="muted">Preview-only cleanup for V/S-in-S, report-in-PE, rule labels, and generic A/P.</p>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={previewClinicalFieldCleanup}>
                Preview cleanup
              </button>
              <button type="button" disabled={!cleanupPreview || cleanupPreview.changes.length === 0} onClick={applyClinicalFieldCleanup}>
                Apply to local draft
              </button>
            </div>
          </div>
          {cleanupStatus && <p className="status-message">{cleanupStatus}</p>}
          {!cleanupPreview && visibleCleanupChanges.length > 0 && (
            <p className="muted">{visibleCleanupChanges.length} AI-draft field cleanup(s) detected. Preview to compare before applying to the local draft.</p>
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
        </section>
      )}

      <section className="panel detail-tabs-shell">
        <div className="detail-tabs" role="tablist" aria-label="Patient detail sections">
          {detailTabs.map((tab) => {
            const TabIcon = tab.Icon;
            const fullLabel = t(tab.labelKey);
            return (
              <button
                type="button"
                className={`detail-tab${activeTab === tab.id ? " active" : ""}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-label={fullLabel}
                title={fullLabel}
              >
                <span className="detail-tab-icon">
                  <TabIcon />
                </span>
                <span className="detail-tab-label">{t(tab.shortKey)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "rounds" && renderRoundsMode()}

      {activeTab === "quick" && (
        <div className="detail-update-stack">
          <DailyNoteForm
            patient={currentPatient}
            onChange={updateDraft}
            section="subjective"
            displaySummary={displaySummary ?? undefined}
            onImmediateCommit={() => void commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
          <DailyNoteForm
            patient={currentPatient}
            onChange={updateDraft}
            section="quick"
            displaySummary={displaySummary ?? undefined}
            onImmediateCommit={() => void commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </div>
      )}

      {activeTab === "objective" && (
        <>
          <DailyNoteForm
            patient={currentPatient}
            onChange={updateDraft}
            section="objective"
            onImmediateCommit={() => void commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
          <LabHistoryPanel patient={currentPatient} notes={patientNotes} />
        </>
      )}

      {activeTab === "assessmentPlan" && (
        <>
          <section className="panel">
            <div className="section-heading">
              <h2>Diagnosis / Problems</h2>
              <button type="button" className="secondary" onClick={refineAssessmentPlanFromClinicalFacts}>
                Refine A/P
              </button>
            </div>
            <div className="form-grid">
              <label className="span-2">
                Primary Diagnosis
                <input
                  value={currentPatient.primaryDiagnosis}
                  onChange={(event) => updateField("primaryDiagnosis", event.target.value)}
                  onBlur={handleFieldBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </label>
              <label className="span-2">
                PMH / Underlying Disease
                <textarea
                  value={currentPatient.underlyingDiseases}
                  onChange={(event) => updateUnderlyingDiseases(event.target.value)}
                  onBlur={handleFieldBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </label>
              <div className="span-2">
                <ActiveProblemEditor
                  legacyText={currentPatient.activeProblems}
                  items={currentPatient.activeProblemStructuredItems}
                  onLegacyTextChange={updateActiveProblems}
                  onItemsChange={(items) => updateField("activeProblemStructuredItems", items)}
                  onFieldBlur={handleFieldBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </div>
            </div>
          </section>
          <DailyNoteForm
            patient={currentPatient}
            onChange={updateDraft}
            section="assessmentPlan"
            onImmediateCommit={() => void commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </>
      )}

      {activeTab === "tasksDischarge" && (
        <>
          <TaskList
            tasks={currentPatient.tasks}
            onChange={(tasks) => updateDraft({ ...currentPatient, tasks })}
            onCommit={() => commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
          <DailyNoteForm
            patient={currentPatient}
            onChange={updateDraft}
            section="discharge"
            onImmediateCommit={() => void commitDraft()}
            onFieldBlur={handleFieldBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
          {currentPatient.specialAttention.trim() && (
            <section className="panel legacy-note">
              <h3>Legacy Special Attention</h3>
              <ClinicalText value={currentPatient.specialAttention} />
            </section>
          )}
        </>
      )}

      {activeTab === "aiIntake" && (
        <div className="detail-update-stack">
          <ClinicalDocumentQuickActions
            patient={currentPatient}
            notes={patientNotes}
            selectedDate={selectedDate}
            onSavePatient={async (nextPatient) => {
              draftRef.current = nextPatient;
              setDraftPatient(nextPatient);
              await commitDraft(nextPatient);
            }}
          />
          <AiIntakePanel
            patient={currentPatient}
            selectedDate={selectedDate}
            onApplyPatient={applyAiIntakePatient}
          />
        </div>
      )}

      {activeTab === "more" && (
        <div className="detail-more-stack">
          <details className="detail-more-section" open={currentPatient.isNewAdmission || currentPatient.showAdmissionBriefOnPrint}>
            <summary>Admission Brief</summary>
            <AdmissionBriefForm
              patient={currentPatient}
              onChange={updateDraft}
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
              onFieldBlur={handleFieldBlur}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </details>
        </div>
      )}
    </div>
  );
}

export default PatientDetailPage;
