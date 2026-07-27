import { useEffect, useMemo, useRef, useState } from "react";
import { generateClinicalDocument } from "../firebase/aiService";
import type { AiDocumentDraft, AiDocumentType, DailyNote, DailyNotesByPatient, GeneratedClinicalPlan, Patient, SavePatientOptions } from "../types";
import { getAdmissionSummaryText, nowIso, todayKey } from "../utils";
import { formatClinicalDocumentDraft, getClinicalDocumentSection } from "../clinicalDocumentFormat";
import { applyClinicalKnowledgeToText, formatRuleBasedAdmissionSummary, formatRuleBasedSbar, formatRuleBasedWeeklySummary, hasClinicalReasoning } from "../clinicalKnowledge";
import { formatSoapBasedIsbar } from "../soapSbar";
import {
  canApplyDocumentContextRequest,
  isDocumentReviewBoundToContext,
  isLatestRequest,
  type DocumentContextRequestIdentity,
} from "../asyncRequestGuard";
import {
  bindDeidentifiedConfirmation,
  createAiPrivacyContextFingerprint,
  isDeidentifiedConfirmationCurrent,
} from "../aiPrivacyConfirmation";
import DeidNotice from "../components/DeidNotice";
import { buildAiDocumentAuditWrite } from "../clinicalAudit";
import { persistedPatientUpdatedAt } from "../patientWriteSafety";
import { reviewedAiDocumentPatientPatch } from "../aiDocumentPersistence";

const OTHER_PATIENT_ID = "__other_patient__";

interface AiDocumentsPageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  isDemoMode?: boolean;
  onSavePatient: (patient: Patient, options?: SavePatientOptions) => Promise<void>;
}

