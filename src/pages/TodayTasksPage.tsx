import { Link } from "react-router-dom";
import type { Patient, PatientTask } from "../types";
import { getActivePatients, getPendingTasks, hasUpcomingDischarge, nowIso, pendingDischargePrep } from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

function TodayTasksPage({ patients, onSavePatient }: PageProps) {
  const activePatients = getActivePatients(patients);
  const pendingTasks = getPendingTasks(activePatients);
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
          <h2>Today Tasks</h2>
          <p className="privacy-warning">Use de-identified data only.</p>
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
              {patient.dischargeMedsStatus === "pending" && (
                <button type="button" onClick={() => updateDischargePrep(patient, "dischargeMedsStatus", "done")}>
                  Mark meds done
                </button>
              )}
              {patient.opdAppointmentStatus === "pending" && (
                <button type="button" onClick={() => updateDischargePrep(patient, "opdAppointmentStatus", "done")}>
                  Mark OPD done
                </button>
              )}
              {patient.diagnosisCertificateStatus === "pending" && (
                <button
                  type="button"
                  onClick={() => updateDischargePrep(patient, "diagnosisCertificateStatus", "done")}
                >
                  Mark certificate done
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h3>Unfinished Tasks From Active Patients</h3>
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
              </tr>
            </thead>
            <tbody>
              {pendingTasks.map(({ patient, task }) => (
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
                </tr>
              ))}
              {pendingTasks.length === 0 && (
                <tr>
                  <td colSpan={7}>No unfinished tasks from active patients.</td>
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
