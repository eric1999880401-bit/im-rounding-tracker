import type { Patient } from "../types";
import SmartLabPanel from "./SmartLabPanel";

interface DailyNoteFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function DailyNoteForm({
  patient,
  onChange,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: DailyNoteFormProps) {
  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value, updatedAt: new Date().toISOString() });
  }

  function updateLabs(rawValue: string, parsedLabItems = patient.parsedLabItems) {
    onChange({
      ...patient,
      newLabs: rawValue,
      rawLabText: rawValue,
      parsedLabItems,
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
      <h2>Quick Daily Update</h2>
      <div className="form-grid">
        <label className="span-2">
          Overnight Event
          <textarea
            value={patient.overnightEvent}
            onChange={(event) => updateField("overnightEvent", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Example: No acute overnight event; fever at 02:00; oxygen increased..."
          />
        </label>
        <label className="span-2">
          S - Subjective / Chief Concern
          <textarea
            value={patient.subjectiveOrChiefConcern}
            onChange={(event) => updateField("subjectiveOrChiefConcern", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label className="span-2">
          Important / Red Flags
          <textarea
            value={patient.importantRedFlags}
            onChange={(event) => updateField("importantRedFlags", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Example: ! unstable BP; ! high fall risk"
          />
        </label>
        <label className="span-2">
          O - PE / Physical Examination
          <textarea
            value={patient.physicalExam}
            onChange={(event) => updateField("physicalExam", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Example: Clear breathing sounds; mild pitting edema"
          />
        </label>
        <div className="span-2">
          <SmartLabPanel
            rawValue={patient.rawLabText || patient.newLabs}
            items={patient.parsedLabItems}
            onChange={updateLabs}
            onFieldBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </div>
        <label>
          O - Important Imaging / Studies
          <textarea
            value={patient.newImaging}
            onChange={(event) => updateField("newImaging", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label>
          A - Assessment
          <textarea
            value={patient.assessment}
            onChange={(event) => updateField("assessment", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label>
          P - Plan
          <textarea
            value={patient.plan}
            onChange={(event) => updateField("plan", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label className="span-2">
          Discharge Plan
          <textarea
            value={patient.dischargePlan}
            onChange={(event) => updateField("dischargePlan", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Example: Home with clinic follow-up after oxygen wean."
          />
        </label>
        <div className="span-2 discharge-checklist">
          <h3>Discharge Readiness Checklist</h3>
          {[
            ["dischargeMedsStatus", "\u51fa\u9662\u5e36\u85e5 / Discharge meds"],
            ["opdAppointmentStatus", "\u9810\u7d04\u9580\u8a3a / OPD appointment"],
            ["diagnosisCertificateStatus", "\u8a3a\u65b7\u66f8 / Diagnosis certificate"],
          ].map(([field, label]) => (
            <label key={field}>
              {label}
              <select
                value={patient[field as keyof Patient] as string}
                onChange={(event) => updateField(field as keyof Patient, event.target.value as Patient[keyof Patient])}
                onBlur={commitOnBlur}
              >
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                <option value="notNeeded">Not needed</option>
              </select>
            </label>
          ))}
        </div>
        <label>
          Discharge Target Date
          <input
            type="date"
            value={patient.dischargeTargetDate}
            onChange={(event) => updateField("dischargeTargetDate", event.target.value)}
            onBlur={commitOnBlur}
          />
        </label>
        <label>
          Discharge Barriers
          <textarea
            value={patient.dischargeBarriers}
            onChange={(event) => updateField("dischargeBarriers", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label>
          Special Attention
          <textarea
            value={patient.specialAttention}
            onChange={(event) => updateField("specialAttention", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
        <label>
          VS Order
          <input
            value={patient.vsOrder}
            onChange={(event) => updateField("vsOrder", event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </label>
      </div>
    </section>
  );
}

export default DailyNoteForm;
