import { extractActiveAntibioticNames } from "./antibioticPlan";
import { classifyClinicalLine, type ClinicalLineKind } from "./clinicalLineClassifier";
import { buildCanonicalLabDataset, canonicalLabSelectionKey, labSelectionKeysFromText } from "./labDataset";
import {
  buildCanonicalImageDataset,
  canonicalImageFallbackLines,
} from "./imageDataset";
import { formatLabVisualSummaryLinesFromText, formatLabVisualTimelineLines } from "./labVisualSummary";
import { normalizeObjectiveLabExportLines, objectiveKindFromLine } from "./objectiveLineSanitizer";
import { splitGuidedSoapSource } from "./soapDraft";
import {
  applyAiHighlightHintsToEditorDraft,
  editorDraftToSoapText,
  parseCanonicalSoapTextToEditorDraft,
  parseSoapTextToEditorDraft,
  splitSoapEditorTaskLines,
  type SoapEditorDraft,
  type SoapEditorLine,
  type SoapEditorProblem,
} from "./soapEditorDraft";
import { conciseSoapDiagnosisForDisplay } from "./soapDisplay";
import {
  guardRoundSoapDelta,
  type RoundSoapSourceFields,
  type RoundSoapWorkflowMode,
  type SoapDeltaReview,
  type SoapDeltaSection,
} from "./soapDeltaGuardrails";
import type { StructuredRoundSoapDraft } from "./types";
import { createId, stripColorMarkup } from "./utils";

