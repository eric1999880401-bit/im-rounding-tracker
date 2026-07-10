import type { SoapEditLineChange, SoapEditSection, SoapEditTrace } from "../types";

const sectionLabels: Record<SoapEditSection, string> = {
  header: "Header",
  s: "S",
  vs: "V/S",
  pe: "PE",
  lab: "Lab",
  image: "Image",
  objective: "O",
  ap: "A/P",
  orders: "\u85e5\u56d1",
  tasks: "Tasks",
  dc: "DC",
};

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function traceLabel(trace: SoapEditTrace) {
  if (trace.source === "ai") {
    return [trace.model || "AI draft", trace.qualityMode].filter(Boolean).join(" / ");
  }
  return "Manual edit";
}

function changeText(change: SoapEditLineChange) {
  if (change.kind === "added") return <div className="soap-edit-change-after"><span>Added</span>{change.after}</div>;
  if (change.kind === "removed") return <div className="soap-edit-change-before"><span>Removed</span>{change.before}</div>;
  return (
    <>
      <div className="soap-edit-change-before"><span>Before</span>{change.before}</div>
      <div className="soap-edit-change-after"><span>After</span>{change.after}</div>
    </>
  );
}

export function SoapEditHistoryPanel({ history = [] }: { history?: SoapEditTrace[] }) {
  const traces = [...history].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  return (
    <details className="soap-edit-history-panel">
      <summary>
        AI correction history
        <span>{traces.length ? `${traces.length} saved revision${traces.length === 1 ? "" : "s"}` : "No saved edits yet"}</span>
      </summary>
      <p className="muted">
        Recorded only when Save reviewed SOAP is pressed. This stores the reviewed line-level changes with this daily note; pasted source text is not stored and these records are not sent to AI automatically.
      </p>
      {traces.length === 0 && <p className="muted">Generate or edit a SOAP, then save it to start a correction record.</p>}
      <div className="soap-edit-trace-list">
        {traces.map((trace) => (
          <details className="soap-edit-trace" key={trace.id}>
            <summary>
              <strong>{traceLabel(trace)}</strong>
              <span>{timeLabel(trace.savedAt)}</span>
              <span>v{trace.baseSoapVersion} to v{trace.savedSoapVersion}</span>
              {trace.acceptedAiDraftWithoutEdits ? (
                <span>Accepted without text edits</span>
              ) : (
                <span>{trace.stats.rewritten} rewritten / {trace.stats.added} added / {trace.stats.removed} removed</span>
              )}
            </summary>
            {trace.changedSections.length > 0 && (
              <div className="soap-edit-section-tags">
                {trace.changedSections.map((section) => <span key={section}>{sectionLabels[section]}</span>)}
              </div>
            )}
            {trace.changes.map((change, index) => (
              <article className={`soap-edit-change soap-edit-change-${change.kind}`} key={`${trace.id}-${change.section}-${index}`}>
                <strong>{sectionLabels[change.section]}</strong>
                <div>{changeText(change)}</div>
              </article>
            ))}
            {trace.truncated && <p className="muted">Additional low-level changes were omitted from this record.</p>}
          </details>
        ))}
      </div>
    </details>
  );
}

export default SoapEditHistoryPanel;
