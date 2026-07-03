import { useMemo, useState } from "react";
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
    return notes.filter((note) => note.date <= selectedDate).slice(-2);
  }
  return notes.filter((note) => (!dateFrom || note.date >= dateFrom) && note.date <= selectedDate);
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

  const dateFrom = useMemo(() => dateDaysBefore(selectedDate, 6), [selectedDate]);
  const weeklyNoteCount = useMemo(
    () => notes.filter((note) => (!dateFrom || note.date >= dateFrom) && note.date <= selectedDate).length,
    [notes, dateFrom, selectedDate],
  );

  async function generateDraft(documentType: QuickDocumentType) {
    setError("");
    setStatusMessage("");

    setLoadingType(documentType);
    try {
      const selectedNotes = notesForDocument(notes, documentType, dateFrom, selectedDate);
      if (documentType === "isbar") {
        const formatted = formatSoapBasedIsbar(patient, selectedNotes, selectedDate);
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
        setEditableText(formatted);
        setStatusMessage("SBAR drafted from reviewed SOAP. Review, edit, then save.");
        return;
      }
      const rulePlan = applyClinicalKnowledgeToText(patientRuleContext(patient, selectedNotes), {
        pmh: [patient.underlyingDiseases, patient.admissionPMH].filter(Boolean),
        activeProblems: [patient.activeProblems, patient.primaryDiagnosis].filter(Boolean),
      });
      const ruleFormatted = formatRuleReviewedDocument(documentType, rulePlan);
      const result = await generateClinicalDocument({
        patientId: patient.id,
        documentType,
        rawText: "",
        dateFrom: documentType === "weeklySummary" ? dateFrom : "",
        dateTo: documentType === "weeklySummary" ? selectedDate : "",
        deidentifiedConfirmed: true,
        storeRawText: false,
      });
      const aiHasReasoning = hasClinicalReasoning(result.draft.clinicalReasoning);
      const formatted = !aiHasReasoning && ruleFormatted ? ruleFormatted : formatClinicalDocumentDraft(result.draft);
      setDraft(result.draft);
      setEditableText(formatted);
      setStatusMessage(
        aiHasReasoning
          ? `${documentLabel(documentType)} generated with AI clinical reasoning and local rule review. Review, edit, then save. Draft: ${result.draftId}`
          : `${documentLabel(documentType)} drafted with local Clinical Knowledge review. Review, edit, then save.`,
      );
    } catch (nextError) {
      const selectedNotes = notesForDocument(notes, documentType, dateFrom, selectedDate);
      const rulePlan = applyClinicalKnowledgeToText(patientRuleContext(patient, selectedNotes), {
        pmh: [patient.underlyingDiseases, patient.admissionPMH].filter(Boolean),
        activeProblems: [patient.activeProblems, patient.primaryDiagnosis].filter(Boolean),
      });
      const ruleFormatted = formatRuleReviewedDocument(documentType, rulePlan);
      if (ruleFormatted) {
        setDraft(localClinicalDraft(documentType, ruleFormatted, rulePlan));
        setEditableText(ruleFormatted);
        setStatusMessage(
          `${documentLabel(documentType)} drafted locally because AI generation was unavailable. Review, edit, then save.`,
        );
      } else {
        setError(getErrorMessage(nextError));
      }
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
        </div>
      </div>

      <DeidNotice />

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