export interface StructuredRoundSoapAcceptance {
  draft: SoapEditorDraft;
  review: SoapDeltaReview;
  fatalErrors: string[];
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function editorLine(text: string, kind: ClinicalLineKind, subtype?: "order"): SoapEditorLine {
  const value = clean(text);
  const classified = classifyClinicalLine(value, { fallbackKind: kind, lockKind: true });
  return {
    id: createId("soap-line"),
    text: value,
    tone: classified.tone === "info" ? "plain" : classified.tone,
    kind,
    ...(subtype ? { subtype } : {}),
  };
}

const trajectoryLabels: Record<StructuredRoundSoapDraft["assessmentPlan"][number]["status"], string> = {
  active: "Active",
  improving: "Improving",
  worsening: "Worsening",
  stable: "Stable",
  uncertain: "Uncertain",
};

function trajectorySummary(
  status: StructuredRoundSoapDraft["assessmentPlan"][number]["status"],
  summary: string,
) {
  const label = trajectoryLabels[status];
  const detail = clean(summary);
  if (!detail) return `${label}.`;
  if (new RegExp(`^${label}\\b`, "i").test(detail)) return detail;
  // Avoid a "Label: body" shape here: the legacy A/P normalizer treats
  // colon-led fragments as possible problem headings.
  return `${label} — ${detail}`;
}

export function structuredRoundSoapToEditorDraft(value: StructuredRoundSoapDraft): SoapEditorDraft {
  const objective = value.objective;
  const rawOLines = [
    ...objective.vitalSigns.map((text) => editorLine(text.replace(/^(?:V\/S|VS|Vitals?)\s*:\s*/i, ""), "vs")),
    ...objective.physicalExam.map((text) => editorLine(text.replace(/^(?:PE|Physical exam)\s*:\s*/i, ""), "pe")),
    ...objective.labs.map((item) => editorLine(`${item.panel}: ${item.values}`.replace(/^Lab\s*:\s*/i, ""), "lab")),
    ...objective.microbiology.map((text) => editorLine(`Micro: ${text.replace(/^(?:Lab\s*:\s*)?Micro\s*:\s*/i, "")}`, "lab")),
    ...objective.imaging.map((item) => editorLine(`${[item.study, item.date].filter(Boolean).join(" ")}: ${item.finding}`, "image")),
    ...objective.pathology.map((item) => editorLine(`Pathology: ${[item.specimen, item.date].filter(Boolean).join(" ")}: ${item.result}`, "other")),
    ...objective.other.map((text) => editorLine(text, "other")),
  ].filter((line) => line.text);
  const originalLines = new Map<string, SoapEditorLine[]>();
  rawOLines.forEach((line) => {
    const key = clean(line.text).toLowerCase();
    originalLines.set(key, [...(originalLines.get(key) ?? []), line]);
  });
  const oLines = normalizeObjectiveLabExportLines(rawOLines.map((line) => line.text))
    .map((text) => {
      const key = clean(text).toLowerCase();
      const originals = originalLines.get(key) ?? [];
      const original = originals.shift();
      if (original) return original;
      return editorLine(text, objectiveKindFromLine(text, "other"));
    });

  return {
    headerLines: value.headerLines.map((text) => editorLine(text, "header")),
    sLines: value.subjectiveLines.map((text) => editorLine(text, "s")),
    oLines,
    apProblems: value.assessmentPlan.map((problem): SoapEditorProblem => ({
      id: createId("soap-ap"),
      title: clean(problem.problemTitle),
      tone: problem.status === "worsening"
        ? "critical"
        : problem.status === "uncertain"
          ? "important"
          : classifyClinicalLine(problem.problemTitle, { fallbackKind: "ap", lockKind: true }).tone === "critical"
            ? "critical"
            : "plain",
      lines: [trajectorySummary(problem.status, problem.summary), problem.plan]
        .filter((line) => clean(line))
        .map((text) => editorLine(text, "ap")),
    })),
    taskLines: [
      ...value.orders.map((text) => editorLine(text.replace(/^Order\s*:\s*/i, ""), "task", "order")),
      ...value.tasks.map((text) => editorLine(text, "task")),
    ],
    dcLines: value.discharge.map((text) => editorLine(text, "dc")),
    warnings: value.warnings.map((text) => editorLine(text, "other")),
    unsortedLines: [],
  };
}

function sourceText(fields: RoundSoapSourceFields) {
  return [fields.vitals, fields.labs, fields.images, fields.orders, fields.other, fields.admission, fields.lastSoap, fields.rawSource]
    .map((value) => String(value ?? "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean)
      .join("\n"))
    .filter(Boolean)
    .join("\n");
}

function hasText(value: unknown) {
  return clean(value).length > 0;
}

function mergeSourceBlocks(...values: unknown[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = String(value ?? "").trim();
    const key = text.replace(/\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [text];
  }).join("\n");
}

export function normalizeRoundSoapSourceFields(
  fields: RoundSoapSourceFields,
): RoundSoapSourceFields & Record<string, unknown> {
  const rawSource = String(fields.rawSource ?? "").trim();
  const routeInput = mergeSourceBlocks(
    fields.admission,
    fields.lastSoap,
    rawSource,
    fields.vitals,
    fields.labs,
    fields.images,
    fields.orders,
    fields.other,
  );
  const routed = splitGuidedSoapSource(routeInput);
  const admissionIsRaw = clean(fields.admission) && clean(fields.admission) === clean(rawSource);
  const lastSoapIsRaw = clean(fields.lastSoap) && clean(fields.lastSoap) === clean(rawSource);
  return {
    admission: mergeSourceBlocks(admissionIsRaw ? "" : fields.admission, routed.admission),
    lastSoap: mergeSourceBlocks(lastSoapIsRaw ? "" : fields.lastSoap, routed.lastSoap),
    // Routed text is older context; explicit guided fields come last and win
    // same-date/same-domain tie-breaks in the canonical parsers.
    vitals: mergeSourceBlocks(routed.vitals, fields.vitals),
    labs: mergeSourceBlocks(routed.labs, fields.labs),
    images: mergeSourceBlocks(routed.images, fields.images),
    orders: mergeSourceBlocks(routed.orders, fields.orders),
    other: mergeSourceBlocks(routed.other, fields.other),
    rawSource,
  };
}

function looksLikeVitals(value: string) {
  return /\b(?:BP|HR|RR|SpO2|SaO2|Temp(?:erature)?|Pulse)\s*[:=]?\s*\d|\bT\s*[:=]?\s*\d{2}(?:\.\d+)?/i.test(value);
}

function vitalDate(value: string) {
  const full = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (full) {
    const month = full[2].padStart(2, "0");
    const day = full[3].padStart(2, "0");
    return { key: `${full[1]}-${month}-${day}`, display: `${month}-${day}` };
  }
  const short = value.match(/\b(\d{1,2})[-/](\d{1,2})\b/);
  if (!short) return { key: "", display: "" };
  const month = short[1].padStart(2, "0");
  const day = short[2].padStart(2, "0");
  return { key: `0000-${month}-${day}`, display: `${month}-${day}` };
}

function vitalValue(value: string, pattern: RegExp) {
  const matches = [...value.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))];
  return matches[matches.length - 1]?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function sourceVitalLines(value: unknown) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line && looksLikeVitals(line));
  if (lines.length === 0) return [];

  const dated = lines.map((line) => ({ line, date: vitalDate(line) }));
  const sortedDateKeys = dated.map((item) => item.date.key).filter(Boolean).sort();
  const latestKey = sortedDateKeys[sortedDateKeys.length - 1] ?? "";
  const selected = dated
    .filter((item) => !latestKey || !item.date.key || item.date.key === latestKey)
    .map((item) => item.line);
  const source = selected.join(" ");
  const dateDisplay = dated.find((item) => item.date.key === latestKey)?.date.display ?? "";
  const temperature = vitalValue(source, /\b(?:T|Temp(?:erature)?)\s*[:=]?\s*(\d{2}(?:\.\d+)?)\s*(?:°?\s*C)?/i);
  const bp = vitalValue(source, /\bBP\s*[:=]?\s*(\d{2,3}\s*\/\s*\d{2,3})/i);
  const hr = vitalValue(source, /\b(?:HR|Pulse)\s*[:=]?\s*(\d{2,3})/i);
  const rr = vitalValue(source, /\bRR\s*[:=]?\s*(\d{1,2})/i);
  const spo2 = vitalValue(source, /\b(?:SpO2|SaO2)\s*[:=]?\s*(\d{2,3}\s*%?)/i);
  const oxygen = source.match(/\b(room air|RA|nasal cannula\s*\d+(?:\.\d+)?\s*L(?:\/min)?|NC\s*\d+(?:\.\d+)?\s*L(?:\/min)?|HFNC(?:\s*\d+(?:\.\d+)?\s*L(?:\/min)?)?|NRM(?:\s*\d+(?:\.\d+)?\s*L(?:\/min)?)?|BiPAP|CPAP|mechanical ventilation|ventilator)\b/i)?.[1] ?? "";
  const parts = [
    temperature ? `T ${temperature} C` : "",
    bp ? `BP ${bp}` : "",
    hr ? `HR ${hr}` : "",
    rr ? `RR ${rr}` : "",
    spo2 ? `SpO2 ${spo2}${oxygen ? ` ${oxygen.replace(/^room air$/i, "RA")}` : ""}` : oxygen,
  ].filter(Boolean);
  const fallback = selected
    .map((line) => line.replace(/^(\(?\d{4}[-/]\d{1,2}[-/]\d{1,2}\)?\s*)?(?:Vital signs|Vitals?|V\/S|VS)\s*:\s*/i, "$1").trim())
    .join("; ");
  const text = parts.length > 0 ? `${dateDisplay ? `${dateDisplay} ` : ""}${parts.join(", ")}` : fallback;
  return text ? [editorLine(text, "vs")] : [];
}

export function isVitalsOnlyDailySource(fields: RoundSoapSourceFields) {
  const normalized = normalizeRoundSoapSourceFields(fields);
  return hasText(normalized.vitals) && ![
    normalized.labs,
    normalized.images,
    normalized.orders,
    normalized.other,
    normalized.admission,
    normalized.lastSoap,
  ].some(hasText);
}

function looksLikeLabs(value: string) {
  const labels = value.match(/\b(?:WBC|Neu|ANC|Hb|Hgb|Hct|Plt|BUN|Cr|eGFR|Na|K|Cl|Ca|Mg|Phos|Uric acid|Glucose|Glu|HbA1c|AST|ALT|ALP|T-?Bil|Alb|Amylase|Lipase|PT|INR|aPTT|D-?dimer|Fibrinogen|FDP|CRP|hsCRP|PCT|ESR|lactate|LDH|CK(?:-?MB)?|U\/?A|urinalysis|nitrite|leukocyte esterase|Ketone|ABG|VBG|pH|pCO2|pO2|HCO3|BE|troponin|TnI|TnT|BNP|NT-?proBNP)\b/gi) ?? [];
  const numbers = value.match(/(?:^|\s|[:=])([<>]?-?\d+(?:\.\d+)?)(?=\s|[,;/%)]|$)/gm) ?? [];
  return labels.length >= 2 && numbers.length >= 2;
}

