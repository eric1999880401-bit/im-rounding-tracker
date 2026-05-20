import { useEffect, useRef, useState } from "react";
import type { AiClinicalSourceType, DailyNote, Patient, RoundingLayoutPreferences, UserAiStyleProfile } from "../types";
import { generateRoundSoap } from "../firebase/aiService";
import { ClinicalText } from "./ClinicalText";
import {
  formatSoapTextForEditorStyle,
  getCanonicalSoapText,
  localRoundSoapFromPaste,
  soapTextToPatientPatch,
  type SoapEditorFormat,
} from "../soapDraft";
import { editorDraftToSoapText, parseSoapTextToEditorDraft } from "../soapEditorDraft";
import { emptyDailyNote, nowIso } from "../utils";
import { SoapVisualPreview } from "./SoapVisualPreview";
import StructuredSoapEditor from "./StructuredSoapEditor";

interface RoundSoapComposerProps {
  patient: Patient;
  dailyNotes: DailyNote[];
  selectedDate: string;
  onSavePatient: (patient: Patient) => Promise<void>;
  onSaveDailyNote: (patientId: string, note: DailyNote) => Promise<void>;
  isDemoMode?: boolean;
  compact?: boolean;
  externalSoapText?: string;
  externalSoapRevision?: number;
  externalSoapStatus?: string;
  layoutPreferences?: RoundingLayoutPreferences;
  aiStyleProfile?: UserAiStyleProfile;
}

type WorkflowMode = "dailyUpdate" | "newSoap" | "transferHandoff";

const workflowModes: Array<{ value: WorkflowMode; label: string; helper: string; sourceType: AiClinicalSourceType }> = [
  {
    value: "dailyUpdate",
    label: "Daily update",
    helper: "Old inpatient: update the reviewed SOAP only with new findings/tasks and remove completed items.",
    sourceType: "dailyUpdate",
  },
  {
    value: "newSoap",
    label: "New SOAP",
    helper: "First SOAP after admission: paste admission, V/S, lab, image, and free-text description/other.",
    sourceType: "admission",
  },
  {
    value: "transferHandoff",
    label: "Transfer / handoff SOAP",
    helper: "First SOAP after transfer: paste admission, last SOAP/SBAR, V/S, lab, image, and description/other.",
    sourceType: "mixed",
  },
];

interface DailyUpdateFields {
  vitals: string;
  labs: string;
  images: string;
  other: string;
}

interface NewSoapFields {
  admission: string;
  vitals: string;
  labs: string;
  images: string;
  other: string;
}

interface TransferSoapFields {
  admission: string;
  lastSoap: string;
  vitals: string;
  labs: string;
  images: string;
  other: string;
}

const emptyDailyFields: DailyUpdateFields = { vitals: "", labs: "", images: "", other: "" };
const emptyNewSoapFields: NewSoapFields = {
  admission: "",
  vitals: "",
  labs: "",
  images: "",
  other: "",
};
const emptyTransferFields: TransferSoapFields = {
  admission: "",
  lastSoap: "",
  vitals: "",
  labs: "",
  images: "",
  other: "",
};

const soapFormatOptions: Array<{ value: SoapEditorFormat; label: string; helper: string }> = [
  { value: "standard", label: "Dash SOAP", helper: "Canonical parser-safe format: section headers, # A/P problems, - lines." },
  { value: "plain", label: "Plain SOAP", helper: "No bullet typing needed; A/P is numbered and still parses safely." },
  { value: "compact", label: "Compact round", helper: "Short check-only version for print/board scanning." },
];

function patientContext(patient: Patient) {
  return {
    age: patient.age,
    sex: patient.sex,
    pmh: patient.underlyingDiseases,
    activeProblems: patient.activeProblems,
  };
}

function selectedNoteForDate(notes: DailyNote[], selectedDate: string) {
  return notes.find((note) => note.date === selectedDate);
}

function buildSavedNote(
  soapText: string,
  patient: Patient,
  notes: DailyNote[],
  selectedDate: string,
  patch: ReturnType<typeof soapTextToPatientPatch>,
): DailyNote {
  const now = nowIso();
  const baseNote = selectedNoteForDate(notes, selectedDate) ?? emptyDailyNote(selectedDate);
  return {
    ...baseNote,
    ...patch.dailyNotePatch,
    date: selectedDate,
    soapText: soapText.trim(),
    soapStatus: "reviewed",
    soapUpdatedAt: now,
    soapVersion: 1,
    createdAt: baseNote.createdAt || now,
    updatedAt: now,
  };
}

