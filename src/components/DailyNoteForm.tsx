import type { ImageStudyEntry, LabReport, Patient, PhysicalExamEntry } from "../types";
import AssessmentPlanBuilder from "./AssessmentPlanBuilder";
import ColorMarkupTextarea from "./ColorMarkupTextarea";
import SmartLabPanel from "./SmartLabPanel";
import AssessmentPlanDisplay from "./AssessmentPlanDisplay";
import { ClinicalText } from "./ClinicalText";
import { LabChips } from "./LabChips";
import { useT } from "../i18n";
import type { PatientDisplaySummary } from "../utils";

interface DailyNoteFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  section?: "all" | "quick" | "objective" | "assessmentPlan" | "discharge";
  displaySummary?: PatientDisplaySummary;
  onFieldBlur?: () => void;
  onImmediateCommit?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function DailyNoteForm({
  patient,
  onChange,
  section = "all",
  displaySummary,
  onFieldBlur,
  onImmediateCommit,
  onCompositionStart,
  onCompositionEnd,
}: DailyNoteFormProps) {
  const t = useT();
  const showQuick = section === "all" || section === "quick";
  const showObjective = section === "all" || section === "objective";
  const showAssessmentPlan = section === "all" || section === "assessmentPlan";
  const showDischarge = section === "all" || section === "discharge";

  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value, updatedAt: new Date().toISOString() });
  }

  function updateLabs(rawValue: string, parsedLabItems = patient.parsedLabItems, labReports = patient.labReports) {
    onChange({
      ...patient,
      newLabs: rawValue,
      rawLabText: rawValue,
      parsedLabItems,
      labReports,
      updatedAt: new Date().toISOString(),
    });
  }

  function updateLabMeta(labDate: string, labReportTitle: string, labReports: LabReport[], selectedRawValue?: string) {
    onChange({
      ...patient,
      labDate,
      labReportTitle,
      ...(selectedRawValue !== undefined
        ? {
            newLabs: selectedRawValue,
            rawLabText: selectedRawValue,
          }
        : {}),
      labReports,
      parsedLabItems: labReports.flatMap((report) => report.items),
      updatedAt: new Date().toISOString(),
    });
  }

  function addPhysicalExamEntry() {
    const nextEntry: PhysicalExamEntry = {
      id: `pe-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      system: "",
      finding: "",
      isImportant: false,
      color: "",
      note: "",
    };
    updateField("physicalExamEntries", [...patient.physicalExamEntries, nextEntry]);
  }

  function updatePhysicalExamEntry(index: number, entry: PhysicalExamEntry) {
    updateField(
      "physicalExamEntries",
      patient.physicalExamEntries.map((item, itemIndex) => (itemIndex === index ? entry : item)),
    );
  }

  function removePhysicalExamEntry(index: number) {
    updateField(
      "physicalExamEntries",
      patient.physicalExamEntries.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function addImageStudyEntry() {
    const nextEntry: ImageStudyEntry = {
      id: `img-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      studyType: "",
      finding: "",
      impression: "",
      isImportant: false,
      color: "",
      note: "",
    };
    updateField("imageStudyEntries", [...patient.imageStudyEntries, nextEntry]);
  }

  function updateImageStudyEntry(index: number, entry: ImageStudyEntry) {
    updateField(
      "imageStudyEntries",
      patient.imageStudyEntries.map((item, itemIndex) => (itemIndex === index ? entry : item)),
    );
  }

  function removeImageStudyEntry(index: number) {
    updateField(
      "imageStudyEntries",
      patient.imageStudyEntries.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function commitOnBlur() {
    onFieldBlur?.();
  }

  function handleCompositionEnd() {
    onCompositionEnd?.();
  }

  return (
    <section className="panel">
      <h2>
        {section === "quick" && "Quick Daily Update"}
        {section === "objective" && "Objective"}
        {section === "assessmentPlan" && "Assessment / Plan"}
        {section === "discharge" && "Discharge"}
        {section === "all" && "Daily SOAP"}
      </h2>
      <div className="form-grid">
        {showQuick && (
          <>
            {displaySummary && (
              <div className="span-2 auto-summary-panel">
                <div className="section-heading">
                  <h3>Auto Summary</h3>
                  {displaySummary.sourceLabels.todayNoteIsEmpty && (
                    <span className="badge normal">Today note is empty. Showing latest saved data.</span>
                  )}
                </div>
                <div className="auto-summary-grid">
                  {displaySummary.redFlags.trim() && (
                    <div className="auto-summary-item important-line">
                      <strong>Red Flags</strong>
                      <ClinicalText value={displaySummary.redFlags} importantDefault />
                    </div>
                  )}
                  <div className="auto-summary-item">
                    <strong>Sx</strong>
                    <ClinicalText value={displaySummary.subjective} />
                  </div>
                  <div className="auto-summary-item">
                    <strong>PE</strong>
                    <ClinicalText value={displaySummary.physicalExam} />
                    {displaySummary.physicalExamEntries.length > 0 && (
                      <div className="objective-chip-row">
                        {displaySummary.physicalExamEntries.map((entry) => (
                          <span className={`objective-chip ${entry.isImportant ? "important-objective-chip" : ""}`} key={entry.id}>
                            {entry.system && <span className="objective-chip-label">{entry.system}</span>}
                            {entry.finding || entry.note}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="auto-summary-item">
                    <strong>Latest labs</strong>
                    <LabChips items={displaySummary.latestLabs.items} />
                    {!displaySummary.latestLabs.items.length && <ClinicalText value={displaySummary.latestLabs.text} />}
                  </div>
                  <div className="auto-summary-item">
                    <strong>Latest imaging</strong>
                    <ClinicalText value={displaySummary.latestImages.text} />
                    {displaySummary.latestImages.entries.length > 0 && (
                      <div className="objective-chip-row">
                        {displaySummary.latestImages.entries.map((entry) => (
                          <span className={`objective-chip ${entry.isImportant ? "important-objective-chip" : ""}`} key={entry.id}>
                            {entry.studyType && <span className="objective-chip-label">{entry.studyType}</span>}
                            {entry.impression || entry.finding || entry.note}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="auto-summary-item span-2">
                    <strong>A/P</strong>
                    <AssessmentPlanDisplay
                      items={displaySummary.assessmentPlanItems}
                      legacyAssessment={displaySummary.assessment}
                      legacyPlan={displaySummary.plan}
                      compact
                    />
                  </div>
                  <div className="auto-summary-item">
                    <strong>Pending tasks</strong>
                    {displaySummary.tasks.filter((task) => !task.done).length > 0 ? (
                      displaySummary.tasks.filter((task) => !task.done).map((task) => (
                        <div className={task.priority === "urgent" ? "important-line" : "muted"} key={task.id}>
                          {task.text}
                        </div>
                      ))
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </div>
                  <div className="auto-summary-item">
                    <strong>Discharge</strong>
                    <div className="muted">
                      Meds: {displaySummary.dischargeChecklist.meds} / OPD: {displaySummary.dischargeChecklist.opd} / Cert: {displaySummary.dischargeChecklist.certificate}
                    </div>
                    <ClinicalText value={displaySummary.dischargePlan} />
                  </div>
                </div>
              </div>
            )}
            <h3 className="span-2">Today Addendum</h3>
            <label className="span-2">
              {t("field.redFlags")}
              <ColorMarkupTextarea
                className="important-input"
                value={patient.importantRedFlags}
                onChange={(value) => updateField("importantRedFlags", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder="Example: unstable BP; high fall risk. Everything here displays as important."
              />
            </label>
            <label className="span-2">
              Overnight event
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
              Today subjective change
              <ColorMarkupTextarea
                value={patient.subjectiveOrChiefConcern}
                onChange={(value) => updateField("subjectiveOrChiefConcern", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </label>
            <label className="span-2">
              Today PE change
              <ColorMarkupTextarea
                value={patient.physicalExam}
                onChange={(value) => updateField("physicalExam", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder="Example: Clear breathing sounds; mild pitting edema"
              />
            </label>
            <label className="span-2">
              Quick Lab Summary
              <ColorMarkupTextarea
                value={patient.newLabs}
                onChange={(value) => updateLabs(value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </label>
            <label className="span-2">
              Quick Image Summary
              <ColorMarkupTextarea
                value={patient.newImaging}
                onChange={(value) => updateField("newImaging", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </label>
          </>
        )}

        {showObjective && (
          <>
            <div className="span-2 objective-entry-panel">
              <div className="objective-entry-heading">
                <strong>{t("field.pe")}</strong>
                <button type="button" className="secondary" onClick={addPhysicalExamEntry}>
                  Add PE entry
                </button>
              </div>
              {patient.physicalExamEntries.map((entry, index) => (
                <div className="objective-entry-grid" key={entry.id || index}>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) => updatePhysicalExamEntry(index, { ...entry, date: event.target.value })}
                    onBlur={commitOnBlur}
                  />
                  <input
                    value={entry.system}
                    onChange={(event) => updatePhysicalExamEntry(index, { ...entry, system: event.target.value })}
                    onBlur={commitOnBlur}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="System"
                  />
                  <input
                    value={entry.finding}
                    onChange={(event) => updatePhysicalExamEntry(index, { ...entry, finding: event.target.value })}
                    onBlur={commitOnBlur}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="Finding"
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={entry.isImportant}
                      onChange={(event) => updatePhysicalExamEntry(index, { ...entry, isImportant: event.target.checked })}
                    />
                    Important
                  </label>
                  <button type="button" className="secondary" onClick={() => removePhysicalExamEntry(index)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="span-2">
              <SmartLabPanel
                rawValue={patient.rawLabText || patient.newLabs}
                labDate={patient.labDate}
                labReportTitle={patient.labReportTitle}
                items={patient.parsedLabItems}
                labReports={patient.labReports}
                onChange={updateLabs}
                onMetaChange={updateLabMeta}
                onImmediateCommit={onImmediateCommit}
                onFieldBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </div>
            <label className="span-2">
              O - {t("field.image")}
              <ColorMarkupTextarea
                value={patient.newImaging}
                onChange={(value) => updateField("newImaging", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </label>
            <div className="span-2 objective-entry-panel">
              <div className="objective-entry-heading">
                <strong>{t("field.image")}</strong>
                <button type="button" className="secondary" onClick={addImageStudyEntry}>
                  Add image
                </button>
              </div>
              {patient.imageStudyEntries.map((entry, index) => (
                <div className="objective-entry-grid single-column" key={entry.id || index}>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) => updateImageStudyEntry(index, { ...entry, date: event.target.value })}
                    onBlur={commitOnBlur}
                  />
                  <input
                    value={entry.studyType}
                    onChange={(event) => updateImageStudyEntry(index, { ...entry, studyType: event.target.value })}
                    onBlur={commitOnBlur}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="Study"
                  />
                  <input
                    value={entry.impression}
                    onChange={(event) => updateImageStudyEntry(index, { ...entry, impression: event.target.value })}
                    onBlur={commitOnBlur}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    placeholder="Impression"
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={entry.isImportant}
                      onChange={(event) => updateImageStudyEntry(index, { ...entry, isImportant: event.target.checked })}
                    />
                    Important
                  </label>
                  <button type="button" className="secondary" onClick={() => removeImageStudyEntry(index)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {showAssessmentPlan && (
          <div className="span-2">
            <AssessmentPlanBuilder
              items={patient.assessmentPlanItems}
              legacyAssessment={patient.assessment}
              legacyPlan={patient.plan}
              onChange={(items) => updateField("assessmentPlanItems", items)}
              onLegacyAssessmentChange={(value) => updateField("assessment", value)}
              onLegacyPlanChange={(value) => updateField("plan", value)}
              onFieldBlur={commitOnBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
          </div>
        )}

        {showDischarge && (
          <>
            <label className="span-2">
              {t("field.dischargePlan")}
              <ColorMarkupTextarea
                value={patient.dischargePlan}
                onChange={(value) => updateField("dischargePlan", value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder="Example: Home with clinic follow-up after oxygen wean."
              />
            </label>
            <div className="span-2 discharge-checklist">
              <h3>{t("dc.upcoming")}</h3>
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
                    <option value="pending">{t("dc.pending")}</option>
                    <option value="done">{t("dc.done")}</option>
                    <option value="notNeeded">{t("dc.notNeeded")}</option>
                  </select>
                </label>
              ))}
            </div>
            <label>
              {t("field.dischargeTarget")}
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
              {t("field.vsOrder")}
              <input
                value={patient.vsOrder}
                onChange={(event) => updateField("vsOrder", event.target.value)}
                onBlur={commitOnBlur}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
            </label>
          </>
        )}
      </div>
    </section>
  );
}

export default DailyNoteForm;