function clinicallyRequiredLabLabels(
  dataset: ReturnType<typeof buildCanonicalLabDataset>,
  preferredItemIds: string[],
  preferredLabels: string[],
  context: string,
) {
  const available = new Map(dataset.latestItems.map((item) => [
    canonicalLabSelectionKey(item.name || item.label),
    item.name || item.label,
  ]));
  const preferredKeys = new Set([
    ...preferredLabels.map(canonicalLabSelectionKey),
    ...dataset.latestItems
      .filter((item) => preferredItemIds.includes(item.id))
      .map((item) => canonicalLabSelectionKey(item.name || item.label)),
  ]);
  const required = new Set<string>();
  const addAvailable = (labels: string[]) => labels.forEach((label) => {
    const key = canonicalLabSelectionKey(label);
    const display = available.get(key);
    if (display) required.add(display);
  });
  const anyAvailable = (labels: string[]) => labels.some((label) => available.has(canonicalLabSelectionKey(label)));
  const anyPreferred = (labels: string[]) => labels.some((label) => preferredKeys.has(canonicalLabSelectionKey(label)));

  // Small orientation sets are deterministic safety anchors. AI sourceIds add
  // problem-specific labs; these anchors prevent a clinically absurd omission
  // such as hiding WBC in sepsis or K in AKI.
  if (anyAvailable(["WBC", "Hb", "Plt"])) addAvailable(["WBC", "Hb", "Plt"]);
  if (anyAvailable(["Cr", "Na", "K"])) addAvailable(["Cr", "Na", "K"]);

  const infectionLabels = ["CRP", "hsCRP", "PCT", "Lactate", "ESR"];
  const infectionContext = /\b(?:infection|sepsis|septic|pna|pneumonia|uti|pyelonephritis|meningitis|cholangitis|cellulitis|abscess|osteomyelitis|fever|bacteremia|culture|cx)\b/i.test(context);
  if (infectionContext || anyPreferred(infectionLabels)) addAvailable(infectionLabels);
  if (/\b(?:neutropenic fever|febrile neutropenia|neutropenia|chemotherapy|chemo)\b/i.test(context)) {
    addAvailable(["WBC", "Neu", "ANC"]);
  }

  const urineLabels = ["UA WBC", "UA RBC", "LE", "Nitrite", "Bacteria", "Protein", "Glucose urine", "Ketone", "Specific gravity", "pH urine", "Cast"];
  if (anyAvailable(urineLabels) || /\b(?:uti|pyuria|urinary|urine|u\/?a|urinalysis)\b/i.test(context)) addAvailable(urineLabels);

  const liverLabels = ["AST", "ALT", "ALP", "GGT", "T-Bil", "D-Bil", "Alb", "PT", "INR", "aPTT"];
  if (anyPreferred(liverLabels) || /\b(?:liver|hepatic|hepatitis|transaminitis|coagulopathy|cirrhosis|jaundice)\b/i.test(context)) {
    addAvailable(liverLabels);
  } else if (anyPreferred(["AST", "ALT"])) {
    addAvailable(["AST", "ALT"]);
  }

  if (/\b(?:dka|hhs|hyperglyc(?:emia|emic)?|anion gap|metabolic acidosis)\b/i.test(context)) {
    addAvailable(["Glucose", "AC glucose", "PC glucose", "Na", "K", "Osm", "Ketone", "pH", "HCO3", "BE"]);
  }
  if (/\b(?:nstemi|stemi|acs|acute coronary|myocardial infarction|myocardial ischemia|ischemic chest pain|troponin)\b/i.test(context)) {
    addAvailable(["Troponin I", "Troponin T", "CK", "CK-MB"]);
  }
  if (/\b(?:adhf|heart failure|hfr?ef|hfpef|pulmonary edema|volume overload)\b/i.test(context)) {
    addAvailable(["BNP", "NT-proBNP", "BUN", "Cr", "Na", "K"]);
  }
  if (/\b(?:respiratory failure|hypercapnia|co2 retention|mechanical ventilation|ventilator|bipap|cpap|abg|vbg)\b/i.test(context)) {
    addAvailable(["pH", "pCO2", "pO2", "HCO3", "BE", "SaO2"]);
  }
  if (/\b(?:dic|active bleed(?:ing)?|gi bleed|hemorrhage|coagulopathy|thrombocytopenia|anticoag(?:ulation|ulated)?)\b/i.test(context)) {
    addAvailable(["Hb", "Plt", "PT", "INR", "aPTT", "D-dimer", "Fibrinogen", "FDP"]);
  }
  if (/\b(?:acute pancreatitis|pancreatitis)\b/i.test(context)) {
    addAvailable(["Lipase", "Amylase", "BUN", "Cr"]);
  }
  if (/\b(?:tumou?r lysis|tls|rhabdomyolysis|rhabdo)\b/i.test(context)) {
    addAvailable(["Uric acid", "P", "K", "Ca", "Cr", "LDH", "CK"]);
  }

  return [...required];
}

function looksLikeImage(value: string) {
  return /\b(?:CXR|CT|MRI|X-?ray|Echo|Sono|Ultrasound|US|PET|ERCP|EGD|Colonoscopy)\b/i.test(value);
}

