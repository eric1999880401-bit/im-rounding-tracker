import { Link } from "react-router-dom";
import { useState } from "react";
import type { Patient, PatientTask } from "../types";
import { getActivePatients, hasUpcomingDischarge, nowIso, pendingDischargePrep } from "../utils";
import { useT } from "../i18n";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

type DischargePrepField = "dischargeMedsStatus" | "opdAppointmentStatus" | "diagnosisCertificateStatus";

function TodayTasksPage({ patients, onSavePatient }: PageProps) {
  const t = useT();
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const activePatients = getActivePatients(patients);
  const visibleTasks = activePatients.flatMap((patient) =>
    patient.tasks
      .filter((task) => showCompletedTasks || !task.done)
      .map((task) => ({ patient, task })),
  );
  const dischargePrepReminders = activePatients
    .map((patient) => ({ patient, pending: pendingDischargePrep(patient) }))
    .filter(({ patient, pending }) => hasUpcomingDischarge(patient) && pending.length > 0);

  async function toggleDone(patientId: string, taskToToggle: PatientTask) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;

    await onSavePatient({
      ...patient,
      updatedAt: nowIso(),
      tasks: patient.tasks.map((task) =>
        task.id === taskToToggle.id
          ? { ...task, done: !task.done, completedAt: task.done ? "" : nowIso() }
          : task,
      ),
    });
  }

  async function deleteTask(patientId: string, taskToDelete: PatientTask) {
    if (!window.confirm(`Delete task: ${taskToDelete.text}?`)) return;
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;

    await onSavePatient({
      ...patient,
      updatedAt: nowIso(),
      tasks: patient.tasks.filter((task) => task.id !== taskToDelete.id),
    });
  }

  async function updateDischargePrep(
    patient: Patient,
    field: DischargePrepField,
    status: Patient[typeof field],
  ) {
    await onSavePatient({ ...patient, [field]: status, updatedAt: nowIso() });
  }

  function renderDischargePrepChecklist(patient: Patient) {
    const items: Array<{ field: DischargePrepField; label: string; shortLabel: string }> = [
      { field: "dischargeMedsStatus", label: t("dc.meds"), shortLabel: "Meds" },
      { field: "opdAppointmentStatus", label: t("dc.opd"), shortLabel: "OPD" },
      { field: "diagnosisCertificateStatus", label: t("dc.certificate"), shortLabel: "Cert" },
    ];

    return (
      <div className="dc-prep-checks" aria-label="Discharge prep checklist">
        {items.map(({ field, label, shortLabel }) => {
          const status = patient[field];
          const isNotNeeded = status === "notNeeded";
          return (
            <div className={`dc-prep-item${isNotNeeded ? " dc-prep-item-na" : ""}`} key={field}>
              <label className="dc-prep-check" title={label}>
                <input
                  type="checkbox"
                  checked={status === "done"}
                  disabled={isNotNeeded}
                  onChange={(event) => void updateDischargePrep(patient, field, event.target.checked ? "done" : "pending")}
                />
                <span>{shortLabel}</span>
              </label>
              <button
                type="button"
                className={`dc-prep-na-button${isNotNeeded ? " dc-prep-na-active" : ""}`}
                onClick={() => void updateDischargePrep(patient, field, isNotNeeded ? "pending" : "notNeeded")}
                aria-label={`${label} ${isNotNeeded ? "reset to pending" : "not needed"}`}
                title={isNotNeeded ? "Reset to pending" : t("dc.notNeeded")}
              >
                N/A
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Today Tasks</h2>
        </div>
      </header>

      <section className="panel">
        <h3>Discharge Prep Reminders</h3>
        {dischargePrepReminders.length === 0 && <p className="muted">No discharge prep reminders for today/tomorrow.</p>}
        {dischargePrepReminders.map(({ patient, pending }) => (
          <div className="dc-alert-card" key={patient.id}>
            <div className="important-line">
              <Link to={`/patients/${patient.id}`}>{patient.bed} {patient.patientCode}</Link>: DC prep pending:{" "}
              {pending.join(" / ")}
            </div>
            <div className="dc-alert-actions">
              {renderDischargePrepChecklist(patient)}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <h3>{showCompletedTasks ? "Tasks From Active Patients" : "Unfinished Tasks From Active Patients"}</h3>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showCompletedTasks}
              onChange={(event) => setShowCompletedTasks(event.target.checked)}
            />
            {showCompletedTasks ? "Show completed tasks" : "Hide completed tasks"}
          </label>
        </div>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Done</th>
                <th>Bed</th>
                <th>Patient</th>
                <th>Task</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Due Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(({ patient, task }) => (
                <tr key={`${patient.id}-${task.id}`}>
                  <td>
                    <input type="checkbox" checked={task.done} onChange={() => toggleDone(patient.id, task)} />
                  </td>
                  <td>{patient.bed}</td>
                  <td>
                    <Link to={`/patients/${patient.id}`}>{patient.patientCode}</Link>
                  </td>
                  <td className={task.done ? "task-done" : ""}>{task.text}</td>
                  <td>
                    <span className={`badge ${task.priority}`}>{task.priority}</span>
                  </td>
                  <td>{task.category}</td>
                  <td>{task.dueDate}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => deleteTask(patient.id, task)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={8}>{showCompletedTasks ? "No tasks from active patients." : "No unfinished tasks from active patients."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default TodayTasksPage;
