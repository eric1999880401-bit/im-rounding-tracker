import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Patient } from "../types";
import PatientForm from "../components/PatientForm";
import AdmissionBriefForm from "../components/AdmissionBriefForm";
import DailyNoteForm from "../components/DailyNoteForm";
import TaskList from "../components/TaskList";
import {
  createTodayFromYesterday,
  getUnderlyingDiseaseItems,
  nowIso,
  plainClinicalText,
  summarizeItems,
} from "../utils";

interface PageProps {
  patients: Patient[];
  onSavePatient: (patient: Patient) => Promise<void>;
}

const compositionSaveDelayMs = 900;

function PatientDetailPage({ patients, onSavePatient }: PageProps) {
  const { patientId } = useParams();
  const sourcePatient = patients.find((item) => item.id === patientId);
  const [draftPatient, setDraftPatient] = useState<Patient | null>(sourcePatient ?? null);
  const [isDirty, setIsDirty] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [copiedVersion, setCopiedVersion] = useState("");
  const draftRef = useRef<Patient | null>(sourcePatient ?? null);
  const isDirtyRef = useRef(false);
  const isComposingRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!sourcePatient) return;

    const changedPatient = draftRef.current?.id !== sourcePatient.id;
    const canAcceptSnapshot = changedPatient || (!isDirtyRef.current && !isComposingRef.current);

    if (canAcceptSnapshot) {
      draftRef.current = sourcePatient;
      setDraftPatient(sourcePatient);
      setIsDirty(false);
      isDirtyRef.current = false;
    }
  }, [sourcePatient]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  if (!sourcePatient || !draftPatient) {
    return (
      <div className="page">
        <h2>Patient not found</h2>
        <Link to="/patients">Back to patient board</Link>
      </div>
    );
  }

  const currentPatient = draftPatient;

  function updateDraft(nextPatient: Patient) {
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    setIsDirty(true);
    isDirtyRef.current = true;
  }

  async function commitDraft(patientToSave = draftRef.current) {
    if (!patientToSave || isComposingRef.current) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const nextPatient = { ...patientToSave, updatedAt: nowIso() };
    draftRef.current = nextPatient;
    setDraftPatient(nextPatient);
    await onSavePatient(nextPatient);
    setIsDirty(false);
    isDirtyRef.current = false;
  }

  function scheduleCommitAfterComposition() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void commitDraft();
    }, compositionSaveDelayMs);
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
  }

  function handleCompositionEnd() {
    isComposingRef.current = false;
    scheduleCommitAfterComposition();
  }

  function handleFieldBlur() {
    if (!isComposingRef.current) {
      void commitDraft();
    }
  }

  function available(value: string, fallback: string) {
    return value.trim() || fallback;
  }

  function englishPresentation() {
    const sex = currentPatient.sex === "M" ? "male" : currentPatient.sex === "F" ? "female" : "patient";
    const pmh = plainClinicalText(
      currentPatient.admissionPMH,
      summarizeItems(getUnderlyingDiseaseItems(currentPatient), "no documented PMH"),
    );
    const currentUpdate = [
      currentPatient.subjectiveOrChiefConcern.trim()
        ? `S: ${plainClinicalText(currentPatient.subjectiveOrChiefConcern)}`
        : "",
      currentPatient.physicalExam.trim() ? `PE: ${plainClinicalText(currentPatient.physicalExam)}` : "",
      currentPatient.newLabs.trim() ? `labs: ${plainClinicalText(currentPatient.newLabs)}` : "",
      currentPatient.newImaging.trim() ? `imaging: ${plainClinicalText(currentPatient.newImaging)}` : "",
      currentPatient.assessment.trim() ? `assessment: ${plainClinicalText(currentPatient.assessment)}` : "",
      currentPatient.plan.trim() ? `plan: ${plainClinicalText(currentPatient.plan)}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    return [
      `This is a ${currentPatient.age}-year-old ${sex} with PMH of ${pmh}, admitted due to ${plainClinicalText(
        currentPatient.admissionChiefConcern,
        "the admission concern",
      )}.`,
      `The admission story is ${plainClinicalText(currentPatient.hpiOrAdmissionStory, "not yet documented")}.`,
      currentPatient.baselineFunction.trim()
        ? `Baseline function was ${plainClinicalText(currentPatient.baselineFunction)}.`
        : "",
      `Initial PE showed ${plainClinicalText(currentPatient.initialPhysicalExam, "not yet documented")}.`,
      `Initial labs showed ${plainClinicalText(currentPatient.initialLabs, "not yet documented")}.`,
      `Initial imaging showed ${plainClinicalText(currentPatient.initialImaging, "not yet documented")}.`,
      `The initial impression was ${plainClinicalText(currentPatient.initialAssessment, "not yet documented")}.`,
      `Initial plan was ${plainClinicalText(currentPatient.initialPlan, "not yet documented")}.`,
      `Important hospital course so far includes ${plainClinicalText(
        currentPatient.earlyHospitalCourse,
        "no major early course documented",
      )}.`,
      currentUpdate ? `Current update: ${currentUpdate}.` : "",
      currentPatient.admissionBriefNotes.trim()
        ? `Additional notes: ${plainClinicalText(currentPatient.admissionBriefNotes)}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function chinesePresentation() {
    const sex =
      currentPatient.sex === "M"
        ? "\u7537\u6027"
        : currentPatient.sex === "F"
          ? "\u5973\u6027"
          : "\u75c5\u4eba";
    const pmh = plainClinicalText(
      currentPatient.admissionPMH,
      summarizeItems(getUnderlyingDiseaseItems(currentPatient), "\u672a\u8a18\u9304\u7279\u6b8a\u75c5\u53f2"),
    );
    const currentUpdate = [
      currentPatient.subjectiveOrChiefConcern.trim()
        ? `S\uff1a${plainClinicalText(currentPatient.subjectiveOrChiefConcern)}`
        : "",
      currentPatient.physicalExam.trim() ? `PE\uff1a${plainClinicalText(currentPatient.physicalExam)}` : "",
      currentPatient.newLabs.trim() ? `Lab\uff1a${plainClinicalText(currentPatient.newLabs)}` : "",
      currentPatient.newImaging.trim() ? `Image\uff1a${plainClinicalText(currentPatient.newImaging)}` : "",
      currentPatient.assessment.trim() ? `Assessment\uff1a${plainClinicalText(currentPatient.assessment)}` : "",
      currentPatient.plan.trim() ? `Plan\uff1a${plainClinicalText(currentPatient.plan)}` : "",
    ]
      .filter(Boolean)
      .join("\uff1b");

    return [
      `\u9019\u662f\u4e00\u4f4d ${currentPatient.age} \u6b72${sex}\uff0c\u904e\u53bb\u75c5\u53f2\u6709 ${available(
        pmh,
        "\u672a\u8a18\u9304\u7279\u6b8a\u75c5\u53f2",
      )}\uff0c\u672c\u6b21\u56e0 ${available(
        plainClinicalText(currentPatient.admissionChiefConcern, ""),
        "\u76ee\u524d\u5165\u9662\u4e3b\u8a34",
      )} \u5165\u9662\u3002`,
      `\u5165\u9662\u75c5\u53f2\u70ba\uff1a${plainClinicalText(
        currentPatient.hpiOrAdmissionStory,
        "\u5c1a\u672a\u8a18\u9304",
      )}\u3002`,
      currentPatient.baselineFunction.trim()
        ? `\u5e73\u6642\u529f\u80fd\u72c0\u614b\u70ba\uff1a${plainClinicalText(currentPatient.baselineFunction)}\u3002`
        : "",
      `\u521d\u59cb PE \u986f\u793a\uff1a${plainClinicalText(
        currentPatient.initialPhysicalExam,
        "\u5c1a\u672a\u8a18\u9304",
      )}\u3002`,
      `\u521d\u59cb lab \u986f\u793a\uff1a${plainClinicalText(currentPatient.initialLabs, "\u5c1a\u672a\u8a18\u9304")}\u3002`,
      `\u521d\u59cb\u5f71\u50cf\u986f\u793a\uff1a${plainClinicalText(
        currentPatient.initialImaging,
        "\u5c1a\u672a\u8a18\u9304",
      )}\u3002`,
      `\u521d\u6b65 assessment / impression \u70ba\uff1a${plainClinicalText(
        currentPatient.initialAssessment,
        "\u5c1a\u672a\u8a18\u9304",
      )}\u3002`,
      `\u521d\u59cb plan \u70ba\uff1a${plainClinicalText(currentPatient.initialPlan, "\u5c1a\u672a\u8a18\u9304")}\u3002`,
      `\u76ee\u524d\u91cd\u8981 hospital course \u5305\u542b\uff1a${plainClinicalText(
        currentPatient.earlyHospitalCourse,
        "\u5c1a\u672a\u8a18\u9304\u91cd\u8981\u75c5\u7a0b",
      )}\u3002`,
      currentUpdate ? `\u76ee\u524d\u6bcf\u65e5\u66f4\u65b0\u70ba\uff1a${currentUpdate}\u3002` : "",
      currentPatient.admissionBriefNotes.trim()
        ? `\u5176\u4ed6\u88dc\u5145\uff1a${plainClinicalText(currentPatient.admissionBriefNotes)}\u3002`
        : "",
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
          {isDirty && <p className="muted">Unsaved edits will save on blur or Save.</p>}
        </div>
        <Link className="button-link secondary" to="/patients">
          Back
        </Link>
      </header>

      <section className="panel quick-actions">
        <div>
          <h3>Daily Setup</h3>
          <p className="muted">
            Carries forward the current Daily SOAP fields without changing the Admission Brief.
          </p>
        </div>
        <button type="button" onClick={() => commitDraft(createTodayFromYesterday(currentPatient))}>
          Create today from yesterday
        </button>
      </section>

      <PatientForm
        patient={currentPatient}
        onChange={updateDraft}
        onSubmit={() => commitDraft()}
        submitLabel="Save Basic Info"
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <AdmissionBriefForm
        patient={currentPatient}
        onChange={updateDraft}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Admission Brief Presentation</h3>
            <p className="muted">Template-based text from the Admission Brief, with a short Daily SOAP update.</p>
          </div>
          <button type="button" onClick={() => setShowPresentation((current) => !current)}>
            Generate Admission Brief Presentation
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

      <DailyNoteForm
        patient={currentPatient}
        onChange={updateDraft}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />

      <TaskList
        tasks={currentPatient.tasks}
        onChange={(tasks) => updateDraft({ ...currentPatient, tasks })}
        onCommit={() => commitDraft()}
        onFieldBlur={handleFieldBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
}

export default PatientDetailPage;
