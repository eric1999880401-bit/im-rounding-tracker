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

  return (
    <section className="panel">
      <h2>Admission Brief / Initial Presentation</h2>
      <p className="muted">Clinician-controlled free text for new admissions. Daily SOAP remains separate.</p>
      <div className="form-grid">
        <label className="span-2">
          Chief Complaint / 主訴
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

        <label className="span-2">
          Admission Note Summary / 簡短 Admission Summary
          <ColorMarkupTextarea
            value={patient.admissionBriefFreeText}
            onChange={(value) => updateField("admissionBriefFreeText", value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Paste or write your own short admission summary."
          />
        </label>
      </div>
    </section>
  );
}

export default AdmissionBriefForm;
