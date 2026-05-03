import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Patient } from "../types";
import PatientForm from "../components/PatientForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import { createTodayFromYesterday, nowIso } from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

function PatientDetailPage({ patients, onSavePatient }: PageProps) {
  const { patientId } = useParams();
  const [showPresentation, setShowPresentation] = useState(false);
  const [copiedVersion, setCopiedVersion] = useState("");
  const patient = patients.find((item) => item.id === patientId);

  if (!patient) {
    return (
      <div className="page">
        <h2>Patient not found</h2>
        <Link to="/patients">Back to patient board</Link>
      </div>
    );
  }

  const currentPatient = patient;

  async function savePatient(nextPatient: Patient) {
    await onSavePatient({ ...nextPatient, updatedAt: nowIso() });
  }

  function available(value: string, fallback: string) {
    return value.trim() || fallback;
  }

  function combinedNewData() {
    const data = [
      currentPatient.newLabs.trim() ? `labs: ${currentPatient.newLabs.trim()}` : "",
      currentPatient.newImaging.trim() ? `imaging: ${currentPatient.newImaging.trim()}` : "",
    ].filter(Boolean);

    return data.join("; ");
  }

  function englishPresentation() {
    const sex = currentPatient.sex === "M" ? "male" : currentPatient.sex === "F" ? "female" : "patient";
    const newData = combinedNewData();

    return [
      `This is a ${currentPatient.age}-year-old ${sex} with underlying ${available(
        currentPatient.underlyingDiseases,
        "no documented PMH",
      )}, admitted due to ${available(currentPatient.subjectiveOrChiefConcern, "the current admission concern")}.`,
      `The primary diagnosis is ${available(currentPatient.primaryDiagnosis, "not yet specified")}.`,
      `Current active problems include ${available(currentPatient.activeProblems, "no listed active problems")}.`,
      newData ? `New data showed ${newData}.` : "",
      `Current assessment is ${available(currentPatient.assessment, "pending further assessment")}.`,
      `The plan is to ${available(currentPatient.plan, "continue current management")}.`,
      currentPatient.dischargePlan.trim() ? `Discharge plan: ${currentPatient.dischargePlan.trim()}.` : "",
      currentPatient.specialAttention.trim() ? `Special attention: ${currentPatient.specialAttention.trim()}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function chinesePresentation() {
    const sex = currentPatient.sex === "M" ? "男性" : currentPatient.sex === "F" ? "女性" : "病人";
    const newData = combinedNewData();

    return [
      `這是一位 ${currentPatient.age} 歲${sex}，過去病史有 ${available(
        currentPatient.underlyingDiseases,
        "未記錄特殊病史",
      )}，本次因 ${available(currentPatient.subjectiveOrChiefConcern, "目前入院主訴")} 入院。`,
      `主要診斷為 ${available(currentPatient.primaryDiagnosis, "尚未填寫")}。`,
      `目前 active problems 包含 ${available(currentPatient.activeProblems, "未列出 active problems")}。`,
      newData ? `新資料顯示 ${newData}。` : "",
      `目前評估為 ${available(currentPatient.assessment, "待進一步評估")}。`,
      `計畫為 ${available(currentPatient.plan, "持續目前處置")}。`,
      currentPatient.dischargePlan.trim() ? `出院計畫為 ${currentPatient.dischargePlan.trim()}。` : "",
      currentPatient.specialAttention.trim() ? `需特別注意 ${currentPatient.specialAttention.trim()}。` : "",
    ]
      .filter(Boolean)
      .join("");
  }

  async function copyPresentation(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedVersion(label);
  }

  const englishText = englishPresentation();
  const chineseText = chinesePresentation();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>
            {currentPatient.bed} - {currentPatient.patientCode}
          </h2>
          <p className="privacy-warning">Use de-identified data only.</p>
        </div>
        <Link className="button-link secondary" to="/patients">
          Back
        </Link>
      </header>

      <section className="panel quick-actions">
        <div>
          <h3>Daily Setup</h3>
          <p className="muted">
            Copies forward yesterday's stable A/P and discharge plan, then clears today's new-event fields.
          </p>
        </div>
        <button type="button" onClick={() => savePatient(createTodayFromYesterday(currentPatient))}>
          Create today from yesterday
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Brief Case Presentation</h3>
            <p className="muted">Template-based text from existing patient fields.</p>
          </div>
          <button type="button" onClick={() => setShowPresentation((current) => !current)}>
            Generate Brief Presentation
          </button>
        </div>

        {showPresentation && (
          <div className="presentation-grid">
            <div className="presentation-box">
              <div className="presentation-heading">
                <h4>English</h4>
                <button type="button" className="secondary" onClick={() => copyPresentation("English", englishText)}>
                  Copy
                </button>
              </div>
              <textarea readOnly value={englishText} />
            </div>

            <div className="presentation-box">
              <div className="presentation-heading">
                <h4>Traditional Chinese</h4>
                <button type="button" className="secondary" onClick={() => copyPresentation("Chinese", chineseText)}>
                  Copy
                </button>
              </div>
              <textarea readOnly value={chineseText} />
            </div>
            {copiedVersion && <p className="muted span-2">Copied {copiedVersion} presentation.</p>}
          </div>
        )}
      </section>

      <PatientForm
        patient={currentPatient}
        onChange={savePatient}
        onSubmit={() => savePatient(currentPatient)}
        submitLabel="Save Basic Info"
      />

      <DailyNoteForm patient={currentPatient} onChange={savePatient} />

      <TaskList
        tasks={currentPatient.tasks}
        onChange={(tasks) => savePatient({ ...currentPatient, tasks })}
      />
    </div>
  );
}

export default PatientDetailPage;
