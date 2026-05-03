import { useState } from "react";
import type { Patient, PrintDensity, SortMode } from "../types";
import {
  getActiveAttendingNames,
  getActivePatients,
  groupPatientsByAttending,
  hasUrgentPendingTask,
  sortPatients,
} from "../utils";

interface PageProps {
  patients: Patient[];
}

function PrintRoundingListPage({ patients }: PageProps) {
  const [printMode, setPrintMode] = useState("all");
  const [selectedAttending, setSelectedAttending] = useState("");
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [hideStableDetails, setHideStableDetails] = useState(false);
  const [showOnlyActiveProblems, setShowOnlyActiveProblems] = useState(false);
  const [density, setDensity] = useState<PrintDensity>("compact");
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const [team, setTeam] = useState("Team A");
  const [attending, setAttending] = useState("");
  const [resident, setResident] = useState("");
  const attendingNames = getActiveAttendingNames(patients);
  const filteredActivePatients = getActivePatients(patients).filter(
    (patient) => printMode !== "selected" || patient.attending.trim() === selectedAttending,
  );
  const activePatients = sortPatients(filteredActivePatients, sortMode);
  const groupedPatients = groupPatientsByAttending(activePatients);
  const todayText = new Date().toLocaleDateString();

  function taskText(patient: Patient) {
    const tasks = hideCompletedTasks ? patient.tasks.filter((task) => !task.done) : patient.tasks;

    if (tasks.length === 0) return "None";

    return tasks.map((task) => (
      <div key={task.id} className={`print-task ${task.done ? "task-done" : ""}`}>
        {task.priority === "urgent" ? "[URGENT] " : ""}
        {task.text}
        {task.dueDate ? ` (${task.dueDate})` : ""}
      </div>
    ));
  }

  function isStableForPrint(patient: Patient) {
    return (
      !hasUrgentPendingTask(patient) &&
      !patient.overnightEvent.trim() &&
      !patient.newLabs.trim() &&
      !patient.newImaging.trim()
      );
  }

  function renderPrintSection(sectionPatients: Patient[], sectionAttending: string, startNewPage = false) {
    return (
      <section
        className={`print-sheet ${startNewPage ? "print-attending-section" : ""}`}
        aria-label={`Printable rounding list for ${sectionAttending}`}
        key={sectionAttending}
      >
        <div className="print-title">
          <h1>Internal Medicine Rounding List</h1>
          <div className="print-meta-grid">
            <span>
              <strong>Date:</strong> {todayText}
            </span>
            <span>
              <strong>Team:</strong> {team || "________"}
            </span>
            <span>
              <strong>Attending:</strong> {sectionAttending || attending || "________"}
            </span>
            <span>
              <strong>Resident:</strong> {resident || "________"}
            </span>
            <span>
              <strong>Total active:</strong> {sectionPatients.length}
            </span>
          </div>
          <p>Use de-identified data only.</p>
        </div>

        <table className="rounding-table">
          <thead>
            <tr>
              <th>Bed</th>
              <th>Pt</th>
              <th>Dx / Problems</th>
              <th>Sx / New Data</th>
              <th>A/P</th>
              <th>To-do</th>
              <th>DC Plan</th>
              <th>Attention / VS</th>
            </tr>
          </thead>
          <tbody>
            {sectionPatients.map((patient) => (
              <tr className="patient-print-row" key={patient.id}>
                <td className="print-bed">{patient.bed}</td>
                <td>
                  <strong>{patient.patientCode}</strong>
                  <br />
                  {patient.age} / {patient.sex}
                </td>
                <td>
                  {!showOnlyActiveProblems && <strong>{patient.primaryDiagnosis}</strong>}
                  <div>{patient.activeProblems || "-"}</div>
                  <div>
                    <strong>PMH:</strong> {patient.underlyingDiseases || "-"}
                  </div>
                  {printMode === "all" && (
                    <div>
                      <strong>Att:</strong> {patient.attending || "-"}
                    </div>
                  )}
                </td>
                <td>
                  {shouldHideDetails(patient) ? (
                    <span className="muted">Stable; no new data</span>
                  ) : (
                    <>
                      <div>
                        <strong>Sx:</strong> {patient.subjectiveOrChiefConcern || "-"}
                      </div>
                      <div>
                        <strong>ON:</strong> {patient.overnightEvent || "-"}
                      </div>
                      <div>
                        <strong>Lab:</strong> {patient.newLabs || "-"}
                      </div>
                      <div>
                        <strong>Img:</strong> {patient.newImaging || "-"}
                      </div>
                    </>
                  )}
                </td>
                <td>
                  {shouldHideDetails(patient) ? (
                    <span className="muted">See Dx/problems</span>
                  ) : (
                    <>
                      <div>
                        <strong>A:</strong> {patient.assessment || "-"}
                      </div>
                      <div>
                        <strong>P:</strong> {patient.plan || "-"}
                      </div>
                    </>
                  )}
                </td>
                <td>{taskText(patient)}</td>
                <td>
                  <div>
                    <strong>Target:</strong> {patient.dischargeTargetDate || "TBD"}
                  </div>
                  <div>
                    <strong>Plan:</strong> {patient.dischargePlan || "-"}
                  </div>
                  <div>
                    <strong>Barrier:</strong> {patient.dischargeBarriers || "-"}
                  </div>
                </td>
                <td>
                  <div>
                    <strong>Attn:</strong> {patient.specialAttention || "-"}
                  </div>
                  <div>
                    <strong>VS:</strong> {patient.vsOrder || "-"}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  function shouldHideDetails(patient: Patient) {
    return hideStableDetails && isStableForPrint(patient);
  }

  return (
    <div className={`page print-page density-${density}`}>
      <header className="page-header no-print">
        <div>
          <h2>Print Rounding List</h2>
          <p className="privacy-warning">Use de-identified data only.</p>
        </div>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </header>

      <section className="panel no-print print-options">
        <label>
          Print Mode
          <select value={printMode} onChange={(event) => setPrintMode(event.target.value)}>
            <option value="all">All active patients</option>
            <option value="selected">Selected attending only</option>
            <option value="separate">Separate pages by attending</option>
          </select>
        </label>

        {printMode === "selected" && (
          <label>
            Selected Attending
            <select value={selectedAttending} onChange={(event) => setSelectedAttending(event.target.value)}>
              <option value="">Choose attending</option>
              {attendingNames.map((attendingName) => (
                <option key={attendingName} value={attendingName}>
                  {attendingName}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Team
          <input value={team} onChange={(event) => setTeam(event.target.value)} />
        </label>

        <label>
          Attending
          <input value={attending} onChange={(event) => setAttending(event.target.value)} />
        </label>

        <label>
          Resident
          <input value={resident} onChange={(event) => setResident(event.target.value)} />
        </label>

        <label>
          Sort
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="bed">By bed</option>
            <option value="dischargeDate">By discharge target date</option>
            <option value="urgentFirst">Urgent tasks first</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideCompletedTasks}
            onChange={(event) => setHideCompletedTasks(event.target.checked)}
          />
          Hide completed tasks
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideStableDetails}
            onChange={(event) => setHideStableDetails(event.target.checked)}
          />
          Hide stable patients' detailed notes
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showOnlyActiveProblems}
            onChange={(event) => setShowOnlyActiveProblems(event.target.checked)}
          />
          Show only active problems
        </label>

        <label>
          Density
          <select value={density} onChange={(event) => setDensity(event.target.value as PrintDensity)}>
            <option value="normal">Normal</option>
            <option value="compact">Compact</option>
            <option value="ultra-compact">Ultra-compact</option>
          </select>
        </label>
      </section>

      {printMode === "separate"
        ? Object.entries(groupedPatients).map(([sectionAttending, sectionPatients], index) =>
            renderPrintSection(sortPatients(sectionPatients, sortMode), sectionAttending, index > 0),
          )
        : renderPrintSection(
            activePatients,
            printMode === "selected" ? selectedAttending : attending,
          )}
    </div>
  );
}

export default PrintRoundingListPage;
