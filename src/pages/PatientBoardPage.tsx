import { Link } from "react-router-dom";
import { useState } from "react";
import type { AnalyzePatientBatchTextInput, DailyNotesByPatient, Patient, PatientImportDraft, SortMode, TaskCategory, TaskPriority } from "../types";
import {
  createId,
  createTodayFromYesterday,
  emptyPatient,
  getActiveAttendingNames,
  getActivePatients,
  getPatientDisplaySummary,
  hasUpcomingDischarge,
  nowIso,
  parseLabText,
  pendingDischargePrep,
  sortPatients,
  textToItems,
  todayKey,
} from "../utils";
import { analyzePatientBatchText } from "../firebase/aiService";
import { applyClinicalKnowledgeToPatientImportDraft } from "../clinicalKnowledge";
import { buildConcisePatientClinicalUpdate } from "../clinicalPatientPolish";
import PatientForm from "../components/PatientForm";
import { ClinicalText } from "../components/ClinicalText";
import { BoardSignalPanel } from "../components/BoardSignalPanel";
import {
  IconArchive,
  IconBrief,
  IconCreateToday,
  IconDetails,
  IconDischarge,
  IconStar,
} from "../components/icons";
import { useT } from "../i18n";
import { getRoundingDigest, type RoundingDigest } from "../roundingDigest";

interface PageProps {
  patients: Patient[];
  dailyNotesByPatient?: DailyNotesByPatient;
  dataLoading: boolean;
  dataError: string;
  isDemoMode?: boolean;
  onCreatePatient: (patient: Patient) => Promise<void>;
  onSavePatient: (patient: Patient) => Promise<void>;
}

const taskCategories: TaskCategory[] = ["lab", "imaging", "consult", "discharge", "family", "order", "other"];
type BulkImportMode = NonNullable<AnalyzePatientBatchTextInput["importMode"]>;

function uniqueLines(...values: string[]) {
  const seen = new Set<string>();
  return values
    .flatMap((value) => value.split(/\r?\n|;/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function parseImportAge(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeImportSex(value: PatientImportDraft["sex"], fallback: Patient["sex"]) {
  return value === "M" || value === "F" || value === "Other" ? value : fallback;
}

function normalizeTaskPriority(value: string): TaskPriority {
  if (value === "urgent" || value === "low") return value;
  return "normal";
}

function normalizeTaskCategory(value: string): TaskCategory {
  return taskCategories.includes(value as TaskCategory) ? (value as TaskCategory) : "other";
}

function taskLine(task: PatientImportDraft["tasks"][number]) {
  const meta = [
    task.priority !== "normal" ? task.priority : "",
    task.category !== "other" ? task.category : "",
    task.dueDate,
  ].filter(Boolean);
  return `${meta.length > 0 ? `[${meta.join(", ")}] ` : ""}${task.text}`;
}

function parseTaskLines(value: string): PatientImportDraft["tasks"] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const metaMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      const meta = metaMatch ? metaMatch[1].split(",").map((item) => item.trim().toLowerCase()) : [];
      const text = (metaMatch ? metaMatch[2] : line).replace(/^!+/, "").trim();
      const priority = line.startsWith("!") ? "urgent" : normalizeTaskPriority(meta.find((item) => item === "urgent" || item === "low") ?? "normal");
      const category = normalizeTaskCategory(meta.find((item) => taskCategories.includes(item as TaskCategory)) ?? "other");
      const dueDate = meta.find((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)) ?? "";
      return { text, priority, dueDate, category };
    })
    .filter((task) => task.text);
}

function mergeTasks(existingTasks: Patient["tasks"], draftTasks: PatientImportDraft["tasks"]) {
  const seen = new Set(existingTasks.map((task) => task.text.trim().toLowerCase()).filter(Boolean));
  const now = nowIso();
  const importedTasks = draftTasks
    .filter((task) => task.text.trim() && !seen.has(task.text.trim().toLowerCase()))
    .map((task) => ({
      id: createId("t"),
      text: task.text.trim(),
      done: false,
      priority: task.priority,
      category: task.category,
      dueDate: task.dueDate,
      createdAt: now,
      completedAt: "",
    }));
  return [...existingTasks, ...importedTasks];
}

function importDraftToPatient(draft: PatientImportDraft, existingPatient?: Patient, importMode: BulkImportMode = "newAdmission"): Patient {
  const now = nowIso();
  const base = existingPatient ?? emptyPatient();
  const isExistingInpatientImport = importMode === "existingInpatient";
  const underlyingDiseases = uniqueLines(base.underlyingDiseases, draft.underlyingDiseases);
  const activeProblems = uniqueLines(base.activeProblems, draft.activeProblems);
  const hospitalCourseHighlights = uniqueLines(
    base.hospitalCourseHighlights,
    draft.hospitalCourseHighlights,
    draft.antibioticsProceduresConsults.length > 0 ? `Abx/procedures/consults: ${draft.antibioticsProceduresConsults.join("; ")}` : "",
  );
  const dischargePlan = uniqueLines(
    base.dischargePlan,
    draft.dischargePlan,
    draft.disposition ? `Disposition: ${draft.disposition}` : "",
  );
  const admissionSummary = draft.admissionSummary.trim();

  const nextPatient: Patient = {
    ...base,
    id: existingPatient?.id ?? base.id,
    bed: draft.bed || base.bed,
    patientCode: draft.patientCode || base.patientCode,
    age: parseImportAge(draft.age, base.age),
    sex: normalizeImportSex(draft.sex, base.sex),
    attending: draft.attending || base.attending,
    teamOrService: draft.teamOrService || base.teamOrService,
    primaryDiagnosis: draft.primaryDiagnosis || base.primaryDiagnosis,
    oneLiner: draft.oneLiner || base.oneLiner,
    chiefComplaint: draft.chiefComplaint || base.chiefComplaint,
    subjectiveOrChiefConcern: uniqueLines(base.subjectiveOrChiefConcern, draft.todayUpdates),
    vitalSigns: uniqueLines(base.vitalSigns, draft.vitalSigns),
    physicalExam: uniqueLines(base.physicalExam, draft.physicalExam),
    rawLabText: uniqueLines(base.rawLabText, draft.labText),
    newLabs: uniqueLines(base.newLabs, draft.labText),
    parsedLabItems: draft.labText.trim() ? parseLabText(uniqueLines(base.rawLabText, draft.labText)) : base.parsedLabItems,
    newImaging: uniqueLines(base.newImaging, draft.imageText),
    admissionChiefConcern: draft.chiefComplaint || base.admissionChiefConcern,
    admissionBriefFreeText: isExistingInpatientImport ? base.admissionBriefFreeText : admissionSummary || base.admissionBriefFreeText,
    generatedAdmissionSummary: isExistingInpatientImport ? base.generatedAdmissionSummary : admissionSummary || base.generatedAdmissionSummary,
    generatedWeeklySummary: isExistingInpatientImport && admissionSummary ? uniqueLines(base.generatedWeeklySummary, admissionSummary) : base.generatedWeeklySummary,
    underlyingDiseases,
    underlyingDiseaseItems: textToItems(underlyingDiseases),
    activeProblems,
    activeProblemItems: textToItems(activeProblems),
    hospitalCourseHighlights: isExistingInpatientImport ? uniqueLines(hospitalCourseHighlights, admissionSummary) : hospitalCourseHighlights,
    importantRedFlags: uniqueLines(base.importantRedFlags, draft.importantRedFlags),
    dischargePlan,
    isNewAdmission: existingPatient ? base.isNewAdmission : !isExistingInpatientImport && Boolean(admissionSummary || draft.chiefComplaint),
    showAdmissionBriefOnPrint: existingPatient ? base.showAdmissionBriefOnPrint : !isExistingInpatientImport && Boolean(admissionSummary),
    status: "active",
    tasks: mergeTasks(base.tasks, draft.tasks),
    createdAt: existingPatient?.createdAt ?? base.createdAt,
    updatedAt: now,
  };

  return buildConcisePatientClinicalUpdate(nextPatient, [], todayKey());
}

function splitImportChunks(rawText: string): string[] {
  const normalized = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\s+(?=(?:bed|room|rm)\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9-]{1,}\b)/gi, "\n\n");

  return normalized
    .split(/\n{2,}|(?=\n\s*(?:bed|room|rm)\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9-]{1,}\b)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 20)
    .slice(0, 12);
}

