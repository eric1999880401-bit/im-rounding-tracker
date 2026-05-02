import { Link } from "react-router-dom";
import type { Patient, PatientTask } from "../types";
import { getActivePatients, getPendingTasks, nowIso } from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

function TodayTasksPage({ patients, onSavePatient }: PageProps) {
  const activePatients = getActivePatients(patients);
  const pendingTasks = getPendingTasks(activePatients);

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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Today Tasks</h2>
          <p className="privacy-warning">Use de-identified data only.</p>
        </div>
      </header>

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