function sourceLabEditorLines(
  fields: RoundSoapSourceFields,
  selectedLabs: StructuredRoundSoapDraft["objective"]["labs"] = [],
  baselineText = "",
  activeProblemContext = "",
) {
  const currentSource = String(fields.labs ?? "");
  const currentDataset = buildCanonicalLabDataset(currentSource);
  const validIds = new Set(currentDataset.latestItems.map((item) => item.id).filter(Boolean));
  const preferredItemIds = selectedLabs
    .flatMap((item) => item.sourceIds ?? [])
    .filter((id) => validIds.has(id));
  // Older deployed functions do not return sourceIds. Label selection keeps
  // those responses useful while exact values still come only from source.
  const preferredLabels = selectedLabs
    .filter((item) => !(item.sourceIds ?? []).some((id) => validIds.has(id)))
    .flatMap((item) => labSelectionKeysFromText(item.values));
  const selectedIdLabels = currentDataset.latestItems
    .filter((item) => preferredItemIds.includes(item.id))
    .map((item) => item.name || item.label);
  const requiredLabels = clinicallyRequiredLabLabels(
    currentDataset,
    preferredItemIds,
    [...preferredLabels, ...selectedIdLabels],
    `${sourceText(fields)}\n${baselineText}\n${activeProblemContext}`,
  );
  const baselineLabText = baselineText
    ? parseCanonicalSoapTextToEditorDraft(baselineText).oLines
        .filter((line) => line.kind === "lab" && !isMicrobiologyLabLine(line))
        .map((line) => line.text)
        .join("\n")
    : "";
  const summaryOptions = {
    includePlain: true,
    selectionMode: "aiFocused" as const,
    preferredItemIds,
    preferredLabels: [...preferredLabels, ...selectedIdLabels],
    requiredLabels,
  };
  const focusedLines = baselineLabText
    ? formatLabVisualTimelineLines(currentSource, baselineLabText, summaryOptions)
    : formatLabVisualSummaryLinesFromText(currentSource, summaryOptions);
  // If AI omitted every source ID and no disease/safety rule selected a plain
  // current analyte, show a deterministic current-only fallback. Never let an
  // older baseline masquerade as today's Lab simply because selection was empty.
  const lines = focusedLines.length > 0 || currentDataset.latestItems.length === 0
    ? focusedLines
    : formatLabVisualSummaryLinesFromText(currentSource, {
        includePlain: true,
        selectionMode: "complete",
      });
  return lines
    .map((text) => editorLine(text.replace(/^Lab\s*:\s*/i, ""), "lab"))
    .filter((line) => line.text);
}

function isMicrobiologyLabLine(line: SoapEditorLine) {
  return /(?:^|\b)(?:Micro\s*:|B\/C\b|BCx\b|Blood Cx\b|U\/C\b|UCx\b|Urine Cx\b|CSF Cx\b|Sputum Cx\b|blood culture|urine culture|sputum culture|CSF culture)/i.test(line.text);
}