function extractLabeledSection(chunk: string, labels: string[], stopLabels: string[] = []) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopPattern = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = stopPattern
    ? new RegExp(`\\b(?:${labelPattern})\\s*[:：-]?\\s*([\\s\\S]*?)(?=\\b(?:${stopPattern})\\b\\s*[:：-]?|$)`, "i")
    : new RegExp(`\\b(?:${labelPattern})\\s*[:：-]?\\s*([^\\n]+)`, "i");
  return chunk.match(pattern)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
}

function importFragments(chunk: string) {
  return chunk
    .split(/\n|(?<=[.;])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function localRuleBasedImportDrafts(rawText: string, existingPatients: Patient[], importMode: BulkImportMode = "existingInpatient"): PatientImportDraft[] {
  const chunks = splitImportChunks(rawText);
  const stopLabels = ["bed", "room", "rm", "dx", "diagnosis", "impression", "pmh", "underlying", "past history", "today", "task", "tasks", "pending", "dispo", "disposition", "dc", "discharge"];

  return chunks.map((chunk, index) => {
    const bed = chunk.match(/\b(?:bed|room|rm)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{1,})\b/i)?.[1] ?? "";
    const patientCode = chunk.match(/\b(?:code|pt|patient|id)\s*[:#-]?\s*([A-Za-z0-9-]{2,})\b/i)?.[1] ?? "";
    const ageSex = chunk.match(/\b(\d{1,3})\s*\/\s*(M|F)\b/i);
    const diagnosis = extractLabeledSection(chunk, ["dx", "diagnosis", "impression"], stopLabels);
    const pmh = extractLabeledSection(chunk, ["pmh", "underlying", "past history"], stopLabels);
    const dischargePlan = extractLabeledSection(chunk, ["dispo", "disposition", "dc", "discharge"], stopLabels);
    const fragments = importFragments(chunk);
    const courseFragments = fragments
      .filter((line) => /course|started|stopped|s\/p|treated|improved|worse|icu|ward|abx|antibiotic|cef|vanco|procedure|consult|today|overnight|pending|dispo|dc|discharge/i.test(line))
      .slice(0, 6);
    const draftSummary = importMode === "existingInpatient"
      ? uniqueLines(diagnosis, courseFragments.join("\n"), dischargePlan).slice(0, 700)
      : fragments.slice(0, 4).join(" ").slice(0, 500);
    const tasks = fragments
      .filter((line) => /f\/u|follow|pending|consult|call|repeat|order|arrange|swallow|culture|mri|ct|echo|scope|dc|discharge|dispo/i.test(line))
      .slice(0, 6)
      .map((line) => ({
        text: line.trim(),
        priority: /urgent|stat|call|shock|desat|bleed|fever|hypotension|!/.test(line.toLowerCase()) ? "urgent" as const : "normal" as const,
        dueDate: "",
        category: /culture|hb|cr|k|glucose|lactate|lab/i.test(line) ? "lab" as const : /mri|ct|echo|cxr|image/i.test(line) ? "imaging" as const : /consult|rehab|id|neuro|cardio|renal|gi|onc/i.test(line) ? "consult" as const : /dc|discharge|dispo|home|rehab|snf/i.test(line) ? "discharge" as const : "other" as const,
      }));
    const match = existingPatients.find(
      (patient) =>
        (bed && patient.bed.trim().toLowerCase() === bed.toLowerCase()) ||
        (patientCode && patient.patientCode.trim().toLowerCase() === patientCode.toLowerCase()),
    );

    return {
      id: `demo-import-${index + 1}`,
      status: match ? "updateCandidate" : "new",
      matchPatientId: match?.id ?? "",
      sourceIndex: index,
      bed,
      patientCode,
      age: ageSex?.[1] ?? "",
      sex: (ageSex?.[2]?.toUpperCase() as "M" | "F" | undefined) ?? "",
      attending: "",
      teamOrService: "",
      primaryDiagnosis: diagnosis,
      oneLiner: diagnosis || fragments[0]?.slice(0, 140) || "",
      chiefComplaint: "",
      todayUpdates: extractLabeledSection(chunk, ["today", "overnight", "transfer note", "progress"], stopLabels),
      vitalSigns: fragments.filter((line) => /\b(bp|hr|rr|spo2|sat|temp|fever|afebrile|o2|nc|hfno|bipap)\b/i.test(line)).slice(0, 3).join("\n"),
      physicalExam: fragments.filter((line) => /\b(pe|exam|abd|lung|edema|wound|confusion|weak|delirium|pressure injury)\b/i.test(line)).slice(0, 4).join("\n"),
      labText: fragments.filter((line) => /\b(lab|wbc|hb|plt|cr|bun|na|k|inr|lactate|crp|pct|troponin|bnp|culture|vanco|bilirubin|ast|alt)\b/i.test(line)).slice(0, 8).join("\n"),
      imageText: fragments.filter((line) => /\b(image|ct|mri|cxr|echo|sono|x-ray|xray|ercp)\b/i.test(line)).slice(0, 6).join("\n"),
      admissionSummary: draftSummary,
      underlyingDiseases: pmh,
      activeProblems: diagnosis,
      hospitalCourseHighlights: fragments
        .filter((line) => /course|started|stopped|s\/p|treated|improved|worse|icu|ward|abx|antibiotic|cef|vanco|procedure|consult|overnight|today/i.test(line))
        .slice(0, 5)
        .join("\n"),
      importantRedFlags: fragments
        .filter((line) => /shock|hypotension|desat|hypoxia|sepsis|unstable|active bleed|melena|hematemesis|neutropenic fever|new weakness|aphasia|decreased consciousness|urgent|red flag/i.test(line))
        .slice(0, 4)
        .join("\n"),
      tasks,
      antibioticsProceduresConsults: fragments
        .filter((line) => /cef|pip\/tazo|vanco|abx|antibiotic|consult|procedure|scope|cath|biopsy/i.test(line))
        .slice(0, 5),
      dischargePlan,
      disposition: "",
      uncertainty: ["Demo parser only. Review before saving."],
      sourceExcerpt: chunk.slice(0, 500),
    };
  });
}

function localDemoImportDrafts(rawText: string, existingPatients: Patient[]): PatientImportDraft[] {
  const chunks = rawText
    .split(/\n{2,}|(?=\n\s*(?:bed|床|room|rm)\s*[:#-]?\s*[A-Za-z0-9-]+)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 20)
    .slice(0, 12);

  return chunks.map((chunk, index) => {
    const bed = chunk.match(/(?:bed|床|room|rm)\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] ?? "";
    const patientCode = chunk.match(/(?:code|pt|patient|id)\s*[:#-]?\s*([A-Za-z0-9-]{2,})/i)?.[1] ?? "";
    const ageSex = chunk.match(/\b(\d{1,3})\s*\/\s*(M|F)\b/i);
    const diagnosis = chunk.match(/(?:dx|diagnosis|impression)\s*[:：-]\s*([^\n]+)/i)?.[1]?.trim() ?? "";
    const pmh = chunk.match(/(?:pmh|underlying|past history)\s*[:：-]\s*([^\n]+)/i)?.[1]?.trim() ?? "";
    const tasks = chunk
      .split(/\r?\n/)
      .filter((line) => /f\/u|follow|pending|consult|call|repeat|order|arrange|dc|discharge/i.test(line))
      .slice(0, 5)
      .map((line) => ({ text: line.trim(), priority: /urgent|stat|call|!/.test(line.toLowerCase()) ? "urgent" as const : "normal" as const, dueDate: "", category: "other" as const }));
    const match = existingPatients.find(
      (patient) =>
        (bed && patient.bed.trim().toLowerCase() === bed.toLowerCase()) ||
        (patientCode && patient.patientCode.trim().toLowerCase() === patientCode.toLowerCase()),
    );

    return {
      id: `demo-import-${index + 1}`,
      status: match ? "updateCandidate" : "new",
      matchPatientId: match?.id ?? "",
      sourceIndex: index,
      bed,
      patientCode,
      age: ageSex?.[1] ?? "",
      sex: (ageSex?.[2]?.toUpperCase() as "M" | "F" | undefined) ?? "",
      attending: "",
      teamOrService: "",
      primaryDiagnosis: diagnosis,
      oneLiner: diagnosis || chunk.split(/\r?\n/)[0].slice(0, 120),
      chiefComplaint: "",
      todayUpdates: "",
      vitalSigns: "",
      physicalExam: "",
      labText: chunk
        .split(/\r?\n/)
        .filter((line) => /\b(lab|wbc|hb|plt|cr|bun|na|k|inr|lactate|crp|pct|troponin|bnp|culture|vanco)\b/i.test(line))
        .slice(0, 8)
        .join("\n"),
      imageText: chunk
        .split(/\r?\n/)
        .filter((line) => /\b(image|ct|mri|cxr|echo|sono|x-ray|xray|ercp)\b/i.test(line))
        .slice(0, 6)
        .join("\n"),
      admissionSummary: chunk.split(/\r?\n/).slice(0, 4).join(" ").slice(0, 500),
      underlyingDiseases: pmh,
      activeProblems: diagnosis,
      hospitalCourseHighlights: "",
      importantRedFlags: chunk
        .split(/\r?\n/)
        .filter((line) => /shock|bleed|desat|hypoxia|sepsis|unstable|call|urgent|red flag/i.test(line))
        .slice(0, 4)
        .join("\n"),
      tasks,
      antibioticsProceduresConsults: chunk
        .split(/\r?\n/)
        .filter((line) => /cef|pip\/tazo|vanco|abx|antibiotic|consult|procedure|scope|cath/i.test(line))
        .slice(0, 5),
      dischargePlan: chunk.match(/(?:dispo|disposition|dc|discharge)\s*[:：-]\s*([^\n]+)/i)?.[1]?.trim() ?? "",
      disposition: "",
      uncertainty: ["Demo parser only. Review before saving."],
      sourceExcerpt: chunk.slice(0, 500),
    };
  });
}

function PatientBoardPage({
  patients,
  dailyNotesByPatient = {},
  dataLoading,
  dataError,
  isDemoMode = false,
  onCreatePatient,
  onSavePatient,
}: PageProps) {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [draftPatient, setDraftPatient] = useState<Patient>(emptyPatient());
  const [sortMode, setSortMode] = useState<SortMode>("bed");
  const [attendingFilter, setAttendingFilter] = useState("all");
  const [bulkText, setBulkText] = useState("");
  const [bulkImportMode, setBulkImportMode] = useState<BulkImportMode>("existingInpatient");
  const [bulkConfirmed, setBulkConfirmed] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkDrafts, setBulkDrafts] = useState<PatientImportDraft[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const attendingNames = getActiveAttendingNames(patients);
  const uniquePatients = Array.from(new Map(patients.map((patient) => [patient.id, patient])).values());
  const activeSourcePatients = getActivePatients(uniquePatients);
  const activePatients = sortPatients(
    activeSourcePatients.filter(
      (patient) => attendingFilter === "all" || patient.attending.trim() === attendingFilter,
    ).map((patient) => getPatientDisplaySummary(patient, dailyNotesByPatient).patient),
    sortMode,
  );
  const dischargeAlerts = activePatients
    .map((patient) => ({ patient, pending: pendingDischargePrep(patient) }))
    .filter(({ patient, pending }) => hasUpcomingDischarge(patient) && pending.length > 0);
  const newAdmissionPatients = activePatients
    .filter((patient) => patient.isNewAdmission || patient.showAdmissionBriefOnPrint)
    .slice(0, 6);
  const dischargeSoonPatients = activePatients
    .filter(hasDischargeSoonSignal)
    .slice(0, 6);
  const activeTodayCount = activePatients.filter((patient) => {
    const digest = boardDigest(patient);
    return Boolean(digest.subjective || digest.objective || digest.lab || digest.image || pendingTasks(patient).length > 0);
  }).length;

  async function addPatient() {
    const now = nowIso();
    await onCreatePatient({ ...draftPatient, createdAt: now, updatedAt: now, status: "active" });
    setDraftPatient(emptyPatient());
    setShowForm(false);
  }

  async function analyzeBulkText() {
    setBulkError("");
    setBulkStatus("");
    if (!bulkConfirmed) {
      setBulkError("Confirm the pasted batch is de-identified before analysis.");
      return;
    }
    if (bulkText.trim().length < 40) {
      setBulkError("Paste a longer service list or handover batch.");
      return;
    }

    setBulkLoading(true);
    try {
      const result = isDemoMode
        ? {
            drafts: localRuleBasedImportDrafts(bulkText, activeSourcePatients, bulkImportMode),
            model: "local-demo-parser",
            draftId: "local-demo",
            rawTextPreview: bulkText.slice(0, 700),
          }
        : await analyzePatientBatchText({
            rawText: bulkText,
            deidentifiedConfirmed: true,
            importMode: bulkImportMode,
            existingPatients: activeSourcePatients.map((patient) => ({
              id: patient.id,
              bed: patient.bed,
              patientCode: patient.patientCode,
              primaryDiagnosis: patient.primaryDiagnosis,
            })),
          });
      const knowledgeDrafts = result.drafts.map((draft) => applyClinicalKnowledgeToPatientImportDraft(draft));
      setBulkDrafts(knowledgeDrafts);
      setSelectedDraftIds(new Set(knowledgeDrafts.filter((draft) => draft.status === "new").map((draft) => draft.id)));
      setBulkStatus(
        knowledgeDrafts.length > 0
          ? `Extracted ${knowledgeDrafts.length} draft card${knowledgeDrafts.length > 1 ? "s" : ""} with Clinical Knowledge review. Review before saving.`
          : "No patient cards were extracted. Try separating patients with blank lines or bed labels.",
      );
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Bulk import analysis failed.");
    } finally {
      setBulkLoading(false);
    }
  }

  function updateBulkDraft(draftId: string, patch: Partial<PatientImportDraft>) {
    setBulkDrafts((current) => current.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft)));
  }

  function toggleBulkDraft(draftId: string) {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      if (next.has(draftId)) {
        next.delete(draftId);
      } else {
        next.add(draftId);
      }
      return next;
    });
  }

  async function createSelectedBulkDrafts() {
    const selectedDrafts = bulkDrafts.filter((draft) => selectedDraftIds.has(draft.id));
    if (selectedDrafts.length === 0) {
      setBulkError("Select at least one reviewed patient draft before saving.");
      return;
    }

    setBulkError("");
    setBulkStatus("");
    setBulkLoading(true);
    try {
      for (const draft of selectedDrafts) {
        const existingPatient =
          draft.status === "updateCandidate" && draft.matchPatientId
            ? activeSourcePatients.find((patient) => patient.id === draft.matchPatientId)
            : undefined;
        const patient = importDraftToPatient(draft, existingPatient, bulkImportMode);
        if (existingPatient) {
          await onSavePatient(patient);
        } else {
          await onCreatePatient(patient);
        }
      }
      setBulkStatus(`Saved ${selectedDrafts.length} reviewed patient draft${selectedDrafts.length > 1 ? "s" : ""}.`);
      setBulkDrafts((current) => current.filter((draft) => !selectedDraftIds.has(draft.id)));
      setSelectedDraftIds(new Set());
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Saving selected import drafts failed.");
    } finally {
      setBulkLoading(false);
    }
  }

  async function updateStatus(patientId: string, status: Patient["status"]) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({ ...patient, status, updatedAt: nowIso() });
  }

  async function startToday(patientId: string) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient(createTodayFromYesterday(patient));
  }

  async function setNewAdmission(patientId: string, isNewAdmission: boolean) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({
      ...patient,
      isNewAdmission,
      showAdmissionBriefOnPrint: isNewAdmission ? true : patient.showAdmissionBriefOnPrint,
      updatedAt: nowIso(),
    });
  }

  async function setAdmissionBriefPrint(patientId: string, showAdmissionBriefOnPrint: boolean) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return;
    await onSavePatient({
      ...patient,
      showAdmissionBriefOnPrint,
      updatedAt: nowIso(),
    });
  }

  function boardDigest(patient: Patient) {
    return getRoundingDigest(patient, dailyNotesByPatient[patient.id] ?? [], {
      mode: "board",
      hideCompletedTasks: true,
    });
  }

  function taskSummary(patient: Patient, digest: RoundingDigest) {
    const pendingTasks = patient.tasks.filter((task) => !task.done);
    const urgentTasks = pendingTasks.filter(
      (task) => task.priority === "urgent" || task.text.trim().startsWith("!"),
    );

    return (
      <div>
        {urgentTasks.length > 0 && <span className="badge urgent">{urgentTasks.length} urgent</span>}{" "}
        <span>{pendingTasks.length} pending</span>
        <ClinicalText value={digest.tasks} fallback="No pending tasks" maxLines={3} maxCharsPerLine={46} />
      </div>
    );
  }

  function pendingTasks(patient: Patient) {
    return patient.tasks.filter((task) => !task.done);
  }

  function shortCockpitText(value: string, maxChars = 72) {
    const clean = value
      .replace(/^!+/, "")
      .replace(/\s+-\s*Reason:\s*.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= maxChars) return clean;
    const firstClause = clean.split(/[;；。]/)[0]?.trim() || clean;
    if (firstClause.length <= maxChars) return firstClause;
    return firstClause.slice(0, maxChars).trim();
  }

  function dateIsTodayOrTomorrow(date: string) {
    if (!date) return false;
    const today = todayKey();
    const tomorrowDate = new Date(`${today}T00:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);
    return date === today || date === tomorrow;
  }

  function dischargeTasks(patient: Patient) {
    return patient.tasks.filter((task) => {
      if (task.done) return false;
      const text = `${task.category} ${task.text}`.toLowerCase();
      const isDischargeTask = task.category === "discharge" || /\bdc\b|discharge|出院|opd|certificate|診斷書|帶藥|meds/i.test(text);
      return isDischargeTask && (!task.dueDate || dateIsTodayOrTomorrow(task.dueDate) || task.priority === "urgent");
    });
  }

  function hasDischargeTextSignal(patient: Patient) {
    const text = [patient.dischargePlan, patient.dischargeBarriers, patient.vsOrder].join(" ");
    return /\bdc\b|discharge|出院|home|transfer|OPD|certificate|診斷書|帶藥/i.test(text);
  }

  function hasDischargeSoonSignal(patient: Patient) {
    return (
      hasUpcomingDischarge(patient) ||
      dischargeTasks(patient).length > 0 ||
      Boolean(patient.dischargeTargetDate && dateIsTodayOrTomorrow(patient.dischargeTargetDate)) ||
      (hasDischargeTextSignal(patient) && pendingDischargePrep(patient).length > 0)
    );
  }

  function dischargeCockpitLine(patient: Patient) {
    const pending = pendingDischargePrep(patient);
    if (hasUpcomingDischarge(patient)) {
      return [
        patient.dischargeTargetDate ? `Target ${patient.dischargeTargetDate}` : "",
        pending.length > 0 ? `pending ${pending.join("/")}` : "ready",
      ].filter(Boolean).join("; ");
    }

    const task = dischargeTasks(patient)[0];
    if (task) return `Task: ${shortCockpitText(task.text)}`;
    if (patient.dischargeTargetDate) return `Target ${patient.dischargeTargetDate}`;
    if (patient.dischargePlan.trim()) return shortCockpitText(patient.dischargePlan);
    if (patient.dischargeBarriers.trim()) return `Barrier: ${shortCockpitText(patient.dischargeBarriers)}`;
    return pending.length > 0 ? `pending ${pending.join("/")}` : "DC prep";
  }

  function newAdmissionCockpitLine(patient: Patient) {
    const digest = boardDigest(patient);
    return digest.diagnosis || patient.oneLiner || patient.primaryDiagnosis || "Needs admission summary";
  }

  function dischargeReminder(patient: Patient) {
    const pending = pendingDischargePrep(patient);
    if (!hasUpcomingDischarge(patient) || pending.length === 0) return "";
    return `DC prep pending: ${pending.join(" / ")}`;
  }

  async function updateDischargePrep(
    patient: Patient,
    field: "dischargeMedsStatus" | "opdAppointmentStatus" | "diagnosisCertificateStatus",
    status: Patient[typeof field],
  ) {
    await onSavePatient({ ...patient, [field]: status, updatedAt: nowIso() });
  }

  function renderCockpitColumn(title: string, items: Patient[], emptyText: string, kind: "admission" | "discharge") {
    return (
      <section className="cockpit-column">
        <div className="cockpit-column-header">
          <h3>{title}</h3>
          <span className="badge normal">{items.length}</span>
        </div>
        <div className="cockpit-list">
          {items.map((patient) => (
            <Link className="cockpit-item" to={`/patients/${patient.id}`} key={`${title}-${patient.id}`}>
              <span className="cockpit-bed">{patient.bed || "-"}</span>
              <span className="cockpit-main">
                <strong>{kind === "admission" ? "New admit" : "DC prep"}</strong>
                <span>
                  {kind === "admission"
                      ? newAdmissionCockpitLine(patient)
                      : dischargeCockpitLine(patient)}
                </span>
              </span>
            </Link>
          ))}
          {items.length === 0 && <span className="muted">{emptyText}</span>}
        </div>
      </section>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{t("nav.patientBoard")}</h2>
        </div>
        <button type="button" onClick={() => setShowForm(true)}>
          {t("action.addPatient")}
        </button>
      </header>

      {showForm && (
        <PatientForm
          patient={draftPatient}
          onChange={setDraftPatient}
          onSubmit={addPatient}
          submitLabel="Create Patient"
          onCancel={() => setShowForm(false)}
        />
      )}

      <section className="panel bulk-import-panel">
        <div className="section-heading">
          <div>
            <h3>Bulk Patient Import</h3>
            <p className="muted">Paste a de-identified service list once, review extracted cards, then create or update selected patients.</p>
          </div>
          <span className="badge normal">{isDemoMode ? "Demo parser" : "AI draft"}</span>
        </div>

        <label>
          Import intent
          <select
            value={bulkImportMode}
            onChange={(event) => setBulkImportMode(event.target.value as BulkImportMode)}
          >
            <option value="existingInpatient">Existing inpatient / transfer-in</option>
            <option value="newAdmission">New admissions / mixed list</option>
          </select>
        </label>
        <label>
          Service list / handover batch
          <textarea
            className="bulk-import-textarea"
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            placeholder={bulkImportMode === "existingInpatient"
              ? "Paste de-identified admission note + course summary + latest progress/labs/images. The draft should compress prior course and emphasize active A/P, today, tasks, and DC barriers."
              : "Paste de-identified admission or service-list batch text. Nothing is saved until reviewed cards are selected and created."}
          />
        </label>
        <div className="bulk-import-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={bulkConfirmed}
              onChange={(event) => setBulkConfirmed(event.target.checked)}
            />
            Text is de-identified and ready for clinician-reviewed draft extraction.
          </label>
          <button type="button" onClick={analyzeBulkText} disabled={bulkLoading}>
            {bulkLoading ? "Working..." : "Analyze batch"}
          </button>
          {bulkDrafts.length > 0 && (
            <button type="button" onClick={createSelectedBulkDrafts} disabled={bulkLoading || selectedDraftIds.size === 0}>
              Create selected patients ({selectedDraftIds.size})
            </button>
          )}
        </div>
        {bulkError && <p className="error-message">{bulkError}</p>}
        {bulkStatus && <p className="status-message">{bulkStatus}</p>}

        {bulkDrafts.length > 0 && (
          <div className="bulk-import-review">
            {bulkDrafts.map((draft) => (
              <article className="bulk-import-card" key={draft.id}>
                <header className="bulk-import-card-header">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedDraftIds.has(draft.id)}
                      onChange={() => toggleBulkDraft(draft.id)}
                    />
                    <strong>
                      {draft.bed || "No bed"} / {draft.patientCode || "No code"}
                    </strong>
                  </label>
                  <span className={`badge ${draft.status === "updateCandidate" ? "normal" : "low"}`}>
                    {draft.status === "updateCandidate" ? "update candidate" : "new patient"}
                  </span>
                </header>

                <div className="bulk-import-mini-grid">
                  <label>
                    Bed
                    <input value={draft.bed} onChange={(event) => updateBulkDraft(draft.id, { bed: event.target.value })} />
                  </label>
                  <label>
                    Patient code
                    <input
                      value={draft.patientCode}
                      onChange={(event) => updateBulkDraft(draft.id, { patientCode: event.target.value })}
                    />
                  </label>
                  <label>
                    Age
                    <input value={draft.age} onChange={(event) => updateBulkDraft(draft.id, { age: event.target.value })} />
                  </label>
                  <label>
                    Sex
                    <select
                      value={draft.sex}
                      onChange={(event) =>
                        updateBulkDraft(draft.id, { sex: event.target.value as PatientImportDraft["sex"] })
                      }
                    >
                      <option value="">Unknown</option>
                      <option value="M">M</option>
                      <option value="F">F</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label>
                    Attending
                    <input
                      value={draft.attending}
                      onChange={(event) => updateBulkDraft(draft.id, { attending: event.target.value })}
                    />
                  </label>
                  <label>
                    Service
                    <input
                      value={draft.teamOrService}
                      onChange={(event) => updateBulkDraft(draft.id, { teamOrService: event.target.value })}
                    />
                  </label>
                </div>

                <div className="bulk-import-edit-grid">
                  <label>
                    Dx / one-liner
                    <textarea
                      value={uniqueLines(draft.primaryDiagnosis, draft.oneLiner)}
                      onChange={(event) => {
                        const [primaryDiagnosis = "", ...rest] = event.target.value.split(/\r?\n/);
                        updateBulkDraft(draft.id, { primaryDiagnosis, oneLiner: rest.join("\n") });
                      }}
                    />
                  </label>
                  <label>
                    {bulkImportMode === "existingInpatient" ? "Transfer-in / course summary" : "Admission brief summary"}
                    <textarea
                      value={draft.admissionSummary}
                      onChange={(event) => updateBulkDraft(draft.id, { admissionSummary: event.target.value })}
                    />
                  </label>
                  <label>
                    Today / V/S / PE
                    <textarea
                      value={uniqueLines(draft.todayUpdates, draft.vitalSigns, draft.physicalExam)}
                      onChange={(event) => {
                        const [todayUpdates = "", vitalSigns = "", ...rest] = event.target.value.split(/\r?\n/);
                        updateBulkDraft(draft.id, { todayUpdates, vitalSigns, physicalExam: rest.join("\n") });
                      }}
                    />
                  </label>
                  <label>
                    Labs / images
                    <textarea
                      value={uniqueLines(draft.labText, draft.imageText)}
                      onChange={(event) => {
                        const value = event.target.value;
                        const [labPart = "", imagePart = ""] = value.split(/\n\s*(?:image|img|imaging)\s*:\s*/i);
                        updateBulkDraft(draft.id, { labText: labPart, imageText: imagePart });
                      }}
                    />
                  </label>
                  <label>
                    Underlying disease / PMH
                    <textarea
                      value={draft.underlyingDiseases}
                      onChange={(event) => updateBulkDraft(draft.id, { underlyingDiseases: event.target.value })}
                    />
                  </label>
                  <label>
                    Active problems
                    <textarea
                      value={draft.activeProblems}
                      onChange={(event) => updateBulkDraft(draft.id, { activeProblems: event.target.value })}
                    />
                  </label>
                  <label>
                    Course highlights / Abx / procedures / consults
                    <textarea
                      value={uniqueLines(draft.hospitalCourseHighlights, draft.antibioticsProceduresConsults.join("\n"))}
                      onChange={(event) => {
                        const lines = textToItems(event.target.value);
                        updateBulkDraft(draft.id, {
                          hospitalCourseHighlights: lines.join("\n"),
                          antibioticsProceduresConsults: [],
                        });
                      }}
                    />
                  </label>
                  <label>
                    Red flags
                    <textarea
                      value={draft.importantRedFlags}
                      onChange={(event) => updateBulkDraft(draft.id, { importantRedFlags: event.target.value })}
                    />
                  </label>
                  <label>
                    Discharge / disposition
                    <textarea
                      value={uniqueLines(draft.dischargePlan, draft.disposition)}
                      onChange={(event) => {
                        const [dischargePlan = "", ...rest] = event.target.value.split(/\r?\n/);
                        updateBulkDraft(draft.id, { dischargePlan, disposition: rest.join("\n") });
                      }}
                    />
                  </label>
                  <label className="span-2">
                    Tasks
                    <textarea
                      value={draft.tasks.map(taskLine).join("\n")}
                      onChange={(event) => updateBulkDraft(draft.id, { tasks: parseTaskLines(event.target.value) })}
                      placeholder="[urgent, lab, 2026-05-17] f/u blood culture"
                    />
                    <span className="muted">One task per line. Optional metadata: [urgent, lab, YYYY-MM-DD].</span>
                  </label>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel morning-cockpit">
        <div className="section-heading">
          <div>
            <h3>Board Overview</h3>
            <p className="muted">Census, active updates, and discharge preparation.</p>
          </div>
          <span className="muted">{activePatients.length} active</span>
        </div>
        <div className="cockpit-summary-grid" aria-label="Morning priority summary">
          <div className="cockpit-stat cockpit-stat-today">
            <strong>{activeTodayCount}</strong>
            <span>Active today</span>
          </div>
          <div className="cockpit-stat">
            <strong>{dischargeSoonPatients.length}</strong>
            <span>DC prep</span>
          </div>
          <div className="cockpit-stat">
            <strong>{activePatients.length}</strong>
            <span>Total census</span>
          </div>
        </div>
        <div className="cockpit-grid">
          {renderCockpitColumn("New Admits", newAdmissionPatients, "No new admits", "admission")}
          {renderCockpitColumn("DC Soon", dischargeSoonPatients, "No DC prep", "discharge")}
        </div>
      </section>

      {dischargeAlerts.length > 0 && (
        <section className="dc-alert-panel">
          <h3>{t("dc.upcoming")}</h3>
          {dischargeAlerts.map(({ patient, pending }) => (
            <div className="dc-alert-card" key={patient.id}>
              <div>
                <strong>
                  Bed {patient.bed || "-"} / {patient.patientCode || "-"}
                </strong>
                <div>Upcoming discharge prep: {pending.join(" / ")} pending</div>
              </div>
              <div className="dc-alert-actions">
                {patient.dischargeMedsStatus === "pending" && (
                  <>
                    <button type="button" onClick={() => updateDischargePrep(patient, "dischargeMedsStatus", "done")}>
                      Mark meds done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "dischargeMedsStatus", "notNeeded")}
                    >
                      Meds N/A
                    </button>
                  </>
                )}
                {patient.opdAppointmentStatus === "pending" && (
                  <>
                    <button type="button" onClick={() => updateDischargePrep(patient, "opdAppointmentStatus", "done")}>
                      Mark OPD done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "opdAppointmentStatus", "notNeeded")}
                    >
                      OPD N/A
                    </button>
                  </>
                )}
                {patient.diagnosisCertificateStatus === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateDischargePrep(patient, "diagnosisCertificateStatus", "done")}
                    >
                      Mark certificate done
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => updateDischargePrep(patient, "diagnosisCertificateStatus", "notNeeded")}
                    >
                      Cert N/A
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <h3>{t("board.activePatients")}</h3>
          <div className="filter-row">
            <label>
              {t("field.attending")}
              <select value={attendingFilter} onChange={(event) => setAttendingFilter(event.target.value)}>
                <option value="all">{t("field.allAttendings")}</option>
                {attendingNames.map((attendingName) => (
                  <option key={attendingName} value={attendingName}>
                    {attendingName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("action.sort")}
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="bed">{t("board.byBed")}</option>
                <option value="dischargeDate">{t("board.byDischargeDate")}</option>
                <option value="urgentFirst">{t("board.urgentFirst")}</option>
              </select>
            </label>
          </div>
        </div>
        {dataLoading && <p className="muted">{t("board.loading")}</p>}
        {dataError && <p className="error-message">{dataError}</p>}
        <div className="patient-board-grid">
          {activePatients.map((patient) => {
            const digest = boardDigest(patient);
            const patientNotes = dailyNotesByPatient[patient.id] ?? [];
            const pendingTaskCount = pendingTasks(patient).length;
            const urgentTaskCount = pendingTasks(patient).filter(
              (task) => task.priority === "urgent" || task.text.trim().startsWith("!"),
            ).length;
            const todaySignal = digest.subjective || digest.objective || digest.lab || digest.image;
            const dischargeSignal = hasDischargeSoonSignal(patient)
              ? dischargeCockpitLine(patient)
              : patient.dischargeTargetDate
                ? `Target ${patient.dischargeTargetDate}`
                : "TBD";

            return (
            <article className="patient-board-card" key={patient.id}>
              <header className="patient-board-card-header">
                <div className="patient-board-identity">
                  <strong>{patient.bed || "-"}</strong>
                  <span>{patient.patientCode || "-"}</span>
                  <span>{patient.age}/{patient.sex}</span>
                </div>
                <div className="patient-board-badges">
                  {patient.isNewAdmission && <span className="badge urgent">{t("board.newAdmission")}</span>}
                  {patient.showAdmissionBriefOnPrint && <span className="badge normal">{t("board.briefIncluded")}</span>}
                </div>
              </header>

              <div className="board-card-scanline" aria-label="Patient scan summary">
                <div className="board-scan-item">
                  <span>Dx / Issues</span>
                  <strong>{shortCockpitText(digest.diagnosis || digest.issues || patient.primaryDiagnosis || patient.oneLiner || "-", 96)}</strong>
                </div>
                <div className="board-scan-item">
                  <span>Today</span>
                  <strong>{shortCockpitText(todaySignal || "No new signal", 96)}</strong>
                </div>
                <div className={`board-scan-item ${pendingTaskCount > 0 ? "scan-active" : ""}`}>
                  <span>Tasks</span>
                  <strong>
                    {pendingTaskCount} pending{urgentTaskCount > 0 ? ` / ${urgentTaskCount} urgent` : ""}
                  </strong>
                </div>
                <div className={`board-scan-item ${hasDischargeSoonSignal(patient) ? "scan-discharge" : ""}`}>
                  <span>DC</span>
                  <strong>{shortCockpitText(dischargeSignal, 72)}</strong>
                </div>
              </div>

              <div className="patient-board-card-body">
                <section className="patient-board-section patient-board-overview patient-board-priority">
                  {digest.redFlags && (
                    <div className="board-red-flags">
                      <span className="board-label">Red Flags</span>
                      <ClinicalText value={digest.redFlags} maxLines={2} maxCharsPerLine={52} importantDefault />
                    </div>
                  )}
                  <div className="digest-line">
                    <span className="board-label">Dx</span>
                    <strong>{digest.diagnosis || "-"}</strong>
                  </div>
                  <div className="digest-line">
                    <span className="board-label">Risk</span>
                    <span>{digest.risks || "-"}</span>
                  </div>
                  <div className="digest-line">
                    <span className="board-label">Issues</span>
                    <span>{digest.issues || "-"}</span>
                  </div>
                  <div className="muted">Attending: {patient.attending || t("board.unassigned")}</div>
                </section>

                <section className="patient-board-section patient-board-today">
                  <span className="board-label">Today Signal</span>
                  <ClinicalText value={digest.subjective} fallback="-" maxLines={2} maxCharsPerLine={48} />
                  <div className="board-subsection">
                    <span className="board-label">V/S / PE</span>
                    <BoardSignalPanel value={digest.objective} fallback="-" kind="objective" maxItems={2} />
                  </div>
                  <div className="board-subsection">
                    <span className="board-label">Lab / Image</span>
                    <BoardSignalPanel value={digest.lab} fallback="No lab signal" kind="lab" maxItems={2} />
                  </div>
                  <BoardSignalPanel value={digest.image} fallback="-" kind="image" maxItems={2} />
                </section>

                <section className="patient-board-section patient-board-plan">
                  <span className="board-label">Plan / Tasks</span>
                  <ClinicalText value={digest.assessmentPlan} fallback="-" maxLines={3} maxCharsPerLine={50} />
                  <div className="board-subsection patient-board-tasks">{taskSummary(patient, digest)}</div>
                  <div className="board-subsection patient-board-discharge">
                    <span className="board-label">DC</span>
                    <strong>{patient.dischargeTargetDate || "TBD"}</strong>
                    {dischargeReminder(patient) && <div className="important-line">{dischargeReminder(patient)}</div>}
                  </div>
                </section>
              </div>

              <footer className="patient-board-card-actions">
                <div className="board-action-buttons">
                  <Link
                    className="button-link icon-button"
                    to={`/patients/${patient.id}`}
                    aria-label={t("action.details")}
                    title={t("action.details")}
                  >
                    <span className="icon-button-icon"><IconDetails /></span>
                    <span className="icon-button-label">{t("board.actionShort.details")}</span>
                  </Link>
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => startToday(patient.id)}
                    aria-label={t("action.createToday")}
                    title={t("action.createToday")}
                  >
                    <span className="icon-button-icon"><IconCreateToday /></span>
                    <span className="icon-button-label">{t("board.actionShort.createToday")}</span>
                  </button>
                  <button
                    type="button"
                    className={`secondary icon-button${patient.isNewAdmission ? " icon-button-active" : ""}`}
                    onClick={() => setNewAdmission(patient.id, !patient.isNewAdmission)}
                    aria-label={patient.isNewAdmission ? t("board.unmarkNew") : t("action.markNew")}
                    title={patient.isNewAdmission ? t("board.unmarkNew") : t("action.markNew")}
                  >
                    <span className="icon-button-icon"><IconStar /></span>
                    <span className="icon-button-label">
                      {patient.isNewAdmission ? t("board.actionShort.unmarkNew") : t("board.actionShort.markNew")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`secondary icon-button${patient.showAdmissionBriefOnPrint ? " icon-button-active" : ""}`}
                    onClick={() => setAdmissionBriefPrint(patient.id, !patient.showAdmissionBriefOnPrint)}
                    aria-label={patient.showAdmissionBriefOnPrint ? t("board.excludeBrief") : t("action.includeBrief")}
                    title={patient.showAdmissionBriefOnPrint ? t("board.excludeBrief") : t("action.includeBrief")}
                  >
                    <span className="icon-button-icon"><IconBrief /></span>
                    <span className="icon-button-label">
                      {patient.showAdmissionBriefOnPrint ? t("board.actionShort.excludeBrief") : t("board.actionShort.includeBrief")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => updateStatus(patient.id, "discharged")}
                    aria-label={t("action.discharge")}
                    title={t("action.discharge")}
                  >
                    <span className="icon-button-icon"><IconDischarge /></span>
                    <span className="icon-button-label">{t("board.actionShort.discharge")}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary icon-button"
                    onClick={() => updateStatus(patient.id, "archived")}
                    aria-label={t("action.archive")}
                    title={t("action.archive")}
                  >
                    <span className="icon-button-icon"><IconArchive /></span>
                    <span className="icon-button-label">{t("board.actionShort.archive")}</span>
                  </button>
                </div>
              </footer>
            </article>
            );
          })}
          {activePatients.length === 0 && <p className="muted">{t("board.noActivePatients")}</p>}
        </div>
      </section>
    </div>
  );
}

export default PatientBoardPage;
