import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { applyClinicalKnowledgeToText, formatRuleBasedAdmissionSummary } from "../clinicalKnowledge";
import { formatClinicalDocumentDraft } from "../clinicalDocumentFormat";
import { generateClinicalDocument } from "../firebase/aiService";
import { canApplyPatientRequest, isLatestRequest, type PatientRequestIdentity } from "../asyncRequestGuard";
import {
  bindDeidentifiedConfirmation,
  createAiPrivacyContextFingerprint,
  isDeidentifiedConfirmationCurrent,
} from "../aiPrivacyConfirmation";
import { applyVisibleAdmissionSummaryEdit } from "../admissionBriefPersistence";
import { stripMarkdownEmphasis, textToItems } from "../utils";
import type { Patient } from "../types";
import ColorMarkupTextarea from "./ColorMarkupTextarea";
import DeidNotice from "./DeidNotice";

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
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [confirmedPrivacyFingerprint, setConfirmedPrivacyFingerprint] = useState("");
  const latestGenerationRequestRef = useRef(0);
  const currentPatientRef = useRef(patient);
  const onChangeRef = useRef(onChange);
  currentPatientRef.current = patient;
  onChangeRef.current = onChange;
  const displayedAdmissionSummary = stripMarkdownEmphasis(patient.admissionBriefFreeText || patient.generatedAdmissionSummary);
  const privacyContextFingerprint = useMemo(
    () => createAiPrivacyContextFingerprint(admissionNoteSource, patient),
    [admissionNoteSource, patient],
  );
  const deidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
    confirmedPrivacyFingerprint,
    privacyContextFingerprint,
  );

  useEffect(() => {
    latestGenerationRequestRef.current += 1;
    setAdmissionNoteSource("");
    setGeneratingSummary(false);
    setGenerationStatus("");
    setGenerationError("");
    setConfirmedPrivacyFingerprint("");
  }, [patient.id]);

  useEffect(() => {
    setConfirmedPrivacyFingerprint("");
  }, [privacyContextFingerprint]);

  function updateField<K extends keyof Patient>(field: K, value: Patient[K]) {
    onChange({ ...patient, [field]: value, updatedAt: new Date().toISOString() });
  }

  function updateUnderlyingDiseases(value: string) {
    onChange({
      ...patient,
      underlyingDiseases: value,
      underlyingDiseaseItems: textToItems(value),
      admissionPMH: value,
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
    return summaryLines.slice(0, 5).join(" ");
  }

  function buildLocalAdmissionSummary(sourceText: string) {
    const plan = applyClinicalKnowledgeToText(sourceText);
    // 3-minute oral presentation format is the default admission summary output.
    const summary = formatRuleBasedAdmissionSummary(plan, { length: "threeMinute" }) || formatRuleBasedAdmissionSummary(plan);
    return summary || compactAdmissionLine(sourceText) || sourceText.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  async function generateAdmissionSummary(sourceText = admissionNoteSource, requestPatientId = patient.id) {
    if (requestPatientId !== currentPatientRef.current.id) return;
    const text = sourceText.trim();
    const requestPrivacyFingerprint = createAiPrivacyContextFingerprint(sourceText, currentPatientRef.current);
    const requestDeidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
      confirmedPrivacyFingerprint,
      requestPrivacyFingerprint,
    );
    const request: PatientRequestIdentity = {
      requestId: latestGenerationRequestRef.current + 1,
      patientId: requestPatientId,
    };
    latestGenerationRequestRef.current = request.requestId;
    const canApplyRequest = () =>
      canApplyPatientRequest(
        request,
        latestGenerationRequestRef.current,
        currentPatientRef.current.id,
      );

    setGenerationError("");
    setGenerationStatus("");

    if (text.length < 40) {
      setGeneratingSummary(false);
      setGenerationError("Paste a longer de-identified admission note before generating a summary.");
      return;
    }

    if (!isDemoMode && !requestDeidentifiedConfirmed) {
      setGeneratingSummary(false);
      setGenerationError("Confirm that the pasted source and selected patient context are de-identified before sending them to external AI.");
      return;
    }

    setGeneratingSummary(true);
    try {
      if (isDemoMode) {
        const summary = buildLocalAdmissionSummary(text);
        if (!canApplyRequest()) return;
        onChangeRef.current(applyVisibleAdmissionSummaryEdit(currentPatientRef.current, summary));
        setGenerationStatus("Demo admission summary generated locally. Review, edit, then Save.");
      } else {
        const result = await generateClinicalDocument({
          patientId: request.patientId,
          documentType: "admissionSummary",
          rawText: text,
          deidentifiedConfirmed: requestDeidentifiedConfirmed,
          storeRawText: false,
        });
        if (!canApplyRequest()) return;
        const summary = formatClinicalDocumentDraft(result.draft);
        onChangeRef.current(applyVisibleAdmissionSummaryEdit(currentPatientRef.current, summary));
        setGenerationStatus(`Admission summary generated. Review, edit, then Save. Draft: ${result.draftId}`);
      }
    } catch (error) {
      if (!canApplyRequest()) return;
      const fallbackSummary = buildLocalAdmissionSummary(text);
      onChangeRef.current(applyVisibleAdmissionSummaryEdit(currentPatientRef.current, fallbackSummary));
      setGenerationError(`${getErrorMessage(error)} Local 3-min oral brief was generated for review.`);
    } finally {
      if (isLatestRequest(request, latestGenerationRequestRef.current)) setGeneratingSummary(false);
    }
  }

  function replaceAdmissionNoteSource(value: string) {
    latestGenerationRequestRef.current += 1;
    setGeneratingSummary(false);
    setGenerationStatus("");
    setGenerationError("");
    setConfirmedPrivacyFingerprint("");
    setAdmissionNoteSource(value);
  }

  function shouldTreatPasteAsAdmissionNote(value: string) {
    const text = value.trim();
    if (text.length < 80) return false;
    return /\b(admission|admitted|hpi|chief|pmh|diagnosis|assessment|plan|hospital course|v\/s|lab|image|ct|cxr|wbc|hb|cr)\b/i.test(text);
  }

  function handleAdmissionNotePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.trim()) return;
    const pastePatientId = patient.id;
    event.preventDefault();
    replaceAdmissionNoteSource(pastedText);
    if (isDemoMode) {
      window.setTimeout(() => {
        void generateAdmissionSummary(pastedText, pastePatientId);
      }, 0);
    } else {
      setGenerationStatus("Source changed. Review it, confirm de-identification, then generate the summary.");
    }
  }

  function handleAdmissionSummaryPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData("text");
    if (!shouldTreatPasteAsAdmissionNote(pastedText)) return;
    const pastePatientId = patient.id;
    event.preventDefault();
    replaceAdmissionNoteSource(pastedText);
    if (isDemoMode) {
      window.setTimeout(() => {
        void generateAdmissionSummary(pastedText, pastePatientId);
      }, 0);
    } else {
      setGenerationStatus("Source changed. Review it, confirm de-identification, then generate the summary.");
    }
  }

  return (
    <section className="panel">
      <h2>Admission Brief / Initial Presentation</h2>
      <div className="form-grid">
        <div className="span-2 admission-auto-summary">
          <div className="section-heading">
            <div>
              <h3>Paste Admission Note</h3>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={generatingSummary || admissionNoteSource.trim().length < 40 || (!isDemoMode && !deidentifiedConfirmed)}
              onClick={() => void generateAdmissionSummary()}
            >
              {generatingSummary ? "Generating..." : "Generate summary"}
            </button>
          </div>
          <DeidNotice />
          {!isDemoMode && (
            <label className="checkbox-label ai-checkbox">
              <input
                type="checkbox"
                checked={deidentifiedConfirmed}
                onChange={(event) =>
                  setConfirmedPrivacyFingerprint(
                    bindDeidentifiedConfirmation(event.target.checked, privacyContextFingerprint),
                  )
                }
              />
              I confirm the pasted source and selected patient context contain no direct identifiers and may be sent to external AI.
            </label>
          )}
          <textarea
            className="admission-note-paste"
            value={admissionNoteSource}
            onChange={(event) => replaceAdmissionNoteSource(event.target.value)}
            onPaste={handleAdmissionNotePaste}
            placeholder="Paste de-identified admission note / H&P"
          />
          {generationError && <p className="error-message">{generationError}</p>}
          {generationStatus && <p className="status-message">{generationStatus}</p>}
        </div>

        <label className="span-2">
          PHx / PMH
          <textarea
            value={patient.underlyingDiseases}
            onChange={(event) => updateUnderlyingDiseases(event.target.value)}
            onBlur={commitOnBlur}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Example: T2DM, HTN, CKD3, CAD, old CVA"
          />
        </label>

        <label className="span-2">
          Admission Summary
          
          <ColorMarkupTextarea
            value={displayedAdmissionSummary}
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