function uniqueEditorLines(lines: SoapEditorLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = stripColorMarkup(line.text).replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceLines(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
}

function sourceImageEditorLines(fields: RoundSoapSourceFields) {
  const dataset = buildCanonicalImageDataset(String(fields.images ?? ""));
  return canonicalImageFallbackLines(dataset, 4).map((line) => editorLine(line, "image"));
}

function sourcePathologyEditorLines(fields: RoundSoapSourceFields) {
  return uniqueEditorLines(
    sourceLines([fields.images, fields.other, fields.admission, fields.rawSource].filter(Boolean).join("\n"))
      .filter(looksLikePathology)
      .map((text) => editorLine(`Pathology: ${text.replace(/^Pathology\s*:\s*/i, "")}`, "other")),
  );
}

function sourceOrderEditorLines(fields: RoundSoapSourceFields) {
  return uniqueEditorLines(sourceLines(fields.orders).map((text) => editorLine(text.replace(/^(?:Order|Orders?|Meds?|Medication)\s*:\s*/i, ""), "task", "order")));
}

function looksLikePathology(value: string) {
  return /\b(?:final\s+)?(?:pathology|histopathology|cytology|biopsy result)\b/i.test(value);
}

function objectiveGroups(lines: SoapEditorLine[]) {
  return {
    vs: lines.filter((line) => line.kind === "vs"),
    pe: lines.filter((line) => line.kind === "pe"),
    lab: lines.filter((line) => line.kind === "lab"),
    image: lines.filter((line) => line.kind === "image"),
    other: lines.filter((line) => !["vs", "pe", "lab", "image"].includes(line.kind)),
  };
}

function sanitizeGeneratedPe(lines: SoapEditorLine[]) {
  return uniqueEditorLines(lines.filter((line) => {
    const text = stripColorMarkup(line.text).trim();
    if (!text || looksLikeVitals(text) || looksLikeLabs(text) || looksLikeImage(text)) return false;
    return !/^(?:Dx|Diagnosis|PMH|PHx|CC|HPI|PI|Admission|Assessment|A\/P|Plan|Consult|Recommendation)\s*:/i.test(text);
  })).slice(0, 3);
}

function sanitizeGeneratedObjectiveOther(lines: SoapEditorLine[], source: string) {
  const objectiveSignal = /\b(?:I\/O|intake|output|UO|urine output|stool|BM|drain|NG|Foley|CVC|PICC|port(?:-A)?|chest tube|J-?tube|PEG|weight|ventilator|HFNC|BiPAP|CPAP|dialysis|CRRT)\b/i;
  const allowedNumbers = new Set(numericTokens(source));
  return uniqueEditorLines(lines.filter((line) => {
    const text = stripColorMarkup(line.text).trim();
    if (!text || !objectiveSignal.test(text)) return false;
    if (/^(?:Dx|Diagnosis|PMH|PHx|CC|HPI|PI|Admission|Assessment|A\/P|Plan|Consult|Recommendation)\s*:/i.test(text)) return false;
    return numericTokens(text).every((number) => allowedNumbers.has(number));
  })).slice(0, 4);
}

type SafetyHeaderLabel = "Code" | "Allergy" | "Isolation" | "HD/POD";

function normalizeSafetyHeaderValue(value: string) {
  return clean(value)
    .replace(/\s+(?=(?:Code(?:\s+status)?|Allerg(?:y|ies)|Isolation|HD\/POD)\s*:).*$/i, "")
    .replace(/[.;,]+$/, "")
    .trim();
}

function explicitSafetyHeaderFields(value: string) {
  const text = stripColorMarkup(value);
  const fields = new Map<SafetyHeaderLabel, string>();
  const segments = text
    .split(/\r?\n|\s*\|\s*|(?=\b(?:Code(?:\s+status)?|Allerg(?:y|ies)|Isolation|HD\/POD)\s*:)/i)
    .map(clean)
    .filter(Boolean);
  const capture = (label: SafetyHeaderLabel, pattern: RegExp) => {
    const match = segments.map((segment) => segment.match(pattern)).find(Boolean);
    const body = normalizeSafetyHeaderValue(match?.[1] ?? "");
    if (body) fields.set(label, `${label}: ${body}`);
  };
  capture("Code", /^(?:Code(?:\s+status)?)\s*:\s*(.+)$/i);
  capture("Allergy", /^(?:Allerg(?:y|ies))\s*:\s*(.+)$/i);
  capture("Isolation", /^Isolation\s*:\s*(.+)$/i);
  capture("HD/POD", /^HD\/POD\s*:\s*(.+)$/i);

  if (!fields.has("Code")) {
    const code = text.match(/\b(DNR(?:\s*\/\s*DNI)?|DNI|Full\s+code|Comfort\s+measures?\s+only)\b/i)?.[1] ?? "";
    if (code) fields.set("Code", `Code: ${clean(code)}`);
  }
  if (!fields.has("Allergy")) {
    const allergy = text.match(/\b(NKDA|No known drug allerg(?:y|ies))\b/i)?.[1] ?? "";
    if (allergy) fields.set("Allergy", `Allergy: ${clean(allergy)}`);
  }
  if (!fields.has("Isolation")) {
    const isolation = text.match(/\b(Contact|Droplet|Airborne|Protective|Neutropenic)\s+isolation\b/i)?.[1] ?? "";
    if (isolation) fields.set("Isolation", `Isolation: ${clean(isolation)}`);
  }
  if (!fields.has("HD/POD")) {
    const day = text.match(/\b((?:HD|POD)\s*#?\s*\d+)\b/i)?.[1] ?? "";
    if (day) fields.set("HD/POD", `HD/POD: ${clean(day)}`);
  }
  return fields;
}

function sanitizeGeneratedHeader(
  lines: SoapEditorLine[],
  problems: SoapEditorProblem[],
  source: string,
  baselineText: string,
) {
  const diagnosis = conciseSoapDiagnosisForDisplay({
    headerLines: lines.map((line) => line.text),
    apTitles: problems.map((problem) => problem.title),
    maxItems: 2,
    maxChars: 110,
  });
  const currentSafety = explicitSafetyHeaderFields(source);
  const baselineSafety = explicitSafetyHeaderFields(baselineText);
  const safetyLine = (["Code", "Allergy", "Isolation", "HD/POD"] as const)
    .map((label) => currentSafety.get(label) ?? baselineSafety.get(label) ?? "")
    .filter(Boolean)
    .join(" | ");
  return [
    ...(diagnosis ? [editorLine(`Dx: ${diagnosis}`, "header")] : []),
    ...(safetyLine ? [editorLine(safetyLine, "header")] : []),
  ];
}

function tokenSet(value: string) {
  return new Set(stripColorMarkup(value).toLowerCase().match(/[a-z][a-z0-9/+.-]{1,}|\d+(?:\.\d+)?|[\u4e00-\u9fff]{2,}/g) ?? []);
}

function titleSimilarity(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
}

function numericTokens(value: string) {
  return (value.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map((token) => Number(token))
    .filter(Number.isFinite)
    .map(String);
}

function problemEvidenceIsGrounded(
  problem: StructuredRoundSoapDraft["assessmentPlan"][number],
  baseline: SoapEditorDraft,
  source: string,
  workflowMode: RoundSoapWorkflowMode,
) {
  const existing = baseline.apProblems.some((prior) => titleSimilarity(problem.problemTitle, prior.title) >= 0.6);
  if (workflowMode === "dailyUpdate" && existing) return true;
  const available = tokenSet(workflowMode === "dailyUpdate" ? source : `${source}\n${editorDraftToSoapText(baseline)}`);
  const evidence = problem.sourceEvidence.length > 0
    ? problem.sourceEvidence.join(" ")
    : `${problem.problemTitle} ${problem.summary}`;
  const evidenceTokens = [...tokenSet(evidence)].filter((token) => token.length > 1 || /^\d/.test(token));
  if (evidenceTokens.length === 0) return false;
  const matches = evidenceTokens.filter((token) => available.has(token)).length;
  return matches >= Math.min(2, evidenceTokens.length) || matches / evidenceTokens.length >= 0.6;
}

function planLineIsGrounded(line: string, availableText: string) {
  const value = stripColorMarkup(line).trim();
  if (!value) return true;
  const available = stripColorMarkup(availableText);
  const normalizedAvailable = available.toLowerCase();
  const normalizedLine = value.toLowerCase();
  if (normalizedAvailable.includes(normalizedLine)) return true;

  const unsupportedDirectionalChange =
    /\b(?:stop|discontinue|hold|withhold|resume|restart|switch|change to|de-?escalate|escalate)\b/i.test(value) &&
    !/\b(?:stop|discontinue|hold|withhold|resume|restart|switch|change to|de-?escalate|escalate)\b/i.test(available);
  if (unsupportedDirectionalChange) return false;

  const actionConcepts: RegExp[] = [
    /\b(?:dialysis|CRRT|CVVH)\b/i,
    /\b(?:transfus(?:e|ion)|PRBC|FFP|platelet transfusion)\b/i,
    /\b(?:intubat|mechanical ventilation|BiPAP|HFNC)\b/i,
    /\b(?:EGD|ERCP|colonoscopy|bronchoscopy|surgery|operation|source control)\b/i,
    /\b(?:anticoagulat|heparin|apixaban|warfarin|thrombolysis|tPA)\b/i,
    /\b(?:insulin infusion|insulin drip|DKA protocol)\b/i,
    /\b(?:diures|furosemide|Lasix)\b/i,
    /\b(?:IVF|IV fluids?|free water|fluid restriction)\b/i,
    /\b(?:ECG|EKG|telemetry)\b/i,
    /\b(?:vasopressor|norepinephrine|levophed)\b/i,
  ];
  if (actionConcepts.some((concept) => concept.test(value) && !concept.test(available))) return false;

  const namedAntibiotics = extractActiveAntibioticNames(value);
  if (namedAntibiotics.some((name) => !normalizedAvailable.includes(name.toLowerCase()))) return false;

  const availableTokens = tokenSet(available);
  const meaningful = [...tokenSet(value)].filter((token) =>
    !/^(?:active|continue|follow|f\/u|monitor|trend|repeat|review|plan|today|closely|documented|source|grounded|treatment|pending|trajectory)$/i.test(token),
  );
  if (meaningful.length === 0) return false;
  const matched = meaningful.filter((token) => availableTokens.has(token));
  return matched.length >= Math.min(2, meaningful.length) || matched.length / meaningful.length >= 0.6;
}

function sanitizeCandidateApProblems(
  value: StructuredRoundSoapDraft,
  generated: SoapEditorDraft,
  baseline: SoapEditorDraft,
  source: string,
  workflowMode: RoundSoapWorkflowMode,
  authoritativeLabText: string,
) {
  const availableText = `${source}\n${editorDraftToSoapText(baseline)}`;
  const allowedNumbers = new Set(numericTokens(availableText));
  const hbValues = [...authoritativeLabText.matchAll(/\b(?:Hb|Hgb)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1]));
  return generated.apProblems.flatMap((problem, index) => {
    const structured = value.assessmentPlan[index];
    if (!structured || !problemEvidenceIsGrounded(structured, baseline, source, workflowMode)) return [];
    const unsupportedAnemia = /\b(?:anemia|anaemia|Hb drop)\b/i.test(problem.title) &&
      hbValues.length > 0 && hbValues.every((number) => number >= 11) &&
      !/\b(?:anemia|anaemia|Hb drop|bleed|melena|hematemesis|hematochezia|transfus|PRBC)\b/i.test(source);
    if (unsupportedAnemia) return [];
    const lines = problem.lines.filter((line, lineIndex) => {
      const hasTrackedClinicalValue = /\b(?:Na|sodium|K|potassium|Hb|Hgb|Cr|creatinine|eGFR|INR|lactate|CRP)\b/i.test(line.text);
      if (hasTrackedClinicalValue && !numericTokens(line.text).every((number) => allowedNumbers.has(number))) return false;
      return lineIndex === 0 || planLineIsGrounded(line.text, availableText);
    });
    return [{ ...problem, lines }];
  });
}

function stripRepeatedAntibioticClause(value: string, antibiotic: string) {
  const escaped = antibiotic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  const parts = value.split(/;\s*|(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => pattern.test(part))) return value;
  return parts.filter((part) => !pattern.test(part)).join("; ");
}

function sanitizeRepeatedApContent(problems: SoapEditorProblem[]) {
  const next = problems.map((problem) => ({ ...problem, lines: problem.lines.map((line) => ({ ...line })) }));
  const seenLines = new Set<string>();
  next.forEach((problem) => {
    problem.lines = problem.lines.filter((line) => {
      const key = stripColorMarkup(line.text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
      if (key.length < 18 || !seenLines.has(key)) {
        if (key.length >= 18) seenLines.add(key);
        return true;
      }
      return false;
    });
  });

  const antibioticNames = [...new Set(extractActiveAntibioticNames(next.map((problem) => `${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).join("\n")))];
  antibioticNames.forEach((name) => {
    const ownerIndexes = next.flatMap((problem, index) =>
      extractActiveAntibioticNames(`${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).some((item) => item.toLowerCase() === name.toLowerCase()) ? [index] : [],
    );
    if (ownerIndexes.length < 2) return;
    const owner = ownerIndexes.sort((left, right) => {
      const score = (index: number) => /\b(?:infection|sepsis|pna|pneumonia|uti|meningitis|bacteremia|cellulitis|abscess|osteomyelitis)\b/i.test(next[index].title) ? 10 : 0;
      return score(right) - score(left) || left - right;
    })[0];
    ownerIndexes.filter((index) => index !== owner).forEach((index) => {
      next[index].lines = next[index].lines.flatMap((line) => {
        const text = stripRepeatedAntibioticClause(line.text, name);
        return text ? [{ ...line, text }] : [];
      });
    });
  });
  return next;
}

function attachSourceAntibioticsToAp(problems: SoapEditorProblem[], orderLines: SoapEditorLine[]) {
  const next = problems.map((problem) => ({ ...problem, lines: problem.lines.map((line) => ({ ...line })) }));
  orderLines.forEach((order) => {
    const antibiotics = extractActiveAntibioticNames(order.text);
    antibiotics.forEach((name) => {
      const allApText = next.map((problem) => `${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`).join("\n");
      if (allApText.toLowerCase().includes(name.toLowerCase())) return;
      const owner = next.find((problem) => /\b(?:infection|sepsis|pna|pneumonia|uti|meningitis|bacteremia|cellulitis|abscess|osteomyelitis)\b/i.test(problem.title));
      if (!owner) return;
      owner.lines.push(editorLine(order.text, "ap"));
    });
  });
  return next;
}

function explicitInfectionSource(value: string) {
  const text = stripColorMarkup(value);
  const lobarRespiratory = text.match(/\b(RUL|RML|RLL|LUL|LLL)\b[\s\S]{0,32}\b(?:aspiration\s+)?(?:PNA|pneumonia|CAP|HAP|VAP)\b/i);
  if (lobarRespiratory) return `${lobarRespiratory[1].toUpperCase()} PNA`;
  const respiratory = text.match(/\b(?:(RUL|RML|RLL|LUL|LLL)\s+)?(?:aspiration\s+)?(?:PNA|pneumonia|CAP|HAP|VAP)\b/i);
  if (respiratory) return respiratory[0].replace(/\bpneumonia\b/i, "PNA");
  if (/\b(?:pyelonephritis|UTI|urinary tract infection|urosepsis)\b/i.test(text)) return "urinary source";
  if (/\b(?:cholangitis|biliary infection|biliary sepsis)\b/i.test(text)) return "biliary source";
  if (/\b(?:meningitis|ventriculitis|CSF infection)\b/i.test(text)) return "CNS source";
  if (/\b(?:osteomyelitis|bone infection)\b/i.test(text)) return "osteomyelitis";
  if (/\b(?:cellulitis|SSTI|soft tissue infection|wound infection)\b/i.test(text)) return "skin/wound source";
  if (/\b(?:intra-?abdominal infection|abdominal abscess|intra-?abdominal abscess)\b/i.test(text)) return "intra-abdominal source";
  if (/\b(?:line infection|catheter-related infection|CLABSI|port(?:-A)?\s+(?:infection|source)|CVC\s+(?:infection|source))\b/i.test(text)) return "line/port source";
  return "";
}

function ensureInfectionSourceContext(problems: SoapEditorProblem[], source: string) {
  const infectionProblem = /\b(?:infection|sepsis|septic|bacteremia|pna|pneumonia|cap|hap|vap|uti|pyelonephritis|cholangitis|meningitis|cellulitis|abscess|osteomyelitis)\b/i;
  const specificSource = /\b(?:pna|pneumonia|cap|hap|vap|aspiration|urinary source|uti|pyelonephritis|biliary source|cholangitis|cns source|meningitis|skin\/wound source|wound infection|cellulitis|soft tissue infection|intra-?abdominal source|abscess|osteomyelitis|line\/port source|line source|port source|catheter source|clabsi|source unclear|unknown source)\b/i;
  const sourceLabel = explicitInfectionSource(source) || "source unclear";
  return problems.map((problem) => {
    const combined = `${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`;
    if (!infectionProblem.test(problem.title) || specificSource.test(combined)) return problem;
    const sourceLine = `Source: ${sourceLabel}`;
    if (problem.lines.length === 0) return { ...problem, lines: [editorLine(sourceLine, "ap")] };
    const [first, ...rest] = problem.lines;
    return {
      ...problem,
      lines: [{ ...first, text: `${sourceLine}; ${first.text}` }, ...rest],
    };
  });
}

function finalizeApProblems(
  problems: SoapEditorProblem[],
  orderLines: SoapEditorLine[],
  source: string,
) {
  return ensureInfectionSourceContext(
    sanitizeRepeatedApContent(attachSourceAntibioticsToAp(problems, orderLines)),
    source,
  );
}

function deterministicProblemPriority(problem: SoapEditorProblem) {
  const text = stripColorMarkup(`${problem.title} ${problem.lines.map((line) => line.text).join(" ")}`);
  if (
    problem.tone === "critical" ||
    /\b(?:worsening|unstable|shock|active bleed|respiratory failure|hyperkalemia|K\s*(?:>=?|>|≥)\s*6|STEMI|stroke|neutropenic fever|DKA|HHS)\b/i.test(text)
  ) return 0;
  if (
    problem.tone === "important" ||
    /\b(?:sepsis|bacteremia|hypox|new oxygen|AKI|renal dysfunction|bleed|GI bleed|ACS|NSTEMI|arrhythmia|delirium|AMS|coagulopathy|DIC)\b/i.test(text)
  ) return 1;
  if (/\b(?:active|uncertain|unresolved|pending)\b/i.test(text)) return 2;
  if (/\b(?:improving|resolved|stable|chronic)\b/i.test(text)) return 4;
  return 3;
}

function sortEditorProblemsDeterministically(problems: SoapEditorProblem[]) {
  return [...problems].sort((left, right) => {
    const priority = deterministicProblemPriority(left) - deterministicProblemPriority(right);
    if (priority) return priority;
    return stripColorMarkup(left.title).localeCompare(stripColorMarkup(right.title), "en", { sensitivity: "base" });
  });
}

function actionableModelWarnings(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))].filter((warning) => {
    const highRisk = /\b(?:critical|unstable|active bleeding|shock|code status|allergy|cannot verify|conflicting)\b/i.test(warning);
    const actionableMissing =
      /\b(?:missing|not supplied|not provided|no recent|not updated|need(?:s)?|unknown)\b/i.test(warning) &&
      /\b(?:code|allergy|vital|BP|SpO2|oxygen|lab|Cr|creatinine|K|potassium|Hb|INR|lactate|culture|antibiotic|day count|duration|stop date|active problem|plan|discharge|destination)\b/i.test(warning);
    return (highRisk || actionableMissing) && !/\b(?:uncontextualized|formatting preference)\b/i.test(warning);
  });
}

function changedSections(before: SoapEditorDraft, after: SoapEditorDraft): SoapDeltaSection[] {
  const beforeO = objectiveGroups(before.oLines);
  const afterO = objectiveGroups(after.oLines);
  const sections: Array<[SoapDeltaSection, unknown, unknown]> = [
    ["header", before.headerLines, after.headerLines],
    ["s", before.sLines, after.sLines],
    ["vs", beforeO.vs, afterO.vs],
    ["pe", beforeO.pe, afterO.pe],
    ["lab", beforeO.lab, afterO.lab],
    ["image", beforeO.image, afterO.image],
    ["other", beforeO.other, afterO.other],
    ["ap", before.apProblems, after.apProblems],
    ["orders", splitSoapEditorTaskLines(before.taskLines).orderLines, splitSoapEditorTaskLines(after.taskLines).orderLines],
    ["tasks", splitSoapEditorTaskLines(before.taskLines).taskOnlyLines, splitSoapEditorTaskLines(after.taskLines).taskOnlyLines],
    ["dc", before.dcLines, after.dcLines],
  ];
  return sections.filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b)).map(([section]) => section);
}

