import { parseSoapText } from "./soapDraft";
import type { DailyNote, Patient } from "./types";
import { getAdmissionSummaryText, safeClinicalLine } from "./utils";

interface SoapSbarSource {
  text: string;
  sourceDate: string;
  reviewed: boolean;
}

function latestReviewedSoap(notes: DailyNote[], selectedDate = ""): SoapSbarSource {
  const selected = notes.find((note) => note.date === selectedDate && note.soapText?.trim());
  if (selected) return { text: String(selected.soapText ?? "").trim(), sourceDate: selected.date, reviewed: selected.soapStatus === "reviewed" };
  const latest = [...notes].sort((a, b) => b.date.localeCompare(a.date)).find((note) => note.soapText?.trim());
  if (latest) return { text: String(latest.soapText ?? "").trim(), sourceDate: latest.date, reviewed: latest.soapStatus === "reviewed" };
  return { text: "", sourceDate: selectedDate, reviewed: false };
}

function firstNonEmpty(values: string[]) {
  return values.map((value) => value.trim()).find(Boolean) ?? "";
}

function compactLines(lines: string[], maxItems: number, maxChars = 150) {
  const seen = new Set<string>();
  return lines
    .map((line) => safeClinicalLine(line.replace(/^!+\s*/, "").replace(/^[-*]\s*/, ""), maxChars))
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function highYieldObjective(lines: string[]) {
  return compactLines(
    lines.filter((line) =>
      /\b(v\/s|vs|bp|hr|rr|spo2|o2|lab|wbc|hb|plt|cr|bun|na|k\b|ast|alt|inr|lactate|crp|culture|b\/c|bcx|image|ct\b|mri\b|cxr\b|echo|sono|oxygen|abx|antibiotic)\b/i.test(line),
    ),
    4,
    150,
  );
}

function apSummary(draft: ReturnType<typeof parseSoapText>) {
  return compactLines(
    draft.apProblems.map((problem) => [problem.title, ...problem.lines].filter(Boolean).join(": ")),
    4,
    170,
  );
}

function recommendationLines(draft: ReturnType<typeof parseSoapText>) {
  return compactLines([...draft.taskLines, ...draft.dcLines.map((line) => `DC: ${line}`)], 5, 160);
}

export function formatSoapBasedIsbar(patient: Patient, notes: DailyNote[] = [], selectedDate = "", extraContext = "") {
  const source = latestReviewedSoap(notes, selectedDate);
  if (!source.text || !source.reviewed) {
    return "insufficient reviewed SOAP/context: save a reviewed SOAP first, or paste enough handoff context for clinician review.";
  }

  const draft = parseSoapText(source.text);
  const identity = firstNonEmpty([
    [patient.bed, patient.patientCode, patient.age ? `${patient.age}/${patient.sex}` : patient.sex].filter(Boolean).join(" "),
    draft.header[0] ?? "",
  ]);
  const dx = firstNonEmpty([
    draft.header.find((line) => /^Dx\s*:/i.test(line))?.replace(/^Dx\s*:\s*/i, "") ?? "",
    patient.primaryDiagnosis,
    patient.oneLiner,
  ]);
  const pmh = firstNonEmpty([
    draft.header.find((line) => /^PMH\s*:/i.test(line))?.replace(/^PMH\s*:\s*/i, "") ?? "",
    patient.underlyingDiseases,
    patient.admissionPMH,
  ]);
  const situation = firstNonEmpty([
    draft.header.find((line) => /^Red flags\s*:/i.test(line))?.replace(/^Red flags\s*:\s*/i, "") ?? "",
    draft.sLines[0] ?? "",
    draft.apProblems[0]?.title ?? "",
    dx,
  ]);
  const objective = highYieldObjective(draft.oLines);
  const assessment = apSummary(draft);
  const recommendations = recommendationLines(draft);
  const extra = compactLines(extraContext.split(/\r?\n|;\s+/), 2, 140);

  return [
    `I: ${[identity, dx ? `Dx: ${dx}` : ""].filter(Boolean).join(" | ")}`,
    `S: ${situation || "current situation needs clinician review."}`,
    `B: ${[pmh ? `PMH: ${pmh}` : "", getAdmissionSummaryText(patient, { allowFallback: false }), ...extra].filter(Boolean).map((line) => safeClinicalLine(line, 170)).slice(0, 3).join("; ") || "No concise background in reviewed SOAP."}`,
    "A:",
    ...(assessment.length > 0 ? assessment.map((line) => `- ${line}`) : objective.map((line) => `- ${line}`)),
    "R:",
    ...(recommendations.length > 0 ? recommendations.map((line) => `- ${line}`) : ["- Clarify exact pending tasks/call parameters before handoff."]),
  ].join("\n");
}
