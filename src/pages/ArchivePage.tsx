import { Link } from "react-router-dom";
import type { Patient } from "../types";
import { getArchivedPatients, nowIso } from "../utils";
import { useT } from "../i18n";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
  onDeletePatient: (patientId: string) => Promise<void>;
}

function ArchivePage({ patients, onSavePatient, onDeletePatient }: PageProps) {
  const t = useT();
  const archivedPatients = getArchivedPatients(patients);

  async function reactivate(patientId: string) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({ ...patient, status: "active", updatedAt: nowIso() });
  }

  async function deletePermanently(patient: Patient) {
    const label = [patient.bed, patient.patientCode].filter(Boolean).join(" / ") || t("archive.thisPatient");
    if (!window.confirm(`${t("archive.deleteConfirm")}\n${label}`)) return;
    await onDeletePatient(patient.id);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{t("archive.title")}</h2>
        </div>
      </header>

      <section className="panel">
        <h3>{t("archive.dischargedOrArchived")}</h3>
        <div className="responsive-table">
          <table>
            <thead>
              <tr>
                <th>Bed</th>
                <th>Code</th>
                <th>{t("archive.diagnosis")}</th>
                <th>{t("archive.status")}</th>
                <th>{t("archive.updated")}</th>
                <th>{t("board.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {archivedPatients.map((patient) => (
                <tr key={patient.id}>
                  <td>{patient.bed}</td>
                  <td>{patient.patientCode}</td>
                  <td>{patient.primaryDiagnosis}</td>
                  <td>{t(`status.${patient.status}`)}</td>
                  <td>{patient.updatedAt.slice(0, 10)}</td>
                  <td className="table-actions">
                    <Link className="button-link" to={`/patients/${patient.id}`}>
                      {t("action.details")}
                    </Link>
                    <button type="button" onClick={() => reactivate(patient.id)}>
                      {t("action.restoreActive")}
                    </button>
                    <button type="button" className="secondary danger-button" onClick={() => deletePermanently(patient)}>
                      {t("action.deletePermanent")}
                    </button>
                  </td>
                </tr>
              ))}
              {archivedPatients.length === 0 && (
                <tr>
                  <td colSpan={6}>{t("archive.noPatients")}</td>
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
