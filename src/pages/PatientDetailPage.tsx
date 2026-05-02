import { Link, useParams } from "react-router-dom";
import type { Patient } from "../types";
import PatientForm from "../components/PatientForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import { createTodayFromYesterday, nowIso } from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

function PatientDetailPage({ patients, onSavePatient }: PageProps) {
  const { patientId } = useParams();
  const patient = patients.find((item) => item.id === patientId);

  if (!patient) {
    return (
      <div className="page">
        <h2>Patient not found</h2>
        <Link to="/patients">Back to patient board</Link>
      </div>
    );
  }

  async function savePatient(nextPatient: Patient) {
    await onSavePatient({ ...nextPatient, updatedAt: nowIso() });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>
            {patient.bed} - {patient.patientCode}
          </h2>
          <p className="privacy-warning">Use de-identified data only.</p>
        </div>
        <Link className="button-link secondary" to="/patients">
          Back
        </Link>
      </header>

      <section className="panel quick-actions">
        <div>
          <h3>Daily Setup</h3>
          <p className="muted">
            Copies forward yesterday's stable A/P and discharge plan, then clears today's new-event fields.
          </p>
        </div>
        <button type="button" onClick={() => savePatient(createTodayFromYesterday(patient))}>
          Create today from yesterday
        </button>
      </section>

      <PatientForm
        patient={patient}
        onChange={savePatient}
        onSubmit={() => savePatient(patient)}
        submitLabel="Save Basic Info"
      />

      <DailyNoteForm patient={patient} onChange={savePatient} />

      <TaskList
        tasks={patient.tasks}
        onChange={(tasks) => savePatient({ ...patient, tasks })}
      />
    </div>
  );
}

export default PatientDetailPage;