function RoundSoapComposer({
  patient,
  dailyNotes,
  selectedDate,
  onSavePatient,
  onSaveDailyNote,
  isDemoMode = false,
  compact = false,
  externalSoapText = "",
  externalSoapRevision = 0,
  externalSoapStatus = "",
  layoutPreferences,
  aiStyleProfile,
}: RoundSoapComposerProps) {
  const canonical = getCanonicalSoapText(patient, dailyNotes, selectedDate);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("dailyUpdate");
  const [dailyFields, setDailyFields] = useState<DailyUpdateFields>(emptyDailyFields);
  const [newSoapFields, setNewSoapFields] = useState<NewSoapFields>(emptyNewSoapFields);
  const [transferFields, setTransferFields] = useState<TransferSoapFields>(emptyTransferFields);
  const [confirmed, setConfirmed] = useState(false);
  const [soapFormat, setSoapFormat] = useState<SoapEditorFormat>("standard");
  const [editorDraft, setEditorDraft] = useState(() => parseSoapTextToEditorDraft(canonical.text));
  const [rawSoapText, setRawSoapText] = useState(canonical.text);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const isComposingRef = useRef(false);
  const externalSoapRevisionRef = useRef(externalSoapRevision);
  const soapText = editorDraftToSoapText(editorDraft);

  useEffect(() => {
    if (dirty || isComposingRef.current) return;
    const nextDraft = parseSoapTextToEditorDraft(canonical.text);
    setEditorDraft(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
  }, [canonical.text, dirty]);

  useEffect(() => {
    if (externalSoapRevisionRef.current === externalSoapRevision || isComposingRef.current) return;
    externalSoapRevisionRef.current = externalSoapRevision;
    const nextSoapText = externalSoapText.trim();
    if (!nextSoapText) return;
    const nextDraft = parseSoapTextToEditorDraft(nextSoapText);
    setEditorDraft(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    setError("");
    setWarnings([]);
    setStatus(externalSoapStatus || "External SOAP draft loaded. Review, then Save reviewed SOAP.");
  }, [externalSoapRevision, externalSoapStatus, externalSoapText]);

  function updateEditorDraft(nextDraft: typeof editorDraft) {
    setEditorDraft(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
  }

  const workflow = workflowModes.find((item) => item.value === workflowMode) ?? workflowModes[0];

  function updateDailyField(field: keyof DailyUpdateFields, value: string) {
    setDailyFields((current) => ({ ...current, [field]: value }));
  }

  function updateNewSoapField(field: keyof NewSoapFields, value: string) {
    setNewSoapFields((current) => ({ ...current, [field]: value }));
  }

  function updateTransferField(field: keyof TransferSoapFields, value: string) {
    setTransferFields((current) => ({ ...current, [field]: value }));
  }

  function sourceSection(label: string, value: string) {
    const trimmed = value.trim();
    return trimmed ? `${label}:\n${trimmed}` : "";
  }

  function composeDailyUpdateText() {
    return [
      sourceSection("V/S", dailyFields.vitals),
      sourceSection("Lab", dailyFields.labs),
      sourceSection("Image", dailyFields.images),
      sourceSection("Other update / task / course", dailyFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeNewSoapText() {
    return [
      sourceSection("Admission", newSoapFields.admission),
      sourceSection("V/S", newSoapFields.vitals),
      sourceSection("Lab", newSoapFields.labs),
      sourceSection("Image", newSoapFields.images),
      sourceSection("Description / other", newSoapFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeTransferText() {
    return [
      sourceSection("Admission", transferFields.admission),
      sourceSection("Last SOAP / SBAR", transferFields.lastSoap),
      sourceSection("V/S", transferFields.vitals),
      sourceSection("Lab", transferFields.labs),
      sourceSection("Image", transferFields.images),
      sourceSection("Description / other", transferFields.other),
    ].filter(Boolean).join("\n\n").trim();
  }

  function composeRawText() {
    if (workflowMode === "newSoap") return composeNewSoapText();
    if (workflowMode === "transferHandoff") return composeTransferText();
    return composeDailyUpdateText();
  }

  function clearSourceText() {
    setDailyFields(emptyDailyFields);
    setNewSoapFields(emptyNewSoapFields);
    setTransferFields(emptyTransferFields);
  }

  async function handleGenerate() {
    const rawText = composeRawText();
    setError("");
    setStatus("");
    setWarnings([]);

    if (!confirmed) {
      setError("Confirm the pasted text is de-identified before generating SOAP.");
      return;
    }

    if (rawText.length < 10) {
      setError("Add source text into at least one guided field first.");
      return;
    }

    setLoading(true);
    try {
      const result = isDemoMode
        ? {
            draftId: "local-demo-round-soap",
            soapText: localRoundSoapFromPaste(patient, dailyNotes, selectedDate, rawText),
            warnings: ["Demo mode used a local SOAP merge instead of Firebase Functions."],
            highlightHints: [],
            model: "local-demo",
          }
        : await generateRoundSoap({
            patientId: patient.id,
            selectedDate,
            sourceType: workflow.sourceType,
            workflowMode,
            rawText,
            currentSoapBaseline: soapText || canonical.text,
            deidentifiedConfirmed: true,
            patientContext: patientContext(patient),
            userStyleProfile: aiStyleProfile,
          });

      const nextDraft = parseSoapTextToEditorDraft(result.soapText.trim() || canonical.text);
      setEditorDraft(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      setDirty(true);
      setWarnings(result.warnings ?? []);
      setStatus(`SOAP preview generated (${result.model}). Edit, then Save reviewed SOAP.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "SOAP generation failed. No data was saved.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const reviewedText = editorDraftToSoapText(editorDraft).trim();
    if (!reviewedText || isComposingRef.current) return;

    setLoading(true);
    setError("");
    setStatus("");
    try {
      const patch = soapTextToPatientPatch(reviewedText, patient, selectedDate);
      const nextPatient = { ...patch.patient, updatedAt: nowIso() };
      const nextNote = buildSavedNote(reviewedText, nextPatient, dailyNotes, selectedDate, patch);
      await onSavePatient(nextPatient);
      await onSaveDailyNote(nextPatient.id, nextNote);
      const nextDraft = parseSoapTextToEditorDraft(reviewedText);
      setEditorDraft(nextDraft);
      setRawSoapText(editorDraftToSoapText(nextDraft));
      clearSourceText();
      setDirty(false);
      setStatus("Reviewed SOAP saved. Board, Details, and Print now read this note.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Saving SOAP failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleFormatSoap() {
    if (!rawSoapText.trim() || isComposingRef.current) return;
    const normalized = formatSoapTextForEditorStyle(rawSoapText, soapFormat);
    const nextDraft = parseSoapTextToEditorDraft(normalized);
    setEditorDraft(nextDraft);
    setRawSoapText(editorDraftToSoapText(nextDraft));
    setDirty(true);
    setError("");
    setStatus(`${soapFormatOptions.find((item) => item.value === soapFormat)?.label ?? "SOAP"} applied. Review, then Save reviewed SOAP.`);
  }

  return (
    <section className={compact ? "round-soap-composer compact-round-soap-composer" : "round-soap-composer"}>
      <div className="round-soap-toolbar">
        <div>
          <h3>Update SOAP</h3>
          <p className="muted">
            Source: {canonical.source === "fallback" ? "legacy fields fallback" : `${canonical.sourceDate} reviewed SOAP`}
          </p>
        </div>
        <div className="form-actions">
          <select value={workflowMode} onChange={(event) => setWorkflowMode(event.target.value as WorkflowMode)}>
            {workflowModes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select value={soapFormat} onChange={(event) => setSoapFormat(event.target.value as SoapEditorFormat)} title="SOAP editor format">
            {soapFormatOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={() => {
            const nextDraft = parseSoapTextToEditorDraft(canonical.text);
            setEditorDraft(nextDraft);
            setRawSoapText(editorDraftToSoapText(nextDraft));
            setDirty(false);
            setStatus("");
            setError("");
          }}>
            Reset
          </button>
          <button type="button" className="secondary" disabled={!rawSoapText.trim() || loading} onClick={handleFormatSoap}>
            Normalize text
          </button>
          <button type="button" disabled={!soapText.trim() || loading} onClick={() => void handleSave()}>
            Save reviewed SOAP
          </button>
        </div>
      </div>
      <p className="muted round-soap-mode-helper">{workflow.helper}</p>

      {workflowMode === "dailyUpdate" ? (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            V/S
            <textarea
              value={dailyFields.vitals}
              onChange={(event) => updateDailyField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="BP 112/70 HR 88 SpO2 99%, afebrile"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={dailyFields.labs}
              onChange={(event) => updateDailyField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="WBC/Hb/Cr/K/culture trends, only what matters"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={dailyFields.images}
              onChange={(event) => updateDailyField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Other update / tasks
            <textarea
              value={dailyFields.other}
              onChange={(event) => updateDailyField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Course, Abx, consult recs, pending/done tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      ) : workflowMode === "newSoap" ? (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            Admission
            <textarea
              value={newSoapFields.admission}
              onChange={(event) => updateNewSoapField("admission", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Admission note, one-liner, PMH, reason for admission, code status"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            V/S
            <textarea
              value={newSoapFields.vitals}
              onChange={(event) => updateNewSoapField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="T, BP, HR, RR, SpO2, O2 support"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={newSoapFields.labs}
              onChange={(event) => updateNewSoapField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CBC, renal/lytes, LFT, CRP/lactate, cultures with date/trend"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={newSoapFields.images}
              onChange={(event) => updateNewSoapField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI/echo/scope: study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Description / other
            <textarea
              value={newSoapFields.other}
              onChange={(event) => updateNewSoapField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Symptoms, course, PE, abx, procedures, consults, tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      ) : (
        <div className="round-soap-daily-grid round-soap-guided-grid">
          <label>
            Admission
            <textarea
              value={transferFields.admission}
              onChange={(event) => updateTransferField("admission", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Admission/transfer-in note, diagnosis, PMH, reason for transfer"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Last SOAP / SBAR
            <textarea
              value={transferFields.lastSoap}
              onChange={(event) => updateTransferField("lastSoap", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Last SOAP, SBAR, handoff, hospital course, major events"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            V/S
            <textarea
              value={transferFields.vitals}
              onChange={(event) => updateTransferField("vitals", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="T, BP, HR, RR, SpO2, O2 support"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Lab
            <textarea
              value={transferFields.labs}
              onChange={(event) => updateTransferField("labs", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CBC, renal/lytes, LFT, CRP/lactate, cultures with date/trend"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Image
            <textarea
              value={transferFields.images}
              onChange={(event) => updateTransferField("images", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="CT/CXR/MRI/echo/scope: study + date + key impression"
              rows={compact ? 2 : 3}
            />
          </label>
          <label>
            Description / other
            <textarea
              value={transferFields.other}
              onChange={(event) => updateTransferField("other", event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              placeholder="Symptoms, course, PE, abx, procedures, consults, tasks, DC blockers"
              rows={compact ? 2 : 3}
            />
          </label>
        </div>
      )}

      <div className="round-soap-generate-row">
        <label className="checkbox-label">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Text is de-identified.
        </label>
        <button type="button" disabled={loading || !composeRawText()} onClick={() => void handleGenerate()}>
          {loading ? "Working..." : "Generate SOAP"}
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
      {status && <p className="status-message">{status}</p>}
      {warnings.length > 0 && (
        <div className="round-soap-warnings">
          <strong>Warnings</strong>
          <ClinicalText value={warnings.join("\n")} maxLines={4} />
        </div>
      )}

      <div className="round-soap-editor-grid">
        <section className="round-soap-structured-editor">
          <div className="structured-soap-main-heading">
            <div>
              <strong>Reviewed SOAP blocks</strong>
              <span className="soap-editor-hint">Use controls for section, importance, and A/P blocks. Save writes normalized SOAP text.</span>
            </div>
          </div>
          <StructuredSoapEditor
            draft={editorDraft}
            onChange={updateEditorDraft}
            compact={compact}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
          />
          <details className="raw-soap-details">
            <summary>Raw SOAP text / paste fixer</summary>
            <p className="muted">
              Paste old SOAP or free text here, then Normalize text. Wrong bullets, full-width symbols, 1), 1., *, !, and dots are accepted.
            </p>
            <textarea
              className="soap-editor-textarea"
              value={rawSoapText}
              onChange={(event) => {
                setRawSoapText(event.target.value);
                setDirty(true);
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              spellCheck={false}
              rows={compact ? 8 : 12}
            />
          </details>
        </section>
        <section className="round-soap-preview" aria-label="Highlighted SOAP preview">
          <SoapVisualPreview value={soapText} compact={compact} layoutPreferences={layoutPreferences} />
        </section>
      </div>

      {dirty && <p className="muted">Edited preview is not saved yet. Firestore changes only after Save reviewed SOAP.</p>}
    </section>
  );
}

export default RoundSoapComposer;
