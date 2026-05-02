import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import type { Patient } from "./types";
import AppLayout from "./components/AppLayout";
import PatientBoardPage from "./pages/PatientBoardPage";
import PatientDetailPage from "./pages/PatientDetailPage";
import TodayTasksPage from "./pages/TodayTasksPage";
import ArchivePage from "./pages/ArchivePage";
import PrintRoundingListPage from "./pages/PrintRoundingListPage";
import AuthPage from "./pages/AuthPage";
import { useAuthUser } from "./firebase/auth";
import { createPatient, subscribeToPatients, updatePatient } from "./firebase/patientService";

function App() {
  const { user, authLoading } = useAuthUser();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  function formatSyncError(action: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Firestore error";
    return `${action} failed. Firestore did not save the change: ${message}`;
  }

  useEffect(() => {
    if (!user) {
      setPatients([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    setDataError("");
    const unsubscribe = subscribeToPatients(
      user.uid,
      (nextPatients) => {
        setPatients(nextPatients);
        setDataLoading(false);
      },
      (error) => {
        setDataError(formatSyncError("Loading patients", error));
        setDataLoading(false);
      },
    );

    return unsubscribe;
  }, [user]);

  async function createSyncedPatient(patient: Patient) {
    if (!user) {
      setDataError("Creating patient failed. You must be signed in before saving patient data.");
      return;
    }

    setDataError("");
    try {
      await createPatient(user.uid, patient);
    } catch (error) {
      const message = formatSyncError("Creating patient", error);
      setDataError(message);
      throw new Error(message);
    }
  }

  async function updateSyncedPatient(patient: Patient) {
    if (!user) {
      setDataError("Saving patient failed. You must be signed in before saving patient data.");
      return;
    }

    setDataError("");
    try {
      await updatePatient(user.uid, patient);
    } catch (error) {
      const message = formatSyncError("Saving patient", error);
      setDataError(message);
      throw new Error(message);
    }
  }

  async function saveSyncedPatient(patient: Patient) {
    if (!user) return;
    await updateSyncedPatient(patient);
  }

  if (authLoading) {
    return <div className="loading-screen">Checking login...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout userEmail={user.email ?? ""} syncError={dataError} />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={
            <PatientBoardPage
              patients={patients}
              dataLoading={dataLoading}
              dataError={dataError}
              onCreatePatient={createSyncedPatient}
              onSavePatient={saveSyncedPatient}
            />
          }
        />
        <Route
          path="/patients/:patientId"
          element={<PatientDetailPage patients={patients} onSavePatient={saveSyncedPatient} />}
        />
        <Route
          path="/tasks"
          element={<TodayTasksPage patients={patients} onSavePatient={saveSyncedPatient} />}
        />
        <Route
          path="/archive"
          element={<ArchivePage patients={patients} onSavePatient={saveSyncedPatient} />}
        />
        <Route
          path="/print"
          element={<PrintRoundingListPage patients={patients} />}
        />
      </Route>
    </Routes>
  );
}

export default App;