const documentOptions: Array<{ value: AiDocumentType; label: string; helper: string }> = [
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
    helper: "One-click progress summary using the selected SOAP date range.",
  },
  {
    value: "isbar",
    label: "SBAR handoff",
    helper: "Situation, Background, Assessment, Recommendation handoff for clinically important updates.",
  },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function sectionContent(draft: AiDocumentDraft | null, headings: string[]) {
  return getClinicalDocumentSection(draft, headings);
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

const isbarHeadings = ["Situation", "Background", "Assessment", "Recommendation"] as const;
type AiQualityMode = "fast" | "balanced" | "highAccuracy";

const qualityModeOptions: Array<{ value: AiQualityMode; label: string; helper: string }> = [
  { value: "fast", label: "Efficient (GPT-5.6 Luna)", helper: "Use for simple, low-risk formatting when cost matters most." },
  { value: "balanced", label: "Recommended (GPT-5.6 Terra)", helper: "Best value for routine discharge and weekly drafts." },
  { value: "highAccuracy", label: "Best quality (GPT-5.6 Sol)", helper: "Recommended for admission summaries, iSBAR, and complex ICU/oncology material." },
];

function recommendedQualityForDocument(documentType: AiDocumentType): AiQualityMode {
  return documentType === "admissionSummary" || documentType === "admissionNote" ? "highAccuracy" : "balanced";
}

function compactIsbarContent(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .join("; ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*;\s*/g, "; ")
    .trim();
}

function formatIsbarDraft(draft: AiDocumentDraft) {
  const pending = draft.followUpItems.map(compactIsbarContent).filter(Boolean).join("; ");
  const verify = draft.uncertainty.map(compactIsbarContent).filter(Boolean).join("; ");

  return isbarHeadings
    .map((heading) => {
      const content = compactIsbarContent(sectionContent(draft, [heading]));
      const recommendationExtras =
        heading === "Recommendation"
          ? [pending ? `Pending: ${pending}` : "", verify ? `Verify: ${verify}` : ""].filter(Boolean).join("; ")
          : "";
      const finalContent = [content, recommendationExtras].filter(Boolean).join("; ");
      return finalContent ? `${heading}: ${finalContent}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
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

  if (draft.documentType === "isbar") {
    return formatIsbarDraft(draft);
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

function selectedDocumentLabel(documentType: AiDocumentType) {
  return documentOptions.find((option) => option.value === documentType)?.label ?? "AI document";
}

function savedDocumentBaseline(patient: Patient, documentType: AiDocumentType) {
  if (documentType === "admissionNote") return patient.generatedAdmissionNote || patient.admissionBriefNotes;
  if (documentType === "admissionSummary") return patient.generatedAdmissionSummary || patient.admissionBriefFreeText;
  if (documentType === "dischargeHospitalCourse") return patient.generatedDischargeSummary;
  if (documentType === "weeklySummary") return patient.generatedWeeklySummary;
  if (documentType === "isbar") return patient.generatedSbarNote;
  return "";
}

function patientRuleContext(patient?: Patient, notes: DailyNote[] = []) {
  if (!patient) return "";
  return [
    patient.primaryDiagnosis,
    patient.oneLiner,
    getAdmissionSummaryText(patient),
    patient.underlyingDiseases,
    patient.admissionPMH,
    patient.activeProblems,
    patient.hospitalCourseHighlights,
    patient.importantRedFlags,
    patient.vitalSigns,
    patient.bloodSugar,
    patient.newLabs,
    patient.newImaging,
    patient.assessment,
    patient.plan,
    patient.dischargePlan,
    patient.tasks.map((task) => task.text).join("\n"),
    notes
      .map((note) =>
        [
          note.date,
          note.importantRedFlags,
          note.overnightEvents,
          note.subjectiveOrChiefConcern,
          note.vitalSigns,
          note.bloodSugar,
          note.labSummary,
          note.imageSummary,
          note.assessment,
          note.plan,
          note.dischargePlan,
        ].filter(Boolean).join(" "),
      )
      .join("\n"),
  ].filter(Boolean).join("\n");
}

function hasClinicalRuleSignal(plan: GeneratedClinicalPlan) {
  return plan.ruleMatches.length > 0 || plan.redFlags.length > 0 || plan.todayTasks.length > 0 || plan.problemBasedAP.length > 0;
}

function formatRuleReviewedDocument(documentType: AiDocumentType, plan: GeneratedClinicalPlan) {
  if (!hasClinicalRuleSignal(plan)) return "";
  if (documentType === "admissionSummary") return formatRuleBasedAdmissionSummary(plan, { length: "threeMinute" });
  if (documentType === "isbar") return formatRuleBasedSbar(plan);
  if (documentType === "weeklySummary") return formatRuleBasedWeeklySummary(plan);
  return "";
}

function localIsbarDraft(text: string): AiDocumentDraft {
  return {
    documentType: "isbar",
    title: "SOAP-based SBAR",
    conciseSummary: text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "",
    sections: [{ heading: "SBAR", content: text }],
    followUpItems: [],
    uncertainty: [],
  };
}

function AiDocumentsPage({ patients, dailyNotesByPatient = {}, isDemoMode = false, onSavePatient }: AiDocumentsPageProps) {
  const activePatients = patients.filter((patient) => patient.status === "active");
  const [patientId, setPatientId] = useState("");
  const [documentType, setDocumentType] = useState<AiDocumentType>("isbar");
  const [qualityMode, setQualityMode] = useState<AiQualityMode>("balanced");
  const [rawText, setRawText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayKey());
  const [storeRawText, setStoreRawText] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [draft, setDraft] = useState<AiDocumentDraft | null>(null);
  const [draftId, setDraftId] = useState("");
  const [model, setModel] = useState("");
  const [editableText, setEditableText] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [baselineText, setBaselineText] = useState("");
  const [confirmedPrivacyFingerprint, setConfirmedPrivacyFingerprint] = useState("");
  const [draftBinding, setDraftBinding] = useState<DocumentContextRequestIdentity<AiDocumentType> | null>(null);
  const latestGenerationRequestRef = useRef(0);
  const currentSelectionRef = useRef<{ patientId: string; documentType: AiDocumentType; contextKey: string }>({
    patientId: "",
    documentType: "isbar",
    contextKey: "",
  });

  const hasValidExplicitPatient =
    patientId === OTHER_PATIENT_ID || activePatients.some((patient) => patient.id === patientId);
  const effectivePatientId = (hasValidExplicitPatient ? patientId : "") || activePatients[0]?.id || OTHER_PATIENT_ID;
  const isOtherPatient = effectivePatientId === OTHER_PATIENT_ID;
  const selectedPatient = isOtherPatient ? undefined : activePatients.find((patient) => patient.id === effectivePatientId);
  const selectedOption = documentOptions.find((option) => option.value === documentType) ?? documentOptions[0];
  const patientNotes = selectedPatient ? dailyNotesByPatient[selectedPatient.id] ?? [] : [];
  const notesInRange = useMemo(
    () => patientNotes.filter((note) => (!dateFrom || note.date >= dateFrom) && (!dateTo || note.date <= dateTo)),
    [patientNotes, dateFrom, dateTo],
  );
  const estimatedTokens = Math.ceil(rawText.length / 4);
  const usesExternalAi = !(documentType === "isbar" && selectedPatient);
  const privacyContextFingerprint = useMemo(
    () =>
      createAiPrivacyContextFingerprint(
        effectivePatientId,
        documentType,
        rawText,
        dateFrom,
        dateTo,
        qualityMode,
        storeRawText,
        selectedPatient ?? null,
        notesInRange,
      ),
    [effectivePatientId, documentType, rawText, dateFrom, dateTo, qualityMode, storeRawText, selectedPatient, notesInRange],
  );
  const deidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
    confirmedPrivacyFingerprint,
    privacyContextFingerprint,
  );
  currentSelectionRef.current = {
    patientId: effectivePatientId,
    documentType,
    contextKey: privacyContextFingerprint,
  };
  const canGenerate = Boolean(
    (selectedPatient || isOtherPatient) && !loading && !saving && (!usesExternalAi || deidentifiedConfirmed),
  );
  const draftMatchesSelection = isDocumentReviewBoundToContext(
    draftBinding,
    effectivePatientId,
    documentType,
    privacyContextFingerprint,
  );

  useEffect(() => {
    setConfirmedPrivacyFingerprint("");
  }, [privacyContextFingerprint]);

  function clearDraftReview() {
    setDraft(null);
    setDraftBinding(null);
    setEditableText("");
    setCandidateText("");
    setBaselineText("");
    setDraftId("");
    setModel("");
  }

  async function generateDraft() {
    if (!selectedPatient && !isOtherPatient) return;
    const requestPatient = selectedPatient;
    const requestPatientId = effectivePatientId;
    const requestDocumentType = documentType;
    const requestQualityMode = qualityMode;
    const requestRawText = rawText;
    const requestDateFrom = dateFrom;
    const requestDateTo = dateTo;
    const requestStoreRawText = storeRawText;
    const requestPatientNotes = patientNotes;
    const requestNotesInRange = notesInRange;
    const requestUsesExternalAi = !(requestDocumentType === "isbar" && requestPatient);
    const requestPrivacyFingerprint = createAiPrivacyContextFingerprint(
      requestPatientId,
      requestDocumentType,
      requestRawText,
      requestDateFrom,
      requestDateTo,
      requestQualityMode,
      requestStoreRawText,
      requestPatient ?? null,
      requestNotesInRange,
    );
    const requestDeidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
      confirmedPrivacyFingerprint,
      requestPrivacyFingerprint,
    );
    const request: DocumentContextRequestIdentity<AiDocumentType> = {
      requestId: latestGenerationRequestRef.current + 1,
      patientId: requestPatientId,
      documentType: requestDocumentType,
      contextKey: requestPrivacyFingerprint,
    };
    latestGenerationRequestRef.current = request.requestId;
    const canApplyRequest = () =>
      canApplyDocumentContextRequest(
        request,
        latestGenerationRequestRef.current,
        currentSelectionRef.current.patientId,
        currentSelectionRef.current.documentType,
        currentSelectionRef.current.contextKey,
      );

    setError("");
    setStatusMessage("");
    if (requestUsesExternalAi && !requestDeidentifiedConfirmed) {
      setError("Confirm that the pasted source and selected patient/SOAP context are de-identified before sending them to external AI.");
      return;
    }
    clearDraftReview();
    setLoading(true);
    try {
      if (requestDocumentType === "isbar" && requestPatient) {
        const formatted = formatSoapBasedIsbar(
          requestPatient,
          requestPatientNotes,
          requestDateTo || todayKey(),
          requestRawText,
        );
        if (!canApplyRequest()) return;
        if (/^insufficient reviewed SOAP\/context/i.test(formatted)) {
          setError(formatted);
          return;
        }
        setDraft(localIsbarDraft(formatted));
        setDraftBinding(request);
        setDraftId("local-soap-sbar");
        setModel("reviewed-soap");
        setEditableText(formatted);
        setCandidateText(formatted);
        setBaselineText(requestPatient ? savedDocumentBaseline(requestPatient, requestDocumentType) : "");
        setStatusMessage("SBAR drafted from reviewed SOAP and optional pasted context. Review before saving.");
        return;
      }
      const result = await generateClinicalDocument({
        patientId: requestPatient?.id ?? "",
        documentType: requestDocumentType,
        rawText: requestRawText,
        dateFrom: requestDateFrom,
        dateTo: requestDateTo,
        deidentifiedConfirmed: requestDeidentifiedConfirmed,
        storeRawText: requestStoreRawText,
        qualityMode: requestQualityMode,
      });
      if (!canApplyRequest()) return;
      if (result.draft.documentType !== requestDocumentType) {
        setError("Generated document type did not match the requested type. Nothing was applied; generate again.");
        return;
      }
      const rulePlan = applyClinicalKnowledgeToText(
        [requestRawText, patientRuleContext(requestPatient, requestNotesInRange)].filter(Boolean).join("\n"),
        {
          pmh: requestPatient ? [requestPatient.underlyingDiseases, requestPatient.admissionPMH].filter(Boolean) : [],
          activeProblems: requestPatient ? [requestPatient.activeProblems, requestPatient.primaryDiagnosis].filter(Boolean) : [],
        },
      );
      const sharedFormatted = formatClinicalDocumentDraft(result.draft);
      const ruleFormatted = formatRuleReviewedDocument(requestDocumentType, rulePlan);
      const formatted = hasClinicalReasoning(result.draft.clinicalReasoning)
        ? sharedFormatted
        : ruleFormatted || sharedFormatted;
      setDraft(result.draft);
      setDraftBinding(request);
      setDraftId(result.draftId);
      setModel(`${result.model} / ${result.qualityMode ?? requestQualityMode}`);
      setEditableText(formatted);
      setCandidateText(formatted);
      setBaselineText(requestPatient ? savedDocumentBaseline(requestPatient, requestDocumentType) : "");
      const ruleNote = hasClinicalRuleSignal(rulePlan)
        ? ` Clinical Knowledge review applied: ${rulePlan.ruleMatches.map((match) => match.title).join(", ") || "needs clinical review"}.`
        : "";
      setStatusMessage(
        requestPatientId === OTHER_PATIENT_ID
          ? `Standalone draft created. It is not attached to a patient.${ruleNote} Draft ID: ${result.draftId}`
          : `Draft created. Review before saving.${ruleNote} Draft ID: ${result.draftId}`,
      );
    } catch (nextError) {
      if (canApplyRequest()) setError(getErrorMessage(nextError));
    } finally {
      if (isLatestRequest(request, latestGenerationRequestRef.current)) setLoading(false);
    }
  }

  async function saveReviewedDraft() {
    if (
      !draft ||
      !draftBinding ||
      !isDocumentReviewBoundToContext(
        draftBinding,
        currentSelectionRef.current.patientId,
        currentSelectionRef.current.documentType,
        currentSelectionRef.current.contextKey,
      ) ||
      draft.documentType !== draftBinding.documentType ||
      !candidateText.trim()
    ) {
      setError("This draft no longer matches the exact patient, document, date range, pasted source, or selected context. Nothing was saved; generate again.");
      return;
    }
    if (draftBinding.patientId === OTHER_PATIENT_ID) {
      setStatusMessage("Standalone draft is ready for review. It was not written to any patient chart.");
      return;
    }
    if (!selectedPatient || selectedPatient.id !== draftBinding.patientId) {
      setError("The selected patient changed after this draft was generated. Nothing was saved; generate again.");
      return;
    }
    const saveDocumentType = draftBinding.documentType;
    const savePatient = selectedPatient;
    setError("");
    setStatusMessage("");
    setSaving(true);
    const now = nowIso();
    const patientPatch = reviewedAiDocumentPatientPatch(saveDocumentType, editableText, now);
    const nextPatient: Patient = { ...savePatient, ...patientPatch };

    try {
      const audit = buildAiDocumentAuditWrite({
        patientId: savePatient.id,
        documentType: saveDocumentType,
        auditDate: dateTo || todayKey(),
        dateFrom,
        dateTo,
        sourceText: rawText,
        storeSourceText: storeRawText,
        baselineText,
        candidateText,
        finalText: editableText,
        aiDraftId: draftId,
        model,
        qualityMode,
      });
      await onSavePatient(nextPatient, {
        audit,
        expectedPatientUpdatedAt: persistedPatientUpdatedAt(savePatient),
        patientPatch,
      });
      setStatusMessage(
        isDemoMode
          ? `${selectedDocumentLabel(saveDocumentType)} saved in demo memory. Candidate-to-final audit behavior was validated but no Firestore audit record was written.`
          : `${selectedDocumentLabel(saveDocumentType)} saved to ${savePatient.bed || savePatient.patientCode} with an append-only candidate-to-final audit record.`,
      );
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
              disabled={loading || saving}
              onChange={(event) => {
                setPatientId(event.target.value);
                clearDraftReview();
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
            <select
              value={documentType}
              disabled={loading || saving}
              onChange={(event) => {
                const nextType = event.target.value as AiDocumentType;
                setDocumentType(nextType);
                setQualityMode(recommendedQualityForDocument(nextType));
                clearDraftReview();
                setStatusMessage("");
                setError("");
              }}
            >
              {documentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model quality
            <select
              value={qualityMode}
              disabled={loading || saving}
              onChange={(event) => setQualityMode(event.target.value as AiQualityMode)}
            >
              {qualityModeOptions.map((option) => (
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
                <input type="date" value={dateFrom} disabled={loading || saving} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={dateTo} disabled={loading || saving} onChange={(event) => setDateTo(event.target.value)} />
              </label>
            </>
          )}
          <p className="muted span-2">
            {selectedOption.helper}
            {isOtherPatient && " This draft will not be saved into any patient record."}
            {documentType === "weeklySummary" && !isOtherPatient && ` ${notesInRange.length} SOAP note(s) selected.`}
            {" "}
            {qualityModeOptions.find((option) => option.value === qualityMode)?.helper}
          </p>
          <label className="span-2">
            Additional de-identified source text
            <textarea
              className="ai-raw-textarea"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Paste de-identified note / V/S / lab / image / consult…"
            />
          </label>
          <DeidNotice span2 />
          {usesExternalAi && (
            <label className="checkbox-label span-2">
              <input
                type="checkbox"
                checked={deidentifiedConfirmed}
                onChange={(event) =>
                  setConfirmedPrivacyFingerprint(
                    bindDeidentifiedConfirmation(event.target.checked, privacyContextFingerprint),
                  )
                }
              />
              I confirm the pasted source and selected patient/SOAP context contain no direct identifiers and may be sent to external AI.
            </label>
          )}
          <details className="advanced-fold span-2">
            <summary>Advanced</summary>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={storeRawText}
                disabled={loading || saving}
                onChange={(event) => setStoreRawText(event.target.checked)}
              />
              Retain the exact de-identified pasted source in the AI draft/audit for up to 30 days
            </label>
          </details>
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

      {draft && draftMatchesSelection && (
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
              <button type="button" disabled={saving || loading || !editableText.trim()} onClick={saveReviewedDraft}>
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
