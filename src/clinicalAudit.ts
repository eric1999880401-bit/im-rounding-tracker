import type {
  AiDocumentType,
  ClinicalAuditEntrypoint,
  ClinicalAuditEvent,
  ClinicalAuditPayload,
  ClinicalAuditPayloadKind,
  ClinicalAuditWrite,
  SoapEditTrace,
} from "./types";
import { buildSoapEditTrace, type SoapEditOrigin } from "./soapEditTrace";
import { createId, nowIso } from "./utils";

const PAYLOAD_RETENTION_DAYS = 30;
const MAX_PAYLOAD_CHARS = 200_000;

interface BuildSoapAuditInput {
  patientId: string;
  dailyNoteDate: string;
  entrypoint: ClinicalAuditEntrypoint;
  origin: SoapEditOrigin;
  finalText: string;
  editTrace: SoapEditTrace | null;
  baseSoapVersion: number;
  savedSoapVersion: number;
}

function retainedUntil(createdAt: string) {
  const date = new Date(createdAt);
  date.setUTCDate(date.getUTCDate() + PAYLOAD_RETENTION_DAYS);
  return date.toISOString();
}

function boundedPayload(
  eventId: string,
  patientId: string,
  kind: ClinicalAuditPayloadKind,
  value: string,
  createdAt: string,
  expiresAt: string,
  includeEmpty = false,
): ClinicalAuditPayload | null {
  const source = String(value ?? "");
  if (!source && !includeEmpty) return null;
  const text = source.slice(0, MAX_PAYLOAD_CHARS);
  return {
    id: `${eventId}-${kind}`,
    eventId,
    patientId,
    kind,
    text,
    chars: source.length,
    truncated: text.length !== source.length,
    createdAt,
    expiresAt,
  };
}

export function buildSoapAuditWrite(input: BuildSoapAuditInput): ClinicalAuditWrite {
  const id = createId("clinical-audit");
  const createdAt = nowIso();
  const expiresAt = retainedUntil(createdAt);
  const baselineText = input.origin.baselineText ?? input.origin.beforeText;
  const candidateText = input.origin.beforeText;
  const payloads = [
    boundedPayload(id, input.patientId, "source", input.origin.sourceText ?? "", createdAt, expiresAt),
    boundedPayload(id, input.patientId, "baseline", baselineText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "candidate", candidateText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "final", input.finalText, createdAt, expiresAt),
  ].filter((payload): payload is ClinicalAuditPayload => Boolean(payload));
  const emptyStats = { added: 0, removed: 0, rewritten: 0 };
  const event: ClinicalAuditEvent = {
    id,
    schemaVersion: 1,
    patientId: input.patientId,
    dailyNoteDate: input.dailyNoteDate,
    sourceDate: "",
    operation: "soap.save",
    entrypoint: input.entrypoint,
    sourceKind: input.origin.source,
    workflowMode: input.origin.workflowMode,
    aiDraftId: input.origin.aiDraftId ?? "",
    model: input.origin.model ?? "",
    qualityMode: input.origin.qualityMode ?? "",
    baseSoapVersion: input.baseSoapVersion,
    savedSoapVersion: input.savedSoapVersion,
    sourceChars: String(input.origin.sourceText ?? "").length,
    sourceStored: payloads.some((payload) => payload.kind === "source"),
    payloadKinds: payloads.map((payload) => payload.kind),
    payloadExpiresAt: expiresAt,
    changedSections: input.editTrace?.changedSections ?? [],
    changes: input.editTrace?.changes ?? [],
    stats: input.editTrace?.stats ?? emptyStats,
    acceptedAiDraftWithoutEdits: input.editTrace?.acceptedAiDraftWithoutEdits ?? false,
    truncated: Boolean(input.editTrace?.truncated || payloads.some((payload) => payload.truncated)),
    createdAt,
  };
  return { event, payloads };
}

interface BuildDittoAuditInput {
  patientId: string;
  dailyNoteDate: string;
  sourceDate: string;
  baselineText: string;
  copiedText: string;
  baseSoapVersion: number;
  savedSoapVersion: number;
}

export function buildDittoAuditWrite(input: BuildDittoAuditInput): ClinicalAuditWrite {
  const id = createId("clinical-audit");
  const createdAt = nowIso();
  const expiresAt = retainedUntil(createdAt);
  const trace = buildSoapEditTrace({
    source: "manual",
    beforeText: input.baselineText,
    afterText: input.copiedText,
    workflowMode: "dailyUpdate",
    baseSoapVersion: input.baseSoapVersion,
    savedSoapVersion: input.savedSoapVersion,
    savedAt: createdAt,
  });
  const payloads = [
    boundedPayload(id, input.patientId, "baseline", input.baselineText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "candidate", input.copiedText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "final", input.copiedText, createdAt, expiresAt),
  ].filter((payload): payload is ClinicalAuditPayload => Boolean(payload));
  const event: ClinicalAuditEvent = {
    id,
    schemaVersion: 1,
    patientId: input.patientId,
    dailyNoteDate: input.dailyNoteDate,
    sourceDate: input.sourceDate,
    operation: "ditto.copy",
    entrypoint: "detail.ditto",
    sourceKind: "ditto",
    workflowMode: "",
    aiDraftId: "",
    model: "",
    qualityMode: "",
    baseSoapVersion: input.baseSoapVersion,
    savedSoapVersion: input.savedSoapVersion,
    sourceChars: 0,
    sourceStored: false,
    payloadKinds: payloads.map((payload) => payload.kind),
    payloadExpiresAt: expiresAt,
    changedSections: trace?.changedSections ?? [],
    changes: trace?.changes ?? [],
    stats: trace?.stats ?? { added: 0, removed: 0, rewritten: 0 },
    acceptedAiDraftWithoutEdits: false,
    truncated: Boolean(trace?.truncated || payloads.some((payload) => payload.truncated)),
    createdAt,
  };
  return { event, payloads };
}

