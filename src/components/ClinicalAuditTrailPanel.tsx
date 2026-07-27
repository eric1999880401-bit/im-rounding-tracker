import { useEffect, useState } from "react";
import type { ClinicalAuditEvent, ClinicalAuditPayload } from "../types";
import { useAuthUser } from "../firebase/auth";
import { loadClinicalAuditPayloads, subscribeToClinicalAuditEvents } from "../firebase/clinicalAuditService";

interface Props {
  patientId: string;
  isDemoMode?: boolean;
}

const payloadLabels: Record<ClinicalAuditPayload["kind"], string> = {
  source: "Exact pasted source",
  baseline: "Saved baseline before generation",
  candidate: "AI/manual candidate reviewed",
  final: "Final reviewed text",
};

function eventSummary(event: ClinicalAuditEvent) {
  const total = event.stats.added + event.stats.removed + event.stats.rewritten;
  if (event.acceptedAiDraftWithoutEdits) return "AI candidate accepted without text edits";
  if (total === 0) return "Saved without line-level text changes";
  return `${event.stats.added} added · ${event.stats.removed} removed · ${event.stats.rewritten} rewritten`;
}

export default function ClinicalAuditTrailPanel({ patientId, isDemoMode = false }: Props) {
  const { user } = useAuthUser();
  const [events, setEvents] = useState<ClinicalAuditEvent[]>([]);
  const [payloadsByEvent, setPayloadsByEvent] = useState<Record<string, ClinicalAuditPayload[]>>({});
  const [loadingEventId, setLoadingEventId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setEvents([]);
    setPayloadsByEvent({});
    setError("");
    if (isDemoMode || !user || !patientId) return;
    return subscribeToClinicalAuditEvents(
      user.uid,
      patientId,
      setEvents,
      () => setError("Change history could not be loaded. Saved clinical data was not changed."),
    );
  }, [isDemoMode, patientId, user]);

  async function loadPayloads(event: ClinicalAuditEvent) {
    if (!user || payloadsByEvent[event.id]) return;
    setLoadingEventId(event.id);
    setError("");
    try {
      const payloads = await loadClinicalAuditPayloads(user.uid, event.id);
      setPayloadsByEvent((current) => ({ ...current, [event.id]: payloads }));
    } catch {
      setError("The short-lived source snapshots could not be loaded. The durable change metadata is still available.");
    } finally {
      setLoadingEventId("");
    }
  }

  if (isDemoMode) return null;

  return (
    <section className="panel clinical-audit-trail" aria-label="Clinical change history">
      <div className="section-heading">
        <div>
          <h2>Change history</h2>
          <p className="muted">Append-only clinical save metadata. Exact source is stored only when you opted in; text snapshots expire after 30 days.</p>
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
      {events.length === 0 && <p className="muted">No audited clinical saves yet. Existing notes remain unchanged.</p>}
      {events.map((event) => {
        const payloads = payloadsByEvent[event.id];
        return (
          <details key={event.id} className="clinical-audit-event">
            <summary>
              {event.dailyNoteDate} · {event.documentType || `v${event.baseSoapVersion}→v${event.savedSoapVersion}`} · {event.sourceKind.toUpperCase()} · {eventSummary(event)}
            </summary>
            <p className="muted">
              {new Date(event.createdAt).toLocaleString()} · {event.entrypoint} · {event.documentType || event.workflowMode || "SOAP"}
              {event.model ? ` · ${event.model}` : ""}
              {event.sourceDate ? ` · ${event.operation === "ditto.copy" ? "copied from" : "source dates"} ${event.sourceDate}` : ""}
            </p>
            <p>
              Exact pasted source: <strong>{event.sourceStored ? `retained (${event.sourceChars.toLocaleString()} chars)` : "not retained"}</strong>
              {event.payloadExpiresAt ? ` · snapshots expire ${event.payloadExpiresAt.slice(0, 10)}` : ""}
            </p>
            {event.changes.length > 0 && (
              <ul>
                {event.changes.map((change, index) => (
                  <li key={`${event.id}-${change.section}-${index}`}>
                    <strong>{change.section.toUpperCase()} {change.kind}</strong>
                    {change.before ? ` · before: ${change.before}` : ""}
                    {change.after ? ` · after: ${change.after}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {!payloads && event.payloadKinds.length > 0 && (
              <button type="button" className="secondary" disabled={loadingEventId === event.id} onClick={() => void loadPayloads(event)}>
                {loadingEventId === event.id ? "Loading snapshots..." : "Load 30-day source snapshots"}
              </button>
            )}
            {payloads?.map((payload) => (
              <details key={payload.id} className="clinical-audit-payload">
                <summary>{payloadLabels[payload.kind]} ({payload.chars.toLocaleString()} chars{payload.truncated ? ", truncated" : ""})</summary>
                <textarea value={payload.text} readOnly rows={10} aria-label={payloadLabels[payload.kind]} />
              </details>
            ))}
            {payloads && payloads.length === 0 && <p className="muted">Text snapshots expired or were purged; durable metadata remains.</p>}
          </details>
        );
      })}
    </section>
  );
}
