import type { FormEvent } from "react";
import type { Patient, PatientSex, PatientStatus } from "../types";

interface PatientFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
}

function PatientForm({ patient, onChange, onSubmit, submitLabel, onCancel }: PatientFormProps) {
  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <label>
        Bed
        <input value={patient.bed} onChange={(event) => updateField("bed", event.target.value)} />
      </label>

      <label>
        Patient Code
        <input
          required
          value={patient.patientCode}
          onChange={(event) => updateField("patientCode", event.target.value)}
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
        />
      </label>

      <label>
        Sex
        <select
          value={patient.sex}
          onChange={(event) => updateField("sex", event.target.value as PatientSex)}
        >
          <option value="M">M</option>
          <option value="F">F</option>
          <option value="Other">Other</option>
        </select>
      </label>

      <label>
        Admission Date
        <input
          type="date"
          value={patient.admissionDate}
          onChange={(event) => updateField("admissionDate", event.target.value)}
        />
      </label>

      <label>
        Status
        <select
          value={patient.status}
          onChange={(event) => updateField("status", event.target.value as PatientStatus)}
        >
          <option value="active">Active</option>
          <option value="discharged">Discharged</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <label className="span-2">
        Primary Diagnosis
        <input
          value={patient.primaryDiagnosis}
          onChange={(event) => updateField("primaryDiagnosis", event.target.value)}
        />
      </label>

      <label className="span-2">
        Active Problems
        <textarea
          value={patient.activeProblems}
          onChange={(event) => updateField("activeProblems", event.target.value)}
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
