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
  return values
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join("\n");
}

export function AiHighlightsPanel({
  patient,
  notes = [],
  compact = false,
  className = "",
  showSbar = true,
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

  const seeFirst = digest.urgentLines.map((line) => `!${line}`).join("\n");
  const planText = buildPlanText(digest.assessmentPlan, digest.tasks, digest.discharge);

  return (
    <section className={["ai-highlights", compact ? "ai-highlights-compact" : "", className].filter(Boolean).join(" ")}>
      <div className="ai-highlights-heading">
        <span>AI Organized Highlights</span>
      </div>
      <div className="ai-highlights-grid">
        {seeFirst && (
          <div className="ai-highlight-block ai-highlight-critical">
            <span className="board-label">See first</span>
            <ClinicalText value={seeFirst} maxLines={compact ? 2 : 4} maxCharsPerLine={compact ? 48 : 68} importantDefault />
          </div>
        )}
        {aiSummary && (
          <div className="ai-highlight-block">
            <span className="board-label">Patient picture</span>
            <ClinicalText value={aiSummary} />
          </div>
        )}
        {planText && (
          <div className="ai-highlight-block">
            <span className="board-label">Active plan</span>
            <ClinicalText value={planText} maxLines={compact ? 3 : 5} maxCharsPerLine={compact ? 48 : 70} />
          </div>
        )}
        {showSbar && sbarPreview && (
          <div className="ai-highlight-block">
            <span className="board-label">iSBAR</span>
            <ClinicalText value={sbarPreview} maxLines={compact ? 2 : 4} maxCharsPerLine={compact ? 52 : 72} />
          </div>
        )}
      </div>
    </section>
  );
}
