import { useState, type ClipboardEvent } from "react";
import { formatClinicalDocumentDraft } from "../clinicalDocumentFormat";
import { generateClinicalDocument } from "../firebase/aiService";
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
  const [admissionNoteSource, setAdmissionNoteSource] = useState("");
  const [deidentifiedConfirmed, setDeidentifiedConfirmed] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationError, setGenerationError] = useState("");

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

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error ?? "Unknown error");
  }

  async function generateAdmissionSummary(sourceText = admissionNoteSource) {
    const text = sourceText.trim();
    setGenerationError("");
    setGenerationStatus("");

    if (!deidentifiedConfirmed) {
      setGenerationError("Confirm the pasted admission note is de-identified before AI generation.");
      return;
    }

    if (text.length < 40) {
      setGenerationError("Paste a longer de-identified admission note before generating a summary.");
      return;
    }

    setGeneratingSummary(true);
    try {
      const result = await generateClinicalDocument({
        patientId: patient.id,
        documentType: "admissionSummary",
        rawText: text,
        deidentifiedConfirmed: true,
        storeRawText: false,
      });
      const summary = formatClinicalDocumentDraft(result.draft);
      onChange({
        ...patient,
        generatedAdmissionSummary: summary,
        admissionBriefFreeText: patient.admissionBriefFreeText.trim() ? patient.admissionBriefFreeText : summary,
        oneLiner: patient.oneLiner.trim() ? patient.oneLiner : summary,
        updatedAt: new Date().toISOString(),
      });
      setGenerationStatus(`Admission summary generated. Review, edit, then Save. Draft: ${result.draftId}`);
    } catch (error) {
      setGenerationError(getErrorMessage(error));
    } finally {
      setGeneratingSummary(false);
    }
  }

  function handleAdmissionNotePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.trim()) return;
    setAdmissionNoteSource(pastedText);
    window.setTimeout(() => {
      void generateAdmissionSummary(pastedText);
    }, 0);
  }

  const hasGeneratedAdmissionDraft = patient.generatedAdmissionNote.trim() || patient.generatedAdmissionSummary.trim();

  return (
    <section className="panel">
      <h2>Admission Brief / Initial Presentation</h2>
      <p className="muted">Clinician-reviewed admission data. Daily SOAP remains separate.</p>
      <div className="form-grid">
        <div className="span-2 admission-auto-summary">
          <div className="section-heading">
            <div>
              <h3>Paste Admission Note</h3>
              <p className="muted">After de-identification is confirmed, pasting here generates an admission summary draft automatically.</p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={generatingSummary || admissionNoteSource.trim().length < 40}
              onClick={() => void generateAdmissionSummary()}
            >
              {generatingSummary ? "Generating..." : "Generate summary"}
            </button>
          </div>
          <label className="checkbox-label ai-checkbox">
            <input
              type="checkbox"
              checked={deidentifiedConfirmed}
              onChange={(event) => setDeidentifiedConfirmed(event.target.checked)}
            />
            I confirm the pasted admission note is de-identified.
          </label>
          <textarea
            className="admission-note-paste"
            value={admissionNoteSource}
            onChange={(event) => setAdmissionNoteSource(event.target.value)}
            onPaste={handleAdmissionNotePaste}
            placeholder="Paste de-identified admission note / H&P here. Do not paste name, full MRN, ID, birthday, phone, address, or identifiable image details."
          />
          {generationError && <p className="error-message">{generationError}</p>}
          {generationStatus && <p className="status-message">{generationStatus}</p>}
        </div>

        <label className="span-2">
          Admission Summary
          <ColorMarkupTextarea
            value={patient.admissionBriefFreeText || patient.generatedAdmissionSummary}
            onChange={(value) => updateField("admissionBriefFreeText", value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="AI-generated or clinician-written short admission summary for rounds."
          />
        </label>

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

        <details className="admission-structured-details span-2">
          <summary>Structured H&P fields</summary>
          <div className="form-grid compact-form-grid">
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
          </div>
        </details>

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
