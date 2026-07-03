import { Navigate, Route, Routes } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import type { DailyNote, DailyNotesByPatient, MiscTask, Patient, PhonebookContact, StudyTopic, UserPreferences } from "./types";
import AppLayout from "./components/AppLayout";
import AuthPage from "./pages/AuthPage";

const PatientBoardPage = lazy(() => import("./pages/PatientBoardPage"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage"));
const TodayTasksPage = lazy(() => import("./pages/TodayTasksPage"));
const ArchivePage = lazy(() => import("./pages/ArchivePage"));
const PrintRoundingListPage = lazy(() => import("./pages/PrintRoundingListPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UtilitiesPage = lazy(() => import("./pages/UtilitiesPage"));
const AiDocumentsPage = lazy(() => import("./pages/AiDocumentsPage"));
import { getUserName, signOutCurrentUser, useAuthUser } from "./firebase/auth";
import { createPatient, deletePatient, saveDailyNote, subscribeToDailyNotes, subscribeToPatients, updatePatient } from "./firebase/patientService";
import {
  deleteMiscTask,
  deletePhonebookContact,
  deleteStudyTopic,
  saveMiscTask,
  savePhonebookContact,
  saveUserPreferences,
  saveStudyTopic,
  subscribeToUserPreferences,
  subscribeToMiscTasks,
  subscribeToPhonebook,
  subscribeToStudyTopics,
} from "./firebase/userUtilityService";
import { I18nProvider } from "./i18n";
import { mockPatients } from "./data/mockPatients";
import { buildUserAiStyleProfile, defaultPreferences, normalizeUserPreferences } from "./userPreferences";

function loadPreferences() {
  try {
    return normalizeUserPreferences({ ...defaultPreferences, ...JSON.parse(localStorage.getItem("im-rounding-preferences") ?? "{}") });
  } catch {
    return defaultPreferences;
  }
}

function readDemoMode() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;

  const pageQuery = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";

  return pageQuery.get("demo") === "1" || new URLSearchParams(hashQuery).get("demo") === "1";
}

function cloneDemoPatients(): Patient[] {
  return mockPatients.map((patient) => ({
    ...patient,
    underlyingDiseaseItems: [...patient.underlyingDiseaseItems],
    activeProblemItems: [...patient.activeProblemItems],
    activeProblemStructuredItems: patient.activeProblemStructuredItems.map((item) => ({ ...item })),
    labReports: patient.labReports.map((report) => ({
      ...report,
      items: report.items.map((item) => ({ ...item })),
    })),
    parsedLabItems: patient.parsedLabItems.map((item) => ({ ...item })),
    physicalExamEntries: patient.physicalExamEntries.map((item) => ({ ...item })),
    imageStudyEntries: patient.imageStudyEntries.map((item) => ({ ...item })),
    assessmentPlanItems: patient.assessmentPlanItems.map((item) => ({
      ...item,
      evidenceOrCourseItems: [...item.evidenceOrCourseItems],
      planItems: [...item.planItems],
    })),
    tasks: patient.tasks.map((task) => ({ ...task })),
    aiThinkingPrompts: patient.aiThinkingPrompts.map((prompt) => ({ ...prompt })),
  }));
}

function App() {
  const { user, authLoading } = useAuthUser();
  const [isDemoMode, setIsDemoMode] = useState(readDemoMode);
  const [patients, setPatients] = useState<Patient[]>(() => (isDemoMode ? cloneDemoPatients() : []));
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

  function handlePreferencesChange(nextPreferences: UserPreferences) {
    const normalized = normalizeUserPreferences(nextPreferences);
    setPreferences(normalized);
    if (!isDemoMode && user) {
      void saveUserPreferences(user.uid, normalized).catch((error) => {
        setDataError(formatSyncError("Saving preferences", error));
      });
    }
  }

  function refreshAiStyleProfile() {
    handlePreferencesChange({
      ...preferences,
      aiStyleProfile: buildUserAiStyleProfile(patients, dailyNotesByPatient),
    });
  }

  useEffect(() => {
    localStorage.setItem("im-rounding-preferences", JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.language = preferences.language;
  }, [preferences]);

  useEffect(() => {
    if (isDemoMode || !user) return;
    return subscribeToUserPreferences(
      user.uid,
      (nextPreferences) => setPreferences(nextPreferences),
      (error) => setDataError(formatSyncError("Loading preferences", error)),
    );
  }, [isDemoMode, user]);

  useEffect(() => {
    if (isDemoMode) {
      setPatients(cloneDemoPatients());
      setDailyNotesByPatient({});
      setPhonebook([]);
      setMiscTasks([]);
      setStudyTopics([]);
      setDataLoading(false);
      setDataError("");
      return;
    }

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
  }, [isDemoMode, user]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!user) return;
    const unsubscribes = [
      subscribeToPhonebook(user.uid, setPhonebook, (error) => setDataError(formatSyncError("Loading phonebook", error))),
      subscribeToMiscTasks(user.uid, setMiscTasks, (error) => setDataError(formatSyncError("Loading misc tasks", error))),
      subscribeToStudyTopics(user.uid, setStudyTopics, (error) => setDataError(formatSyncError("Loading study topics", error))),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [isDemoMode, user]);

  useEffect(() => {
    if (isDemoMode) return;
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
  }, [isDemoMode, user, patients]);

  function enterDemoMode() {
    if (typeof window !== "undefined") {
      window.location.hash = "/patients?demo=1";
    }
    setIsDemoMode(true);
  }

  function exitDemoMode() {
    if (typeof window !== "undefined") {
      window.location.hash = "/";
    }
    setIsDemoMode(false);
    setPatients([]);
    setDailyNotesByPatient({});
  }

  async function createDemoPatient(patient: Patient) {
    setPatients((current) => [...current, patient]);
  }

  async function updateDemoPatient(patient: Patient) {
    setPatients((current) => current.map((item) => (item.id === patient.id ? patient : item)));
  }

  async function deleteDemoPatient(patientId: string) {
    setPatients((current) => current.filter((patient) => patient.id !== patientId));
    setDailyNotesByPatient((current) => {
      const { [patientId]: _removed, ...rest } = current;
      return rest;
    });
  }

  async function saveDemoDailyNote(patientId: string, note: DailyNote) {
    setDailyNotesByPatient((current) => {
      const notes = current[patientId] ?? [];
      const nextNotes = [note, ...notes.filter((item) => item.date !== note.date)].sort((a, b) =>
        b.date.localeCompare(a.date),
      );
      return { ...current, [patientId]: nextNotes };
    });
  }

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

  const createPatientHandler = isDemoMode ? createDemoPatient : createSyncedPatient;
  const savePatientHandler = isDemoMode ? updateDemoPatient : saveSyncedPatient;
  const deletePatientHandler = isDemoMode ? deleteDemoPatient : deleteSyncedPatient;
  const saveDailyNoteHandler = isDemoMode ? saveDemoDailyNote : saveSyncedDailyNote;
  const sessionUserName = isDemoMode ? "Demo User" : user ? getUserName(user) : "";

  if (!isDemoMode && authLoading) {
    return <div className="loading-screen">Checking login...</div>;
  }

  if (!isDemoMode && !user) {
    return <AuthPage onStartDemo={enterDemoMode} />;
  }

  return (
    <I18nProvider language={preferences.language}>
      <Suspense fallback={<div className="page">Loading…</div>}>
      <Routes>
        <Route
          element={
            <AppLayout
              userName={sessionUserName}
              syncError={dataError}
              preferences={preferences}
              isDemoMode={isDemoMode}
              onExitDemo={exitDemoMode}
            />
          }
        >
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route
          path="/patients"
          element={
            <PatientBoardPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              preferences={preferences}
              dataLoading={dataLoading}
              dataError={dataError}
              isDemoMode={isDemoMode}
              onCreatePatient={createPatientHandler}
              onSavePatient={savePatientHandler}
              onSaveDailyNote={saveDailyNoteHandler}
            />
          }
        />
        <Route
          path="/patients/:patientId"
          element={
            <PatientDetailPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              preferences={preferences}
              dataLoading={dataLoading}
              isDemoMode={isDemoMode}
              onSavePatient={savePatientHandler}
              onSaveDailyNote={saveDailyNoteHandler}
            />
          }
        />
        <Route
          path="/tasks"
          element={<TodayTasksPage patients={patients} onSavePatient={savePatientHandler} />}
        />
        <Route
          path="/archive"
          element={<ArchivePage patients={patients} onSavePatient={savePatientHandler} onDeletePatient={deletePatientHandler} />}
        />
        <Route
          path="/print"
          element={
            <PrintRoundingListPage
              patients={patients}
              dailyNotesByPatient={dailyNotesByPatient}
              preferences={preferences}
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
              onSavePatient={savePatientHandler}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              preferences={preferences}
              userName={sessionUserName}
              onChange={handlePreferencesChange}
              onRefreshAiStyleProfile={refreshAiStyleProfile}
              onSwitchUser={isDemoMode ? exitDemoMode : signOutCurrentUser}
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
      </Suspense>
    </I18nProvider>
  );
}

export default App;
