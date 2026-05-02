import { Link } from "react-router-dom";
import { useState } from "react";
import type { Patient, SortMode } from "../types";
import {
  createTodayFromYesterday,
  emptyPatient,
  getActivePatients,
  hasUrgentPendingTask,
  nowIso,
  sortPatients,
} from "../utils";
import PatientForm from "../components/PatientForm";

interface PageProps {
  patients: Patient[];
  dataLoading: boolean;
  dataError: string;
  onCreatePatient: (patient: Patient) => Promise<void>;
  onSavePatient: (patient: Patient) => Promise<void>;
}

function PatientBoardPage({
  patients,
  dataLoading,
  dataError,
  onCreatePatient,
  onSavePatient,
}: PageProps) {
  const [showForm, setShowForm] = useState(false);
  const [draftPatient, setDraftPatient] = useState<Patient>(emptyPatient());
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const activePatients = sortPatients(getActivePatients(patients), sortMode);

  async function addPatient() {
    const now = nowIso();
    await onCreatePatient({ ...draftPatient, createdAt: now, updatedAt: now, status: "active" });
    setDraftPatient(emptyPatient());
    setShowForm(false);
  }

  async function updateStatus(patientId: string, status: Patient["status"]) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({ ...patient, status, updatedAt: nowIso() });
  }

  async function startToday(patientId: string) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient(createTodayFromYesterday(patient));
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Patient Board</h2>
          <p className="privacy-warning">Use de-identified data only.</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)}>
          Add Patient
        </button>
      </header>

      {showForm && (
        <PatientForm
          patient={draftPatient}
          onChange={setDraftPatient}
          onSubmit={addPatient}
          submitLabel="Create Patient"
          onCancel={() => setShowForm(false)}
        />
      )}

      <section className="panel">
        <div className="section-heading">
          <h3>Active Patients</h3>
          <label>
            Sort
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="bed">By bed</option>
              <option value="dischargeDate">By discharge target date</option>
              <option value="urgentFirst">Urgent tasks first</option>
            </select>
          </label>
        </div>
        {dataLoading && <p className="muted">Loading synced patients...</p>}
        {dataError && <p className="error-message">{dataError}</p>}
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Bed</th>
                <th>Code</th>
                <th>Age/Sex</th>
                <th>Concise Summary</th>
                <th>New Data</th>
                <th>Tasks</th>
                <th>DC Target</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activePatients.map((patient) => (
                <tr key={patient.id}>
                  <td>{patient.bed}</td>
                  <td>{patient.patientCode}</td>
                  <td>
                    {patient.age}/{patient.sex}
                  </td>
                  <td>
                    <strong>{patient.primaryDiagnosis}</strong>
                    <div className="muted">{patient.activeProblems}</div>
                  </td>
                  <td>
                    <div>{patient.overnightEvent || "No overnight update"}</div>
                    <div className="muted">
                      Labs: {patient.newLabs || "-"} | Img: {patient.newImaging || "-"}
                    </div>
                  </td>
                  <td>
                    {hasUrgentPendingTask(patient) && <span className="badge urgent">urgent</span>}{" "}
                    {patient.tasks.filter((task) => !task.done).length} pending
                  </td>
                  <td>{patient.dischargeTargetDate || "TBD"}</td>
                  <td className="table-actions">
                    <Link className="button-link" to={`/patients/${patient.id}`}>
                      Details
                    </Link>
                    <button type="button" className="secondary" onClick={() => startToday(patient.id)}>
                      Create today
                    </button>
                    <button type="button" onClick={() => updateStatus(patient.id, "discharged")}>
                      Discharge
                    </button>
                    <button type="button" className="secondary" onClick={() => updateStatus(patient.id, "archived")}>
                      Archive
                    </button>
                  </td>
                </tr>
              ))}
              {activePatients.length === 0 && (
                <tr>
                  <td colSpan={8}>No active patients.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default PatientBoardPage;
