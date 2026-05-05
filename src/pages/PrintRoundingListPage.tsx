import { useState } from "react";
import type { Patient, PrintDensity, SortMode } from "../types";
import {
  getActiveProblemItems,
  getActiveAttendingNames,
  getActivePatients,
  getUnderlyingDiseaseItems,
  groupPatientsByAttending,
  hasUrgentPendingTask,
  sortPatients,
} from "../utils";
import { ClinicalText, CompactItemList } from "../components/ClinicalText";

interface PageProps {
  patients: Patient[];
}

function PrintRoundingListPage({ patients }: PageProps) {
  const [printMode, setPrintMode] = useState("all");
  const [admissionBriefPrintMode, setAdmissionBriefPrintMode] = useState("compact");
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
  const shouldPrintCompactList = admissionBriefPrintMode !== "briefsOnly";

  function admissionBriefPatients() {
    if (admissionBriefPrintMode === "newAdmissions") {
      return activePatients.filter((patient) => patient.isNewAdmission);
    }

    if (admissionBriefPrintMode === "selectedBriefs") {
      return activePatients.filter((patient) => patient.showAdmissionBriefOnPrint);
    }

    if (admissionBriefPrintMode === "briefsOnly") {
      return activePatients.filter((patient) => patient.isNewAdmission || patient.showAdmissionBriefOnPrint);
    }

    return [];
  }

  function taskText(patient: Patient) {
    const tasks = hideCompletedTasks ? patient.tasks.filter((task) => !task.done) : patient.tasks;

    if (tasks.length === 0) return "None";

    return tasks.map((task) => (
      <div
        key={task.id}
        className={`print-task ${task.done ? "task-done" : ""} ${
          task.text.trim().startsWith("!") || task.priority === "urgent" ? "important-line" : ""
        }`}
      >
        {task.priority === "urgent" ? "[URGENT] " : ""}
        {task.text.trim().startsWith("!") ? task.text.trim().slice(1).trim() : task.text}
        {task.dueDate ? ` (${task.dueDate})` : ""}
      </div>
    ));
  }

  function isStableForPrint(patient: Patient) {
    return (
      !hasUrgentPendingTask(patient) &&
      !patient.importantRedFlags.trim() &&
      !patient.overnightEvent.trim() &&
      !patient.subjectiveOrChiefConcern.trim() &&
      !patient.physicalExam.trim() &&
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
              <th>PMH / Problems</th>
              <th>S / PE</th>
              <th>Labs / Imaging</th>
              <th>A/P</th>
              <th>Tasks</th>
              <th>DC / Attention</th>
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
                  {patient.importantRedFlags && (
                    <div>
                      <strong>Flags:</strong> <ClinicalText value={patient.importantRedFlags} maxLines={2} />
                    </div>
                  )}
                  {!showOnlyActiveProblems && <strong>{patient.primaryDiagnosis || "-"}</strong>}
                  <div>
                    <strong>PMH:</strong> <CompactItemList items={getUnderlyingDiseaseItems(patient)} maxItems={3} />
                  </div>
                  <div>
                    <strong>Problems:</strong> <CompactItemList items={getActiveProblemItems(patient)} maxItems={4} />
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
                        <strong>S:</strong> <ClinicalText value={patient.subjectiveOrChiefConcern} maxLines={2} />
                      </div>
                      <div>
                        <strong>PE:</strong> <ClinicalText value={patient.physicalExam} maxLines={2} />
                      </div>
                    </>
                  )}
                </td>
                <td>
                  <div>
                    <strong>Lab:</strong> <ClinicalText value={patient.newLabs} maxLines={3} />
                  </div>
                  <div>
                    <strong>Img:</strong> <ClinicalText value={patient.newImaging} maxLines={3} />
                  </div>
                </td>
                <td>
                  {shouldHideDetails(patient) ? (
                    <span className="muted">See Dx/problems</span>
                  ) : (
                    <>
                      <div>
                        <strong>A:</strong> <ClinicalText value={patient.assessment} maxLines={2} />
                      </div>
                      <div>
                        <strong>P:</strong> <ClinicalText value={patient.plan} maxLines={2} />
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
                    <strong>Plan:</strong> <ClinicalText value={patient.dischargePlan} maxLines={2} />
                  </div>
                  <div>
                    <strong>Barrier:</strong> {patient.dischargeBarriers || "-"}
                  </div>
                  <div>
                    <strong>Attn:</strong> <ClinicalText value={patient.specialAttention} maxLines={2} />
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

  function renderAdmissionBrief(patient: Patient) {
    return (
      <section className="print-admission-brief" key={`brief-${patient.id}`}>
        <div className="brief-title">
          <h2>
            Admission Brief: {patient.bed || "-"} / {patient.patientCode || "-"}
          </h2>
          <p>
            {patient.age} / {patient.sex} | Attending: {patient.attending || "-"} | Team: {patient.teamOrService || "-"}
          </p>
        </div>
        <div className="brief-grid">
          <div>
            <strong>PMH</strong>
            <ClinicalText value={patient.admissionPMH || patient.underlyingDiseases} />
          </div>
          <div>
            <strong>Chief Concern</strong>
            <ClinicalText value={patient.admissionChiefConcern} />
          </div>
          <div className="span-2">
            <strong>HPI / Admission Story</strong>
            <ClinicalText value={patient.hpiOrAdmissionStory} />
          </div>
          <div>
            <strong>Baseline Function</strong>
            <ClinicalText value={patient.baselineFunction} />
          </div>
          <div>
            <strong>Initial PE</strong>
            <ClinicalText value={patient.initialPhysicalExam} />
          </div>
          <div>
            <strong>Initial Labs</strong>
            <ClinicalText value={patient.initialLabs} />
          </div>
          <div>
            <strong>Initial Imaging</strong>
            <ClinicalText value={patient.initialImaging} />
          </div>
          <div>
            <strong>Initial Assessment</strong>
            <ClinicalText value={patient.initialAssessment} />
          </div>
          <div>
            <strong>Initial Plan</strong>
            <ClinicalText value={patient.initialPlan} />
          </div>
          <div className="span-2">
            <strong>Early Hospital Course</strong>
            <ClinicalText value={patient.earlyHospitalCourse} />
          </div>
          <div className="span-2">
            <strong>Current Daily SOAP Update</strong>
            <ClinicalText
              value={[
                patient.subjectiveOrChiefConcern.trim() ? `S: ${patient.subjectiveOrChiefConcern}` : "",
                patient.physicalExam.trim() ? `PE: ${patient.physicalExam}` : "",
                patient.newLabs.trim() ? `Lab: ${patient.newLabs}` : "",
                patient.newImaging.trim() ? `Image: ${patient.newImaging}` : "",
                patient.assessment.trim() ? `A: ${patient.assessment}` : "",
                patient.plan.trim() ? `P: ${patient.plan}` : "",
              ]
                .filter(Boolean)
                .join("\n")}
            />
          </div>
          {patient.admissionBriefNotes && (
            <div className="span-2">
              <strong>Notes</strong>
              <ClinicalText value={patient.admissionBriefNotes} />
            </div>
          )}
        </div>
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
          Patient Scope
          <select value={printMode} onChange={(event) => setPrintMode(event.target.value)}>
            <option value="all">All active patients</option>
            <option value="selected">Selected attending only</option>
            <option value="separate">Separate pages by attending</option>
          </select>
        </label>

        <label>
          Print Content
          <select
            value={admissionBriefPrintMode}
            onChange={(event) => setAdmissionBriefPrintMode(event.target.value)}
          >
            <option value="compact">Compact rounding list only</option>
            <option value="newAdmissions">Rounding list + admission briefs for new admissions</option>
            <option value="selectedBriefs">Rounding list + selected admission briefs</option>
            <option value="briefsOnly">Admission briefs only</option>
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

      {shouldPrintCompactList &&
        (printMode === "separate"
          ? Object.entries(groupedPatients).map(([sectionAttending, sectionPatients], index) =>
              renderPrintSection(sortPatients(sectionPatients, sortMode), sectionAttending, index > 0),
            )
          : renderPrintSection(
              activePatients,
              printMode === "selected" ? selectedAttending : attending,
            ))}

      {admissionBriefPatients().map(renderAdmissionBrief)}
    </div>
  );
}

export default PrintRoundingListPage;
