import { Link } from "react-router-dom";
import type { Patient } from "../types";
import { getArchivedPatients, nowIso, statusLabel } from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

function ArchivePage({ patients, onSavePatient }: PageProps) {
  const archivedPatients = getArchivedPatients(patients);

  async function reactivate(patientId: string) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({ ...patient, status: "active", updatedAt: nowIso() });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Archive</h2>
        </div>
      </header>

      <section className="panel">
        <h3>Discharged or Archived Patients</h3>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Bed</th>
                <th>Code</th>
                <th>Diagnosis</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {archivedPatients.map((patient) => (
                <tr key={patient.id}>
                  <td>{patient.bed}</td>
                  <td>{patient.patientCode}</td>
                  <td>{patient.primaryDiagnosis}</td>
                  <td>{statusLabel(patient.status)}</td>
                  <td>{patient.updatedAt.slice(0, 10)}</td>
                  <td className="table-actions">
                    <Link className="button-link" to={`/patients/${patient.id}`}>
                      Details
                    </Link>
                    <button type="button" onClick={() => reactivate(patient.id)}>
                      Restore Active
                    </button>
                  </td>
                </tr>
              ))}
              {archivedPatients.length === 0 && (
                <tr>
                  <td colSpan={6}>No discharged or archived patients.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default ArchivePage;
