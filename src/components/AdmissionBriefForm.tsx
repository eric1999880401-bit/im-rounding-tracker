import type { Patient } from "../types";
import ColorMarkupTextarea from "./ColorMarkupTextarea";

interface AdmissionBriefFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function AdmissionBriefForm({
  patient,
  onChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: AdmissionBriefFormProps) {
  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value, updatedAt: new Date().toISOString() });
  }

  function updateChiefComplaint(value: string) {
    onChange({
      ...patient,
      chiefComplaint: value,
      admissionChiefConcern: value,
      updatedAt: new Date().toISOString(),
    });
  }

  function updateHpi(value: string) {
    onChange({
      ...patient,
      presentIllnessOrHPI: value,
      hpiOrAdmissionStory: value,
      updatedAt: new Date().toISOString(),
    });
  }

  function commitOnBlur() {
    onFieldBlur?.();
  }

  function handleCompositionEnd() {
    onCompositionEnd?.();
  }

  const hasGeneratedAdmissionDraft = patient.generatedAdmissionNote.trim() || patient.generatedAdmissionSummary.trim();

  return (
    <section className="panel">
      <h2>Admission Brief / Initial Presentation</h2>
      <p className="muted">Clinician-reviewed admission data. Daily SOAP remains separate.</p>
      <div className="form-grid">
        <label className="span-2">
          Chief Complaint
          <textarea
            value={patient.chiefComplaint || patient.admissionChiefConcern}
            onChange={(event) => updateChiefComplaint(event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          PI / HPI / Present Illness
          <textarea
            value={patient.presentIllnessOrHPI || patient.hpiOrAdmissionStory}
            onChange={(event) => updateHpi(event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          PMH
          <textarea
            value={patient.admissionPMH}
            onChange={(event) => updateField("admissionPMH", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Baseline function
          <textarea
            value={patient.baselineFunction}
            onChange={(event) => updateField("baselineFunction", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Initial PE
          <ColorMarkupTextarea
            value={patient.initialPhysicalExam}
            onChange={(value) => updateField("initialPhysicalExam", value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial labs
          <textarea
            value={patient.initialLabs}
            onChange={(event) => updateField("initialLabs", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial imaging
          <textarea
            value={patient.initialImaging}
            onChange={(event) => updateField("initialImaging", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial assessment
          <textarea
            value={patient.initialAssessment}
            onChange={(event) => updateField("initialAssessment", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial plan
          <textarea
            value={patient.initialPlan}
            onChange={(event) => updateField("initialPlan", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Early hospital course
          <textarea
            value={patient.earlyHospitalCourse}
            onChange={(event) => updateField("earlyHospitalCourse", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Admission Note Summary
          <ColorMarkupTextarea
            value={patient.admissionBriefFreeText || patient.generatedAdmissionSummary}
            onChange={(value) => updateField("admissionBriefFreeText", value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Paste or write your own short admission summary."
          />
        </label>

        {hasGeneratedAdmissionDraft && (
          <details className="admission-generated-drafts span-2">
            <summary>AI-generated source drafts</summary>
            {patient.generatedAdmissionNote.trim() && (
              <label>
                AI Admission Note Draft
                <textarea
                  value={patient.generatedAdmissionNote}
                  onChange={(event) => updateField("generatedAdmissionNote", event.target.value)}
                  onBlur={commitOnBlur}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </label>
            )}

            {patient.generatedAdmissionSummary.trim() && (
              <label>
                AI Admission Summary Draft
                <textarea
                  value={patient.generatedAdmissionSummary}
                  onChange={(event) => updateField("generatedAdmissionSummary", event.target.value)}
                  onBlur={commitOnBlur}
                  onCompositionStart={onCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </label>
            )}
          </details>
        )}
      </div>
    </section>
  );
}

export default AdmissionBriefForm;