interface BuildBulkImportAuditInput {
  patientId: string;
  dailyNoteDate: string;
  sourceText: string;
  baselineText: string;
  finalText: string;
  baseSoapVersion: number;
  savedSoapVersion: number;
}

export function buildBulkImportAuditWrite(input: BuildBulkImportAuditInput): ClinicalAuditWrite {
  const id = createId("clinical-audit");
  const createdAt = nowIso();
  const expiresAt = retainedUntil(createdAt);
  const payloads = [
    boundedPayload(id, input.patientId, "source", input.sourceText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "baseline", input.baselineText, createdAt, expiresAt),
    boundedPayload(id, input.patientId, "final", input.finalText, createdAt, expiresAt),
  ].filter((payload): payload is ClinicalAuditPayload => Boolean(payload));
  const event: ClinicalAuditEvent = {
    id,
    schemaVersion: 1,
    patientId: input.patientId,
    dailyNoteDate: input.dailyNoteDate,
    sourceDate: "",
    operation: "bulk.import.apply",
    entrypoint: "board.bulk",
    sourceKind: "import",
    workflowMode: "",
    aiDraftId: "",
    model: "",
    qualityMode: "",
    baseSoapVersion: input.baseSoapVersion,
    savedSoapVersion: input.savedSoapVersion,
    sourceChars: input.sourceText.length,
    sourceStored: Boolean(input.sourceText),
    payloadKinds: payloads.map((payload) => payload.kind),
    payloadExpiresAt: expiresAt,
    changedSections: [],
    changes: [],
    stats: { added: 0, removed: 0, rewritten: 0 },
    acceptedAiDraftWithoutEdits: false,
    truncated: payloads.some((payload) => payload.truncated),
    createdAt,
  };
  return { event, payloads };
}

interface BuildAiDocumentAuditInput {
  patientId: string;
  documentType: AiDocumentType;
  auditDate: string;
  dateFrom: string;
  dateTo: string;
  sourceText: string;
  storeSourceText: boolean;
  baselineText: string;
  candidateText: string;
  finalText: string;
  aiDraftId: string;
  model: string;
  qualityMode: "fast" | "balanced" | "highAccuracy";
}

function compactAuditPreview(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
}

/**
 * Records the exact AI document candidate shown to the clinician separately
 * from the final edited text. The pasted source is retained only after an
 * explicit opt-in; its character count remains available as durable metadata.
 */
export function buildAiDocumentAuditWrite(input: BuildAiDocumentAuditInput): ClinicalAuditWrite {
  const id = createId("clinical-audit");
  const createdAt = nowIso();
  const expiresAt = retainedUntil(createdAt);
  const changed = input.candidateText !== input.finalText;
  const payloads = [
    input.storeSourceText
      ? boundedPayload(id, input.patientId, "source", input.sourceText, createdAt, expiresAt)
      : null,
    boundedPayload(id, input.patientId, "baseline", input.baselineText, createdAt, expiresAt, true),
    boundedPayload(id, input.patientId, "candidate", input.candidateText, createdAt, expiresAt, true),
    boundedPayload(id, input.patientId, "final", input.finalText, createdAt, expiresAt, true),
  ].filter((payload): payload is ClinicalAuditPayload => Boolean(payload));
  const event: ClinicalAuditEvent = {
    id,
    schemaVersion: 1,
    patientId: input.patientId,
    dailyNoteDate: input.auditDate,
    sourceDate: [input.dateFrom, input.dateTo].filter(Boolean).join(".."),
    operation: "ai.document.save",
    entrypoint: "ai.documents",
    documentType: input.documentType,
    sourceKind: "ai",
    workflowMode: "",
    aiDraftId: input.aiDraftId,
    model: input.model,
    qualityMode: input.qualityMode,
    baseSoapVersion: 0,
    savedSoapVersion: 0,
    sourceChars: input.sourceText.length,
    sourceStored: payloads.some((payload) => payload.kind === "source"),
    payloadKinds: payloads.map((payload) => payload.kind),
    payloadExpiresAt: expiresAt,
    changedSections: changed ? ["objective"] : [],
    changes: changed
      ? [{
          section: "objective",
          kind: "rewritten",
          before: compactAuditPreview(input.candidateText),
          after: compactAuditPreview(input.finalText),
        }]
      : [],
    stats: { added: 0, removed: 0, rewritten: changed ? 1 : 0 },
    acceptedAiDraftWithoutEdits: !changed,
    truncated: payloads.some((payload) => payload.truncated),
    createdAt,
  };
  return { event, payloads };
}
