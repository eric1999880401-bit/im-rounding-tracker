import type { Patient } from "../types";

interface DailyNoteFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
}

function DailyNoteForm({ patient, onChange }: DailyNoteFormProps) {
  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value, updatedAt: new Date().toISOString() });
  }

  return (
    <section className="panel">
      <h2>Quick Daily Update</h2>
      <div className="form-grid">
        <label className="span-2">
          Overnight Event
          <textarea
            value={patient.overnightEvent}
            onChange={(event) => updateField("overnightEvent", event.target.value)}
            placeholder="Example: No acute overnight event; fever at 02:00; oxygen increased..."
          />
        </label>
        <label className="span-2">
          Subjective / Chief Concern
          <textarea
            value={patient.subjectiveOrChiefConcern}
            onChange={(event) => updateField("subjectiveOrChiefConcern", event.target.value)}
          />
        </label>
        <label>
          New Labs
          <textarea
            value={patient.newLabs}
            onChange={(event) => updateField("newLabs", event.target.value)}
          />
        </label>
        <label>
          New Imaging
          <textarea
            value={patient.newImaging}
            onChange={(event) => updateField("newImaging", event.target.value)}
          />
        </label>
        <label>
          Assessment
          <textarea
            value={patient.assessment}
            onChange={(event) => updateField("assessment", event.target.value)}
          />
        </label>
        <label>
          Plan
          <textarea value={patient.plan} onChange={(event) => updateField("plan", event.target.value)} />
        </label>
        <label className="span-2">
          Discharge Plan
          <textarea
            value={patient.dischargePlan}
            onChange={(event) => updateField("dischargePlan", event.target.value)}
            placeholder="Example: Home with clinic follow-up after oxygen wean."
          />
        </label>
        <label>
          Discharge Target Date
          <input
            type="date"
            value={patient.dischargeTargetDate}
            onChange={(event) => updateField("dischargeTargetDate", event.target.value)}
          />
        </label>
        <label>
          Discharge Barriers
          <textarea
            value={patient.dischargeBarriers}
            onChange={(event) => updateField("dischargeBarriers", event.target.value)}
          />
        </label>
        <label>
          Special Attention
          <textarea
            value={patient.specialAttention}
            onChange={(event) => updateField("specialAttention", event.target.value)}
          />
        </label>
        <label>
          VS Order
          <input value={patient.vsOrder} onChange={(event) => updateField("vsOrder", event.target.value)} />
        </label>
      </div>
    </section>
  );
}

export default DailyNoteForm;
