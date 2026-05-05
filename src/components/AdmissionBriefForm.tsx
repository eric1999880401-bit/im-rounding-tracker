import type { Patient } from "../types";

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

  function commitOnBlur() {
    onFieldBlur?.();
  }

  function handleCompositionEnd() {
    onCompositionEnd?.();
  }

  return (
    <section className="panel">
      <h2>Admission Brief / Initial Presentation</h2>
      <p className="muted">Use this for new admissions or first report to VS/attending.</p>
      <div className="form-grid">
        <label className="span-2">
          Admission Chief Concern
          <textarea
            value={patient.admissionChiefConcern}
            onChange={(event) => updateField("admissionChiefConcern", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          HPI / Admission Story
          <textarea
            value={patient.hpiOrAdmissionStory}
            onChange={(event) => updateField("hpiOrAdmissionStory", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Baseline Function
          <textarea
            value={patient.baselineFunction}
            onChange={(event) => updateField("baselineFunction", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Admission PMH
          <textarea
            value={patient.admissionPMH}
            onChange={(event) => updateField("admissionPMH", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Leave blank to use PMH / Underlying Disease"
          />
        </label>

        <label>
          Initial Physical Exam
          <textarea
            value={patient.initialPhysicalExam}
            onChange={(event) => updateField("initialPhysicalExam", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial Labs
          <textarea
            value={patient.initialLabs}
            onChange={(event) => updateField("initialLabs", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial Imaging
          <textarea
            value={patient.initialImaging}
            onChange={(event) => updateField("initialImaging", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label>
          Initial Assessment
          <textarea
            value={patient.initialAssessment}
            onChange={(event) => updateField("initialAssessment", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Initial Plan
          <textarea
            value={patient.initialPlan}
            onChange={(event) => updateField("initialPlan", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Early Hospital Course
          <textarea
            value={patient.earlyHospitalCourse}
            onChange={(event) => updateField("earlyHospitalCourse", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>

        <label className="span-2">
          Admission Brief Notes
          <textarea
            value={patient.admissionBriefNotes}
            onChange={(event) => updateField("admissionBriefNotes", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
      </div>
    </section>
  );
}

export default AdmissionBriefForm;
