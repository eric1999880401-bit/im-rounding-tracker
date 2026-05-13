import { Link } from "react-router-dom";
import { useState } from "react";
import type { DailyNotesByPatient, Patient, SortMode } from "../types";
import {
  createTodayFromYesterday,
  emptyPatient,
  getActiveAttendingNames,
  getActivePatients,
  getPatientDisplaySummary,
  hasUpcomingDischarge,
  nowIso,
  pendingDischargePrep,
  sortPatients,
  todayKey,
} from "../utils";
import PatientForm from "../components/PatientForm";
import { ClinicalText } from "../components/ClinicalText";
import { AiHighlightsPanel } from "../components/AiHighlightsPanel";
import { BoardSignalPanel } from "../components/BoardSignalPanel";
import {
  IconArchive,
  IconBrief,
  IconCreateToday,
  IconDetails,
  IconDischarge,
  IconStar,
} from "../components/icons";
import { useT } from "../i18n";
import { getRoundingDigest, type RoundingDigest } from "../roundingDigest";

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
  const uniquePatients = Array.from(new Map(patients.map((patient) => [patient.id, patient])).values());
  const activePatients = sortPatients(
    getActivePatients(uniquePatients).filter(
      (patient) => attendingFilter === "all" || patient.attending.trim() === attendingFilter,
    ).map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient),
    sortMode,
  );
  const dischargeAlerts = activePatients
    .map((patient) => ({ patient, pending: pendingDischargePrep(patient) }))
    .filter(({ patient, pending }) => hasUpcomingDischarge(patient) && pending.length > 0);
  const mustSeePatients = activePatients
    .filter((patient) => patientUrgentReasons(patient).length > 0)
    .slice(0, 6);
  const newAdmissionPatients = activePatients
    .filter((patient) => patient.isNewAdmission || patient.showAdmissionBriefOnPrint)
    .slice(0, 6);
  const dischargeSoonPatients = activePatients
    .filter(hasDischargeSoonSignal)
    .slice(0, 6);

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

  function boardDigest(patient: Patient) {
    return getRoundingDigest(patient, dailyNotesByPatient[patient.id] ?? [], {
      mode: "board",
      hideCompletedTasks: true,
    });
  }

  function taskSummary(patient: Patient, digest: RoundingDigest) {
    const pendingTasks = patient.tasks.filter((task) => !task.done);
    const urgentTasks = pendingTasks.filter(
      (task) => task.priority === "urgent" || task.text.trim().startsWith("!"),
    );

    return (
      <div>
        {urgentTasks.length > 0 && <span className="badge urgent">{urgentTasks.length} urgent</span>}{" "}
        <span>{pendingTasks.length} pending</span>
        <ClinicalText value={digest.tasks} fallback="No pending tasks" maxLines={3} maxCharsPerLine={46} />
      </div>
    );
  }

  function pendingTasks(patient: Patient) {
    return patient.tasks.filter((task) => !task.done);
  }

  function patientUrgentReasons(patient: Patient) {
    return boardDigest(patient).urgentLines.slice(0, 3);
  }

  function shortCockpitText(value: string, maxChars = 72) {
    const clean = value
      .replace(/^!+/, "")
      .replace(/\s+-\s*Reason:\s*.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= maxChars) return clean;
    const firstClause = clean.split(/[;；。]/)[0]?.trim() || clean;
    if (firstClause.length <= maxChars) return firstClause;
    return firstClause.slice(0, maxChars).trim();
  }

  function dateIsTodayOrTomorrow(date: string) {
    if (!date) return false;
    const today = todayKey();
    const tomorrowDate = new Date(`${today}T00:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);
    return date === today || date === tomorrow;
  }

  function dischargeTasks(patient: Patient) {
    return patient.tasks.filter((task) => {
      if (task.done) return false;
      const text = `${task.category} ${task.text}`.toLowerCase();
      const isDischargeTask = task.category === "discharge" || /\bdc\b|discharge|出院|opd|certificate|診斷書|帶藥|meds/i.test(text);
      return isDischargeTask && (!task.dueDate || dateIsTodayOrTomorrow(task.dueDate) || task.priority === "urgent");
    });
  }

  function hasDischargeTextSignal(patient: Patient) {
    const text = [patient.dischargePlan, patient.dischargeBarriers, patient.vsOrder].join(" ");
    return /\bdc\b|discharge|出院|home|transfer|OPD|certificate|診斷書|帶藥/i.test(text);
  }

  function hasDischargeSoonSignal(patient: Patient) {
    return (
      hasUpcomingDischarge(patient) ||
      dischargeTasks(patient).length > 0 ||
      Boolean(patient.dischargeTargetDate && dateIsTodayOrTomorrow(patient.dischargeTargetDate)) ||
      (hasDischargeTextSignal(patient) && pendingDischargePrep(patient).length > 0)
    );
  }

  function cockpitLine(patient: Patient) {
    const digest = boardDigest(patient);
    const urgent = digest.urgentLines[0];
    if (urgent) return urgent;
    const pending = pendingTasks(patient)[0]?.text.replace(/^!+/, "").trim();
    if (pending) return pending;
    return digest.issues || digest.diagnosis || patient.primaryDiagnosis || patient.oneLiner || "-";
  }

  function dischargeCockpitLine(patient: Patient) {
    const pending = pendingDischargePrep(patient);
    if (hasUpcomingDischarge(patient)) {
      return [
        patient.dischargeTargetDate ? `Target ${patient.dischargeTargetDate}` : "",
        pending.length > 0 ? `pending ${pending.join("/")}` : "ready",
      ].filter(Boolean).join("; ");
    }

    const task = dischargeTasks(patient)[0];
    if (task) return `Task: ${shortCockpitText(task.text)}`;
    if (patient.dischargeTargetDate) return `Target ${patient.dischargeTargetDate}`;
    if (patient.dischargePlan.trim()) return shortCockpitText(patient.dischargePlan);
    if (patient.dischargeBarriers.trim()) return `Barrier: ${shortCockpitText(patient.dischargeBarriers)}`;
    return pending.length > 0 ? `pending ${pending.join("/")}` : "DC prep";
  }

  function newAdmissionCockpitLine(patient: Patient) {
    const digest = boardDigest(patient);
    return digest.diagnosis || patient.oneLiner || patient.primaryDiagnosis || "Needs admission summary";
  }

  function dischargeReminder(patient: Patient) {
    const pending = pendingDischargePrep(patient);
    if (!hasUpcomingDischarge(patient) || pending.length === 0) return "";
    return `DC prep pending: ${pending.join(" / ")}`;
  }

  async function updateDischargePrep(
    patient: Patient,
    field: "dischargeMedsStatus" | "opdAppointmentStatus" | "diagnosisCertificateStatus",
    status: Patient[typeof field],
  ) {
    await onSavePatient({ ...patient, [field]: status, updatedAt: nowIso() });
  }

  function renderCockpitColumn(title: string, items: Patient[], emptyText: string, kind: "urgent" | "admission" | "discharge") {
    return (
      <section className="cockpit-column">
        <div className="cockpit-column-header">
          <h3>{title}</h3>
          <span className="badge normal">{items.length}</span>
        </div>
        <div className="cockpit-list">
          {items.map((patient) => (
            <Link className="cockpit-item" to={`/patients/${patient.id}`} key={`${title}-${patient.id}`}>
              <span className="cockpit-bed">{patient.bed || "-"}</span>
              <span className="cockpit-main">
                <strong>{kind === "urgent" ? "See now" : kind === "admission" ? "New admit" : "DC prep"}</strong>
                <span>
                  {kind === "urgent"
                    ? cockpitLine(patient)
                    : kind === "admission"
                      ? newAdmissionCockpitLine(patient)
                      : dischargeCockpitLine(patient)}
                </span>
              </span>
            </Link>
          ))}
          {items.length === 0 && <span className="muted">{emptyText}</span>}
        </div>
      </section>
    );
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

      <section className="panel morning-cockpit">
        <div className="section-heading">
          <h3>Morning Cockpit</h3>
          <span className="muted">{activePatients.length} active</span>
        </div>
        <div className="cockpit-grid">
          {renderCockpitColumn("See First", mustSeePatients, "No red flags", "urgent")}
          {renderCockpitColumn("New Admits", newAdmissionPatients, "No new admits", "admission")}
          {renderCockpitColumn("DC Soon", dischargeSoonPatients, "No DC prep", "discharge")}
        </div>
      </section>

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
          {activePatients.map((patient) => {
            const digest = boardDigest(patient);
            const patientNotes = dailyNotesByPatient[patient.id] ?? [];

            return (
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
                <section className="patient-board-section patient-board-overview patient-board-priority">
                  {digest.redFlags && (
                    <div className="board-red-flags">
                      <span className="board-label">Red Flags</span>
                      <ClinicalText value={digest.redFlags} maxLines={2} maxCharsPerLine={52} importantDefault />
                    </div>
                  )}
                  <div className="digest-line">
                    <span className="board-label">Dx</span>
                    <strong>{digest.diagnosis || "-"}</strong>
                  </div>
                  <div className="digest-line">
                    <span className="board-label">Risk</span>
                    <span>{digest.risks || "-"}</span>
                  </div>
                  <div className="digest-line">
                    <span className="board-label">Issues</span>
                    <span>{digest.issues || "-"}</span>
                  </div>
                  <div className="muted">Attending: {patient.attending || t("board.unassigned")}</div>
                </section>

                <AiHighlightsPanel patient={patient} notes={patientNotes} compact showSbar={false} />

                <section className="patient-board-section patient-board-today">
                  <span className="board-label">Today Signal</span>
                  <ClinicalText value={digest.subjective} fallback="-" maxLines={2} maxCharsPerLine={48} />
                  <div className="board-subsection">
                    <span className="board-label">V/S / PE</span>
                    <BoardSignalPanel value={digest.objective} fallback="-" kind="objective" maxItems={2} />
                  </div>
                  <div className="board-subsection">
                    <span className="board-label">Lab / Image</span>
                    <BoardSignalPanel value={digest.lab} fallback="No lab signal" kind="lab" maxItems={2} />
                  </div>
                  <BoardSignalPanel value={digest.image} fallback="-" kind="image" maxItems={2} />
                </section>

                <section className="patient-board-section patient-board-plan">
                  <span className="board-label">Plan / Tasks</span>
                  <ClinicalText value={digest.assessmentPlan} fallback="-" maxLines={3} maxCharsPerLine={50} />
                  <div className="board-subsection patient-board-tasks">{taskSummary(patient, digest)}</div>
                  <div className="board-subsection patient-board-discharge">
                    <span className="board-label">DC</span>
                    <strong>{patient.dischargeTargetDate || "TBD"}</strong>
                    {dischargeReminder(patient) && <div className="important-line">{dischargeReminder(patient)}</div>}
                  </div>
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
            );
          })}
          {activePatients.length === 0 && <p className="muted">{t("board.noActivePatients")}</p>}
        </div>
      </section>
    </div>
  );
}

export default PatientBoardPage;
