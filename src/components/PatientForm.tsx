import type { FormEvent } from "react";
import type { Patient, PatientSex, PatientStatus } from "../types";
import { textToItems } from "../utils";

interface PatientFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function PatientForm({
  patient,
  onChange,
  onSubmit,
  submitLabel,
  onCancel,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: PatientFormProps) {
  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value });
  }

  function updateUnderlyingDiseases(value: string) {
    onChange({ ...patient, underlyingDiseases: value, underlyingDiseaseItems: textToItems(value) });
  }

  function updateActiveProblems(value: string) {
    onChange({ ...patient, activeProblems: value, activeProblemItems: textToItems(value) });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  function commitOnBlur() {
    onFieldBlur?.();
  }

  function handleCompositionEnd() {
    onCompositionEnd?.();
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <label>
        Bed
        <input
          value={patient.bed}
          onChange={(event) => updateField("bed", event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </label>

      <label>
        Patient Code
        <input
          required
          value={patient.patientCode}
          onChange={(event) => updateField("patientCode", event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder="Example: IM-A03"
        />
      </label>

      <label>
        Age
        <input
          type="number"
          min="0"
          value={patient.age}
          onChange={(event) => updateField("age", Number(event.target.value))}
          onBlur={commitOnBlur}
        />
      </label>

      <label>
        Sex
        <select
          value={patient.sex}
          onChange={(event) => updateField("sex", event.target.value as PatientSex)}
          onBlur={commitOnBlur}
        >
          <option value="M">M</option>
          <option value="F">F</option>
          <option value="Other">Other</option>
        </select>
      </label>

      <label>
        Attending
        <input
          value={patient.attending}
          onChange={(event) => updateField("attending", event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </label>

      <label>
        Team / Service
        <input
          value={patient.teamOrService}
          onChange={(event) => updateField("teamOrService", event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </label>

      <label>
        Admission Date
        <input
          type="date"
          value={patient.admissionDate}
          onChange={(event) => updateField("admissionDate", event.target.value)}
          onBlur={commitOnBlur}
        />
      </label>

      <label>
        Status
        <select
          value={patient.status}
          onChange={(event) => updateField("status", event.target.value as PatientStatus)}
          onBlur={commitOnBlur}
        >
          <option value="active">Active</option>
          <option value="discharged">Discharged</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={patient.isNewAdmission}
          onChange={(event) => updateField("isNewAdmission", event.target.checked)}
          onBlur={commitOnBlur}
        />
        New admission
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={patient.showAdmissionBriefOnPrint}
          onChange={(event) => updateField("showAdmissionBriefOnPrint", event.target.checked)}
          onBlur={commitOnBlur}
        />
        Include admission brief in print
      </label>

      <label className="span-2">
        Underlying Disease / PMH
        <textarea
          value={patient.underlyingDiseases}
          onChange={(event) => updateUnderlyingDiseases(event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder="Example: DM, HTN, CKD, CAD, old CVA"
        />
      </label>

      <label className="span-2">
        Primary Diagnosis
        <input
          value={patient.primaryDiagnosis}
          onChange={(event) => updateField("primaryDiagnosis", event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </label>

      <label className="span-2">
        Active Problems
        <textarea
          value={patient.activeProblems}
          onChange={(event) => updateActiveProblems(event.target.value)}
          onBlur={commitOnBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
        />
      </label>

      <div className="form-actions span-2">
        <button type="submit">{submitLabel}</button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default PatientForm;
