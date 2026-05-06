import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DailyNote, DailyNotesByPatient, Patient } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import { ClinicalText } from "../components/ClinicalText";
import LabHistoryPanel from "../components/LabHistoryPanel";
import {
  dailyNoteFromPatient,
  emptyDailyNote,
  latestDailyNote,
  nowIso,
  patientWithDailyNote,
  todayKey,
} from "../utils";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
}

const compositionSaveDelayMs = 900;

function PatientDetailPage({
  patients,
  dailyNotesByPatient = {},
  onSavePatient,
  onSaveDailyNote,
}: PageProps) {
  const { patientId } = useParams();
  const sourcePatient = patients.find((item) => item.id === patientId);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const patientNotes = patientId ? dailyNotesByPatient[patientId] ?? [] : [];
  const selectedNote = patientNotes.find((note) => note.date === selectedDate);
  const selectedDraftNote =
    selectedNote ?? (sourcePatient && patientNotes.length === 0 ? dailyNoteFromPatient(sourcePatient, selectedDate) : emptyDailyNote(selectedDate));
  const initialDraft = sourcePatient ? patientWithDailyNote(sourcePatient, selectedDraftNote) : null;
  const [draftPatient, setDraftPatient] = useState<Patient | null>(initialDraft);
  const [isDirty, setIsDirty] = useState(false);
  const draftRef = useRef<Patient | null>(initialDraft);
  const isDirtyRef = useRef(false);
  const isComposingRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!sourcePatient) return;

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      const nextNote =
        selectedNote ?? (patientNotes.length === 0 ? dailyNoteFromPatient(sourcePatient, selectedDate) : emptyDailyNote(selectedDate));
      const nextPatient = patientWithDailyNote(sourcePatient, nextNote);
      draftRef.current = nextPatient;
      setDraftPatient(nextPatient);
      setIsDirty(false);
      isDirtyRef.current = false;
    }
  }, [sourcePatient, selectedDate, selectedNote, patientNotes.length]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

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

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

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
      ? "Overwrite this date's SOAP draft from previous note? This will not delete old notes."
      : "Create today's SOAP from previous note? This will not delete old notes.";
    if (!window.confirm(message)) return;
    const previousNote = latestDailyNote(patientNotes.filter((note) => note.date < selectedDate));
    const sourceNote = previousNote ?? dailyNoteFromPatient(sourcePatient, selectedDate);
    const copiedNote: DailyNote = {
      ...sourceNote,
      date: selectedDate,
      createdAt: selectedNote?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    const nextPatient = patientWithDailyNote(sourcePatient, copiedNote);
    updateDraft(nextPatient);
    await commitDraft(nextPatient);
  }

  function scheduleCommitAfterComposition() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void commitDraft();
    }, compositionSaveDelayMs);
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
  }

  function handleCompositionEnd() {
    isComposingRef.current = false;
    scheduleCommitAfterComposition();
  }

  function handleFieldBlur() {
    if (!isComposingRef.current) {
      void commitDraft();
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>
            {currentPatient.bed} - {currentPatient.patientCode}
          </h2>
          {isDirty && <p className="muted">Unsaved edits will save on blur or Save.</p>}
        </div>
        <Link className="button-link secondary" to="/patients">
          Back
        </Link>
      </header>

      <section className="panel quick-actions">
        <div>
          <h3>Daily SOAP Date</h3>
          <p className="muted">
            Default is today. DITTO copies the previous note into today. Old notes are preserved.
          </p>
        </div>
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
      </section>

      <PatientForm
        patient={currentPatient}
        onChange={updateDraft}
        onSubmit={() => commitDraft()}
        submitLabel="Save Basic Info"
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <AdmissionBriefForm
        patient={currentPatient}
        onChange={updateDraft}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <DailyNoteForm
        patient={currentPatient}
        onChange={updateDraft}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <LabHistoryPanel patient={currentPatient} notes={patientNotes} />

      <section className="panel soap-history">
        <h2>SOAP History</h2>
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

      {currentPatient.specialAttention.trim() && (
        <section className="panel legacy-note">
          <h3>Legacy Special Attention</h3>
          <ClinicalText value={currentPatient.specialAttention} />
        </section>
      )}

      <TaskList
        tasks={currentPatient.tasks}
        onChange={(tasks) => updateDraft({ ...currentPatient, tasks })}
        onCommit={() => commitDraft()}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
}

export default PatientDetailPage;
