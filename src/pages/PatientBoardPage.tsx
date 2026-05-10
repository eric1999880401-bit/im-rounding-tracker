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
import {
  IconArchive,
  IconBrief,
  IconCreateToday,
  IconDetails,
  IconDischarge,
  IconStar,
} from "../components/icons";
import { useT } from "../i18n";

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
  const t = useT();
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
          <h2>{t("nav.patientBoard")}</h2>
        </div>
        <button type="button" onClick={() => setShowForm(true)}>
          {t("action.addPatient")}
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
          <h3>{t("dc.upcoming")}</h3>
          {dischargeAlerts.map(({ patient, pending }) => (
            <div className="dc-alert-card" key={patient.id}>
              <div>
                <strong>
                  Bed {patient.bed || "-"} / {patient.patientCode || "-"}
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
          <h3>{t("board.activePatients")}</h3>
          <div className="filter-row">
            <label>
              {t("field.attending")}
              <select value={attendingFilter} onChange={(event) => setAttendingFilter(event.target.value)}>
                <option value="all">{t("field.allAttendings")}</option>
                {attendingNames.map((attendingName) => (
                  <option key={attendingName} value={attendingName}>
                    {attendingName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("action.sort")}
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="bed">{t("board.byBed")}</option>
                <option value="dischargeDate">{t("board.byDischargeDate")}</option>
                <option value="urgentFirst">{t("board.urgentFirst")}</option>
              </select>
            </label>
          </div>
        </div>
        {dataLoading && <p className="muted">{t("board.loading")}</p>}
        {dataError && <p className="error-message">{dataError}</p>}
        <div className="patient-board-grid">
          {activePatients.map((patient) => (
            <article className="patient-board-card" key={patient.id}>
              <header className="patient-board-card-header">
                <div className="patient-board-identity">
                  <strong>{patient.bed || "-"}</strong>
                  <span>{patient.patientCode || "-"}</span>
                  <span>{patient.age}/{patient.sex}</span>
                </div>
                <div className="patient-board-badges">
                  {patient.isNewAdmission && <span className="badge urgent">{t("board.newAdmission")}</span>}
                  {patient.showAdmissionBriefOnPrint && <span className="badge normal">{t("board.briefIncluded")}</span>}
                </div>
              </header>

              <div className="patient-board-card-body">
                <section className="patient-board-section patient-board-overview">
                  {patient.importantRedFlags.trim() && (
                    <div className="board-red-flags">
                      <span className="board-label">Red Flags</span>
                      <ClinicalText value={patient.importantRedFlags} maxLines={3} importantDefault />
                    </div>
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
                  <div className="muted">Attending: {patient.attending || t("board.unassigned")}</div>
                </section>

                <section className="patient-board-section">
                  <span className="board-label">Sx</span>
                  <ClinicalText value={patient.subjectiveOrChiefConcern} maxLines={2} />
                  {patient.vitalSigns.trim() && (
                    <div className="board-subsection">
                      <span className="board-label">V/S</span>
                      <ClinicalText value={patient.vitalSigns} maxLines={2} />
                    </div>
                  )}
                  {patient.bloodSugar.trim() && (
                    <div className="board-subsection">
                      <span className="board-label">Sugar</span>
                      <ClinicalText value={patient.bloodSugar} maxLines={2} />
                    </div>
                  )}
                  {(patient.physicalExam.trim() ||
                    importantLines(patient.physicalExam).length > 0 ||
                    patient.physicalExamEntries.length > 0) && (
                    <div className="board-subsection">
                      <span className="board-label">PE</span>
                      <ClinicalText value={patient.physicalExam} maxLines={2} />
                      <div className="objective-chip-row">{structuredPeSummary(patient)}</div>
                    </div>
                  )}
                </section>

                <section className="patient-board-section">
                  <span className="board-label">Lab / Image</span>
                  <LabChips items={patient.parsedLabItems} />
                  <ClinicalText value={patient.newImaging} maxLines={1} />
                  <div className="objective-chip-row">{structuredImageSummary(patient)}</div>
                </section>

                <section className="patient-board-section">
                  <span className="board-label">A/P</span>
                  <AssessmentPlanDisplay
                    items={patient.assessmentPlanItems}
                    legacyAssessment={patient.assessment}
                    legacyPlan={patient.plan}
                    compact
                  />
                </section>

                <section className="patient-board-section patient-board-tasks">
                  {taskSummary(patient)}
                </section>

                <section className="patient-board-section patient-board-discharge">
                  <span className="board-label">DC</span>
                  <strong>{patient.dischargeTargetDate || "TBD"}</strong>
                  {dischargeReminder(patient) && <div className="important-line">{dischargeReminder(patient)}</div>}
                </section>
              </div>

              <footer className="patient-board-card-actions">
                <div className="board-action-buttons">
                  <Link
                    className="button-link icon-button"
                    to={`/patients/${patient.id}`}
                    aria-label={t("action.details")}
                    title={t("action.details")}
                  >
                    <span className="icon-button-icon"><IconDetails /></span>
                    <span className="icon-button-label">{t("board.actionShort.details")}</span>
                  </Link>
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => startToday(patient.id)}
                    aria-label={t("action.createToday")}
                    title={t("action.createToday")}
                  >
                    <span className="icon-button-icon"><IconCreateToday /></span>
                    <span className="icon-button-label">{t("board.actionShort.createToday")}</span>
                  </button>
                  <button
                    type="button"
                    className={`secondary icon-button${patient.isNewAdmission ? " icon-button-active" : ""}`}
                    onClick={() => setNewAdmission(patient.id, !patient.isNewAdmission)}
                    aria-label={patient.isNewAdmission ? t("board.unmarkNew") : t("action.markNew")}
                    title={patient.isNewAdmission ? t("board.unmarkNew") : t("action.markNew")}
                  >
                    <span className="icon-button-icon"><IconStar /></span>
                    <span className="icon-button-label">
                      {patient.isNewAdmission ? t("board.actionShort.unmarkNew") : t("board.actionShort.markNew")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`secondary icon-button${patient.showAdmissionBriefOnPrint ? " icon-button-active" : ""}`}
                    onClick={() => setAdmissionBriefPrint(patient.id, !patient.showAdmissionBriefOnPrint)}
                    aria-label={patient.showAdmissionBriefOnPrint ? t("board.excludeBrief") : t("action.includeBrief")}
                    title={patient.showAdmissionBriefOnPrint ? t("board.excludeBrief") : t("action.includeBrief")}
                  >
                    <span className="icon-button-icon"><IconBrief /></span>
                    <span className="icon-button-label">
                      {patient.showAdmissionBriefOnPrint ? t("board.actionShort.excludeBrief") : t("board.actionShort.includeBrief")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => updateStatus(patient.id, "discharged")}
                    aria-label={t("action.discharge")}
                    title={t("action.discharge")}
                  >
                    <span className="icon-button-icon"><IconDischarge /></span>
                    <span className="icon-button-label">{t("board.actionShort.discharge")}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => updateStatus(patient.id, "archived")}
                    aria-label={t("action.archive")}
                    title={t("action.archive")}
                  >
                    <span className="icon-button-icon"><IconArchive /></span>
                    <span className="icon-button-label">{t("board.actionShort.archive")}</span>
                  </button>
                </div>
              </footer>
            </article>
          ))}
          {activePatients.length === 0 && <p className="muted">{t("board.noActivePatients")}</p>}
        </div>
      </section>
    </div>
  );
}

export default PatientBoardPage;
