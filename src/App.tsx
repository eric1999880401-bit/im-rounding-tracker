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
import { savePatient, subscribeToPatients } from "./firebase/patientService";

function App() {
  const { user, authLoading } = useAuthUser();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  useEffect(() => {
    if (!user) {
      setPatients([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const unsubscribe = subscribeToPatients(
      user.uid,
      (nextPatients) => {
        setPatients(nextPatients);
        setDataLoading(false);
      },
      (error) => {
        setDataError(error.message);
        setDataLoading(false);
      },
    );

    return unsubscribe;
  }, [user]);

  async function saveSyncedPatient(patient: Patient) {
    if (!user) return;
    await savePatient(user.uid, patient);
  }

  if (authLoading) {
    return <div className="loading-screen">Checking login...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout userEmail={user.email ?? ""} />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={
            <PatientBoardPage
              patients={patients}
              dataLoading={dataLoading}
              dataError={dataError}
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
