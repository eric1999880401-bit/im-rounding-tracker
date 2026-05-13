import { useMemo, useState } from "react";
import { generateClinicalDocument } from "../firebase/aiService";
import type { AiDocumentDraft, AiDocumentType, DailyNotesByPatient, Patient } from "../types";
import { getAdmissionSummaryText, nowIso, todayKey } from "../utils";

const OTHER_PATIENT_ID = "__other_patient__";

interface AiDocumentsPageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  onSavePatient: (patient: Patient) => Promise<void>;
}

const documentOptions: Array<{ value: AiDocumentType; label: string; helper: string }> = [
  {
    value: "admissionNote",
    label: "Admission note",
    helper: "Paste ED/OPD note, V/S, lab, imaging, consult, and nursing notes.",
  },
  {
    value: "admissionSummary",
    label: "Admission summary",
    helper: "Short attending-rounds presentation from admission data.",
  },
  {
    value: "dischargeHospitalCourse",
    label: "Discharge hospital course",
    helper: "Draft hospital course from admission data and SOAP history.",
  },
  {
    value: "weeklySummary",
    label: "Weekly summary",
    helper: "Select a SOAP date range and summarize progress.",
  },
  {
    value: "isbar",
    label: "iSBAR handoff",
    helper: "Generate Identify, Situation, Background, Assessment, Recommendation.",
  },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function sectionContent(draft: AiDocumentDraft | null, headings: string[]) {
  if (!draft) return "";
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  return draft.sections.find((section) =>
    normalizedHeadings.some((heading) => section.heading.toLowerCase().includes(heading)),
  )?.content.trim() ?? "";
}

function normalizeParagraph(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function ensureWeeklyOpening(value: string) {
  const paragraph = normalizeParagraph(value);
  if (!paragraph) return "";
  return paragraph.toLowerCase().startsWith("during this week")
    ? paragraph.replace(/^during this week/i, "During this week")
    : `During this week, ${paragraph.charAt(0).toLowerCase()}${paragraph.slice(1)}`;
}

function formatDocumentDraft(draft: AiDocumentDraft) {
  if (draft.documentType === "admissionNote") {
    const cc = normalizeParagraph(sectionContent(draft, ["c.c", "cc", "chief"]));
    const pi = normalizeParagraph(sectionContent(draft, ["pi", "hpi", "present illness"]));
    return [
      "C.C",
      cc || draft.conciseSummary.trim(),
      "",
      "PI",
      pi || draft.sections.map((section) => section.content).join(" "),
    ].join("\n").trim();
  }

  if (draft.documentType === "dischargeHospitalCourse") {
    return normalizeParagraph(sectionContent(draft, ["hospital course", "course"]) || draft.conciseSummary);
  }

  if (draft.documentType === "weeklySummary") {
    return ensureWeeklyOpening(sectionContent(draft, ["weekly summary", "summary"]) || draft.conciseSummary);
  }

  if (draft.documentType === "admissionSummary") {
    return normalizeParagraph(draft.conciseSummary || draft.sections.map((section) => section.content).join(" "));
  }

  const lines = [
    draft.title.trim(),
    "",
    draft.conciseSummary.trim() ? `Summary: ${draft.conciseSummary.trim()}` : "",
    "",
    ...draft.sections.flatMap((section) => [
      section.heading.trim(),
      section.content.trim() || "-",
      "",
    ]),
    draft.followUpItems.length > 0 ? "Follow-up / Pending" : "",
    ...draft.followUpItems.map((item) => `- ${item}`),
    draft.followUpItems.length > 0 ? "" : "",
    draft.uncertainty.length > 0 ? "Uncertainty / Verify" : "",
    ...draft.uncertainty.map((item) => `- ${item}`),
  ];

  return lines.filter((line, index, array) => line.trim() || array[index - 1]?.trim()).join("\n").trim();
}

function appendIfBlank(current: string, next: string) {
  return current.trim() ? current : next;
}

function selectedDocumentLabel(documentType: AiDocumentType) {
  return documentOptions.find((option) => option.value === documentType)?.label ?? "AI document";
}

function AiDocumentsPage({ patients, dailyNotesByPatient = {}, onSavePatient }: AiDocumentsPageProps) {
  const activePatients = patients.filter((patient) => patient.status === "active");
  const [patientId, setPatientId] = useState("");
  const [documentType, setDocumentType] = useState<AiDocumentType>("admissionNote");
  const [rawText, setRawText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayKey());
  const [deidentifiedConfirmed, setDeidentifiedConfirmed] = useState(false);
  const [storeRawText, setStoreRawText] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [draft, setDraft] = useState<AiDocumentDraft | null>(null);
  const [draftId, setDraftId] = useState("");
  const [model, setModel] = useState("");
  const [editableText, setEditableText] = useState("");

  const effectivePatientId = patientId || activePatients[0]?.id || OTHER_PATIENT_ID;
  const isOtherPatient = effectivePatientId === OTHER_PATIENT_ID;
  const selectedPatient = isOtherPatient ? undefined : activePatients.find((patient) => patient.id === effectivePatientId);
  const selectedOption = documentOptions.find((option) => option.value === documentType) ?? documentOptions[0];
  const patientNotes = selectedPatient ? dailyNotesByPatient[selectedPatient.id] ?? [] : [];
  const notesInRange = useMemo(
    () => patientNotes.filter((note) => (!dateFrom || note.date >= dateFrom) && (!dateTo || note.date <= dateTo)),
    [patientNotes, dateFrom, dateTo],
  );
  const estimatedTokens = Math.ceil(rawText.length / 4);
  const canGenerate = Boolean((selectedPatient || isOtherPatient) && deidentifiedConfirmed && !loading);

  async function generateDraft() {
    if (!selectedPatient && !isOtherPatient) return;
    setError("");
    setStatusMessage("");
    setLoading(true);
    try {
      const result = await generateClinicalDocument({
        patientId: selectedPatient?.id ?? "",
        documentType,
        rawText,
        dateFrom,
        dateTo,
        deidentifiedConfirmed,
        storeRawText,
      });
      const formatted = formatDocumentDraft(result.draft);
      setDraft(result.draft);
      setDraftId(result.draftId);
      setModel(result.model);
      setEditableText(formatted);
      setStatusMessage(
        isOtherPatient
          ? `Standalone draft created. It is not attached to a patient. Draft ID: ${result.draftId}`
          : `Draft created. Review before saving. Draft ID: ${result.draftId}`,
      );
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function saveReviewedDraft() {
    if (isOtherPatient) {
      setStatusMessage("Standalone draft is ready for review. It was not written to any patient chart.");
      return;
    }
    if (!selectedPatient || !draft) return;
    setError("");
    setStatusMessage("");
    setSaving(true);
    const now = nowIso();
    const summary = draft.conciseSummary.trim() || editableText.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
    const nextPatient: Patient = {
      ...selectedPatient,
      updatedAt: now,
    };

    if (documentType === "admissionNote") {
      const existingAdmissionSummary = getAdmissionSummaryText(selectedPatient, { allowFallback: false });
      nextPatient.generatedAdmissionNote = editableText;
      nextPatient.admissionBriefNotes = editableText;
      if (summary) {
        nextPatient.generatedAdmissionSummary = summary;
        nextPatient.admissionBriefFreeText = existingAdmissionSummary ? nextPatient.admissionBriefFreeText : summary;
        nextPatient.oneLiner = appendIfBlank(nextPatient.oneLiner, summary);
      }
      nextPatient.chiefComplaint = appendIfBlank(nextPatient.chiefComplaint, sectionContent(draft, ["c.c", "cc", "chief"]));
      nextPatient.admissionChiefConcern = appendIfBlank(nextPatient.admissionChiefConcern, nextPatient.chiefComplaint);
      nextPatient.presentIllnessOrHPI = appendIfBlank(nextPatient.presentIllnessOrHPI, sectionContent(draft, ["hpi", "pi", "present illness"]));
      nextPatient.hpiOrAdmissionStory = appendIfBlank(nextPatient.hpiOrAdmissionStory, nextPatient.presentIllnessOrHPI);
    }

    if (documentType === "admissionSummary") {
      nextPatient.generatedAdmissionSummary = editableText;
      nextPatient.admissionBriefFreeText = editableText;
      nextPatient.oneLiner = appendIfBlank(nextPatient.oneLiner, summary);
    }

    if (documentType === "dischargeHospitalCourse") {
      nextPatient.generatedDischargeSummary = editableText;
      nextPatient.hospitalCourseHighlights = appendIfBlank(nextPatient.hospitalCourseHighlights, summary || editableText);
    }

    if (documentType === "weeklySummary") {
      nextPatient.generatedWeeklySummary = editableText;
    }

    if (documentType === "isbar") {
      nextPatient.generatedSbarNote = editableText;
    }

    try {
      await onSavePatient(nextPatient);
      setStatusMessage(`${selectedDocumentLabel(documentType)} saved to ${selectedPatient.bed || selectedPatient.patientCode}.`);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>AI Documents</h2>
          <p className="muted">AI assists organization only; clinician must verify before saving.</p>
        </div>
      </header>

      <section className="panel ai-documents-page">
        <div className="ai-warning">
          Use de-identified text only. Do not send patient name, full MRN, ID number, birthday, phone, address, or identifiable image.
        </div>
        <div className="form-grid">
          <label>
            Patient
            <select
              value={effectivePatientId}
              onChange={(event) => {
                setPatientId(event.target.value);
                setDraft(null);
                setEditableText("");
                setDraftId("");
                setModel("");
                setStatusMessage("");
                setError("");
              }}
            >
              <option value={OTHER_PATIENT_ID}>Other patient / standalone draft</option>
              {activePatients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.bed || "-"} / {patient.patientCode || "-"} / {patient.primaryDiagnosis || "No Dx"}
                </option>
              ))}
            </select>
          </label>
          <label>
            AI document
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as AiDocumentType)}>
              {documentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {documentType === "weeklySummary" && (
            <>
              <label>
                From
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </label>
            </>
          )}
          <p className="muted span-2">
            {selectedOption.helper}
            {isOtherPatient && " This draft will not be saved into any patient record."}
            {documentType === "weeklySummary" && !isOtherPatient && ` ${notesInRange.length} SOAP note(s) selected.`}
          </p>
          <label className="span-2">
            Additional de-identified source text
            <textarea
              className="ai-raw-textarea"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Paste de-identified ED/OPD note, V/S, lab, image report, consult note, nursing note, or extra context."
            />
          </label>
          <label className="checkbox-label span-2">
            <input
              type="checkbox"
              checked={deidentifiedConfirmed}
              onChange={(event) => setDeidentifiedConfirmed(event.target.checked)}
            />
            I confirm all source text{isOtherPatient ? "" : " and selected patient notes"} are de-identified.
          </label>
          <label className="checkbox-label span-2">
            <input
              type="checkbox"
              checked={storeRawText}
              onChange={(event) => setStoreRawText(event.target.checked)}
            />
            Store full raw text in aiDrafts. Use de-identified data only.
          </label>
          <p className="muted span-2">
            {rawText.length} / 12,000 pasted characters. Approx. {estimatedTokens} pasted input tokens.
            {isOtherPatient ? " Standalone mode uses pasted text only." : " The backend adds selected patient/SOAP context."}
          </p>
          <div className="form-actions span-2">
            <button type="button" disabled={!canGenerate} onClick={generateDraft}>
              {loading ? "Generating..." : `Generate ${selectedOption.label}`}
            </button>
          </div>
        </div>
      </section>

      {error && <p className="error-message">{error}</p>}
      {statusMessage && <p className="status-message">{statusMessage}</p>}

      {draft && (
        <section className="panel ai-document-review">
          <div className="section-heading">
            <div>
              <h3>Review Draft</h3>
              <p className="muted">
                Model: {model} / Draft: {draftId}
                {isOtherPatient && " / Standalone draft"}
              </p>
            </div>
            {!isOtherPatient && (
              <button type="button" disabled={saving || !editableText.trim()} onClick={saveReviewedDraft}>
                {saving ? "Saving..." : "Save reviewed draft"}
              </button>
            )}
          </div>
          <label className="span-2">
            Editable draft
            <textarea
              className="ai-document-editor"
              value={editableText}
              onChange={(event) => setEditableText(event.target.value)}
            />
          </label>
        </section>
      )}
    </div>
  );
}

export default AiDocumentsPage;
