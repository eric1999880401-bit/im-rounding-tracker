import type { DailyNote, Patient } from "../types";
import { getRoundingDigest } from "../roundingDigest";
import { getAdmissionSummaryText } from "../utils";
import { ClinicalText } from "./ClinicalText";

interface AiHighlightsPanelProps {
  patient: Patient;
  notes?: DailyNote[];
  compact?: boolean;
  className?: string;
  showSbar?: boolean;
}

function hasText(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function sectionPreview(value: string, maxSections = 3) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  const selected: string[] = [];
  let activeHeading = "";

  lines.forEach((line) => {
    if (selected.length >= maxSections) return;
    const headingMatch = line.match(/^(Identify|Situation|Background|Assessment|Recommendation)\s*:?\s*(.*)$/i);
    if (headingMatch) {
      activeHeading = headingMatch[1];
      const content = headingMatch[2].trim();
      if (content) selected.push(`${activeHeading}: ${content}`);
      return;
    }

    if (activeHeading && selected.length < maxSections) {
      selected.push(`${activeHeading}: ${line}`);
    }
  });

  return selected.length > 0 ? selected.join("\n") : lines.slice(0, maxSections).join("\n");
}

function buildPlanText(...values: string[]) {
  const seen = new Set<string>();
  return values
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const clean = line.toLowerCase();
      const key = /neutropenic|leukopen|anc|wbc/.test(clean)
        ? "neutropenic-risk"
        : clean.replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .join("\n");
}

export function AiHighlightsPanel({
  patient,
  notes = [],
  compact = false,
  className = "",
  showSbar = false,
}: AiHighlightsPanelProps) {
  const digest = getRoundingDigest(patient, notes, {
    mode: compact ? "board" : "rounds",
    hideCompletedTasks: true,
  });
  const aiSummary = getAdmissionSummaryText(patient, { allowFallback: false });
  const sbarHandoff = patient.generatedSbarNote || "";
  const hospitalCourse = patient.hospitalCourseHighlights || "";
  const sbarPreview = sectionPreview(sbarHandoff, compact ? 2 : 3);
  const hasAiDocument = [aiSummary, sbarHandoff, hospitalCourse].some(hasText);

  if (!hasAiDocument) return null;

  const seeFirst = compact ? digest.urgentLines.slice(0, 1).map((line) => `!${line}`).join("\n") : "";
  const planText = buildPlanText(digest.assessmentPlan);
  const showPlan = !compact && hasText(planText);
  const showCourse = !compact && hasText(hospitalCourse);
  const showSbarPreview = showSbar && hasText(sbarPreview);
  const hasVisibleContent = [seeFirst, aiSummary, showPlan ? planText : "", showCourse ? hospitalCourse : "", showSbarPreview ? sbarPreview : ""].some(hasText);

  if (!hasVisibleContent) return null;

  return (
    <section className={["ai-highlights", compact ? "ai-highlights-compact" : "", className].filter(Boolean).join(" ")}>
      <div className="ai-highlights-heading">
        <span>{compact ? "Admission Brief" : "AI Clinical Brief"}</span>
      </div>
      <div className="ai-highlights-grid">
        {seeFirst && (
          <div className="ai-highlight-block ai-highlight-critical">
            <span className="board-label">See first</span>
            <ClinicalText value={seeFirst} maxLines={compact ? 1 : 2} maxCharsPerLine={compact ? 48 : 68} importantDefault />
          </div>
        )}
        {aiSummary && (
          <div className="ai-highlight-block">
            <span className="board-label">Patient picture</span>
            <ClinicalText value={aiSummary} maxLines={compact ? 2 : undefined} maxCharsPerLine={compact ? 72 : undefined} />
          </div>
        )}
        {showPlan && (
          <div className="ai-highlight-block">
            <span className="board-label">Active plan</span>
            <ClinicalText value={planText} maxLines={compact ? 2 : 3} maxCharsPerLine={compact ? 48 : 70} />
          </div>
        )}
        {showCourse && (
          <div className="ai-highlight-block">
            <span className="board-label">Course</span>
            <ClinicalText value={hospitalCourse} maxLines={4} maxCharsPerLine={76} />
          </div>
        )}
        {showSbarPreview && (
          <div className="ai-highlight-block">
            <span className="board-label">iSBAR</span>
            <ClinicalText value={sbarPreview} maxLines={compact ? 2 : 4} maxCharsPerLine={compact ? 52 : 72} />
          </div>
        )}
      </div>
    </section>
  );
}
