import { Link } from "react-router-dom";
import { useState } from "react";
import type { Patient, SortMode } from "../types";
import {
  createTodayFromYesterday,
  emptyPatient,
  getActiveProblemItems,
  getActiveAttendingNames,
  getActivePatients,
  getUnderlyingDiseaseItems,
  importantLines,
  nowIso,
  sortPatients,
} from "../utils";
import PatientForm from "../components/PatientForm";
import { ClinicalText, CompactItemList } from "../components/ClinicalText";

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
  const [attendingFilter, setAttendingFilter] = useState("all");
  const attendingNames = getActiveAttendingNames(patients);
  const activePatients = sortPatients(
    getActivePatients(patients).filter(
      (patient) => attendingFilter === "all" || patient.attending.trim() === attendingFilter,
    ),
    sortMode,
  );

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

  async function togglePatientFlag(patientId: string, field: "isNewAdmission" | "showAdmissionBriefOnPrint") {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({ ...patient, [field]: !patient[field], updatedAt: nowIso() });
  }

  function importantSummary(patient: Patient) {
    const important = [
      ...importantLines(patient.importantRedFlags),
      ...importantLines(patient.subjectiveOrChiefConcern),
      ...importantLines(patient.physicalExam),
      ...importantLines(patient.newLabs),
      ...importantLines(patient.newImaging),
      ...importantLines(patient.assessment),
      ...importantLines(patient.plan),
      ...importantLines(patient.specialAttention),
    ];

    return important.slice(0, 4).map((line) => line.text).join("; ");
  }

  function taskSummary(patient: Patient) {
    const pendingTasks = patient.tasks.filter((task) => !task.done);
    const urgentTasks = pendingTasks.filter(
      (task) => task.priority === "urgent" || task.text.trim().startsWith("!"),
    );
    const visibleTasks = [...urgentTasks, ...pendingTasks.filter((task) => !urgentTasks.includes(task))].slice(0, 3);

    return (
      <div>
        {urgentTasks.length > 0 && <span className="badge urgent">{urgentTasks.length} urgent</span>}{" "}
        <span>{pendingTasks.length} pending</span>
        {visibleTasks.map((task) => (
          <div
            className={task.priority === "urgent" || task.text.trim().startsWith("!") ? "important-line" : "muted"}
            key={task.id}
          >
            {task.text.trim().startsWith("!") ? task.text.trim().slice(1).trim() : task.text}
          </div>
        ))}
      </div>
    );
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
          <div className="filter-row">
            <label>
              Attending
              <select value={attendingFilter} onChange={(event) => setAttendingFilter(event.target.value)}>
                <option value="all">All attendings</option>
                {attendingNames.map((attendingName) => (
                  <option key={attendingName} value={attendingName}>
                    {attendingName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="bed">By bed</option>
                <option value="dischargeDate">By discharge target date</option>
                <option value="urgentFirst">Urgent tasks first</option>
              </select>
            </label>
          </div>
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
                    {patient.isNewAdmission && <span className="badge urgent">New admission</span>}{" "}
                    {patient.showAdmissionBriefOnPrint && <span className="badge normal">Brief included</span>}
                    {importantSummary(patient) && (
                      <div className="important-line">Important: {importantSummary(patient)}</div>
                    )}
                    <strong>{patient.primaryDiagnosis || "-"}</strong>
                    <div className="board-subsection">
                      <span className="board-label">PMH</span>
                      <CompactItemList items={getUnderlyingDiseaseItems(patient)} />
                    </div>
                    <div className="board-subsection">
                      <span className="board-label">Problems</span>
                      <CompactItemList items={getActiveProblemItems(patient)} />
                    </div>
                    <div className="muted">Attending: {patient.attending || "Unassigned"}</div>
                  </td>
                  <td>
                    <div>
                      <span className="board-label">Sx</span>{" "}
                      <ClinicalText value={patient.subjectiveOrChiefConcern} maxLines={2} />
                    </div>
                    {(patient.physicalExam.trim() || importantLines(patient.physicalExam).length > 0) && (
                      <div>
                        <span className="board-label">PE</span>{" "}
                        <ClinicalText value={patient.physicalExam} maxLines={2} />
                      </div>
                    )}
                    <div>
                      <span className="board-label">Lab/Image</span>{" "}
                      <ClinicalText value={patient.newLabs} maxLines={1} /> /{" "}
                      <ClinicalText value={patient.newImaging} maxLines={1} />
                    </div>
                    <div>
                      <span className="board-label">A/P</span>{" "}
                      <ClinicalText value={patient.assessment} maxLines={1} /> /{" "}
                      <ClinicalText value={patient.plan} maxLines={1} />
                    </div>
                  </td>
                  <td>
                    {taskSummary(patient)}
                  </td>
                  <td>{patient.dischargeTargetDate || "TBD"}</td>
                  <td className="table-actions">
                    <Link className="button-link" to={`/patients/${patient.id}`}>
                      Details
                    </Link>
                    <button type="button" className="secondary" onClick={() => startToday(patient.id)}>
                      Create today
                    </button>
                    <button type="button" className="secondary" onClick={() => togglePatientFlag(patient.id, "isNewAdmission")}>
                      {patient.isNewAdmission ? "Unmark new" : "Mark new"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => togglePatientFlag(patient.id, "showAdmissionBriefOnPrint")}
                    >
                      {patient.showAdmissionBriefOnPrint ? "Exclude brief" : "Include brief"}
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