export function applyVitalsOnlyDailyUpdate(
  baselineText: string,
  sourceFields: RoundSoapSourceFields,
): StructuredRoundSoapAcceptance {
  const baseline = parseCanonicalSoapTextToEditorDraft(baselineText);
  const normalizedFields = normalizeRoundSoapSourceFields(sourceFields);
  const nextVitals = sourceVitalLines(normalizedFields.vitals);
  if (nextVitals.length === 0) {
    const message = "No valid V/S values were found. The reviewed SOAP was left unchanged.";
    return {
      draft: baseline,
      fatalErrors: [message],
      review: {
        workflowMode: "dailyUpdate",
        baselineText,
        candidateText: baselineText,
        acceptedText: baselineText,
        changedSections: [],
        warnings: [],
        highRiskWarnings: [message],
      },
    };
  }

  const priorO = objectiveGroups(baseline.oLines);
  const accepted: SoapEditorDraft = {
    ...baseline,
    oLines: [...nextVitals, ...priorO.pe, ...priorO.lab, ...priorO.image, ...priorO.other],
  };
  const acceptedText = editorDraftToSoapText(accepted);
  return {
    draft: accepted,
    fatalErrors: [],
    review: {
      workflowMode: "dailyUpdate",
      baselineText,
      candidateText: acceptedText,
      acceptedText,
      changedSections: changedSections(baseline, accepted).map((id) => ({
        id,
        label: id.toUpperCase(),
        risk: "normal",
        reason: "V/S replaced directly from the pasted source; unrelated reviewed SOAP was preserved.",
        blocked: false,
      })),
      warnings: [],
      highRiskWarnings: [],
    },
  };
}

