import { useEffect, useMemo, useRef, useState } from "react";
import DeidNotice from "./DeidNotice";
import {
  applyClinicalKnowledgeToText,
  formatRuleBasedSbar,
  formatRuleBasedWeeklySummary,
  hasClinicalReasoning,
} from "../clinicalKnowledge";
import { formatClinicalDocumentDraft } from "../clinicalDocumentFormat";
import { generateClinicalDocument } from "../firebase/aiService";
import { formatSoapBasedIsbar } from "../soapSbar";
import type { AiDocumentDraft, AiDocumentType, DailyNote, GeneratedClinicalPlan, Patient } from "../types";
import { getAdmissionSummaryText, nowIso } from "../utils";
import { recentDailyNotesOnOrBefore, sortDailyNotesDesc } from "../clinicalDataSafety";
import {
  bindDeidentifiedConfirmation,
  createAiPrivacyContextFingerprint,
  isDeidentifiedConfirmationCurrent,
} from "../aiPrivacyConfirmation";
import {
  canApplyDocumentContextRequest,
  isDocumentReviewBoundToContext,
  isLatestRequest,
  type DocumentContextRequestIdentity,
} from "../asyncRequestGuard";

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

function hasClinicalRuleSignal(plan: GeneratedClinicalPlan) {
  return plan.ruleMatches.length > 0 || plan.redFlags.length > 0 || plan.todayTasks.length > 0 || plan.problemBasedAP.length > 0;
}

function notesForDocument(notes: DailyNote[], documentType: QuickDocumentType, dateFrom: string, selectedDate: string) {
  if (documentType !== "weeklySummary") {
    return recentDailyNotesOnOrBefore(notes, selectedDate, 2);
  }
  return sortDailyNotesDesc(
    notes.filter((note) => (!dateFrom || note.date >= dateFrom) && note.date <= selectedDate),
  );
}

