import type { AiDocumentDraft } from "./types";
import { formatReasoningAdmissionSummary, formatReasoningSbar, formatReasoningWeeklySummary, hasClinicalReasoning } from "./clinicalKnowledge";

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
    .map((line) => line.replace(/^[-*?\s]*/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function sentenceJoin(values: string[]) {
  return values
    .map(normalizeParagraph)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBlock(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*?\s]*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function ensureWeeklyOpening(value: string) {
  const paragraph = normalizeParagraph(value);
  if (!paragraph) return "";
  return paragraph.toLowerCase().startsWith("during this week")
    ? paragraph.replace(/^during this week/i, "During this week")
    : `During this week, ${paragraph.charAt(0).toLowerCase()}${paragraph.slice(1)}`;
}

const sbarHeadings = ["Situation", "Background", "Assessment", "Recommendation"] as const;

function compactSbarContent(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*?\s]*/, "").trim())
    .filter(Boolean)
    .join("; ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*;\s*/g, "; ")
    .trim();
}

function looksLikeMedicationOrder(value: string) {
  return /\b(?:order|orders?|meds?|藥囑)\s*:/i.test(value) ||
    (/\b(?:iv|po|sc|im|mg|mcg|g|unit|units|qd|bid|tid|qid|q\d+h|prn|stat)\b/i.test(value) &&
      /\b(?:cef|vanco|teico|mero|tazo|zosyn|levo|cipro|heparin|apixaban|warfarin|insulin|lasix|furosemide|morphine|fentanyl|ppi|pantoprazole|steroid|methylpred|prednisolone)\b/i.test(value));
}

function recommendationReady(value: string) {
  if (!value.trim() || looksLikeMedicationOrder(value)) return "";
  return compactSbarContent(value);
}

function formatSbarDraft(draft: AiDocumentDraft) {
  if (hasClinicalReasoning(draft.clinicalReasoning)) {
    return formatReasoningSbar(draft.clinicalReasoning);
  }
  const pending = draft.followUpItems.map(recommendationReady).filter(Boolean).join("; ");
  const verify = draft.uncertainty.map(compactSbarContent).filter(Boolean).join("; ");
  const identify = compactSbarContent(sectionContent(draft, ["Identify"]));

  return sbarHeadings
    .map((heading) => {
      const sectionText = compactSbarContent(sectionContent(draft, [heading]));
      const situationPrefix = heading === "Situation" && identify ? identify : "";
      const recommendationExtras =
        heading === "Recommendation"
          ? [pending ? `Pending: ${pending}` : "", verify ? `Verify: ${verify}` : ""].filter(Boolean).join("; ")
          : "";
      const finalContent = [situationPrefix, sectionText, recommendationExtras].filter(Boolean).join("; ");
      return finalContent ? `${heading}: ${finalContent}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function formatWeeklyDraft(draft: AiDocumentDraft) {
  if (hasClinicalReasoning(draft.clinicalReasoning)) {
    return formatReasoningWeeklySummary(draft.clinicalReasoning);
  }
  const summary = ensureWeeklyOpening(sectionContent(draft, ["weekly summary", "summary"]) || draft.conciseSummary);
  const problemPlan = normalizeParagraph(
    sectionContent(draft, ["problem-based", "assessment", "a/p", "plan"]) ||
      draft.sections
        .filter((section) => !/weekly summary|pending|disposition/i.test(section.heading))
        .map((section) => `${section.heading}: ${section.content}`)
        .join(" "),
  );
  const pending = normalizeParagraph(
    sectionContent(draft, ["pending", "disposition", "follow-up"]) ||
      draft.followUpItems.join("; "),
  );
  const verify = normalizeParagraph(draft.uncertainty.map((item) => `Verify: ${item}`).join("; "));

  return sentenceJoin([summary, problemPlan ? `A/P focus: ${problemPlan}` : "", pending || verify ? `Pending/dispo: ${[pending, verify].filter(Boolean).join("; ")}` : ""]);
}

function formatDischargeHospitalCourseDraft(draft: AiDocumentDraft) {
  const course = normalizeParagraph(sectionContent(draft, ["hospital course", "course"]) || draft.conciseSummary);
  if (!course) return "";
  const withoutDuplicateOpening = course.replace(/^after admission,\s*/i, "");
  const followUp = normalizeParagraph(
    sectionContent(draft, ["follow-up", "follow up", "disposition", "discharge"]) ||
      draft.followUpItems.join("; "),
  );
  const alreadyHasClosing = /under relative stable condition|discharged\s+w\//i.test(withoutDuplicateOpening);
  const closing = alreadyHasClosing
    ? ""
    : ` Under relative stable condition, the patient was discharged w/ ${followUp || "clinician-reviewed discharge plan"}.`;
  return `After admission, ${withoutDuplicateOpening}${closing}`.replace(/\s+/g, " ").trim();
}

export function formatClinicalDocumentDraft(draft: AiDocumentDraft) {
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
    return formatDischargeHospitalCourseDraft(draft);
  }

  if (draft.documentType === "weeklySummary") {
    return formatWeeklyDraft(draft);
  }

  if (draft.documentType === "admissionSummary") {
    if (hasClinicalReasoning(draft.clinicalReasoning)) {
      return formatReasoningAdmissionSummary(draft.clinicalReasoning);
    }
    return normalizeParagraph(draft.conciseSummary || draft.sections.map((section) => section.content).join(" "));
  }

  if (draft.documentType === "isbar") {
    return formatSbarDraft(draft);
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

export function getClinicalDocumentSection(draft: AiDocumentDraft | null, headings: string[]) {
  return sectionContent(draft, headings);
}
