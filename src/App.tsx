import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import type { DailyNote, DailyNotesByPatient, MiscTask, Patient, PhonebookContact, StudyTopic, UserPreferences } from "./types";
import AppLayout from "./components/AppLayout";
import PatientBoardPage from "./pages/PatientBoardPage";
import PatientDetailPage from "./pages/PatientDetailPage";
import TodayTasksPage from "./pages/TodayTasksPage";
import ArchivePage from "./pages/ArchivePage";
import PrintRoundingListPage from "./pages/PrintRoundingListPage";
import SettingsPage from "./pages/SettingsPage";
import UtilitiesPage from "./pages/UtilitiesPage";
import AiDocumentsPage from "./pages/AiDocumentsPage";
import AuthPage from "./pages/AuthPage";
import { getUserName, signOutCurrentUser, useAuthUser } from "./firebase/auth";
import { createPatient, deletePatient, saveDailyNote, subscribeToDailyNotes, subscribeToPatients, updatePatient } from "./firebase/patientService";
import {
  deleteMiscTask,
  deletePhonebookContact,
  deleteStudyTopic,
  saveMiscTask,
  savePhonebookContact,
  saveStudyTopic,
  subscribeToMiscTasks,
  subscribeToPhonebook,
  subscribeToStudyTopics,
} from "./firebase/userUtilityService";
import { I18nProvider } from "./i18n";

const defaultPreferences: UserPreferences = { theme: "system", language: "en" };

function loadPreferences() {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem("im-rounding-preferences") ?? "{}") };
  } catch {
    return defaultPreferences;
  }
}

function App() {
  const { user, authLoading } = useAuthUser();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dailyNotesByPatient, setDailyNotesByPatient] = useState<DailyNotesByPatient>({});
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences);
  const [phonebook, setPhonebook] = useState<PhonebookContact[]>([]);
  const [miscTasks, setMiscTasks] = useState<MiscTask[]>([]);
  const [studyTopics, setStudyTopics] = useState<StudyTopic[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  function formatSyncError(action: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Firestore error";
    return `${action} failed. Firestore did not save the change: ${message}`;
  }

  useEffect(() => {
    localStorage.setItem("im-rounding-preferences", JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.language = preferences.language;
  }, [preferences]);

  useEffect(() => {
    if (!user) {
      setPatients([]);
      setDailyNotesByPatient({});
      setPhonebook([]);
      setMiscTasks([]);
      setStudyTopics([]);
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

  useEffect(() => {
    if (!user) return;
    const unsubscribes = [
      subscribeToPhonebook(user.uid, setPhonebook, (error) => setDataError(formatSyncError("Loading phonebook", error))),
      subscribeToMiscTasks(user.uid, setMiscTasks, (error) => setDataError(formatSyncError("Loading misc tasks", error))),
      subscribeToStudyTopics(user.uid, setStudyTopics, (error) => setDataError(formatSyncError("Loading study topics", error))),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (!user || patients.length === 0) {
      setDailyNotesByPatient({});
      return;
    }

    const unsubscribes = patients.map((patient) =>
      subscribeToDailyNotes(
        user.uid,
        patient.id,
        (patientId, notes) => {
          setDailyNotesByPatient((current) => ({ ...current, [patientId]: notes }));
        },
        (error) => {
          setDataError(formatSyncError("Loading daily notes", error));
        },
      ),
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [user, patients]);

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

  async function deleteSyncedPatient(patientId: string) {
    if (!user) {
      setDataError("Deleting patient failed. You must be signed in before deleting patient data.");
      return;
    }

    setDataError("");
    try {
      await deletePatient(user.uid, patientId);
    } catch (error) {
      const message = formatSyncError("Deleting patient", error);
      setDataError(message);
      throw new Error(message);
    }
  }

  async function saveSyncedDailyNote(patientId: string, note: DailyNote) {
    if (!user) {
      setDataError("Saving daily note failed. You must be signed in before saving patient data.");
      return;
    }

    setDataError("");
    try {
      await saveDailyNote(user.uid, patientId, note);
    } catch (error) {
      const message = formatSyncError("Saving daily note", error);
      setDataError(message);
      throw new Error(message);
    }
  }

  if (authLoading) {
    return <div className="loading-screen">Checking login...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <I18nProvider language={preferences.language}>
      <Routes>
        <Route element={<AppLayout userName={getUserName(user)} syncError={dataError} preferences={preferences} />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={
            <PatientBoardPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              dataLoading={dataLoading}
              dataError={dataError}
              onCreatePatient={createSyncedPatient}
              onSavePatient={saveSyncedPatient}
            />
          }
        />
        <Route
          path="/patients/:patientId"
          element={
            <PatientDetailPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              dataLoading={dataLoading}
              onSavePatient={saveSyncedPatient}
              onSaveDailyNote={saveSyncedDailyNote}
            />
          }
        />
        <Route
          path="/tasks"
          element={<TodayTasksPage patients={patients} onSavePatient={saveSyncedPatient} />}
        />
        <Route
          path="/archive"
          element={<ArchivePage patients={patients} onSavePatient={saveSyncedPatient} onDeletePatient={deleteSyncedPatient} />}
        />
        <Route
          path="/print"
          element={
            <PrintRoundingListPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              phonebook={phonebook}
              miscTasks={miscTasks}
              studyTopics={studyTopics}
            />
          }
        />
        <Route
          path="/ai-documents"
          element={
            <AiDocumentsPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              onSavePatient={saveSyncedPatient}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              preferences={preferences}
              userName={getUserName(user)}
              onChange={setPreferences}
              onSwitchUser={signOutCurrentUser}
            />
          }
        />
        <Route
          path="/utilities"
          element={
            <UtilitiesPage
              phonebook={phonebook}
              miscTasks={miscTasks}
              studyTopics={studyTopics}
              onSaveContact={(contact) => user ? savePhonebookContact(user.uid, contact) : Promise.resolve()}
              onDeleteContact={(id) => user ? deletePhonebookContact(user.uid, id) : Promise.resolve()}
              onSaveMiscTask={(task) => user ? saveMiscTask(user.uid, task) : Promise.resolve()}
              onDeleteMiscTask={(id) => user ? deleteMiscTask(user.uid, id) : Promise.resolve()}
              onSaveStudyTopic={(topic) => user ? saveStudyTopic(user.uid, topic) : Promise.resolve()}
              onDeleteStudyTopic={(id) => user ? deleteStudyTopic(user.uid, id) : Promise.resolve()}
            />
          }
        />
        </Route>
      </Routes>
    </I18nProvider>
  );
}

export default App;