function patientRuleContext(patient: Patient, selectedNotes: DailyNote[]) {
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
    selectedNotes
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

function formatRuleReviewedDocument(documentType: QuickDocumentType, plan: GeneratedClinicalPlan) {
  if (!hasClinicalRuleSignal(plan)) return "";
  return documentType === "weeklySummary" ? formatRuleBasedWeeklySummary(plan) : formatRuleBasedSbar(plan);
}

function localClinicalDraft(documentType: QuickDocumentType, formatted: string, plan: GeneratedClinicalPlan): AiDocumentDraft {
  return {
    documentType,
    title: documentType === "weeklySummary" ? "Clinical Knowledge Weekly Summary" : "Clinical Knowledge SBAR",
    conciseSummary: formatted.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "",
    sections: [{ heading: "Clinical Knowledge Review", content: formatted }],
    followUpItems: plan.todayTasks.map((task) => task.text),
    uncertainty: [
      ...(plan.needsReview ? ["Clinician review required before saving."] : []),
      ...plan.facts.uncertainty,
    ],
  };
}

function ClinicalDocumentQuickActions({
  patient,
  notes = [],
  selectedDate,
  onSavePatient,
}: ClinicalDocumentQuickActionsProps) {
  const [loadingType, setLoadingType] = useState<QuickDocumentType | "">("");
  const [draft, setDraft] = useState<AiDocumentDraft | null>(null);
  const [editableText, setEditableText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmedPrivacyFingerprint, setConfirmedPrivacyFingerprint] = useState("");
  const [draftBinding, setDraftBinding] = useState<DocumentContextRequestIdentity<QuickDocumentType> | null>(null);
  const latestGenerationRequestRef = useRef(0);
  const currentDocumentContextRef = useRef<{
    patientId: string;
    contextKeys: Record<QuickDocumentType, string>;
  }>({ patientId: "", contextKeys: { weeklySummary: "", isbar: "" } });

  const dateFrom = useMemo(() => dateDaysBefore(selectedDate, 6), [selectedDate]);
  const weeklyNotes = useMemo(
    () => notesForDocument(notes, "weeklySummary", dateFrom, selectedDate),
    [notes, dateFrom, selectedDate],
  );
  const weeklyNoteCount = useMemo(
    () => notes.filter((note) => (!dateFrom || note.date >= dateFrom) && note.date <= selectedDate).length,
    [notes, dateFrom, selectedDate],
  );
  const isbarNotes = useMemo(
    () => notesForDocument(notes, "isbar", dateFrom, selectedDate),
    [notes, dateFrom, selectedDate],
  );
  const documentContextKeys = useMemo<Record<QuickDocumentType, string>>(
    () => ({
      weeklySummary: createAiPrivacyContextFingerprint(patient, weeklyNotes, dateFrom, selectedDate, "weeklySummary"),
      isbar: createAiPrivacyContextFingerprint(patient, isbarNotes, selectedDate, "isbar"),
    }),
    [patient, weeklyNotes, isbarNotes, dateFrom, selectedDate],
  );
  const privacyContextFingerprint = documentContextKeys.weeklySummary;
  const deidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
    confirmedPrivacyFingerprint,
    privacyContextFingerprint,
  );
  currentDocumentContextRef.current = { patientId: patient.id, contextKeys: documentContextKeys };
  const draftMatchesContext = Boolean(
    draftBinding &&
      draft &&
      draft.documentType === draftBinding.documentType &&
      isDocumentReviewBoundToContext(
        draftBinding,
        patient.id,
        draftBinding.documentType,
        documentContextKeys[draftBinding.documentType],
      ),
  );

  useEffect(() => {
    latestGenerationRequestRef.current += 1;
    setLoadingType("");
    setDraft(null);
    setDraftBinding(null);
    setEditableText("");
    setStatusMessage("");
    setError("");
    setConfirmedPrivacyFingerprint("");
  }, [documentContextKeys.isbar, privacyContextFingerprint]);

  async function generateDraft(documentType: QuickDocumentType) {
    const requestPatient = patient;
    const requestSelectedDate = selectedDate;
    const requestDateFrom = dateFrom;
    const selectedNotes = documentType === "weeklySummary" ? weeklyNotes : isbarNotes;
    const requestContextKey = documentContextKeys[documentType];
    const request: DocumentContextRequestIdentity<QuickDocumentType> = {
      requestId: latestGenerationRequestRef.current + 1,
      patientId: requestPatient.id,
      documentType,
      contextKey: requestContextKey,
    };
    latestGenerationRequestRef.current = request.requestId;
    const canApplyRequest = () =>
      canApplyDocumentContextRequest(
        request,
        latestGenerationRequestRef.current,
        currentDocumentContextRef.current.patientId,
        request.documentType,
        currentDocumentContextRef.current.contextKeys[request.documentType],
      );
    setError("");
    setStatusMessage("");
    const requestDeidentifiedConfirmed = isDeidentifiedConfirmationCurrent(
      confirmedPrivacyFingerprint,
      requestContextKey,
    );
    if (documentType === "weeklySummary" && !requestDeidentifiedConfirmed) {
      setLoadingType("");
      setError("Confirm that the selected patient and SOAP context are de-identified before sending them to external AI.");
      return;
    }

    setDraft(null);
    setDraftBinding(null);
    setEditableText("");
    setLoadingType(documentType);
    try {
      if (documentType === "isbar") {
        const formatted = formatSoapBasedIsbar(requestPatient, selectedNotes, requestSelectedDate);
        if (!canApplyRequest()) return;
        if (/^insufficient reviewed SOAP\/context/i.test(formatted)) {
          setError(formatted);
          return;
        }
        setDraft(localClinicalDraft(documentType, formatted, {
          ruleMatches: [],
          redFlags: [],
          todayTasks: [],
          problemBasedAP: [],
          needsReview: false,
          facts: {
            sourceText: "",
            diagnoses: [],
            pmh: [],
            activeProblems: [],
            objectiveFacts: [],
            medications: [],
            antibiotics: [],
            procedures: [],
            consults: [],
            hospitalCourse: [],
            todayUpdates: [],
            pendingItems: [],
            dischargeDisposition: [],
            immunocompromisedSignals: [],
            uncertainty: [],
          },
          handoffWarnings: [],
          printSummary: "",
          sbarRecommendation: "",
        }));
        setDraftBinding(request);
        setEditableText(formatted);
        setStatusMessage("SBAR drafted from reviewed SOAP. Review, edit, then save.");
        return;
      }
      const rulePlan = applyClinicalKnowledgeToText(patientRuleContext(requestPatient, selectedNotes), {
        pmh: [requestPatient.underlyingDiseases, requestPatient.admissionPMH].filter(Boolean),
        activeProblems: [requestPatient.activeProblems, requestPatient.primaryDiagnosis].filter(Boolean),
      });
      const ruleFormatted = formatRuleReviewedDocument(documentType, rulePlan);
      const result = await generateClinicalDocument({
        patientId: requestPatient.id,
        documentType,
        rawText: "",
        dateFrom: documentType === "weeklySummary" ? requestDateFrom : "",
        dateTo: documentType === "weeklySummary" ? requestSelectedDate : "",
        deidentifiedConfirmed: requestDeidentifiedConfirmed,
        storeRawText: false,
      });
      if (!canApplyRequest()) return;
      if (result.draft.documentType !== documentType) {
        setError("Generated document type did not match the requested type. Nothing was applied; generate again.");
        return;
      }
      const aiHasReasoning = hasClinicalReasoning(result.draft.clinicalReasoning);
      const formatted = !aiHasReasoning && ruleFormatted ? ruleFormatted : formatClinicalDocumentDraft(result.draft);
      setDraft(result.draft);
      setDraftBinding(request);
      setEditableText(formatted);
      setStatusMessage(
        aiHasReasoning
          ? `${documentLabel(documentType)} generated with AI clinical reasoning and local rule review. Review, edit, then save. Draft: ${result.draftId}`
          : `${documentLabel(documentType)} drafted with local Clinical Knowledge review. Review, edit, then save.`,
      );
    } catch (nextError) {
      if (!canApplyRequest()) return;
      const rulePlan = applyClinicalKnowledgeToText(patientRuleContext(requestPatient, selectedNotes), {
        pmh: [requestPatient.underlyingDiseases, requestPatient.admissionPMH].filter(Boolean),
        activeProblems: [requestPatient.activeProblems, requestPatient.primaryDiagnosis].filter(Boolean),
      });
      const ruleFormatted = formatRuleReviewedDocument(documentType, rulePlan);
      if (ruleFormatted) {
        setDraft(localClinicalDraft(documentType, ruleFormatted, rulePlan));
        setDraftBinding(request);
        setEditableText(ruleFormatted);
        setStatusMessage(
          `${documentLabel(documentType)} drafted locally because AI generation was unavailable. Review, edit, then save.`,
        );
      } else {
        setError(getErrorMessage(nextError));
      }
    } finally {
      if (isLatestRequest(request, latestGenerationRequestRef.current)) setLoadingType("");
    }
  }

  async function saveReviewedDraft() {
    if (
      !draft ||
      !draftBinding ||
      !editableText.trim() ||
      draft.documentType !== draftBinding.documentType ||
      !isDocumentReviewBoundToContext(
        draftBinding,
        currentDocumentContextRef.current.patientId,
        draftBinding.documentType,
        currentDocumentContextRef.current.contextKeys[draftBinding.documentType],
      )
    ) {
      setError("This document review belongs to a different patient, date, or SOAP context. Nothing was saved; generate again.");
      return;
    }
    if (patient.id !== draftBinding.patientId) {
      setError("The selected patient changed after this document was generated. Nothing was saved; generate again.");
      return;
    }
    const savePatient = patient;
    const saveDocumentType = draftBinding.documentType;
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      await onSavePatient(saveDocumentToPatient(savePatient, saveDocumentType, editableText));
      setStatusMessage(`${documentLabel(saveDocumentType)} saved to this patient.`);
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
        </div>
      </div>

      <DeidNotice />

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
        I confirm this patient and selected SOAP context contain no direct identifiers and may be sent to external AI for the weekly summary.
      </label>

      <div className="clinical-doc-action-grid">
        <button
          type="button"
          disabled={Boolean(loadingType) || saving || !deidentifiedConfirmed}
          onClick={() => void generateDraft("weeklySummary")}
        >
          {loadingType === "weeklySummary" ? "Generating..." : "Generate Weekly Summary"}
        </button>
        <div className="muted">
          Last 7 days through {selectedDate}; {weeklyNoteCount} SOAP note(s) in range.
        </div>

        <button
          type="button"
          disabled={Boolean(loadingType) || saving}
          onClick={() => void generateDraft("isbar")}
        >
          {loadingType === "isbar" ? "Generating..." : "Generate SBAR"}
        </button>
        <div className="muted">Situation / Background / Assessment / Recommendation handoff.</div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {statusMessage && <p className="status-message">{statusMessage}</p>}

      {draft && draftMatchesContext && (
        <label>
          Reviewed {documentLabel(draft.documentType as QuickDocumentType)}
          <textarea
            className="ai-document-editor clinical-doc-editor"
            value={editableText}
            onChange={(event) => setEditableText(event.target.value)}
          />
        </label>
      )}

      {draft && draftMatchesContext && (
        <div className="form-actions">
          <button type="button" disabled={saving || Boolean(loadingType) || !editableText.trim()} onClick={() => void saveReviewedDraft()}>
            {saving ? "Saving..." : `Save reviewed ${documentLabel(draft.documentType as QuickDocumentType)}`}
          </button>
        </div>
      )}
    </section>
  );
}

export default ClinicalDocumentQuickActions;
