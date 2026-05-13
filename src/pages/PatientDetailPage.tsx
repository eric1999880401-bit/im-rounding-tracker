import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import AiIntakePanel from "../components/AiIntakePanel";
import { AiHighlightsPanel } from "../components/AiHighlightsPanel";
import { ClinicalText } from "../components/ClinicalText";
import LabHistoryPanel from "../components/LabHistoryPanel";
import ActiveProblemEditor from "../components/ActiveProblemEditor";
import {
  IconAdmission,
  IconAiIntake,
  IconAssessment,
  IconHistory,
  IconInfo,
  IconObjective,
  IconQuickUpdate,
  IconRounds,
  IconSubjective,
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

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  dataLoading?: boolean;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
}

type DetailTab = "rounds" | "subjective" | "quick" | "objective" | "assessmentPlan" | "tasksDischarge" | "aiIntake" | "admission" | "history" | "info";

type DetailTabIcon = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement;

const detailTabs: Array<{ id: DetailTab; labelKey: string; shortKey: string; Icon: DetailTabIcon }> = [
  { id: "rounds", labelKey: "detail.tabs.rounds", shortKey: "detail.tabs.short.rounds", Icon: IconRounds },
  { id: "quick", labelKey: "detail.tabs.quick", shortKey: "detail.tabs.short.quick", Icon: IconQuickUpdate },
  { id: "subjective", labelKey: "detail.tabs.subjective", shortKey: "detail.tabs.short.subjective", Icon: IconSubjective },
  { id: "objective", labelKey: "detail.tabs.objective", shortKey: "detail.tabs.short.objective", Icon: IconObjective },
  { id: "assessmentPlan", labelKey: "detail.tabs.assessmentPlan", shortKey: "detail.tabs.short.assessmentPlan", Icon: IconAssessment },
  { id: "tasksDischarge", labelKey: "detail.tabs.tasksDischarge", shortKey: "detail.tabs.short.tasksDischarge", Icon: IconTasks },
  { id: "aiIntake", labelKey: "detail.tabs.aiIntake", shortKey: "detail.tabs.short.aiIntake", Icon: IconAiIntake },
  { id: "admission", labelKey: "detail.tabs.admission", shortKey: "detail.tabs.short.admission", Icon: IconAdmission },
  { id: "history", labelKey: "detail.tabs.history", shortKey: "detail.tabs.short.history", Icon: IconHistory },
  { id: "info", labelKey: "detail.tabs.info", shortKey: "detail.tabs.short.info", Icon: IconInfo },
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
  const selectedDraftNote = selectedNote ?? (displayFallbackPatient ? dailyNoteFromPatient(displayFallbackPatient, selectedDate) : emptyDailyNote(selectedDate));
  const initialDraft = displayFallbackPatient ? patientWithDailyNote(displayFallbackPatient, selectedDraftNote) : null;
  const [draftPatient, setDraftPatient] = useState<Patient | null>(initialDraft);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("rounds");
  const [selectedDittoDate, setSelectedDittoDate] = useState("");
  const [quickVsOrder, setQuickVsOrder] = useState("");
  const draftRef = useRef<Patient | null>(initialDraft);
  const isDirtyRef = useRef(false);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!sourcePatient) return;

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      const nextDisplayPatient = patientForDate(sourcePatient, dailyNotesByPatient, selectedDate);
      const nextNote = selectedNote ?? dailyNoteFromPatient(nextDisplayPatient, selectedDate);
      const nextPatient = patientWithDailyNote(nextDisplayPatient, nextNote);
      draftRef.current = nextPatient;
      setDraftPatient(nextPatient);
      setIsDirty(false);
      isDirtyRef.current = false;
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
    const critical = digest.urgentLines.map((line) => `!${line}`).join("\n");

    return (
      <section className="panel rounds-mode-panel">
        <div className="section-heading">
          <h2>Rounds Mode</h2>
          <span className="muted">{selectedDate}</span>
        </div>

        <div className="rounds-focus-grid">
          <section className="rounds-focus-block rounds-critical-block">
            <span className="board-label">See first</span>
            <ClinicalText value={critical} fallback="No urgent signal" maxCharsPerLine={58} importantDefault />
          </section>
          <section className="rounds-focus-block">
            <span className="board-label">Tell attending</span>
            <ClinicalText value={digest.attendingSummary} fallback="No summary yet" maxLines={5} maxCharsPerLine={66} />
          </section>
          <section className="rounds-focus-block">
            <span className="board-label">Do today</span>
            <ClinicalText value={digest.tasks} fallback="No pending tasks" maxLines={5} maxCharsPerLine={58} />
          </section>
        </div>

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

        <div className="rounds-detail-grid">
          <section className="rounds-block">
            <span className="board-label">S / Overnight</span>
            <ClinicalText value={digest.subjective} fallback="-" maxLines={3} maxCharsPerLine={58} />
          </section>

          <section className="rounds-block">
            <span className="board-label">V/S / Sugar / PE</span>
            <ClinicalText value={digest.objective} fallback="-" maxLines={4} maxCharsPerLine={64} />
          </section>

          <section className="rounds-block">
            <span className="board-label">Lab / Image</span>
            <ClinicalText value={digest.lab} fallback="No lab signal" maxLines={3} maxCharsPerLine={66} />
            <ClinicalText value={digest.image} fallback="-" maxLines={2} maxCharsPerLine={66} />
          </section>

          <section className="rounds-block rounds-ap-block">
            <span className="board-label">A/P</span>
            <ClinicalText value={digest.assessmentPlan} fallback="-" maxLines={4} maxCharsPerLine={66} />
          </section>

          <section className="rounds-block">
            <span className="board-label">DC</span>
            <ClinicalText value={digest.discharge} fallback="TBD" maxLines={4} maxCharsPerLine={64} />
          </section>
        </div>
      </section>
    );
  }

  const headerDigest = getRoundingDigest(currentPatient, patientNotes, {
    mode: "rounds",
    hideCompletedTasks: true,
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>
            {currentPatient.bed} - {currentPatient.patientCode}
          </h2>
          {isDirty && <p className="muted">Unsaved edits are local until you click Save.</p>}
        </div>
        <div className="form-actions">
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
        {headerDigest.redFlags && (
          <div className="detail-header-red-flags">
            <strong>Red Flags:</strong> <ClinicalText value={headerDigest.redFlags} maxLines={3} maxCharsPerLine={72} importantDefault />
          </div>
        )}
      </section>

      <AiHighlightsPanel patient={currentPatient} notes={patientNotes} className="detail-ai-highlights" />

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

      {activeTab === "subjective" && (
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
      )}

      {activeTab === "quick" && (
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
            <h2>Diagnosis / Problems</h2>
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
        <AiIntakePanel
          patient={currentPatient}
          selectedDate={selectedDate}
          onApplyPatient={applyAiIntakePatient}
        />
      )}

      {activeTab === "admission" && (
        <AdmissionBriefForm
          patient={currentPatient}
          onChange={updateDraft}
          onFieldBlur={handleFieldBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      )}

      {activeTab === "history" && renderSoapHistory()}

      {activeTab === "info" && (
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
      )}
    </div>
  );
}

export default PatientDetailPage;
