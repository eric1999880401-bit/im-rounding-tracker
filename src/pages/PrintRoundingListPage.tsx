import { useState } from "react";
import type { ReactNode } from "react";
import type { DailyNotesByPatient, MiscTask, Patient, PhonebookContact, PrintDensity, SortMode, StudyTopic } from "../types";
import {
  getActiveProblemItems,
  getActiveAttendingNames,
  getActivePatients,
  getPatientDisplaySummary,
  getUnderlyingDiseaseItems,
  groupPatientsByAttending,
  dischargePrepText,
  formatDateLabel,
  plainClinicalText,
  sortPatients,
} from "../utils";
import { ClinicalText } from "../components/ClinicalText";
import { LabChips } from "../components/LabChips";
import AssessmentPlanDisplay from "../components/AssessmentPlanDisplay";
import ActiveProblemDisplay from "../components/ActiveProblemDisplay";
import { useT } from "../i18n";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  phonebook?: PhonebookContact[];
  miscTasks?: MiscTask[];
  studyTopics?: StudyTopic[];
}

function PrintRoundingListPage({
  patients,
  dailyNotesByPatient = {},
  phonebook = [],
  miscTasks = [],
  studyTopics = [],
}: PageProps) {
  const t = useT();
  const [printMode, setPrintMode] = useState("all");
  const [admissionBriefPrintMode, setAdmissionBriefPrintMode] = useState("newAdmissions");
  const [selectedAttending, setSelectedAttending] = useState("");
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [density, setDensity] = useState<PrintDensity>("compact");
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const [team, setTeam] = useState("Team A");
  const [attending, setAttending] = useState("");
  const [resident, setResident] = useState("");
  const [includePhonebook, setIncludePhonebook] = useState(true);
  const [includeMiscTasks, setIncludeMiscTasks] = useState(true);
  const [includeStudyTopics, setIncludeStudyTopics] = useState(true);
  const attendingNames = getActiveAttendingNames(patients);
  const filteredActivePatients = getActivePatients(patients)
    .map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient)
    .filter((patient) => printMode !== "selected" || patient.attending.trim() === selectedAttending);
  const activePatients = sortPatients(filteredActivePatients, sortMode);
  const groupedPatients = groupPatientsByAttending(activePatients);
  const todayText = new Date().toLocaleDateString();
  const shouldPrintCompactList = admissionBriefPrintMode !== "briefsOnly";
  const unfinishedMiscTasks = includeMiscTasks ? miscTasks.filter((task) => !task.done) : [];
  const openStudyTopics = includeStudyTopics ? studyTopics.filter((topic) => !topic.done) : [];
  const printContacts = includePhonebook ? [...phonebook].sort((a, b) => Number(b.isImportant) - Number(a.isImportant)) : [];

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

  const selectedAdmissionBriefCandidates = admissionBriefPatients();
  const selectedAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter(hasMeaningfulAdmissionBrief);
  const emptyAdmissionBriefPatients = selectedAdmissionBriefCandidates.filter((patient) => !hasMeaningfulAdmissionBrief(patient));

  function hasMeaningfulAdmissionBrief(patient: Patient) {
    return Boolean(
      (patient.chiefComplaint || patient.admissionChiefConcern).trim() ||
        (patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory).trim() ||
        patient.admissionBriefFreeText.trim(),
    );
  }

  function compactText(value: string) {
    const text = plainClinicalText(value, "");
    return text === "-" ? "" : text;
  }

  function inlineList(items: string[]) {
    return items.map((item) => item.trim()).filter(Boolean).join("; ");
  }

  function labReportGroups(patient: Patient) {
    const reportsWithItems = patient.labReports.filter((report) => report.items.length > 0);
    const reports = reportsWithItems.length > 0 ? reportsWithItems : [{ id: "legacy", date: patient.labDate, title: "", rawText: "", items: patient.parsedLabItems }];

    return reports
      .filter((report) => report.items.length > 0)
      .map((report) => ({ ...report, date: formatDateLabel(report.date || patient.labDate) }));
  }

  function labReportChips(patient: Patient) {
    const labGroups = labReportGroups(patient);
    if (labGroups.length === 0) return null;

    return (
      <div className="print-lab-groups">
        {labGroups.map((report) => (
          <div className="print-lab-group" key={report.id}>
            <span className="print-lab-date">{report.date}</span>
            <LabChips items={report.items} />
          </div>
        ))}
      </div>
    );
  }

  function imageLines(patient: Patient) {
    const structured = patient.imageStudyEntries
      .filter((entry) => entry.impression.trim() || entry.finding.trim() || entry.studyType.trim())
      .map((entry) => [entry.date, entry.studyType, entry.impression || entry.finding || entry.note].filter(Boolean).join(" "));
    return [compactText(patient.newImaging), ...structured].filter(Boolean);
  }

  function peSummaryText(patient: Patient) {
    const structured = patient.physicalExamEntries
      .filter((entry) => entry.finding.trim() || entry.system.trim())
      .map((entry) => [entry.system, entry.finding || entry.note].filter(Boolean).join(" "));
    return inlineList([compactText(patient.physicalExam), ...structured]);
  }

  function taskSummaryText(patient: Patient) {
    const tasks = hideCompletedTasks ? patient.tasks.filter((task) => !task.done) : patient.tasks;
    return tasks
      .map((task) => `${task.priority === "urgent" ? "[URGENT] " : ""}${task.text.trim().startsWith("!") ? task.text.trim().slice(1).trim() : task.text}${task.dueDate ? ` (${task.dueDate})` : ""}`)
      .filter(Boolean)
      .join("; ");
  }

  function fieldLine(label: string, value: ReactNode) {
    if (typeof value === "string" && !value.trim()) return null;
    return (
      <div className="print-field-line">
        <strong>{label}:</strong> {value}
      </div>
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
          <h1>{t("print.title")}</h1>
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
          {(unfinishedMiscTasks.length > 0 || openStudyTopics.length > 0 || printContacts.length > 0) && (
            <div className="print-general-notes">
              <strong>{t("print.generalNotes")}</strong>
              {printContacts.length > 0 && <span>{t("print.phonebook")}: {printContacts.map((contact) => `${contact.name || contact.roleOrUnit} ${contact.phone}`).join("; ")}</span>}
              {unfinishedMiscTasks.length > 0 && <span>{t("print.miscTasks")}: {unfinishedMiscTasks.map((task) => task.text).join("; ")}</span>}
              {openStudyTopics.length > 0 && <span>{t("print.studyTopics")}: {openStudyTopics.map((topic) => topic.topic).join("; ")}</span>}
            </div>
          )}
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
            {sectionPatients.map((patient) => {
              const images = imageLines(patient);
              return (
                <tr className="patient-print-row" key={patient.id}>
                  <td className="print-bed">{patient.bed}</td>
                  <td>
                    <strong>{patient.patientCode}</strong>
                    <br />
                    {patient.age}/{patient.sex}
                    {patient.attending && <div>Att: {patient.attending}</div>}
                  </td>
                  <td>
                    {patient.importantRedFlags.trim() && (
                      <div className="print-red-flags">
                        <strong>Red Flags:</strong> {compactText(patient.importantRedFlags)}
                      </div>
                    )}
                    {fieldLine("Dx", patient.primaryDiagnosis)}
                    {fieldLine("PMH", getUnderlyingDiseaseItems(patient).join(", "))}
                    {getActiveProblemItems(patient).length > 0 && (
                      <div className="print-field-line">
                        <strong>Problems:</strong>{" "}
                        <ActiveProblemDisplay
                          items={patient.activeProblemStructuredItems}
                          fallbackItems={getActiveProblemItems(patient)}
                        />
                      </div>
                    )}
                  </td>
                  <td>
                    {fieldLine("S", compactText(patient.subjectiveOrChiefConcern))}
                    {fieldLine("PE", peSummaryText(patient))}
                  </td>
                  <td>
                    {labReportChips(patient)}
                    {images.length > 0 && fieldLine("Img", images.join("; "))}
                  </td>
                  <td>
                    <AssessmentPlanDisplay
                      items={patient.assessmentPlanItems}
                      legacyAssessment={patient.assessment}
                      legacyPlan={patient.plan}
                    />
                  </td>
                  <td>{taskSummaryText(patient)}</td>
                  <td>
                    {fieldLine("DC", patient.dischargeTargetDate)}
                    {fieldLine("Plan", compactText(patient.dischargePlan))}
                    {fieldLine("Barrier", patient.dischargeBarriers)}
                    <div className="print-field-line">
                      <strong>DC prep:</strong> {dischargePrepText(patient)}
                    </div>
                    {fieldLine("VS", compactText(patient.vsOrder))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }

  function renderAdmissionBrief(patient: Patient) {
    const chiefComplaint = patient.chiefComplaint || patient.admissionChiefConcern;
    const hpi = patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory;
    const summary = patient.admissionBriefFreeText.trim() || [chiefComplaint, hpi].filter(Boolean).join("\n");
    const keyLabs = patient.rawLabText || patient.newLabs || patient.initialLabs;
    const keyImages = patient.newImaging || patient.initialImaging;

    return (
      <section className="print-admission-brief" key={`brief-${patient.id}`}>
        <div className="brief-title">
          <h2>
            Admission Note Summary: {patient.bed || "-"} / {patient.patientCode || "-"}
          </h2>
          <p>
            {patient.age} / {patient.sex} | Attending: {patient.attending || "-"} | Team: {patient.teamOrService || "-"}
          </p>
        </div>
        <div className="brief-grid">
          <div className="span-2">
            <strong>Chief Concern</strong>
            <ClinicalText value={chiefComplaint} />
          </div>
          <div className="span-2">
            <strong>PI / HPI</strong>
            <ClinicalText value={hpi} />
          </div>
          <div className="span-2">
            <strong>Admission Note Summary</strong>
            <ClinicalText value={summary} />
          </div>
          <div>
            <strong>Key PMH</strong>
            <ClinicalText value={patient.admissionPMH || patient.underlyingDiseases} />
          </div>
          <div>
            <strong>Key Labs / Images</strong>
            <ClinicalText value={[keyLabs ? `Lab: ${keyLabs}` : "", keyImages ? `Image: ${keyImages}` : ""].filter(Boolean).join("\n")} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={`page print-page density-${density}`}>
      <header className="page-header no-print">
        <div>
          <h2>{t("print.title")}</h2>
        </div>
        <button type="button" onClick={() => window.print()}>
          {t("print.print")}
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

        <label>
          Density
          <select value={density} onChange={(event) => setDensity(event.target.value as PrintDensity)}>
            <option value="normal">Detailed</option>
            <option value="compact">Compact</option>
            <option value="ultra-compact">Ultra-compact</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includePhonebook} onChange={(event) => setIncludePhonebook(event.target.checked)} />
          Include phonebook
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeMiscTasks} onChange={(event) => setIncludeMiscTasks(event.target.checked)} />
          Include misc tasks
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={includeStudyTopics} onChange={(event) => setIncludeStudyTopics(event.target.checked)} />
          Include study topics
        </label>
        <p className="muted span-2">
          Compact mode preserves details using tighter layout. If the census or notes are long, the printout may continue to a second page.
        </p>
      </section>

      {admissionBriefPrintMode !== "compact" && (
        <section className="panel no-print">
          <h3>Admission Brief Print Preview</h3>
          {selectedAdmissionBriefPatients.length === 0 ? (
            <p className="muted">
              No admission briefs selected for print.
              {emptyAdmissionBriefPatients.length > 0 && " Admission summary is empty and will not be printed."}
            </p>
          ) : (
            <p>
              Admission briefs to be printed:{" "}
              {selectedAdmissionBriefPatients
                .map((patient) => `Bed ${patient.bed || "-"} / Patient code ${patient.patientCode || "-"}`)
                .join(", ")}
              {emptyAdmissionBriefPatients.length > 0 && " Some selected admission summaries are empty and will not be printed."}
            </p>
          )}
        </section>
      )}

      {shouldPrintCompactList &&
        (printMode === "separate"
          ? Object.entries(groupedPatients).map(([sectionAttending, sectionPatients], index) =>
              renderPrintSection(sortPatients(sectionPatients, sortMode), sectionAttending, index > 0),
            )
          : renderPrintSection(
              activePatients,
              printMode === "selected" ? selectedAttending : attending,
            ))}

      {selectedAdmissionBriefPatients.length > 0 && (
        <section className="print-briefs-heading">
          <h1>Section 2: Admission Briefs for New Patients</h1>
          <p>Use de-identified data only.</p>
        </section>
      )}
      {selectedAdmissionBriefPatients.map(renderAdmissionBrief)}
    </div>
  );
}

export default PrintRoundingListPage;
