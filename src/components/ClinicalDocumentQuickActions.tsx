import { useMemo, useState } from "react";
import { formatClinicalDocumentDraft } from "../clinicalDocumentFormat";
import { generateClinicalDocument } from "../firebase/aiService";
import type { AiDocumentDraft, AiDocumentType, DailyNote, Patient } from "../types";
import { nowIso } from "../utils";

interface ClinicalDocumentQuickActionsProps {
  patient: Patient;
  notes?: DailyNote[];
  selectedDate: string;
  onSavePatient: (patient: Patient) => Promise<void>;
}

type QuickDocumentType = Extract<AiDocumentType, "weeklySummary" | "isbar">;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function dateDaysBefore(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function documentLabel(documentType: QuickDocumentType) {
  return documentType === "weeklySummary" ? "Weekly Summary" : "SBAR";
}

function saveDocumentToPatient(patient: Patient, documentType: QuickDocumentType, editableText: string): Patient {
  const now = nowIso();
  if (documentType === "weeklySummary") {
    return { ...patient, generatedWeeklySummary: editableText, updatedAt: now };
  }

  return { ...patient, generatedSbarNote: editableText, updatedAt: now };
}

function ClinicalDocumentQuickActions({
  patient,
  notes = [],
  selectedDate,
  onSavePatient,
}: ClinicalDocumentQuickActionsProps) {
  const [deidentifiedConfirmed, setDeidentifiedConfirmed] = useState(false);
  const [loadingType, setLoadingType] = useState<QuickDocumentType | "">("");
  const [draft, setDraft] = useState<AiDocumentDraft | null>(null);
  const [editableText, setEditableText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const dateFrom = useMemo(() => dateDaysBefore(selectedDate, 6), [selectedDate]);
  const weeklyNoteCount = useMemo(
    () => notes.filter((note) => (!dateFrom || note.date >= dateFrom) && note.date <= selectedDate).length,
    [notes, dateFrom, selectedDate],
  );

  async function generateDraft(documentType: QuickDocumentType) {
    setError("");
    setStatusMessage("");

    if (!deidentifiedConfirmed) {
      setError("Confirm selected patient notes are de-identified before AI generation.");
      return;
    }

    setLoadingType(documentType);
    try {
      const result = await generateClinicalDocument({
        patientId: patient.id,
        documentType,
        rawText: "",
        dateFrom: documentType === "weeklySummary" ? dateFrom : "",
        dateTo: documentType === "weeklySummary" ? selectedDate : "",
        deidentifiedConfirmed: true,
        storeRawText: false,
      });
      const formatted = formatClinicalDocumentDraft(result.draft);
      setDraft(result.draft);
      setEditableText(formatted);
      setStatusMessage(`${documentLabel(documentType)} generated. Review, edit, then save. Draft: ${result.draftId}`);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoadingType("");
    }
  }

  async function saveReviewedDraft() {
    if (!draft || !editableText.trim()) return;
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      await onSavePatient(saveDocumentToPatient(patient, draft.documentType as QuickDocumentType, editableText));
      setStatusMessage(`${documentLabel(draft.documentType as QuickDocumentType)} saved to this patient.`);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel clinical-doc-quick-actions">
      <div className="section-heading">
        <div>
          <h2>Clinical Documents</h2>
          <p className="muted">Generate concise review drafts using standard SBAR and progress-summary structure.</p>
        </div>
      </div>

      <label className="checkbox-label ai-checkbox">
        <input
          type="checkbox"
          checked={deidentifiedConfirmed}
          onChange={(event) => setDeidentifiedConfirmed(event.target.checked)}
        />
        I confirm this patient's selected notes are de-identified before AI generation.
      </label>

      <div className="clinical-doc-action-grid">
        <button
          type="button"
          disabled={Boolean(loadingType)}
          onClick={() => void generateDraft("weeklySummary")}
        >
          {loadingType === "weeklySummary" ? "Generating..." : "Generate Weekly Summary"}
        </button>
        <div className="muted">
          Last 7 days through {selectedDate}; {weeklyNoteCount} SOAP note(s) in range.
        </div>

        <button
          type="button"
          disabled={Boolean(loadingType)}
          onClick={() => void generateDraft("isbar")}
        >
          {loadingType === "isbar" ? "Generating..." : "Generate SBAR"}
        </button>
        <div className="muted">Situation / Background / Assessment / Recommendation handoff.</div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {statusMessage && <p className="status-message">{statusMessage}</p>}

      {draft && (
        <label>
          Reviewed {documentLabel(draft.documentType as QuickDocumentType)}
          <textarea
            className="ai-document-editor clinical-doc-editor"
            value={editableText}
            onChange={(event) => setEditableText(event.target.value)}
          />
        </label>
      )}

      {draft && (
        <div className="form-actions">
          <button type="button" disabled={saving || !editableText.trim()} onClick={() => void saveReviewedDraft()}>
            {saving ? "Saving..." : `Save reviewed ${documentLabel(draft.documentType as QuickDocumentType)}`}
          </button>
        </div>
      )}
    </section>
  );
}

export default ClinicalDocumentQuickActions;
