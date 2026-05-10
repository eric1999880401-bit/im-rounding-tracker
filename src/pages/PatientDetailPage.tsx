import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import { ClinicalText } from "../components/ClinicalText";
import LabHistoryPanel from "../components/LabHistoryPanel";
import ActiveProblemEditor from "../components/ActiveProblemEditor";
import {
  dailyNoteFromPatient,
  emptyDailyNote,
  getActiveProblemItems,
  getUnderlyingDiseaseItems,
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

type DetailTab = "quick" | "objective" | "assessmentPlan" | "tasksDischarge" | "admission" | "history" | "info";

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "quick", label: "Quick Daily Update" },
  { id: "objective", label: "Objective" },
  { id: "assessmentPlan", label: "A/P" },
  { id: "tasksDischarge", label: "Tasks / Discharge" },
  { id: "admission", label: "Admission" },
  { id: "history", label: "SOAP History" },
  { id: "info", label: "Patient Info" },
];

function PatientDetailPage({
  patients,
  dailyNotesByPatient = {},
  dataLoading = false,
  onSavePatient,
  onSaveDailyNote,
}: PageProps) {
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
  const [activeTab, setActiveTab] = useState<DetailTab>("quick");
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

  async function dittoLatestNote() {
    if (!sourcePatient) return;
    const todayExists = Boolean(selectedNote);
    const message = todayExists
      ? "Overwrite this date's SOAP draft from the latest note? This will not delete old notes or patient-level data."
      : "DITTO copies the latest note into today. It will not delete old notes or patient-level data.";
    if (!window.confirm(message)) return;
    const previousNote = getLatestNonEmptyDailyNote(patientNotes.filter((note) => note.date < selectedDate));
    const sourceNote = previousNote ?? dailyNoteFromPatient(sourcePatient, selectedDate);
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
        <p className="muted">DITTO copies the previous note into today. Old notes are preserved.</p>
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
          <button type="button" className="secondary" onClick={dittoLatestNote}>
            DITTO latest note
          </button>
        </div>
        {patientNotes.length === 0 && <p className="muted">No saved daily SOAP history yet. Legacy patient SOAP fields are still preserved.</p>}
        {patientNotes.map((note) => (
          <details key={note.date} open={note.date === selectedDate}>
            <summary>{note.date}</summary>
            <div className="soap-history-grid">
              <div><strong>Red Flags</strong><ClinicalText value={note.importantRedFlags} importantDefault /></div>
              <div><strong>S</strong><ClinicalText value={note.subjectiveOrChiefConcern} /></div>
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
          {currentPatient.primaryDiagnosis && <div><strong>Dx:</strong> {currentPatient.primaryDiagnosis}</div>}
          {currentPatient.dischargeTargetDate && <div><strong>DC:</strong> {currentPatient.dischargeTargetDate}</div>}
          {getUnderlyingDiseaseItems(currentPatient).length > 0 && (
            <div><strong>PMH:</strong> {getUnderlyingDiseaseItems(currentPatient).join(", ")}</div>
          )}
          {getActiveProblemItems(currentPatient).length > 0 && (
            <div><strong>Problems:</strong> {getActiveProblemItems(currentPatient).join("; ")}</div>
          )}
        </div>
        {currentPatient.importantRedFlags.trim() && (
          <div className="detail-header-red-flags">
            <strong>Red Flags:</strong> <ClinicalText value={currentPatient.importantRedFlags} importantDefault />
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
        <button type="button" className="secondary" onClick={dittoLatestNote}>
          DITTO latest note
        </button>
        <button type="button" disabled={!isDirty} onClick={() => void commitDraft()}>
          Save current edits
        </button>
        <p className="muted">DITTO copies the previous note into today. Old notes are preserved. Opening this page or switching tabs does not save.</p>
        {!selectedNote && getLatestNonEmptyDailyNote(patientNotes) && (
          <p className="muted">Today note is empty. Showing latest saved data.</p>
        )}
      </section>

      <section className="panel detail-tabs-shell">
        <div className="detail-tabs" role="tablist" aria-label="Patient detail sections">
          {detailTabs.map((tab) => (
            <button
              type="button"
              className={activeTab === tab.id ? "active" : "secondary"}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

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
