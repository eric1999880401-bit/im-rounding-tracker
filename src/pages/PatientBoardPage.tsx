import { Link } from "react-router-dom";
import { useState } from "react";
import type { DailyNotesByPatient, Patient, SortMode } from "../types";
import {
  createTodayFromYesterday,
  emptyPatient,
  getActiveProblemItems,
  getActiveAttendingNames,
  getActivePatients,
  getPatientDisplaySummary,
  getUnderlyingDiseaseItems,
  hasUpcomingDischarge,
  importantLines,
  nowIso,
  pendingDischargePrep,
  sortPatients,
} from "../utils";
import PatientForm from "../components/PatientForm";
import { ClinicalText, CompactItemList } from "../components/ClinicalText";
import { LabChips } from "../components/LabChips";
import AssessmentPlanDisplay from "../components/AssessmentPlanDisplay";
import ActiveProblemDisplay from "../components/ActiveProblemDisplay";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  dataLoading: boolean;
  dataError: string;
  onCreatePatient: (patient: Patient) => Promise<void>;
  onSavePatient: (patient: Patient) => Promise<void>;
}

function PatientBoardPage({
  patients,
  dailyNotesByPatient = {},
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
    ).map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient),
    sortMode,
  );
  const dischargeAlerts = activePatients
    .map((patient) => ({ patient, pending: pendingDischargePrep(patient) }))
    .filter(({ patient, pending }) => hasUpcomingDischarge(patient) && pending.length > 0);

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

  async function setNewAdmission(patientId: string, isNewAdmission: boolean) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({
      ...patient,
      isNewAdmission,
      showAdmissionBriefOnPrint: isNewAdmission ? true : patient.showAdmissionBriefOnPrint,
      updatedAt: nowIso(),
    });
  }

  async function setAdmissionBriefPrint(patientId: string, showAdmissionBriefOnPrint: boolean) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({
      ...patient,
      showAdmissionBriefOnPrint,
      updatedAt: nowIso(),
    });
  }

  function importantSummary(patient: Patient) {
    const important = [
      ...importantLines(patient.importantRedFlags),
      ...importantLines(patient.subjectiveOrChiefConcern),
      ...importantLines(patient.physicalExam),
      ...importantLines(patient.newLabs),
      ...importantLines(patient.newImaging),
      ...patient.assessmentPlanItems.filter((item) => item.isImportant).map((item) => ({
        text: item.problemTitle || item.assessmentSummary,
        important: true,
      })),
      ...importantLines(patient.assessment),
      ...importantLines(patient.plan),
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

  function dischargeReminder(patient: Patient) {
    const pending = pendingDischargePrep(patient);
    if (!hasUpcomingDischarge(patient) || pending.length === 0) return "";
    return `DC prep pending: ${pending.join(" / ")}`;
  }

  function structuredPeSummary(patient: Patient) {
    return patient.physicalExamEntries
      .filter((entry) => entry.finding.trim() || entry.system.trim())
      .slice(0, 3)
      .map((entry) => (
        <span className={`objective-chip ${entry.isImportant ? "important-objective-chip" : ""}`} key={entry.id}>
          {entry.system && <span className="objective-chip-label">{entry.system}</span>}
          {entry.finding || entry.note}
        </span>
      ));
  }

  function structuredImageSummary(patient: Patient) {
    return patient.imageStudyEntries
      .filter((entry) => entry.impression.trim() || entry.finding.trim() || entry.studyType.trim())
      .slice(0, 3)
      .map((entry) => (
        <span className={`objective-chip ${entry.isImportant ? "important-objective-chip" : ""}`} key={entry.id}>
          {entry.studyType && <span className="objective-chip-label">{entry.studyType}</span>}
          {entry.impression || entry.finding || entry.note}
        </span>
      ));
  }

  async function updateDischargePrep(
    patient: Patient,
    field: "dischargeMedsStatus" | "opdAppointmentStatus" | "diagnosisCertificateStatus",
    status: Patient[typeof field],
  ) {
    await onSavePatient({ ...patient, [field]: status, updatedAt: nowIso() });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Patient Board</h2>
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

      {dischargeAlerts.length > 0 && (
        <section className="dc-alert-panel">
          <h3>Upcoming Discharge Prep</h3>
          {dischargeAlerts.map(({ patient, pending }) => (
            <div className="dc-alert-card" key={patient.id}>
              <div>
                <strong>
                  Bed {patient.bed || "-"} — {patient.patientCode || "-"}
                </strong>
                <div>Upcoming discharge prep: {pending.join(" / ")} pending</div>
              </div>
              <div className="dc-alert-actions">
                {patient.dischargeMedsStatus === "pending" && (
                  <>
                    <button type="button" onClick={() => updateDischargePrep(patient, "dischargeMedsStatus", "done")}>
                      Mark meds done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "dischargeMedsStatus", "notNeeded")}
                    >
                      Meds N/A
                    </button>
                  </>
                )}
                {patient.opdAppointmentStatus === "pending" && (
                  <>
                    <button type="button" onClick={() => updateDischargePrep(patient, "opdAppointmentStatus", "done")}>
                      Mark OPD done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "opdAppointmentStatus", "notNeeded")}
                    >
                      OPD N/A
                    </button>
                  </>
                )}
                {patient.diagnosisCertificateStatus === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateDischargePrep(patient, "diagnosisCertificateStatus", "done")}
                    >
                      Mark certificate done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "diagnosisCertificateStatus", "notNeeded")}
                    >
                      Cert N/A
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
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
                    {patient.importantRedFlags.trim() && (
                      <div className="board-red-flags">
                        <span className="board-label">Red Flags</span>
                        <ClinicalText value={patient.importantRedFlags} maxLines={3} importantDefault />
                      </div>
                    )}
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
                      <ActiveProblemDisplay
                        items={patient.activeProblemStructuredItems}
                        fallbackItems={getActiveProblemItems(patient)}
                      />
                    </div>
                    <div className="muted">Attending: {patient.attending || "Unassigned"}</div>
                  </td>
                  <td>
                    <div>
                      <span className="board-label">Sx</span>{" "}
                      <ClinicalText value={patient.subjectiveOrChiefConcern} maxLines={2} />
                    </div>
                    {(patient.physicalExam.trim() ||
                      importantLines(patient.physicalExam).length > 0 ||
                      patient.physicalExamEntries.length > 0) && (
                      <div>
                        <span className="board-label">PE</span>{" "}
                        <ClinicalText value={patient.physicalExam} maxLines={2} />
                        <div className="objective-chip-row">{structuredPeSummary(patient)}</div>
                      </div>
                    )}
                    <div>
                      <span className="board-label">Lab/Image</span>{" "}
                      <LabChips items={patient.parsedLabItems} />
                      <ClinicalText value={patient.newImaging} maxLines={1} />
                      <div className="objective-chip-row">{structuredImageSummary(patient)}</div>
                    </div>
                    <div>
                      <span className="board-label">A/P</span>{" "}
                      <AssessmentPlanDisplay
                        items={patient.assessmentPlanItems}
                        legacyAssessment={patient.assessment}
                        legacyPlan={patient.plan}
                        compact
                      />
                    </div>
                  </td>
                  <td>
                    {taskSummary(patient)}
                  </td>
                  <td>
                    <div>{patient.dischargeTargetDate || "TBD"}</div>
                    {dischargeReminder(patient) && <div className="important-line">{dischargeReminder(patient)}</div>}
                  </td>
                  <td className="table-actions">
                    <div className="board-action-buttons">
                      <Link className="button-link" to={`/patients/${patient.id}`}>
                        Details
                      </Link>
                      <button type="button" className="secondary" onClick={() => startToday(patient.id)}>
                        Create today
                      </button>
                      <button type="button" className="secondary" onClick={() => setNewAdmission(patient.id, !patient.isNewAdmission)}>
                        {patient.isNewAdmission ? "Unmark new" : "Mark new"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setAdmissionBriefPrint(patient.id, !patient.showAdmissionBriefOnPrint)}
                      >
                        {patient.showAdmissionBriefOnPrint ? "Exclude brief" : "Include brief"}
                      </button>
                      <button type="button" onClick={() => updateStatus(patient.id, "discharged")}>
                        Discharge
                      </button>
                      <button type="button" className="secondary" onClick={() => updateStatus(patient.id, "archived")}>
                        Archive
                      </button>
                    </div>
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
