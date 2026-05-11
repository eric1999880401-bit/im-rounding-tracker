import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import AiIntakePanel from "../components/AiIntakePanel";
import { ClinicalText, CompactItemList } from "../components/ClinicalText";
import AssessmentPlanDisplay from "../components/AssessmentPlanDisplay";
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
  getActiveProblemItems,
  getUnderlyingDiseaseItems,
  getLabFocusSummary,
  getLatestNonEmptyDailyNote,
  getPatientDisplaySummary,
  nowIso,
  patientForDate,
  patientWithDailyNote,
  textToItems,
  todayKey,
} from "../utils";

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

  async function applyAiIntakePatient(nextPatient: Patient) {
    await commitDraft(nextPatient);
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

  function conciseLines(value: string, limit = 3) {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^!+/, "").replace(/\s+-\s+Reason:.*/i, "").trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  function shortLine(value: string, maxChars = 72) {
    const clean = value.replace(/\s+-\s+Reason:.*/i, "").trim();
    const firstClause = clean.split(/[;。]/)[0]?.trim() || clean;
    if (firstClause.length <= maxChars) return firstClause;
    return `${firstClause.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
  }

  function roundsImageSummary(patient: Patient) {
    if (patient.imageStudyEntries.length > 0) {
      return patient.imageStudyEntries
        .filter((entry) => entry.studyType.trim() || entry.impression.trim() || entry.finding.trim())
        .slice(0, 3)
        .map((entry) =>
          [entry.date, entry.studyType, shortLine(entry.impression || entry.finding || entry.note, 54)]
            .filter(Boolean)
            .join(" - "),
        )
        .join("\n");
    }

    return conciseLines(patient.newImaging, 3).map((line) => shortLine(line, 72)).join("\n");
  }

  function pendingTasks() {
    return currentPatient.tasks.filter((task) => !task.done);
  }

  function urgentTasks() {
    return pendingTasks().filter((task) => task.priority === "urgent" || task.text.trim().startsWith("!"));
  }

  function criticalLines() {
    const vitalSignals = conciseLines(currentPatient.vitalSigns, 4)
      .filter((line) => !/\bnormal\b/i.test(line) && /fever|tachy|hypo|hyper|low|elevated|spo2|desat|bp|hr|rr/i.test(line))
      .slice(0, 2)
      .map((line) => shortLine(line, 58));
    const labFocus = getLabFocusSummary(currentPatient, patientNotes, {
      maxCritical: 2,
      maxTrend: 1,
      maxAnchors: 0,
    });
    const labSignals = [...labFocus.critical, ...labFocus.trend.slice(0, 1)].map((line) => `Lab: ${line}`);
    const firstProblem = currentPatient.assessmentPlanItems.find((item) => item.problemTitle || item.assessmentSummary);

    return [
      ...conciseLines(currentPatient.importantRedFlags, 3),
      ...vitalSignals,
      ...urgentTasks().slice(0, 2).map((task) => task.text.replace(/^!+/, "").trim()),
      ...labSignals,
      firstProblem?.problemTitle ? `A/P: ${shortLine(firstProblem.problemTitle, 48)}` : "",
    ].filter(Boolean).slice(0, 5);
  }

  function attendingLines() {
    const firstProblem = currentPatient.assessmentPlanItems.find((item) => item.problemTitle || item.assessmentSummary);
    return [
      conciseLines(currentPatient.oneLiner, 1)[0] || currentPatient.primaryDiagnosis,
      ...conciseLines(currentPatient.overnightEvent, 2).map((line) => `ON: ${line}`),
      firstProblem?.problemTitle ? `A/P: ${firstProblem.problemTitle}` : "",
      firstProblem?.planItems[0] ? `Plan: ${firstProblem.planItems[0]}` : "",
    ].filter(Boolean).slice(0, 5).join("\n");
  }

  function taskLines() {
    return [...urgentTasks(), ...pendingTasks().filter((task) => !urgentTasks().includes(task))]
      .slice(0, 6)
      .map((task) => `${task.priority === "urgent" ? "!" : ""}${task.text.replace(/^!+/, "").trim()}`)
      .join("\n");
  }

  function dischargeLines() {
    return [
      currentPatient.dischargeTargetDate ? `Target: ${currentPatient.dischargeTargetDate}` : "",
      currentPatient.dischargePlan,
      currentPatient.dischargeBarriers ? `Barrier: ${currentPatient.dischargeBarriers}` : "",
    ].filter(Boolean).join("\n");
  }

  function renderRoundsMode() {
    const roundsSummary = displaySummary?.patient ?? currentPatient;
    const critical = criticalLines().map((line) => `!${line}`).join("\n");
    const tasks = taskLines();

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
            <ClinicalText value={attendingLines()} fallback="No summary yet" maxCharsPerLine={74} />
          </section>
          <section className="rounds-focus-block">
            <span className="board-label">Do today</span>
            <ClinicalText value={tasks} fallback="No pending tasks" maxCharsPerLine={58} />
          </section>
        </div>

        <div className="rounds-detail-grid">
          <section className="rounds-block">
            <span className="board-label">S / Overnight</span>
            <ClinicalText
              value={[roundsSummary.subjectiveOrChiefConcern, roundsSummary.overnightEvent].filter(Boolean).join("\n")}
              fallback="-"
              maxLines={4}
              maxCharsPerLine={58}
            />
          </section>

          <section className="rounds-block">
            <span className="board-label">V/S / Sugar / PE</span>
            <ClinicalText
              value={[roundsSummary.vitalSigns, roundsSummary.bloodSugar, roundsSummary.physicalExam].filter(Boolean).join("\n")}
              fallback="-"
              maxLines={5}
              maxCharsPerLine={64}
            />
          </section>

          <section className="rounds-block">
            <span className="board-label">Lab / Image</span>
            <ClinicalText
              value={getLabFocusSummary(roundsSummary, patientNotes, {
                maxCritical: 2,
                maxTrend: 3,
                maxAnchors: 2,
              }).text}
              fallback="No lab signal"
              maxLines={3}
              maxCharsPerLine={72}
            />
            <ClinicalText value={roundsImageSummary(roundsSummary)} fallback="-" maxLines={3} maxCharsPerLine={72} />
          </section>

          <section className="rounds-block rounds-ap-block">
            <span className="board-label">A/P</span>
            <AssessmentPlanDisplay
              items={roundsSummary.assessmentPlanItems}
              legacyAssessment={roundsSummary.assessment}
              legacyPlan={roundsSummary.plan}
              compact
              micro
            />
          </section>

          <section className="rounds-block">
            <span className="board-label">DC</span>
            <ClinicalText value={dischargeLines()} fallback="TBD" maxLines={4} maxCharsPerLine={64} />
          </section>
        </div>
      </section>
    );
  }

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
          {currentPatient.primaryDiagnosis && <div><strong>Dx:</strong> {shortLine(currentPatient.primaryDiagnosis, 92)}</div>}
          {currentPatient.dischargeTargetDate && <div><strong>DC:</strong> {currentPatient.dischargeTargetDate}</div>}
          {getUnderlyingDiseaseItems(currentPatient).length > 0 && (
            <div>
              <strong>PMH:</strong>
              <CompactItemList items={getUnderlyingDiseaseItems(currentPatient).map((item) => shortLine(item, 34))} maxItems={4} />
            </div>
          )}
          {getActiveProblemItems(currentPatient).length > 0 && (
            <div>
              <strong>Problems:</strong>
              <CompactItemList items={getActiveProblemItems(currentPatient).map((item) => shortLine(item, 42))} maxItems={4} />
            </div>
          )}
        </div>
        {currentPatient.importantRedFlags.trim() && (
          <div className="detail-header-red-flags">
            <strong>Red Flags:</strong> <ClinicalText value={currentPatient.importantRedFlags} maxLines={4} maxCharsPerLine={72} importantDefault />
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