export function acceptStructuredRoundSoap(params: {
  value: StructuredRoundSoapDraft;
  baselineText: string;
  sourceFields: RoundSoapSourceFields;
  workflowMode: RoundSoapWorkflowMode;
}): StructuredRoundSoapAcceptance {
  const sourceFields = normalizeRoundSoapSourceFields(params.sourceFields);
  if (params.workflowMode === "dailyUpdate" && isVitalsOnlyDailySource(sourceFields)) {
    return applyVitalsOnlyDailyUpdate(params.baselineText, sourceFields);
  }
  const baseline = parseCanonicalSoapTextToEditorDraft(params.baselineText);
  const generated = structuredRoundSoapToEditorDraft(params.value);
  const activeProblemContext = [
    ...params.value.headerLines,
    ...params.value.assessmentPlan.flatMap((problem) => [
      problem.problemTitle,
      problem.status,
      problem.summary,
    ]),
  ].filter(Boolean).join("\n");
  const source = sourceText(sourceFields);
  const sourceOwnedVitals = sourceVitalLines(sourceFields.vitals);
  const sourceLabInputPresent = hasText(sourceFields.labs);
  const sourceOwnedLabs = sourceLabInputPresent
    ? sourceLabEditorLines(
        sourceFields,
        params.value.objective.labs,
        params.workflowMode === "dailyUpdate" ? params.baselineText : "",
        activeProblemContext,
      )
    : [];
  const sourceOwnedImages = hasText(sourceFields.images) ? sourceImageEditorLines(sourceFields) : [];
  const sourceOwnedPathology = looksLikePathology(source) ? sourcePathologyEditorLines(sourceFields) : [];
  const sourceOwnedOrders = hasText(sourceFields.orders) ? sourceOrderEditorLines(sourceFields) : [];
  const sourceOwnedLabText = sourceOwnedLabs.map((line) => line.text).join(" ");
  const generatedO = objectiveGroups(generated.oLines);
  const generatedTasks = splitSoapEditorTaskLines(generated.taskLines);
  const groundedProblems = sanitizeCandidateApProblems(
    params.value,
    generated,
    baseline,
    source,
    params.workflowMode,
    sourceOwnedLabText,
  );
  const finalizedProblems = finalizeApProblems(groundedProblems, sourceOwnedOrders, source);
  const actionableWarnings = actionableModelWarnings(params.value.warnings);
  // Exact O/Lab values belong to the source parser, not the language model.
  // The same source-owned policy restores omitted vitals, imaging, pathology,
  // and orders instead of rejecting an otherwise useful draft.
  const repairedGenerated: SoapEditorDraft = {
    ...generated,
    headerLines: sanitizeGeneratedHeader(generated.headerLines, groundedProblems, source, params.baselineText),
    oLines: [
      ...(sourceOwnedVitals.length > 0 ? sourceOwnedVitals : generatedO.vs),
      ...sanitizeGeneratedPe(generatedO.pe),
      ...(sourceLabInputPresent
        ? uniqueEditorLines([...sourceOwnedLabs, ...generatedO.lab.filter(isMicrobiologyLabLine)])
        : generatedO.lab),
      ...(sourceOwnedImages.length > 0 ? sourceOwnedImages : generatedO.image),
      ...uniqueEditorLines([...sanitizeGeneratedObjectiveOther(generatedO.other, source), ...sourceOwnedPathology]),
    ],
    apProblems: params.workflowMode === "dailyUpdate"
      ? finalizedProblems
      : sortEditorProblemsDeterministically(finalizedProblems),
    taskLines: uniqueEditorLines([...sourceOwnedOrders, ...generatedTasks.orderLines, ...generatedTasks.taskOnlyLines]),
    warnings: actionableWarnings.map((warning) => editorLine(warning, "other")),
  };
  let accepted = repairedGenerated;
  let guardedReview: SoapDeltaReview | null = null;

  if (params.workflowMode === "dailyUpdate") {
    guardedReview = guardRoundSoapDelta({
      workflowMode: params.workflowMode,
      baselineText: params.baselineText,
      candidateText: editorDraftToSoapText(repairedGenerated),
      sourceFields,
      candidateWarnings: actionableWarnings,
      candidateObjectiveIsSourceOwned: true,
    });
    accepted = parseCanonicalSoapTextToEditorDraft(guardedReview.acceptedText);
  }

  const fatalErrors: string[] = [];
  if (sourceLabInputPresent && sourceOwnedLabs.length === 0) {
    fatalErrors.push("Current Lab text was supplied but no exact result could be parsed. Verify the pasted Lab source; the prior Lab was not substituted.");
  }
  const candidateText = editorDraftToSoapText(generated);
  const finalDraft = applyAiHighlightHintsToEditorDraft(accepted, params.value.highlightHints);
  const acceptedText = editorDraftToSoapText(finalDraft);
  const changed = changedSections(baseline, finalDraft);
  const warnings = [...new Set([...(guardedReview?.warnings ?? []), ...actionableWarnings])].slice(0, 8);
  if (guardedReview) {
    return {
      draft: finalDraft,
      fatalErrors,
      review: {
        ...guardedReview,
        candidateText,
        acceptedText,
        warnings,
        highRiskWarnings: [...new Set([...guardedReview.highRiskWarnings, ...fatalErrors])].slice(0, 8),
      },
    };
  }
  return {
    draft: finalDraft,
    fatalErrors,
    review: {
      workflowMode: params.workflowMode,
      baselineText: params.baselineText,
      candidateText,
      acceptedText,
      changedSections: changed.map((id) => ({
        id,
        label: id === "orders" ? "藥囑" : id.toUpperCase(),
        risk: id === "ap" || id === "orders" || id === "dc" ? "high" : "normal",
        reason: "AI structured block differs from the reviewed baseline.",
        blocked: false,
      })),
      warnings,
      highRiskWarnings: fatalErrors,
    },
  };
}
