import { useState, type ClipboardEvent } from "react";
import { formatClinicalDocumentDraft } from "../clinicalDocumentFormat";
import { generateClinicalDocument } from "../firebase/aiService";
import type { Patient } from "../types";
import ColorMarkupTextarea from "./ColorMarkupTextarea";

interface AdmissionBriefFormProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
  isDemoMode?: boolean;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function AdmissionBriefForm({
  patient,
  onChange,
  isDemoMode = false,
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

  function firstMatchingLine(text: string, pattern: RegExp) {
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .find((line) => pattern.test(line)) ?? "";
  }

  function compactAdmissionLine(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .filter((line) => !/^(?:name|mrn|id|birthday|phone|address)\s*:/i.test(line));
    const diagnosisLine = firstMatchingLine(text, /\b(dx|diagnosis|impression|admitted|admission|pna|pneumonia|sepsis|hf|stroke|cancer|infection)\b/i);
    const symptomLine = firstMatchingLine(text, /\b(chief|cc|fever|cough|dyspnea|sob|pain|weak|syncope|edema|bleed|melena)\b/i);
    const labLine = firstMatchingLine(text, /\b(wbc|hb|hgb|plt|cr|bun|na|k\b|lactate|crp|troponin|culture|b\/c|bcx)\b/i);
    const imageLine = firstMatchingLine(text, /\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|egd|scope|image|imaging)\b/i);
    const treatmentLine = firstMatchingLine(text, /\b(abx|antibiotic|cef|zosyn|pip\/tazo|meropenem|teicoplanin|vancomycin|oxygen|o2|lasix|diuretic|consult|opd|discharge|dc)\b/i);
    const summaryLines = [diagnosisLine || lines[0], symptomLine, labLine, imageLine, treatmentLine]
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return summaryLines.slice(0, 4).join(" ");
  }

  function buildLocalAdmissionSummary(sourceText: string) {
    const summary = compactAdmissionLine(sourceText);
    return summary || sourceText.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function buildAdmissionPatch(sourceText: string, summary: string): Patient {
    const now = new Date().toISOString();
    const chiefConcern = firstMatchingLine(sourceText, /\b(chief|cc|fever|cough|dyspnea|sob|pain|weak|syncope|edema|bleed|melena)\b/i)
      .replace(/^(?:chief complaint|chief concern|cc)\s*:\s*/i, "")
      .trim();
    const hpi = firstMatchingLine(sourceText, /\b(hpi|present illness|history|admitted|presented|progressive|started|for \d+\s*(?:day|week|month))\b/i)
      .replace(/^(?:hpi|pi|present illness|history of present illness)\s*:\s*/i, "")
      .trim();
    const pmh = firstMatchingLine(sourceText, /\b(pmh|past history|htn|dm|ckd|cad|hf|copd|af|stroke|cancer|scc)\b/i)
      .replace(/^(?:pmh|past medical history)\s*:\s*/i, "")
      .trim();
    const lab = firstMatchingLine(sourceText, /\b(wbc|hb|hgb|plt|cr|bun|na|k\b|lactate|crp|troponin|culture|b\/c|bcx)\b/i);
    const image = firstMatchingLine(sourceText, /\b(ct|mri|cxr|xray|x-ray|echo|sono|ultrasound|egd|scope|image|imaging)\b/i);
    return {
      ...patient,
      generatedAdmissionSummary: summary,
      admissionBriefFreeText: patient.admissionBriefFreeText.trim() ? patient.admissionBriefFreeText : summary,
      oneLiner: patient.oneLiner.trim() ? patient.oneLiner : summary,
      chiefComplaint: patient.chiefComplaint.trim() ? patient.chiefComplaint : chiefConcern,
      admissionChiefConcern: patient.admissionChiefConcern.trim() ? patient.admissionChiefConcern : chiefConcern,
      presentIllnessOrHPI: patient.presentIllnessOrHPI.trim() ? patient.presentIllnessOrHPI : hpi,
      hpiOrAdmissionStory: patient.hpiOrAdmissionStory.trim() ? patient.hpiOrAdmissionStory : hpi,
      admissionPMH: patient.admissionPMH.trim() ? patient.admissionPMH : pmh,
      initialLabs: patient.initialLabs.trim() ? patient.initialLabs : lab,
      initialImaging: patient.initialImaging.trim() ? patient.initialImaging : image,
      showAdmissionBriefOnPrint: true,
      updatedAt: now,
    };
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
      if (isDemoMode) {
        const summary = buildLocalAdmissionSummary(text);
        onChange(buildAdmissionPatch(text, summary));
        setGenerationStatus("Demo admission summary generated locally. Review, edit, then Save.");
      } else {
        const result = await generateClinicalDocument({
          patientId: patient.id,
          documentType: "admissionSummary",
          rawText: text,
          deidentifiedConfirmed: true,
          storeRawText: false,
        });
        const summary = formatClinicalDocumentDraft(result.draft);
        onChange(buildAdmissionPatch(text, summary));
        setGenerationStatus(`Admission summary generated. Review, edit, then Save. Draft: ${result.draftId}`);
      }
    } catch (error) {
      setGenerationError(getErrorMessage(error));
    } finally {
      setGeneratingSummary(false);
    }
  }

  function shouldTreatPasteAsAdmissionNote(value: string) {
    const text = value.trim();
    if (text.length < 80) return false;
    return /\b(admission|admitted|hpi|chief|pmh|diagnosis|assessment|plan|hospital course|v\/s|lab|image|ct|cxr|wbc|hb|cr)\b/i.test(text);
  }

  function handleAdmissionNotePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.trim()) return;
    event.preventDefault();
    setAdmissionNoteSource(pastedText);
    window.setTimeout(() => {
      void generateAdmissionSummary(pastedText);
    }, 0);
  }

  function handleAdmissionSummaryPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!shouldTreatPasteAsAdmissionNote(pastedText)) return;
    event.preventDefault();
    setAdmissionNoteSource(pastedText);
    setGenerationStatus("");
    setGenerationError("");
    window.setTimeout(() => {
      void generateAdmissionSummary(pastedText);
    }, 0);
  }

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
          <span className="field-hint">You can paste a full admission note here too; it will be converted into a short summary after de-identification is confirmed.</span>
          <ColorMarkupTextarea
            value={patient.admissionBriefFreeText || patient.generatedAdmissionSummary}
            onChange={(value) => updateField("admissionBriefFreeText", value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPaste={handleAdmissionSummaryPaste}
            placeholder="AI-generated or clinician-written short admission summary for rounds."
          />
        </label>
      </div>
    </section>
  );
}

export default AdmissionBriefForm;
