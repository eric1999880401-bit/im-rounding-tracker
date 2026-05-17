import type { DailyNote, Patient } from "../types";
import { dailyNoteFromPatient, dateFromClinicalText, formatDateLabel, normalizeDateKey } from "../utils";
import { formatLabItem } from "../utils";

interface LabHistoryPanelProps {
  patient: Patient;
  notes: DailyNote[];
}

function numericValue(value: string) {
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function trendPoints(values: number[]) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 34 - ((value - min) / range) * 28;
      return `${x},${y}`;
    })
    .join(" ");
}

function uniqueLabRows(values: Array<{ date: string; value: string; previousValue?: string }>) {
  const seen = new Set<string>();

  return values.filter((item) => {
    const key = [item.date, item.value, item.previousValue ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function LabHistoryPanel({ patient, notes }: LabHistoryPanelProps) {
  const allNotes = notes.length > 0 ? notes : [dailyNoteFromPatient(patient)];
  const rows = new Map<string, Array<{ date: string; value: string; previousValue?: string }>>();

  allNotes.forEach((note) => {
    const reportsWithItems = note.labReports.filter((report) => report.items.length > 0);

    if (reportsWithItems.length > 0) {
      reportsWithItems.forEach((report) => {
        const fallbackDate = normalizeDateKey(note.labDate || note.date);
        const rawTextHasDate = /^\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\b/.test(report.rawText);
        const reportDate = normalizeDateKey(rawTextHasDate ? dateFromClinicalText(report.rawText, fallbackDate) : report.date, fallbackDate);
        report.items.forEach((item) => {
          const label = item.name || item.label;
          const values = rows.get(label) ?? [];
          values.push({ date: reportDate, value: item.value, previousValue: item.previousValue });
          rows.set(label, values);
        });
      });
      return;
    }

    const fallbackDate = normalizeDateKey(note.labDate || note.date);
    note.parsedLabItems.forEach((item) => {
      const label = item.name || item.label;
      const values = rows.get(label) ?? [];
      values.push({ date: fallbackDate, value: item.value, previousValue: item.previousValue });
      rows.set(label, values);
    });
  });

  const groups = Array.from(rows.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="panel lab-history-panel">
      <h2>Lab History / Trends</h2>
      {groups.length === 0 && <p className="muted">No parsed lab history yet.</p>}
      <div className="lab-history-grid">
        {groups.map(([label, values]) => {
          const ordered = uniqueLabRows([...values]).sort((a, b) => a.date.localeCompare(b.date));
          const numericValues = ordered.map((item) => numericValue(item.value)).filter((value): value is number => value !== null);
          const formattedLabel = formatLabItem({ label, value: ordered[ordered.length - 1]?.value ?? "" }).label;

          return (
            <article className="lab-history-card" key={label}>
              <div className="lab-report-heading">
                <strong>{formattedLabel}</strong>
                {numericValues.length >= 2 && (
                  <svg className="lab-trend-svg" viewBox="0 0 100 40" role="img" aria-label={`${label} trend`}>
                    <polyline points={trendPoints(numericValues)} fill="none" stroke="currentColor" strokeWidth="3" />
                  </svg>
                )}
              </div>
              <table className="lab-history-table">
                <tbody>
                  {ordered.map((item) => (
                    <tr key={`${label}-${item.date}-${item.value}`}>
                      <td>{formatDateLabel(item.date)}</td>
                      <td>
                        {item.value}
                        {item.previousValue ? ` (prev ${item.previousValue})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default LabHistoryPanel;
